import fs from "node:fs";
import path from "node:path";
import type { CodeGraph } from "@colbymchenry/codegraph";
import { arktsFiles, supportedSourceFiles } from "./files.js";

export async function benchmarkIncremental(graph: CodeGraph, repoPath: string, trials: number, timeoutMs = 10000): Promise<{ samplesMs: number[]; medianMs: number }> {
  const arkts = await arktsFiles(repoPath);
  const files = arkts.length ? arkts : await supportedSourceFiles(repoPath);
  if (!files.length) throw new Error("No .ets or .ts file is available for the incremental benchmark");
  const target = path.join(repoPath, files[0]);
  const original = fs.readFileSync(target, "utf8");
  const samples: number[] = [];
  try {
    for (let trial = 0; trial < trials; trial++) {
      const marker = `\n// specgen-index-spike-${Date.now()}-${trial}\n`;
      fs.appendFileSync(target, marker);
      const start = performance.now();
      await syncWithTimeout(graph, files[0], timeoutMs);
      samples.push(performance.now() - start);
      fs.writeFileSync(target, original);
      await graph.sync({ paths: [files[0]] });
    }
  } finally {
    fs.writeFileSync(target, original);
    await graph.sync({ paths: [files[0]] });
  }
  const ordered = [...samples].sort((a, b) => a - b);
  return { samplesMs: samples, medianMs: ordered[Math.floor(ordered.length / 2)] ?? Number.NaN };
}

async function syncWithTimeout(graph: CodeGraph, file: string, timeoutMs: number): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`Incremental sync exceeded ${timeoutMs} ms`)), timeoutMs);
  try { await graph.sync({ paths: [file], signal: controller.signal }); }
  finally { clearTimeout(timer); }
}
