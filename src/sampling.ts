import type { Observation, RepoConfig, SpikeConfig } from "./model.js";
import { stableId } from "./files.js";

export interface SampleManifest {
  schemaVersion: 1;
  repository: string;
  strategy: "all" | "deterministic-stratified";
  seed: string;
  selectedFiles: string[];
  reasons: Record<string, string[]>;
}

export function createSampleManifest(repo: RepoConfig, config: SpikeConfig, observation: Observation): SampleManifest {
  const requested = config.sampling[repo.size]; const files = observation.indexedFiles;
  if (requested === 0 || files.length <= requested) return {
    schemaVersion: 1, repository: repo.id, strategy: "all", seed: config.sampling.seed,
    selectedFiles: [...files], reasons: Object.fromEntries(files.map(file => [file, ["all files selected"]]))
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
    if (entities.some(entity => entity.kind === "component")) { score += 100; why.push("contains UI component"); }
    if (/(entry|main|ability|service|controller|router|test)/i.test(file)) { score += 40; why.push("entry/service/test path"); }
    if (fileRelations.some(edge => edge.resolution === "external" || edge.resolution === "unresolved")) { score += 20; why.push("boundary or unresolved relation"); }
    score += parseInt(stableId(`${config.sampling.seed}:${file}`).slice(0, 4), 16) / 65535;
    reasons[file] = why.length ? why : ["structural diversity"];
    return { file, score };
  }).sort((left, right) => right.score - left.score || left.file.localeCompare(right.file));

  for (const [, languageFiles] of languages) {
    const best = scored.find(item => languageFiles.includes(item.file) && !selected.has(item.file));
    if (best && selected.size < requested) { selected.add(best.file); reasons[best.file].push("language stratum"); }
  }
  for (const item of scored) if (selected.size < requested) selected.add(item.file);
  return { schemaVersion: 1, repository: repo.id, strategy: "deterministic-stratified", seed: config.sampling.seed, selectedFiles: [...selected].sort(), reasons };
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
