/**
 * Times the hot paths against a real payload.
 *   bun scripts/bench.ts [payload.json]
 */
import { join } from "node:path";
import { buildDoc, countPaths, rolledUpTriage } from "../src/walker.ts";
import { buildRows, computeVisible, defaultExpanded } from "../src/rows.ts";
import type { Notes } from "../src/types.ts";

// Defaults to the payload that ships with the repo, so the numbers are reproducible by
// anyone and no sample of yours is read by a script you ran to time something.
const file = process.argv[2] ?? join(import.meta.dir, "..", "src", "demo-payload.json");

const raw = await Bun.file(file).text();
const json = JSON.parse(raw);

function time(label: string, runs: number, fn: () => unknown) {
  fn(); // warm
  const t0 = performance.now();
  for (let i = 0; i < runs; i++) fn();
  const ms = (performance.now() - t0) / runs;
  console.log(`  ${label.padEnd(46)} ${ms.toFixed(3)} ms`);
  return ms;
}

console.log(`\n${file.split("/").pop()}  (${(raw.length / 1024).toFixed(0)} KB)\n`);

const doc = buildDoc("bench", file, json);
console.log(`  nodes ${doc.nodes.length}   unique paths ${doc.pathIndex.size}\n`);

const notes: Notes = {};
// A realistic mid-session state: some marks, some notes, one ignored container.
const somePaths = [...doc.pathIndex.keys()];
for (let i = 0; i < somePaths.length; i += 17) notes[somePaths[i]!] = { mark: "interesting" };
for (let i = 5; i < somePaths.length; i += 29) notes[somePaths[i]!] = { note: "a note @feat" };
// The biggest top-level section, whatever the payload is — ignoring that is the case
// where inheritance has the most work to do.
const container =
  somePaths
    .filter((p) => p && !p.includes("."))
    .sort((a, b) => somePaths.filter((p) => p.startsWith(b + ".")).length -
                     somePaths.filter((p) => p.startsWith(a + ".")).length)[0] ?? somePaths[3]!;
notes[container] = { mark: "ignore" };
const rolled = rolledUpTriage(doc, notes);

console.log("one-off (per payload load)");
time("buildDoc", 20, () => buildDoc("bench", file, json));
time("JSON.parse", 20, () => JSON.parse(raw));

console.log("\nper interaction");
const expanded = defaultExpanded(doc);
const allExpanded = new Set(doc.nodes.filter((n) => n.kind !== "scalar").map((n) => n.id));
const arrays = new Set<number>();

time("buildRows (default collapsed)", 200, () =>
  buildRows({ doc, notes, expanded, arrayExpanded: arrays, rolled, visible: null }),
);
time("buildRows (everything expanded)", 200, () =>
  buildRows({ doc, notes, expanded: allExpanded, arrayExpanded: arrays, rolled, visible: null }),
);
time("computeVisible (search 'e')", 200, () => computeVisible(doc, notes, "e", "all", rolled));
time("computeVisible (search 'institution')", 200, () => computeVisible(doc, notes, "institution", "all", rolled));
time("computeVisible (filter untriaged)", 200, () => computeVisible(doc, notes, "", "untriaged", rolled));
time("countPaths", 200, () => countPaths(doc, notes, rolled));

console.log("\ncomposite: one keystroke in a note (what React re-runs)");
const perKeystroke = time("countPaths + buildRows + computeVisible", 200, () => {
  countPaths(doc, notes, rolled);
  computeVisible(doc, notes, "", "all", rolled);
  buildRows({ doc, notes, expanded: allExpanded, arrayExpanded: arrays, rolled, visible: null });
});

console.log("\ncomposite: same, with N payloads open (tab badges recount all)");
for (const n of [1, 4, 10]) {
  const ms = time(`${n} tabs`, 100, () => {
    for (let i = 0; i < n; i++) countPaths(doc, notes, rolled);
    buildRows({ doc, notes, expanded: allExpanded, arrayExpanded: arrays, rolled, visible: null });
  });
  if (ms > 16) console.log(`      ^ over one 60fps frame (16.7ms)`);
}

console.log(
  `\nbudget: a keystroke has ~16.7ms before it drops a frame. currently ${perKeystroke.toFixed(2)} ms.\n`,
);
