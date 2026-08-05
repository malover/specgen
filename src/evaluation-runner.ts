import fs from "node:fs";
import path from "node:path";
import type { Observation, RepoConfig, SpikeConfig } from "./model.js";
import type { ProjectSpec, ArchitectureConstraint } from "./project-spec-schema.js";
import { ArchitectureConstraintSchema } from "./project-spec-schema.js";
import { ArchitectureMutationSchema, EvaluationGroundTruthSchema, type ArchitectureMutation, type EvaluationGroundTruth } from "./evaluation-schema.js";
import { evaluateProject } from "./evaluation.js";
import { generateArchitectureMutations } from "./architecture-check.js";
import { writeEvaluationReport } from "./evaluation-report.js";
import { readJson } from "./io.js";
import { writeJson } from "./io.js";
import { convertLegacyGroundTruth } from "./ground-truth.js";

export function evaluateRepositoryArtifacts(repo: RepoConfig, config: SpikeConfig, evaluationDirectory = "./evaluation"): void {
  const output = path.join(config.outputDirectory, repo.id);
  const observation = required<Observation>(path.join(output, "codegraph.observation.json"));
  const spec = required<ProjectSpec>(path.join(output, "project-spec", "project-spec.json"));
  const incremental = readJson<{ medianMs: number }>(path.join(output, "incremental.json"));
  const status = readJson<{ crashed: boolean }>(path.join(output, "run-status.json"));
  const groundTruth = optionalGroundTruth(repo.id, evaluationDirectory, output);
  const constraints = optionalArray<ArchitectureConstraint>(path.join(evaluationDirectory, "architecture", `${repo.id}.constraints.json`), value => ArchitectureConstraintSchema.parse(value));
  const configuredMutations = optionalArray<ArchitectureMutation>(path.join(evaluationDirectory, "architecture", `${repo.id}.mutations.json`), value => ArchitectureMutationSchema.parse(value));
  const evaluatedSpec = constraints.length ? { ...spec, constraints } : spec;
  const acceptedConstraintIds = new Set(evaluatedSpec.constraints.filter(item => item.status === "accepted").map(item => item.id));
  const reviewedMutations = configuredMutations.filter(item => acceptedConstraintIds.has(item.expectedConstraintId));
  const mutations = reviewedMutations.length ? reviewedMutations : generateArchitectureMutations(evaluatedSpec);
  const report = evaluateProject({
    observation, spec: evaluatedSpec, repositoryRoot: repo.path, groundTruth,
    incrementalMs: incremental?.medianMs, crashed: status?.crashed ?? false, mutations
  });
  writeEvaluationReport(output, report);
  console.log(`${repo.id}: structural ${(report.structuralScore * 100).toFixed(1)}%; overall ${report.compositeScore === null ? "not evaluated" : `${(report.compositeScore * 100).toFixed(1)}%`}; architecture recall ${format(report.architecture.issueRecall.value)}`);
}

function optionalGroundTruth(id: string, root: string, output: string): EvaluationGroundTruth | undefined {
  for (const file of [path.join(output, "evaluation-ground-truth.json"), path.join(root, "ground-truth", `${id}.json`)]) {
    const value = readJson<unknown>(file); if (value) return EvaluationGroundTruthSchema.parse(value);
  }
  const legacy = readJson<Observation>(path.join(output, "ground-truth.v2.json"));
  if (legacy?.review.status === "reviewed") {
    const converted = convertLegacyGroundTruth(legacy);
    const target = path.join(output, "evaluation-ground-truth.json");
    writeJson(target, converted);
    console.log(`${id}: reused reviewed ground-truth.v2.json as ${path.basename(target)}`);
    return converted;
  }
  return undefined;
}
function optionalArray<T>(file: string, parse: (value: unknown) => T): T[] {
  const value = readJson<unknown>(file); if (!value) return [];
  if (!Array.isArray(value)) throw new Error(`${file} must contain a JSON array.`);
  return value.map(parse);
}
function required<T>(file: string): T { const value = readJson<T>(file); if (!value) throw new Error(`Missing evaluation input: ${file}`); return value; }
function format(value: number | null): string { return value === null ? "not evaluated" : `${(value * 100).toFixed(1)}%`; }
