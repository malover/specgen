import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { compareAgentRuns } from "../src/agent-evaluation.js";

describe("agent usefulness evaluation", () => {
  it("compares baseline and Project SPEC conditions", () => {
    const runs = JSON.parse(fs.readFileSync("evaluation/examples/agent-runs.example.json", "utf8"));
    const result = compareAgentRuns(runs);
    expect(result.delta.taskSuccessRate).toBe(1);
    expect(result.delta.architectureComplianceRate).toBe(1);
    expect(result.projectSpec.retrievalRecall).toBe(1);
    expect(result.pairedTaskIds).toEqual(["add-settings-page"]);
  });
});
