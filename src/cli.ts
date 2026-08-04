#!/usr/bin/env node
import { Command } from "commander";
import { loadConfig } from "./config.js";
import { evaluateExisting, initializeGroundTruth, runRepository } from "./runner.js";

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

program.parseAsync().catch(error => { console.error(error instanceof Error ? error.stack : error); process.exitCode = 1; });
