import type { Doc, JNode, Kind, Notes } from "./types.ts";

function kindOf(v: unknown): Kind {
  if (Array.isArray(v)) return "array";
  if (v !== null && typeof v === "object") return "object";
  return "scalar";
}

/**
 * Walk a payload into a flat node array.
 *
 * Path rules — array indices never appear:
 *   response.policyData          the array itself
 *   response.policyData[]        any item of it
 *   response.policyData[].Tenure any item's key
 */
export function buildDoc(name: string, file: string, json: unknown): Doc {
  const nodes: JNode[] = [];

  // Explicit stack rather than recursion: a recursive walk blows the call stack at
  // roughly 5000 levels of nesting, which is a crash rather than a slow render.
  type Frame = {
    label: string;
    path: string;
    value: unknown;
    parent: number;
    depth: number;
    arrayIndex: number;
  };
  const stack: Frame[] = [
    { label: name, path: "", value: json, parent: -1, depth: 0, arrayIndex: -1 },
  ];

  while (stack.length) {
    const f = stack.pop()!;
    const kind = kindOf(f.value);
    const id = nodes.length;
    nodes.push({
      id,
      label: f.label,
      path: f.path,
      kind,
      value: kind === "scalar" ? f.value : undefined,
      children: [],
      parent: f.parent,
      depth: f.depth,
      arrayIndex: f.arrayIndex,
    });
    if (f.parent !== -1) nodes[f.parent]!.children.push(id);

    // Pushed in reverse so they pop back in document order (pre-order DFS).
    if (kind === "array") {
      const arr = f.value as unknown[];
      for (let i = arr.length - 1; i >= 0; i--) {
        stack.push({
          label: `[${i}]`,
          path: f.path + "[]",
          value: arr[i],
          parent: id,
          depth: f.depth + 1,
          arrayIndex: i,
        });
      }
    } else if (kind === "object") {
      const obj = f.value as Record<string, unknown>;
      const keys = Object.keys(obj);
      for (let i = keys.length - 1; i >= 0; i--) {
        const k = keys[i]!;
        stack.push({
          label: k,
          path: f.path ? `${f.path}.${k}` : k,
          value: obj[k],
          parent: id,
          depth: f.depth + 1,
          arrayIndex: -1,
        });
      }
    }
  }

  // path -> node instances
  const pathIndex = new Map<string, number[]>();
  for (const n of nodes) {
    const hit = pathIndex.get(n.path);
    if (hit) hit.push(n.id);
    else pathIndex.set(n.path, [n.id]);
  }

  // path -> ancestor paths. Every instance of a path shares the same ancestor
  // chain by construction, so the first instance is representative.
  const ancestorPaths = new Map<string, string[]>();
  for (const [path, ids] of pathIndex) {
    const chain: string[] = [];
    let cur = nodes[ids[0]!]!.parent;
    while (cur !== -1) {
      chain.push(nodes[cur]!.path);
      cur = nodes[cur]!.parent;
    }
    ancestorPaths.set(path, chain.reverse());
  }

  // Single-child chain compression: session > data > policy renders as one row.
  // Nodes are in DFS order, so a node is marked chained before we reach it.
  const chains = new Map<number, { labels: string[]; tail: number }>();
  const chained = new Set<number>();
  for (const n of nodes) {
    if (chained.has(n.id)) continue;
    const labels = [n.label];
    let cur = n;
    while (cur.kind === "object" && cur.children.length === 1) {
      const only = nodes[cur.children[0]!]!;
      if (only.kind === "scalar") break;
      labels.push(only.label);
      chained.add(only.id);
      cur = only;
    }
    if (labels.length > 1) chains.set(n.id, { labels, tail: cur.id });
  }

  // blob stays null until the first search — see types.ts
  return { name, file, nodes, root: 0, pathIndex, ancestorPaths, blob: null, chains, chained };
}

/**
 * The lowercased search index, built once on first use. Most payloads are opened and
 * read without ever being searched, and on a large one this is the single most
 * expensive part of loading.
 */
export function searchIndex(doc: Doc): string[] {
  if (doc.blob) return doc.blob;
  const blob = new Array<string>(doc.nodes.length);
  for (let i = 0; i < doc.nodes.length; i++) {
    const n = doc.nodes[i]!;
    const v = n.kind === "scalar" ? String(n.value) : "";
    blob[i] = (n.label + " " + n.path + " " + v).toLowerCase();
  }
  doc.blob = blob;
  return blob;
}

/** True when some ancestor path carries an explicit `ignore` mark. */
export function inheritsIgnore(doc: Doc, path: string, notes: Notes): boolean {
  const anc = doc.ancestorPaths.get(path);
  if (!anc) return false;
  for (const a of anc) if (notes[a]?.mark === "ignore") return true;
  return false;
}

export type Counts = { total: number; marked: number; untriaged: number };

/** Counts are over unique normalized paths — the documentation unit, not rendered rows. */
export function countPaths(doc: Doc, notes: Notes): Counts {
  let marked = 0;
  let untriaged = 0;
  for (const path of doc.pathIndex.keys()) {
    if (notes[path]?.mark) {
      marked++;
    } else if (!inheritsIgnore(doc, path, notes)) {
      untriaged++;
    }
  }
  return { total: doc.pathIndex.size, marked, untriaged };
}

const FEATURE_RE = /@([A-Za-z0-9][\w-]*)/g;

export function featureIdsIn(note: string | undefined): string[] {
  if (!note) return [];
  const out: string[] = [];
  for (const m of note.matchAll(FEATURE_RE)) out.push(m[1]!);
  return out;
}
