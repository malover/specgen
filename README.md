# SpecGen ProjectSpec Core and Evaluation — OpenHarmony Profile

Version 0.5 adds a repeatable evaluation system to the deterministic ProjectSpec Core. It remains entirely TypeScript and launches no Python runtime, MCP server, or database service.

The engine indexes every language CodeGraph supports and then applies an OpenHarmony ecosystem profile for `module.json5`, `build-profile.json5`, `oh-package.json5` and related manifests. ArkTS additionally receives an independent direct Tree-sitter comparison.

The default indexing, Project SPEC and quality-evaluation path makes no LLM calls. OpenRouter is optional for coding-agent A/B experiments and the separately labelled non-authoritative LLM judge.

## What changed in v0.6

- No ArkTS review is required for the normal evaluation workflow.
- Automatic silver ground truth comes from the independent Tree-sitter extractor plus direct source verification.
- Silver agreement is confidence-labelled and kept separate from contractual human-reviewed accuracy.
- Universal architecture mutations automatically test unresolved targets, missing internal modules, self-dependencies and module cycles.
- Baseline architecture findings are reported separately from mutation false positives.
- Objective agent tasks are generated from real public APIs and verified against isolated repository copies.
- A built-in two-step OpenRouter coding-agent adapter makes the A/B benchmark runnable before DevEco integration.
- Build, test and architecture verifiers act as behavioural oracles for agent changes.
- An optional OpenRouter LLM judge evaluates supplied claims and evidence but never controls deterministic acceptance.

## What changed in v0.5

- Automatic structural metrics for file, entity, relationship and interface coverage.
- Evidence-reference validity and completeness, schema validity, orphan and duplicate rates, deterministic-ID stability and incremental freshness.
- Reusable reviewed ground-truth format with entity, relation and interface precision/recall/F1.
- Generic architecture-constraint checker for `forbid`, `allow` and `require` rules.
- Seeded architecture mutation evaluation with issue recall, precision and false positives/KLOC.
- Automatic mutation generation for accepted forbidden-dependency constraints with explicit module selectors.
- Baseline-versus-Project-SPEC agent evaluation for task success, builds, tests, architecture compliance, time, tokens, files changed, repair iterations and retrieval accuracy.
- Machine-readable `evaluation-report.json` and client-readable `evaluation-report.md`.
- A reviewed two-module ArkTS fixture, architecture rule, mutation and agent-run example.

### Evaluation corrections in v0.5.1

- A reviewed legacy `ground-truth.v2.json` is converted and reused automatically; accuracy review is not duplicated.
- Broad entity/edge promotion rates are now informational and no longer pretend that every internal graph item must be copied into the top-level SPEC.
- Coverage is split into module ownership, public APIs, cross-module dependencies, public-API relationships, graph integrity and call-graph integrity.
- Architecture constraints and mutation cases can be initialized from observed module directions. They remain candidates until a human accepts them.
- The agent A/B layer can now execute a configurable agent command in fresh, isolated repository copies and run objective build, test and architecture verification commands.

## What changed in v0.4

- Versioned Zod and JSON Schemas for Project, Module, Interface, and Architecture Constraint SPEC records.
- Deterministic module and public/interface API records with file/line evidence.
- Structural signatures, parameters, return types, and explicit unknown behavioral contracts.
- Structural coverage and semantic-completeness ledgers are reported separately.
- Project, module, interface, and evidence progressive-disclosure queries.
- Candidate architecture-constraint representation; inferred rules are not silently activated.
- Deterministic JSON and Mermaid module-dependency architecture views.
- Decomposed artifacts that can be loaded without placing the full repository SPEC in agent context.
- Topology-only and resolution-aware parser agreement are reported independently.
- Architecture-oriented review sampling across interfaces, services, components, boundaries, languages, modules, tests, and tooling.
- v0.3 relation resolution, mixed-language graph, diagnostics, and incremental indexing remain intact.

## Acceptance targets

| Metric | Target |
|---|---:|
| Supported-source file coverage | ≥ 95% |
| Human-reviewed entity recall | ≥ 85% |
| Human-reviewed edge precision | ≥ 90% |
| Large repository | no crash |
| Incremental update | ≤ 5 seconds |

## Requirements

- Node.js 22.5–24.x.
- Three local repositories of different sizes.
- Windows PowerShell, macOS or Linux.

## Install

```powershell
Copy-Item spike.config.example.json spike.config.json
npm install
npm run check
npm test
```

Edit `spike.config.json`. Example:

