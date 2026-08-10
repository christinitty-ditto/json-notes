import type { Doc, FilterMode, Kind, Notes } from "./types.ts";
import { searchIndex } from "./walker.ts";

export type Row = {
  key: string;
  /** Annotation target — the chain tail when a chain is collapsed. */
  nodeId: number;
  /** Expansion is keyed on the chain head, which is what the row represents. */
  headId: number;
  labels: string[];
  path: string;
  kind: Kind;
  value: unknown;
  depth: number;
  hasChildren: boolean;
  expanded: boolean;
  inheritedIgnore: boolean;
  arrayIndex: number;
  /** Set on the synthetic "+ N more" row that stands in for hidden array items. */
  more?: { arrayId: number; count: number };
};

export type Visible = {
  /** Nodes that render at all: matches, their ancestors, and their subtrees. */
  visible: Set<number>;
  /** Nodes forced open regardless of collapse state: ancestors, and the matches. */
  open: Set<number>;
};

export type BuildOpts = {
  doc: Doc;
  notes: Notes;
  expanded: Set<number>;
  arrayExpanded: Set<number>;
  /** When present, filtering is active — see computeVisible. */
  visible: Visible | null;
};

export function buildRows({ doc, notes, expanded, arrayExpanded, visible }: BuildOpts): Row[] {
  const rows: Row[] = [];
  const { nodes, chains } = doc;

  function walk(id: number, depth: number, inherited: boolean) {
    const chain = chains.get(id);
    const tailId = chain ? chain.tail : id;
    const tail = nodes[tailId]!;

    if (visible && !visible.visible.has(tailId)) return;

    const own = notes[tail.path]?.mark;
    // Ancestors and matched nodes open automatically so a match is always reachable
    // and a matched container shows what is inside it. Below a match, your own
    // collapse state applies, so a big subtree stays browsable rather than dumped.
    const isExpanded =
      expanded.has(id) || (!!visible && (visible.open.has(id) || visible.open.has(tailId)));
    const hasChildren = tail.children.length > 0;

    rows.push({
      key: `n${tailId}`,
      nodeId: tailId,
      headId: id,
      labels: chain ? chain.labels : [nodes[id]!.label],
      path: tail.path,
      kind: tail.kind,
      value: tail.value,
      depth,
      hasChildren,
      expanded: isExpanded,
      inheritedIgnore: inherited,
      arrayIndex: nodes[id]!.arrayIndex,
    });

    if (!hasChildren || !isExpanded) return;
    const nextInherited = inherited || own === "ignore";

    if (tail.kind === "array") {
      // Behaviour 8: show the first item, hide the rest behind a visible row.
      // Filtering narrows which items qualify but never overrides the collapse —
      // otherwise searching a key every item shares would wall you with 42 copies.
      const items = visible
        ? tail.children.filter((c) => visible.visible.has(c))
        : tail.children;
      const showAll = arrayExpanded.has(tailId);
      const shown = showAll ? items : items.slice(0, 1);
      for (const c of shown) walk(c, depth + 1, nextInherited);
      if (!showAll && items.length > 1) {
        rows.push({
          key: `more${tailId}`,
          nodeId: tailId,
          headId: tailId,
          labels: [],
          path: tail.path,
          kind: "array",
          value: undefined,
          depth: depth + 1,
          hasChildren: false,
          expanded: false,
          inheritedIgnore: nextInherited,
          arrayIndex: -1,
          more: { arrayId: tailId, count: items.length - 1 },
        });
      }
    } else {
      for (const c of tail.children) walk(c, depth + 1, nextInherited);
    }
  }

  walk(doc.root, 0, false);
  return rows;
}

/**
 * Nodes matching the search text and/or mark filter, plus:
 *   - every ancestor, so the tree stays navigable, and
 *   - everything *under* a match, so marking a container `*` shows the section rather
 *     than one bare header row.
 *
 * Returns null when nothing is filtering.
 */
export function computeVisible(
  doc: Doc,
  notes: Notes,
  search: string,
  filter: FilterMode,
): Visible | null {
  const q = search.trim().toLowerCase();
  if (!q && filter === "all") return null;

  const blob = q ? searchIndex(doc) : null;
  const matched: number[] = [];
  for (const n of doc.nodes) {
    if (doc.chained.has(n.id)) continue;
    if (blob && !blob[n.id]!.includes(q)) continue;
    if (filter !== "all") {
      const mark = notes[n.path]?.mark;
      if (filter === "untriaged") {
        if (mark) continue;
      } else if (filter === "interesting") {
        if (mark !== "interesting") continue;
      } else if (filter === "question") {
        if (mark !== "question") continue;
      }
    }
    matched.push(n.id);
  }

  const visible = new Set<number>();
  const open = new Set<number>();

  for (const id of matched) {
    for (let cur = doc.nodes[id]!.parent; cur !== -1 && !open.has(cur); ) {
      visible.add(cur);
      open.add(cur);
      cur = doc.nodes[cur]!.parent;
    }
    visible.add(id);
    open.add(id);

    // Nodes are in pre-order, so a subtree is the contiguous run of deeper nodes
    // immediately following its root.
    const depth = doc.nodes[id]!.depth;
    for (let j = id + 1; j < doc.nodes.length && doc.nodes[j]!.depth > depth; j++) {
      visible.add(j);
    }
  }

  // A chain renders at its head but is addressed by its tail; keep both reachable.
  for (const [head, { tail }] of doc.chains) {
    if (visible.has(head)) visible.add(tail);
    if (visible.has(tail)) visible.add(head);
    if (open.has(head)) open.add(tail);
    if (open.has(tail)) open.add(head);
  }
  return { visible, open };
}

/** Container nodes shallow enough to start open (behaviour 6). */
export function defaultExpanded(doc: Doc, maxDepth = 2): Set<number> {
  const s = new Set<number>();
  for (const n of doc.nodes) {
    if (n.kind === "scalar" || doc.chained.has(n.id)) continue;
    if (n.depth <= maxDepth) s.add(n.id);
  }
  return s;
}
