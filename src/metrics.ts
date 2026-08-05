import type { Entity, Observation, Relation, SpikeConfig } from "./model.js";
import { classifyFileRole, keyName } from "./files.js";

export interface EngineMetrics {
  fileCoverage: number;
  sourceFileCoverage: number;
  configurationFileCoverage: number | null;
  entityRecall: number | null;
  entityPrecision: number | null;
  edgeRecall: number | null;
  edgePrecision: number | null;
  counts: {
    candidateFiles: number; indexedFiles: number;
    sourceCandidateFiles: number; sourceIndexedFiles: number;
    configurationCandidateFiles: number; configurationIndexedFiles: number;
    evaluatedEntities: number; evaluatedRelations: number;
    completeGraphEntities: number; completeGraphRelations: number;
  };
  scope: { coverage: "complete-supported-file-set"; accuracy: "sampled-reviewed-files" | "not-evaluated"; selectedAccuracyFiles: number };
}

const evaluatedEntityKinds = new Set(["module", "package", "class", "struct", "interface", "function", "method", "import", "component"]);
const entityKey = (entity: Entity) => `${entity.kind}|${entity.filePath.toLowerCase()}|${keyName(entity.name)}`;
const endpointName = (value: string) => keyName(value.split("::").at(-1)?.split(".").at(-1) ?? value);
const relationKey = (edge: Relation, includeResolution = true) => `${edge.kind}|${endpointName(edge.sourceName)}|${endpointName(edge.targetName)}${includeResolution ? `|${edge.resolution}` : ""}`;

export function calculateMetrics(actual: Observation, truth?: Observation, selectedFiles?: string[], includeResolution = true): EngineMetrics {
  const selected = new Set((selectedFiles ?? truth?.review.sampledFiles ?? actual.candidateFiles).map(file => file.toLowerCase()));
  const candidate = new Set(actual.candidateFiles.map(file => file.toLowerCase()));
  const indexed = new Set(actual.indexedFiles.map(file => file.toLowerCase()));
  const sourceCandidate = actual.candidateFiles.filter(file => classifyFileRole(file) !== "configuration");
  const sourceIndexedSet = new Set(actual.indexedFiles.filter(file => classifyFileRole(file) !== "configuration").map(file => file.toLowerCase()));
  const configurationCandidate = actual.candidateFiles.filter(file => classifyFileRole(file) === "configuration");
  const configurationIndexedSet = new Set(actual.indexedFiles.filter(file => classifyFileRole(file) === "configuration").map(file => file.toLowerCase()));
  const actualEntities = scopedEntities(actual, selected); const actualRelations = scopedRelations(actual, selected);
  const base = {
    fileCoverage: candidate.size ? [...candidate].filter(file => indexed.has(file)).length / candidate.size : 1,
    sourceFileCoverage: sourceCandidate.length ? sourceCandidate.filter(file => sourceIndexedSet.has(file.toLowerCase())).length / sourceCandidate.length : 1,
    configurationFileCoverage: configurationCandidate.length ? configurationCandidate.filter(file => configurationIndexedSet.has(file.toLowerCase())).length / configurationCandidate.length : null,
    counts: {
      candidateFiles: candidate.size, indexedFiles: indexed.size,
      sourceCandidateFiles: sourceCandidate.length, sourceIndexedFiles: sourceIndexedSet.size,
      configurationCandidateFiles: configurationCandidate.length, configurationIndexedFiles: configurationIndexedSet.size,
      evaluatedEntities: actualEntities.length, evaluatedRelations: actualRelations.length,
      completeGraphEntities: actual.entities.length, completeGraphRelations: actual.relations.length
    },
    scope: { coverage: "complete-supported-file-set" as const, accuracy: truth?.review.status === "reviewed" ? "sampled-reviewed-files" as const : "not-evaluated" as const, selectedAccuracyFiles: selected.size }
  };
  if (!truth || truth.review.status !== "reviewed") return { ...base, entityRecall: null, entityPrecision: null, edgeRecall: null, edgePrecision: null };
  const truthEntities = scopedEntities(truth, selected); const truthRelations = scopedRelations(truth, selected);
  const actualEntityKeys = new Set(actualEntities.map(entityKey)); const truthEntityKeys = new Set(truthEntities.map(entityKey));
  const actualRelationKeys = new Set(actualRelations.map(edge => relationKey(edge, includeResolution))); const truthRelationKeys = new Set(truthRelations.map(edge => relationKey(edge, includeResolution)));
  const overlap = (left: Set<string>, right: Set<string>) => [...left].filter(value => right.has(value)).length;
  return {
    ...base,
    entityRecall: ratio(overlap(actualEntityKeys, truthEntityKeys), truthEntityKeys.size),
    entityPrecision: ratio(overlap(actualEntityKeys, truthEntityKeys), actualEntityKeys.size),
    edgeRecall: ratio(overlap(actualRelationKeys, truthRelationKeys), truthRelationKeys.size),
    edgePrecision: ratio(overlap(actualRelationKeys, truthRelationKeys), actualRelationKeys.size)
  };
}

