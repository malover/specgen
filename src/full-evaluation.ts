import fs from "node:fs";
import path from "node:path";
import type { EvaluationReport } from "./evaluation-schema.js";
import { evaluateRepositoryArtifacts } from "./evaluation-runner.js";
import { readJson, writeJson } from "./io.js";
import type { RepoConfig, SpikeConfig } from "./model.js";
import { runRepository } from "./runner.js";

export const FULL_EVALUATION_SCHEMA = "deveco.specgen-full-evaluation/v1" as const;

export interface FullEvaluationOptions {
  evaluationDirectory: string;
  independentOracle: boolean;
}

type StageStatus = "passed" | "failed" | "diagnostic";

interface StageResult {
  status: StageStatus;
  durationMs: number;
  detail: string;
}

export interface RepositoryFullEvaluation {
  id: string;
  size: RepoConfig["size"];
  sourceRoot: string;
  status: "passed" | "failed";
  stages: Record<string, StageResult>;
  metrics?: ReturnType<typeof compactMetrics>;
  acceptance?: EvaluationReport["acceptance"];
  artifacts: Record<string, string>;
  limitations: string[];
}

export interface FullEvaluationReport {
  schema: typeof FULL_EVALUATION_SCHEMA;
  generatedAt: string;
  configuration: {
    repositories: number;
    independentOracle: boolean;
  };
  executiveSummary: {
    repositoriesPassed: number;
    repositoriesFailed: number;
    minimumFileCoverage: number | null;
    meanStructuralScore: number | null;
    architectureCases: number;
    architectureCasesDetected: number;
    architectureIssueRecall: number | null;
    conclusion: string;
  };
  repositories: RepositoryFullEvaluation[];
  interpretation: string[];
}

export async function runFullEvaluation(config: SpikeConfig, options: FullEvaluationOptions): Promise<FullEvaluationReport> {
  const repositories: RepositoryFullEvaluation[] = [];
  const evaluationDirectory = path.resolve(options.evaluationDirectory);
  fs.mkdirSync(config.outputDirectory, { recursive: true });

  console.log("\nSpecGen full evaluation");
  console.log(`  Repositories: ${config.repositories.length}`);
  console.log(`  Independent parser oracle: ${options.independentOracle ? "enabled (diagnostic only)" : "disabled"}`);

  for (const [index, repo] of config.repositories.entries()) {
    console.log(`\n=== Repository ${index + 1}/${config.repositories.length}: ${repo.id} ===`);
    const result = await evaluateOne(repo, config, options, evaluationDirectory);
    repositories.push(result);
    console.log(`=== ${repo.id}: ${result.status.toUpperCase()} ===`);
  }

  const report = assembleFullEvaluationReport(repositories, options);
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
  evaluationDirectory: string
): Promise<RepositoryFullEvaluation> {
  const output = path.join(config.outputDirectory, repo.id);
  const stages: Record<string, StageResult> = {};
  const artifacts: Record<string, string> = { repositoryOutput: output };

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
      id: repo.id,
      size: repo.size,
      sourceRoot: repo.path,
      status: "failed",
      stages,
      artifacts,
      limitations: [message(error)]
    };
  }

  const qualityStarted = performance.now();
  try {
    const quality = evaluateRepositoryArtifacts(repo, config, evaluationDirectory, { independentOracle: options.independentOracle });
    const accepted = coreAcceptance(quality);
    stages.qualityAndMutations = {
      status: accepted ? "passed" : "failed",
      durationMs: performance.now() - qualityStarted,
      detail: `${quality.architecture.detected}/${quality.architecture.cases} introduced architecture violations detected; structural score ${percent(quality.structuralScore)}.`
    };
    artifacts.qualityReport = path.join(output, "evaluation-report.json");
    artifacts.qualityReportMarkdown = path.join(output, "evaluation-report.md");
    return {
      id: repo.id,
      size: repo.size,
      sourceRoot: repo.path,
      status: accepted ? "passed" : "failed",
      stages,
      metrics: compactMetrics(quality),
      acceptance: quality.acceptance,
      artifacts,
      limitations: evaluationLimitations(quality)
    };
  } catch (error) {
    stages.qualityAndMutations = failed(qualityStarted, error);
    return {
      id: repo.id,
      size: repo.size,
      sourceRoot: repo.path,
      status: "failed",
      stages,
      artifacts,
      limitations: [message(error)]
    };
  }
}

