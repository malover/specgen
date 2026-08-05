import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runAgentExperiment, type AgentExperimentConfig } from "../src/agent-experiment.js";

describe("agent A/B experiment harness", () => {
  it("runs identical isolated workspaces under both conditions and compares them", async () => {
    const output = fs.mkdtempSync(path.join(os.tmpdir(), "specgen-agent-ab-"));
    const config: AgentExperimentConfig = {
      schema: "deveco.specgen-agent-experiment/v1", model: "fixed-test-model", repetitions: 1, outputDirectory: output,
      agent: { command: process.execPath, args: [path.resolve("test/fixtures/fake-agent.mjs")], timeoutMs: 10_000, env: {} },
      tasks: [{
        id: "fixture-change", repository: path.resolve("test/fixtures/arkts-mini"), prompt: "Make a fixture change.",
        projectSpecFile: path.resolve("evaluation/ground-truth/fixture-small.json"), relevantIds: ["module:entry"],
        verification: [{ purpose: "test", command: process.execPath, args: ["-e", "process.exit(0)"], timeoutMs: 10_000, env: {} }]
      }]
    };
    try {
      const result = await runAgentExperiment(config);
      expect(result.runs).toHaveLength(2);
      expect(result.runs.map(item => item.condition).sort()).toEqual(["baseline", "project-spec"]);
      expect(result.comparison.projectSpec.retrievalRecall).toBe(1);
      expect(fs.existsSync(path.join(output, "agent-comparison.json"))).toBe(true);
    } finally { fs.rmSync(output, { recursive: true, force: true }); }
  }, 20_000);
});
