# SpecGen ProjectSpec Core — OpenHarmony Profile

Version 0.4 turns the in-process, mixed-language CodeGraph evidence spike into the first deterministic ProjectSpec Core. It remains entirely TypeScript and launches no Python runtime, MCP server, or database service.

The engine indexes every language CodeGraph supports and then applies an OpenHarmony ecosystem profile for `module.json5`, `build-profile.json5`, `oh-package.json5` and related manifests. ArkTS additionally receives an independent direct Tree-sitter comparison.

The current core makes no LLM calls. Semantic responsibilities, protocols, pre/post-conditions, and exceptions remain explicitly `not-established` or `structural-only` until a later grounded LLM and human-review stage supplies them.

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