```json
{
  "repositories": [
    {
      "id": "arkts-xcomponent",
      "size": "small",
      "path": "D:/arkts-repos/small-xcomponent/code/DocsSample/ArkUISample/ArkTSXComponent"
    },
    {
      "id": "openharmony-screenlock",
      "size": "medium",
      "path": "D:/arkts-repos/medium-screenlock"
    },
    {
      "id": "openharmony-systemui",
      "size": "large",
      "path": "D:/arkts-repos/large-systemui"
    }
  ],
  "outputDirectory": "./results-v4",
  "incremental": { "trials": 3, "timeoutMs": 10000 },
  "sampling": {
    "small": 0,
    "medium": 20,
    "large": 30,
    "seed": "specgen-phase1-v4"
  },
  "acceptance": {
    "fileCoverage": 0.95,
    "entityRecall": 0.85,
    "edgePrecision": 0.90,
    "incrementalStalenessMs": 5000
  }
}
```

`small: 0` means select every semantic source file. Medium and large use architecture-oriented deterministic strata. Up to three configuration files are listed separately and do not consume the semantic accuracy budget.

## Run

### Zero-manual-review evaluation

This is the normal workflow. You do not need to understand or label ArkTS.

```powershell
# 1. Index repositories and generate Project SPEC artifacts.
npm run all -- --config spike.config.json

# 2. Generate automatic silver accuracy, universal mutation and structural reports.
npm run evaluate:quality -- --config spike.config.json
```

Open these files for each repository:

```text
results-v4/<repo>/evaluation-report.md
results-v4/<repo>/evaluation-report.json
results-v4/<repo>/silver-ground-truth.json
```

Interpret the report as follows:

| Result | Meaning |
|---|---|
| Structural score | Deterministic repository-to-SPEC completeness and integrity |
| Silver diagnostic composite | Automatic diagnostic summary; not human contractual accuracy |
| Oracle coverage | Percentage of repository files comparable through the independent Tree-sitter path |
| Entity/edge agreement | CodeGraph agreement with source-verified Tree-sitter labels |
| Architecture issue recall | Percentage of automatically seeded known violations detected |
| Baseline issues | Existing invariant violations found before mutation |
| Evidence validity | Whether SPEC references resolve to real graph entities, relations and files |
| `NOT EVALUATED` in human acceptance | Expected when no human oracle exists; automatic diagnostics still ran |

For a first client demonstration, show structural coverage, oracle coverage, silver agreement, universal architecture recall, incremental time and crash-free status as separate values. Do not rename silver agreement to human precision/recall.

All repositories:

```powershell
npm run all -- --config spike.config.json
```

One repository:

```powershell
npm run spike -- run --repo arkts-xcomponent --config spike.config.json
```

Each repository produces:

```text
results-v4/<repo>/
├── codegraph.observation.json
├── tree-sitter.observation.json
├── incremental.json
├── sample-manifest.json
├── report.json
├── run-status.json
├── project-spec/
│   ├── project-spec.json
│   ├── project.json
│   ├── coverage.json
│   ├── constraints.json
│   ├── modules/*.json
│   ├── interfaces/*.json
│   ├── schemas/*.schema.json
│   └── views/
│       ├── module-dependencies.json
│       └── module-dependencies.mmd
└── crash.json                    # failures only
```

The CodeGraph observation is the complete mixed-language graph. The Tree-sitter observation contains only the independent ArkTS baseline. `report.json` includes their ArkTS agreement, but labels it as agreement rather than ground-truth accuracy.

## ProjectSpec without reindexing

Regenerate deterministic ProjectSpec artifacts from an existing observation:

```powershell
npm run project-spec -- --repo arkts-xcomponent --config spike.config.json
```

## Progressive-disclosure queries

Start with the bounded project index:

```powershell
npm run query -- --repo arkts-xcomponent --level project --config spike.config.json
```

Then request only the needed module, interface, or evidence references:

```powershell
npm run query -- --repo arkts-xcomponent --level module --id entry --config spike.config.json
npm run query -- --repo arkts-xcomponent --level interface --id MyService --config spike.config.json
npm run query -- --repo arkts-xcomponent --level evidence --id "function:<entity-id>" --config spike.config.json
```

The same API is available in TypeScript through `queryProjectSpec(spec, query)`.

```ts
import { buildProjectSpec, queryProjectSpec } from "arkts-indexing-spike";

const spec = buildProjectSpec(codeGraphObservation, repositoryPath);
const project = queryProjectSpec(spec, { level: "project" });
const moduleDetail = queryProjectSpec(spec, { level: "module", id: "entry" });
```

## Coverage semantics

`structuralCoverage` measures whether deterministically discoverable modules, APIs, signatures, and evidence references have SPEC records. `semanticCompleteness` measures reviewed responsibilities and behavioral contracts. A 100% structural score must not be presented as satisfying the final 75% Project SPEC completeness requirement when semantic completeness is still low.

