import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  Applicable,
  Entry,
  FeatureSets,
  Features,
  FilterMode,
  Mark,
  Notes,
  StateWire,
} from "./types.ts";
import { buildDoc, countPaths, rolledUpTriage, searchIndex } from "./walker.ts";
import { allFeatureIds, docFeatures, ID_RE, idTaken } from "./features.ts";
import { buildRows, computeVisible, defaultExpanded } from "./rows.ts";
import {
  delPayload,
  exportBundle,
  importBundle,
  isBundle,
  loadAll,
  persistAsked,
  putApplicable,
  putFeatureSets,
  putFeatures,
  putNotes,
  putPayload,
  requestPersistence,
  setPersistAsked,
  storageInfo,
  type StorageInfo,
} from "./store.ts";
import { DEMO_NAME, DEMO_PAYLOAD } from "./demo.ts";
import { DropZone } from "./components/DropZone.tsx";
import { Header } from "./components/Header.tsx";
import { Breadcrumb } from "./components/Breadcrumb.tsx";
import { TreeView } from "./components/TreeView.tsx";
import { FeaturesPanel } from "./components/FeaturesPanel.tsx";
import { FeatureStrip } from "./components/FeatureStrip.tsx";
import { SelectionBar } from "./components/SelectionBar.tsx";
import { Menu } from "./components/Menu.tsx";
import { PersistNote, type PersistPrompt } from "./components/PersistNote.tsx";

const NO_NOTES: Notes = {};
const NO_SET: Set<number> = new Set();
const NO_IDS: string[] = [];
const basename = (p: string) => p.split("/").pop() ?? p;

/** What the storage line says, per answer to the one permission this tool asks for. */
const PERSIST_NOTE: Record<StorageInfo["permission"], string> = {
  granted: " · persistent, the browser will keep it",
  denied: " · not persistent — refused, so export regularly",
  undecided: " · not persistent — export regularly",
  unsupported: " · export regularly",
};

