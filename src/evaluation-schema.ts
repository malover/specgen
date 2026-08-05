import { z } from "zod";

export const EVALUATION_SCHEMA = "deveco.specgen-evaluation/v1" as const;

const ExpectedEntitySchema = z.object({
  kind: z.string().min(1), filePath: z.string().min(1), name: z.string().min(1)
});
const ExpectedRelationSchema = z.object({
  kind: z.string().min(1), sourceName: z.string().min(1), targetName: z.string().min(1), filePath: z.string().min(1)
});

export const EvaluationGroundTruthSchema = z.object({
  schema: z.literal("deveco.specgen-ground-truth/v1"), repository: z.string().min(1),
  source: z.object({ url: z.string().optional(), revision: z.string().optional(), license: z.string().optional() }).optional(),
  reviewedBy: z.string().min(1), reviewedAt: z.string().datetime(),
  files: z.array(z.string().min(1)), entities: z.array(ExpectedEntitySchema),
  relations: z.array(ExpectedRelationSchema),
  interfaceEntities: z.array(ExpectedEntitySchema).default([]),
  notes: z.array(z.string()).default([])
});

export const ArchitectureMutationSchema = z.object({
  id: z.string().min(1), description: z.string().min(1),
  operation: z.enum(["add-dependency"]).default("add-dependency"),
  sourceModuleId: z.string().min(1), targetModuleId: z.string().min(1),
  relationKind: z.string().min(1), expectedConstraintId: z.string().min(1)
});

export const AgentRunSchema = z.object({
  schema: z.literal("deveco.specgen-agent-run/v1"), taskId: z.string().min(1), runId: z.string().min(1),
  condition: z.enum(["baseline", "project-spec"]), success: z.boolean(), buildPassed: z.boolean(),
  testsPassed: z.boolean(), architectureIssueCount: z.number().int().nonnegative(),
  durationMs: z.number().nonnegative(), inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(), filesTouched: z.number().int().nonnegative(),
  repairIterations: z.number().int().nonnegative(), retrievedIds: z.array(z.string()).default([]),
  relevantIds: z.array(z.string()).default([]), usedProjectSpec: z.boolean().optional()
});

const ScoreSchema = z.object({
  value: z.number().min(0).max(1).nullable(), numerator: z.number().nonnegative(), denominator: z.number().nonnegative()
});

export const EvaluationReportSchema = z.object({
  schema: z.literal(EVALUATION_SCHEMA), generatedAt: z.string().datetime(), repository: z.string().min(1),
  structural: z.object({
    fileCoverage: ScoreSchema,
    moduleOwnershipCoverage: ScoreSchema, publicApiCoverage: ScoreSchema,
    moduleDependencyCoverage: ScoreSchema, publicInterfaceRelationshipCoverage: ScoreSchema,
    graphRelationshipIntegrity: ScoreSchema, callGraphIntegrity: ScoreSchema,
    entityPromotionRate: ScoreSchema, relationshipPromotionRate: ScoreSchema,
    entitySpecCoverage: ScoreSchema, relationshipSpecCoverage: ScoreSchema, interfaceSpecCoverage: ScoreSchema,
    evidenceValidity: ScoreSchema, evidenceCompleteness: ScoreSchema,
    schemaValidity: ScoreSchema, orphanRate: ScoreSchema, duplicateRate: ScoreSchema,
    incrementalFreshness: ScoreSchema, stability: ScoreSchema.nullable()
  }),
  accuracy: z.object({
    status: z.enum(["evaluated", "not-evaluated"]), entityPrecision: ScoreSchema,
    entityRecall: ScoreSchema, entityF1: ScoreSchema, edgePrecision: ScoreSchema,
    edgeRecall: ScoreSchema, edgeF1: ScoreSchema, interfaceRecall: ScoreSchema
  }),
  architecture: z.object({
    cases: z.number().int().nonnegative(), detected: z.number().int().nonnegative(),
    issueRecall: ScoreSchema, falsePositives: z.number().int().nonnegative(), falsePositivesPerKloc: z.number().nonnegative(),
    precision: ScoreSchema, details: z.array(z.object({ id: z.string(), passed: z.boolean(), detectedConstraintIds: z.array(z.string()) }))
  }),
  performance: z.object({ incrementalMs: z.number().nullable(), withinFiveSeconds: z.boolean().nullable(), crashFree: z.boolean() }),
  structuralScore: z.number().min(0).max(1), compositeScore: z.number().min(0).max(1).nullable(),
  compositeStatus: z.enum(["complete", "not-evaluated"]), warnings: z.array(z.string()),
  acceptance: z.record(z.string(), z.union([z.boolean(), z.literal("not-evaluated")]))
});

export type EvaluationGroundTruth = z.infer<typeof EvaluationGroundTruthSchema>;
export type ArchitectureMutation = z.infer<typeof ArchitectureMutationSchema>;
export type AgentRun = z.infer<typeof AgentRunSchema>;
export type EvaluationReport = z.infer<typeof EvaluationReportSchema>;
export type Score = z.infer<typeof ScoreSchema>;
