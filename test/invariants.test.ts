import { describe, expect, it } from "vitest";
import type { Entity, Relation } from "../src/model.js";
import { classifyResolution } from "../src/codegraph-engine.js";

describe("graph invariant", () => {
  it("requires both endpoints for internal relations", () => {
    const entities: Entity[] = [
      { id: "a", kind: "file", name: "a", qualifiedName: "a", filePath: "a.ts", language: "typescript", startLine: 1, endLine: 1, provenance: "synthetic" },
      { id: "b", kind: "function", name: "b", qualifiedName: "a::b", filePath: "a.ts", language: "typescript", startLine: 1, endLine: 1, provenance: "codegraph" }
    ];
    const relation: Relation = { id: "e", kind: "contains", source: "a", target: "b", sourceName: "a", targetName: "b", filePath: "a.ts", resolution: "internal", provenance: "codegraph" };
    const ids = new Set(entities.map(entity => entity.id));
    expect(ids.has(relation.source) && ids.has(relation.target)).toBe(true);
  });
});

describe("relation resolution", () => {
  const base: Entity = { id: "target", kind: "function", name: "target", qualifiedName: "src/a.ts::target", filePath: "src/a.ts", language: "typescript", startLine: 1, endLine: 1, provenance: "codegraph" };

  it("only treats targets from indexed repository files as internal", () => {
    expect(classifyResolution("calls", base, new Set(["src/a.ts"]))).toBe("internal");
    expect(classifyResolution("calls", { ...base, filePath: "vendor/a.ts" }, new Set(["src/a.ts"]))).toBe("external");
  });

  it("recognizes CodeGraph external import placeholders", () => {
    const imported: Entity = { ...base, kind: "import", name: "@ohos.foo", qualifiedName: "@ohos.foo", filePath: "src/a.ts" };
    expect(classifyResolution("imports", imported, new Set(["src/a.ts"]))).toBe("external");
  });
});
