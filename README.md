# json-notes

**Document an undocumented JSON API, field by field.**

→ **[christinitty-ditto.github.io/json-notes](https://christinitty-ditto.github.io/json-notes/)**
 · [try it with a sample payload](https://christinitty-ditto.github.io/json-notes/app/?demo)

Built for the case where a partner ships an API with no usable docs and you have to work
out what every field means by staring at a sample response. You end up with two things:
a record of what you worked out, and the list of questions you still need answered.

See [SCOPE.md](SCOPE.md) for the design and what is deliberately left out.

## Runs entirely in your browser

There is no backend. Payloads and annotations are stored in the browser's IndexedDB and
never leave your machine — there is nowhere to send them. The app ships a
`connect-src 'none'` Content-Security-Policy, so network requests are blocked outright
and you can verify that in devtools rather than taking it on trust.

That matters if your payloads carry customer data, which for anyone integrating an
insurance, banking, or health API they almost certainly do.

Add payloads with the **`+`** button or by dragging JSON files anywhere onto the window.
Dropping a file whose name matches an existing payload replaces it and **keeps every
annotation**, which is what you want when a partner sends a fresher sample. `✕` on a tab
removes a payload; its notes are kept, so adding it again restores them.

## Run

```sh
bun install
bun run dev          # http://localhost:5174, hot reload
bun start            # production build
```

Because the app is client-side, the build is just static files — it can be served from
anywhere, including any static host.

Optionally keep it running locally across reboots with a per-user LaunchAgent (no sudo):

```sh
bun run agent install | status | restart | logs | uninstall
```

The agent only serves files; your data lives in the browser regardless.

**Install as a PWA** from Chrome's address bar to get it in its own window with its own
icon. The service worker caches the shell, so it works offline.

## Backups

Browsers can evict site data under pressure, so exports are your safety net. From the
`⋯` menu:

| | |
|---|---|
| **Export annotations** | marks, notes and features. Small, no payload data. |
| **Export everything** | the above plus the payloads — contains customer data. |

Drop an exported bundle back onto the window to restore it. Imports **merge** — existing
annotations win, so restoring an old backup never clobbers newer work.

Migrating from an older file-backed workspace:

```sh
bun scripts/bundle.ts ~/.json-notes > bundle.json   # then drop bundle.json on the app
```

## Keyboard

A cursor row drives everything; clicking a row moves it there.

| | |
|---|---|
| `j` `k` / `↓` `↑` | move |
| `d` `u` | half page |
| `g` `G` | first / last row |
| `l` / `→` | expand, or step into the first child |
| `h` / `←` | collapse, or jump out to the enclosing container |
| `i` `q` `x` | mark `*` `?` `–` and advance — press again on the same row to clear |
| `⏎` `n` | write a note |
| `y` | copy the normalized path |
| `/` | search |
| `↓` `↑` *(in search)* | step through matches, skipping the ancestors shown for context |
| `⏎` *(in search)* | go to the selected match — clears the filter and expands around it |
| `[` `]` | previous / next tab |

Marking advances the cursor, so a sweep is `x x i x q x` without touching the mouse. With
the `untriaged` filter on, marked rows drop out as you go.

## What it does

Renders the payload verbatim as a collapsible tree and lets you write a note against any
key — including container keys, so you can document a whole section at its root.

**Marks.** Every row takes one of `*` interesting, `?` open question, `–` ignore.

`–` on a container inherits to everything below it: descendants dim, stop counting as
untriaged, and can still be overridden individually. Marking `bancassurance` in the ERGO
sample settles 53 keys in one click. `*` and `?` do not inherit — a doubt about a section
is not a review of its children.

**Progress.** The header counts unique normalized paths, so you can tell how much of a
1150-key payload you have actually looked at. The `untriaged` filter shrinks the tree as
you go.

Filtering to `*` or `?` shows a matched container's whole section, not just its header
row — marking `member` interesting means the block is interesting, so the filter has to
show what is in it. Ancestors and the match open automatically; deeper levels keep
whatever fold state you left them in.

**Features.** Type `@some-name` in a note to link that key to a feature, or declare one in
the features tab to track something you need but have not found. The roll-up spans every
open payload and answers *can I build this with what the payload gives me*:

| status | meaning |
|---|---|
| **missing** | no key anywhere is linked to it — the payload does not support it |
| **unresolved** | linked, but at least one linked key is still marked `?` |
| **covered** | linked, and nothing linked is still a question |

## What gets stored

Only what you typed on purpose. A feature already linked from a note is derived on load
rather than stored, so a half-typed `@fea` never persists.

Annotations are keyed by payload name plus normalized path, which is why exports restore
cleanly and why a fresher sample of the same endpoint keeps its notes.

## Paths

Array indices collapse, so annotations attach to the shape rather than to one sample:

```
response.policyData[0].Members[2].Relation
  → response.policyData[].Members[].Relation
```

Point the tool at next month's payload from the same endpoint and your notes reattach.
Keys that disappear stay in the yaml, unreferenced.

## Design rule

The tool never decides what matters. It infers no types, formats, enums, or nullability,
and never drafts a note. Every transform it applies — collapsed arrays, folded chains,
filtered rows — is visible on screen and reversible by clicking.

## Notes on the stack

Bun serves the API and bundles the frontend; there is no separate build step. React 19,
TypeScript, `@tanstack/react-virtual`, plain CSS. The tree renders as a flat array of
visible rows rather than recursive components — required for virtualization, and it makes
search, filtering and the counts operations on one array. On the 1150-key ERGO sample with
everything expanded, ~54 rows are in the DOM at a time.

Icons are generated, not vendored — `bun run icons` writes the PNGs with a small encoder
over `node:zlib`, so there is no binary asset to keep in sync.
