import { describe, expect, it } from "vitest";
import { assembleFullEvaluationReport, fullEvaluationMarkdown, type FullEvaluationOptions, type RepositoryFullEvaluation } from "../src/full-evaluation.js";

const options: FullEvaluationOptions = {
  evaluationDirectory: "./evaluation",
  independentOracle: false
};

function repository(status: RepositoryFullEvaluation["status"]): RepositoryFullEvaluation {
  return {
    id: "fixture",
    size: "small",
    sourceRoot: "/fixture",
    status,
    stages: {
      indexAndBuildSpec: { status: "passed", durationMs: 10, detail: "Indexed." },
      qualityAndMutations: { status: "passed", durationMs: 10, detail: "4/4 detected." }
    },
    metrics: {
      structuralScore: 0.9,
      fileCoverage: 1,
      moduleOwnershipCoverage: 0.9,
      publicApiCoverage: 0.8,
      moduleDependencyCoverage: 0.8,
      evidenceValidity: 1,
      schemaValidity: 1,
      incrementalMs: 100,
      architectureCases: 4,
      architectureDetected: 4,
      architectureRecall: 1,
      accuracyOracle: "none",
      oracleCoverage: null,
      entityRecall: null,
      edgePrecision: null
    },
    acceptance: { fileCoverage: true },
    artifacts: { projectSpec: "/fixture/project-spec.json" },
    limitations: ["Human-reviewed accuracy is unavailable."]
  };
}

describe("full evaluation report", () => {
  it("emits a deterministic consolidated summary", () => {
    const report = assembleFullEvaluationReport([repository("passed")], options);
    expect(report.executiveSummary.architectureIssueRecall).toBe(1);
    expect(report.executiveSummary.repositoriesPassed).toBe(1);
    expect(report.executiveSummary.repositoriesFailed).toBe(0);
    const markdown = fullEvaluationMarkdown(report);
    expect(markdown).toContain("Introduced architecture issues detected");
    expect(markdown).toContain("Unavailable reviewed accuracy remains NOT EVALUATED");
    expect(markdown).not.toContain("Agent A/B");
  });
});
