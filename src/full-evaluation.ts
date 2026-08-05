import fs from "node:fs";
import path from "node:path";
import type { AgentComparison } from "./agent-evaluation.js";
import { compareAgentRuns } from "./agent-evaluation.js";
import { generateAgentBenchmark } from "./agent-benchmark.js";
import { loadAgentExperiment, runAgentExperiment } from "./agent-experiment.js";
import type { AgentRun, EvaluationReport } from "./evaluation-schema.js";
import { evaluateRepositoryArtifacts } from "./evaluation-runner.js";
import { readJson, writeJson } from "./io.js";
import type { RepoConfig, SpikeConfig } from "./model.js";
import type { ProjectSpec } from "./project-spec-schema.js";
import { runRepository } from "./runner.js";

export const FULL_EVALUATION_SCHEMA = "deveco.specgen-full-evaluation/v1" as const;

export interface FullEvaluationOptions {
  evaluationDirectory: string;
  independentOracle: boolean;
  agentMode: "run" | "skip";
  agentTasks: number;
  agentRepetitions: number;
}

type StageStatus = "passed" | "failed" | "blocked" | "skipped" | "diagnostic";

interface StageResult {
  status: StageStatus;
  durationMs: number;
  detail: string;
}

interface AgentResult {
  status: StageStatus;
  reason?: string;
  experimentFile?: string;
  resultsDirectory?: string;
  runs?: number;
  comparison?: AgentComparison;
}

export interface RepositoryFullEvaluation {
  id: string;
  size: RepoConfig["size"];
  sourceRoot: string;
  status: "passed" | "failed" | "incomplete";
  stages: Record<string, StageResult>;
  metrics?: ReturnType<typeof compactMetrics>;
  acceptance?: EvaluationReport["acceptance"];
  agent: AgentResult;
  artifacts: Record<string, string>;
  limitations: string[];
}

export interface FullEvaluationReport {
  schema: typeof FULL_EVALUATION_SCHEMA;
  generatedAt: string;
  configuration: {
    repositories: number;
    independentOracle: boolean;
    agentMode: "run" | "skip";
    agentTasksPerRepository: number;
    agentRepetitions: number;
    model: string | null;
  };
  executiveSummary: {
    repositoriesPassed: number;
    repositoriesFailed: number;
    repositoriesIncomplete: number;
    minimumFileCoverage: number | null;
    meanStructuralScore: number | null;
    architectureCases: number;
    architectureCasesDetected: number;
    architectureIssueRecall: number | null;
    agentEvaluationStatus: "evaluated" | "not-evaluated";
    agentTaskSuccessDelta: number | null;
    conclusion: string;
  };
  repositories: RepositoryFullEvaluation[];
  aggregateAgentComparison?: AgentComparison;
  interpretation: string[];
}

export async function runFullEvaluation(config: SpikeConfig, options: FullEvaluationOptions): Promise<FullEvaluationReport> {
  const repositories: RepositoryFullEvaluation[] = [];
  const allAgentRuns: AgentRun[] = [];
  const evaluationDirectory = path.resolve(options.evaluationDirectory);
  fs.mkdirSync(config.outputDirectory, { recursive: true });

  console.log("\nSpecGen full evaluation");
  console.log(`  Repositories: ${config.repositories.length}`);
  console.log(`  Independent parser oracle: ${options.independentOracle ? "enabled (diagnostic only)" : "disabled"}`);
  console.log(`  Agent A/B: ${options.agentMode === "run" ? `${options.agentTasks} task(s), ${options.agentRepetitions} repetition(s)` : "skipped"}`);

  for (const [index, repo] of config.repositories.entries()) {
    console.log(`\n=== Repository ${index + 1}/${config.repositories.length}: ${repo.id} ===`);
    const result = await evaluateOne(repo, config, options, evaluationDirectory, allAgentRuns);
    repositories.push(result);
    console.log(`=== ${repo.id}: ${result.status.toUpperCase()} ===`);
  }

  const aggregateAgentComparison = allAgentRuns.length ? compareAgentRuns(allAgentRuns) : undefined;
  const report = assembleFullEvaluationReport(repositories, options, aggregateAgentComparison);
  const json = path.join(config.outputDirectory, "full-evaluation.json");
  const markdown = path.join(config.outputDirectory, "full-evaluation.md");
  writeJson(json, report);
  fs.writeFileSync(markdown, fullEvaluationMarkdown(report));
  console.log(`\nFull evaluation report:\n  ${markdown}\n  ${json}`);
  return report;
}

