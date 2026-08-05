import type { ArchitectureConstraint, EvidenceReference, ProjectSpec } from "./project-spec-schema.js";
import type { ArchitectureMutation } from "./evaluation-schema.js";

export interface ArchitectureIssue {
  id: string; constraintId: string; severity: ArchitectureConstraint["severity"];
  sourceModuleId: string; targetModuleId?: string; relationKinds: string[];
  message: string; evidence: EvidenceReference[];
}

export function checkArchitecture(spec: ProjectSpec, constraints: ArchitectureConstraint[] = spec.constraints): ArchitectureIssue[] {
  const issues: ArchitectureIssue[] = builtInIssues(spec);
  const accepted = constraints.filter(item => item.status === "accepted");
  for (const constraint of accepted) {
    const sources = spec.modules.filter(module => matchesModule(module.id, module.name, constraint.sourceSelector));
    for (const source of sources) {
      const relevant = source.dependencies.filter(dep => intersects(dep.relationKinds, constraint.relationKinds));
      const matches = relevant.filter(dep => matchesTarget(dep.targetId, dep.targetName, dep.resolution, constraint.targetSelector));
      const violating = constraint.effect === "forbid" ? matches
        : constraint.effect === "allow" ? relevant.filter(dep => !matches.includes(dep))
        : [];
      for (const dependency of violating) issues.push({
        id: `${constraint.id}:${source.id}:${dependency.targetId}`, constraintId: constraint.id,
        severity: constraint.severity, sourceModuleId: source.id, targetModuleId: dependency.targetId,
        relationKinds: dependency.relationKinds,
        message: `${source.name} ${dependency.relationKinds.join("/")} ${dependency.targetName}: ${constraint.description}`,
        evidence: dependency.evidence
      });
      if (constraint.effect === "require" && matches.length === 0) issues.push({
        id: `${constraint.id}:${source.id}:missing`, constraintId: constraint.id, severity: constraint.severity,
        sourceModuleId: source.id, relationKinds: constraint.relationKinds,
        message: `${source.name} is missing a required architecture relationship: ${constraint.description}`, evidence: []
      });
    }
  }
  return issues.sort((a, b) => a.id.localeCompare(b.id));
}

export function applyArchitectureMutation(spec: ProjectSpec, mutation: ArchitectureMutation): ProjectSpec {
  const copy = structuredClone(spec);
  const source = copy.modules.find(item => item.id === mutation.sourceModuleId);
  const target = copy.modules.find(item => item.id === mutation.targetModuleId);
  if (!source) throw new Error(`Mutation ${mutation.id} references an unknown source module.`);
  if (mutation.operation === "add-unresolved-dependency") {
    source.dependencies.push({ targetId: mutation.targetModuleId, targetName: "Injected unresolved dependency", resolution: "unresolved", relationKinds: [mutation.relationKind], count: 1, evidence: [] });
    return copy;
  }
  if (mutation.operation === "add-missing-internal-dependency") {
    source.dependencies.push({ targetId: mutation.targetModuleId, targetName: "Injected missing internal module", resolution: "internal", relationKinds: [mutation.relationKind], count: 1, evidence: [] });
    return copy;
  }
  if (mutation.operation === "add-self-dependency") {
    source.dependencies.push({ targetId: source.id, targetName: source.name, resolution: "internal", relationKinds: [mutation.relationKind], count: 1, evidence: [] });
    return copy;
  }
  if (!target) throw new Error(`Mutation ${mutation.id} references an unknown target module.`);
  source.dependencies.push({
    targetId: target.id, targetName: target.name, resolution: "internal",
    relationKinds: [mutation.relationKind], count: 1, evidence: []
  });
  return copy;
}

export function generateUniversalArchitectureMutations(spec: ProjectSpec): ArchitectureMutation[] {
  const first = spec.modules[0]; if (!first) return [];
  const result: ArchitectureMutation[] = [
    {
      id: "mutation:unresolved-dependency", operation: "add-unresolved-dependency",
      description: "Inject an unresolved dependency target.", sourceModuleId: first.id,
      targetModuleId: "injected:unresolved", relationKind: "imports", expectedConstraintId: "builtin:no-unresolved-dependencies"
    },
    {
      id: "mutation:missing-internal-module", operation: "add-missing-internal-dependency",
      description: "Inject an internal dependency whose target module does not exist.", sourceModuleId: first.id,
      targetModuleId: "injected:missing-module", relationKind: "depends_on", expectedConstraintId: "builtin:internal-target-exists"
    },
    {
      id: "mutation:self-dependency", operation: "add-self-dependency",
      description: "Inject a module dependency on itself.", sourceModuleId: first.id,
      targetModuleId: first.id, relationKind: "depends_on", expectedConstraintId: "builtin:no-self-dependency"
    }
  ];
  const edge = spec.modules.flatMap(source => source.dependencies.filter(item => item.resolution === "internal" && spec.modules.some(module => module.id === item.targetId)).map(item => ({ source, target: spec.modules.find(module => module.id === item.targetId)! }))).find(item =>
    item.source.id !== item.target.id && !item.target.dependencies.some(dep => dep.resolution === "internal" && dep.targetId === item.source.id)
  );
  if (edge) result.push({
    id: "mutation:module-cycle", operation: "add-dependency", description: "Reverse an existing dependency to introduce a two-module cycle.",
    sourceModuleId: edge.target.id, targetModuleId: edge.source.id, relationKind: "depends_on", expectedConstraintId: "builtin:no-module-cycles"
  });
  return result;
}

