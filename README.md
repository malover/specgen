# SpecGen ProjectSpec Core — OpenHarmony Profile

SpecGen is a deterministic TypeScript tool for indexing source repositories, generating evidence-backed Project SPEC artifacts, checking architecture constraints, and evaluating extraction quality.

The core performs no model calls and requires no external API, MCP server, or separately managed database. CodeGraph stores its local incremental index under `.codegraph` using embedded SQLite.

## Capabilities

- Mixed-language repository indexing through CodeGraph.
- OpenHarmony module discovery from `module.json5`, `build-profile.json5`, `oh-package.json5`, and related manifests.
- Versioned Project, Module, Interface, Architecture Constraint, Coverage, and Architecture View records.
- File- and line-level evidence for generated records.
- Deterministic progressive-disclosure queries for project, module, interface, and evidence data.
- Structural coverage, evidence integrity, schema validity, graph integrity, and incremental freshness metrics.
- Architecture constraint checks and controlled mutation evaluation.
- Optional independent Tree-sitter parser-agreement diagnostics.
- Optional human-reviewed entity, relation, and interface accuracy evaluation.
- Consolidated JSON and Markdown evaluation reports.

## Requirements

- Node.js 22.5–24.x.
- Windows PowerShell, macOS, or Linux.
- One or more local source repositories.

## Install

```powershell
Copy-Item spike.config.example.json spike.config.json
npm install
npm run check
npm test
```

## Configuration

Example `spike.config.json`:

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
  "outputDirectory": "./results",
  "incremental": {
    "trials": 3,
    "timeoutMs": 10000
  },
  "sampling": {
    "small": 0,
    "medium": 20,
    "large": 30,
    "seed": "specgen-phase1"
  },
  "acceptance": {
    "fileCoverage": 0.95,
    "entityRecall": 0.85,
    "edgePrecision": 0.90,
    "incrementalStalenessMs": 5000
  }
}
```

`small: 0` selects every semantic source file. Medium and large repositories use deterministic architecture-oriented sampling. Configuration files are tracked separately and do not consume the semantic accuracy sample budget.

## Full evaluation

Run indexing, Project SPEC generation, structural checks, incremental checks, and architecture mutation evaluation:

```powershell
npm run evaluate:full -- --config spike.config.json
```

Add the independent parser diagnostic only when investigating extraction differences:

```powershell
npm run evaluate:full -- --config spike.config.json --independent-oracle
```

Top-level outputs:

```text
results/full-evaluation.md
results/full-evaluation.json
```

The consolidated report includes:

- repository pass/fail status;
- minimum file coverage;
- mean structural score;
- introduced architecture violations detected;
- per-stage timing and failure details;
- links to repository-specific artifacts;
- explicit limitations for unavailable reviewed accuracy.

Missing reviewed evidence is reported as `NOT EVALUATED`; it is never counted as a pass.

## Individual workflows

Index every configured repository and generate Project SPEC artifacts:

```powershell
npm run all -- --config spike.config.json
```

Index one repository:

```powershell
npm run spike -- run --repo arkts-xcomponent --config spike.config.json
```

Recalculate structural quality and architecture mutation metrics without reindexing:

```powershell
npm run evaluate:quality -- --config spike.config.json
```

Evaluate one repository:

```powershell
npm run evaluate:quality -- --repo arkts-xcomponent --config spike.config.json
```

Regenerate Project SPEC artifacts from an existing CodeGraph observation:

```powershell
npm run project-spec -- --repo arkts-xcomponent --config spike.config.json
```

## Repository outputs

Each repository produces artifacts similar to:

```text
results/<repo>/
├── codegraph.observation.json
├── tree-sitter.observation.json  # only with --independent-oracle
├── incremental.json
├── sample-manifest.json
├── report.json
├── run-status.json
├── evaluation-report.json
├── evaluation-report.md
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

The CodeGraph observation is the complete mixed-language graph. The optional Tree-sitter observation is an independent ArkTS comparison source and does not contribute to the generated Project SPEC.

## Progressive-disclosure queries

Start with a bounded project index:

```powershell
npm run query -- --repo arkts-xcomponent --level project --config spike.config.json
```

Request module, interface, or evidence details:

```powershell
npm run query -- --repo arkts-xcomponent --level module --id entry --config spike.config.json
npm run query -- --repo arkts-xcomponent --level interface --id MyService --config spike.config.json
npm run query -- --repo arkts-xcomponent --level evidence --id "function:<entity-id>" --config spike.config.json
```

The same API is available through TypeScript:

```ts
import { buildProjectSpec, queryProjectSpec } from "arkts-indexing-spike";

const spec = buildProjectSpec(codeGraphObservation, repositoryPath);
const project = queryProjectSpec(spec, { level: "project" });
const moduleDetail = queryProjectSpec(spec, { level: "module", id: "entry" });
```

## Coverage semantics

`structuralCoverage` measures whether deterministically discoverable modules, public APIs, signatures, dependencies, and evidence references have Project SPEC records.

`semanticCompleteness` measures reviewed responsibilities and behavioral contracts. A high structural score must not be presented as complete semantic documentation when reviewed contracts are unavailable.

Primary deterministic checks include:

| Category | Measures |
|---|---|
| Indexing | supported-source coverage, crash-free status, incremental freshness |
| Project SPEC | module ownership, public API coverage, dependency coverage |
| Evidence | reference validity, evidence completeness, schema validity |
| Graph integrity | orphan rate, duplicate rate, relationship and call integrity |
| Architecture | mutation issue recall, precision, baseline issues, false positives/KLOC |

## Human-reviewed accuracy

Human review is optional for local development but required for contractual entity recall and edge precision.

Create editable review seeds after indexing:

```powershell
npm run init-ground-truth -- --config spike.config.json
```

Review the generated entity, relation, and interface labels, then recalculate without reindexing:

```powershell
npm run evaluate -- --config spike.config.json
```

Unreviewed repositories keep accuracy metrics at `null` and acceptance values at `not-evaluated`.

## Architecture evaluation

Every quality evaluation introduces controlled universal violations with known expected detections, including unresolved dependencies, missing internal module targets, self-dependencies, and cycles where applicable.

Optional project-specific candidate constraints can be generated from observed module directions:

```powershell
npm run init:architecture-eval -- --repo arkts-xcomponent --config spike.config.json
```

Candidate constraints are not scored until a reviewer changes their status to `accepted`.

Architecture constraints support:

- `forbid` relations;
- `allow` relations;
- `require` relations;
- module, entity-kind, name-pattern, and resolution selectors;
- evidence and provenance metadata.

## Optional parser diagnostics

The independent Tree-sitter path is evaluation-only. It reports parser agreement and source-verified silver labels when explicitly enabled.

Parser agreement is useful for locating extraction differences, but it is not human-reviewed correctness and must not be reported as contractual precision or recall.

## Local index

CodeGraph stores its embedded SQLite index under `.codegraph`. The directory is a disposable cache for graph queries and incremental updates and should not be committed.

## Product integration

The core is designed to be embedded into DevEco Code as an internal TypeScript package. The current records, schemas, queries, architecture checks, and evaluation reports do not require a service boundary or network dependency.