export function agreement(actual: Observation, reference: Observation, selectedFiles: string[], includeResolution = true): EngineMetrics {
  const reviewedReference: Observation = { ...reference, review: { status: "reviewed", sampledFiles: selectedFiles, notes: "Agreement reference only; not human ground truth." } };
  return calculateMetrics(actual, reviewedReference, selectedFiles, includeResolution);
}

export function summarize(observation: Observation) {
  const byLanguage: Record<string, { files: number; entities: number; relations: number }> = {};
  for (const file of observation.indexedFiles) byLanguage[languageForFile(file, observation)] ??= { files: 0, entities: 0, relations: 0 };
  for (const file of observation.indexedFiles) byLanguage[languageForFile(file, observation)].files++;
  for (const entity of observation.entities) { const language = entity.language; byLanguage[language] ??= { files: 0, entities: 0, relations: 0 }; byLanguage[language].entities++; }
  for (const edge of observation.relations) { const source = observation.entities.find(entity => entity.id === edge.source); const language = source?.language ?? "none"; byLanguage[language] ??= { files: 0, entities: 0, relations: 0 }; byLanguage[language].relations++; }
  return {
    entitiesByKind: countBy(observation.entities.map(entity => entity.kind)),
    relationsByKind: countBy(observation.relations.map(edge => edge.kind)),
    relationsByResolution: countBy(observation.relations.map(edge => edge.resolution)),
    byLanguage
  };
}

export function acceptance(metrics: EngineMetrics, incrementalMs: number | null, limits: SpikeConfig["acceptance"], crashed = false) {
  return {
    fileCoverage: metrics.fileCoverage >= limits.fileCoverage,
    entityRecall: metrics.entityRecall === null ? "not-evaluated" : metrics.entityRecall >= limits.entityRecall,
    edgePrecision: metrics.edgePrecision === null ? "not-evaluated" : metrics.edgePrecision >= limits.edgePrecision,
    incrementalStaleness: incrementalMs !== null && incrementalMs <= limits.incrementalStalenessMs,
    noCrash: !crashed
  };
}

const scopedEntities = (observation: Observation, files: Set<string>) => observation.entities.filter(entity => evaluatedEntityKinds.has(entity.kind) && entityApplies(entity, files));
const scopedRelations = (observation: Observation, files: Set<string>) => observation.relations.filter(edge => edge.filePath && files.has(edge.filePath.toLowerCase()));
const ratio = (value: number, total: number): number | null => total ? value / total : null;
const countBy = (values: string[]): Record<string, number> => values.reduce<Record<string, number>>((result, value) => { result[value] = (result[value] ?? 0) + 1; return result; }, {});
const languageForFile = (file: string, observation: Observation): string => observation.entities.find(entity => entity.kind === "file" && entity.filePath === file)?.language ?? "unknown";
function entityApplies(entity: Entity, files: Set<string>): boolean {
  if (entity.filePath && files.has(entity.filePath.toLowerCase())) return true;
  if (entity.kind === "module") {
    const root = typeof entity.metadata?.root === "string" ? entity.metadata.root.toLowerCase() : "";
    return [...files].some(file => !root || file.startsWith(`${root}/`));
  }
  if (entity.kind === "package") {
    const root = entity.filePath.toLowerCase().split("/").slice(0, -1).join("/");
    return [...files].some(file => !root || file.startsWith(`${root}/`));
  }
  return false;
}
