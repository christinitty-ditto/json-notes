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

That matters because a sample response captured from a real endpoint usually carries
real customer data.

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

Browsers can evict site data under pressure, so exports are your safety net — which is
why **`↓ export`** sits in the toolbar rather than inside a menu. It writes one JSON file
holding every payload plus all marks, notes and features, so treat it as carrying
whatever customer data your samples do.

Drop an exported bundle back onto the window to restore it. Imports **merge** — existing
annotations win, so restoring an old backup never clobbers newer work. Bundles with no
payloads in them still import, which is what `scripts/bundle.ts` below produces.

Migrating from an older file-backed workspace:

```sh
bun scripts/bundle.ts ~/.json-notes > bundle.json   # then drop bundle.json on the app
```

### The one permission

Browsers can mark a site's storage persistent, which makes eviction unlikely. The app
asks for it **once**, and not until you have opened a payload of your own — asking on
load, before you have anything to lose, earns a reflexive no. The notice says why it is
asking; `not now` is a real answer.

If it is not granted, nothing breaks. `navigator.storage.persist()` answers with a bare
boolean and cannot tell a refusal from the browser quietly deciding against it, so the
permission state is read separately and you are told which happened — a refusal you can
reverse in your browser's settings for the site, a silent decline had no prompt to
refuse. Either way the app keeps working and the export is what protects you. The
question is never asked twice; the explanation stays in the `⋯` menu, which also reports
storage usage and the current state.

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
| `space` | select this row too — marks and notes then apply to everything selected |
| `⏎` `n` | write a note |
| `y` | copy the normalized path |
| `/` | search |
| `↓` `↑` *(in search)* | step through matches, skipping the ancestors shown for context |
| `⏎` *(in search)* | go to the selected match — clears the filter and expands around it |
| `[` `]` | previous / next tab |

Marking advances the cursor, so a sweep is `x x i x q x` without touching the mouse. With
the `untriaged` filter on, marked rows drop out as you go.

**Several keys at once.** `space` adds the cursor row to a selection, shift-click takes
the whole run from the cursor. A bar appears while anything is selected: mark all of them
at once, or write **one note against every one** — which is what you want for the six
fields that are all the same undocumented code list. Where the selected keys already have
different notes, the field starts empty and tells you how many saving will replace.

## What it does

Renders the payload verbatim as a collapsible tree and lets you write a note against any
key — including container keys, so you can document a whole section at its root.

**Marks.** Every row takes one of `*` interesting, `?` open question, `–` ignore.

`–` on a container inherits to everything below it: descendants dim, stop counting as
untriaged, and can still be overridden individually. On the 559-key sample payload,
marking `abstract_inverted_index` settles 336 keys in one click. `*` and `?` do not
inherit — a doubt about a section is not a review of its children.

**Progress.** The header counts unique normalized paths, so you can tell how much of a
big payload you have actually looked at. The `untriaged` filter shrinks the tree as you
go.

Annotating a key settles the containers above it, all the way up — writing a note on
`institutions[].ror` says you have been inside `institutions`, and leaving `institutions`
in the untriaged count is noise you could only clear by marking a section you have
nothing to say about. Those rows carry a faint `·` so they never read as something you
marked, and the moment you delete the note underneath, the `·` goes with it.

Filtering to `*` or `?` shows a matched container's whole section, not just its header
row — marking a block interesting means the block is interesting, so the filter has to
show what is in it. Ancestors and the match open automatically; deeper levels keep
whatever fold state you left them in.

**Features.** Type `@some-name` in a note to link that key to a feature, or declare one in
the features tab to track something you need but have not found. Group them into **sets**
(`work-card = author-affiliations, oa-status`) so a payload can be told what it owes in
one pick.

Each payload tab carries a strip of feature chips under the header — what this payload is
on the hook for, in front of you while you annotate rather than a tab away. `+ pick`
chooses which features and sets apply to it; anything you link with `@id` in a note is
applicable already and needs no second confirmation.

Status is **per payload**, because "covered" is only ever an answer about one payload — a
key in one endpoint's response says nothing about what another one carries:

| status | meaning |
|---|---|
| **missing** | applicable to this payload, but no key in it links the feature |
| **unresolved** | linked here, and at least one linked key here is still marked `?` |
| **covered** | linked here, and nothing linked here is still a question |

Chips sort gaps first, so the strip reads as what this payload has not answered yet. The
features tab is the registry behind it: declare features and sets, say what each is for,
and see every payload each one applies to.

## What gets stored

Only what you typed on purpose. A feature already linked from a note is derived on load
rather than stored, so a half-typed `@fea` never persists — and so is a payload's
applicability to it, so linking is the only statement you have to make.

Annotations are keyed by payload name plus normalized path, which is why exports restore
cleanly and why a fresher sample of the same endpoint keeps its notes.

## Paths

Array indices collapse, so annotations attach to the shape rather than to one sample:

```
authorships[0].institutions[2].display_name
  → authorships[].institutions[].display_name
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
search, filtering and the counts operations on one array. Only the rows on screen are
mounted, plus 18 either side as overscan — a few dozen at a time, whatever the payload
size and however much of it is expanded.

Icons are generated, not vendored — `bun run icons` writes the PNGs with a small encoder
over `node:zlib`, so there is no binary asset to keep in sync.
