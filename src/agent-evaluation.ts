import { AgentRunSchema, type AgentRun } from "./evaluation-schema.js";

export interface AgentConditionSummary {
  runs: number; tasks: number; taskSuccessRate: number; buildPassRate: number; testPassRate: number;
  architectureComplianceRate: number; meanDurationMs: number; meanTokens: number;
  meanFilesTouched: number; meanRepairIterations: number; retrievalPrecision: number | null; retrievalRecall: number | null;
}
export interface AgentComparison { baseline: AgentConditionSummary; projectSpec: AgentConditionSummary; delta: Record<string, number | null>; pairedTaskIds: string[]; warnings: string[] }

export function compareAgentRuns(values: unknown[]): AgentComparison {
  const runs = values.map(value => AgentRunSchema.parse(value));
  const baselineRuns = runs.filter(item => item.condition === "baseline");
  const specRuns = runs.filter(item => item.condition === "project-spec");
  if (!baselineRuns.length || !specRuns.length) throw new Error("Both baseline and project-spec agent runs are required.");
  const baseline = summarizeRuns(baselineRuns); const projectSpec = summarizeRuns(specRuns);
  const baselineTasks = new Set(baselineRuns.map(item => item.taskId)); const specTasks = new Set(specRuns.map(item => item.taskId));
  const pairedTaskIds = [...baselineTasks].filter(item => specTasks.has(item)).sort();
  const delta = {
    taskSuccessRate: projectSpec.taskSuccessRate - baseline.taskSuccessRate,
    buildPassRate: projectSpec.buildPassRate - baseline.buildPassRate,
    testPassRate: projectSpec.testPassRate - baseline.testPassRate,
    architectureComplianceRate: projectSpec.architectureComplianceRate - baseline.architectureComplianceRate,
    meanDurationMs: projectSpec.meanDurationMs - baseline.meanDurationMs,
    meanTokens: projectSpec.meanTokens - baseline.meanTokens,
    meanFilesTouched: projectSpec.meanFilesTouched - baseline.meanFilesTouched,
    meanRepairIterations: projectSpec.meanRepairIterations - baseline.meanRepairIterations,
    retrievalPrecision: projectSpec.retrievalPrecision === null ? null : projectSpec.retrievalPrecision,
    retrievalRecall: projectSpec.retrievalRecall === null ? null : projectSpec.retrievalRecall
  };
  const warnings = [
    ...(pairedTaskIds.length < Math.max(baselineTasks.size, specTasks.size) ? ["Some tasks are not represented in both conditions."] : []),
    ...(runs.length < pairedTaskIds.length * 6 ? ["Use at least three repetitions per task and condition; five is preferred."] : []),
    ...(specRuns.some(item => item.usedProjectSpec !== true) ? ["One or more treatment runs did not confirm that Project SPEC was consumed."] : [])
  ];
  return { baseline, projectSpec, delta, pairedTaskIds, warnings };
}

function summarizeRuns(runs: AgentRun[]): AgentConditionSummary {
  const retrieval = runs.filter(item => item.relevantIds.length > 0);
  const precision = retrieval.map(item => ratio(intersection(item.retrievedIds, item.relevantIds), new Set(item.retrievedIds).size)).filter(notNull);
  const recall = retrieval.map(item => ratio(intersection(item.retrievedIds, item.relevantIds), new Set(item.relevantIds).size)).filter(notNull);
  return {
    runs: runs.length, tasks: new Set(runs.map(item => item.taskId)).size,
    taskSuccessRate: mean(runs.map(item => Number(item.success))), buildPassRate: mean(runs.map(item => Number(item.buildPassed))),
    testPassRate: mean(runs.map(item => Number(item.testsPassed))), architectureComplianceRate: mean(runs.map(item => Number(item.architectureIssueCount === 0))),
    meanDurationMs: mean(runs.map(item => item.durationMs)), meanTokens: mean(runs.map(item => item.inputTokens + item.outputTokens)),
    meanFilesTouched: mean(runs.map(item => item.filesTouched)), meanRepairIterations: mean(runs.map(item => item.repairIterations)),
    retrievalPrecision: precision.length ? mean(precision) : null, retrievalRecall: recall.length ? mean(recall) : null
  };
}
function mean(values: number[]): number { return values.reduce((sum, item) => sum + item, 0) / values.length; }
function intersection(left: string[], right: string[]): number { const expected = new Set(right); return new Set(left.filter(item => expected.has(item))).size; }
function ratio(value: number, total: number): number | null { return total ? value / total : null; }
function notNull(value: number | null): value is number { return value !== null; }
