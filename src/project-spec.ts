import path from "node:path";
import type { Entity, Observation, Relation } from "./model.js";
import { normalize, stableId } from "./files.js";
import {
  PROJECT_SPEC_SCHEMA, ProjectSpecSchema,
  type ArchitectureConstraint, type ArchitectureView, type CoverageLedger,
  type EvidenceReference, type InterfaceSpec, type ModuleSpec, type OperationSpec, type ProjectSpec
} from "./project-spec-schema.js";

interface ModuleDescriptor { id: string; entity?: Entity; name: string; root: string; manifest?: string; ecosystem?: string }
interface ModuleContext { descriptor: ModuleDescriptor; files: string[] }
const dependencyKinds = new Set(["imports", "calls", "references", "instantiates", "extends", "implements", "type_of", "returns", "bridges_to"]);

export function buildProjectSpec(observation: Observation, repositoryRoot: string): ProjectSpec {
  const generatedAt = new Date().toISOString();
  const entityById = new Map(observation.entities.map(entity => [entity.id, entity]));
  const descriptors = discoverSpecModules(observation);
  const ownerByFile = assignFileOwners(observation.indexedFiles, descriptors);
  const moduleContexts = descriptors.map(descriptor => ({ descriptor, files: observation.indexedFiles.filter(file => ownerByFile.get(file) === descriptor.id) }));
  const interfaces = buildInterfaces(observation, descriptors, ownerByFile);
  const moduleSpecs = buildModules(observation, moduleContexts, interfaces, ownerByFile, entityById);
  const constraints = defaultConstraintCandidates();
  const coverage = buildCoverage(observation, moduleSpecs, interfaces, generatedAt);
  const moduleDependencies = buildModuleDependencyView(moduleSpecs, generatedAt);
  const evidenceIndex = buildEvidenceIndex(moduleSpecs, interfaces, constraints);
  const candidate: ProjectSpec = {
    schema: PROJECT_SPEC_SCHEMA, specVersion: "1.0.0", generatedAt,
    repository: { id: observation.repository, root: normalize(repositoryRoot), observationSchemaVersion: observation.schemaVersion },
    modules: moduleSpecs, interfaces, constraints, coverage, views: { moduleDependencies }, evidenceIndex,
    validation: { status: "valid", issues: [] }
  };
  const parsed = ProjectSpecSchema.safeParse(candidate);
  if (parsed.success) return parsed.data;
  const issues = parsed.error.issues.map(issue => `${issue.path.join(".")}: ${issue.message}`);
  return ProjectSpecSchema.parse({ ...candidate, validation: { status: "invalid", issues } });
}

function discoverSpecModules(observation: Observation): ModuleDescriptor[] {
  const explicit = observation.entities.filter(entity => entity.kind === "module").map(entity => ({
    id: `module-spec:${stableId(entity.id)}`, entity, name: entity.name,
    root: typeof entity.metadata?.root === "string" ? normalize(entity.metadata.root) : moduleRootFromManifest(entity.filePath),
    manifest: typeof entity.metadata?.manifest === "string" ? entity.metadata.manifest : entity.filePath || undefined,
    ecosystem: typeof entity.metadata?.ecosystem === "string" ? entity.metadata.ecosystem : undefined
  }));
  const descriptors: ModuleDescriptor[] = explicit.length ? explicit : observation.entities.filter(entity => entity.kind === "package").map(entity => ({
    id: `module-spec:${stableId(entity.id)}`, entity, name: entity.name,
    root: path.posix.dirname(entity.filePath) === "." ? "" : path.posix.dirname(entity.filePath),
    manifest: entity.filePath || undefined, ecosystem: "package"
  }));
  const owned = new Set<string>();
  for (const file of observation.indexedFiles) if (bestModule(file, descriptors)) owned.add(file);
  if (!descriptors.length || owned.size < observation.indexedFiles.length) descriptors.push({
    id: `module-spec:${stableId(`${observation.repository}:repository-root`)}`, name: "Repository Root", root: "", ecosystem: "repository"
  });
  return uniqueBy(descriptors, item => item.id).sort((left, right) => left.root.localeCompare(right.root) || left.name.localeCompare(right.name));
}

function assignFileOwners(files: string[], descriptors: ModuleDescriptor[]): Map<string, string> {
  const result = new Map<string, string>();
  for (const file of files) {
    const owner = bestModule(file, descriptors);
    if (owner) result.set(file, owner.id);
  }
  return result;
}

function bestModule(file: string, descriptors: ModuleDescriptor[]): ModuleDescriptor | undefined {
  const matches = descriptors.filter(module => module.root && (file === module.root || file.startsWith(`${module.root}/`))).sort((a, b) => b.root.length - a.root.length);
  return matches[0] ?? descriptors.find(module => !module.root);
}

