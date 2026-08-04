import path from "node:path";
import { createRequire } from "node:module";
import fg from "fast-glob";
import type { Language } from "@colbymchenry/codegraph";

const require = createRequire(import.meta.url);
const sdk = require("@colbymchenry/codegraph") as { detectLanguage(filePath: string): Language };
const ignores = [
  "**/node_modules/**", "**/oh_modules/**", "**/vendor/**", "**/build/**", "**/dist/**",
  "**/target/**", "**/.git/**", "**/.codegraph/**", "**/.hvigor/**", "**/.idea/**"
];

export async function supportedSourceFiles(repoPath: string): Promise<string[]> {
  const files = await fg(["**/*"], { cwd: repoPath, onlyFiles: true, dot: true, ignore: ignores });
  return files.map(normalize).filter(file => sdk.detectLanguage(file) !== "unknown").sort();
}

export async function arktsFiles(repoPath: string): Promise<string[]> {
  return (await supportedSourceFiles(repoPath)).filter(file => sdk.detectLanguage(file) === "arkts");
}

export const languageOf = (file: string): Language => sdk.detectLanguage(file);
export const normalize = (value: string): string => value.split(path.sep).join("/");
export const keyName = (name: string): string => name.replace(/[^A-Za-z0-9_$]/g, "").toLowerCase();
export const stableId = (value: string): string => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) hash = Math.imul(hash ^ value.charCodeAt(index), 16777619);
  return (hash >>> 0).toString(16).padStart(8, "0");
};
