import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { extractCodeGraph } from "../src/codegraph-engine.js";
import { buildProjectSpec } from "../src/project-spec.js";
import { generateAgentBenchmark, GeneratedAgentTaskSchema, verifyGeneratedAgentTask } from "../src/agent-benchmark.js";

describe("generated agent benchmark", () => {
  it("creates objective tasks and verifies their source-level outcome", async () => {
    const source = path.resolve("test/fixtures/arkts-mini"); const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "specgen-task-repo-")); const output = fs.mkdtempSync(path.join(os.tmpdir(), "specgen-task-output-"));
    fs.cpSync(source, workspace, { recursive: true, filter: item => !item.includes(`${path.sep}.codegraph`) });
    const extracted = await extractCodeGraph("generated-task-fixture", workspace);
    try {
      const spec = buildProjectSpec(extracted.observation, workspace); const specFile = path.join(output, "project-spec.json"); fs.writeFileSync(specFile, JSON.stringify(spec));
      const generated = generateAgentBenchmark(spec, workspace, specFile, output, 1);
      const task = GeneratedAgentTaskSchema.parse(JSON.parse(fs.readFileSync(generated.taskFiles[0], "utf8")));
      expect(verifyGeneratedAgentTask(task, workspace).passed).toBe(false);
      fs.appendFileSync(path.join(workspace, task.targetFile), `\n${task.signature} { ${task.expectedReturnExpression} }\n`);
      expect(verifyGeneratedAgentTask(task, workspace).passed).toBe(true);
    } finally { extracted.graph.close(); fs.rmSync(workspace, { recursive: true, force: true }); fs.rmSync(output, { recursive: true, force: true }); }
  }, 20_000);
});
