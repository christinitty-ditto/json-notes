export type Mark = "interesting" | "question" | "ignore";

export type Entry = { mark?: Mark; note?: string };
export type Notes = Record<string, Entry>;

export type Feature = { id: string; need?: string };
export type Features = Record<string, Feature>;

export type FilterMode = "all" | "untriaged" | "interesting" | "question";

export type Kind = "scalar" | "object" | "array";

/** One node of the payload. Stored flat in an array; `id` is the array index. */
export type JNode = {
  id: number;
  label: string;
  /** Normalized path — array indices collapse to `[]`. The annotation key. */
  path: string;
  kind: Kind;
  value: unknown;
  children: number[];
  parent: number;
  depth: number;
  /** Position within the parent array, or -1. */
  arrayIndex: number;
};

/** A parsed payload plus the indexes we precompute once at load. */
export type Doc = {
  name: string;
  file: string;
  nodes: JNode[];
  root: number;
  /** normalized path -> every node instance carrying it */
  pathIndex: Map<string, number[]>;
  /** normalized path -> its ancestor paths, outermost first */
  ancestorPaths: Map<string, string[]>;
  /**
   * Per node, lowercased "label path value" for search. Built on first search rather
   * than at load — most payloads are opened and read without ever being searched, and
   * on a large one this is the single most expensive part of parsing.
   */
  blob: string[] | null;
  /** head node id -> collapsed single-child chain */
  chains: Map<number, { labels: string[]; tail: number }>;
  /** nodes absorbed into a chain above them; never rendered on their own */
  chained: Set<number>;
};

export type PayloadWire = { name: string; file: string; json: unknown };

export type StateWire = {
  docs: PayloadWire[];
  notes: Record<string, Notes>;
  features: Features;
  /** Payloads that failed to parse — surfaced rather than silently skipped. */
  broken?: { file: string; error: string }[];
  /** Workspace directory holding payloads, notes and features.yaml. */
  home?: string;
};
