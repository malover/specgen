import type { Language, NodeKind } from "@colbymchenry/codegraph";

export type EntityKind = "repository" | "directory" | "package" | "external_symbol" | NodeKind;
export type RelationKind =
  | "contains" | "calls" | "imports" | "exports" | "extends" | "implements"
  | "references" | "type_of" | "returns" | "instantiates" | "overrides" | "decorates"
  | "depends_on" | "builds" | "tests" | "configures" | "bridges_to";
export type Resolution = "internal" | "external" | "unresolved";
export type FileRole = "source" | "test" | "build-tooling" | "configuration";

export interface DiagnosticDetails {
  filesByRole: Record<FileRole, string[]>;
  missingIndexedFiles: string[];
  parserFailures: Array<{ file: string; errors: string[] }>;
  actionableZeroSymbolFiles: string[];
  expectedZeroSymbolFiles: string[];
  orphanRelationIds: string[];
}

export interface Entity {
  id: string;
  kind: EntityKind;
  nativeKind?: string;
  name: string;
  qualifiedName: string;
  filePath: string;
  language: Language | "mixed" | "none";
  startLine: number;
  endLine: number;
  decorators?: string[];
  metadata?: Record<string, unknown>;
  provenance: "codegraph" | "tree-sitter" | "manifest" | "synthetic" | "manual";
}

export interface Relation {
  id: string;
  kind: RelationKind;
  source: string;
  target: string;
  sourceName: string;
  targetName: string;
  filePath?: string;
  resolution: Resolution;
  metadata?: Record<string, unknown>;
  provenance: "codegraph" | "tree-sitter" | "manifest" | "synthetic" | "manual";
}

export interface ReviewInfo {
  status: "not-required" | "unreviewed" | "reviewed";
  sampledFiles: string[];
  reviewer?: string;
  reviewedAt?: string;
  notes?: string;
}

export interface Observation {
  schemaVersion: 2;
  engine: "codegraph" | "tree-sitter" | "ground-truth";
  repository: string;
  generatedAt: string;
  candidateFiles: string[];
  indexedFiles: string[];
  fileRoles?: Record<string, FileRole>;
  entities: Entity[];
  relations: Relation[];
  diagnostics: string[];
  diagnosticDetails?: DiagnosticDetails;
  timingsMs: Record<string, number>;
  review: ReviewInfo;
}

export interface RepoConfig { id: string; size: "small" | "medium" | "large"; path: string }
export interface SpikeConfig {
  repositories: RepoConfig[];
  outputDirectory: string;
  incremental: { trials: number; timeoutMs: number };
  sampling: { small: number; medium: number; large: number; seed: string };
  acceptance: {
    fileCoverage: number;
    entityRecall: number;
    edgePrecision: number;
    incrementalStalenessMs: number;
  };
}
