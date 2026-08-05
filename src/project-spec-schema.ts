import { z } from "zod";

export const PROJECT_SPEC_SCHEMA = "deveco.project-spec/v1" as const;

export const EvidenceReferenceSchema = z.object({
  entityId: z.string().min(1),
  relationId: z.string().min(1).optional(),
  filePath: z.string(),
  startLine: z.number().int().nonnegative(),
  endLine: z.number().int().nonnegative(),
  provenance: z.enum(["codegraph", "tree-sitter", "manifest", "synthetic", "manual"]),
  confidence: z.number().min(0).max(1)
});

export const ParameterSpecSchema = z.object({
  name: z.string().min(1), type: z.string().optional(), optional: z.boolean().default(false)
});

export const OperationSpecSchema = z.object({
  id: z.string().min(1), entityId: z.string().min(1), name: z.string().min(1),
  signature: z.string().optional(), parameters: z.array(ParameterSpecSchema), returnType: z.string().optional(),
  preconditions: z.array(z.string()), postconditions: z.array(z.string()), exceptions: z.array(z.string()),
  contractStatus: z.enum(["structural-only", "reviewed"]), evidence: z.array(EvidenceReferenceSchema).min(1)
});

export const ModuleDependencySchema = z.object({
  targetId: z.string().min(1), targetName: z.string().min(1),
  resolution: z.enum(["internal", "external", "unresolved"]),
  relationKinds: z.array(z.string()).min(1), count: z.number().int().positive(),
  evidence: z.array(EvidenceReferenceSchema)
});

export const ModuleSpecSchema = z.object({
  id: z.string().min(1), entityId: z.string().optional(), name: z.string().min(1), root: z.string(),
  manifest: z.string().optional(), ecosystem: z.string().optional(),
  responsibilities: z.array(z.string()), responsibilityStatus: z.enum(["not-established", "generated", "reviewed"]),
  files: z.array(z.string()), languages: z.record(z.string(), z.number().int().nonnegative()),
  interfaceIds: z.array(z.string()), dependencies: z.array(ModuleDependencySchema),
  evidence: z.array(EvidenceReferenceSchema)
});

export const InterfaceSpecSchema = z.object({
  id: z.string().min(1), entityId: z.string().min(1), moduleId: z.string().min(1),
  name: z.string().min(1), qualifiedName: z.string().min(1),
  kind: z.enum(["declared-interface", "class-api", "function-api", "component-api", "type-api"]),
  scope: z.enum(["public", "internal", "unknown"]), protocol: z.string().optional(),
  operations: z.array(OperationSpecSchema),
  preconditions: z.array(z.string()), postconditions: z.array(z.string()), exceptions: z.array(z.string()),
  contractStatus: z.enum(["structural-only", "reviewed"]), evidence: z.array(EvidenceReferenceSchema).min(1)
});

export const ConstraintSelectorSchema = z.object({
  moduleIds: z.array(z.string()).optional(), entityKinds: z.array(z.string()).optional(),
  namePattern: z.string().optional(), resolution: z.enum(["internal", "external", "unresolved"]).optional()
});

export const ArchitectureConstraintSchema = z.object({
  id: z.string().min(1), name: z.string().min(1), description: z.string().min(1),
  severity: z.enum(["info", "warning", "error"]), status: z.enum(["candidate", "accepted", "rejected"]),
  effect: z.enum(["allow", "forbid", "require"]), sourceSelector: ConstraintSelectorSchema,
  relationKinds: z.array(z.string()).min(1), targetSelector: ConstraintSelectorSchema,
  provenance: z.enum(["deterministic", "llm", "human"]), confidence: z.number().min(0).max(1),
  evidence: z.array(EvidenceReferenceSchema)
});

export const CoverageDimensionSchema = z.object({
  id: z.string().min(1), scope: z.enum(["structural", "semantic"]), eligible: z.number().int().nonnegative(),
  covered: z.number().int().nonnegative(), ratio: z.number().min(0).max(1).nullable(),
  definition: z.string().min(1), missingIds: z.array(z.string())
});

export const CoverageLedgerSchema = z.object({
  structuralCoverage: z.number().min(0).max(1).nullable(),
  semanticCompleteness: z.number().min(0).max(1).nullable(),
  dimensions: z.array(CoverageDimensionSchema), generatedAt: z.string().datetime()
});

export const ArchitectureViewNodeSchema = z.object({
  id: z.string().min(1), label: z.string().min(1), kind: z.enum(["module", "external"]), metadata: z.record(z.string(), z.unknown()).optional()
});
export const ArchitectureViewEdgeSchema = z.object({
  id: z.string().min(1), source: z.string().min(1), target: z.string().min(1),
  label: z.string().min(1), relationKinds: z.array(z.string()).min(1), count: z.number().int().positive()
});
export const ArchitectureViewSchema = z.object({
  id: z.string().min(1), name: z.string().min(1), type: z.literal("module-dependency"),
  nodes: z.array(ArchitectureViewNodeSchema), edges: z.array(ArchitectureViewEdgeSchema), generatedAt: z.string().datetime()
});

export const ProjectSpecSchema = z.object({
  schema: z.literal(PROJECT_SPEC_SCHEMA), specVersion: z.string().regex(/^1\./), generatedAt: z.string().datetime(),
  repository: z.object({ id: z.string().min(1), root: z.string(), observationSchemaVersion: z.number().int().positive() }),
  modules: z.array(ModuleSpecSchema), interfaces: z.array(InterfaceSpecSchema),
  constraints: z.array(ArchitectureConstraintSchema), coverage: CoverageLedgerSchema,
  views: z.object({ moduleDependencies: ArchitectureViewSchema }),
  evidenceIndex: z.record(z.string(), z.array(EvidenceReferenceSchema)),
  validation: z.object({ status: z.enum(["valid", "invalid"]), issues: z.array(z.string()) })
});

export type EvidenceReference = z.infer<typeof EvidenceReferenceSchema>;
export type OperationSpec = z.infer<typeof OperationSpecSchema>;
export type ModuleSpec = z.infer<typeof ModuleSpecSchema>;
export type InterfaceSpec = z.infer<typeof InterfaceSpecSchema>;
export type ArchitectureConstraint = z.infer<typeof ArchitectureConstraintSchema>;
export type CoverageLedger = z.infer<typeof CoverageLedgerSchema>;
export type ArchitectureView = z.infer<typeof ArchitectureViewSchema>;
export type ProjectSpec = z.infer<typeof ProjectSpecSchema>;
