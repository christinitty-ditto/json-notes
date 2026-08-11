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
json-notes quote-req.json quote-resp.json change-req.json change-resp.json
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

type FeatureSet  = { id: string; need?: string; features: string[] }
type FeatureSets = Record<string, FeatureSet>

type Applicable = Record<string, string[]>  // payload name → picked feature and set ids
```

Feature and set ids share one namespace. `@work-card` in a note has to mean exactly
one thing.

Paths normalize array indices to `[]`:

```
authorships[0].institutions[2].display_name
  → authorships[].institutions[].display_name
```

Consequence: pointing the tool at a newer payload from the same endpoint reattaches
existing notes automatically. Keys that no longer appear stay in the yaml, unreferenced.

**Feature links are not stored separately.** A path is linked to a feature by the token
`@feature-id` appearing in its note text. Typing `@new-id` creates the feature.

**Applicability is likewise half derived.** `Applicable` holds only what you picked by
hand against a payload. A feature linked from a note in that payload is applicable to it
by that fact, computed on load. So **missing** is only reachable by picking — it means
"I said this payload should carry it and no key here does", never "you have not got to
it yet".

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
7. Single-child chains compress to one row (`primary_location > source`).
8. Array items after the first collapse behind a `+ N more` row; clicking expands all.
9. Virtualized — only visible rows mount. Row heights measured dynamically, since
   expanded values and open note editors vary in height.

**Annotation**

10. Every row carries three mark buttons: `*` interesting, `?` question, `-` ignore.
    Clicking a set mark clears it. No mark = untriaged.
11. Marked rows show their mark as a glyph; `-` rows render dimmed.
12. Clicking a key opens an inline note editor, positioned against that key.
13. **Container rows (objects and arrays) are annotatable exactly like scalar rows** —
    a note on `authorships[].institutions` documents that whole section.
14. **`-` on a container inherits to all descendants.** They render dimmed with an
    inherited glyph, count as triaged, and can be individually overridden. Inheritance is
    computed by walking ancestors — nothing is written for descendants.
14a. **Any annotation below a container settles the container**, all the way up the
    ancestor chain. Writing a note on `institutions[].ror` says you have been inside
    `institutions`; leaving `institutions` in the untriaged count is noise you could only clear by
    marking a container you have nothing to say about. Rolled-up rows carry a faint `·`
    and are never confused with rows you marked — derived, stored nowhere, and gone the
    moment the annotation under them is.
15. **`*` and `?` do not inherit**, and notes never inherit. A section marked interesting
    does not mean its children have been reviewed.
16. `-` on a container collapses it. Reversible by expanding.
17. A sticky breadcrumb shows the current path, indicating which ancestors are annotated.
18. A mark and a note are independent — either can exist without the other.
19. Typing `@` in a note opens autocomplete over existing features, with "create new".
20. Marks and notes autosave, debounced 500ms.
21. Click-to-copy the normalized path of any row.
21a. **Several rows can be selected and annotated together** — `space` toggles the cursor
    row, shift-click takes the run from the cursor. A bar appears while anything is
    selected: it marks all of them, or writes **one note to every one**. Selection is by
    normalized path, the unit annotations already use, and is dropped when you change tab.
21b. The shared note starts from text the selected keys already agree on, and where they
    differ it starts empty and says how many notes saving will replace. A bulk write that
    silently ate four different notes would not be recoverable.

**Keyboard**

22. A cursor row drives navigation. Clicking a row moves it there; the breadcrumb follows
    the cursor rather than the scroll position.
23. `j k` move · `d u` half page · `g G` ends · `l h` expand/collapse or step in/out ·
    `i q x` mark and advance · `space` select · `⏎` note · `y` copy path · `/` search ·
    `[ ]` switch tab. With a selection up, `i q x` and `⏎` act on all of it and the
    cursor stays put — advancing through rows you have just settled in bulk only loses
    your place. `Esc` drops the selection before it clears the search.
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
28. Header shows `N keys · N marked · N untriaged`. Untriaged means nothing said about
    it, nothing said below it, and no `-` above it — the count and the `untriaged` filter
    run through one predicate so the number and the rows cannot disagree. `marked` stays
    literal, explicit marks only; it was never the complement, since a row settled by an
    ancestor's `-` is neither.

**Tabs**

29. One tab per payload. Each has its own notes sidecar; marks and notes do not carry
    across tabs.
30. Tab shows its own untriaged count.

**Features**

31. The Features tab is a **registry**, not a scoreboard: it declares features, groups
    them into sets, and records what each is for. It does not group by status, because
    status is not a property a feature has on its own — see 34.
32. Ids come from typing `@` in a note, from declaring one in the panel, or from adding
    one to a set. Descriptions are edited there.
33. **Only deliberate entries are stored** — descriptions, declared features and sets, and
    the picks made against a payload. An id already linked from a note is derived on load,
    so a half-typed `@fea` never persists.
34. **Status is per (feature, payload).** "Covered" is only ever an answer about one
    payload: a key in one endpoint's response says nothing about what another one
    carries. Derived from links and marks, no stored field:
    - **missing** — applicable to this payload, no key in it links the feature
    - **unresolved** — linked here, and some linked key here is marked `?`
    - **covered** — linked here, and none is
35. A **feature set** (`work-card = author-affiliations, oa-status`) exists so a payload can
    be told what it owes in one pick rather than several. A set is only as good as its
    weakest feature in that payload.
36. Clicking a linked path jumps to it in its tab and lands the cursor on it.
37. A declared feature can be removed once nothing links it, no set holds it, and no
    payload has picked it. Removing a set drops the picks that named it.

**The feature strip**

37a. Each payload tab carries a one-line strip under the header: a chip per applicable
    feature, with its status dot and how many keys here link it. It is in front of you
    while you annotate rather than a tab away, since that is when knowing a feature is
    still unanswered changes what you do next.
37b. **Gaps first.** Chips sort missing, then unresolved, then covered. The strip's job is
    to say what this payload has not answered.
37c. `+ pick` chooses what the payload is on the hook for — sets and loose features both,
    a set pulling in its members. Chips that are applicable only because a note links them
    show as already ticked and cannot be unticked; offering a checkbox that does nothing
    would be a lie, so it says where the chip came from instead.
37d. Clicking a chip jumps to the first key here that links it.

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
44. One export, and it carries everything: every payload plus all annotations, in one
    bundle. It is a toolbar button rather than a menu item — eviction makes it the safety
    net, so it cannot be something you have to go looking for. Dropping a bundle on the
    window restores it; bundles carrying no payloads still import, since older exports and
    `scripts/bundle.ts` produce them.
45. Imports **merge** — existing annotations win, so restoring an old backup cannot
    clobber newer work.
46. `scripts/bundle.ts` converts an older file-backed workspace into an import bundle.
47. Storage persistence is the one permission asked for, and it is asked **once, late,
    and with the reason attached** — never on load, and not until a payload that is not
    the sample has been opened. A prompt fired at someone who has not used the app yet is
    one they have no reason to grant.
48. **Refusal is a supported state, not an error.** `persist()` returns a bare boolean and
    cannot tell "you said no" from "the browser decided no", so the permission state is
    read separately and the notice says which happened: site settings can be changed after
    a refusal, whereas a silent decline had no prompt to refuse. Either way nothing stops
    working, the notice points at `↓ export`, and it is never raised again — the
    explanation moves into the `⋯` menu, which also reports usage and current state.

**Running as an app**

49. Web manifest, service worker and icons, so it installs as a standalone PWA and works
    offline.
50. An optional per-user macOS LaunchAgent serves the files at login
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
| **5** | Multi-select annotation, triage roll-up, feature sets, per-payload applicability and strip |

---

## Explicitly out of scope

| Cut | Reconsider when |
|---|---|
| Sharing by URL rather than by file | sending the export file becomes real friction † |
| Markdown export | you need to share notes outside the tool |
| Coverage export | you need to share the coverage answer outside the tool |
| Merging several samples of one endpoint into one tree | one sample stops being enough |
| Sharing marks/notes across payloads (a request ↔ its response) | duplicate typing gets annoying |
| Annotated JSONC export | you want a diffable review artefact |
| Spreadsheet / XLSX export | you need to share with non-engineers |
| Value-level notes (code dictionaries: `C2778805511`, `I4200000001`) | key-level notes prove insufficient |
| LLM-drafted notes | — |

† A share link has two possible shapes and neither is worth it yet. A link that *points*
at a hosted file cannot work at all: `connect-src 'none'` means the app fetches nothing,
and relaxing it to allow one fetch gives up the property that the app provably cannot
transmit a payload anywhere. A link that *carries* the data in its `#` fragment needs no
network and is technically fine — fragments are never sent in the request — but measured
against the OpenAlex sample it runs 4.3k chars for annotations alone and 12.9k with the
45 KB payload included, and the payload variant would put customer data into whatever
chat log the link is pasted in. The export button already produces payload + annotations
as one file that restores on drop; the only thing a link adds is clickability.

---

## Done when

Opening all four payloads shows four tabs, each rendering its full tree without manual
setup. A `?` mark and a note reading `ask the vendor @oa-status` typed against
`open_access.oa_status` survives a page reload, is findable by searching `oa_status`, and
puts an `@oa-status` chip on that payload's strip reading **unresolved**. It drops the
header untriaged count by more than one, because `open_access` and the root above it are
settled by it.

On the 559-key sample payload, marking `abstract_inverted_index` with `-` collapses it and
takes 336 keys out of the untriaged count in one click.

Selecting the four `ids.*` keys with `space` and typing one note against all of them
writes that note to each. Declaring `work-card = author-affiliations, oa-status` and
picking it on one payload puts both on that payload's strip — `author-affiliations`
**missing**, since nothing there links it — while picking it on another payload answers
the same question separately.