function buildInterfaces(observation: Observation, modules: ModuleDescriptor[], ownerByFile: Map<string, string>): InterfaceSpec[] {
  const entityById = new Map(observation.entities.map(entity => [entity.id, entity]));
  const containedBy = new Map<string, Entity[]>();
  for (const relation of observation.relations.filter(edge => edge.kind === "contains")) {
    const target = entityById.get(relation.target); if (!target) continue;
    containedBy.set(relation.source, [...(containedBy.get(relation.source) ?? []), target]);
  }
  const candidates = observation.entities.filter(isInterfaceCandidate);
  return candidates.flatMap(entity => {
    const moduleId = ownerByFile.get(entity.filePath) ?? bestModule(entity.filePath, modules)?.id;
    if (!moduleId || !entity.filePath) return [];
    const children = (containedBy.get(entity.id) ?? []).filter(child => child.kind === "method" || child.kind === "function");
    const operationEntities = entity.kind === "function" ? [entity] : children;
    const operations = operationEntities.map(operationFromEntity);
    return [{
      id: `interface-spec:${stableId(entity.id)}`, entityId: entity.id, moduleId,
      name: entity.name, qualifiedName: entity.qualifiedName, kind: interfaceKind(entity), scope: interfaceScope(entity),
      operations, preconditions: [], postconditions: [], exceptions: [], contractStatus: "structural-only" as const,
      evidence: [evidenceForEntity(entity)]
    }];
  }).sort((left, right) => left.moduleId.localeCompare(right.moduleId) || left.qualifiedName.localeCompare(right.qualifiedName));
}

function buildModules(observation: Observation, contexts: ModuleContext[], interfaces: InterfaceSpec[], ownerByFile: Map<string, string>, entityById: Map<string, Entity>): ModuleSpec[] {
  const byModule = new Map(contexts.map(context => [context.descriptor.id, context]));
  const aggregated = new Map<string, { targetId: string; targetName: string; resolution: Relation["resolution"]; kinds: Set<string>; count: number; evidence: EvidenceReference[] }>();
  for (const relation of observation.relations) {
    if (!dependencyKinds.has(relation.kind)) continue;
    const sourceEntity = entityById.get(relation.source); const targetEntity = entityById.get(relation.target);
    const sourceModule = sourceEntity?.filePath ? ownerByFile.get(sourceEntity.filePath) : undefined;
    if (!sourceModule) continue;
    const targetModule = relation.resolution === "internal" && targetEntity?.filePath ? ownerByFile.get(targetEntity.filePath) : undefined;
    if (targetModule === sourceModule) continue;
    const targetId = targetModule ?? (relation.resolution === "unresolved" ? "unresolved-dependencies" : "external-dependencies");
    const targetName = targetModule ? byModule.get(targetModule)?.descriptor.name ?? targetModule : relation.resolution === "unresolved" ? "Unresolved Dependencies" : "External Dependencies";
    const key = `${sourceModule}|${targetId}|${relation.resolution}`;
    const current = aggregated.get(key) ?? { targetId, targetName, resolution: relation.resolution, kinds: new Set(), count: 0, evidence: [] };
    current.kinds.add(relation.kind); current.count++;
    if (current.evidence.length < 5 && sourceEntity) current.evidence.push(evidenceForRelation(relation, sourceEntity));
    aggregated.set(key, current);
  }
  return contexts.map(({ descriptor, files }) => {
    const languageCounts: Record<string, number> = {};
    for (const file of files) {
      const language = observation.entities.find(entity => entity.kind === "file" && entity.filePath === file)?.language ?? "unknown";
      languageCounts[language] = (languageCounts[language] ?? 0) + 1;
    }
    const dependencies = [...aggregated.entries()].filter(([key]) => key.startsWith(`${descriptor.id}|`)).map(([, value]) => ({
      targetId: value.targetId, targetName: value.targetName, resolution: value.resolution,
      relationKinds: [...value.kinds].sort(), count: value.count, evidence: uniqueEvidence(value.evidence)
    })).sort((left, right) => left.targetName.localeCompare(right.targetName));
    return {
      id: descriptor.id, entityId: descriptor.entity?.id, name: descriptor.name, root: descriptor.root,
      manifest: descriptor.manifest, ecosystem: descriptor.ecosystem, responsibilities: [], responsibilityStatus: "not-established" as const,
      files, languages: languageCounts,
      interfaceIds: interfaces.filter(item => item.moduleId === descriptor.id).map(item => item.id), dependencies,
      evidence: descriptor.entity ? [evidenceForEntity(descriptor.entity)] : []
    };
  });
}

