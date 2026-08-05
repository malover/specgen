import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import fg from "fast-glob";
import { z } from "zod";
import { AgentRunSchema, type AgentRun } from "./evaluation-schema.js";
import { compareAgentRuns, type AgentComparison } from "./agent-evaluation.js";
import { readJson, writeJson } from "./io.js";

const ProcessSchema = z.object({
  command: z.string().min(1), args: z.array(z.string()).default([]),
  timeoutMs: z.number().int().positive().default(900_000), env: z.record(z.string(), z.string()).default({})
});
const VerificationSchema = ProcessSchema.extend({ purpose: z.enum(["build", "test", "architecture"]) });
export const AgentExperimentConfigSchema = z.object({
  schema: z.literal("deveco.specgen-agent-experiment/v1"), model: z.string().min(1),
  repetitions: z.number().int().min(1).default(3), outputDirectory: z.string().min(1),
  agent: ProcessSchema,
  tasks: z.array(z.object({
    id: z.string().min(1), repository: z.string().min(1), prompt: z.string().min(1),
    projectSpecFile: z.string().min(1), relevantIds: z.array(z.string()).default([]),
    architectureConstraintsFile: z.string().min(1).optional(),
    verification: z.array(VerificationSchema).min(1)
  })).min(1)
});
export type AgentExperimentConfig = z.infer<typeof AgentExperimentConfigSchema>;

interface AgentMetadata {
  inputTokens?: number; outputTokens?: number; repairIterations?: number;
  retrievedIds?: string[]; architectureIssueCount?: number; usedProjectSpec?: boolean;
}

export async function runAgentExperiment(raw: unknown): Promise<{ runs: AgentRun[]; comparison: AgentComparison; outputDirectory: string }> {
  const config = AgentExperimentConfigSchema.parse(raw); const output = path.resolve(config.outputDirectory);
  if (/^SET[_-]/i.test(config.model)) throw new Error("Set a real model identifier in the agent experiment before running it.");
  for (const task of config.tasks) {
    if (!fs.existsSync(task.repository) || !fs.statSync(task.repository).isDirectory()) throw new Error(`Missing task repository: ${task.repository}`);
    if (!fs.existsSync(task.projectSpecFile)) throw new Error(`Missing Project SPEC: ${task.projectSpecFile}`);
    if (task.architectureConstraintsFile && !fs.existsSync(task.architectureConstraintsFile)) throw new Error(`Missing architecture constraints: ${task.architectureConstraintsFile}`);
  }
  fs.mkdirSync(output, { recursive: true }); const runs: AgentRun[] = [];
  for (let repetition = 1; repetition <= config.repetitions; repetition++) for (const task of config.tasks) {
    const conditions = repetition % 2 ? ["baseline", "project-spec"] as const : ["project-spec", "baseline"] as const;
    for (const condition of conditions) runs.push(await executeRun(config, task, repetition, condition, output));
  }
  const comparison = compareAgentRuns(runs); writeJson(path.join(output, "agent-runs.json"), runs); writeJson(path.join(output, "agent-comparison.json"), comparison);
  return { runs, comparison, outputDirectory: output };
}

export function loadAgentExperiment(file: string): AgentExperimentConfig {
  const raw = readJson<unknown>(file); if (!raw) throw new Error(`Missing agent experiment: ${file}`);
  const base = path.dirname(path.resolve(file)); const parsed = AgentExperimentConfigSchema.parse(raw);
  parsed.outputDirectory = path.resolve(base, parsed.outputDirectory);
  parsed.tasks = parsed.tasks.map(task => ({
    ...task, repository: path.resolve(base, task.repository), projectSpecFile: path.resolve(base, task.projectSpecFile),
    architectureConstraintsFile: task.architectureConstraintsFile ? path.resolve(base, task.architectureConstraintsFile) : undefined
  }));
  return parsed;
}

