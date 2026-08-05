import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import type { CodeGraph as CodeGraphType, Edge, FileRecord, Language, Node, NodeKind } from "@colbymchenry/codegraph";
import type { DiagnosticDetails, Entity, Observation, Relation, RelationKind, Resolution } from "./model.js";
import { classifyFileRole, normalize, stableId, supportedSourceFiles } from "./files.js";
import { discoverProjectStructure } from "./project-profile.js";
import { withId } from "./relations.js";

const require = createRequire(import.meta.url);
const sdk = require("@colbymchenry/codegraph") as {
  CodeGraph: typeof CodeGraphType;
  NODE_KINDS: readonly NodeKind[];
};

export async function extractCodeGraph(repository: string, repoPath: string): Promise<{ observation: Observation; graph: CodeGraphType }> {
  const candidateFiles = await supportedSourceFiles(repoPath);
  const started = performance.now();
  const graph = sdk.CodeGraph.isInitialized(repoPath)
    ? await sdk.CodeGraph.open(repoPath, { sync: false })
    : await sdk.CodeGraph.init(repoPath);
  const indexStarted = performance.now();
  await graph.indexAll();
  const indexMs = performance.now() - indexStarted;
  const nodes: Node[] = sdk.NODE_KINDS.flatMap(kind => graph.getNodesByKind(kind));
  const entities = new Map<string, Entity>();
  for (const node of nodes) entities.set(node.id, fromNode(node));

  const repositoryId = `repository:${stableId(repoPath)}`;
  entities.set(repositoryId, {
    id: repositoryId, kind: "repository", name: repository, qualifiedName: repository,
    filePath: "", language: "mixed", startLine: 0, endLine: 0, provenance: "synthetic"
  });

  const indexedRecords = graph.getFiles();
  for (const record of indexedRecords) ensureFileEntity(record, entities);
  const indexedFiles = indexedRecords.map((file: FileRecord) => normalize(file.path)).sort();
  const indexedFileSet = new Set(indexedFiles);

  const relationMap = new Map<string, Relation>();
  for (const node of nodes) {
    for (const edge of graph.getOutgoingEdges(node.id)) {
      ensureEndpoint(edge.source, nodes, entities);
      ensureEndpoint(edge.target, nodes, entities);
      const relation = fromEdge(edge, entities, indexedFileSet);
      relationMap.set(relation.id, relation);
    }
  }

  for (const entity of entities.values()) {
    if (entity.kind !== "file") continue;
    addRelation(relationMap, {
      kind: "contains", source: repositoryId, target: entity.id,
      sourceName: repository, targetName: entity.qualifiedName, filePath: entity.filePath,
      resolution: "internal", provenance: "synthetic"
    });
  }

  const structure = discoverProjectStructure(repoPath, repositoryId, repository, [...entities.values()]);
  for (const entity of structure.entities) entities.set(entity.id, entity);
  for (const relation of structure.relations) addRelation(relationMap, relation);

  const diagnosticDetails = graphDiagnostics(repoPath, candidateFiles, indexedRecords, [...entities.values()], [...relationMap.values()]);
  const diagnostics = diagnosticMessages(diagnosticDetails);
  const fileRoles = Object.fromEntries(candidateFiles.map(file => [file, classifyFileRole(file)]));
  return {
    graph,
    observation: {
      schemaVersion: 2, engine: "codegraph", repository, generatedAt: new Date().toISOString(),
      candidateFiles, indexedFiles, fileRoles, entities: [...entities.values()], relations: [...relationMap.values()],
      diagnostics, diagnosticDetails, timingsMs: { total: performance.now() - started, fullIndex: indexMs },
      review: { status: "not-required", sampledFiles: [] }
    }
  };
}

function fromNode(node: Node): Entity {
  const isArkUiComponent = node.language === "arkts" && (node.kind === "struct" || node.kind === "class") &&
    (node.decorators ?? []).some(value => ["Component", "ComponentV2", "Entry"].includes(value.replace(/^@/, "")));
  return {
    id: node.id, kind: isArkUiComponent ? "component" : node.kind, nativeKind: node.kind, name: node.name,
    qualifiedName: node.qualifiedName, filePath: normalize(node.filePath), language: node.language,
    startLine: node.startLine, endLine: node.endLine, decorators: node.decorators,
    metadata: compact({ signature: node.signature, visibility: node.visibility, exported: node.isExported }),
    provenance: "codegraph"
  };
}

function ensureFileEntity(record: FileRecord, entities: Map<string, Entity>): void {
  const filePath = normalize(record.path);
  const existing = [...entities.values()].find(entity => entity.kind === "file" && entity.filePath === filePath);
  if (existing) return;
  const id = `file:${stableId(filePath)}`;
  entities.set(id, {
    id, kind: "file", name: path.posix.basename(filePath), qualifiedName: filePath, filePath,
    language: record.language as Language, startLine: 1, endLine: 1, provenance: "synthetic"
  });
}

function ensureEndpoint(id: string, nodes: Node[], entities: Map<string, Entity>): void {
  if (entities.has(id)) return;
  const node = nodes.find(candidate => candidate.id === id);
  if (node) { entities.set(id, fromNode(node)); return; }
  entities.set(id, {
    id, kind: "external_symbol", name: id, qualifiedName: id, filePath: "",
    language: "none", startLine: 0, endLine: 0, provenance: "synthetic"
  });
}

