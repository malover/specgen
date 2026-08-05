import { describe, expect, it } from "vitest";
import type { Observation } from "../src/model.js";
import { convertLegacyGroundTruth } from "../src/ground-truth.js";

describe("legacy reviewed ground truth conversion", () => {
  it("reuses reviewed v2 observations without treating unreviewed seeds as truth", () => {
    const observation: Observation = {
      schemaVersion: 2, engine: "ground-truth", repository: "fixture", generatedAt: "2026-08-05T00:00:00.000Z",
      candidateFiles: ["a.ets"], indexedFiles: ["a.ets"], diagnostics: [], timingsMs: {},
      review: { status: "reviewed", sampledFiles: ["a.ets"], reviewer: "reviewer", reviewedAt: "2026-08-05T00:00:00.000Z" },
      entities: [{ id: "f", kind: "function", name: "run", qualifiedName: "run", filePath: "a.ets", language: "arkts", startLine: 1, endLine: 2, metadata: { exported: true }, provenance: "manual" }],
      relations: []
    };
    const converted = convertLegacyGroundTruth(observation);
    expect(converted.entities).toHaveLength(1);
    expect(converted.interfaceEntities[0].name).toBe("run");
    expect(() => convertLegacyGroundTruth({ ...observation, diagnostics: ["UNREVIEWED SEED"] })).toThrow(/unreviewed/i);
  });
});