## Optional human accuracy evaluation

This section is only needed later for contractual acceptance or proprietary repository-owner validation. It is not required to run the automatic evaluation. Create sampled review seeds after indexing:

```powershell
npm run init-ground-truth -- --config spike.config.json
```

This creates `ground-truth.v2.json` for each repository using `sample-manifest.json.selectedFiles`. Review those files for entity and relation accuracy. Review `configurationFiles` separately for discovery/configuration coverage; they are intentionally excluded from entity recall and edge precision.

For each sampled file:

1. Remove false entities and add missing entities.
2. Check modules, packages, classes, structs, interfaces, functions, methods, imports and ArkUI components.
3. Remove false relations and add missing containment, import, call, inheritance and implementation relations.
4. Check external and unresolved targets deliberately; do not convert them to internal without a real repository definition.
5. When complete, change:

   ```json
   "review": {
     "status": "reviewed",
     "sampledFiles": ["..."],
     "reviewer": "your-name",
     "reviewedAt": "2026-08-04T00:00:00Z"
   }
   ```

6. Remove the diagnostic beginning with `UNREVIEWED SEED`.

Recalculate without reindexing:

```powershell
npm run evaluate -- --config spike.config.json
```

Unreviewed repositories do not block the command. Their recall and precision remain `null`, and their acceptance values say `not-evaluated` rather than passing by comparison with an unreviewed seed.

## End-to-end quality evaluation

After `all` has produced the repository artifacts, run:

```powershell
npm run evaluate:quality -- --config spike.config.json
```

To evaluate one repository or use another evaluation-data directory:

```powershell
npm run evaluate:quality -- --repo openharmony-screenlock --config spike.config.json --evaluation-dir ./evaluation
```

The evaluator looks for:

```text
evaluation/
├── ground-truth/<repository-id>.json
└── architecture/
    ├── <repository-id>.constraints.json
    └── <repository-id>.mutations.json
```

When no reviewed ground truth exists, SpecGen automatically creates `silver-ground-truth.json` from the independent Tree-sitter observation and verifies its labels against source text. The report labels these values as entity/edge *agreement*, reports the comparable-file coverage, and does not treat them as contractual human accuracy.

If the older evaluation already has a reviewed `results/<repo>/ground-truth.v2.json`, no new labeling file is required. `evaluate:quality` converts it to `evaluation-ground-truth.json` beside the run artifacts and uses it automatically. Unreviewed seeds are rejected.

Every evaluation automatically seeds universal violations with known answers: unresolved dependencies, missing internal module targets, self-dependencies and cycles where the graph permits a cycle mutation. No architecture review is needed for these tests. Accepted project-specific constraints and mutations are added when available.

Create initial review files from the currently observed module directions:

```powershell
npm run init:architecture-eval -- --repo openharmony-screenlock --config spike.config.json
```

This optional command writes project-specific candidate constraints and matching mutations. Use it later when an architecture owner is available. Candidate rules are never scored; the universal mutation suite still runs automatically.

Each repository receives:

```text
evaluation-report.json
evaluation-report.md
```

The report separates three questions:

1. **Structural completeness:** did deterministic extraction and Project SPEC storage cover the code?
2. **Accuracy:** does CodeGraph agree with an independent, source-verified silver oracle—or optional reviewed truth?
3. **Architecture detection:** does the checker detect controlled violations without false alarms?

The structural score summarizes automatic repository-to-SPEC checks. With the automatic oracle, the report produces a clearly labelled **silver diagnostic composite**. A reviewed oracle produces the human composite. Contract acceptance must not present silver agreement as human-reviewed precision or recall.

## Automatic agent A/B evaluation

Record repeated runs of the same tasks with and without Project SPEC using `deveco.specgen-agent-run/v1`. Start from `evaluation/examples/agent-runs.example.json`, use at least three runs per task and condition, then run:

```powershell
npm run evaluate:agent -- --runs ./my-agent-runs.json --output ./agent-evaluation.json
```

The comparison reports task/build/test success, architecture compliance, duration, token use, files touched, repair iterations, and progressive-disclosure retrieval precision and recall. Only paired tasks are compared. Five repetitions per task and condition are preferred for client-facing results.

Generate objective tasks directly from a repository's public Project SPEC APIs:

```powershell
$env:OPENROUTER_API_KEY = "<your-key>"
$env:OPENROUTER_MODEL = "qwen/qwen3.6-35b-a3b"
$env:HTTPS_PROXY = "http://proxyeurope.huawei.com:8080/"
$env:HTTP_PROXY = $env:HTTPS_PROXY
$env:NODE_USE_SYSTEM_CA = "1"

npm run spike -- init-agent-benchmark --repo arkts-xcomponent --config spike.config.json --tasks 3
npm run agent:ab -- --experiment ./evaluation/agent-experiment.arkts-xcomponent.json
```

