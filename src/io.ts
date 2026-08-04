import fs from "node:fs";
import path from "node:path";

export function writeJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

export function readJson<T>(file: string): T | undefined {
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) as T : undefined;
}
