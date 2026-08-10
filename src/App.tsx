import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Entry, Features, FilterMode, Mark, Notes, StateWire } from "./types.ts";
import { buildDoc, countPaths, featureIdsIn, searchIndex } from "./walker.ts";
import { buildRows, computeVisible, defaultExpanded } from "./rows.ts";
import {
  delPayload,
  exportBundle,
  importBundle,
  isBundle,
  loadAll,
  putFeatures,
  putNotes,
  putPayload,
  storageInfo,
  type StorageInfo,
} from "./store.ts";
import { DEMO_NAME, DEMO_PAYLOAD } from "./demo.ts";
import { DropZone } from "./components/DropZone.tsx";
import { Header } from "./components/Header.tsx";
import { Breadcrumb } from "./components/Breadcrumb.tsx";
import { TreeView } from "./components/TreeView.tsx";
import { FeaturesPanel, type FeatureRow } from "./components/FeaturesPanel.tsx";
import { Menu } from "./components/Menu.tsx";

const NO_NOTES: Notes = {};
const NO_SET: Set<number> = new Set();
const basename = (p: string) => p.split("/").pop() ?? p;

export function App() {
  const [wire, setWire] = useState<StateWire | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, Notes>>({});
  const [features, setFeatures] = useState<Features>({});

  const [tab, setTab] = useState(0);
  const [search, setSearch] = useState("");
  const [dSearch, setDSearch] = useState("");
  const [filter, setFilter] = useState<FilterMode>("all");
  const [editing, setEditing] = useState<string | null>(null);

  const [expanded, setExpanded] = useState<Record<string, Set<number>>>({});
  const [arrayExpanded, setArrayExpanded] = useState<Record<string, Set<number>>>({});

  const [cursor, setCursor] = useState(0);
  /** Node id to land the cursor on once the rows have rebuilt around it. */
  const [pending, setPending] = useState<number | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [storage, setStorage] = useState<StorageInfo | null>(null);
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

  const onExport = useCallback(
    async (includePayloads: boolean) => {
      const bundle = await exportBundle(includePayloads);
      const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `json-notes-${new Date().toISOString().slice(0, 10)}${includePayloads ? "-full" : ""}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
      flash(includePayloads ? "exported notes + payloads" : "exported annotations");
    },
    [flash],
  );

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

  const visible = useMemo(
    () => (doc ? computeVisible(doc, docNotes, dSearch, filter) : null),
    [doc, docNotes, dSearch, filter],
  );

  const rows = useMemo(
    () =>
      doc
        ? buildRows({
            doc,
            notes: docNotes,
            expanded: expanded[doc.name] ?? NO_SET,
            arrayExpanded: arrayExpanded[doc.name] ?? NO_SET,
            visible,
          })
        : [],
    [doc, docNotes, expanded, arrayExpanded, visible],
  );

  const counts = useMemo(
    () => (doc ? countPaths(doc, docNotes) : { total: 0, marked: 0, untriaged: 0 }),
    [doc, docNotes],
  );

  const tabCounts = useMemo(
    () => docs.map((d) => countPaths(d, notes[d.name] ?? NO_NOTES)),
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

  const onMark = useCallback(
    (path: string, m: Mark) => {
      if (!doc) return;
      const cur = notesRef.current[doc.name]?.[path]?.mark;
      const next = cur === m ? undefined : m;
      patch(doc.name, path, { mark: next });
      // Behaviour 16: ignoring a container folds it away.
      if (next === "ignore") {
        const ids = doc.pathIndex.get(path) ?? [];
        setExpanded((prev) => {
          const s = new Set(prev[doc.name] ?? []);
          for (const id of ids) s.delete(id);
          return { ...prev, [doc.name]: s };
        });
      }
    },
    [doc, patch],
  );

  const onNote = useCallback(
    (path: string, note: string) => {
      if (!doc) return;
      patch(doc.name, path, { note: note.trim() ? note : undefined });
    },
    [doc, patch],
  );

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

      case "i":
      case "*":
        if (!row?.more) {
          e.preventDefault();
          onMark(row!.path, "interesting");
          move(1);
        }
        return;
      case "q":
      case "?":
        if (!row?.more) {
          e.preventDefault();
          onMark(row!.path, "question");
          move(1);
        }
        return;
      case "x":
      case "-":
        if (!row?.more) {
          e.preventDefault();
          onMark(row!.path, "ignore");
          move(1);
        }
        return;

      case "Enter":
      case "n":
        if (row && !row.more) {
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

  const featureRows: FeatureRow[] = useMemo(() => {
    const map = new Map<string, FeatureRow>();
    const seed = (id: string) => {
      if (!map.has(id))
        map.set(id, { id, need: features[id]?.need, status: "missing", links: [] });
      return map.get(id)!;
    };
    for (const id of Object.keys(features)) seed(id);
    for (const d of docs) {
      for (const [path, e] of Object.entries(notes[d.name] ?? {})) {
        for (const id of featureIdsIn(e.note)) {
          seed(id).links.push({
            doc: d.name,
            path,
            question: e.mark === "question",
            note: e.note ?? "",
          });
        }
      }
    }
    for (const f of map.values()) {
      f.status = !f.links.length
        ? "missing"
        : f.links.some((l) => l.question)
          ? "unresolved"
          : "covered";
    }
    return [...map.values()].sort((a, b) => a.id.localeCompare(b.id));
  }, [docs, notes, features]);

  // Autocomplete offers ids already linked from a note plus ones explicitly declared.
  const featureIds = useMemo(() => featureRows.map((f) => f.id), [featureRows]);

  // features.yaml holds ONLY what you typed deliberately: descriptions, and features
  // declared with no linked key yet. Ids that appear in a note are derived on load, so
  // half-typed `@fea` never reaches disk.
  const onNeed = useCallback((id: string, need: string) => {
    setFeatures((prev) => {
      const next = { ...prev, [id]: { id, need: need.trim() || undefined } };
      void putFeatures(next);
      return next;
    });
  }, []);

  const onAddFeature = useCallback((raw: string) => {
    const id = raw.trim().replace(/^@/, "");
    if (!/^[A-Za-z0-9][\w-]*$/.test(id)) return;
    setFeatures((prev) => {
      if (prev[id]) return prev;
      const next = { ...prev, [id]: { id } };
      void putFeatures(next);
      return next;
    });
  }, []);

  const onDropFeature = useCallback((id: string) => {
    setFeatures((prev) => {
      if (!(id in prev)) return prev;
      const { [id]: _drop, ...next } = prev;
      void putFeatures(next);
      return next;
    });
  }, []);

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
          <span className="badge">{featureRows.length}</span>
        </button>
        <div className="tools">
          <Menu
            items={[
              {
                label: "Open files…",
                hint: "or drag them in",
                onClick: () => fileRef.current?.click(),
              },
              { separator: true },
              {
                label: "Export annotations",
                hint: "small, no payload data",
                onClick: () => onExport(false),
              },
              {
                label: "Export everything",
                hint: "includes customer data",
                onClick: () => onExport(true),
              },
              { separator: true },
              {
                note: storage
                  ? `Stored in this browser${storage.usageMB != null ? ` · ${storage.usageMB.toFixed(1)} MB used` : ""}${storage.persisted ? " · persistent" : " · not persistent, export regularly"}`
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

      {onFeatures ? (
        <FeaturesPanel
          rows={featureRows}
          onNeed={onNeed}
          onJump={onJump}
          onAdd={onAddFeature}
          onDrop={onDropFeature}
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
          <Breadcrumb doc={doc!} path={rows[cursor]?.path ?? null} notes={docNotes} />
          <TreeView
            rows={rows}
            notes={docNotes}
            editing={editing}
            cursor={cursor}
            featureIds={featureIds}
            onToggle={onToggle}
            onExpandArray={onExpandArray}
            onMark={onMark}
            onNote={onNote}
            onEdit={setEditing}
            onCopy={onCopy}
            onCursor={setCursor}
          />
          <div className="legend">
            <span className="lg-marks">
              <b className="m-i">i</b> interesting
              <b className="m-q">q</b> question
              <b className="m-x">x</b> ignore
            </span>
            <span className="lg-div" />
            <span><b>j k</b> move</span>
            <span><b>h l</b> fold</span>
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