function buildCoverage(observation: Observation, modules: ModuleSpec[], interfaces: InterfaceSpec[], generatedAt: string): CoverageLedger {
  const operations = interfaces.flatMap(item => item.operations);
  const dimensions = [
    dimension("module-inventory", "structural", modules.map(item => item.id), modules.filter(item => item.files.length > 0).map(item => item.id), "A module is covered when it owns at least one indexed file."),
    dimension("interface-inventory", "structural", interfaces.map(item => item.id), interfaces.filter(item => item.evidence.length > 0).map(item => item.id), "An interface/API is covered when it has a source-backed SPEC record."),
    dimension("api-signatures", "structural", operations.map(item => item.id), operations.filter(item => item.signature).map(item => item.id), "An operation is covered when CodeGraph provides a signature."),
    dimension("source-evidence", "structural", [...modules.map(item => item.id), ...interfaces.map(item => item.id)], [...modules.filter(item => item.evidence.length > 0 || item.files.length > 0).map(item => item.id), ...interfaces.filter(item => item.evidence.length > 0).map(item => item.id)], "A record is covered when it is traceable to a manifest, source entity, or owned indexed files."),
    dimension("module-responsibilities", "semantic", modules.map(item => item.id), modules.filter(item => item.responsibilityStatus !== "not-established").map(item => item.id), "A module has reviewed or evidence-grounded semantic responsibilities."),
    dimension("interface-contracts", "semantic", interfaces.map(item => item.id), interfaces.filter(item => item.contractStatus === "reviewed").map(item => item.id), "An interface has reviewed conditions, errors, and behavioral contract details.")
  ];
  return {
    structuralCoverage: weightedRatio(dimensions.filter(item => item.scope === "structural")),
    semanticCompleteness: weightedRatio(dimensions.filter(item => item.scope === "semantic")), dimensions, generatedAt
  };
}

function buildModuleDependencyView(modules: ModuleSpec[], generatedAt: string): ArchitectureView {
  const hasExternal = modules.some(module => module.dependencies.some(item => item.resolution === "external"));
  const hasUnresolved = modules.some(module => module.dependencies.some(item => item.resolution === "unresolved"));
  const nodes: ArchitectureView["nodes"] = modules.map(module => ({ id: module.id, label: module.name, kind: "module", metadata: { root: module.root, files: module.files.length } }));
  if (hasExternal) nodes.push({ id: "external-dependencies", label: "External Dependencies", kind: "external" });
  if (hasUnresolved) nodes.push({ id: "unresolved-dependencies", label: "Unresolved Dependencies", kind: "external" });
  const edges = modules.flatMap(module => module.dependencies.map(dependency => ({
    id: `view-edge:${stableId(`${module.id}|${dependency.targetId}`)}`, source: module.id, target: dependency.targetId,
    label: dependency.relationKinds.join(", "), relationKinds: dependency.relationKinds, count: dependency.count
  })));
  return { id: "view:module-dependencies", name: "Module Dependency Architecture", type: "module-dependency", nodes, edges, generatedAt };
}

function defaultConstraintCandidates(): ArchitectureConstraint[] {
  return [{
    id: "constraint:dependencies-must-resolve", name: "Dependencies must resolve",
    description: "Module dependencies should resolve to another project module or be represented as an explicit external dependency.",
    severity: "warning", status: "candidate", effect: "forbid", sourceSelector: { entityKinds: ["module"] },
    relationKinds: [...dependencyKinds].sort(), targetSelector: { resolution: "unresolved" },
    provenance: "deterministic", confidence: 1, evidence: []
  }];
}

function operationFromEntity(entity: Entity): OperationSpec {
  const signature = typeof entity.metadata?.signature === "string" ? entity.metadata.signature : undefined;
  const parsed = parseSignature(signature);
  return {
    id: `operation-spec:${stableId(entity.id)}`, entityId: entity.id, name: entity.name, signature,
    parameters: parsed.parameters, returnType: parsed.returnType,
    preconditions: [], postconditions: [], exceptions: [], contractStatus: "structural-only", evidence: [evidenceForEntity(entity)]
  };
}

export function parseSignature(signature?: string): { parameters: Array<{ name: string; type?: string; optional: boolean }>; returnType?: string } {
  if (!signature) return { parameters: [] };
  const open = signature.indexOf("("); const close = matchingParen(signature, open);
  if (open < 0 || close < 0) return { parameters: [] };
  const rawParameters = signature.slice(open + 1, close).trim();
  const parameters = rawParameters ? splitTopLevel(rawParameters).map((part, index) => {
    const match = part.trim().match(/^(?:\.\.\.)?([A-Za-z_$][\w$]*)(\?)?\s*(?::\s*(.+?))?(?:\s*=.*)?$/);
    return match ? { name: match[1], type: match[3]?.trim(), optional: Boolean(match[2]) || part.includes("=") } : { name: `parameter${index + 1}`, type: part.trim(), optional: false };
  }) : [];
  const after = signature.slice(close + 1).trim();
  const returnType = after.startsWith(":") ? after.slice(1).trim() || undefined : undefined;
  return { parameters, returnType };
}

