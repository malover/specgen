import { describe, expect, it } from "vitest";
import { agreement, calculateMetrics } from "../src/metrics.js";
import type { Observation } from "../src/model.js";

const observation = (engine: Observation["engine"], reviewed = false): Observation => ({
  schemaVersion: 2, engine, repository: "fixture", generatedAt: "now",
  candidateFiles: ["a.ets", "b.ets"], indexedFiles: ["a.ets"], diagnostics: [], timingsMs: {},
  review: { status: reviewed ? "reviewed" : "not-required", sampledFiles: ["a.ets"] },
  entities: [{ id: "1", kind: "class", name: "Page", qualifiedName: "a.ets::Page", filePath: "a.ets", language: "arkts", startLine: 1, endLine: 2, provenance: engine === "ground-truth" ? "manual" : "codegraph" }],
  relations: []
});

describe("metrics", () => {
  it("computes scores only from reviewed truth", () => {
    const pending = calculateMetrics(observation("codegraph"), observation("ground-truth"));
    expect(pending.entityRecall).toBeNull();
    const result = calculateMetrics(observation("codegraph"), observation("ground-truth", true));
    expect(result.fileCoverage).toBe(0.5);
    expect(result.sourceFileCoverage).toBe(0.5);
    expect(result.scope.coverage).toBe("complete-supported-file-set");
    expect(result.entityRecall).toBe(1);
    expect(result.entityPrecision).toBe(1);
  });

  it("reports topology and resolution-aware relation agreement separately", () => {
    const actual = observation("codegraph"); const reference = observation("tree-sitter");
    actual.relations = [{ id: "e1", kind: "calls", source: "1", target: "1", sourceName: "Page", targetName: "Page", filePath: "a.ets", resolution: "external", provenance: "codegraph" }];
    reference.relations = [{ ...actual.relations[0], id: "e2", resolution: "internal", provenance: "tree-sitter" }];
    expect(agreement(actual, reference, ["a.ets"], false).edgePrecision).toBe(1);
    expect(agreement(actual, reference, ["a.ets"], true).edgePrecision).toBe(0);
  });
});
