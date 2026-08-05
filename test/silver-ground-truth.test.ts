import path from "node:path";
import { describe, expect, it } from "vitest";
import { extractCodeGraph } from "../src/codegraph-engine.js";
import { extractTreeSitter } from "../src/tree-sitter-engine.js";
import { generateSilverGroundTruth } from "../src/silver-ground-truth.js";

describe("automatic silver oracle", () => {
  it("creates source-verified ArkTS labels without human review", async () => {
    const root = path.resolve("test/fixtures/arkts-mini"); const codeGraph = await extractCodeGraph("fixture-silver", root);
    try {
      const tree = await extractTreeSitter("fixture-silver", root);
      const silver = generateSilverGroundTruth(codeGraph.observation, tree, root);
      expect(silver.oracle).toBe("silver-tree-sitter-source-verified");
      expect(silver.files.length).toBeGreaterThan(0);
      expect(silver.entities.length).toBeGreaterThan(0);
      expect(silver.entities.every(item => item.confidence === "high")).toBe(true);
    } finally { codeGraph.graph.close(); }
  }, 20_000);
});
