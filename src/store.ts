import type { Applicable, FeatureSets, Features, Notes, StateWire } from "./types.ts";

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
  /**
   * Always written on export. Optional because imports must still accept bundles without
   * them — older exports predate all three, as does whatever `scripts/bundle.ts` migrates.
   */
  payloads?: Record<string, string>;
  featureSets?: FeatureSets;
  applicable?: Applicable;
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

/**
 * Payload names come from filenames; keep them flat and predictable. A trailing
 * extension is dropped so the same response saved as `.json`, `.txt` or `.log` lands on
 * one name — and so re-adding it replaces the payload and keeps its annotations, which
 * is the whole point of the name. Only the extensions a payload actually arrives under
 * are listed: `api.v2` is a name, not a file type.
 */
const EXT = /\.(json|jsonc|json5|ndjson|txt|text|log|har|dat|out|resp|response)$/i;

export function slug(name: string): string {
  return (
    name
      .replace(/^.*[\\/]/, "")
      .replace(EXT, "")
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
  const featureSets = (await kvGet<FeatureSets>("featureSets")) ?? {};
  const applicable = (await kvGet<Applicable>("applicable")) ?? {};
  return {
    docs,
    notes,
    features,
    featureSets,
    applicable,
    broken,
    home: "this browser (IndexedDB)",
  };
}

export async function putPayload(fileName: string, text: string): Promise<string> {
  JSON.parse(text); // reject anything unusable before it is stored
  const name = slug(fileName);
  await tx(PAYLOADS, "readwrite", (s) => s.put(text, name));
  return name;
}

export async function delPayload(name: string): Promise<void> {
  await tx(PAYLOADS, "readwrite", (s) => s.delete(name));
  // Notes and applicable features are kept deliberately: re-adding the payload restores
  // everything you said about it.
}

export const putNotes = (name: string, notes: Notes) =>
  Object.keys(notes).length ? kvPut(notesKey(name), notes) : kvDel(notesKey(name));

export const putFeatures = (features: Features) => kvPut("features", features);

export const putFeatureSets = (sets: FeatureSets) => kvPut("featureSets", sets);

export const putApplicable = (applicable: Applicable) => kvPut("applicable", applicable);

// ---- portability ---------------------------------------------------------

/** One export, and it carries everything — payloads included, so it carries whatever
 *  customer data the samples did. Dropping the file back on the window restores it. */
export async function exportBundle(): Promise<Bundle> {
  const state = await loadAll();
  const names = await tx<IDBValidKey[]>(PAYLOADS, "readonly", (s) => s.getAllKeys());
  const texts = await tx<string[]>(PAYLOADS, "readonly", (s) => s.getAll());
  return {
    format: BUNDLE_MARKER,
    exportedAt: new Date().toISOString(),
    notes: state.notes,
    features: state.features,
    featureSets: state.featureSets,
    applicable: state.applicable,
    payloads: Object.fromEntries(names.map((n, i) => [String(n), texts[i] ?? ""])),
  };
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

  const sets = (await kvGet<FeatureSets>("featureSets")) ?? {};
  await putFeatureSets({ ...(b.featureSets ?? {}), ...sets });

  // Per payload, not per id: a set of picks you have made here outranks the bundle's,
  // in one piece, so an import cannot half-restore an older idea of what a payload owes.
  const applicable = (await kvGet<Applicable>("applicable")) ?? {};
  await putApplicable({ ...(b.applicable ?? {}), ...applicable });

  return { notes: noteCount, payloads: payloadCount };
}

// ---- durability ----------------------------------------------------------

/**
 * `persist()` answers with a bare boolean, which cannot distinguish "you said no" from
 * "the browser decided no on its own". The permission state can, so the app is able to
 * say something true rather than something vague.
 */
export type PersistState = "granted" | "denied" | "undecided" | "unsupported";

export type StorageInfo = {
  persisted: boolean;
  permission: PersistState;
  usageMB: number | null;
  quotaMB: number | null;
};

/**
 * Read-only, and deliberately so: this runs on load, and a permission request fired at
 * someone who has not yet seen the app is a request they have no reason to grant. Asking
 * is `requestPersistence`, called from a button, after we have explained why.
 */
export async function storageInfo(): Promise<StorageInfo> {
  let persisted = false;
  try {
    persisted = (await navigator.storage?.persisted?.()) ?? false;
  } catch {
    /* not supported */
  }

  let permission: PersistState =
    typeof navigator.storage?.persist === "function" ? "undecided" : "unsupported";
  try {
    const status = await navigator.permissions?.query({
      name: "persistent-storage" as PermissionName,
    });
    if (status?.state === "granted") permission = "granted";
    else if (status?.state === "denied") permission = "denied";
  } catch {
    /* Permissions API, or this permission name, not supported — "undecided" is honest. */
  }
  if (persisted) permission = "granted";

  let usageMB: number | null = null;
  let quotaMB: number | null = null;
  try {
    const e = await navigator.storage?.estimate?.();
    if (e?.usage != null) usageMB = e.usage / 1048576;
    if (e?.quota != null) quotaMB = e.quota / 1048576;
  } catch {
    /* not supported */
  }
  return { persisted, permission, usageMB, quotaMB };
}

/**
 * Browsers evict site data under pressure, and everything this tool holds lives in that
 * data. Persistence makes eviction unlikely; it is not a guarantee, and it is refusable,
 * which is why the export exists and why nothing here depends on the answer being yes.
 */
export async function requestPersistence(): Promise<StorageInfo> {
  try {
    await navigator.storage?.persist?.();
  } catch {
    /* refused, unsupported, or decided against — storageInfo reports which */
  }
  return storageInfo();
}

/** Remembers that we have put the question once, so it is asked once and not on a loop. */
const ASKED = "persist-asked";
export const persistAsked = () => kvGet<boolean>(ASKED).then((v) => v === true);
export const setPersistAsked = () => kvPut(ASKED, true);
