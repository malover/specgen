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
export { compareAgentRuns } from "./agent-evaluation.js";
export { evaluationMarkdown, writeEvaluationReport } from "./evaluation-report.js";
export {
  EVALUATION_SCHEMA, EvaluationGroundTruthSchema, ArchitectureMutationSchema,
  AgentRunSchema, EvaluationReportSchema
} from "./evaluation-schema.js";
export type { EvaluationGroundTruth, ArchitectureMutation, AgentRun, EvaluationReport, Score } from "./evaluation-schema.js";
export { convertLegacyGroundTruth } from "./ground-truth.js";
export { generateSilverGroundTruth } from "./silver-ground-truth.js";
export { architectureReviewSeed, writeArchitectureReviewSeed } from "./architecture-evaluation.js";
export { AgentExperimentConfigSchema, loadAgentExperiment, runAgentExperiment } from "./agent-experiment.js";
export type { AgentExperimentConfig } from "./agent-experiment.js";
export { GeneratedAgentTaskSchema, generateAgentBenchmark, verifyGeneratedAgentTask } from "./agent-benchmark.js";
export type { GeneratedAgentTask } from "./agent-benchmark.js";
export { LlmJudgeInputSchema, generateLlmJudgeInput, parseJudgeResponse, runLlmJudge } from "./llm-judge.js";
export { runOpenRouterAgent } from "./openrouter-agent.js";
