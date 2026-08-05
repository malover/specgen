import fs from "node:fs";
import path from "node:path";
import type { ArchitectureConstraint, ProjectSpec } from "./project-spec-schema.js";
import type { ArchitectureMutation } from "./evaluation-schema.js";
import { stableId } from "./files.js";
import { writeJson } from "./io.js";

export function architectureReviewSeed(spec: ProjectSpec): { constraints: ArchitectureConstraint[]; mutations: ArchitectureMutation[] } {
  const existing = new Set(spec.modules.flatMap(source => source.dependencies.filter(item => item.resolution === "internal").map(item => `${source.id}|${item.targetId}`)));
  const constraints: ArchitectureConstraint[] = []; const mutations: ArchitectureMutation[] = [];
  for (const source of spec.modules) for (const dependency of source.dependencies.filter(item => item.resolution === "internal")) {
    const target = spec.modules.find(item => item.id === dependency.targetId);
    if (!target || existing.has(`${target.id}|${source.id}`)) continue;
    const suffix = stableId(`${target.id}|${source.id}`);
    const constraintId = `constraint:review-reverse-dependency:${suffix}`;
    constraints.push({
      id: constraintId, name: `Review ${target.name} to ${source.name} dependency`,
      description: `${target.name} currently does not depend on ${source.name}. Review whether this reverse dependency must remain forbidden.`,
      severity: "error", status: "candidate", effect: "forbid",
      sourceSelector: { moduleIds: [target.id] }, relationKinds: dependency.relationKinds,
      targetSelector: { moduleIds: [source.id] }, provenance: "deterministic", confidence: .6,
      evidence: dependency.evidence
    });
    mutations.push({
      id: `mutation:reverse-dependency:${suffix}`, operation: "add-dependency",
      description: `Inject ${target.name} -> ${source.name} to test the reviewed layer direction.`,
      sourceModuleId: target.id, targetModuleId: source.id,
      relationKind: dependency.relationKinds[0] ?? "imports", expectedConstraintId: constraintId
    });
  }
  return {
    constraints: unique(constraints, item => item.id).sort((a, b) => a.id.localeCompare(b.id)),
    mutations: unique(mutations, item => item.id).sort((a, b) => a.id.localeCompare(b.id))
  };
}

export function writeArchitectureReviewSeed(spec: ProjectSpec, repositoryId: string, directory: string, force = false): { constraints: string; mutations: string; candidates: number } {
  const architectureDirectory = path.join(directory, "architecture"); fs.mkdirSync(architectureDirectory, { recursive: true });
  const constraints = path.join(architectureDirectory, `${repositoryId}.constraints.json`);
  const mutations = path.join(architectureDirectory, `${repositoryId}.mutations.json`);
  if (!force && (fs.existsSync(constraints) || fs.existsSync(mutations))) throw new Error(`Architecture review files already exist for ${repositoryId}; use --force to replace them.`);
  const seed = architectureReviewSeed(spec); writeJson(constraints, seed.constraints); writeJson(mutations, seed.mutations);
  return { constraints, mutations, candidates: seed.constraints.length };
}

function unique<T>(items: T[], key: (item: T) => string): T[] { const seen = new Set<string>(); return items.filter(item => { const value = key(item); if (seen.has(value)) return false; seen.add(value); return true; }); }
