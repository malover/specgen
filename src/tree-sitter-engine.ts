import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { Parser, Language, type Node as SyntaxNode } from "web-tree-sitter";
import type { Entity, EntityKind, Observation, Relation } from "./model.js";
import { arktsFiles, stableId } from "./files.js";

const require = createRequire(import.meta.url);
const declarations: Record<string, EntityKind> = {
  class_declaration: "class", struct_declaration: "struct", interface_declaration: "interface",
  function_declaration: "function", method_definition: "method", method_signature: "method",
  function_signature: "function", import_statement: "import", import_declaration: "import",
  namespace_declaration: "namespace", module_declaration: "module", type_alias_declaration: "type_alias",
  enum_declaration: "enum"
};

export async function extractTreeSitter(repository: string, repoPath: string): Promise<Observation> {
  const started = performance.now();
  const files = await arktsFiles(repoPath);
  await Parser.init();
  const parser = new Parser(); parser.setLanguage(await Language.load(findArktsGrammar()));
  const entities = new Map<string, Entity>(); const relations = new Map<string, Relation>(); const diagnostics: string[] = [];
  const repositoryId = `tree:repository:${stableId(repoPath)}`;
  entities.set(repositoryId, { id: repositoryId, kind: "repository", name: repository, qualifiedName: repository, filePath: "", language: "mixed", startLine: 0, endLine: 0, provenance: "tree-sitter" });
  for (const relative of files) {
    const fileId = `tree:file:${stableId(relative)}`;
    entities.set(fileId, { id: fileId, kind: "file", name: path.posix.basename(relative), qualifiedName: relative, filePath: relative, language: "arkts", startLine: 1, endLine: 1, provenance: "tree-sitter" });
    addRelation(relations, "contains", repositoryId, fileId, repository, relative, relative, "internal");
    const source = fs.readFileSync(path.join(repoPath, relative), "utf8");
    const tree = parser.parse(source);
    if (!tree) { diagnostics.push(`${relative}: parser returned no tree`); continue; }
    walk(tree.rootNode, fileId, relative, source, entities, relations);
    if (tree.rootNode.hasError) diagnostics.push(`${relative}: syntax tree contains ERROR/MISSING nodes`);
    tree.delete();
  }
  resolveForwardCalls(entities, relations);
  parser.delete();
  return {
    schemaVersion: 2, engine: "tree-sitter", repository, generatedAt: new Date().toISOString(),
    candidateFiles: files, indexedFiles: files, entities: [...entities.values()], relations: [...relations.values()], diagnostics,
    timingsMs: { total: performance.now() - started }, review: { status: "not-required", sampledFiles: [] }
  };
}

function walk(node: SyntaxNode, ownerId: string, filePath: string, source: string, entities: Map<string, Entity>, relations: Map<string, Relation>): void {
  let currentOwnerId = ownerId;
  const kind = classify(node, source);
  if (kind) {
    const nameNode = node.childForFieldName("name");
    const name = nameNode?.text ?? importName(node, source) ?? `<anonymous@${node.startPosition.row + 1}>`;
    const id = `tree:${stableId(`${filePath}:${node.startIndex}:${kind}`)}`;
    const owner = entities.get(ownerId)!;
    const entity: Entity = {
      id, kind, nativeKind: node.type, name, qualifiedName: `${filePath}::${owner.kind === "file" ? "" : `${owner.name}.`}${name}`,
      filePath, language: "arkts", startLine: node.startPosition.row + 1, endLine: node.endPosition.row + 1,
      decorators: decorators(node), provenance: "tree-sitter"
    };
    entities.set(id, entity); addRelation(relations, "contains", ownerId, id, owner.qualifiedName, entity.qualifiedName, filePath, "internal");
    if (kind === "import") {
      const externalId = ensureExternal(name, entities);
      addRelation(relations, "imports", entitiesForFile(filePath, entities), externalId, filePath, name, filePath, "external");
    }
    currentOwnerId = entity.id;
  }
  const owner = entities.get(currentOwnerId)!;
  if (node.type === "call_expression" || node.type === "new_expression") {
    const targetName = node.childForFieldName("function")?.text ?? node.childForFieldName("constructor")?.text;
    if (targetName && !["file", "repository", "import"].includes(owner.kind)) {
      const target = [...entities.values()].find(entity => entity.name === targetName || entity.qualifiedName.endsWith(`.${targetName}`));
      const targetId = target?.id ?? ensureExternal(targetName, entities);
      addRelation(relations, "calls", owner.id, targetId, owner.qualifiedName, targetName, filePath, target ? "internal" : "unresolved");
    }
  }
  for (const child of node.namedChildren) if (child) walk(child, currentOwnerId, filePath, source, entities, relations);
}

