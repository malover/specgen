import type { Relation } from "./model.js";
import { stableId } from "./files.js";

export function withId(relation: Omit<Relation, "id">): Relation {
  return { id: `edge:${stableId(`${relation.kind}|${relation.source}|${relation.target}`)}`, ...relation };
}
