#!/usr/bin/env node
import path from "node:path";
import { Command } from "commander";
import { loadConfig } from "./config.js";
import { evaluateExisting, generateProjectSpecExisting, initializeGroundTruth, queryProjectSpecExisting, runRepository } from "./runner.js";
import { evaluateRepositoryArtifacts } from "./evaluation-runner.js";
import { compareAgentRuns } from "./agent-evaluation.js";
import { readJson, writeJson } from "./io.js";
import { writeArchitectureReviewSeed } from "./architecture-evaluation.js";
import type { ProjectSpec } from "./project-spec-schema.js";
import { loadAgentExperiment, runAgentExperiment } from "./agent-experiment.js";
import { extractCodeGraph } from "./codegraph-engine.js";
import { buildProjectSpec } from "./project-spec.js";
import { checkArchitecture } from "./architecture-check.js";
import { ArchitectureConstraintSchema } from "./project-spec-schema.js";
import { GeneratedAgentTaskSchema, generateAgentBenchmark, verifyGeneratedAgentTask } from "./agent-benchmark.js";
import { generateLlmJudgeInput, runLlmJudge } from "./llm-judge.js";
import { runOpenRouterAgent } from "./openrouter-agent.js";

const program = new Command().name("arkts-index-spike").description("Evaluate native ArkTS indexing with CodeGraph and direct Tree-sitter");
const withConfig = (command: Command) => command.option("-c, --config <file>", "configuration file", "spike.config.json");

withConfig(program.command("all").description("index, compare and benchmark all three repositories"))
  .action(async ({ config: file }) => {
    const config = loadConfig(file);
    for (const repo of config.repositories) await runRepository(repo, config);
  });

withConfig(program.command("run").description("run one configured repository")).requiredOption("--repo <id>")
  .action(async ({ config: file, repo: id }) => {
    const config = loadConfig(file); const repo = config.repositories.find(item => item.id === id);
    if (!repo) throw new Error(`Unknown repository id: ${id}`);
    await runRepository(repo, config);
  });

withConfig(program.command("init-ground-truth").description("seed editable review files from CodeGraph output"))
  .action(({ config: file }) => { const config = loadConfig(file); config.repositories.forEach(repo => initializeGroundTruth(repo, config)); });

withConfig(program.command("evaluate").description("recalculate metrics from reviewed ground truth without indexing"))
  .action(({ config: file }) => { const config = loadConfig(file); config.repositories.forEach(repo => evaluateExisting(repo, config)); });

withConfig(program.command("evaluate-quality").description("score structural quality, reviewed accuracy and architecture mutations without reindexing"))
  .option("--evaluation-dir <directory>", "ground truth and architecture cases", "./evaluation")
  .option("--repo <id>", "evaluate one configured repository")
  .action(({ config: file, evaluationDir, repo: id }) => {
    const config = loadConfig(file); const repositories = id ? config.repositories.filter(item => item.id === id) : config.repositories;
    if (!repositories.length) throw new Error(`Unknown repository id: ${id}`);
    repositories.forEach(repo => evaluateRepositoryArtifacts(repo, config, evaluationDir));
  });

withConfig(program.command("init-architecture-eval").description("create reviewable architecture constraints and mutation cases from current module boundaries"))
  .requiredOption("--repo <id>").option("--evaluation-dir <directory>", "evaluation data directory", "./evaluation")
  .option("--force", "replace existing review files", false)
  .action(({ config: file, evaluationDir, repo: id, force }) => {
    const config = loadConfig(file); const repo = config.repositories.find(item => item.id === id);
    if (!repo) throw new Error(`Unknown repository id: ${id}`);
    const specFile = path.join(config.outputDirectory, repo.id, "project-spec", "project-spec.json");
    const spec = readJson<ProjectSpec>(specFile); if (!spec) throw new Error(`Missing Project SPEC: ${specFile}`);
    const result = writeArchitectureReviewSeed(spec, repo.id, evaluationDir, force);
    console.log(`${repo.id}: created ${result.candidates} candidate constraints. Review them and change selected statuses to accepted before evaluation.`);
  });

program.command("evaluate-agent").description("compare repeated baseline and Project SPEC agent runs")
  .requiredOption("--runs <file>").option("--output <file>", "comparison JSON", "agent-evaluation.json")
  .action(({ runs, output }) => {
    const input = readJson<unknown>(runs); if (!Array.isArray(input)) throw new Error("Agent run input must be a JSON array.");
    const comparison = compareAgentRuns(input); writeJson(output, comparison);
    console.log(`Agent comparison ready: ${output}; task success delta ${(comparison.delta.taskSuccessRate! * 100).toFixed(1)} percentage points`);
  });

program.command("run-agent-ab").description("run isolated baseline versus Project SPEC agent experiments and compare outcomes")
  .requiredOption("--experiment <file>")
  .action(async ({ experiment }) => {
    const result = await runAgentExperiment(loadAgentExperiment(experiment));
    console.log(`Agent A/B experiment ready: ${result.outputDirectory}; ${result.runs.length} runs; task success delta ${(result.comparison.delta.taskSuccessRate! * 100).toFixed(1)} percentage points`);
  });