This produces `evaluation/agent-experiment.<repo>.json` plus hidden-answer task files. The model present during generation is recorded in the experiment so both conditions use the same value.

For every task and repetition, the harness:

1. Creates a fresh repository copy for the baseline condition.
2. Invokes the configured agent without a Project SPEC.
3. Runs configured build, test and architecture commands.
4. Repeats from the same clean source under the Project-SPEC condition.
5. Records files changed, duration, verification results, retrieval IDs and optional token metadata.
6. Writes `agent-runs.json` and `agent-comparison.json`.

The generated experiment uses the built-in OpenRouter adapter. It first asks the model to select files, then requests complete bounded edits of only those selected files. Set `OPENROUTER_API_KEY`, `OPENROUTER_MODEL`, and your corporate proxy variables before running. `agent.command` can later be replaced with a DevEco adapter or another coding-agent CLI. The command receives:

```text
SPECGEN_CONDITION
SPECGEN_TASK_ID
SPECGEN_TASK_PROMPT
SPECGEN_PROMPT_FILE
SPECGEN_PROJECT_SPEC
SPECGEN_ARCHITECTURE_CONSTRAINTS
SPECGEN_RESULT_FILE
SPECGEN_MODEL
```

The adapter should write optional usage metadata to `SPECGEN_RESULT_FILE`:

```json
{
  "inputTokens": 30000,
  "outputTokens": 7000,
  "repairIterations": 1,
  "retrievedIds": ["module-spec:settings"],
  "architectureIssueCount": 0,
  "usedProjectSpec": true
}
```

The configured model identifier, agent command, prompts, verifiers and source repository must stay identical between conditions. Only access to Project SPEC should change.

### Optional LLM judge

Generate evidence-grounded judge input automatically:

```powershell
npm run spike -- init-llm-judge --repo arkts-xcomponent --config spike.config.json
npm run spike -- llm-judge --input ./results-v4/arkts-xcomponent/llm-judge-input.json --output ./results-v4/arkts-xcomponent/llm-judge-result.json
```

The result is explicitly `llm-judge-non-authoritative`. It is useful for semantic claims and architecture plausibility but never replaces source, compiler, test or mutation-based metrics.

## Local graph database

CodeGraph uses an embedded local SQLite index under `.codegraph`. It is a cache used for graph queries and incremental updates, not a separately launched database server. Do not commit it. DevEco can store it in its project cache and update it when source files change.

## Recommended client dashboard

| Category | Primary metrics | Acceptance |
|---|---|---:|
| Indexing | supported-file coverage, crash-free rate, incremental freshness | ≥95%, 100%, ≤5 s |
| Ground-truth accuracy | entity recall, edge precision, interface recall | ≥85%, ≥90%, report |
| Evidence | evidence validity, schema validity | ≥98%, 100% |
| Architecture | seeded issue recall, precision, false positives/KLOC | ≥75%, report, report |
| Agent usefulness | task success and architecture-compliance delta | improvement over baseline |

## How to read the report

Important fields:

```text
codegraph.metrics.fileCoverage
codegraph.metrics.sourceFileCoverage
codegraph.metrics.configurationFileCoverage
codegraph.metrics.scope
codegraph.metrics.entityRecall
codegraph.metrics.edgePrecision
codegraph.acceptance
codegraph.summary.entitiesByKind
codegraph.summary.relationsByKind
codegraph.summary.relationsByResolution
codegraph.summary.byLanguage
codegraph.diagnostics
codegraph.observation.json -> diagnosticDetails
treeSitterArkts.topologyAgreementWithCodeGraph
treeSitterArkts.resolutionAwareAgreementWithCodeGraph
projectSpec.structuralCoverage
projectSpec.semanticCompleteness
incremental.medianMs
```

Parser agreement is useful for finding extraction disagreements, but it is not a human-reviewed correctness score.

## Graph invariants

- Every internal relation source and target exists as an exported entity.
- External and unresolved targets are represented explicitly.
- The complete graph may contain ArkTS, TypeScript, C++, JavaScript and other supported languages.
- Language-specific evaluation filters a view of that graph; it does not delete other languages.
- Build-level modules come from ecosystem manifests, not from guessing source-code communities.

## Intended product integration

The core is designed to move into DevEco Code as an internal TypeScript package. DevEco will later supply its model client to grounded semantic enrichment, RequestSpec generation, and architecture checks. The current deterministic records, schemas, queries, and views require no MCP boundary.