export function assembleFullEvaluationReport(
  repositories: RepositoryFullEvaluation[],
  options: FullEvaluationOptions
): FullEvaluationReport {
  const measured = repositories.filter(item => item.metrics);
  const fileCoverages = measured.flatMap(item => item.metrics?.fileCoverage === null ? [] : [item.metrics!.fileCoverage!]);
  const structuralScores = measured.flatMap(item => item.metrics ? [item.metrics.structuralScore] : []);
  const architectureCases = measured.reduce((sum, item) => sum + (item.metrics?.architectureCases ?? 0), 0);
  const architectureCasesDetected = measured.reduce((sum, item) => sum + (item.metrics?.architectureDetected ?? 0), 0);
  const repositoriesPassed = repositories.filter(item => item.status === "passed").length;
  const repositoriesFailed = repositories.filter(item => item.status === "failed").length;
  const conclusion = repositoriesFailed
    ? "Deterministic evaluation failed for one or more repositories. Inspect failed gates before claiming readiness."
    : "Deterministic indexing, Project SPEC generation, structural checks, incremental checks, and architecture-mutation evaluation passed for all repositories.";

  return {
    schema: FULL_EVALUATION_SCHEMA,
    generatedAt: new Date().toISOString(),
    configuration: {
      repositories: repositories.length,
      independentOracle: options.independentOracle
    },
    executiveSummary: {
      repositoriesPassed,
      repositoriesFailed,
      minimumFileCoverage: fileCoverages.length ? Math.min(...fileCoverages) : null,
      meanStructuralScore: structuralScores.length ? mean(structuralScores) : null,
      architectureCases,
      architectureCasesDetected,
      architectureIssueRecall: architectureCases ? architectureCasesDetected / architectureCases : null,
      conclusion
    },
    repositories,
    interpretation: [
      "Structural metrics are deterministic checks over CodeGraph and Project SPEC artifacts.",
      "Architecture recall is measured using deliberately introduced violations with known expected detections.",
      options.independentOracle
        ? "Independent Tree-sitter agreement is a diagnostic silver oracle, not contractual accuracy."
        : "Entity recall and edge precision require reviewed ground truth; they are not inferred from CodeGraph itself.",
      "Unavailable reviewed accuracy remains NOT EVALUATED and is never counted as a pass."
    ]
  };
}

export function fullEvaluationMarkdown(report: FullEvaluationReport): string {
  const summary = report.executiveSummary;
  const repoRows = report.repositories.map(item => {
    const metrics = item.metrics;
    return `| ${item.id} | ${item.size} | ${label(item.status)} | ${format(metrics?.fileCoverage)} | ${format(metrics?.evidenceValidity)} | ${format(metrics?.architectureRecall)} |`;
  }).join("\n");

  return `# SpecGen Full Evaluation\n\nGenerated: ${report.generatedAt}\n\n## Decision\n\n> ${summary.conclusion}\n\n` +
    `## Executive summary\n\n| Measure | Result |\n|---|---:|\n` +
    `| Repositories passed | ${summary.repositoriesPassed}/${report.configuration.repositories} |\n` +
    `| Repositories failed | ${summary.repositoriesFailed}/${report.configuration.repositories} |\n` +
    `| Minimum file coverage | ${format(summary.minimumFileCoverage)} |\n` +
    `| Mean structural score | ${format(summary.meanStructuralScore)} |\n` +
    `| Introduced architecture issues detected | ${summary.architectureCasesDetected}/${summary.architectureCases} (${format(summary.architectureIssueRecall)}) |\n\n` +
    `## Repository results\n\n| Repository | Size | Status | File coverage | Evidence validity | Mutation recall |\n|---|---|---|---:|---:|---:|\n${repoRows}\n\n` +
    `## What was actually measured\n\n${report.interpretation.map(item => `- ${item}`).join("\n")}\n\n` +
    `## Repository details\n\n${report.repositories.map(repositoryMarkdown).join("\n\n")}\n`;
}

function repositoryMarkdown(item: RepositoryFullEvaluation): string {
  const stages = Object.entries(item.stages)
    .map(([name, stage]) => `| ${humanize(name)} | ${label(stage.status)} | ${(stage.durationMs / 1000).toFixed(1)} s | ${stage.detail.replace(/\|/g, "\\|")} |`)
    .join("\n");
  const limitations = item.limitations.length
    ? item.limitations.map(value => `- ${value}`).join("\n")
    : "- None reported by the automated evaluator.";
  const artifacts = Object.entries(item.artifacts)
    .map(([name, value]) => `- ${humanize(name)}: \`${value}\``)
    .join("\n");
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

function evaluationLimitations(report: EvaluationReport): string[] {
  return [
    ...(report.accuracy.oracle === "human-reviewed" ? [] : ["Human-reviewed entity recall and edge precision are not available."]),
    ...(report.accuracy.oracle === "silver-tree-sitter-source-verified" ? ["Parser agreement is diagnostic and must not be reported as human accuracy."] : []),
    ...report.warnings
  ];
}

function passed(started: number, detail: string): StageResult {
  return { status: "passed", durationMs: performance.now() - started, detail };
}
function failed(started: number, error: unknown): StageResult {
  return { status: "failed", durationMs: performance.now() - started, detail: message(error) };
}
function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}
function format(value: number | null | undefined): string {
  return value === null || value === undefined ? "NOT EVALUATED" : percent(value);
}
function label(value: string): string {
  return value.replace(/-/g, " ").toUpperCase();
}
function humanize(value: string): string {
  return value.replace(/([A-Z])/g, " $1").replace(/^./, match => match.toUpperCase());
}
