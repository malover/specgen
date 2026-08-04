import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { SpikeConfig } from "./model.js";

const schema = z.object({
  repositories: z.array(z.object({
    id: z.string().min(1), size: z.enum(["small", "medium", "large"]), path: z.string().min(1)
  })).length(3),
  outputDirectory: z.string().default("./results"),
  incremental: z.object({ trials: z.number().int().positive().default(3), timeoutMs: z.number().positive().default(10000) }),
  sampling: z.object({
    small: z.number().int().nonnegative().default(0),
    medium: z.number().int().nonnegative().default(20),
    large: z.number().int().nonnegative().default(30),
    seed: z.string().default("specgen-phase1-v2")
  }).default({ small: 0, medium: 20, large: 30, seed: "specgen-phase1-v2" }),
  acceptance: z.object({
    fileCoverage: z.number().min(0).max(1).default(0.95),
    entityRecall: z.number().min(0).max(1).default(0.85),
    edgePrecision: z.number().min(0).max(1).default(0.90),
    incrementalStalenessMs: z.number().positive().default(5000)
  })
});

export function loadConfig(configPath: string): SpikeConfig {
  const absolute = path.resolve(configPath);
  const parsed = schema.parse(JSON.parse(fs.readFileSync(absolute, "utf8")));
  parsed.repositories = parsed.repositories.map(repo => ({ ...repo, path: path.resolve(path.dirname(absolute), repo.path) }));
  parsed.outputDirectory = path.resolve(path.dirname(absolute), parsed.outputDirectory);
  return parsed;
}