function isInterfaceCandidate(entity: Entity): boolean {
  if (!entity.filePath) return false;
  if (entity.kind === "interface" || entity.kind === "component") return true;
  if (!["class", "struct", "function", "enum", "type_alias"].includes(entity.kind)) return false;
  return entity.metadata?.exported === true || entity.metadata?.visibility === "public";
}
function interfaceKind(entity: Entity): InterfaceSpec["kind"] {
  if (entity.kind === "interface") return "declared-interface";
  if (entity.kind === "component") return "component-api";
  if (entity.kind === "function") return "function-api";
  if (entity.kind === "class" || entity.kind === "struct") return "class-api";
  return "type-api";
}
function interfaceScope(entity: Entity): InterfaceSpec["scope"] {
  if (entity.metadata?.exported === true || entity.metadata?.visibility === "public" || entity.kind === "component") return "public";
  if (entity.metadata?.exported === false || ["private", "protected", "internal"].includes(String(entity.metadata?.visibility))) return "internal";
  return "unknown";
}
function evidenceForEntity(entity: Entity): EvidenceReference {
  return { entityId: entity.id, filePath: entity.filePath, startLine: entity.startLine, endLine: entity.endLine, provenance: entity.provenance, confidence: entity.provenance === "synthetic" ? 0.8 : 1 };
}
function evidenceForRelation(relation: Relation, source: Entity): EvidenceReference {
  const relationLine = typeof relation.metadata?.line === "number" ? relation.metadata.line : undefined;
  return { entityId: source.id, relationId: relation.id, filePath: relation.filePath ?? source.filePath, startLine: relationLine ?? source.startLine, endLine: relationLine ?? source.endLine, provenance: relation.provenance, confidence: relation.provenance === "synthetic" ? 0.8 : 1 };
}
function buildEvidenceIndex(modules: ModuleSpec[], interfaces: InterfaceSpec[], constraints: ArchitectureConstraint[]): Record<string, EvidenceReference[]> {
  const refs = [...modules.flatMap(item => item.evidence), ...modules.flatMap(item => item.dependencies.flatMap(dep => dep.evidence)), ...interfaces.flatMap(item => [...item.evidence, ...item.operations.flatMap(operation => operation.evidence)]), ...constraints.flatMap(item => item.evidence)];
  const result: Record<string, EvidenceReference[]> = {};
  for (const ref of refs) result[ref.entityId] = uniqueEvidence([...(result[ref.entityId] ?? []), ref]);
  return result;
}
function dimension(id: string, scope: "structural" | "semantic", eligibleIds: string[], coveredIds: string[], definition: string) {
  const covered = new Set(coveredIds); const eligible = uniqueBy(eligibleIds, value => value);
  return { id, scope, eligible: eligible.length, covered: eligible.filter(id => covered.has(id)).length, ratio: eligible.length ? eligible.filter(id => covered.has(id)).length / eligible.length : null, definition, missingIds: eligible.filter(id => !covered.has(id)) };
}
function weightedRatio(items: Array<{ eligible: number; covered: number }>): number | null { const eligible = items.reduce((sum, item) => sum + item.eligible, 0); return eligible ? items.reduce((sum, item) => sum + item.covered, 0) / eligible : null; }
function moduleRootFromManifest(file: string): string { return normalize(file).replace(/\/src\/main\/module\.json5$/i, "").replace(/\/build-profile\.json5$/i, ""); }
function uniqueBy<T>(items: T[], key: (item: T) => string): T[] { const seen = new Set<string>(); return items.filter(item => { const value = key(item); if (seen.has(value)) return false; seen.add(value); return true; }); }
function uniqueEvidence(items: EvidenceReference[]): EvidenceReference[] { return uniqueBy(items, item => `${item.entityId}|${item.relationId ?? ""}|${item.filePath}|${item.startLine}|${item.endLine}`); }
function matchingParen(value: string, open: number): number { if (open < 0) return -1; let depth = 0; for (let index = open; index < value.length; index++) { if (value[index] === "(") depth++; if (value[index] === ")" && --depth === 0) return index; } return -1; }
function splitTopLevel(value: string): string[] { const result: string[] = []; let start = 0; let depth = 0; for (let index = 0; index < value.length; index++) { if ("(<[{".includes(value[index])) depth++; else if (")>]}".includes(value[index])) depth--; else if (value[index] === "," && depth === 0) { result.push(value.slice(start, index)); start = index + 1; } } result.push(value.slice(start)); return result; }
