import fs from "node:fs";
import path from "node:path";
import JSON5 from "json5";
import fg from "fast-glob";
import type { Entity, Relation } from "./model.js";
import { normalize, stableId } from "./files.js";
import { withId } from "./relations.js";

interface Structure { entities: Entity[]; relations: Relation[] }

export function discoverProjectStructure(repoPath: string, repositoryId: string, repositoryName: string, graphEntities: Entity[]): Structure {
  const result: Structure = { entities: [], relations: [] };
  const manifests = fg.sync([
    "**/module.json5", "**/build-profile.json5", "**/oh-package.json5", "**/package.json",
    "**/pyproject.toml", "**/Cargo.toml", "**/go.mod", "**/pom.xml"
  ], { cwd: repoPath, onlyFiles: true, ignore: ["**/node_modules/**", "**/oh_modules/**", "**/build/**", "**/.git/**"] }).map(normalize);

  const moduleRoots = new Map<string, { id: string; name: string; manifest: string }>();
  const packageRoots = new Map<string, { id: string; name: string; manifest: string }>();
  for (const relative of manifests) {
    const basename = path.posix.basename(relative);
    if (basename === "module.json5") {
      const parsed = readJson5(path.join(repoPath, relative));
      const moduleRoot = relative.replace(/\/src\/main\/module\.json5$/i, "");
      const name = stringAt(parsed, ["module", "name"]) ?? path.posix.basename(moduleRoot);
      addModule(moduleRoot, name, relative);
    } else if (basename === "build-profile.json5") {
      const parsed = readJson5(path.join(repoPath, relative));
      const modules = Array.isArray(parsed?.modules) ? parsed.modules : [];
      for (const item of modules) if (item && typeof item === "object") {
        const value = item as Record<string, unknown>;
        if (typeof value.name === "string" && typeof value.srcPath === "string") {
          const root = path.posix.normalize(path.posix.join(path.posix.dirname(relative), normalize(value.srcPath.replace(/^\.\//, ""))));
          addModule(root, value.name, relative);
        }
      }
    } else {
      addPackage(relative, packageName(repoPath, relative));
    }
  }

  for (const [root, module] of moduleRoots) {
    for (const file of graphEntities.filter(entity => entity.kind === "file" && isBelow(entity.filePath, root))) {
      result.relations.push(withId({
        kind: "contains", source: module.id, target: file.id, sourceName: module.name,
        targetName: file.qualifiedName, filePath: file.filePath, resolution: "internal", provenance: "manifest"
      }));
    }
  }
  for (const [root, projectPackage] of packageRoots) {
    for (const file of graphEntities.filter(entity => entity.kind === "file" && isBelow(entity.filePath, root))) {
      result.relations.push(withId({
        kind: "contains", source: projectPackage.id, target: file.id, sourceName: projectPackage.name,
        targetName: file.qualifiedName, filePath: file.filePath, resolution: "internal", provenance: "manifest"
      }));
    }
  }
  return result;

  function addModule(root: string, name: string, manifest: string): void {
    const normalizedRoot = normalize(root === "." ? "" : root).replace(/\/$/, "");
    if (moduleRoots.has(normalizedRoot)) return;
    const id = `module:${stableId(`${normalizedRoot}:${name}`)}`;
    const entity: Entity = {
      id, kind: "module", name, qualifiedName: `${repositoryName}::${name}`, filePath: manifest,
      language: "mixed", startLine: 1, endLine: 1, metadata: { root: normalizedRoot, manifest, ecosystem: "openharmony" }, provenance: "manifest"
    };
    moduleRoots.set(normalizedRoot, { id, name, manifest }); result.entities.push(entity);
    result.relations.push(withId({ kind: "contains", source: repositoryId, target: id, sourceName: repositoryName, targetName: entity.qualifiedName, filePath: manifest, resolution: "internal", provenance: "manifest" }));
  }

  function addPackage(manifest: string, name: string): void {
    const root = path.posix.dirname(manifest) === "." ? "" : path.posix.dirname(manifest);
    if (packageRoots.has(root)) return;
    const id = `package:${stableId(`${manifest}:${name}`)}`;
    const entity: Entity = {
      id, kind: "package", name, qualifiedName: `${repositoryName}::${name}`, filePath: manifest,
      language: "mixed", startLine: 1, endLine: 1, metadata: { manifest }, provenance: "manifest"
    };
    packageRoots.set(root, { id, name, manifest }); result.entities.push(entity);
    result.relations.push(withId({ kind: "contains", source: repositoryId, target: id, sourceName: repositoryName, targetName: entity.qualifiedName, filePath: manifest, resolution: "internal", provenance: "manifest" }));
  }
}

function readJson5(file: string): Record<string, unknown> | undefined {
  try { return JSON5.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>; } catch { return undefined; }
}
function stringAt(value: Record<string, unknown> | undefined, keys: string[]): string | undefined {
  let current: unknown = value;
  for (const key of keys) current = current && typeof current === "object" ? (current as Record<string, unknown>)[key] : undefined;
  return typeof current === "string" ? current : undefined;
}
function packageName(repoPath: string, relative: string): string {
  if (path.posix.basename(relative) === "package.json") {
    try { const value = JSON.parse(fs.readFileSync(path.join(repoPath, relative), "utf8")); if (typeof value.name === "string") return value.name; } catch { /* fallback */ }
  }
  return path.posix.basename(path.posix.dirname(relative)) || path.basename(repoPath);
}
function isBelow(file: string, root: string): boolean { return !root || file === root || file.startsWith(`${root}/`); }
