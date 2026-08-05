import { describe, expect, it } from "vitest";
import { assembleFullEvaluationReport, fullEvaluationMarkdown, type FullEvaluationOptions, type RepositoryFullEvaluation } from "../src/full-evaluation.js";

const options: FullEvaluationOptions = {
  evaluationDirectory: "./evaluation", independentOracle: false,
  agentMode: "skip", agentTasks: 1, agentRepetitions: 3
};

function repository(status: RepositoryFullEvaluation["status"]): RepositoryFullEvaluation {
  return {
    id: "fixture", size: "small", sourceRoot: "/fixture", status,
    stages: {
      indexAndBuildSpec: { status: "passed", durationMs: 10, detail: "Indexed." },
      qualityAndMutations: { status: "passed", durationMs: 10, detail: "4/4 detected." },
      agentAB: { status: "skipped", durationMs: 0, detail: "Disabled." }
    },
    metrics: {
      structuralScore: 0.9, fileCoverage: 1, moduleOwnershipCoverage: 0.9,
      publicApiCoverage: 0.8, moduleDependencyCoverage: 0.8, evidenceValidity: 1,
      schemaValidity: 1, incrementalMs: 100, architectureCases: 4,
      architectureDetected: 4, architectureRecall: 1, accuracyOracle: "none",
      oracleCoverage: null, entityRecall: null, edgePrecision: null
    },
    acceptance: { fileCoverage: true }, agent: { status: "skipped", reason: "Disabled." },
    artifacts: { projectSpec: "/fixture/project-spec.json" },
    limitations: ["Human-reviewed accuracy is unavailable."]
  };
}

describe("full evaluation report", () => {
  it("keeps unevaluated agent results explicit and emits a readable summary", () => {
    const report = assembleFullEvaluationReport([repository("incomplete")], options);
    expect(report.executiveSummary.architectureIssueRecall).toBe(1);
    expect(report.executiveSummary.agentEvaluationStatus).toBe("not-evaluated");
    expect(report.executiveSummary.repositoriesIncomplete).toBe(1);
    const markdown = fullEvaluationMarkdown(report);
    expect(markdown).toContain("Introduced architecture issues detected");
    expect(markdown).toContain("**NOT EVALUATED.**");
    expect(markdown).toContain("A NOT EVALUATED result is not a pass.");
  });
});
