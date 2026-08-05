import fs from "node:fs";
import path from "node:path";
import fg from "fast-glob";
import { EnvHttpProxyAgent, setGlobalDispatcher } from "undici";
import { z } from "zod";
import type { ProjectSpec } from "./project-spec-schema.js";
import { readJson, writeJson } from "./io.js";

const PlanSchema = z.object({ files: z.array(z.string()).min(1).max(10), relevantIds: z.array(z.string()).default([]), reasoning: z.string().max(1000) });
const EditSchema = z.object({ edits: z.array(z.object({ path: z.string(), content: z.string() })).min(1).max(10), summary: z.string().max(1000) });

export async function runOpenRouterAgent(environment: NodeJS.ProcessEnv = process.env): Promise<void> {
  const workspace = required(environment.SPECGEN_REPOSITORY ?? process.cwd(), "SPECGEN_REPOSITORY");
  const prompt = environment.SPECGEN_TASK_PROMPT ?? (environment.SPECGEN_PROMPT_FILE ? fs.readFileSync(environment.SPECGEN_PROMPT_FILE, "utf8") : undefined);
  const resultFile = required(environment.SPECGEN_RESULT_FILE, "SPECGEN_RESULT_FILE"); const model = required(environment.SPECGEN_MODEL ?? environment.OPENROUTER_MODEL, "SPECGEN_MODEL or OPENROUTER_MODEL");
  const apiKey = required(environment.OPENROUTER_API_KEY, "OPENROUTER_API_KEY"); if (!prompt) throw new Error("SPECGEN_TASK_PROMPT or SPECGEN_PROMPT_FILE is required.");
  const specFile = environment.SPECGEN_PROJECT_SPEC; const spec = specFile && fs.existsSync(specFile) ? readJson<ProjectSpec>(specFile) : undefined;
  const files = fg.sync(["**/*.{ets,ts,tsx,js,jsx,json,json5,yaml,yml,toml}"], { cwd: workspace, onlyFiles: true, dot: false, ignore: ["node_modules/**", "dist/**", "build/**", ".git/**", ".codegraph/**"] }).sort();
  const endpoint = `${(environment.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1").replace(/\/$/, "")}/chat/completions`;
  if (environment.HTTPS_PROXY || environment.HTTP_PROXY) setGlobalDispatcher(new EnvHttpProxyAgent());
  let inputTokens = 0; let outputTokens = 0;
  const specContext = spec ? JSON.stringify(agentSpecContext(spec)).slice(0, 70_000) : "Project SPEC is not available in this condition.";
  const planned = await completion(endpoint, apiKey, model, [
    { role: "system", content: "You are a repository navigation planner. Select existing files needed for the task. Return JSON only: {files:string[], relevantIds:string[], reasoning:string}. Never invent paths." },
    { role: "user", content: `TASK:\n${prompt}\n\nFILES:\n${files.join("\n")}\n\nPROJECT SPEC INDEX:\n${specContext}` }
  ], 2500, environment);
  inputTokens += planned.usage.prompt; outputTokens += planned.usage.completion;
  const plan = PlanSchema.parse(parseJson(planned.content)); const selected = plan.files.filter(file => files.includes(normalize(file))).map(normalize).slice(0, 10);
  if (!selected.length) throw new Error("Agent planner did not select any existing repository files.");
  let remaining = 100_000; const evidence = selected.map(file => {
    const content = redactSecrets(fs.readFileSync(path.join(workspace, file), "utf8")).slice(0, Math.min(25_000, remaining)); remaining -= content.length;
    return `--- ${file} ---\n${content}`;
  }).join("\n\n");
  const edited = await completion(endpoint, apiKey, model, [
    { role: "system", content: "You are a careful coding agent. Return JSON only: {edits:[{path,content}],summary}. Each edit must contain the complete replacement content of an existing selected file. Preserve unrelated code. Do not use Markdown fences." },
    { role: "user", content: `TASK:\n${prompt}\n\nSELECTED FILES:\n${evidence}\n\nPROJECT SPEC INDEX:\n${specContext}` }
  ], Number(environment.OPENROUTER_AGENT_MAX_TOKENS ?? 12_000), environment);
  inputTokens += edited.usage.prompt; outputTokens += edited.usage.completion;
  const edits = EditSchema.parse(parseJson(edited.content));
  for (const edit of edits.edits) {
    const relative = normalize(edit.path); if (!selected.includes(relative)) throw new Error(`Agent attempted to edit an unselected file: ${relative}`);
    const target = path.resolve(workspace, relative); if (!target.startsWith(`${path.resolve(workspace)}${path.sep}`) || !fs.existsSync(target)) throw new Error(`Unsafe edit path: ${relative}`);
    fs.writeFileSync(target, edit.content);
  }
  writeJson(resultFile, { inputTokens, outputTokens, repairIterations: 0, retrievedIds: plan.relevantIds, usedProjectSpec: Boolean(spec), summary: edits.summary });
}

async function completion(endpoint: string, apiKey: string, model: string, messages: Array<{ role: string; content: string }>, maxTokens: number, environment: NodeJS.ProcessEnv): Promise<{ content: string; usage: { prompt: number; completion: number } }> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) try {
    const response = await fetch(endpoint, {
      method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", "X-Title": "SpecGen Agent Evaluation" },
      body: JSON.stringify({ model, messages, temperature: 0, max_tokens: maxTokens }),
      signal: AbortSignal.timeout(Number(environment.OPENROUTER_TIMEOUT_MS ?? 180_000))
    });
    const text = await response.text(); if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 1000)}`);
    const body = JSON.parse(text); const content = body?.choices?.[0]?.message?.content; if (typeof content !== "string" || !content.trim()) throw new Error("Model returned an empty response.");
    return { content, usage: { prompt: Number(body.usage?.prompt_tokens ?? 0), completion: Number(body.usage?.completion_tokens ?? 0) } };
  } catch (error) { lastError = error; if (attempt < 3) await new Promise(resolve => setTimeout(resolve, attempt * 1000)); }
  throw lastError;
}
function parseJson(value: string): unknown { return JSON.parse(value.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")); }
function normalize(value: string): string { return value.replace(/\\/g, "/").replace(/^\.\//, ""); }
function required(value: string | undefined, name: string): string { if (!value) throw new Error(`${name} is required.`); return value; }
function redactSecrets(value: string): string { return value.replace(/^\s*((?:api[_-]?key|token|password|secret)\s*[:=]\s*).+$/gim, "$1<redacted>").replace(/\b(?:sk|ghp|github_pat)-[A-Za-z0-9_-]{16,}\b/g, "<redacted>"); }
function agentSpecContext(spec: ProjectSpec): unknown {
  return {
    repository: spec.repository,
    modules: spec.modules.map(module => ({
      id: module.id, name: module.name, root: module.root, files: module.files.slice(0, 100),
      dependencies: module.dependencies.map(dep => ({ target: dep.targetName, relationKinds: dep.relationKinds, resolution: dep.resolution }))
    })),
    interfaces: spec.interfaces.map(item => ({
      id: item.id, moduleId: item.moduleId, name: item.name, kind: item.kind, scope: item.scope,
      operations: item.operations.map(operation => ({ name: operation.name, signature: operation.signature })),
      evidence: item.evidence.map(ref => ({ filePath: ref.filePath, startLine: ref.startLine, endLine: ref.endLine }))
    })),
    acceptedConstraints: spec.constraints.filter(item => item.status === "accepted").map(item => ({ id: item.id, name: item.name, description: item.description, effect: item.effect }))
  };
}