async function executeRun(config: AgentExperimentConfig, task: AgentExperimentConfig["tasks"][number], repetition: number, condition: AgentRun["condition"], output: string): Promise<AgentRun> {
  const runId = `${task.id}-${condition}-${repetition}`; const runDirectory = path.join(output, runId); const workspace = path.join(runDirectory, "workspace");
  fs.rmSync(runDirectory, { recursive: true, force: true }); fs.mkdirSync(runDirectory, { recursive: true });
  copyRepository(task.repository, workspace); const before = fileHashes(workspace);
  const promptFile = path.join(runDirectory, "prompt.md"); fs.writeFileSync(promptFile, task.prompt);
  const resultFile = path.join(runDirectory, "agent-result.json");
  const replacements = {
    repository: workspace, prompt: task.prompt, promptFile, condition,
    spec: condition === "project-spec" ? task.projectSpecFile : "",
    constraints: task.architectureConstraintsFile ?? "", resultFile
  };
  const started = performance.now();
  const agent = await runProcess(config.agent, replacements, workspace, {
    SPECGEN_CONDITION: condition, SPECGEN_TASK_ID: task.id, SPECGEN_TASK_PROMPT: task.prompt,
    SPECGEN_PROMPT_FILE: promptFile, SPECGEN_PROJECT_SPEC: replacements.spec, SPECGEN_RESULT_FILE: resultFile,
    SPECGEN_MODEL: config.model, SPECGEN_ARCHITECTURE_CONSTRAINTS: replacements.constraints
  });
  const verifications = [];
  if (agent.code === 0) for (const check of task.verification) verifications.push({ purpose: check.purpose, result: await runProcess(check, replacements, workspace, {}) });
  const metadata = readJson<AgentMetadata>(resultFile) ?? {};
  const build = verifications.filter(item => item.purpose === "build"); const tests = verifications.filter(item => item.purpose === "test"); const architecture = verifications.filter(item => item.purpose === "architecture");
  const buildPassed = build.length ? build.every(item => item.result.code === 0) : agent.code === 0;
  const testsPassed = tests.length ? tests.every(item => item.result.code === 0) : agent.code === 0;
  const architectureIssueCount = (metadata.architectureIssueCount ?? 0) + architecture.filter(item => item.result.code !== 0).length;
  const after = fileHashes(workspace); const filesTouched = changedFiles(before, after);
  const result = AgentRunSchema.parse({
    schema: "deveco.specgen-agent-run/v1", taskId: task.id, runId, condition,
    success: agent.code === 0 && buildPassed && testsPassed && architectureIssueCount === 0,
    buildPassed, testsPassed, architectureIssueCount, durationMs: performance.now() - started,
    inputTokens: metadata.inputTokens ?? 0, outputTokens: metadata.outputTokens ?? 0,
    filesTouched, repairIterations: metadata.repairIterations ?? 0,
    retrievedIds: metadata.retrievedIds ?? [], relevantIds: task.relevantIds,
    usedProjectSpec: condition === "baseline" ? false : metadata.usedProjectSpec
  });
  writeJson(path.join(runDirectory, "run.json"), { ...result, model: config.model, usedProjectSpec: metadata.usedProjectSpec ?? null, agent: { exitCode: agent.code, timedOut: agent.timedOut }, verifications });
  return result;
}

async function runProcess(definition: z.infer<typeof ProcessSchema>, replacements: Record<string, string>, cwd: string, extraEnv: Record<string, string>): Promise<{ code: number; timedOut: boolean; stdout: string; stderr: string }> {
  const replace = (value: string) => value.replace(/\{(repository|prompt|promptFile|condition|spec|constraints|resultFile)\}/g, (_, name: string) => replacements[name] ?? "");
  const command = replace(definition.command); const args = definition.args.map(replace); let timedOut = false;
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, shell: false, env: { ...process.env, ...definition.env, ...extraEnv }, windowsHide: true });
    let stdout = ""; let stderr = ""; child.stdout?.on("data", chunk => stdout += String(chunk)); child.stderr?.on("data", chunk => stderr += String(chunk));
    const timer = setTimeout(() => { timedOut = true; child.kill("SIGTERM"); }, definition.timeoutMs);
    child.on("error", error => { clearTimeout(timer); reject(error); });
    child.on("close", code => { clearTimeout(timer); resolve({ code: timedOut ? 124 : code ?? 1, timedOut, stdout, stderr }); });
  });
}

function copyRepository(source: string, target: string): void {
  const ignored = new Set([".git", ".codegraph", "node_modules", "dist", "build", "test-output"]);
  fs.cpSync(source, target, { recursive: true, filter: item => !ignored.has(path.basename(item)) });
}
function fileHashes(root: string): Map<string, string> {
  const result = new Map<string, string>();
  for (const relative of fg.sync(["**/*"], { cwd: root, onlyFiles: true, dot: true, ignore: [".git/**", ".codegraph/**", "node_modules/**", "dist/**", "build/**", ".specgen-*" ] })) {
    result.set(relative, crypto.createHash("sha256").update(fs.readFileSync(path.join(root, relative))).digest("hex"));
  }
  return result;
}
function changedFiles(before: Map<string, string>, after: Map<string, string>): number { return new Set([...before.keys(), ...after.keys()]).size - [...before.keys()].filter(file => after.get(file) === before.get(file)).length; }
