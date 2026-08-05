import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { extractCodeGraph } from "../src/codegraph-engine.js";
import { buildProjectSpec } from "../src/project-spec.js";
import { evaluateProject } from "../src/evaluation.js";
import { ArchitectureConstraintSchema, type ProjectSpec } from "../src/project-spec-schema.js";
import { ArchitectureMutationSchema, EvaluationGroundTruthSchema } from "../src/evaluation-schema.js";
import { architectureReviewSeed } from "../src/architecture-evaluation.js";

const fixtureRoot = path.resolve("test/fixtures/arkts-mini");

describe("client evaluation layers", () => {
  it("scores structural quality, reviewed ground truth and seeded architecture issues", async () => {
    const extracted = await extractCodeGraph("fixture-small", fixtureRoot);
    try {
      const spec = buildProjectSpec(extracted.observation, fixtureRoot);
      const constraints = JSON.parse(fs.readFileSync("evaluation/architecture/fixture-small.constraints.json", "utf8")).map((item: unknown) => ArchitectureConstraintSchema.parse(item));
      const mutations = JSON.parse(fs.readFileSync("evaluation/architecture/fixture-small.mutations.json", "utf8")).map((item: unknown) => ArchitectureMutationSchema.parse(item));
      const truth = EvaluationGroundTruthSchema.parse(JSON.parse(fs.readFileSync("evaluation/ground-truth/fixture-small.json", "utf8")));
      const evaluatedSpec: ProjectSpec = { ...spec, constraints };
      const reviewSeed = architectureReviewSeed(spec);
      expect(reviewSeed.constraints.every(item => item.status === "candidate")).toBe(true);
      expect(reviewSeed.constraints.length).toBeGreaterThan(0);
      const report = evaluateProject({ observation: extracted.observation, spec: evaluatedSpec, repositoryRoot: fixtureRoot, groundTruth: truth, incrementalMs: 50, mutations });
      expect(report.structural.fileCoverage.value).toBe(1);
      expect(report.structural.evidenceValidity.value).toBe(1);
      expect(report.accuracy.entityRecall.value).toBe(1);
      expect(report.accuracy.interfaceRecall.value).toBe(1);
      expect(report.architecture.issueRecall.value).toBe(1);
      expect(report.acceptance.architectureIssueRecall).toBe(true);
      const incomplete = evaluateProject({ observation: extracted.observation, spec, repositoryRoot: fixtureRoot, incrementalMs: 50 });
      expect(incomplete.compositeScore).toBeNull();
      expect(incomplete.compositeStatus).toBe("not-evaluated");
    } finally { extracted.graph.close(); }
  }, 20_000);
});
