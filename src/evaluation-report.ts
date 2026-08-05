import fs from "node:fs";
import path from "node:path";
import type { EvaluationReport, Score } from "./evaluation-schema.js";
import { writeJson } from "./io.js";

export function writeEvaluationReport(directory: string, report: EvaluationReport): { json: string; markdown: string } {
  const json = path.join(directory, "evaluation-report.json");
  const markdown = path.join(directory, "evaluation-report.md");
  writeJson(json, report);
  fs.writeFileSync(markdown, evaluationMarkdown(report));
  return { json: path.basename(json), markdown: path.basename(markdown) };
}

export function evaluationMarkdown(report: EvaluationReport): string {
  const rows: Array<[string, Score, string]> = [
    ["File coverage", report.structural.fileCoverage, ">= 95%"],
    ["Module ownership coverage", report.structural.moduleOwnershipCoverage, "informational"],
    ["Public API coverage", report.structural.publicApiCoverage, "informational"],
    ["Module dependency coverage", report.structural.moduleDependencyCoverage, "informational"],
    ["Public API relationship coverage", report.structural.publicInterfaceRelationshipCoverage, "informational"],
    ["Graph relationship integrity", report.structural.graphRelationshipIntegrity, "100%"],
    ["Call graph integrity", report.structural.callGraphIntegrity, "100%"],
    ["Top-level entity promotion rate", report.structural.entityPromotionRate, "informational"],
    ["Top-level relationship promotion rate", report.structural.relationshipPromotionRate, "informational"],
    ["Evidence validity", report.structural.evidenceValidity, ">= 98%"],
    ["Entity recall", report.accuracy.entityRecall, ">= 85%"],
    ["Edge precision", report.accuracy.edgePrecision, ">= 90%"],
    ["Architecture issue recall", report.architecture.issueRecall, ">= 75%"]
  ];
  const acceptance = Object.entries(report.acceptance).map(([name, value]) => `| ${name} | ${value === true ? "PASS" : value === false ? "FAIL" : "NOT EVALUATED"} |`).join("\n");
  return `# SpecGen Evaluation — ${report.repository}\n\n` +
    `Generated: ${report.generatedAt}\n\nStructural score: **${percent(report.structuralScore)}**\n\nOverall composite: **${report.compositeScore === null ? "not evaluated" : percent(report.compositeScore)}**\n\n` +
    `## Quality metrics\n\n| Metric | Score | Target |\n|---|---:|---:|\n${rows.map(([name, value, target]) => `| ${name} | ${format(value)} | ${target} |`).join("\n")}\n\n` +
    `## Performance\n\n- Incremental update: ${report.performance.incrementalMs === null ? "not evaluated" : `${report.performance.incrementalMs.toFixed(1)} ms`}\n- Crash free: ${report.performance.crashFree ? "yes" : "no"}\n\n` +
    `## Architecture mutation suite\n\n- Cases: ${report.architecture.cases}\n- Detected: ${report.architecture.detected}\n- False positives: ${report.architecture.falsePositives}\n\n` +
    `- False positives/KLOC: ${report.architecture.falsePositivesPerKloc.toFixed(2)}\n\n` +
    `## Acceptance\n\n| Check | Result |\n|---|---|\n${acceptance}\n\n` +
    (report.warnings.length ? `## Warnings\n\n${report.warnings.map(item => `- ${item}`).join("\n")}\n` : "");
}

function format(value: Score): string { return value.value === null ? "not evaluated" : percent(value.value); }
function percent(value: number): string { return `${(value * 100).toFixed(1)}%`; }
