import type { EvidenceReference, InterfaceSpec, ModuleSpec, ProjectSpec } from "./project-spec-schema.js";

export type DisclosureQuery =
  | { level: "project" }
  | { level: "module"; id: string }
  | { level: "interface"; id: string }
  | { level: "evidence"; id: string };

export type DisclosureResult =
  | { level: "project"; project: ReturnType<typeof projectIndex> }
  | { level: "module"; module: ModuleSpec; interfaces: InterfaceSpec[]; architectureEdges: ProjectSpec["views"]["moduleDependencies"]["edges"] }
  | { level: "interface"; interface: InterfaceSpec; module: Pick<ModuleSpec, "id" | "name" | "root"> }
  | { level: "evidence"; entityId: string; references: EvidenceReference[] };

export function queryProjectSpec(spec: ProjectSpec, query: DisclosureQuery): DisclosureResult {
  if (query.level === "project") return { level: "project", project: projectIndex(spec) };
  if (query.level === "module") {
    const module = resolve(spec.modules, query.id); if (!module) throw new Error(`Unknown module: ${query.id}`);
    return {
      level: "module", module,
      interfaces: spec.interfaces.filter(item => item.moduleId === module.id),
      architectureEdges: spec.views.moduleDependencies.edges.filter(edge => edge.source === module.id || edge.target === module.id)
    };
  }
  if (query.level === "interface") {
    const interfaceSpec = resolve(spec.interfaces, query.id); if (!interfaceSpec) throw new Error(`Unknown interface: ${query.id}`);
    const module = spec.modules.find(item => item.id === interfaceSpec.moduleId); if (!module) throw new Error(`Interface module is missing: ${interfaceSpec.moduleId}`);
    return { level: "interface", interface: interfaceSpec, module: { id: module.id, name: module.name, root: module.root } };
  }
  return { level: "evidence", entityId: query.id, references: spec.evidenceIndex[query.id] ?? [] };
}

export function projectIndex(spec: ProjectSpec) {
  return {
    schema: spec.schema, specVersion: spec.specVersion, repository: spec.repository,
    modules: spec.modules.map(module => ({
      id: module.id, name: module.name, root: module.root, files: module.files.length,
      interfaces: module.interfaceIds.length, dependencies: module.dependencies.length,
      responsibilityStatus: module.responsibilityStatus
    })),
    constraints: spec.constraints.map(item => ({ id: item.id, name: item.name, status: item.status, severity: item.severity })),
    coverage: spec.coverage,
    links: {
      module: "query { level: 'module', id: '<module id or name>' }",
      interface: "query { level: 'interface', id: '<interface id, name, or qualified name>' }",
      evidence: "query { level: 'evidence', id: '<entity id>' }"
    }
  };
}

function resolve<T extends { id: string; name: string; qualifiedName?: string }>(items: T[], id: string): T | undefined {
  const exact = items.find(item => item.id === id || item.name === id || item.qualifiedName === id);
  if (exact) return exact;
  const normalized = id.toLowerCase();
  const matches = items.filter(item => item.name.toLowerCase() === normalized || item.qualifiedName?.toLowerCase() === normalized);
  if (matches.length > 1) throw new Error(`Ambiguous identifier '${id}': ${matches.map(item => item.id).join(", ")}`);
  return matches[0];
}