async function evaluateOne(
  repo: RepoConfig,
  config: SpikeConfig,
  options: FullEvaluationOptions,
  evaluationDirectory: string,
  allAgentRuns: AgentRun[]
): Promise<RepositoryFullEvaluation> {
  const output = path.join(config.outputDirectory, repo.id);
  const stages: Record<string, StageResult> = {};
  const artifacts: Record<string, string> = { repositoryOutput: output };
  let quality: EvaluationReport | undefined;

  const indexStarted = performance.now();
  try {
    await runRepository(repo, config, { independentOracle: options.independentOracle });
    const runStatus = readJson<{ crashed: boolean }>(path.join(output, "run-status.json"));
    if (!runStatus || runStatus.crashed) throw new Error("Repository indexing did not complete successfully; inspect crash.json.");
    stages.indexAndBuildSpec = passed(indexStarted, "CodeGraph index, incremental benchmark, and deterministic Project SPEC completed.");
    artifacts.codeGraphObservation = path.join(output, "codegraph.observation.json");
    artifacts.projectSpec = path.join(output, "project-spec", "project-spec.json");
    if (options.independentOracle) artifacts.independentOracle = path.join(output, "tree-sitter.observation.json");
  } catch (error) {
    stages.indexAndBuildSpec = failed(indexStarted, error);
    return {
      id: repo.id, size: repo.size, sourceRoot: repo.path, status: "failed", stages,
      agent: { status: "blocked", reason: "Indexing or Project SPEC generation failed." }, artifacts,
      limitations: [message(error)]
    };
  }

  const qualityStarted = performance.now();
  try {
    quality = evaluateRepositoryArtifacts(repo, config, evaluationDirectory, { independentOracle: options.independentOracle });
    const corePassed = coreAcceptance(quality);
    stages.qualityAndMutations = {
      status: corePassed ? "passed" : "failed", durationMs: performance.now() - qualityStarted,
      detail: `${quality.architecture.detected}/${quality.architecture.cases} introduced architecture violations detected; structural score ${percent(quality.structuralScore)}.`
    };
    artifacts.qualityReport = path.join(output, "evaluation-report.json");
    artifacts.qualityReportMarkdown = path.join(output, "evaluation-report.md");
  } catch (error) {
    stages.qualityAndMutations = failed(qualityStarted, error);
  }

  const agentStarted = performance.now();
  const agent = quality
    ? await evaluateAgent(repo, config, options, evaluationDirectory, allAgentRuns)
    : { status: "blocked" as const, reason: "Quality evaluation failed." };
  stages.agentAB = {
    status: agent.status,
    durationMs: performance.now() - agentStarted,
    detail: agent.reason ?? agentSummary(agent.comparison)
  };
  if (agent.experimentFile) artifacts.agentExperiment = agent.experimentFile;
  if (agent.resultsDirectory) artifacts.agentResults = agent.resultsDirectory;

  const limitations = quality ? evaluationLimitations(quality, agent) : ["Quality metrics are unavailable."];
  const coreFailed = !quality || !coreAcceptance(quality);
  const status = coreFailed || agent.status === "failed"
    ? "failed"
    : agent.status === "blocked" || agent.status === "skipped"
      ? "incomplete"
      : "passed";
  return {
    id: repo.id, size: repo.size, sourceRoot: repo.path, status, stages,
    metrics: quality ? compactMetrics(quality) : undefined,
    acceptance: quality?.acceptance, agent, artifacts, limitations
  };
}

