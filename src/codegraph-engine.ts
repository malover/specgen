import path from "node:path";
import { createRequire } from "node:module";
import type { CodeGraph as CodeGraphType, Edge, FileRecord, Language, Node, NodeKind } from "@colbymchenry/codegraph";
import type { Entity, Observation, Relation, RelationKind, Resolution } from "./model.js";
import { normalize, stableId, supportedSourceFiles } from "./files.js";
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

  const relationMap = new Map<string, Relation>();
  for (const node of nodes) {
    for (const edge of graph.getOutgoingEdges(node.id)) {
      ensureEndpoint(edge.source, nodes, entities);
      ensureEndpoint(edge.target, nodes, entities);
      const relation = fromEdge(edge, entities);
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

  const indexedFiles = indexedRecords.map((file: FileRecord) => normalize(file.path)).sort();
  const diagnostics = graphDiagnostics(candidateFiles, indexedFiles, [...entities.values()], [...relationMap.values()]);
  return {
    graph,
    observation: {
      schemaVersion: 2, engine: "codegraph", repository, generatedAt: new Date().toISOString(),
      candidateFiles, indexedFiles, entities: [...entities.values()], relations: [...relationMap.values()],
      diagnostics, timingsMs: { total: performance.now() - started, fullIndex: indexMs },
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

function fromEdge(edge: Edge, entities: Map<string, Entity>): Relation {
  const source = entities.get(edge.source)!; const target = entities.get(edge.target)!;
  const resolution: Resolution = !target.filePath ? "external" : target.provenance === "synthetic" && target.kind === "external_symbol" ? "unresolved" : "internal";
  return withId({
    kind: edge.kind as RelationKind, source: edge.source, target: edge.target,
    sourceName: source.qualifiedName, targetName: target.qualifiedName,
    filePath: source.filePath || undefined, resolution, provenance: "codegraph"
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

function graphDiagnostics(candidate: string[], indexed: string[], entities: Entity[], relations: Relation[]): string[] {
  const diagnostics: string[] = [];
  const indexedSet = new Set(indexed);
  const ids = new Set(entities.map(entity => entity.id));
  const missingFiles = candidate.filter(file => !indexedSet.has(file));
  if (missingFiles.length) diagnostics.push(`${missingFiles.length} supported source file(s) were not indexed: ${missingFiles.slice(0, 10).join(", ")}`);
  const orphanEdges = relations.filter(edge => !ids.has(edge.source) || !ids.has(edge.target));
  if (orphanEdges.length) diagnostics.push(`${orphanEdges.length} relation(s) have missing endpoints`);
  const filesWithSymbols = new Set(entities.filter(entity => entity.kind !== "file" && entity.filePath).map(entity => entity.filePath));
  const zeroEntity = indexed.filter(file => !filesWithSymbols.has(file));
  if (zeroEntity.length) diagnostics.push(`${zeroEntity.length} indexed source file(s) produced zero symbols: ${zeroEntity.slice(0, 10).join(", ")}`);
  return diagnostics;
}
