import fs from "node:fs";
import path from "node:path";
import type { Observation, RepoConfig, SpikeConfig } from "./model.js";
import { extractCodeGraph } from "./codegraph-engine.js";
import { extractTreeSitter } from "./tree-sitter-engine.js";
import { benchmarkIncremental } from "./incremental.js";
import { acceptance, agreement, calculateMetrics, summarize } from "./metrics.js";
import { createSampleManifest, groundTruthSeed, type SampleManifest } from "./sampling.js";
import { readJson, writeJson } from "./io.js";
import { buildProjectSpec } from "./project-spec.js";
import { writeProjectSpecArtifacts } from "./project-spec-artifacts.js";
import { queryProjectSpec, type DisclosureQuery } from "./project-spec-query.js";
import type { ProjectSpec } from "./project-spec-schema.js";

export async function runRepository(repo: RepoConfig, config: SpikeConfig): Promise<void> {
  const output = path.join(config.outputDirectory, repo.id); fs.mkdirSync(output, { recursive: true });
  console.log(`\n[${repo.size}] ${repo.id}: ${repo.path}`); let crashed = false;
  let openGraph: Awaited<ReturnType<typeof extractCodeGraph>>["graph"] | undefined;
  try {
    console.log("  Indexing all CodeGraph-supported languages...");
    const { observation: codegraph, graph } = await extractCodeGraph(repo.id, repo.path);
    openGraph = graph;
    writeJson(path.join(output, "codegraph.observation.json"), codegraph);
    console.log("  Parsing ArkTS independently with Tree-sitter...");
    const tree = await extractTreeSitter(repo.id, repo.path); writeJson(path.join(output, "tree-sitter.observation.json"), tree);
    console.log("  Measuring incremental CodeGraph sync...");
    const incremental = await benchmarkIncremental(graph, repo.path, config.incremental.trials, config.incremental.timeoutMs);
    writeJson(path.join(output, "incremental.json"), incremental);
    const manifest = createSampleManifest(repo, config, codegraph); writeJson(path.join(output, "sample-manifest.json"), manifest);
    console.log("  Building deterministic Project SPEC...");
    const projectSpec = buildProjectSpec(codegraph, repo.path);
    const projectSpecArtifacts = writeProjectSpecArtifacts(output, projectSpec);
    const truth = reviewedTruth(readJson<Observation>(path.join(output, "ground-truth.v2.json")));
    const codegraphMetrics = calculateMetrics(codegraph, truth, truth?.review.sampledFiles ?? manifest.selectedFiles);
    const topologyAgreement = agreement(tree, codegraph, tree.candidateFiles, false);
    const resolutionAwareAgreement = agreement(tree, codegraph, tree.candidateFiles, true);
    const report = {
      schemaVersion: 4, repository: repo,
      groundTruthStatus: truth ? "reviewed" : "missing-or-unreviewed",
      codegraph: { metrics: codegraphMetrics, acceptance: acceptance(codegraphMetrics, incremental.medianMs, config.acceptance), summary: summarize(codegraph), diagnostics: codegraph.diagnostics },
      treeSitterArkts: {
        summary: summarize(tree), topologyAgreementWithCodeGraph: topologyAgreement,
        resolutionAwareAgreementWithCodeGraph: resolutionAwareAgreement,
        agreementWithCodeGraph: resolutionAwareAgreement, diagnostics: tree.diagnostics
      },
      projectSpec: projectSpecArtifacts, incremental, sample: manifest, generatedAt: new Date().toISOString()
    };
    writeJson(path.join(output, "report.json"), report);
    console.log(`  Coverage: ${(codegraphMetrics.sourceFileCoverage * 100).toFixed(1)}% source / ${formatCoverage(codegraphMetrics.configurationFileCoverage)} configuration; incremental median: ${incremental.medianMs.toFixed(1)} ms; accuracy sample: ${manifest.selectedFiles.length} code + ${manifest.configurationFiles.length} config files`);
    if (!truth) console.log("  Accuracy pending: review the generated sampled ground truth.");
  } catch (error) {
    crashed = true; writeJson(path.join(output, "crash.json"), { repository: repo, error: error instanceof Error ? { message: error.message, stack: error.stack } : String(error) });
    console.error(`  FAILED: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    openGraph?.close();
  }
  writeJson(path.join(output, "run-status.json"), { crashed, completedAt: new Date().toISOString() });
}

export function initializeGroundTruth(repo: RepoConfig, config: SpikeConfig): void {
  const output = path.join(config.outputDirectory, repo.id); const target = path.join(output, "ground-truth.v2.json");
  if (fs.existsSync(target)) { console.log(`Kept existing ${target}`); return; }
  const observation = readJson<Observation>(path.join(output, "codegraph.observation.json"));
  const manifest = readJson<SampleManifest>(path.join(output, "sample-manifest.json"));
  if (!observation || !manifest) { console.log(`Skipped ${repo.id}: run indexing first`); return; }
  writeJson(target, groundTruthSeed(observation, manifest)); console.log(`Created sampled review seed ${target} (${manifest.selectedFiles.length} files)`);
}

export function evaluateExisting(repo: RepoConfig, config: SpikeConfig): void {
  const output = path.join(config.outputDirectory, repo.id);
  const truthRaw = readJson<Observation>(path.join(output, "ground-truth.v2.json"));
  const codegraph = readJson<Observation>(path.join(output, "codegraph.observation.json"));
  const tree = readJson<Observation>(path.join(output, "tree-sitter.observation.json"));
  const incremental = readJson<{ medianMs: number }>(path.join(output, "incremental.json"));
  const manifest = readJson<SampleManifest>(path.join(output, "sample-manifest.json"));
  if (!codegraph || !tree || !incremental || !manifest) { console.log(`Skipped ${repo.id}: missing run artifacts`); return; }
  const truth = reviewedTruth(truthRaw); const metrics = calculateMetrics(codegraph, truth, truth?.review.sampledFiles ?? manifest.selectedFiles);
  const projectSpec = buildProjectSpec(codegraph, repo.path); const projectSpecArtifacts = writeProjectSpecArtifacts(output, projectSpec);
  const topologyAgreement = agreement(tree, codegraph, tree.candidateFiles, false);
  const resolutionAwareAgreement = agreement(tree, codegraph, tree.candidateFiles, true);
  const report = {
    schemaVersion: 4, repository: repo, groundTruthStatus: truth ? "reviewed" : truthRaw ? "unreviewed" : "missing",
    codegraph: { metrics, acceptance: acceptance(metrics, incremental.medianMs, config.acceptance), summary: summarize(codegraph), diagnostics: codegraph.diagnostics },
    treeSitterArkts: {
      summary: summarize(tree), topologyAgreementWithCodeGraph: topologyAgreement,
      resolutionAwareAgreementWithCodeGraph: resolutionAwareAgreement,
      agreementWithCodeGraph: resolutionAwareAgreement, diagnostics: tree.diagnostics
    },
    projectSpec: projectSpecArtifacts, incremental, sample: manifest, generatedAt: new Date().toISOString()
  };
  writeJson(path.join(output, "report.json"), report); console.log(`${repo.id}: ground truth ${report.groundTruthStatus}; ${JSON.stringify(report.codegraph.acceptance)}`);
}

function formatCoverage(value: number | null): string { return value === null ? "n/a" : `${(value * 100).toFixed(1)}%`; }

export function generateProjectSpecExisting(repo: RepoConfig, config: SpikeConfig): void {
  const output = path.join(config.outputDirectory, repo.id);
  const observation = readJson<Observation>(path.join(output, "codegraph.observation.json"));
  if (!observation) throw new Error(`Missing CodeGraph observation for ${repo.id}; run indexing first.`);
  const summary = writeProjectSpecArtifacts(output, buildProjectSpec(observation, repo.path));
  console.log(`${repo.id}: Project SPEC ready at ${path.join(output, summary.directory)}`);
}

export function queryProjectSpecExisting(repo: RepoConfig, config: SpikeConfig, query: DisclosureQuery): unknown {
  const file = path.join(config.outputDirectory, repo.id, "project-spec", "project-spec.json");
  const spec = readJson<ProjectSpec>(file); if (!spec) throw new Error(`Missing Project SPEC for ${repo.id}; generate it first.`);
  return queryProjectSpec(spec, query);
}

function reviewedTruth(value?: Observation): Observation | undefined {
  return value?.schemaVersion === 2 && value.review.status === "reviewed" && !value.diagnostics.some(item => item.startsWith("UNREVIEWED SEED")) ? value : undefined;
}
