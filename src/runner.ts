import fs from "node:fs";
import path from "node:path";
import type { Observation, RepoConfig, SpikeConfig } from "./model.js";
import { extractCodeGraph } from "./codegraph-engine.js";
import { extractTreeSitter } from "./tree-sitter-engine.js";
import { benchmarkIncremental } from "./incremental.js";
import { acceptance, agreement, calculateMetrics, summarize } from "./metrics.js";
import { createSampleManifest, groundTruthSeed, type SampleManifest } from "./sampling.js";
import { readJson, writeJson } from "./io.js";

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
    const truth = reviewedTruth(readJson<Observation>(path.join(output, "ground-truth.v2.json")));
    const codegraphMetrics = calculateMetrics(codegraph, truth, truth?.review.sampledFiles);
    const report = {
      schemaVersion: 2, repository: repo,
      groundTruthStatus: truth ? "reviewed" : "missing-or-unreviewed",
      codegraph: { metrics: codegraphMetrics, acceptance: acceptance(codegraphMetrics, incremental.medianMs, config.acceptance), summary: summarize(codegraph), diagnostics: codegraph.diagnostics },
      treeSitterArkts: { summary: summarize(tree), agreementWithCodeGraph: agreement(tree, codegraph, tree.candidateFiles), diagnostics: tree.diagnostics },
      incremental, sample: manifest, generatedAt: new Date().toISOString()
    };
    writeJson(path.join(output, "report.json"), report);
    console.log(`  Coverage: ${(codegraphMetrics.fileCoverage * 100).toFixed(1)}%; incremental median: ${incremental.medianMs.toFixed(1)} ms; sample: ${manifest.selectedFiles.length} files`);
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
  const report = {
    schemaVersion: 2, repository: repo, groundTruthStatus: truth ? "reviewed" : truthRaw ? "unreviewed" : "missing",
    codegraph: { metrics, acceptance: acceptance(metrics, incremental.medianMs, config.acceptance), summary: summarize(codegraph), diagnostics: codegraph.diagnostics },
    treeSitterArkts: { summary: summarize(tree), agreementWithCodeGraph: agreement(tree, codegraph, tree.candidateFiles), diagnostics: tree.diagnostics },
    incremental, sample: manifest, generatedAt: new Date().toISOString()
  };
  writeJson(path.join(output, "report.json"), report); console.log(`${repo.id}: ground truth ${report.groundTruthStatus}; ${JSON.stringify(report.codegraph.acceptance)}`);
}

function reviewedTruth(value?: Observation): Observation | undefined {
  return value?.schemaVersion === 2 && value.review.status === "reviewed" && !value.diagnostics.some(item => item.startsWith("UNREVIEWED SEED")) ? value : undefined;
}
