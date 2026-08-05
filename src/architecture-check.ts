import type { ArchitectureConstraint, EvidenceReference, ProjectSpec } from "./project-spec-schema.js";
import type { ArchitectureMutation } from "./evaluation-schema.js";

export interface ArchitectureIssue {
  id: string; constraintId: string; severity: ArchitectureConstraint["severity"];
  sourceModuleId: string; targetModuleId?: string; relationKinds: string[];
  message: string; evidence: EvidenceReference[];
}

export function checkArchitecture(spec: ProjectSpec, constraints: ArchitectureConstraint[] = spec.constraints): ArchitectureIssue[] {
  const issues: ArchitectureIssue[] = [];
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
  if (!source || !target) throw new Error(`Mutation ${mutation.id} references an unknown module.`);
  source.dependencies.push({
    targetId: target.id, targetName: target.name, resolution: "internal",
    relationKinds: [mutation.relationKind], count: 1, evidence: []
  });
  return copy;
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