async function evaluateAgent(
  repo: RepoConfig,
  config: SpikeConfig,
  options: FullEvaluationOptions,
  evaluationDirectory: string,
  allAgentRuns: AgentRun[]
): Promise<AgentResult> {
  if (options.agentMode === "skip") return { status: "skipped", reason: "Agent A/B was disabled with --skip-agent." };
  if (!process.env.OPENROUTER_API_KEY) return { status: "blocked", reason: "OPENROUTER_API_KEY is missing; agent A/B was not evaluated." };
  if (!process.env.OPENROUTER_MODEL) return { status: "blocked", reason: "OPENROUTER_MODEL is missing; agent A/B was not evaluated." };
  try {
    const projectSpecFile = path.join(config.outputDirectory, repo.id, "project-spec", "project-spec.json");
    const spec = required<ProjectSpec>(projectSpecFile);
    const generated = generateAgentBenchmark(spec, repo.path, projectSpecFile, evaluationDirectory, options.agentTasks);
    const experiment = loadAgentExperiment(generated.experimentFile);
    experiment.repetitions = options.agentRepetitions;
    const result = await runAgentExperiment(experiment);
    allAgentRuns.push(...result.runs);
    return {
      status: "passed", experimentFile: generated.experimentFile, resultsDirectory: result.outputDirectory,
      runs: result.runs.length, comparison: result.comparison
    };
  } catch (error) {
    return { status: "failed", reason: message(error) };
  }
}

export function assembleFullEvaluationReport(
  repositories: RepositoryFullEvaluation[],
  options: FullEvaluationOptions,
  aggregateAgentComparison?: AgentComparison
): FullEvaluationReport {
  const measured = repositories.filter(item => item.metrics);
  const fileCoverages = measured.flatMap(item => item.metrics?.fileCoverage === null ? [] : [item.metrics!.fileCoverage!]);
  const structuralScores = measured.flatMap(item => item.metrics ? [item.metrics.structuralScore] : []);
  const architectureCases = measured.reduce((sum, item) => sum + (item.metrics?.architectureCases ?? 0), 0);
  const architectureCasesDetected = measured.reduce((sum, item) => sum + (item.metrics?.architectureDetected ?? 0), 0);
  const repositoriesPassed = repositories.filter(item => item.status === "passed").length;
  const repositoriesFailed = repositories.filter(item => item.status === "failed").length;
  const repositoriesIncomplete = repositories.filter(item => item.status === "incomplete").length;
  const agentDelta = aggregateAgentComparison?.delta.taskSuccessRate ?? null;
  const conclusion = repositoriesFailed
    ? "Core evaluation failed for one or more repositories. Inspect failed gates before claiming readiness."
    : !aggregateAgentComparison
      ? "Core extraction and architecture checks completed, but agent benefit is not evaluated."
      : agentDelta !== null && agentDelta > 0
        ? "Core checks passed and Project SPEC improved agent task success in this benchmark."
        : "Core checks passed, but this benchmark did not demonstrate improved agent task success.";
  return {
    schema: FULL_EVALUATION_SCHEMA, generatedAt: new Date().toISOString(),
    configuration: {
      repositories: repositories.length, independentOracle: options.independentOracle,
      agentMode: options.agentMode, agentTasksPerRepository: options.agentTasks,
      agentRepetitions: options.agentRepetitions, model: process.env.OPENROUTER_MODEL ?? null
    },
    executiveSummary: {
      repositoriesPassed, repositoriesFailed, repositoriesIncomplete,
      minimumFileCoverage: fileCoverages.length ? Math.min(...fileCoverages) : null,
      meanStructuralScore: structuralScores.length ? mean(structuralScores) : null,
      architectureCases, architectureCasesDetected,
      architectureIssueRecall: architectureCases ? architectureCasesDetected / architectureCases : null,
      agentEvaluationStatus: aggregateAgentComparison ? "evaluated" : "not-evaluated",
      agentTaskSuccessDelta: agentDelta, conclusion
    },
    repositories, aggregateAgentComparison,
    interpretation: [
      "Structural metrics are deterministic checks over CodeGraph and Project SPEC artifacts.",
      "Architecture recall is measured using deliberately introduced violations with known expected detections.",
      "Agent A/B compares identical tasks and clean repository copies; only Project SPEC access changes between conditions.",
      options.independentOracle
        ? "Independent Tree-sitter agreement is a diagnostic silver oracle, not contractual accuracy."
        : "Entity recall and edge precision require reviewed ground truth; they are not inferred from CodeGraph itself.",
      "A NOT EVALUATED result is not a pass."
    ]
  };
}

