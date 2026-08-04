import { describe, expect, it } from "vitest";
import { calculateMetrics } from "../src/metrics.js";
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
    expect(result.fileCoverage).toBe(1);
    expect(result.entityRecall).toBe(1);
    expect(result.entityPrecision).toBe(1);
  });
});
