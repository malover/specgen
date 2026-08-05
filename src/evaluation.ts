import fs from "node:fs";
import path from "node:path";
import type { Entity, Observation, Relation } from "./model.js";
import type { ProjectSpec, EvidenceReference } from "./project-spec-schema.js";
import { ProjectSpecSchema } from "./project-spec-schema.js";
import { applyArchitectureMutation, checkArchitecture } from "./architecture-check.js";
import { EVALUATION_SCHEMA, EvaluationReportSchema, type ArchitectureMutation, type EvaluationGroundTruth, type EvaluationReport, type Score } from "./evaluation-schema.js";

const eligibleKinds = new Set(["module", "package", "class", "struct", "interface", "function", "method", "component", "enum", "type_alias"]);
const dependencyKinds = new Set(["imports", "calls", "references", "instantiates", "extends", "implements", "type_of", "returns", "bridges_to"]);
const key = (parts: string[]) => parts.map(item => item.trim().toLowerCase()).join("|");

export interface EvaluationInput {
  observation: Observation; spec: ProjectSpec; repositoryRoot?: string; groundTruth?: EvaluationGroundTruth;
  incrementalMs?: number | null; crashed?: boolean; previousSpec?: ProjectSpec; mutations?: ArchitectureMutation[];
}

export function evaluateProject(input: EvaluationInput): EvaluationReport {
  const { observation, spec, groundTruth } = input;
  const eligibleEntities = observation.entities.filter(item => eligibleKinds.has(item.kind));
  const ownableEntities = eligibleEntities.filter(item => item.kind !== "module" && item.kind !== "package");
  const representedEntityIds = new Set([
    ...spec.modules.flatMap(item => item.entityId ? [item.entityId] : []),
    ...spec.interfaces.map(item => item.entityId),
    ...spec.interfaces.flatMap(item => item.operations.map(operation => operation.entityId))
  ]);
  const eligibleRelations = observation.relations.filter(item => dependencyKinds.has(item.kind));
  const representedRelationIds = new Set(spec.modules.flatMap(item => item.dependencies.flatMap(dep => dep.evidence.flatMap(ref => ref.relationId ? [ref.relationId] : []))));
  const publicEntities = eligibleEntities.filter(item => item.kind === "interface" || item.kind === "component" || item.metadata?.exported === true || item.metadata?.visibility === "public");
  const publicIds = new Set(publicEntities.map(item => item.id));
  const interfaceEntityIds = new Set(spec.interfaces.map(item => item.entityId));
  const moduleByFile = new Map(spec.modules.flatMap(module => module.files.map(file => [file, module.id] as const)));
  const entityById = new Map(observation.entities.map(item => [item.id, item]));
  const crossModuleRelations = eligibleRelations.filter(edge => {
    const source = entityById.get(edge.source); const target = entityById.get(edge.target);
    const sourceModule = source ? moduleByFile.get(source.filePath) : undefined;
    const targetModule = target ? moduleByFile.get(target.filePath) : undefined;
    return Boolean(sourceModule && (edge.resolution !== "internal" || !targetModule || sourceModule !== targetModule));
  });
  const publicRelations = eligibleRelations.filter(edge => publicIds.has(edge.source) || publicIds.has(edge.target));
  const graphValidRelations = observation.relations.filter(edge => entityById.has(edge.source) && (edge.resolution !== "internal" || entityById.has(edge.target)));
  const calls = observation.relations.filter(edge => edge.kind === "calls");
  const validCalls = calls.filter(edge => entityById.has(edge.source) && (edge.resolution !== "internal" || entityById.has(edge.target)));
  const refs = collectEvidence(spec);
  const validRefs = refs.filter(ref => evidenceValid(ref, observation, input.repositoryRoot));
  const records = [...spec.modules, ...spec.interfaces, ...spec.interfaces.flatMap(item => item.operations)];
  const backedRecords = records.filter(item => item.evidence.length > 0);
  const orphanEntities = eligibleEntities.filter(entity => !observation.relations.some(edge => edge.source === entity.id || edge.target === entity.id));
  const recordIds = records.map(item => item.id);
  const duplicateCount = recordIds.length - new Set(recordIds).size;
  const accuracy = evaluateGroundTruth(observation, spec, groundTruth);
  const architecture = evaluateMutations(spec, input.mutations ?? [], observation);
  const stability = input.previousSpec ? stabilityScore(input.previousSpec, spec) : null;
  const incrementalMs = input.incrementalMs ?? null;
  const structural = {
    fileCoverage: score(observation.indexedFiles.filter(file => observation.candidateFiles.includes(file)).length, new Set(observation.candidateFiles).size),
    moduleOwnershipCoverage: score(ownableEntities.filter(item => moduleByFile.has(item.filePath)).length, ownableEntities.length),
    publicApiCoverage: score(publicEntities.filter(item => interfaceEntityIds.has(item.id)).length, publicEntities.length),
    moduleDependencyCoverage: score(crossModuleRelations.filter(item => representedRelationIds.has(item.id)).length, crossModuleRelations.length),
    publicInterfaceRelationshipCoverage: score(publicRelations.filter(item => representedRelationIds.has(item.id)).length, publicRelations.length),
    graphRelationshipIntegrity: score(graphValidRelations.length, observation.relations.length),
    callGraphIntegrity: score(validCalls.length, calls.length),
    entityPromotionRate: score(eligibleEntities.filter(item => representedEntityIds.has(item.id)).length, eligibleEntities.length),
    relationshipPromotionRate: score(eligibleRelations.filter(item => representedRelationIds.has(item.id)).length, eligibleRelations.length),
    entitySpecCoverage: score(eligibleEntities.filter(item => representedEntityIds.has(item.id)).length, eligibleEntities.length),
    relationshipSpecCoverage: score(eligibleRelations.filter(item => representedRelationIds.has(item.id)).length, eligibleRelations.length),
    interfaceSpecCoverage: score(publicEntities.filter(item => interfaceEntityIds.has(item.id)).length, publicEntities.length),
    evidenceValidity: score(validRefs.length, refs.length), evidenceCompleteness: score(backedRecords.length, records.length),
    schemaValidity: score(ProjectSpecSchema.safeParse(spec).success ? 1 : 0, 1),
    orphanRate: score(orphanEntities.length, eligibleEntities.length), duplicateRate: score(duplicateCount, recordIds.length),
    incrementalFreshness: incrementalMs === null ? score(0, 0) : score(incrementalMs <= 5000 ? 1 : 0, 1), stability
  };
  const weighted = [
    [structural.moduleOwnershipCoverage.value, .12], [structural.publicApiCoverage.value, .12],
    [structural.moduleDependencyCoverage.value, .12], [structural.graphRelationshipIntegrity.value, .09],
    [structural.evidenceValidity.value, .15],
    [structural.schemaValidity.value, .10], [accuracy.entityRecall.value, .10],
    [accuracy.edgePrecision.value, .10], [architecture.issueRecall.value, .10]
  ] as Array<[number | null, number]>;
  const present = weighted.filter(([value]) => value !== null);
  const weight = present.reduce((sum, [, value]) => sum + value, 0);
  const warnings = [
    ...(groundTruth ? [] : ["Ground truth was not supplied; accuracy metrics are not evaluated."]),
    ...((input.mutations?.length ?? 0) ? [] : ["Architecture mutations were not supplied; issue recall is not evaluated."]),
    ...(refs.length ? [] : ["The Project SPEC contains no evidence references."])
  ];
  const compositeStatus = groundTruth && (input.mutations?.length ?? 0) > 0 ? "complete" as const : "not-evaluated" as const;
  if (compositeStatus === "not-evaluated") warnings.unshift("Overall product quality is not scored until reviewed accuracy and architecture mutation results are available.");
  const structuralWeights = [
    [structural.fileCoverage.value, .15], [structural.moduleOwnershipCoverage.value, .20],
    [structural.publicApiCoverage.value, .15], [structural.moduleDependencyCoverage.value, .15],
    [structural.graphRelationshipIntegrity.value, .10], [structural.evidenceValidity.value, .15],
    [structural.schemaValidity.value, .10]
  ] as Array<[number | null, number]>;
  const structuralPresent = structuralWeights.filter(([value]) => value !== null);
  const structuralWeight = structuralPresent.reduce((sum, [, itemWeight]) => sum + itemWeight, 0);
  const calculatedComposite = weight ? present.reduce((sum, [value, itemWeight]) => sum + (value ?? 0) * itemWeight, 0) / weight : 0;
  const report: EvaluationReport = {
    schema: EVALUATION_SCHEMA, generatedAt: new Date().toISOString(), repository: observation.repository,
    structural, accuracy, architecture,
    performance: { incrementalMs, withinFiveSeconds: incrementalMs === null ? null : incrementalMs <= 5000, crashFree: !input.crashed },
    structuralScore: structuralWeight ? structuralPresent.reduce((sum, [value, itemWeight]) => sum + (value ?? 0) * itemWeight, 0) / structuralWeight : 0,
    compositeScore: compositeStatus === "complete" ? calculatedComposite : null,
    compositeStatus,
    warnings,
    acceptance: {
      fileCoverage: (structural.fileCoverage.value ?? 0) >= .95,
      entityRecall: accuracy.entityRecall.value === null ? "not-evaluated" : accuracy.entityRecall.value >= .85,
      edgePrecision: accuracy.edgePrecision.value === null ? "not-evaluated" : accuracy.edgePrecision.value >= .90,
      architectureIssueRecall: architecture.issueRecall.value === null ? "not-evaluated" : architecture.issueRecall.value >= .75,
      evidenceValidity: (structural.evidenceValidity.value ?? 0) >= .98,
      schemaValidity: structural.schemaValidity.value === 1,
      incrementalFreshness: incrementalMs === null ? "not-evaluated" : incrementalMs <= 5000,
      crashFree: !input.crashed
    }
  };
  return EvaluationReportSchema.parse(report);
}

