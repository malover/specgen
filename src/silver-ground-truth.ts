import fs from "node:fs";
import path from "node:path";
import type { Observation } from "./model.js";
import { EvaluationGroundTruthSchema, type EvaluationGroundTruth } from "./evaluation-schema.js";

const evaluatedKinds = new Set(["module", "package", "class", "struct", "interface", "function", "method", "component", "enum", "type_alias"]);
const comparableRelationKinds = new Set(["calls", "imports", "exports", "extends", "implements", "instantiates", "references", "type_of", "returns"]);

export function generateSilverGroundTruth(codeGraph: Observation, treeSitter: Observation, repositoryRoot: string): EvaluationGroundTruth {
  const comparableFiles = treeSitter.indexedFiles.filter(file => codeGraph.candidateFiles.includes(file));
  const fileSet = new Set(comparableFiles); const sources = new Map<string, string>();
  for (const file of comparableFiles) {
    const absolute = path.join(repositoryRoot, file); if (fs.existsSync(absolute)) sources.set(file, fs.readFileSync(absolute, "utf8"));
  }
  const entities = treeSitter.entities.filter(item => fileSet.has(item.filePath) && evaluatedKinds.has(item.kind)).flatMap(item => {
    const source = sources.get(item.filePath); if (!source || !sourceSupportsEntity(source, item.name, item.startLine, item.endLine)) return [];
    return [{ kind: item.kind, filePath: item.filePath, name: item.name, confidence: "high" as const, engines: ["tree-sitter", "source-verifier"] }];
  });
  const relations = treeSitter.relations.filter(item => item.filePath && fileSet.has(item.filePath) && comparableRelationKinds.has(item.kind)).flatMap(item => {
    const source = sources.get(item.filePath!); if (!source || !sourceSupportsRelation(source, item.sourceName, item.targetName)) return [];
    return [{ kind: item.kind, sourceName: item.sourceName, targetName: item.targetName, filePath: item.filePath!, confidence: "high" as const, engines: ["tree-sitter", "source-verifier"] }];
  });
  const entityByKey = new Map(treeSitter.entities.map(item => [`${item.kind}|${item.filePath}|${item.name}`, item]));
  const interfaceEntities = entities.filter(item => {
    const entity = entityByKey.get(`${item.kind}|${item.filePath}|${item.name}`);
    return item.kind === "interface" || item.kind === "component" || entity?.metadata?.exported === true || entity?.metadata?.visibility === "public";
  });
  return EvaluationGroundTruthSchema.parse({
    schema: "deveco.specgen-ground-truth/v1", repository: codeGraph.repository,
    oracle: "silver-tree-sitter-source-verified",
    oracleCoverage: codeGraph.candidateFiles.length ? comparableFiles.length / codeGraph.candidateFiles.length : 1,
    reviewedBy: "automatic Tree-sitter and source verifier", reviewedAt: new Date().toISOString(),
    files: comparableFiles, entities, relations, interfaceEntities,
    notes: [
      "Automatic silver oracle: independent Tree-sitter labels retained only when their source locations/names are verifiable.",
      "This measures parser agreement on the comparable language subset and is not a substitute for repository-owner architectural intent."
    ]
  });
}

function sourceSupportsEntity(source: string, name: string, startLine: number, endLine: number): boolean {
  const lines = source.split(/\r?\n/); const local = lines.slice(Math.max(0, startLine - 2), Math.min(lines.length, endLine + 1)).join("\n");
  return tokenPresent(local, name) || tokenPresent(source, name);
}
function sourceSupportsRelation(source: string, sourceName: string, targetName: string): boolean {
  const target = endpoint(targetName); const origin = endpoint(sourceName);
  return tokenPresent(source, target) && (origin.includes("/") || tokenPresent(source, origin));
}
function endpoint(value: string): string { const part = value.split("::").at(-1) ?? value; return part.split("/").at(-1)?.replace(/\.[^.]+$/, "") ?? part; }
function tokenPresent(source: string, value: string): boolean {
  const token = value.match(/[A-Za-z_$][\w$]*/)?.[0]; return Boolean(token && new RegExp(`\\b${escape(token)}\\b`).test(source));
}
function escape(value: string): string { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
