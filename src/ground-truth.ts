import type { Observation } from "./model.js";
import { EvaluationGroundTruthSchema, type EvaluationGroundTruth } from "./evaluation-schema.js";

const evaluatedKinds = new Set(["module", "package", "class", "struct", "interface", "function", "method", "component", "enum", "type_alias"]);

export function convertLegacyGroundTruth(value: Observation): EvaluationGroundTruth {
  if (value.schemaVersion !== 2 || value.engine !== "ground-truth" || value.review.status !== "reviewed") {
    throw new Error("Only a reviewed ground-truth.v2 observation can be converted.");
  }
  if (value.diagnostics.some(item => item.startsWith("UNREVIEWED SEED"))) {
    throw new Error("The legacy ground truth is still marked as an unreviewed seed.");
  }
  const files = new Set(value.review.sampledFiles);
  const entities = value.entities.filter(item => files.has(item.filePath) && evaluatedKinds.has(item.kind));
  const result: EvaluationGroundTruth = {
    schema: "deveco.specgen-ground-truth/v1", repository: value.repository,
    oracle: "human-reviewed",
    reviewedBy: value.review.reviewer ?? "legacy ground-truth reviewer",
    reviewedAt: validDate(value.review.reviewedAt) ?? validDate(value.generatedAt) ?? new Date().toISOString(),
    files: [...files].sort(),
    entities: entities.map(item => ({ kind: item.kind, filePath: item.filePath, name: item.name })),
    relations: value.relations.filter(item => item.filePath && files.has(item.filePath)).map(item => ({
      kind: item.kind, sourceName: item.sourceName, targetName: item.targetName, filePath: item.filePath!
    })),
    interfaceEntities: entities.filter(isPublicApi).map(item => ({ kind: item.kind, filePath: item.filePath, name: item.name })),
    notes: ["Automatically converted from a human-reviewed ground-truth.v2.json observation."]
  };
  return EvaluationGroundTruthSchema.parse(result);
}

function isPublicApi(entity: Observation["entities"][number]): boolean {
  return entity.kind === "interface" || entity.kind === "component" || entity.metadata?.exported === true || entity.metadata?.visibility === "public";
}
function validDate(value?: string): string | undefined { if (!value || Number.isNaN(Date.parse(value))) return undefined; return new Date(value).toISOString(); }