function evaluateGroundTruth(observation: Observation, spec: ProjectSpec, truth?: EvaluationGroundTruth) {
  const empty = score(0, 0);
  if (!truth) return { status: "not-evaluated" as const, entityPrecision: empty, entityRecall: empty, entityF1: empty, edgePrecision: empty, edgeRecall: empty, edgeF1: empty, interfaceRecall: empty };
  const files = new Set(truth.files.map(item => item.toLowerCase()));
  const actualEntities = observation.entities.filter(item => files.has(item.filePath.toLowerCase()) && eligibleKinds.has(item.kind));
  const actualRelations = observation.relations.filter(item => item.filePath && files.has(item.filePath.toLowerCase()));
  const actualEntityKeys = new Set(actualEntities.map(entityKey)); const truthEntityKeys = new Set(truth.entities.map(entityKey));
  const actualRelationKeys = new Set(actualRelations.map(relationKey)); const truthRelationKeys = new Set(truth.relations.map(relationKey));
  const ep = overlap(actualEntityKeys, truthEntityKeys); const rp = overlap(actualRelationKeys, truthRelationKeys);
  const entityPrecision = score(ep, actualEntityKeys.size); const entityRecall = score(ep, truthEntityKeys.size);
  const edgePrecision = score(rp, actualRelationKeys.size); const edgeRecall = score(rp, truthRelationKeys.size);
  const interfaces = new Set(spec.interfaces.map(item => entityKey({ kind: kindFromInterface(item.kind), filePath: item.evidence[0]?.filePath ?? "", name: item.name })));
  const expectedInterfaces = new Set(truth.interfaceEntities.map(entityKey));
  return {
    status: "evaluated" as const, entityPrecision, entityRecall, entityF1: f1(entityPrecision, entityRecall),
    edgePrecision, edgeRecall, edgeF1: f1(edgePrecision, edgeRecall),
    interfaceRecall: score(overlap(interfaces, expectedInterfaces), expectedInterfaces.size)
  };
}

