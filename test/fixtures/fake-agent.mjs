import fs from "node:fs";

const condition = process.env.SPECGEN_CONDITION;
fs.writeFileSync("agent-change.txt", condition ?? "unknown");
fs.writeFileSync(process.env.SPECGEN_RESULT_FILE, JSON.stringify({
  inputTokens: condition === "project-spec" ? 100 : 150,
  outputTokens: 20,
  repairIterations: condition === "project-spec" ? 0 : 1,
  retrievedIds: condition === "project-spec" ? ["module:entry"] : [],
  architectureIssueCount: 0,
  usedProjectSpec: condition === "project-spec"
}));
