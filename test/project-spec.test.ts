import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { Observation } from "../src/model.js";
import { buildProjectSpec, parseSignature } from "../src/project-spec.js";
import { moduleDependencyMermaid, writeProjectSpecArtifacts } from "../src/project-spec-artifacts.js";
import { queryProjectSpec } from "../src/project-spec-query.js";
import { ArchitectureConstraintSchema, PROJECT_SPEC_SCHEMA, ProjectSpecSchema } from "../src/project-spec-schema.js";

const fixtureRoot = path.resolve("test/fixtures/arkts-mini");
const sourceFile = "entry/src/main/ets/pages/Index.ets";

function fixtureObservation(): Observation {
  return {
    schemaVersion: 2, engine: "codegraph", repository: "arkts-mini", generatedAt: new Date().toISOString(),
    candidateFiles: [sourceFile], indexedFiles: [sourceFile], diagnostics: [], timingsMs: {},
    review: { status: "not-required", sampledFiles: [] },
    entities: [
      { id: "file:index", kind: "file", name: "Index.ets", qualifiedName: sourceFile, filePath: sourceFile, language: "arkts", startLine: 1, endLine: 20, provenance: "codegraph" },
      { id: "component:index", kind: "component", nativeKind: "struct", name: "Index", qualifiedName: "Index", filePath: sourceFile, language: "arkts", startLine: 1, endLine: 11, decorators: ["Entry", "Component"], metadata: { exported: false }, provenance: "codegraph" },
      { id: "method:build", kind: "method", name: "build", qualifiedName: "Index::build", filePath: sourceFile, language: "arkts", startLine: 6, endLine: 10, metadata: { signature: "()" }, provenance: "codegraph" },
      { id: "function:greeting", kind: "function", name: "greeting", qualifiedName: "greeting", filePath: sourceFile, language: "arkts", startLine: 13, endLine: 15, metadata: { signature: "(name: string): string", exported: true }, provenance: "codegraph" },
      { id: "module:entry", kind: "module", name: "entry", qualifiedName: "arkts-mini::entry", filePath: "build-profile.json5", language: "mixed", startLine: 1, endLine: 1, metadata: { root: "entry", manifest: "build-profile.json5", ecosystem: "openharmony" }, provenance: "manifest" }
    ],
    relations: [
      { id: "edge:component-build", kind: "contains", source: "component:index", target: "method:build", sourceName: "Index", targetName: "Index::build", filePath: sourceFile, resolution: "internal", provenance: "codegraph" },
      { id: "edge:module-file", kind: "contains", source: "module:entry", target: "file:index", sourceName: "entry", targetName: sourceFile, filePath: sourceFile, resolution: "internal", provenance: "manifest" }
    ]
  };
}

describe("ProjectSpec Core", () => {
  it("builds a versioned, evidence-linked deterministic SPEC from the ArkTS fixture", () => {
    expect(fs.existsSync(path.join(fixtureRoot, sourceFile))).toBe(true);
    const spec = buildProjectSpec(fixtureObservation(), fixtureRoot);
    expect(ProjectSpecSchema.safeParse(spec).success).toBe(true);
    expect(spec.schema).toBe(PROJECT_SPEC_SCHEMA);
    expect(spec.modules).toHaveLength(1);
    expect(spec.interfaces.map(item => item.kind).sort()).toEqual(["component-api", "function-api"]);
    expect(spec.interfaces.every(item => item.evidence[0].filePath === sourceFile)).toBe(true);
    expect(spec.coverage.structuralCoverage).toBe(1);
    expect(spec.coverage.semanticCompleteness).toBe(0);
    expect(spec.constraints[0].status).toBe("candidate");
  });

  it("supports project, module, interface and evidence disclosure levels", () => {
    const spec = buildProjectSpec(fixtureObservation(), fixtureRoot);
    const project = queryProjectSpec(spec, { level: "project" });
    expect(project.level).toBe("project");
    const module = queryProjectSpec(spec, { level: "module", id: "entry" });
    expect(module.level === "module" && module.interfaces).toHaveLength(2);
    const interfaceResult = queryProjectSpec(spec, { level: "interface", id: "greeting" });
    expect(interfaceResult.level === "interface" && interfaceResult.interface.operations[0].returnType).toBe("string");
    const evidence = queryProjectSpec(spec, { level: "evidence", id: "function:greeting" });
    expect(evidence.level === "evidence" && evidence.references).toHaveLength(1);
  });

  it("writes decomposed artifacts and a deterministic Mermaid architecture view", () => {
    const target = fs.mkdtempSync(path.join(os.tmpdir(), "project-spec-test-"));
    try {
      const spec = buildProjectSpec(fixtureObservation(), fixtureRoot);
      const summary = writeProjectSpecArtifacts(target, spec);
      expect(fs.existsSync(path.join(target, summary.consolidated))).toBe(true);
      expect(fs.existsSync(path.join(target, summary.architectureView.mermaid))).toBe(true);
      expect(moduleDependencyMermaid(spec.views.moduleDependencies)).toContain('N1["entry"]');
    } finally { fs.rmSync(target, { recursive: true, force: true }); }
  });

  it("provides a validated architecture-constraint schema", () => {
    const constraint = buildProjectSpec(fixtureObservation(), fixtureRoot).constraints[0];
    expect(ArchitectureConstraintSchema.safeParse(constraint).success).toBe(true);
  });

  it("parses structural function contracts without an LLM", () => {
    expect(parseSignature("(name: string, options?: Map<string, number>): Promise<Result>")).toEqual({
      parameters: [{ name: "name", type: "string", optional: false }, { name: "options", type: "Map<string, number>", optional: true }],
      returnType: "Promise<Result>"
    });
  });
});
