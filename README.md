# SpecGen ProjectSpec Core and Evaluation — OpenHarmony Profile

Version 0.5 adds a repeatable evaluation system to the deterministic ProjectSpec Core. It remains entirely TypeScript and launches no Python runtime, MCP server, or database service.

The engine indexes every language CodeGraph supports and then applies an OpenHarmony ecosystem profile for `module.json5`, `build-profile.json5`, `oh-package.json5` and related manifests. ArkTS additionally receives an independent direct Tree-sitter comparison.

The current core makes no LLM calls. Semantic responsibilities, protocols, pre/post-conditions, and exceptions remain explicitly `not-established` or `structural-only` until a later grounded LLM and human-review stage supplies them.

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

## Human accuracy evaluation

Create sampled review seeds after indexing:

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

Ground truth is deliberately separate from generated observations. A generated graph cannot validate itself. Review a representative, architecture-oriented sample once and reuse it for every candidate version. The checked-in `fixture-small` files demonstrate the exact schemas. For medium and large public repositories, select stable modules at a pinned commit and record the upstream URL, revision and license in the ground-truth metadata.

If a mutation file is absent, SpecGen generates forbidden-dependency cases from accepted constraints whose source and target selectors identify real modules. Explicit mutation files remain preferable for a client benchmark because they make the test suite versioned and auditable.

Each repository receives:

```text
evaluation-report.json
evaluation-report.md
```

The report separates three questions:

1. **Structural completeness:** did deterministic extraction and Project SPEC storage cover the code?
2. **Accuracy:** does the extracted graph match independently reviewed ground truth?
3. **Architecture detection:** does the checker detect controlled violations without false alarms?

The composite score is a summary only. Contract acceptance should always use the individual metrics, especially entity recall, edge precision and architecture-issue recall.

## Agent A/B evaluation

Record repeated runs of the same tasks with and without Project SPEC using `deveco.specgen-agent-run/v1`. Start from `evaluation/examples/agent-runs.example.json`, use at least three runs per task and condition, then run:

```powershell
npm run evaluate:agent -- --runs ./my-agent-runs.json --output ./agent-evaluation.json
```

The comparison reports task/build/test success, architecture compliance, duration, token use, files touched, repair iterations, and progressive-disclosure retrieval precision and recall. Only paired tasks are compared. Five repetitions per task and condition are preferred for client-facing results.

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