function evaluateMutations(spec: ProjectSpec, mutations: ArchitectureMutation[], observation: Observation) {
  const baseline = checkArchitecture(spec); const baselineIds = new Set(baseline.map(item => item.id));
  const details = mutations.map(mutation => {
    const detected = checkArchitecture(applyArchitectureMutation(spec, mutation)).filter(issue => !baselineIds.has(issue.id));
    return { id: mutation.id, passed: detected.some(issue => issue.constraintId === mutation.expectedConstraintId), detectedConstraintIds: [...new Set(detected.map(issue => issue.constraintId))] };
  });
  const detected = details.filter(item => item.passed).length;
  const totalDetections = details.reduce((sum, item) => sum + item.detectedConstraintIds.length, 0);
  const unexpectedMutantDetections = Math.max(0, totalDetections - detected);
  const falsePositives = baseline.length + unexpectedMutantDetections;
  const lines = observation.entities.filter(item => item.kind === "file").reduce((sum, item) => sum + Math.max(0, item.endLine - item.startLine + 1), 0);
  return {
    cases: mutations.length, detected, issueRecall: score(detected, mutations.length), falsePositives,
    falsePositivesPerKloc: lines ? falsePositives / (lines / 1000) : 0,
    precision: score(detected, detected + falsePositives), details
  };
}