function classify(node: SyntaxNode, source: string): EntityKind | undefined {
  if (node.type === "struct_declaration") {
    const markers = decorators(node) ?? [];
    if (markers.some(value => ["Component", "ComponentV2", "Entry"].includes(value)) || /@(Component|ComponentV2|Entry)\b/.test(node.text.slice(0, 300))) return "component";
  }
  return declarations[node.type];
}
function importName(node: SyntaxNode, source: string): string | undefined {
  const text = source.slice(node.startIndex, node.endIndex);
  return text.match(/from\s+["']([^"']+)["']/)?.[1] ?? text.match(/import\s+["']([^"']+)["']/)?.[1];
}
function decorators(node: SyntaxNode): string[] | undefined {
  const values: string[] = []; let sibling = node.previousNamedSibling;
  while (sibling?.type.includes("decorator")) { values.unshift(sibling.text.replace(/^@/, "")); sibling = sibling.previousNamedSibling; }
  values.push(...node.namedChildren.filter((child): child is SyntaxNode => child !== null && child.type.includes("decorator")).map(child => child.text.replace(/^@/, "")));
  return values.length ? values : undefined;
}
function resolveForwardCalls(entities: Map<string, Entity>, relations: Map<string, Relation>): void {
  for (const edge of [...relations.values()]) {
    if (edge.kind !== "calls" || edge.resolution !== "unresolved") continue;
    const resolved = [...entities.values()].find(entity => entity.filePath && (entity.name === edge.targetName || entity.qualifiedName.endsWith(`.${edge.targetName}`)));
    if (!resolved) continue;
    relations.delete(edge.id);
    const id = `tree:edge:${stableId(`${edge.kind}|${edge.source}|${resolved.id}`)}`;
    relations.set(id, { ...edge, id, target: resolved.id, targetName: resolved.qualifiedName, resolution: "internal" });
  }
}
function ensureExternal(name: string, entities: Map<string, Entity>): string {
  const id = `tree:external:${stableId(name)}`;
  if (!entities.has(id)) entities.set(id, { id, kind: "external_symbol", name, qualifiedName: name, filePath: "", language: "none", startLine: 0, endLine: 0, provenance: "tree-sitter" });
  return id;
}
function entitiesForFile(filePath: string, entities: Map<string, Entity>): string {
  return [...entities.values()].find(entity => entity.kind === "file" && entity.filePath === filePath)!.id;
}
function addRelation(target: Map<string, Relation>, kind: Relation["kind"], source: string, destination: string, sourceName: string, targetName: string, filePath: string, resolution: Relation["resolution"]): void {
  const id = `tree:edge:${stableId(`${kind}|${source}|${destination}`)}`;
  target.set(id, { id, kind, source, target: destination, sourceName, targetName, filePath, resolution, provenance: "tree-sitter" });
}
function findArktsGrammar(): string {
  const packageRoot = path.dirname(require.resolve("@colbymchenry/codegraph/package.json"));
  const scopeRoot = path.dirname(packageRoot); const platform = fs.readdirSync(scopeRoot).find(name => name.startsWith("codegraph-") && name !== "codegraph");
  for (const root of [packageRoot, ...(platform ? [path.join(scopeRoot, platform)] : [])]) { const found = findFile(root, /(?:tree-sitter-)?arkts\.wasm$/i); if (found) return found; }
  throw new Error("Could not find CodeGraph's ArkTS WASM grammar. Ensure optional platform dependencies were installed.");
}
function findFile(root: string, pattern: RegExp): string | undefined {
  const pending = [root]; while (pending.length) { const current = pending.pop()!; for (const entry of fs.readdirSync(current, { withFileTypes: true })) { const full = path.join(current, entry.name); if (entry.isDirectory()) pending.push(full); else if (pattern.test(entry.name)) return full; } }
  return undefined;
}
