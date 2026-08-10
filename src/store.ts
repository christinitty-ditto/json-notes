import type { Features, Notes, StateWire } from "./types.ts";

/**
 * All state lives in the browser. Nothing is ever sent anywhere — there is no server
 * to send it to. IndexedDB rather than OPFS for the widest browser support, and rather
 * than localStorage because payloads run to megabytes.
 */
const DB_NAME = "json-notes";
const VERSION = 1;
const PAYLOADS = "payloads";
const KV = "kv";

export const BUNDLE_MARKER = "json-notes/bundle@1";

export type Bundle = {
  format: typeof BUNDLE_MARKER;
  exportedAt: string;
  notes: Record<string, Notes>;
  features: Features;
  /** Payloads are opt-in: they are the part that carries customer data. */
  payloads?: Record<string, string>;
};

let dbp: Promise<IDBDatabase> | null = null;

function db(): Promise<IDBDatabase> {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains(PAYLOADS)) d.createObjectStore(PAYLOADS);
      if (!d.objectStoreNames.contains(KV)) d.createObjectStore(KV);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return db().then(
    (d) =>
      new Promise<T>((resolve, reject) => {
        const t = d.transaction(store, mode);
        const req = fn(t.objectStore(store));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }),
  );
}

const kvGet = <T,>(key: string): Promise<T | undefined> =>
  tx<T | undefined>(KV, "readonly", (s) => s.get(key) as IDBRequest<T | undefined>);
const kvPut = (key: string, value: unknown) =>
  tx(KV, "readwrite", (s) => s.put(value, key));
const kvDel = (key: string) => tx(KV, "readwrite", (s) => s.delete(key));

const notesKey = (name: string) => `notes:${name}`;

/** Payload names come from filenames; keep them flat and predictable. */
export function slug(name: string): string {
  return (
    name
      .replace(/^.*[\\/]/, "")
      .replace(/\.json$/i, "")
      .replace(/[^\w.\-]+/g, "-")
      .replace(/^[-.]+|[-.]+$/g, "")
      .slice(0, 120) || "payload"
  );
}

export async function loadAll(): Promise<StateWire> {
  const names = await tx<IDBValidKey[]>(PAYLOADS, "readonly", (s) => s.getAllKeys());
  const texts = await tx<string[]>(PAYLOADS, "readonly", (s) => s.getAll());

  const docs: StateWire["docs"] = [];
  const notes: Record<string, Notes> = {};
  const broken: { file: string; error: string }[] = [];

  const sorted = names
    .map((n, i) => ({ name: String(n), text: texts[i] ?? "" }))
    .sort((a, b) => a.name.localeCompare(b.name));

  for (const { name, text } of sorted) {
    try {
      docs.push({ name, file: name, json: JSON.parse(text) });
      notes[name] = (await kvGet<Notes>(notesKey(name))) ?? {};
    } catch (e) {
      broken.push({ file: name, error: (e as Error).message });
    }
  }

  const features = (await kvGet<Features>("features")) ?? {};
  return { docs, notes, features, broken, home: "this browser (IndexedDB)" };
}

export async function putPayload(fileName: string, text: string): Promise<string> {
  JSON.parse(text); // reject anything unusable before it is stored
  const name = slug(fileName);
  await tx(PAYLOADS, "readwrite", (s) => s.put(text, name));
  return name;
}

export async function delPayload(name: string): Promise<void> {
  await tx(PAYLOADS, "readwrite", (s) => s.delete(name));
  // Notes are kept deliberately: re-adding the payload restores every annotation.
}

export const putNotes = (name: string, notes: Notes) =>
  Object.keys(notes).length ? kvPut(notesKey(name), notes) : kvDel(notesKey(name));

export const putFeatures = (features: Features) => kvPut("features", features);

// ---- portability ---------------------------------------------------------

export async function exportBundle(includePayloads: boolean): Promise<Bundle> {
  const state = await loadAll();
  const bundle: Bundle = {
    format: BUNDLE_MARKER,
    exportedAt: new Date().toISOString(),
    notes: state.notes,
    features: state.features,
  };
  if (includePayloads) {
    const names = await tx<IDBValidKey[]>(PAYLOADS, "readonly", (s) => s.getAllKeys());
    const texts = await tx<string[]>(PAYLOADS, "readonly", (s) => s.getAll());
    bundle.payloads = Object.fromEntries(names.map((n, i) => [String(n), texts[i] ?? ""]));
  }
  return bundle;
}

export function isBundle(v: unknown): v is Bundle {
  return !!v && typeof v === "object" && (v as Bundle).format === BUNDLE_MARKER;
}

/** Merge, never clobber: existing annotations win unless the bundle has none. */
export async function importBundle(b: Bundle): Promise<{ notes: number; payloads: number }> {
  let noteCount = 0;
  let payloadCount = 0;

  for (const [name, text] of Object.entries(b.payloads ?? {})) {
    try {
      await putPayload(name, text);
      payloadCount++;
    } catch {
      /* skip anything that will not parse */
    }
  }

  for (const [name, incoming] of Object.entries(b.notes ?? {})) {
    const existing = (await kvGet<Notes>(notesKey(name))) ?? {};
    const merged = { ...incoming, ...existing };
    await kvPut(notesKey(name), merged);
    noteCount += Object.keys(incoming).length;
  }

  const features = (await kvGet<Features>("features")) ?? {};
  await putFeatures({ ...(b.features ?? {}), ...features });

  return { notes: noteCount, payloads: payloadCount };
}

// ---- durability ----------------------------------------------------------

export type StorageInfo = { persisted: boolean; usageMB: number | null; quotaMB: number | null };

/**
 * Browsers may evict site data under pressure. Asking for persistence makes that much
 * less likely; the export bundle is the real safety net.
 */
export async function storageInfo(): Promise<StorageInfo> {
  let persisted = false;
  try {
    persisted =
      (await navigator.storage?.persisted?.()) ||
      (await navigator.storage?.persist?.()) ||
      false;
  } catch {
    /* not supported */
  }
  let usageMB: number | null = null;
  let quotaMB: number | null = null;
  try {
    const e = await navigator.storage?.estimate?.();
    if (e?.usage != null) usageMB = e.usage / 1048576;
    if (e?.quota != null) quotaMB = e.quota / 1048576;
  } catch {
    /* not supported */
  }
  return { persisted, usageMB, quotaMB };
}