function evidenceValid(ref: EvidenceReference, observation: Observation, repositoryRoot?: string): boolean {
  const entity = observation.entities.find(item => item.id === ref.entityId);
  if (!entity) return false;
  if (ref.relationId && !observation.relations.some(item => item.id === ref.relationId)) return false;
  if (ref.startLine < 0 || ref.endLine < ref.startLine) return false;
  const knownFile = observation.indexedFiles.includes(ref.filePath) || observation.candidateFiles.includes(ref.filePath) || entity.filePath === ref.filePath;
  if (!knownFile) return false;
  if (repositoryRoot && !fs.existsSync(path.join(repositoryRoot, ref.filePath))) return false;
  return true;
}
function collectEvidence(spec: ProjectSpec): EvidenceReference[] { return [
  ...spec.modules.flatMap(item => [...item.evidence, ...item.dependencies.flatMap(dep => dep.evidence)]),
  ...spec.interfaces.flatMap(item => [...item.evidence, ...item.operations.flatMap(operation => operation.evidence)]),
  ...spec.constraints.flatMap(item => item.evidence)
]; }
function stabilityScore(previous: ProjectSpec, current: ProjectSpec): Score {
  const before = new Set([...previous.modules.map(item => item.id), ...previous.interfaces.map(item => item.id)]);
  const after = new Set([...current.modules.map(item => item.id), ...current.interfaces.map(item => item.id)]);
  return score(overlap(before, after), before.size);
}
function entityKey(entity: { kind: string; filePath: string; name: string }): string { return key([entity.kind, entity.filePath, entity.name]); }
function relationKey(edge: { kind: string; sourceName: string; targetName: string; filePath?: string }): string { return key([edge.kind, edge.filePath ?? "", endpoint(edge.sourceName), endpoint(edge.targetName)]); }
function endpoint(value: string): string { return value.split("::").at(-1) ?? value; }
function overlap(left: Set<string>, right: Set<string>): number { return [...left].filter(item => right.has(item)).length; }
function score(numerator: number, denominator: number): Score { return { value: denominator ? numerator / denominator : null, numerator, denominator }; }
function f1(precision: Score, recall: Score): Score { const p = precision.value; const r = recall.value; return p === null || r === null || p + r === 0 ? score(0, 0) : { value: 2 * p * r / (p + r), numerator: 2 * p * r, denominator: p + r }; }
function kindFromInterface(kind: string): string { return ({ "declared-interface": "interface", "class-api": "class", "function-api": "function", "component-api": "component", "type-api": "type_alias" } as Record<string, string>)[kind] ?? kind; }