export function fullEvaluationMarkdown(report: FullEvaluationReport): string {
  const summary = report.executiveSummary;
  const repoRows = report.repositories.map(item => {
    const metrics = item.metrics;
    return `| ${item.id} | ${item.size} | ${label(item.status)} | ${format(metrics?.fileCoverage)} | ${format(metrics?.evidenceValidity)} | ${format(metrics?.architectureRecall)} | ${label(item.agent.status)} |`;
  }).join("\n");
  const agent = report.aggregateAgentComparison;
  const agentSection = agent
    ? `## Agent A/B result\n\n| Metric | Baseline | Project SPEC | Delta |\n|---|---:|---:|---:|\n` +
      `| Task success | ${percent(agent.baseline.taskSuccessRate)} | ${percent(agent.projectSpec.taskSuccessRate)} | ${points(agent.delta.taskSuccessRate)} |\n` +
      `| Architecture compliance | ${percent(agent.baseline.architectureComplianceRate)} | ${percent(agent.projectSpec.architectureComplianceRate)} | ${points(agent.delta.architectureComplianceRate)} |\n` +
      `| Test pass rate | ${percent(agent.baseline.testPassRate)} | ${percent(agent.projectSpec.testPassRate)} | ${points(agent.delta.testPassRate)} |\n` +
      `| Mean tokens | ${agent.baseline.meanTokens.toFixed(0)} | ${agent.projectSpec.meanTokens.toFixed(0)} | ${numberDelta(agent.delta.meanTokens)} |\n\n` +
      (agent.warnings.length ? `Warnings:\n${agent.warnings.map(item => `- ${item}`).join("\n")}\n\n` : "")
    : "## Agent A/B result\n\n**NOT EVALUATED.** See each repository's reason below.\n\n";
  return `# SpecGen Full Evaluation\n\nGenerated: ${report.generatedAt}\n\n## Decision\n\n> ${summary.conclusion}\n\n` +
    `## Executive summary\n\n| Measure | Result |\n|---|---:|\n` +
    `| Repositories passed | ${summary.repositoriesPassed}/${report.configuration.repositories} |\n` +
    `| Repositories failed | ${summary.repositoriesFailed}/${report.configuration.repositories} |\n` +
    `| Repositories incomplete | ${summary.repositoriesIncomplete}/${report.configuration.repositories} |\n` +
    `| Minimum file coverage | ${format(summary.minimumFileCoverage)} |\n` +
    `| Mean structural score | ${format(summary.meanStructuralScore)} |\n` +
    `| Introduced architecture issues detected | ${summary.architectureCasesDetected}/${summary.architectureCases} (${format(summary.architectureIssueRecall)}) |\n` +
    `| Agent task-success delta | ${points(summary.agentTaskSuccessDelta)} |\n\n` +
    `## Repository results\n\n| Repository | Size | Core status | File coverage | Evidence validity | Mutation recall | Agent A/B |\n|---|---|---|---:|---:|---:|---|\n${repoRows}\n\n` +
    agentSection +
    `## What was actually measured\n\n${report.interpretation.map(item => `- ${item}`).join("\n")}\n\n` +
    `## Repository details\n\n${report.repositories.map(repositoryMarkdown).join("\n\n")}\n`;
}

