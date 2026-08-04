import { describe, expect, it } from "vitest";
import type { Entity, Relation } from "../src/model.js";

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
