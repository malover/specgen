export { extractCodeGraph, classifyResolution } from "./codegraph-engine.js";
export { buildProjectSpec, parseSignature } from "./project-spec.js";
export { writeProjectSpecArtifacts, moduleDependencyMermaid } from "./project-spec-artifacts.js";
export { projectIndex, queryProjectSpec } from "./project-spec-query.js";
export type { DisclosureQuery, DisclosureResult } from "./project-spec-query.js";
export {
  PROJECT_SPEC_SCHEMA, ProjectSpecSchema, ModuleSpecSchema, InterfaceSpecSchema,
  ArchitectureConstraintSchema, CoverageLedgerSchema, ArchitectureViewSchema
} from "./project-spec-schema.js";
export type {
  ProjectSpec, ModuleSpec, InterfaceSpec, ArchitectureConstraint,
  CoverageLedger, ArchitectureView, EvidenceReference, OperationSpec
} from "./project-spec-schema.js";
export type { Entity, Relation, Observation, SpikeConfig, RepoConfig } from "./model.js";
export { evaluateProject } from "./evaluation.js";
export { checkArchitecture, applyArchitectureMutation, generateArchitectureMutations, generateUniversalArchitectureMutations } from "./architecture-check.js";
export { evaluationMarkdown, writeEvaluationReport } from "./evaluation-report.js";
export {
  EVALUATION_SCHEMA, EvaluationGroundTruthSchema, ArchitectureMutationSchema,
  EvaluationReportSchema
} from "./evaluation-schema.js";
export type { EvaluationGroundTruth, ArchitectureMutation, EvaluationReport, Score } from "./evaluation-schema.js";
export { convertLegacyGroundTruth } from "./ground-truth.js";
export { generateSilverGroundTruth } from "./silver-ground-truth.js";
export { architectureReviewSeed, writeArchitectureReviewSeed } from "./architecture-evaluation.js";
export { FULL_EVALUATION_SCHEMA, assembleFullEvaluationReport, fullEvaluationMarkdown, runFullEvaluation } from "./full-evaluation.js";
export type { FullEvaluationOptions, FullEvaluationReport, RepositoryFullEvaluation } from "./full-evaluation.js";
