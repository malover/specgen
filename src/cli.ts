#!/usr/bin/env node
import { Command } from "commander";
import { loadConfig } from "./config.js";
import { evaluateExisting, generateProjectSpecExisting, initializeGroundTruth, queryProjectSpecExisting, runRepository } from "./runner.js";

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