function repositoryMarkdown(item: RepositoryFullEvaluation): string {
  const stages = Object.entries(item.stages).map(([name, stage]) => `| ${humanize(name)} | ${label(stage.status)} | ${(stage.durationMs / 1000).toFixed(1)} s | ${stage.detail.replace(/\|/g, "\\|")} |`).join("\n");
  const limitations = item.limitations.length ? item.limitations.map(value => `- ${value}`).join("\n") : "- None reported by the automated evaluator.";
  const artifacts = Object.entries(item.artifacts).map(([name, value]) => `- ${humanize(name)}: \`${value}\``).join("\n");
  return `### ${item.id}\n\n| Stage | Status | Time | Detail |\n|---|---|---:|---|\n${stages}\n\nLimitations:\n${limitations}\n\nArtifacts:\n${artifacts}`;
}

function compactMetrics(report: EvaluationReport) {
  return {
    structuralScore: report.structuralScore,
    fileCoverage: report.structural.fileCoverage.value,
    moduleOwnershipCoverage: report.structural.moduleOwnershipCoverage.value,
    publicApiCoverage: report.structural.publicApiCoverage.value,
    moduleDependencyCoverage: report.structural.moduleDependencyCoverage.value,
    evidenceValidity: report.structural.evidenceValidity.value,
    schemaValidity: report.structural.schemaValidity.value,
    incrementalMs: report.performance.incrementalMs,
    architectureCases: report.architecture.cases,
    architectureDetected: report.architecture.detected,
    architectureRecall: report.architecture.issueRecall.value,
    accuracyOracle: report.accuracy.oracle,
    oracleCoverage: report.accuracy.oracleCoverage,
    entityRecall: report.accuracy.entityRecall.value,
    edgePrecision: report.accuracy.edgePrecision.value
  };
}

function coreAcceptance(report: EvaluationReport): boolean {
  const required = ["fileCoverage", "evidenceValidity", "schemaValidity", "incrementalFreshness", "crashFree", "architectureIssueRecall"];
  return required.every(name => report.acceptance[name] === true);
}
function evaluationLimitations(report: EvaluationReport, agent: AgentResult): string[] {
  return [
    ...(report.accuracy.oracle === "human-reviewed" ? [] : ["Human-reviewed entity recall and edge precision are not available."]),
    ...(report.accuracy.oracle === "silver-tree-sitter-source-verified" ? ["Parser agreement is diagnostic and must not be reported as human accuracy."] : []),
    ...(agent.status === "passed" ? [] : [`Agent usefulness is ${agent.status}: ${agent.reason ?? "no reason supplied"}`]),
    ...report.warnings
  ];
}
function agentSummary(comparison?: AgentComparison): string {
  if (!comparison) return "Agent A/B did not produce a comparison.";
  return `Task success ${percent(comparison.baseline.taskSuccessRate)} baseline vs ${percent(comparison.projectSpec.taskSuccessRate)} with Project SPEC (${points(comparison.delta.taskSuccessRate)}).`;
}
function passed(started: number, detail: string): StageResult { return { status: "passed", durationMs: performance.now() - started, detail }; }
function failed(started: number, error: unknown): StageResult { return { status: "failed", durationMs: performance.now() - started, detail: message(error) }; }
function message(error: unknown): string { return error instanceof Error ? error.message : String(error); }
function required<T>(file: string): T { const value = readJson<T>(file); if (!value) throw new Error(`Missing required artifact: ${file}`); return value; }
function mean(values: number[]): number { return values.reduce((sum, value) => sum + value, 0) / values.length; }
function percent(value: number): string { return `${(value * 100).toFixed(1)}%`; }
function format(value: number | null | undefined): string { return value === null || value === undefined ? "NOT EVALUATED" : percent(value); }
function points(value: number | null | undefined): string { return value === null || value === undefined ? "NOT EVALUATED" : `${value >= 0 ? "+" : ""}${(value * 100).toFixed(1)} pp`; }
function numberDelta(value: number | null | undefined): string { return value === null || value === undefined ? "NOT EVALUATED" : `${value >= 0 ? "+" : ""}${value.toFixed(0)}`; }
function label(value: string): string { return value.replace(/-/g, " ").toUpperCase(); }
function humanize(value: string): string { return value.replace(/([A-Z])/g, " $1").replace(/^./, match => match.toUpperCase()); }