export function App() {
  const [wire, setWire] = useState<StateWire | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, Notes>>({});
  const [features, setFeatures] = useState<Features>({});
  const [sets, setSets] = useState<FeatureSets>({});
  const [applicable, setApplicable] = useState<Applicable>({});

  const [tab, setTab] = useState(0);
  const [search, setSearch] = useState("");
  const [dSearch, setDSearch] = useState("");
  const [filter, setFilter] = useState<FilterMode>("all");
  const [editing, setEditing] = useState<string | null>(null);
  /** Normalized paths in the current payload that marks and notes apply to together. */
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkEditing, setBulkEditing] = useState(false);

  const [expanded, setExpanded] = useState<Record<string, Set<number>>>({});
  const [arrayExpanded, setArrayExpanded] = useState<Record<string, Set<number>>>({});

  const [cursor, setCursor] = useState(0);
  /** Node id to land the cursor on once the rows have rebuilt around it. */
  const [pending, setPending] = useState<number | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [storage, setStorage] = useState<StorageInfo | null>(null);
  const [persistPrompt, setPersistPrompt] = useState<PersistPrompt | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const notesRef = useRef(notes);
  notesRef.current = notes;
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const refresh = useCallback(async () => {
    const s = await loadAll();
    setWire(s);
    setNotes(s.notes);
    setFeatures(s.features);
    setSets(s.featureSets);
    setApplicable(s.applicable);
    return s;
  }, []);

  const loadDemo = useCallback(async () => {
    const name = await putPayload(DEMO_NAME, JSON.stringify(DEMO_PAYLOAD));
    const s = await refresh();
    const i = s.docs.findIndex((d) => d.name === name);
    if (i >= 0) setTab(i);
  }, [refresh]);

  useEffect(() => {
    refresh()
      .then((s) => {
        // ?demo gives a first-time visitor something to look at. Never overwrite an
        // existing copy — by then it may carry their own annotations.
        const wants = new URLSearchParams(location.search).has("demo");
        if (wants && !s.docs.some((d) => d.name === DEMO_NAME)) return loadDemo();
      })
      .catch((e) => setErr(String(e)));
    storageInfo().then(setStorage).catch(() => {});
  }, [refresh, loadDemo]);

  const flash = useCallback((msg: string, ms = 1800) => {
    setToast(msg);
    setTimeout(() => setToast(null), ms);
  }, []);

  /**
   * Put the persistence question once, and only once there is something to lose — not on
   * a cold load, and not to someone who has opened nothing but the sample.
   */
  const offered = useRef(false);
  useEffect(() => {
    if (offered.current || persistPrompt || !wire || !storage) return;
    if (storage.persisted || storage.permission !== "undecided") return;
    if (!wire.docs.some((d) => d.name !== DEMO_NAME)) return;
    let live = true;
    persistAsked().then((asked) => {
      if (!live || asked) return;
      offered.current = true;
      setPersistPrompt("offer");
    });
    return () => {
      live = false;
    };
  }, [wire, storage, persistPrompt]);

  const onAskPersist = useCallback(async () => {
    offered.current = true;
    await setPersistAsked();
    const info = await requestPersistence();
    setStorage(info);
    // A refusal is not a failure state — it just changes what the app has to tell you.
    if (info.persisted) {
      setPersistPrompt(null);
      flash("the browser will keep this site's data");
    } else {
      setPersistPrompt("result");
    }
  }, [flash]);

  const onDismissPersist = useCallback(() => {
    offered.current = true;
    void setPersistAsked();
    setPersistPrompt(null);
  }, []);

  const onDrop = useCallback(
    async (files: File[]) => {
      const added: string[] = [];
      const failed: string[] = [];
      let imported = 0;

      for (const f of files) {
        const text = await f.text();
        try {
          // A dropped export bundle is restored rather than treated as a payload.
          const parsed = JSON.parse(text);
          if (isBundle(parsed)) {
            const r = await importBundle(parsed);
            imported += r.notes;
            continue;
          }
          added.push(await putPayload(f.name, text));
        } catch (e) {
          failed.push(`${f.name}: ${(e as Error).message}`);
        }
      }

      const s = await refresh().catch(() => null);
      if (added.length && s) {
        const i = s.docs.findIndex((d) => d.name === added[0]);
        if (i >= 0) setTab(i);
      }
      if (failed.length) flash(`${failed.length} rejected — ${failed[0]}`, 5000);
      else if (imported) flash(`imported ${imported} annotations`);
      else flash(`added ${added.join(", ")}`);
    },
    [refresh, flash],
  );

  const onRemove = useCallback(
    async (name: string) => {
      if (!confirm(`Remove ${name}?\n\nAnnotations are kept — re-adding the payload restores them.`))
        return;
      await delPayload(name).catch(() => {});
      await refresh().catch(() => {});
      setTab((t) => Math.max(0, t - 1));
    },
    [refresh],
  );

  const onExport = useCallback(async () => {
    const bundle = await exportBundle();
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `json-notes-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    flash("exported notes + payloads");
  }, [flash]);

  const docs = useMemo(
    () => (wire ? wire.docs.map((d) => buildDoc(d.name, d.file, d.json)) : []),
    [wire],
  );

  useEffect(() => {
    if (!docs.length) return;
    setExpanded(Object.fromEntries(docs.map((d) => [d.name, defaultExpanded(d)])));
    setArrayExpanded(Object.fromEntries(docs.map((d) => [d.name, new Set<number>()])));
  }, [docs]);

  // Build each search index while the browser is idle, one payload per callback, so
  // neither the initial load nor the first keystroke pays for it.
  useEffect(() => {
    if (!docs.length) return;
    const ric: typeof requestIdleCallback =
      window.requestIdleCallback ?? ((f: IdleRequestCallback) => window.setTimeout(f, 300) as never);
    const cancel: typeof cancelIdleCallback = window.cancelIdleCallback ?? window.clearTimeout;
    let i = 0;
    let handle = ric(function step() {
      if (i < docs.length) {
        searchIndex(docs[i++]!);
        handle = ric(step);
      }
    });
    return () => cancel(handle);
  }, [docs]);

  useEffect(() => {
    const t = setTimeout(() => setDSearch(search), 120);
    return () => clearTimeout(t);
  }, [search]);

  const doc = docs[tab];
  const docNotes = (doc && notes[doc.name]) || NO_NOTES;

  /** Containers settled by something annotated below them. Derived, never stored. */
  const rolled = useMemo(
    () => (doc ? rolledUpTriage(doc, docNotes) : new Set<string>()),
    [doc, docNotes],
  );

  const visible = useMemo(
    () => (doc ? computeVisible(doc, docNotes, dSearch, filter, rolled) : null),
    [doc, docNotes, dSearch, filter, rolled],
  );

  const rows = useMemo(
    () =>
      doc
        ? buildRows({
            doc,
            notes: docNotes,
            expanded: expanded[doc.name] ?? NO_SET,
            arrayExpanded: arrayExpanded[doc.name] ?? NO_SET,
            rolled,
            visible,
          })
        : [],
    [doc, docNotes, expanded, arrayExpanded, rolled, visible],
  );

  const counts = useMemo(
    () => (doc ? countPaths(doc, docNotes, rolled) : { total: 0, marked: 0, untriaged: 0 }),
    [doc, docNotes, rolled],
  );

  const tabCounts = useMemo(
    () =>
      docs.map((d) => {
        const n = notes[d.name] ?? NO_NOTES;
        return countPaths(d, n, rolledUpTriage(d, n));
      }),
    [docs, notes],
  );

  // ---- persistence -------------------------------------------------------

  const scheduleSave = useCallback((docName: string) => {
    clearTimeout(timers.current[docName]);
    timers.current[docName] = setTimeout(() => {
      void putNotes(docName, notesRef.current[docName] ?? {});
    }, 500);
  }, []);

  /** Immutable update — untouched entries keep identity so their rows skip re-render. */
  const patch = useCallback(
    (docName: string, path: string, p: Partial<Entry>) => {
      setNotes((prev) => {
        const cur = prev[docName] ?? {};
        const next: Entry = { ...cur[path], ...p };
        if (!next.mark && !next.note) {
          if (!(path in cur)) return prev;
          const { [path]: _drop, ...rest } = cur;
          return { ...prev, [docName]: rest };
        }
        return { ...prev, [docName]: { ...cur, [path]: next } };
      });
      scheduleSave(docName);
    },
    [scheduleSave],
  );

  /** The same edit against a whole selection, in one update and one save. */
  const patchMany = useCallback(
    (docName: string, paths: string[], p: Partial<Entry>) => {
      setNotes((prev) => {
        const cur = { ...(prev[docName] ?? {}) };
        for (const path of paths) {
          const next: Entry = { ...cur[path], ...p };
          if (!next.mark && !next.note) delete cur[path];
          else cur[path] = next;
        }
        return { ...prev, [docName]: cur };
      });
      scheduleSave(docName);
    },
    [scheduleSave],
  );

  // ---- handlers ----------------------------------------------------------

  const onToggle = useCallback(
    (headId: number) => {
      if (!doc) return;
      setExpanded((prev) => {
        const s = new Set(prev[doc.name] ?? []);
        s.has(headId) ? s.delete(headId) : s.add(headId);
        return { ...prev, [doc.name]: s };
      });
    },
    [doc],
  );

  const onExpandArray = useCallback(
    (arrayId: number) => {
      if (!doc) return;
      setArrayExpanded((prev) => {
        const s = new Set(prev[doc.name] ?? []);
        s.add(arrayId);
        return { ...prev, [doc.name]: s };
      });
    },
    [doc],
  );

  /** Behaviour 16: ignoring a container folds it away. */
  const collapsePaths = useCallback(
    (paths: string[]) => {
      if (!doc) return;
      setExpanded((prev) => {
        const s = new Set(prev[doc.name] ?? []);
        for (const path of paths) for (const id of doc.pathIndex.get(path) ?? []) s.delete(id);
        return { ...prev, [doc.name]: s };
      });
    },
    [doc],
  );

  const onMark = useCallback(
    (path: string, m: Mark) => {
      if (!doc) return;
      const cur = notesRef.current[doc.name]?.[path]?.mark;
      const next = cur === m ? undefined : m;
      patch(doc.name, path, { mark: next });
      if (next === "ignore") collapsePaths([path]);
    },
    [doc, patch, collapsePaths],
  );

  const onNote = useCallback(
    (path: string, note: string) => {
      if (!doc) return;
      patch(doc.name, path, { note: note.trim() ? note : undefined });
    },
    [doc, patch],
  );

  // ---- selection ---------------------------------------------------------

  /**
   * Selection is by normalized path, the same unit annotations use. Selecting one
   * instance of `Members[].Relation` selects the key, which is what a note is about.
   */
  const onSelectRow = useCallback(
    (index: number, extend: boolean) => {
      const row = rows[index];
      if (!row || row.more) return;
      if (!extend) {
        setSelected((prev) => {
          const s = new Set(prev);
          s.has(row.path) ? s.delete(row.path) : s.add(row.path);
          return s;
        });
        return;
      }
      const [a, b] = index < cursor ? [index, cursor] : [cursor, index];
      setSelected((prev) => {
        const s = new Set(prev);
        for (let i = a; i <= b; i++) {
          const r = rows[i];
          if (r && !r.more) s.add(r.path);
        }
        return s;
      });
      setCursor(index);
    },
    [rows, cursor],
  );

  const clearSelection = useCallback(() => {
    setSelected(new Set());
    setBulkEditing(false);
  }, []);

  /** Set the mark on everything selected — or clear it, if they all already carry it. */
  const onMarkSelection = useCallback(
    (m: Mark) => {
      if (!doc || !selected.size) return;
      const paths = [...selected];
      const all = paths.every((p) => notesRef.current[doc.name]?.[p]?.mark === m);
      patchMany(doc.name, paths, { mark: all ? undefined : m });
      if (!all && m === "ignore") collapsePaths(paths);
    },
    [doc, selected, patchMany, collapsePaths],
  );

  const onNoteSelection = useCallback(
    (note: string) => {
      if (!doc || !selected.size) return;
      patchMany(doc.name, [...selected], { note: note.trim() ? note : undefined });
    },
    [doc, selected, patchMany],
  );

  // Selection is per payload — the paths mean nothing in the next one.
  useEffect(() => {
    setSelected(new Set());
    setBulkEditing(false);
  }, [tab]);

  const onCopy = useCallback((path: string) => {
    void navigator.clipboard.writeText(path);
    setToast(`copied ${path}`);
    setTimeout(() => setToast(null), 1400);
  }, []);

  // Rows shrink when you filter or collapse; keep the cursor in range.
  useEffect(() => {
    setCursor((c) => Math.min(Math.max(c, 0), Math.max(rows.length - 1, 0)));
  }, [rows.length]);

  /**
   * Expand everything above a node, drop any filtering, and land the cursor on it —
   * so you end up looking at the key in its real surroundings rather than in a
   * filtered list. Shared by search-Enter and the features tab.
   */
  const jumpToNode = useCallback(
    (docIndex: number, nodeId: number) => {
      const d = docs[docIndex];
      if (!d) return;
      const anc = new Set<number>();
      const arr = new Set<number>();
      let cur: number = nodeId;
      while (cur !== -1) {
        anc.add(cur);
        if (d.nodes[cur]!.kind === "array") arr.add(cur);
        cur = d.nodes[cur]!.parent;
      }
      setExpanded((prev) => ({ ...prev, [d.name]: new Set([...(prev[d.name] ?? []), ...anc]) }));
      setArrayExpanded((prev) => ({
        ...prev,
        [d.name]: new Set([...(prev[d.name] ?? []), ...arr]),
      }));
      setSearch("");
      setDSearch("");
      setFilter("all");
      setTab(docIndex);
      setPending(nodeId);
    },
    [docs],
  );

  /**
   * Enter in the search box jumps to whichever match the cursor is on and clears the
   * filter. Move the cursor with j/k first to pick a different match.
   */
  const onSearchSubmit = useCallback(() => {
    const target = rows[cursor];
    if (!target || target.more) return;
    searchRef.current?.blur();
    jumpToNode(tab, target.nodeId);
  }, [rows, cursor, tab, jumpToNode]);

  // When a search narrows the tree, put the cursor on the first real match — not the
  // ancestor rows kept for context — so Enter goes somewhere useful immediately.
  // Keyed on the query so arrowing through matches is not undone on every rebuild.
  const positionedFor = useRef<string | null>(null);
  useEffect(() => {
    const q = dSearch.trim().toLowerCase();
    if (positionedFor.current === q) return;
    positionedFor.current = q;
    if (!doc || !q || !rows.length) return;
    const blob = searchIndex(doc);
    const i = rows.findIndex((r) => !r.more && blob[r.nodeId]?.includes(q));
    if (i >= 0) setCursor(i);
  }, [dSearch, doc, rows]);

  /** Arrows in the search field step between real matches, skipping context ancestors. */
  const onSearchStep = useCallback(
    (delta: number) => {
      const q = dSearch.trim().toLowerCase();
      if (!doc || !rows.length) return;
      const blob = q ? searchIndex(doc) : null;
      const isMatch = (i: number) => {
        const r = rows[i];
        if (!r || r.more) return false;
        return !blob || !!blob[r.nodeId]?.includes(q);
      };
      for (let n = 1; n <= rows.length; n++) {
        const i = (cursor + delta * n + rows.length * n) % rows.length;
        if (isMatch(i)) return setCursor(i);
      }
    },
    [doc, rows, cursor, dSearch],
  );

  // ---- keyboard ----------------------------------------------------------

  // A ref-held handler keeps one stable listener while always seeing fresh state.
  const keyHandler = useRef<(e: KeyboardEvent) => void>(() => {});
  keyHandler.current = (e: KeyboardEvent) => {
    const el = e.target as HTMLElement | null;
    const typing =
      el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);

    if (typing) {
      if (e.key === "Escape") {
        el!.blur();
        if (editing) setEditing(null);
      }
      return;
    }
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (onFeatures) return;

    const row = rows[cursor];
    const move = (n: number) => {
      e.preventDefault();
      setCursor((c) => Math.min(Math.max(c + n, 0), rows.length - 1));
    };

    switch (e.key) {
      case "j":
      case "ArrowDown":
        return move(1);
      case "k":
      case "ArrowUp":
        return move(-1);
      case "d":
        return move(15);
      case "u":
        return move(-15);
      case "g":
        e.preventDefault();
        return setCursor(0);
      case "G":
        e.preventDefault();
        return setCursor(rows.length - 1);

      case "l":
      case "ArrowRight": {
        e.preventDefault();
        if (!row) return;
        if (row.more) return onExpandArray(row.more.arrayId);
        if (row.hasChildren && !row.expanded) return onToggle(row.headId);
        if (row.hasChildren) return move(1);
        return;
      }
      case "h":
      case "ArrowLeft": {
        e.preventDefault();
        if (!row) return;
        if (row.hasChildren && row.expanded) return onToggle(row.headId);
        // Otherwise jump to the enclosing container.
        for (let i = cursor - 1; i >= 0; i--) {
          if (rows[i]!.depth < row.depth) return setCursor(i);
        }
        return;
      }

      // With a selection up, the mark keys act on all of it and the cursor stays put —
      // advancing through rows you have just settled in bulk would only lose your place.
      case " ":
        if (row && !row.more) {
          e.preventDefault();
          onSelectRow(cursor, false);
        }
        return;
      case "i":
      case "*":
        if (selected.size) {
          e.preventDefault();
          onMarkSelection("interesting");
        } else if (!row?.more) {
          e.preventDefault();
          onMark(row!.path, "interesting");
          move(1);
        }
        return;
      case "q":
      case "?":
        if (selected.size) {
          e.preventDefault();
          onMarkSelection("question");
        } else if (!row?.more) {
          e.preventDefault();
          onMark(row!.path, "question");
          move(1);
        }
        return;
      case "x":
      case "-":
        if (selected.size) {
          e.preventDefault();
          onMarkSelection("ignore");
        } else if (!row?.more) {
          e.preventDefault();
          onMark(row!.path, "ignore");
          move(1);
        }
        return;

      case "Enter":
      case "n":
        if (selected.size) {
          e.preventDefault();
          setBulkEditing(true);
        } else if (row && !row.more) {
          e.preventDefault();
          setEditing(row.path);
        }
        return;
      case "y":
        if (row) {
          e.preventDefault();
          onCopy(row.path);
        }
        return;
      case "/":
        e.preventDefault();
        searchRef.current?.focus();
        return;
      case "[":
        e.preventDefault();
        return setTab((t) => Math.max(t - 1, 0));
      case "]":
        e.preventDefault();
        return setTab((t) => Math.min(t + 1, docs.length));
      case "Escape":
        if (editing) setEditing(null);
        else if (selected.size) clearSelection();
        else if (search) setSearch("");
        return;
    }
  };

  useEffect(() => {
    const f = (e: KeyboardEvent) => keyHandler.current(e);
    window.addEventListener("keydown", f);
    return () => window.removeEventListener("keydown", f);
  }, []);

  // ---- features ----------------------------------------------------------

  /**
   * Status is per payload: "covered" is only ever an answer about one payload, since a
   * key in one endpoint's response says nothing about what another one carries.
   */
  const perDoc = useMemo(
    () =>
      docs.map((d) => ({
        doc: d.name,
        rows: docFeatures(
          notes[d.name] ?? NO_NOTES,
          features,
          sets,
          applicable[d.name] ?? NO_IDS,
        ),
      })),
    [docs, notes, features, sets, applicable],
  );

  // Autocomplete offers ids already linked from a note, ones declared, and set members.
  const featureIds = useMemo(
    () => allFeatureIds(features, sets, notes),
    [features, sets, notes],
  );

  // Storage holds ONLY what you typed deliberately: descriptions, declared features and
  // sets, and the picks against a payload. Ids that appear in a note are derived on load,
  // so a half-typed `@fea` never reaches disk.
  const onNeed = useCallback((id: string, need: string) => {
    setFeatures((prev) => {
      const next = { ...prev, [id]: { id, need: need.trim() || undefined } };
      void putFeatures(next);
      return next;
    });
  }, []);

  const declareFeature = useCallback(
    (raw: string): string | null => {
      const id = raw.trim().replace(/^@/, "");
      if (!ID_RE.test(id)) return null;
      if (idTaken(id, {}, sets)) {
        flash(`@${id} is already a set — ids are shared, pick another`);
        return null;
      }
      setFeatures((prev) => {
        if (prev[id]) return prev;
        const next = { ...prev, [id]: { id } };
        void putFeatures(next);
        return next;
      });
      return id;
    },
    [sets, flash],
  );

  const onDropFeature = useCallback((id: string) => {
    setFeatures((prev) => {
      if (!(id in prev)) return prev;
      const { [id]: _drop, ...next } = prev;
      void putFeatures(next);
      return next;
    });
  }, []);

  // ---- feature sets ------------------------------------------------------

  const onAddSet = useCallback(
    (raw: string) => {
      const id = raw.trim().replace(/^@/, "");
      if (!ID_RE.test(id)) return;
      const clash = idTaken(id, features, sets);
      if (clash) return flash(`@${id} is already a ${clash} — ids are shared, pick another`);
      setSets((prev) => {
        const next = { ...prev, [id]: { id, features: [] } };
        void putFeatureSets(next);
        return next;
      });
    },
    [features, sets, flash],
  );

  const onSetNeed = useCallback((id: string, need: string) => {
    setSets((prev) => {
      const cur = prev[id];
      if (!cur) return prev;
      const next = { ...prev, [id]: { ...cur, need: need.trim() || undefined } };
      void putFeatureSets(next);
      return next;
    });
  }, []);

  const onDropSet = useCallback((id: string) => {
    setSets((prev) => {
      if (!(id in prev)) return prev;
      const { [id]: _drop, ...next } = prev;
      void putFeatureSets(next);
      return next;
    });
    // A payload picked the set, not its contents — drop the pick with it.
    setApplicable((prev) => {
      const next: Applicable = {};
      let changed = false;
      for (const [name, ids] of Object.entries(prev)) {
        const kept = ids.filter((x) => x !== id);
        if (kept.length !== ids.length) changed = true;
        if (kept.length) next[name] = kept;
      }
      if (!changed) return prev;
      void putApplicable(next);
      return next;
    });
  }, []);

  const onSetMember = useCallback(
    (setId: string, featureId: string, on: boolean) => {
      // Adding a member is a deliberate act, so the feature is declared by it — that is
      // what makes it offerable in autocomplete and listed in the registry.
      if (on && !declareFeature(featureId)) return;
      setSets((prev) => {
        const cur = prev[setId];
        if (!cur) return prev;
        const members = on
          ? cur.features.includes(featureId)
            ? cur.features
            : [...cur.features, featureId]
          : cur.features.filter((f) => f !== featureId);
        if (members === cur.features) return prev;
        const next = { ...prev, [setId]: { ...cur, features: members } };
        void putFeatureSets(next);
        return next;
      });
    },
    [declareFeature],
  );

  /** What this payload is on the hook for. Stored per payload, picks only. */
  const onPick = useCallback(
    (id: string, on: boolean) => {
      if (!doc) return;
      setApplicable((prev) => {
        const cur = prev[doc.name] ?? [];
        const list = on ? (cur.includes(id) ? cur : [...cur, id]) : cur.filter((x) => x !== id);
        const next = { ...prev };
        if (list.length) next[doc.name] = list;
        else delete next[doc.name];
        void putApplicable(next);
        return next;
      });
    },
    [doc],
  );

  const onJump = useCallback(
    (docName: string, path: string) => {
      const di = docs.findIndex((d) => d.name === docName);
      const ids = docs[di]?.pathIndex.get(path);
      if (ids?.length) jumpToNode(di, ids[0]!);
    },
    [docs, jumpToNode],
  );

  useEffect(() => {
    if (pending == null) return;
    const i = rows.findIndex((r) => r.nodeId === pending && !r.more);
    if (i >= 0) {
      setCursor(i);
      setPending(null);
    }
  }, [pending, rows]);

  // ---- render ------------------------------------------------------------

  if (err) return <div className="boot err">{err}</div>;
  if (!wire) return <div className="boot">loading…</div>;

  if (!docs.length) {
    return (
      <DropZone onFiles={onDrop}>
        <div className="boot empty-app">
          <h1>json-notes</h1>
          <p className="lede">
            Work out what an undocumented API response actually contains — one key at a
            time, and keep the notes.
          </p>

          <div className="empty-drop" onClick={() => fileRef.current?.click()}>
            <div className="empty-plus">+</div>
            <div>Drop a JSON payload here, or click to choose one</div>
            <div className="hint">An exported bundle dropped here is restored instead</div>
          </div>
          <p className="try">
            Nothing to hand?{" "}
            <button className="linkish" onClick={() => void loadDemo()}>
              load a sample payload
            </button>
          </p>

          <p className="hint privacy">
            Everything runs in your browser. Nothing is uploaded — there is no server to
            upload it to.
          </p>
          <p className="hint dim-path">
            Saved in this browser
            {storage?.persisted
              ? " · marked persistent"
              : " · not marked persistent yet, so export now and then"}
          </p>
          <input
            ref={fileRef}
            type="file"
            accept=".json,application/json"
            multiple
            hidden
            onChange={(e) => {
              const files = [...(e.target.files ?? [])];
              e.target.value = "";
              if (files.length) void onDrop(files);
            }}
          />
          {wire.broken?.map((b) => (
            <p key={b.file} className="broken">
              {b.file} — {b.error}
            </p>
          ))}
        </div>
        {toast && <div className="toast">{toast}</div>}
      </DropZone>
    );
  }

  const onFeatures = tab === docs.length;

  return (
    <DropZone onFiles={onDrop}>
    <div className="app">
      <div className="tabs">
        <div className="tabs-scroll">
        {docs.map((d, i) => (
          <span key={d.name} className={`tab${i === tab ? " on" : ""}`} title={d.name}>
            <button className="tab-label" onClick={() => setTab(i)}>
              {d.name}
            </button>
            <span
              className={`badge${tabCounts[i]!.untriaged === 0 ? " done" : ""}`}
              title={`${tabCounts[i]!.untriaged} of ${tabCounts[i]!.total} keys still untriaged`}
            >
              {tabCounts[i]!.untriaged}
            </span>
            <button
              className="tab-x"
              title="Remove this payload. Your annotations are kept — add it again and they come back."
              onClick={() => onRemove(d.name)}
            >
              ✕
            </button>
          </span>
        ))}
        <button
          className="tab tab-add"
          title="Add a payload — or just drag JSON files onto the window"
          onClick={() => fileRef.current?.click()}
        >
          +
        </button>
        </div>
        <button
          className={`tab tab-feat${onFeatures ? " on" : ""}`}
          title="What you need to build, and whether these payloads can support it"
          onClick={() => setTab(docs.length)}
        >
          features
          <span className="badge">{featureIds.length}</span>
        </button>
        <div className="tools">
          {/* Out of the dropdown deliberately: browsers can evict site data, so the
              export is the backstop and needs to be visible, not discovered. */}
          <button
            className="tool export"
            title="Download payloads and annotations as one JSON file — drop it back here to restore. Contains whatever customer data your samples do."
            onClick={() => void onExport()}
          >
            ↓ export
          </button>
          <Menu
            items={[
              {
                label: "Open files…",
                hint: "or drag them in",
                onClick: () => fileRef.current?.click(),
              },
              // Once the question has been answered it lives here, so the explanation is
              // always reachable rather than gone the moment the notice is dismissed.
              ...(storage && !storage.persisted && storage.permission !== "unsupported"
                ? [
                    {
                      label: "Keeping your data",
                      hint: storage.permission === "denied" ? "not granted" : "why it matters",
                      onClick: () =>
                        setPersistPrompt(storage.permission === "denied" ? "result" : "offer"),
                    },
                  ]
                : []),
              { separator: true },
              {
                note: storage
                  ? `Stored in this browser${storage.usageMB != null ? ` · ${storage.usageMB.toFixed(1)} MB used` : ""}${PERSIST_NOTE[storage.permission]}`
                  : "Stored in this browser",
              },
            ]}
          />
          <input
            ref={fileRef}
            type="file"
            accept=".json,application/json"
            multiple
            hidden
            onChange={(e) => {
              const files = [...(e.target.files ?? [])];
              e.target.value = "";
              if (files.length) void onDrop(files);
            }}
          />
        </div>
      </div>

      {persistPrompt && (
        <PersistNote
          mode={persistPrompt}
          info={storage}
          onAsk={() => void onAskPersist()}
          onExport={() => {
            setPersistPrompt(null);
            void onExport();
          }}
          onDismiss={onDismissPersist}
        />
      )}

      {onFeatures ? (
        <FeaturesPanel
          features={features}
          sets={sets}
          perDoc={perDoc}
          onNeed={onNeed}
          onJump={onJump}
          onAdd={declareFeature}
          onDrop={onDropFeature}
          onSetNeed={onSetNeed}
          onAddSet={onAddSet}
          onDropSet={onDropSet}
          onSetMember={onSetMember}
        />
      ) : (
        <>
          <Header
            counts={counts}
            search={search}
            filter={filter}
            onSearch={setSearch}
            onFilter={setFilter}
            onSubmit={onSearchSubmit}
            onStep={onSearchStep}
            searchRef={searchRef}
          />
          <FeatureStrip
            rows={perDoc[tab]?.rows ?? []}
            features={features}
            sets={sets}
            picked={applicable[doc!.name] ?? NO_IDS}
            onPick={onPick}
            onJump={(path) => onJump(doc!.name, path)}
          />
          <Breadcrumb doc={doc!} path={rows[cursor]?.path ?? null} notes={docNotes} />
          <TreeView
            rows={rows}
            notes={docNotes}
            editing={editing}
            cursor={cursor}
            selected={selected}
            featureIds={featureIds}
            onToggle={onToggle}
            onExpandArray={onExpandArray}
            onMark={onMark}
            onNote={onNote}
            onEdit={setEditing}
            onCopy={onCopy}
            onCursor={setCursor}
            onSelect={onSelectRow}
          />
          {selected.size > 0 && (
            <SelectionBar
              paths={[...selected]}
              notes={docNotes}
              editing={bulkEditing}
              featureIds={featureIds}
              onMark={onMarkSelection}
              onNote={onNoteSelection}
              onEdit={setBulkEditing}
              onClear={clearSelection}
            />
          )}
          <div className="legend">
            <span className="lg-marks">
              <b className="m-i">i</b> interesting
              <b className="m-q">q</b> question
              <b className="m-x">x</b> ignore
            </span>
            <span className="lg-div" />
            <span><b>j k</b> move</span>
            <span><b>h l</b> fold</span>
            <span><b>space</b> select</span>
            <span><b>⏎</b> note</span>
            <span><b>y</b> copy path</span>
            <span><b>/</b> search</span>
            <span><b>[ ]</b> tabs</span>
          </div>
        </>
      )}

      {wire.broken?.length ? (
        <div className="broken-bar">
          {wire.broken.length} file{wire.broken.length > 1 ? "s" : ""} failed to parse:{" "}
          {wire.broken.map((b) => basename(b.file)).join(", ")}
        </div>
      ) : null}

      {toast && <div className="toast">{toast}</div>}
    </div>
    </DropZone>
  );
}
