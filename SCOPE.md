# json-notes — v1 scope

A local tool for annotating large, undocumented third-party JSON payloads key by key,
and exporting the notes as shareable markdown.

**Governing principle:** the tool never decides what matters. It renders the payload
faithfully and gives you somewhere to write. No inferred types, formats, enums,
nullability, or presence stats. Every transform it applies (collapsing, folding,
filtering) is visible on screen and reversible.

---

## Invocation

```
json-notes resp.json
json-notes ergo-quote.json ergo-change-req.json ergo-change-resp.json abhi-renew.json
```

Starts a local server, opens the browser. One tab per payload.

## Files

```
resp.json          the payload (yours, never modified)
resp.notes.yaml    marks + notes for that payload   — created by the tool
features.yaml      shared across all payloads       — created by the tool
```

Sidecars sit next to each payload. `features.yaml` sits in the working directory.
No project scaffold, no config, no init.

## Data model

```ts
type Mark  = "interesting" | "question" | "ignore"
type Entry = { mark?: Mark; note?: string }
type Notes = Record<string, Entry>      // normalized path → entry, per payload

type Feature  = { id: string; need?: string }
type Features = Record<string, Feature> // shared across payloads
```

Paths normalize array indices to `[]`:

```
response.policyData[0].Members[2].Relation
  → response.policyData[].Members[].Relation
```

Consequence: pointing the tool at a newer payload from the same endpoint reattaches
existing notes automatically. Keys that no longer appear stay in the yaml, unreferenced.

**Feature links are not stored separately.** A path is linked to a feature by the token
`@feature-id` appearing in its note text. Typing `@new-id` creates the feature.

## Architecture note

The tree renders as **a flat array of visible rows**, each carrying its depth, rebuilt
when nodes expand or collapse — not as recursive components. Required for virtualization,
and it makes search, filter, and the header counts operations on that one array.

---

## UI behaviours

**Tree**

1. Render the payload as a collapsible tree — same keys, same order, same values.
2. Scalar key renders as one row: `key: value`.
3. Object/array key renders as a header row with an expand toggle.
4. `""`, `null`, and the literal string `"null"` render distinctly from each other.
5. Long values truncate; click expands in place.
6. Nodes below depth 2 start collapsed.
7. Single-child chains compress to one row (`session > data > policy`).
8. Array items after the first collapse behind a `+ N more` row; clicking expands all.
9. Virtualized — only visible rows mount. Row heights measured dynamically, since
   expanded values and open note editors vary in height.

**Annotation**

10. Every row carries three mark buttons: `*` interesting, `?` question, `-` ignore.
    Clicking a set mark clears it. No mark = untriaged.
11. Marked rows show their mark as a glyph; `-` rows render dimmed.
12. Clicking a key opens an inline note editor, positioned against that key.
13. **Container rows (objects and arrays) are annotatable exactly like scalar rows** —
    a note on `...Questions.MedicalQuestions` documents that whole section.
14. **`-` on a container inherits to all descendants.** They render dimmed with an
    inherited glyph, count as triaged, and can be individually overridden. Inheritance is
    computed by walking ancestors — nothing is written for descendants.
15. **`*` and `?` do not inherit**, and notes never inherit. A section marked interesting
    does not mean its children have been reviewed.
16. `-` on a container collapses it. Reversible by expanding.
17. A sticky breadcrumb shows the current path, indicating which ancestors are annotated.
18. A mark and a note are independent — either can exist without the other.
19. Typing `@` in a note opens autocomplete over existing features, with "create new".
20. Marks and notes autosave, debounced 500ms.
21. Click-to-copy the normalized path of any row.

**Keyboard**

22. A cursor row drives navigation. Clicking a row moves it there; the breadcrumb follows
    the cursor rather than the scroll position.
23. `j k` move · `d u` half page · `g G` ends · `l h` expand/collapse or step in/out ·
    `i q x` mark and advance · `⏎` note · `y` copy path · `/` search · `[ ]` switch tab.
24. A legend line at the foot of the window lists the bindings.
25. Keys are inert while a text field has focus; `Esc` leaves the field.

**Finding things**

26. Search box matches against key name, full path, and value. Matching rows show with
    their ancestors retained for context, and the cursor lands on the first real match.
    `↓`/`↑` step between matches; `⏎` goes to the selected one — clearing the search and
    expanding its ancestors, so you end up looking at the key in context rather than in
    a filtered list.
