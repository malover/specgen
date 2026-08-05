import { describe, expect, it } from "vitest";
import { createSampleManifest } from "../src/sampling.js";
import type { Observation, RepoConfig, SpikeConfig } from "../src/model.js";

const repo: RepoConfig = { id: "fixture", size: "medium", path: "/fixture" };
const config: SpikeConfig = {
  repositories: [repo], outputDirectory: "./results",
  incremental: { trials: 1, timeoutMs: 1000 },
  sampling: { small: 0, medium: 2, large: 3, seed: "fixed" },
  acceptance: { fileCoverage: 0.95, entityRecall: 0.85, edgePrecision: 0.9, incrementalStalenessMs: 5000 }
};
const observation: Observation = {
  schemaVersion: 2, engine: "codegraph", repository: "fixture", generatedAt: "now",
  candidateFiles: ["src/a.ets", "src/b.ts", "OAT.xml", "config/settings.yaml"],
  indexedFiles: ["src/a.ets", "src/b.ts", "OAT.xml", "config/settings.yaml"],
  entities: [
    { id: "a", kind: "class", name: "A", qualifiedName: "A", filePath: "src/a.ets", language: "arkts", startLine: 1, endLine: 2, provenance: "codegraph" },
    { id: "b", kind: "function", name: "b", qualifiedName: "b", filePath: "src/b.ts", language: "typescript", startLine: 1, endLine: 2, provenance: "codegraph" }
  ],
  relations: [], diagnostics: [], timingsMs: {}, review: { status: "not-required", sampledFiles: [] }
};

describe("review sampling", () => {
  it("does not spend semantic accuracy slots on configuration files", () => {
    const manifest = createSampleManifest(repo, config, observation);
    expect(manifest.selectedFiles).toEqual(["src/a.ets", "src/b.ts"]);
    expect(manifest.configurationFiles).toEqual(["OAT.xml", "config/settings.yaml"]);
  });
});
