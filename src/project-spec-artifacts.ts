import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { writeJson } from "./io.js";
import { projectIndex } from "./project-spec-query.js";
import {
  ArchitectureConstraintSchema, InterfaceSpecSchema, ModuleSpecSchema, ProjectSpecSchema,
  type ArchitectureView, type ProjectSpec
} from "./project-spec-schema.js";

export interface ProjectSpecArtifactSummary {
  directory: string;
  consolidated: string;
  projectIndex: string;
  modules: number;
  interfaces: number;
  constraints: number;
  structuralCoverage: number | null;
  semanticCompleteness: number | null;
  schemas: string[];
  architectureView: { nodes: number; edges: number; json: string; mermaid: string };
}

export function writeProjectSpecArtifacts(repositoryOutput: string, spec: ProjectSpec): ProjectSpecArtifactSummary {
  const root = path.join(repositoryOutput, "project-spec");
  const relative = (file: string) => path.relative(repositoryOutput, file).split(path.sep).join("/");
  const consolidated = path.join(root, "project-spec.json");
  const project = path.join(root, "project.json");
  writeJson(consolidated, spec); writeJson(project, projectIndex(spec));
  for (const module of spec.modules) writeJson(path.join(root, "modules", `${artifactName(module.id)}.json`), module);
  for (const interfaceSpec of spec.interfaces) writeJson(path.join(root, "interfaces", `${artifactName(interfaceSpec.id)}.json`), interfaceSpec);
  writeJson(path.join(root, "constraints.json"), spec.constraints);
  writeJson(path.join(root, "coverage.json"), spec.coverage);
  const schemaFiles = [
    writeSchema(root, "project-spec.v1.schema.json", ProjectSpecSchema, "deveco.project-spec/v1"),
    writeSchema(root, "module-spec.v1.schema.json", ModuleSpecSchema, "deveco.module-spec/v1"),
    writeSchema(root, "interface-spec.v1.schema.json", InterfaceSpecSchema, "deveco.interface-spec/v1"),
    writeSchema(root, "architecture-constraint.v1.schema.json", ArchitectureConstraintSchema, "deveco.architecture-constraint/v1")
  ];
  const viewJson = path.join(root, "views", "module-dependencies.json");
  const viewMermaid = path.join(root, "views", "module-dependencies.mmd");
  writeJson(viewJson, spec.views.moduleDependencies);
  fs.mkdirSync(path.dirname(viewMermaid), { recursive: true });
  fs.writeFileSync(viewMermaid, `${moduleDependencyMermaid(spec.views.moduleDependencies)}\n`, "utf8");
  return {
    directory: relative(root), consolidated: relative(consolidated), projectIndex: relative(project),
    modules: spec.modules.length, interfaces: spec.interfaces.length, constraints: spec.constraints.length,
    structuralCoverage: spec.coverage.structuralCoverage, semanticCompleteness: spec.coverage.semanticCompleteness,
    schemas: schemaFiles.map(relative),
    architectureView: { nodes: spec.views.moduleDependencies.nodes.length, edges: spec.views.moduleDependencies.edges.length, json: relative(viewJson), mermaid: relative(viewMermaid) }
  };
}

function writeSchema(root: string, name: string, schema: z.ZodType, id: string): string {
  const file = path.join(root, "schemas", name);
  writeJson(file, { $id: id, ...z.toJSONSchema(schema) });
  return file;
}

export function moduleDependencyMermaid(view: ArchitectureView): string {
  const ids = new Map(view.nodes.map((node, index) => [node.id, `N${index + 1}`]));
  const lines = ["flowchart LR"];
  for (const node of view.nodes) lines.push(`    ${ids.get(node.id)}["${escapeLabel(node.label)}"]`);
  for (const edge of view.edges) {
    const source = ids.get(edge.source); const target = ids.get(edge.target);
    if (source && target) lines.push(`    ${source} -->|"${escapeLabel(`${edge.label} (${edge.count})`)}"| ${target}`);
  }
  return lines.join("\n");
}

function artifactName(id: string): string { return id.replace(/[^A-Za-z0-9._-]/g, "_"); }
function escapeLabel(value: string): string { return value.replace(/"/g, "'").replace(/[\r\n]+/g, " "); }
