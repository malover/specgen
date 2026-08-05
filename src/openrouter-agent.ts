import fs from "node:fs";
import path from "node:path";
import fg from "fast-glob";
import { EnvHttpProxyAgent, setGlobalDispatcher } from "undici";
import { z } from "zod";
import type { ProjectSpec } from "./project-spec-schema.js";
import { readJson, writeJson } from "./io.js";

const SpecSelectionSchema = z.object({
  relevantIds: z.array(z.string()).min(1).max(20),
  reasoning: z.string().max(1000)
});
const EditSchema = z.object({
  edits: z.array(z.object({ path: z.string(), content: z.string() })).min(1).max(10),
  summary: z.string().max(1000)
});

const ignoredPaths = [
  "node_modules/**", "dist/**", "build/**", ".git/**", ".codegraph/**",
  "test-output/**", "evaluation/**", "coverage/**"
];

export async function runOpenRouterAgent(environment: NodeJS.ProcessEnv = process.env): Promise<void> {
  const workspace = required(environment.SPECGEN_REPOSITORY ?? process.cwd(), "SPECGEN_REPOSITORY");
  const prompt = environment.SPECGEN_TASK_PROMPT ?? (environment.SPECGEN_PROMPT_FILE ? fs.readFileSync(environment.SPECGEN_PROMPT_FILE, "utf8") : undefined);
  const resultFile = required(environment.SPECGEN_RESULT_FILE, "SPECGEN_RESULT_FILE");
  const model = required(environment.SPECGEN_MODEL ?? environment.OPENROUTER_MODEL, "SPECGEN_MODEL or OPENROUTER_MODEL");
  const apiKey = required(environment.OPENROUTER_API_KEY, "OPENROUTER_API_KEY");
  if (!prompt) throw new Error("SPECGEN_TASK_PROMPT or SPECGEN_PROMPT_FILE is required.");

  const condition = environment.SPECGEN_CONDITION === "project-spec" ? "project-spec" : "baseline";
  const specFile = environment.SPECGEN_PROJECT_SPEC;
  const spec = specFile && fs.existsSync(specFile) ? readJson<ProjectSpec>(specFile) : undefined;
  if (condition === "project-spec" && !spec) throw new Error("Project SPEC condition requires SPECGEN_PROJECT_SPEC.");

  const files = repositoryTextFiles(workspace);
  if (!files.length) throw new Error("No text repository files are available to the agent.");
  const endpoint = `${(environment.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1").replace(/\/$/, "")}/chat/completions`;
  if (environment.HTTPS_PROXY || environment.HTTP_PROXY) setGlobalDispatcher(new EnvHttpProxyAgent());

  let inputTokens = 0;
  let outputTokens = 0;
  let retrievedIds: string[] = [];
  let selectedFiles: string[] = [];
  let contextCharacters = 0;
  let editResult: z.infer<typeof EditSchema>;

  if (condition === "baseline") {
    const repositoryDump = renderFileDump(
      workspace,
      files,
      Number(environment.OPENROUTER_BASELINE_MAX_CHARS ?? 750_000),
      "Full repository dump"
    );
    selectedFiles = files;
    contextCharacters = repositoryDump.length;
    const edited = await completion(endpoint, apiKey, model, [
      {
        role: "system",
        content: "You are a careful coding agent. You receive a full text dump of the repository and no Project SPEC. Return JSON only: {edits:[{path,content}],summary}. Each edit must contain the complete replacement content of an existing file from the dump. Preserve unrelated code and do not use Markdown fences."
      },
      { role: "user", content: `TASK:\n${prompt}\n\nFULL REPOSITORY DUMP:\n${repositoryDump}` }
    ], Number(environment.OPENROUTER_AGENT_MAX_TOKENS ?? 12_000), environment);
    inputTokens += edited.usage.prompt;
    outputTokens += edited.usage.completion;
    editResult = EditSchema.parse(parseJson(edited.content));
  } else {
    const projectSpec = spec!;
    const selectionIndex = JSON.stringify(specSelectionIndex(projectSpec));
    const planned = await completion(endpoint, apiKey, model, [
      {
        role: "system",
        content: "You are a Project SPEC retrieval planner. Select only the Project SPEC records needed to implement the task. Return JSON only: {relevantIds:string[], reasoning:string}. Use exact IDs from the supplied SPEC index. Prefer specific interface IDs and add a module ID only when module-level context is necessary. Do not request repository files; file evidence will be resolved from the selected SPEC records."
      },
      { role: "user", content: `TASK:\n${prompt}\n\nPROJECT SPEC SELECTION INDEX:\n${selectionIndex}` }
    ], 2500, environment);
    inputTokens += planned.usage.prompt;
    outputTokens += planned.usage.completion;

    const plan = SpecSelectionSchema.parse(parseJson(planned.content));
    const retrieved = retrieveSpecPortion(projectSpec, plan.relevantIds);
    retrievedIds = retrieved.ids;
    selectedFiles = retrieved.sourceFiles.filter(file => files.includes(file));
    if (!selectedFiles.length) throw new Error(`Selected Project SPEC records have no existing source evidence: ${retrievedIds.join(", ")}`);

    const specFragment = JSON.stringify(retrieved.fragment);
    const sourceContext = renderFileDump(
      workspace,
      selectedFiles,
      Number(environment.OPENROUTER_SPEC_SOURCE_MAX_CHARS ?? 300_000),
      "Selected Project SPEC source evidence"
    );
    contextCharacters = specFragment.length + sourceContext.length;
    const edited = await completion(endpoint, apiKey, model, [
      {
        role: "system",
        content: "You are a careful coding agent. Implement the task using only the retrieved Project SPEC fragment and its selected source evidence. Return JSON only: {edits:[{path,content}],summary}. Each edit must contain the complete replacement content of an existing selected source file. Preserve unrelated code and do not use Markdown fences."
      },
      {
        role: "user",
        content: `TASK:\n${prompt}\n\nRETRIEVED PROJECT SPEC FRAGMENT:\n${specFragment}\n\nSELECTED SOURCE EVIDENCE:\n${sourceContext}`
      }
    ], Number(environment.OPENROUTER_AGENT_MAX_TOKENS ?? 12_000), environment);
    inputTokens += edited.usage.prompt;
    outputTokens += edited.usage.completion;
    editResult = EditSchema.parse(parseJson(edited.content));
  }

  applyEdits(workspace, selectedFiles, editResult);
  writeJson(resultFile, {
    inputTokens,
    outputTokens,
    repairIterations: 0,
    retrievedIds,
    usedProjectSpec: condition === "project-spec",
    contextMode: condition === "baseline" ? "full-repository-dump" : "retrieved-project-spec",
    contextCharacters,
    selectedFiles,
    summary: editResult.summary
  });
}