export function generateArchitectureMutations(spec: ProjectSpec, constraints: ArchitectureConstraint[] = spec.constraints): ArchitectureMutation[] {
  const result: ArchitectureMutation[] = [];
  for (const constraint of constraints.filter(item => item.status === "accepted" && item.effect === "forbid")) {
    const sources = spec.modules.filter(module => matchesModule(module.id, module.name, constraint.sourceSelector));
    const targets = spec.modules.filter(module => matchesTarget(module.id, module.name, "internal", constraint.targetSelector));
    for (const source of sources) for (const target of targets) {
      if (source.id === target.id) continue;
      const relationKind = constraint.relationKinds[0]; if (!relationKind) continue;
      result.push({
        id: `generated:${constraint.id}:${source.id}:${target.id}`, operation: "add-dependency",
        description: `Inject ${source.name} -> ${target.name} using ${relationKind}.`,
        sourceModuleId: source.id, targetModuleId: target.id, relationKind, expectedConstraintId: constraint.id
      });
    }
  }
  return result;
}

function matchesModule(id: string, name: string, selector: ArchitectureConstraint["sourceSelector"]): boolean {
  if (selector.moduleIds?.length && !selector.moduleIds.includes(id)) return false;
  if (selector.namePattern && !safePattern(selector.namePattern).test(`${id} ${name}`)) return false;
  return true;
}
function matchesTarget(id: string, name: string, resolution: string, selector: ArchitectureConstraint["targetSelector"]): boolean {
  if (selector.moduleIds?.length && !selector.moduleIds.includes(id)) return false;
  if (selector.resolution && selector.resolution !== resolution) return false;
  if (selector.namePattern && !safePattern(selector.namePattern).test(`${id} ${name}`)) return false;
  return true;
}
function safePattern(value: string): RegExp { try { return new RegExp(value, "i"); } catch { return new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"); } }
function intersects(left: string[], right: string[]): boolean { const accepted = new Set(right); return left.some(item => accepted.has(item)); }

function builtInIssues(spec: ProjectSpec): ArchitectureIssue[] {
  const moduleIds = new Set(spec.modules.map(item => item.id)); const issues: ArchitectureIssue[] = [];
  for (const module of spec.modules) for (const dependency of module.dependencies) {
    if (dependency.resolution === "unresolved") issues.push(issue("builtin:no-unresolved-dependencies", module.id, dependency.targetId, dependency.relationKinds, "Dependency target is unresolved.", dependency.evidence));
    if (dependency.resolution === "internal" && !moduleIds.has(dependency.targetId)) issues.push(issue("builtin:internal-target-exists", module.id, dependency.targetId, dependency.relationKinds, "Internal dependency target does not exist.", dependency.evidence));
    if (dependency.resolution === "internal" && dependency.targetId === module.id) issues.push(issue("builtin:no-self-dependency", module.id, dependency.targetId, dependency.relationKinds, "Module depends on itself.", dependency.evidence));
  }
  for (const cycle of moduleCycles(spec)) issues.push(issue("builtin:no-module-cycles", cycle[0], cycle.at(-1), ["depends_on"], `Module dependency cycle: ${cycle.join(" -> ")}.`, []));
  return issues;
}
function issue(constraintId: string, sourceModuleId: string, targetModuleId: string | undefined, relationKinds: string[], message: string, evidence: EvidenceReference[]): ArchitectureIssue {
  return { id: `${constraintId}:${sourceModuleId}:${targetModuleId ?? "missing"}`, constraintId, severity: "error", sourceModuleId, targetModuleId, relationKinds, message, evidence };
}
function moduleCycles(spec: ProjectSpec): string[][] {
  const ids = new Set(spec.modules.map(item => item.id)); const graph = new Map(spec.modules.map(item => [item.id, item.dependencies.filter(dep => dep.resolution === "internal" && ids.has(dep.targetId) && dep.targetId !== item.id).map(dep => dep.targetId)]));
  const found = new Map<string, string[]>(); const visiting = new Set<string>(); const visited = new Set<string>(); const stack: string[] = [];
  const visit = (id: string) => {
    if (visiting.has(id)) { const start = stack.indexOf(id); const cycle = [...stack.slice(start), id]; const canonical = [...new Set(cycle)].sort().join("|"); found.set(canonical, cycle); return; }
    if (visited.has(id)) return; visiting.add(id); stack.push(id);
    for (const target of graph.get(id) ?? []) visit(target);
    stack.pop(); visiting.delete(id); visited.add(id);
  };
  for (const id of graph.keys()) visit(id); return [...found.values()];
}