27. Filter: `all` / `untriaged` / `*` / `?`. Composes with search.
27a. A matched container shows its **subtree**, not just its own row — marking a section
    `*` means the section is interesting, so filtering to `*` has to show what is in it.
    Ancestors and the match itself open automatically; below the match your own collapse
    state applies, so a large section stays browsable instead of being dumped whole.
28. Header shows `N keys · N marked · N untriaged`. Descendants of a `-` container count
    as triaged.

**Tabs**

29. One tab per payload. Each has its own notes sidecar; marks and notes do not carry
    across tabs.
30. Tab shows its own untriaged count.

**Features**

31. A Features tab lists every feature, its description, and its linked paths.
32. Ids come from typing `@` in a note, or from declaring one in the panel. Descriptions
    are edited there.
33. **Only deliberate entries reach `features.yaml`** — descriptions and declared-but-
    unlinked features. An id already linked from a note is derived on load, so a
    half-typed `@fea` never persists.
34. Status derives from links and marks — no separate status field:
    - **missing** — zero linked paths
    - **unresolved** — any linked path marked `?`
    - **covered** — otherwise
35. Coverage rolls up across all open tabs.
36. Clicking a linked path jumps to it in its tab and lands the cursor on it.
37. A declared feature with no links can be removed from the panel.

**Payloads**

38. Added by the `+` button or by dragging JSON files onto the window; a whole-window
    overlay shows the drop target.
39. Dropping a name that already exists replaces the payload and keeps its annotations.
40. `✕` on a tab removes a payload; its notes are kept so adding it again restores them.
41. A payload that fails to parse is reported, not fatal.

**Client-side only**

42. No backend. Payloads and annotations live in the browser's IndexedDB and are never
    transmitted — there is no server endpoint to transmit them to.
43. The build is static files, servable from anywhere.
44. Export bundles: annotations only, or annotations plus payloads. Dropping a bundle on
    the window restores it.
45. Imports **merge** — existing annotations win, so restoring an old backup cannot
    clobber newer work.
46. `scripts/bundle.ts` converts an older file-backed workspace into an import bundle.
47. Storage persistence is requested on load; the `⋯` menu reports usage and whether it
    was granted, since eviction is the reason exports matter.

**Running as an app**

48. Web manifest, service worker and icons, so it installs as a standalone PWA and works
    offline.
49. An optional per-user macOS LaunchAgent serves the files at login
    (`bun run agent install|status|restart|logs|uninstall`).

---

## Backend

`node:http`, three routes, no framework:

```
GET /api/state      → { payloads, notes, features }
PUT /api/notes      → write <payload>.notes.yaml
PUT /api/features   → write features.yaml
```

## Stack

Vite + React + TypeScript. Plain CSS, monospace. One dependency for YAML, one for
virtualization. No Tailwind, no component library.

---

## Build order

Usable after phase 1; each phase ships independently.

| Phase | Contents |
|---|---|
| **1** | Walker, flat row list, tree render, marks, notes on any row incl. containers, `-` inheritance, autosave |
| **2** | Virtualization, search, filter, header counts, sticky breadcrumb |
| **3** | Tabs |
| **4** | Features, `@` autocomplete, coverage view |

---

## Explicitly out of scope

| Cut | Reconsider when |
|---|---|
| Markdown export | you need to share notes outside the tool |
| Coverage export | you need to share the coverage answer outside the tool |
| Merging several samples of one endpoint into one tree | one sample stops being enough |
| Sharing marks/notes across payloads (ERGO request ↔ response) | duplicate typing gets annoying |
| Annotated JSONC export | you want a diffable review artefact |
| Spreadsheet / XLSX export | you need to share with non-engineers |
| Value-level notes (code dictionaries: `O002`, `MHIN`, `Z003`) | key-level notes prove insufficient |
| LLM-drafted notes | — |

---

## Done when

Opening all four payloads shows four tabs, each rendering its full tree without manual
setup. A `?` mark and a note reading `confirm with ERGO @tenure-upsell` typed against
`session.data.policy.Term` survives a page reload, drops the header untriaged count by
one, is findable by searching `Term`, and shows `tenure-upsell` as **unresolved** in the
Features tab. Marking `bancassurance` with `-` collapses it and removes its ~40 keys from
the untriaged count.
