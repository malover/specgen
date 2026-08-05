import type { Observation, RepoConfig, SpikeConfig } from "./model.js";
import { classifyFileRole, stableId } from "./files.js";

export interface SampleManifest {
  schemaVersion: 2;
  repository: string;
  strategy: "all" | "deterministic-stratified";
  seed: string;
  selectedFiles: string[];
  configurationFiles: string[];
  reasons: Record<string, string[]>;
}

export function createSampleManifest(repo: RepoConfig, config: SpikeConfig, observation: Observation): SampleManifest {
  const requested = config.sampling[repo.size];
  const files = observation.indexedFiles.filter(file => classifyFileRole(file) !== "configuration");
  const configurationFiles = deterministicConfigurationSample(
    observation.indexedFiles.filter(file => classifyFileRole(file) === "configuration"),
    config.sampling.seed
  );
  if (requested === 0 || files.length <= requested) return {
    schemaVersion: 2, repository: repo.id, strategy: "all", seed: config.sampling.seed,
    selectedFiles: [...files], configurationFiles,
    reasons: Object.fromEntries([
      ...files.map(file => [file, ["all semantic files selected"]] as const),
      ...configurationFiles.map(file => [file, ["separate configuration review sample"]] as const)
    ])
  };
  const reasons: Record<string, string[]> = {}; const selected = new Set<string>();
  const fileEntities = new Map(files.map(file => [file, observation.entities.filter(entity => entity.filePath === file)]));
  const languages = new Map<string, string[]>();
  for (const file of files) {
    const language = observation.entities.find(entity => entity.kind === "file" && entity.filePath === file)?.language ?? "unknown";
    languages.set(language, [...(languages.get(language) ?? []), file]);
  }
  const scored = files.map(file => {
    const entities = fileEntities.get(file)!; const fileRelations = observation.relations.filter(edge => edge.filePath === file);
    let score = entities.length + fileRelations.length;
    const why: string[] = [];
    if (entities.some(entity => entity.kind === "component")) { score += 25; why.push("contains UI component"); }
    if (entities.some(entity => entity.kind === "interface")) { score += 30; why.push("contains declared interface"); }
    if (entities.some(entity => /service/i.test(entity.name)) || /service/i.test(file)) { score += 30; why.push("service candidate"); }
    if (/(entry|main|ability|controller|router)/i.test(file)) { score += 20; why.push("entry or control-flow path"); }
    if (fileRelations.some(edge => edge.resolution === "external" || edge.resolution === "unresolved")) { score += 25; why.push("boundary or unresolved relation"); }
    score += parseInt(stableId(`${config.sampling.seed}:${file}`).slice(0, 4), 16) / 65535;
    reasons[file] = why.length ? why : ["structural diversity"];
    return { file, score };
  }).sort((left, right) => right.score - left.score || left.file.localeCompare(right.file));

  const addBest = (predicate: (file: string) => boolean, reason: string): void => {
    const best = scored.find(item => predicate(item.file) && !selected.has(item.file));
    if (best && selected.size < requested) { selected.add(best.file); reasons[best.file].push(reason); }
  };
  addBest(file => fileEntities.get(file)!.some(entity => entity.kind === "interface"), "interface stratum");
  addBest(file => fileEntities.get(file)!.some(entity => /service/i.test(entity.name)) || /service/i.test(file), "service-candidate stratum");
  addBest(file => fileEntities.get(file)!.some(entity => entity.kind === "component"), "UI-component stratum");
  addBest(file => /(entry|ability|controller|router)/i.test(file), "entry/control-flow stratum");
  addBest(file => observation.relations.some(edge => edge.filePath === file && edge.resolution !== "internal"), "external-boundary stratum");
  addBest(file => classifyFileRole(file) === "test", "test stratum");
  addBest(file => classifyFileRole(file) === "build-tooling", "build-tooling stratum");

  for (const [, languageFiles] of languages) {
    addBest(file => languageFiles.includes(file), "language stratum");
  }
  const moduleRoots = observation.entities.filter(entity => entity.kind === "module" && typeof entity.metadata?.root === "string")
    .map(entity => ({ name: entity.name, root: String(entity.metadata!.root), files: files.filter(file => !entity.metadata!.root || file.startsWith(`${entity.metadata!.root}/`)) }))
    .filter(module => module.files.length)
    .sort((left, right) => right.files.length - left.files.length || stableId(`${config.sampling.seed}:${left.name}`).localeCompare(stableId(`${config.sampling.seed}:${right.name}`)));
  const moduleTarget = Math.min(moduleRoots.length, Math.floor(requested * 0.6)); let moduleSelections = 0;
  for (const module of moduleRoots) {
    if (moduleSelections >= moduleTarget || selected.size >= requested) break;
    const before = selected.size; addBest(file => module.files.includes(file), `module stratum: ${module.name}`);
    if (selected.size > before) moduleSelections++;
  }
  for (const item of scored) if (selected.size < requested) selected.add(item.file);
  for (const file of configurationFiles) reasons[file] = ["separate configuration review sample"];
  const selectedReasons = Object.fromEntries([...selected, ...configurationFiles].sort().map(file => [file, reasons[file]]));
  return { schemaVersion: 2, repository: repo.id, strategy: "deterministic-stratified", seed: config.sampling.seed, selectedFiles: [...selected].sort(), configurationFiles, reasons: selectedReasons };
}

function deterministicConfigurationSample(files: string[], seed: string): string[] {
  return [...files].sort((left, right) => stableId(`${seed}:${left}`).localeCompare(stableId(`${seed}:${right}`))).slice(0, 3).sort();
}

export function groundTruthSeed(observation: Observation, manifest: SampleManifest): Observation {
  const files = new Set(manifest.selectedFiles);
  const entities = observation.entities.filter(entity => entity.filePath && files.has(entity.filePath));
  const entityIds = new Set(entities.map(entity => entity.id));
  const relations = observation.relations.filter(edge => edge.filePath && files.has(edge.filePath));
  for (const edge of relations) {
    for (const id of [edge.source, edge.target]) {
      if (entityIds.has(id)) continue;
      const endpoint = observation.entities.find(entity => entity.id === id);
      if (endpoint) { entities.push(endpoint); entityIds.add(id); }
    }
  }
  return {
    ...observation, engine: "ground-truth", generatedAt: new Date().toISOString(),
    candidateFiles: manifest.selectedFiles, indexedFiles: manifest.selectedFiles,
    entities: entities.map(entity => ({ ...entity, provenance: "manual" })),
    relations: relations.map(edge => ({ ...edge, provenance: "manual" })),
    diagnostics: ["UNREVIEWED SEED: correct this sampled evidence and set review.status to reviewed."],
    review: { status: "unreviewed", sampledFiles: manifest.selectedFiles }
  };
}
