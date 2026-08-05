import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { ProjectSpec } from "./project-spec-schema.js";
import { stableId } from "./files.js";
import { writeJson } from "./io.js";
import { checkArchitecture } from "./architecture-check.js";

export const GeneratedAgentTaskSchema = z.object({
  schema: z.literal("deveco.specgen-generated-agent-task/v1"), id: z.string(), type: z.literal("add-exported-identity-helper"),
  moduleId: z.string(), interfaceId: z.string(), targetFile: z.string(), functionName: z.string(),
  signature: z.string(), expectedReturnExpression: z.string()
});
export type GeneratedAgentTask = z.infer<typeof GeneratedAgentTaskSchema>;

export function generateAgentBenchmark(spec: ProjectSpec, repositoryRoot: string, projectSpecFile: string, outputDirectory: string, taskLimit = 3): { experimentFile: string; taskFiles: string[]; tasks: number } {
  const candidates = spec.interfaces.filter(item => item.scope === "public" && item.evidence[0]?.filePath && /\.(?:ets|ts)$/i.test(item.evidence[0].filePath));
  const selected = uniqueModules(candidates).slice(0, Math.max(1, taskLimit));
  if (!selected.length) throw new Error("No source-backed public ArkTS/TypeScript interface is available for generated agent tasks.");
  const taskDirectory = path.join(outputDirectory, "agent-tasks", spec.repository.id); fs.mkdirSync(taskDirectory, { recursive: true });
  const taskFiles: string[] = []; const experimentTasks = []; const baselineArchitectureIssues = checkArchitecture(spec).length;
  for (const item of selected) {
    const module = spec.modules.find(module => module.id === item.moduleId)!;
    const suffix = stableId(`${spec.repository.id}:${item.id}`).slice(0, 8); const functionName = `specgenIdentity_${suffix}`;
    const task: GeneratedAgentTask = {
      schema: "deveco.specgen-generated-agent-task/v1", id: `task:add-identity:${suffix}`,
      type: "add-exported-identity-helper", moduleId: item.moduleId, interfaceId: item.id,
      targetFile: item.evidence[0].filePath, functionName,
      signature: `export function ${functionName}(value: string): string`, expectedReturnExpression: "return value"
    };
    const taskFile = path.resolve(taskDirectory, `${task.id.replace(/[^A-Za-z0-9._-]/g, "-")}.json`); writeJson(taskFile, task); taskFiles.push(taskFile);
    const verification: Array<Record<string, unknown>> = [{
      purpose: "test", command: process.execPath,
      args: [path.resolve("dist/src/cli.js"), "verify-generated-task", "--task", taskFile, "--repository", "{repository}"], timeoutMs: 120_000, env: {}
    }];
    verification.push({
      purpose: "architecture", command: process.execPath,
      args: [path.resolve("dist/src/cli.js"), "architecture-check-repo", "--repository", "{repository}", "--max-issues", String(baselineArchitectureIssues)], timeoutMs: 180_000, env: {}
    });
    const wrapper = buildWrapper(repositoryRoot); if (wrapper) verification.push({ purpose: "build", command: wrapper, args: ["assembleHap"], timeoutMs: 600_000, env: {} });
    experimentTasks.push({
      id: task.id, repository: path.resolve(repositoryRoot),
      prompt: `In the ${module.name} module's existing public API, add an exported helper with the exact signature \`${task.signature}\`. It must return the supplied value unchanged. Preserve existing behavior, follow current module boundaries, and do not modify unrelated files.`,
      projectSpecFile: path.resolve(projectSpecFile), relevantIds: [item.moduleId, item.id], verification
    });
  }
  const experimentFile = path.resolve(outputDirectory, `agent-experiment.${spec.repository.id}.json`);
  writeJson(experimentFile, {
    schema: "deveco.specgen-agent-experiment/v1", model: process.env.OPENROUTER_MODEL ?? "SET_OPENROUTER_MODEL",
    repetitions: 1, outputDirectory: `./agent-results/${spec.repository.id}`,
    agent: {
      command: process.execPath,
      args: [path.resolve("dist/src/cli.js"), "openrouter-agent"],
      timeoutMs: 900_000, env: {}
    }, tasks: experimentTasks
  });
  return { experimentFile, taskFiles, tasks: taskFiles.length };
}

export function verifyGeneratedAgentTask(task: GeneratedAgentTask, repositoryRoot: string): { passed: boolean; issues: string[] } {
  const file = path.join(repositoryRoot, task.targetFile); const issues: string[] = [];
  if (!fs.existsSync(file)) return { passed: false, issues: [`Target API file is missing: ${task.targetFile}`] };
  const source = fs.readFileSync(file, "utf8"); const name = escape(task.functionName);
  if (!new RegExp(`export\\s+function\\s+${name}\\s*\\(\\s*value\\s*:\\s*string\\s*\\)\\s*:\\s*string`).test(source)) issues.push(`Missing exact exported signature: ${task.signature}`);
  if (!new RegExp(`function\\s+${name}[\\s\\S]{0,500}?return\\s+value\\s*;?`).test(source)) issues.push("The helper does not return the supplied value unchanged.");
  return { passed: issues.length === 0, issues };
}

function uniqueModules<T extends { moduleId: string }>(items: T[]): T[] { const seen = new Set<string>(); return items.filter(item => { if (seen.has(item.moduleId)) return false; seen.add(item.moduleId); return true; }); }
function buildWrapper(root: string): string | undefined {
  for (const file of ["hvigorw.bat", "hvigorw", "./hvigorw.bat", "./hvigorw"]) if (fs.existsSync(path.join(root, file.replace(/^\.\//, "")))) return `{repository}/${file.replace(/^\.\//, "")}`;
  return undefined;
}
function escape(value: string): string { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
