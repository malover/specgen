# Universal Code Evidence Spike — OpenHarmony Profile

Version 0.2 validates CodeGraph as an in-process, mixed-language evidence layer for SpecGen. It imports CodeGraph into the current Node process: no Python, MCP server, database service or separate runtime is launched.

The engine indexes every language CodeGraph supports and then applies an OpenHarmony ecosystem profile for `module.json5`, `build-profile.json5`, `oh-package.json5` and related manifests. ArkTS additionally receives an independent direct Tree-sitter comparison.

Phase 1 makes no LLM calls. OpenRouter variables remain in `.env.example` for later ProjectSpec and RequestSpec work.

## What changed in v0.2

- Mixed-language repository graph instead of an `.ets`/`.ts`-only graph.
- Repository, file, package, OpenHarmony module and external-symbol entities.
- All CodeGraph node kinds are preserved with native kind and language metadata.
- ArkUI `@Entry`, `@Component` and `@ComponentV2` structs are classified as components while retaining `nativeKind: "struct"`.
- Every relation has represented endpoints and an `internal`, `external` or `unresolved` resolution status.
- Cross-language edges remain in the repository graph instead of contaminating an ArkTS-only subset.
- Per-language, per-kind and per-resolution summaries.
- Zero-symbol file and orphan-edge diagnostics.
- Deterministic stratified sampling for medium and large repositories.
- Accuracy remains `not-evaluated` until `review.status` is explicitly set to `reviewed` and the unreviewed diagnostic is removed.
- Direct Tree-sitter edges are deduplicated.

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
  "outputDirectory": "./results-v2",
  "incremental": { "trials": 3, "timeoutMs": 10000 },
  "sampling": {
    "small": 0,
    "medium": 20,
    "large": 30,
    "seed": "specgen-phase1-v2"
  },
  "acceptance": {
    "fileCoverage": 0.95,
    "entityRecall": 0.85,
    "edgePrecision": 0.90,
    "incrementalStalenessMs": 5000
  }
}
```

`small: 0` means select every file. Medium and large select fixed-size deterministic samples. Reusing the same seed produces the same selection for the same graph.

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
results-v2/<repo>/
├── codegraph.observation.json
├── tree-sitter.observation.json
├── incremental.json
├── sample-manifest.json
├── report.json
├── run-status.json
└── crash.json                    # failures only
```

The CodeGraph observation is the complete mixed-language graph. The Tree-sitter observation contains only the independent ArkTS baseline. `report.json` includes their ArkTS agreement, but labels it as agreement rather than ground-truth accuracy.

## Human accuracy evaluation

Create sampled review seeds after indexing:

```powershell
npm run init-ground-truth -- --config spike.config.json
```

This creates `ground-truth.v2.json` for each repository using the files listed in `sample-manifest.json`. Review only those files. The versioned name prevents an old circular v0.1 seed from being mistaken for reviewed v0.2 evidence.

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
codegraph.metrics.entityRecall
codegraph.metrics.edgePrecision
codegraph.acceptance
codegraph.summary.entitiesByKind
codegraph.summary.relationsByKind
codegraph.summary.relationsByResolution
codegraph.summary.byLanguage
codegraph.diagnostics
treeSitterArkts.agreementWithCodeGraph
incremental.medianMs
```

`agreementWithCodeGraph` is useful for finding parser disagreements, but it is not a correctness score.

## Graph invariants

- Every internal relation source and target exists as an exported entity.
- External and unresolved targets are represented explicitly.
- The complete graph may contain ArkTS, TypeScript, C++, JavaScript and other supported languages.
- Language-specific evaluation filters a view of that graph; it does not delete other languages.
- Build-level modules come from ecosystem manifests, not from guessing source-code communities.

## Intended product integration

After the spike passes, the evidence package can move into DevEco Code as an internal TypeScript package. DevEco will supply its existing model client to semantic ProjectSpec, RequestSpec and alignment layers. OpenRouter remains a standalone-development option rather than an internal MCP boundary.