async function completion(endpoint: string, apiKey: string, model: string, messages: Array<{ role: string; content: string }>, maxTokens: number, environment: NodeJS.ProcessEnv): Promise<{ content: string; usage: { prompt: number; completion: number } }> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", "X-Title": "SpecGen Agent Evaluation" },
      body: JSON.stringify({ model, messages, temperature: 0, max_tokens: maxTokens }),
      signal: AbortSignal.timeout(Number(environment.OPENROUTER_TIMEOUT_MS ?? 180_000))
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 1000)}`);
    const body = JSON.parse(text);
    const content = body?.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim()) throw new Error("Model returned an empty response.");
    return {
      content,
      usage: {
        prompt: Number(body.usage?.prompt_tokens ?? 0),
        completion: Number(body.usage?.completion_tokens ?? 0)
      }
    };
  } catch (error) {
    lastError = error;
    if (attempt < 3) await new Promise(resolve => setTimeout(resolve, attempt * 1000));
  }
  throw lastError;
}

function repositoryTextFiles(workspace: string): string[] {
  return fg.sync(["**/*"], { cwd: workspace, onlyFiles: true, dot: true, ignore: ignoredPaths })
    .map(normalize)
    .filter(file => isTextFile(path.join(workspace, file)))
    .sort();
}

function isTextFile(file: string): boolean {
  const descriptor = fs.openSync(file, "r");
  try {
    const sample = Buffer.alloc(8192);
    const bytes = fs.readSync(descriptor, sample, 0, sample.length, 0);
    return !sample.subarray(0, bytes).includes(0);
  } finally {
    fs.closeSync(descriptor);
  }
}

function renderFileDump(workspace: string, files: string[], maxCharacters: number, label: string): string {
  if (!Number.isSafeInteger(maxCharacters) || maxCharacters < 1) throw new Error(`${label} character limit must be a positive integer.`);
  const sections: string[] = [];
  let characters = 0;
  for (const file of files) {
    const content = redactSecrets(fs.readFileSync(path.join(workspace, file), "utf8"));
    const section = `--- ${file} ---\n${content}`;
    characters += section.length;
    if (characters > maxCharacters) {
      throw new Error(`${label} is ${characters} characters before completion and exceeds the ${maxCharacters} character limit. Increase the corresponding OpenRouter agent context limit or use a larger-context model.`);
    }
    sections.push(section);
  }
  return sections.join("\n\n");
}

function specSelectionIndex(spec: ProjectSpec): unknown {
  return {
    repository: spec.repository,
    modules: spec.modules.map(module => ({
      id: module.id,
      name: module.name,
      root: module.root,
      responsibilities: module.responsibilities,
      interfaceIds: module.interfaceIds,
      dependencies: module.dependencies.map(dependency => ({
        targetId: dependency.targetId,
        targetName: dependency.targetName,
        relationKinds: dependency.relationKinds,
        resolution: dependency.resolution
      }))
    })),
    interfaces: spec.interfaces.map(item => ({
      id: item.id,
      moduleId: item.moduleId,
      name: item.name,
      qualifiedName: item.qualifiedName,
      kind: item.kind,
      scope: item.scope,
      operations: item.operations.map(operation => ({ name: operation.name, signature: operation.signature })),
      evidenceFiles: [...new Set([
        ...item.evidence.map(reference => reference.filePath),
        ...item.operations.flatMap(operation => operation.evidence.map(reference => reference.filePath))
      ])]
    })),
    acceptedConstraints: spec.constraints
      .filter(constraint => constraint.status === "accepted")
      .map(constraint => ({ id: constraint.id, name: constraint.name, description: constraint.description, effect: constraint.effect }))
  };
}

function retrieveSpecPortion(spec: ProjectSpec, requestedIds: string[]): { ids: string[]; fragment: unknown; sourceFiles: string[] } {
  const modulesById = new Map(spec.modules.map(module => [module.id, module]));
  const interfacesById = new Map(spec.interfaces.map(item => [item.id, item]));
  const constraintsById = new Map(spec.constraints.map(constraint => [constraint.id, constraint]));
  const ids = [...new Set(requestedIds)].filter(id => modulesById.has(id) || interfacesById.has(id) || constraintsById.has(id)).slice(0, 20);
  if (!ids.length) throw new Error("Project SPEC planner did not select any valid SPEC IDs.");

  const selectedModuleIds = new Set(ids.filter(id => modulesById.has(id)));
  const selectedInterfaceIds = new Set(ids.filter(id => interfacesById.has(id)));
  for (const interfaceId of selectedInterfaceIds) selectedModuleIds.add(interfacesById.get(interfaceId)!.moduleId);
  for (const item of spec.interfaces) if (selectedModuleIds.has(item.moduleId) && ids.includes(item.moduleId)) selectedInterfaceIds.add(item.id);

  const modules = spec.modules.filter(module => selectedModuleIds.has(module.id));
  const interfaces = spec.interfaces.filter(item => selectedInterfaceIds.has(item.id));
  const selectedConstraints = spec.constraints.filter(constraint => {
    if (ids.includes(constraint.id)) return true;
    if (constraint.status !== "accepted") return false;
    const moduleIds = [
      ...(constraint.sourceSelector.moduleIds ?? []),
      ...(constraint.targetSelector.moduleIds ?? [])
    ];
    return moduleIds.some(moduleId => selectedModuleIds.has(moduleId));
  });

  const evidenceIds = new Set<string>([
    ...modules.map(module => module.id),
    ...interfaces.map(item => item.id),
    ...interfaces.flatMap(item => item.operations.map(operation => operation.id)),
    ...selectedConstraints.map(constraint => constraint.id)
  ]);
  const evidenceIndex = Object.fromEntries(
    [...evidenceIds]
      .filter(id => spec.evidenceIndex[id]?.length)
      .map(id => [id, spec.evidenceIndex[id]])
  );
  const sourceFiles = [...new Set([
    ...modules.flatMap(module => [
      ...(module.manifest ? [module.manifest] : []),
      ...module.evidence.map(reference => reference.filePath),
      ...module.dependencies.flatMap(dependency => dependency.evidence.map(reference => reference.filePath))
    ]),
    ...interfaces.flatMap(item => [
      ...item.evidence.map(reference => reference.filePath),
      ...item.operations.flatMap(operation => operation.evidence.map(reference => reference.filePath))
    ]),
    ...selectedConstraints.flatMap(constraint => constraint.evidence.map(reference => reference.filePath))
  ].map(normalize).filter(Boolean))].sort();

  return {
    ids,
    fragment: {
      schema: spec.schema,
      specVersion: spec.specVersion,
      repository: spec.repository,
      modules,
      interfaces,
      constraints: selectedConstraints,
      architectureEdges: spec.views.moduleDependencies.edges.filter(edge => selectedModuleIds.has(edge.source) || selectedModuleIds.has(edge.target)),
      evidenceIndex
    },
    sourceFiles
  };
}

function applyEdits(workspace: string, allowedFiles: string[], result: z.infer<typeof EditSchema>): void {
  const allowed = new Set(allowedFiles);
  for (const edit of result.edits) {
    const relative = normalize(edit.path);
    if (!allowed.has(relative)) throw new Error(`Agent attempted to edit a file outside its supplied context: ${relative}`);
    const target = path.resolve(workspace, relative);
    if (!target.startsWith(`${path.resolve(workspace)}${path.sep}`) || !fs.existsSync(target)) throw new Error(`Unsafe edit path: ${relative}`);
    fs.writeFileSync(target, edit.content);
  }
}

function parseJson(value: string): unknown {
  return JSON.parse(value.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, ""));
}
function normalize(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\.\//, "");
}
function required(value: string | undefined, name: string): string {
  if (!value) throw new Error(`${name} is required.`);
  return value;
}
function redactSecrets(value: string): string {
  return value
    .replace(/^\s*((?:api[_-]?key|token|password|secret)\s*[:=]\s*).+$/gim, "$1<redacted>")
    .replace(/\b(?:sk|ghp|github_pat)-[A-Za-z0-9_-]{16,}\b/g, "<redacted>");
}