program.command("architecture-check-repo").description("index a repository and check it against reviewed architecture constraints")
  .requiredOption("--repository <path>").option("--constraints <file>")
  .option("--output <file>", "architecture issue JSON", ".specgen-architecture-issues.json")
  .option("--max-issues <count>", "allowed baseline issue count", "0")
  .action(async ({ repository, constraints: constraintFile, output, maxIssues }) => {
    const raw = constraintFile ? readJson<unknown>(constraintFile) : []; if (!Array.isArray(raw)) throw new Error("Architecture constraints must be a JSON array.");
    const constraints = raw.map(item => ArchitectureConstraintSchema.parse(item));
    const extracted = await extractCodeGraph(path.basename(path.resolve(repository)), path.resolve(repository));
    try {
      const spec = { ...buildProjectSpec(extracted.observation, path.resolve(repository)), constraints };
      const issues = checkArchitecture(spec); writeJson(output, issues);
      console.log(`Architecture check: ${issues.length} issue(s); ${output}`);
      if (issues.length > Number.parseInt(maxIssues, 10)) process.exitCode = 2;
    } finally { extracted.graph.close(); }
  });

withConfig(program.command("init-agent-benchmark").description("generate objective, isolated coding-agent A/B tasks from public Project SPEC APIs"))
  .requiredOption("--repo <id>").option("--evaluation-dir <directory>", "evaluation data directory", "./evaluation")
  .option("--tasks <count>", "maximum generated tasks", "3")
  .action(({ config: file, evaluationDir, repo: id, tasks }) => {
    const config = loadConfig(file); const repo = config.repositories.find(item => item.id === id);
    if (!repo) throw new Error(`Unknown repository id: ${id}`);
    const projectSpecFile = path.join(config.outputDirectory, repo.id, "project-spec", "project-spec.json");
    const spec = readJson<ProjectSpec>(projectSpecFile); if (!spec) throw new Error(`Missing Project SPEC: ${projectSpecFile}`);
    const result = generateAgentBenchmark(spec, repo.path, projectSpecFile, evaluationDir, Number.parseInt(tasks, 10));
    console.log(`${repo.id}: generated ${result.tasks} objective agent task(s); configure ${result.experimentFile}`);
  });

program.command("verify-generated-task").description("verify an automatically generated agent benchmark task")
  .requiredOption("--task <file>").requiredOption("--repository <path>")
  .action(({ task: taskFile, repository }) => {
    const task = GeneratedAgentTaskSchema.parse(readJson<unknown>(taskFile));
    const result = verifyGeneratedAgentTask(task, path.resolve(repository)); console.log(JSON.stringify(result, null, 2));
    if (!result.passed) process.exitCode = 3;
  });

program.command("llm-judge").description("run an optional non-authoritative OpenRouter judge over supplied claims and evidence")
  .requiredOption("--input <file>").option("--output <file>", "judge result JSON", "llm-judge-result.json")
  .action(async ({ input, output }) => {
    const value = readJson<unknown>(input); if (!value) throw new Error(`Missing LLM judge input: ${input}`);
    writeJson(output, await runLlmJudge(value)); console.log(`Non-authoritative LLM judge result: ${output}`);
  });

withConfig(program.command("init-llm-judge").description("generate optional grounded LLM-judge inputs from Project SPEC dependencies"))
  .requiredOption("--repo <id>").option("--output <file>").option("--items <count>", "maximum claims", "20")
  .action(({ config: file, repo: id, output, items }) => {
    const config = loadConfig(file); const repo = config.repositories.find(item => item.id === id); if (!repo) throw new Error(`Unknown repository id: ${id}`);
    const specFile = path.join(config.outputDirectory, repo.id, "project-spec", "project-spec.json"); const spec = readJson<ProjectSpec>(specFile); if (!spec) throw new Error(`Missing Project SPEC: ${specFile}`);
    const target = output ?? path.join(config.outputDirectory, repo.id, "llm-judge-input.json"); writeJson(target, generateLlmJudgeInput(spec, Number.parseInt(items, 10))); console.log(`${repo.id}: LLM-judge input ready at ${target}`);
  });

program.command("openrouter-agent").description("internal two-step OpenRouter coding-agent adapter used by generated A/B experiments")
  .action(async () => { await runOpenRouterAgent(); });

withConfig(program.command("project-spec").description("generate Project SPEC artifacts from an existing CodeGraph observation"))
  .requiredOption("--repo <id>").action(({ config: file, repo: id }) => {
    const config = loadConfig(file); const repo = config.repositories.find(item => item.id === id);
    if (!repo) throw new Error(`Unknown repository id: ${id}`);
    generateProjectSpecExisting(repo, config);
  });

withConfig(program.command("query").description("query Project SPEC with progressive disclosure"))
  .requiredOption("--repo <id>").requiredOption("--level <level>").option("--id <id>")
  .action(({ config: file, repo: repositoryId, level, id }) => {
    const config = loadConfig(file); const repo = config.repositories.find(item => item.id === repositoryId);
    if (!repo) throw new Error(`Unknown repository id: ${repositoryId}`);
    if (!["project", "module", "interface", "evidence"].includes(level)) throw new Error(`Unknown disclosure level: ${level}`);
    if (level !== "project" && !id) throw new Error(`--id is required for ${level} disclosure`);
    const query = level === "project" ? { level: "project" as const } : { level, id } as Parameters<typeof queryProjectSpecExisting>[2];
    console.log(JSON.stringify(queryProjectSpecExisting(repo, config, query), null, 2));
  });

program.parseAsync().catch(error => { console.error(error instanceof Error ? error.stack : error); process.exitCode = 1; });
