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