export function classifyResolution(kind: RelationKind, target: Entity, indexedFiles: Set<string>): Resolution {
  // CodeGraph represents an unresolved/external import as an `import` node located
  // in the importing file. Its filePath is therefore not proof of internal resolution.
  if (target.kind === "import" || target.kind === "external_symbol") {
    return kind === "imports" || target.kind === "import" ? "external" : "unresolved";
  }
  if (target.filePath && indexedFiles.has(normalize(target.filePath))) return "internal";
  if (target.filePath) return "external";
  return ["imports", "extends", "implements", "type_of", "returns"].includes(kind) ? "external" : "unresolved";
}

function fromEdge(edge: Edge, entities: Map<string, Entity>, indexedFiles: Set<string>): Relation {
  const source = entities.get(edge.source)!; const target = entities.get(edge.target)!;
  const resolution = classifyResolution(edge.kind as RelationKind, target, indexedFiles);
  return withId({
    kind: edge.kind as RelationKind, source: edge.source, target: edge.target,
    sourceName: source.qualifiedName, targetName: target.qualifiedName,
    filePath: source.filePath || undefined, resolution,
    metadata: compact({ ...edge.metadata, line: edge.line, column: edge.column, codegraphProvenance: edge.provenance }),
    provenance: "codegraph"
  });
}

function addRelation(target: Map<string, Relation>, relation: Omit<Relation, "id"> | Relation): void {
  const complete = "id" in relation ? relation : withId(relation);
  target.set(complete.id, complete);
}

function compact(value: Record<string, unknown>): Record<string, unknown> | undefined {
  const entries = Object.entries(value).filter(([, item]) => item !== undefined);
  return entries.length ? Object.fromEntries(entries) : undefined;
}

function graphDiagnostics(repoPath: string, candidate: string[], records: FileRecord[], entities: Entity[], relations: Relation[]): DiagnosticDetails {
  const indexed = records.map(record => normalize(record.path));
  const indexedSet = new Set(indexed);
  const ids = new Set(entities.map(entity => entity.id));
  const missingFiles = candidate.filter(file => !indexedSet.has(file));
  const orphanEdges = relations.filter(edge => !ids.has(edge.source) || !ids.has(edge.target));
  const filesWithSymbols = new Set(entities.filter(entity => entity.kind !== "file" && entity.filePath).map(entity => entity.filePath));
  const zeroEntity = indexed.filter(file => !filesWithSymbols.has(file));
  const parserFailures = records.flatMap(record => {
    const errors = (record.errors ?? []).filter(error => error.severity === "error").map(error => error.message);
    return errors.length ? [{ file: normalize(record.path), errors }] : [];
  });
  const parserFailureFiles = new Set(parserFailures.map(item => item.file));
  const expectedZeroSymbolFiles = zeroEntity.filter(file => isExpectedZeroSymbol(repoPath, file));
  const expectedZeroSymbolSet = new Set(expectedZeroSymbolFiles);
  const actionableZeroSymbolFiles = zeroEntity.filter(file => !expectedZeroSymbolSet.has(file) && !parserFailureFiles.has(file));
  const filesByRole = { source: [], test: [], "build-tooling": [], configuration: [] } as DiagnosticDetails["filesByRole"];
  for (const file of candidate) filesByRole[classifyFileRole(file)].push(file);
  return {
    filesByRole, missingIndexedFiles: missingFiles, parserFailures,
    actionableZeroSymbolFiles, expectedZeroSymbolFiles,
    orphanRelationIds: orphanEdges.map(edge => edge.id)
  };
}

function isExpectedZeroSymbol(repoPath: string, file: string): boolean {
  const role = classifyFileRole(file);
  if (role === "configuration" || role === "build-tooling") return true;
  try {
    const content = fs.readFileSync(path.join(repoPath, file), "utf8");
    const withoutComments = content.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").trim();
    if (!withoutComments) return true;
    const basename = path.posix.basename(file).toLowerCase();
    if (/^index\.(?:[cm]?[jt]sx?|ets)$/.test(basename) && /\bexport\b/.test(withoutComments) &&
        !/\b(class|struct|interface|function|enum|namespace)\b|@(?:Entry|Component|ComponentV2)\b/.test(withoutComments)) return true;
  } catch { /* unreadable files remain actionable */ }
  return false;
}

function diagnosticMessages(details: DiagnosticDetails): string[] {
  const diagnostics: string[] = [];
  if (details.missingIndexedFiles.length) diagnostics.push(`${details.missingIndexedFiles.length} supported file(s) were not indexed: ${details.missingIndexedFiles.slice(0, 10).join(", ")}`);
  if (details.parserFailures.length) diagnostics.push(`${details.parserFailures.length} file(s) reported parser errors: ${details.parserFailures.slice(0, 10).map(item => item.file).join(", ")}`);
  if (details.orphanRelationIds.length) diagnostics.push(`${details.orphanRelationIds.length} relation(s) have missing endpoints`);
  if (details.actionableZeroSymbolFiles.length) diagnostics.push(`${details.actionableZeroSymbolFiles.length} code or tooling file(s) produced zero symbols and require review: ${details.actionableZeroSymbolFiles.slice(0, 10).join(", ")}`);
  if (details.expectedZeroSymbolFiles.length) diagnostics.push(`${details.expectedZeroSymbolFiles.length} configuration, build-tooling, empty, or barrel file(s) produced zero symbols (informational): ${details.expectedZeroSymbolFiles.slice(0, 10).join(", ")}`);
  return diagnostics;
}
