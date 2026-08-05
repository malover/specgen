#!/usr/bin/env node
import path from "node:path";
import { Command } from "commander";
import { loadConfig } from "./config.js";
import { evaluateExisting, generateProjectSpecExisting, initializeGroundTruth, queryProjectSpecExisting, runRepository } from "./runner.js";
import { evaluateRepositoryArtifacts } from "./evaluation-runner.js";
import { readJson, writeJson } from "./io.js";
import { writeArchitectureReviewSeed } from "./architecture-evaluation.js";
import type { ProjectSpec } from "./project-spec-schema.js";
import { extractCodeGraph } from "./codegraph-engine.js";
import { buildProjectSpec } from "./project-spec.js";
import { checkArchitecture } from "./architecture-check.js";
import { ArchitectureConstraintSchema } from "./project-spec-schema.js";
import { runFullEvaluation } from "./full-evaluation.js";

const program = new Command().name("specgen").description("Generate and deterministically evaluate Project SPEC artifacts");
const withConfig = (command: Command) => command.option("-c, --config <file>", "configuration file", "spike.config.json");

withConfig(program.command("all").description("index and build Project SPEC for all configured repositories"))
  .option("--independent-oracle", "also run the optional Tree-sitter diagnostic comparison", false)
  .action(async ({ config: file, independentOracle }) => {
    const config = loadConfig(file);
    for (const repo of config.repositories) await runRepository(repo, config, { independentOracle });
  });

withConfig(program.command("run").description("run one configured repository")).requiredOption("--repo <id>")
  .option("--independent-oracle", "also run the optional Tree-sitter diagnostic comparison", false)
  .action(async ({ config: file, repo: id, independentOracle }) => {
    const config = loadConfig(file);
    const repo = config.repositories.find(item => item.id === id);
    if (!repo) throw new Error(`Unknown repository id: ${id}`);
    await runRepository(repo, config, { independentOracle });
  });

withConfig(program.command("evaluate-full").description("run indexing, Project SPEC, structural quality, incremental checks, and architecture mutations; write one report"))
  .option("--evaluation-dir <directory>", "ground truth and architecture cases", "./evaluation")
  .option("--independent-oracle", "include optional Tree-sitter parser agreement diagnostics", false)
  .action(async ({ config: file, evaluationDir, independentOracle }) => {
    const report = await runFullEvaluation(loadConfig(file), {
      evaluationDirectory: evaluationDir,
      independentOracle
    });
    if (report.executiveSummary.repositoriesFailed > 0) process.exitCode = 2;
  });

withConfig(program.command("init-ground-truth").description("seed editable review files from CodeGraph output"))
  .action(({ config: file }) => {
    const config = loadConfig(file);
    config.repositories.forEach(repo => initializeGroundTruth(repo, config));
  });

withConfig(program.command("evaluate").description("recalculate metrics from reviewed ground truth without indexing"))
  .action(({ config: file }) => {
    const config = loadConfig(file);
    config.repositories.forEach(repo => evaluateExisting(repo, config));
  });

withConfig(program.command("evaluate-quality").description("score structural quality, reviewed accuracy and architecture mutations without reindexing"))
  .option("--evaluation-dir <directory>", "ground truth and architecture cases", "./evaluation")
  .option("--repo <id>", "evaluate one configured repository")
  .option("--independent-oracle", "use an existing optional Tree-sitter observation as a diagnostic oracle", false)
  .action(({ config: file, evaluationDir, repo: id, independentOracle }) => {
    const config = loadConfig(file);
    const repositories = id ? config.repositories.filter(item => item.id === id) : config.repositories;
    if (!repositories.length) throw new Error(`Unknown repository id: ${id}`);
    repositories.forEach(repo => evaluateRepositoryArtifacts(repo, config, evaluationDir, { independentOracle }));
  });

withConfig(program.command("init-architecture-eval").description("create reviewable architecture constraints and mutation cases from current module boundaries"))
  .requiredOption("--repo <id>")
  .option("--evaluation-dir <directory>", "evaluation data directory", "./evaluation")
  .option("--force", "replace existing review files", false)
  .action(({ config: file, evaluationDir, repo: id, force }) => {
    const config = loadConfig(file);
    const repo = config.repositories.find(item => item.id === id);
    if (!repo) throw new Error(`Unknown repository id: ${id}`);
    const specFile = path.join(config.outputDirectory, repo.id, "project-spec", "project-spec.json");
    const spec = readJson<ProjectSpec>(specFile);
    if (!spec) throw new Error(`Missing Project SPEC: ${specFile}`);
    const result = writeArchitectureReviewSeed(spec, repo.id, evaluationDir, force);
    console.log(`${repo.id}: created ${result.candidates} candidate constraints. Review them and change selected statuses to accepted before evaluation.`);
  });

program.command("architecture-check-repo").description("index a repository and check it against reviewed architecture constraints")
  .requiredOption("--repository <path>")
  .option("--constraints <file>")
  .option("--output <file>", "architecture issue JSON", ".specgen-architecture-issues.json")
  .option("--max-issues <count>", "allowed baseline issue count", "0")
  .action(async ({ repository, constraints: constraintFile, output, maxIssues }) => {
    const raw = constraintFile ? readJson<unknown>(constraintFile) : [];
    if (!Array.isArray(raw)) throw new Error("Architecture constraints must be a JSON array.");
    const constraints = raw.map(item => ArchitectureConstraintSchema.parse(item));
    const extracted = await extractCodeGraph(path.basename(path.resolve(repository)), path.resolve(repository));
    try {
      const spec = { ...buildProjectSpec(extracted.observation, path.resolve(repository)), constraints };
      const issues = checkArchitecture(spec);
      writeJson(output, issues);
      console.log(`Architecture check: ${issues.length} issue(s); ${output}`);
      if (issues.length > Number.parseInt(maxIssues, 10)) process.exitCode = 2;
    } finally {
      extracted.graph.close();
    }
  });

withConfig(program.command("project-spec").description("generate Project SPEC artifacts from an existing CodeGraph observation"))
  .requiredOption("--repo <id>")
  .action(({ config: file, repo: id }) => {
    const config = loadConfig(file);
    const repo = config.repositories.find(item => item.id === id);
    if (!repo) throw new Error(`Unknown repository id: ${id}`);
    generateProjectSpecExisting(repo, config);
  });

withConfig(program.command("query").description("query Project SPEC with progressive disclosure"))
  .requiredOption("--repo <id>")
  .requiredOption("--level <level>")
  .option("--id <id>")
  .action(({ config: file, repo: repositoryId, level, id }) => {
    const config = loadConfig(file);
    const repo = config.repositories.find(item => item.id === repositoryId);
    if (!repo) throw new Error(`Unknown repository id: ${repositoryId}`);
    if (!["project", "module", "interface", "evidence"].includes(level)) throw new Error(`Unknown disclosure level: ${level}`);
    if (level !== "project" && !id) throw new Error(`--id is required for ${level} disclosure`);
    const query = level === "project"
      ? { level: "project" as const }
      : { level, id } as Parameters<typeof queryProjectSpecExisting>[2];
    console.log(JSON.stringify(queryProjectSpecExisting(repo, config, query), null, 2));
  });

program.parseAsync().catch(error => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
