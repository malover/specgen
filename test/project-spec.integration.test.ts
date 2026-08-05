import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { extractCodeGraph } from "../src/codegraph-engine.js";
import { buildProjectSpec } from "../src/project-spec.js";

describe("ProjectSpec fixture integration", () => {
  it("extracts the existing two-module ArkTS fixture and builds its dependency view", async () => {
    const target = fs.mkdtempSync(path.join(os.tmpdir(), "project-spec-integration-"));
    fs.cpSync(path.resolve("test/fixtures/arkts-mini"), target, { recursive: true, filter: source => !source.includes(`${path.sep}.codegraph`) });
    let graph: Awaited<ReturnType<typeof extractCodeGraph>>["graph"] | undefined;
    try {
      const extracted = await extractCodeGraph("arkts-mini", target); graph = extracted.graph;
      const spec = buildProjectSpec(extracted.observation, target);
      expect(spec.modules.map(item => item.name).sort()).toEqual(["entry", "shared"]);
      expect(spec.interfaces.some(item => item.name === "sharedGreeting")).toBe(true);
      expect(spec.views.moduleDependencies.edges.some(edge => edge.source !== edge.target && edge.relationKinds.includes("imports"))).toBe(true);
      expect(spec.validation.status).toBe("valid");
    } finally { graph?.close(); fs.rmSync(target, { recursive: true, force: true }); }
  }, 20_000);
});
