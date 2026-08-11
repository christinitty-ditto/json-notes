import type { Applicable, FeatureSets, Features, Notes } from "./types.ts";
import { featureIdsIn } from "./walker.ts";

export type FeatureStatus = "covered" | "unresolved" | "missing";

export type FeatureLink = { path: string; question: boolean; note: string };

/** One feature as it stands in one payload. Status has no meaning without a payload. */
export type DocFeature = {
  id: string;
  need?: string;
  status: FeatureStatus;
  links: FeatureLink[];
  /** Picked by hand against this payload — so it can be un-picked again. */
  picked: boolean;
  /** Sets that brought it in. Non-empty means un-picking happens on the set. */
  viaSets: string[];
};

/** Gaps first: the strip's job is to say what this payload has not answered yet. */
const RANK: Record<FeatureStatus, number> = { missing: 0, unresolved: 1, covered: 2 };

export const worst = (a: FeatureStatus, b: FeatureStatus): FeatureStatus =>
  RANK[a] < RANK[b] ? a : b;

/** Feature id -> the notes in this payload that link it. */
export function linksIn(notes: Notes): Map<string, FeatureLink[]> {
  const links = new Map<string, FeatureLink[]>();
  for (const path in notes) {
    const e = notes[path]!;
    for (const id of featureIdsIn(e.note)) {
      const list = links.get(id);
      const link = { path, question: e.mark === "question", note: e.note ?? "" };
      if (list) list.push(link);
      else links.set(id, [link]);
    }
  }
  return links;
}

/**
 * What this payload is on the hook for, and how far each one has got.
 *
 * Applicability is what you picked plus what you linked: typing `@oa-status` in a note
 * here is already a statement that the feature matters to this payload, so it needs no
 * second confirmation. **missing** is therefore only reachable by picking — it means
 * "I said this payload should support it and no key here does".
 */
export function docFeatures(
  notes: Notes,
  features: Features,
  sets: FeatureSets,
  picked: string[],
): DocFeature[] {
  const byId = new Map<string, DocFeature>();
  const seed = (id: string): DocFeature => {
    let f = byId.get(id);
    if (!f) {
      f = {
        id,
        need: features[id]?.need,
        status: "missing",
        links: [],
        picked: false,
        viaSets: [],
      };
      byId.set(id, f);
    }
    return f;
  };

  for (const id of picked) {
    const set = sets[id];
    if (set) for (const m of set.features) seed(m).viaSets.push(id);
    else seed(id).picked = true;
  }
  for (const [id, list] of linksIn(notes)) {
    const f = seed(id);
    f.links = list.sort((a, b) => a.path.localeCompare(b.path));
  }

  for (const f of byId.values()) {
    f.status = !f.links.length
      ? "missing"
      : f.links.some((l) => l.question)
        ? "unresolved"
        : "covered";
  }
  return [...byId.values()].sort(
    (a, b) => RANK[a.status] - RANK[b.status] || a.id.localeCompare(b.id),
  );
}

/** A set is only as good as its weakest feature in that payload. */
export function setStatus(set: string[], byId: Map<string, DocFeature>): FeatureStatus {
  let s: FeatureStatus = "covered";
  for (const id of set) s = worst(s, byId.get(id)?.status ?? "missing");
  return s;
}

/** Every id that may be typed after `@`. Sets are excluded — a note links a feature. */
export function allFeatureIds(
  features: Features,
  sets: FeatureSets,
  notes: Record<string, Notes>,
): string[] {
  const ids = new Set<string>(Object.keys(features));
  for (const s of Object.values(sets)) for (const m of s.features) ids.add(m);
  for (const n of Object.values(notes)) for (const id of linksIn(n).keys()) ids.add(id);
  return [...ids].sort((a, b) => a.localeCompare(b));
}

export const ID_RE = /^[A-Za-z0-9][\w-]*$/;

/**
 * Ids are one namespace across features and sets. `@quote-flow` in a note has to mean
 * exactly one thing, and the pick list would otherwise show the same id twice.
 */
export function idTaken(id: string, features: Features, sets: FeatureSets): string | null {
  if (id in features) return "feature";
  if (id in sets) return "set";
  return null;
}
