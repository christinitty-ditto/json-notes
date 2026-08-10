/**
 * One-off migration: turn an old file-backed workspace into an import bundle.
 *
 *   bun scripts/bundle.ts [workspace] > bundle.json
 *
 * Drop the resulting file onto the app to restore everything into browser storage.
 */
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { parse } from "yaml";

const HOME = resolve(process.argv[2] ?? join(homedir(), ".json-notes"));
const PAYLOADS = join(HOME, "payloads");
const NOTES = join(HOME, "notes");
const FEATURES = join(HOME, "features.yaml");

if (!existsSync(HOME)) {
  console.error(`no such workspace: ${HOME}`);
  process.exit(1);
}

const readYaml = async (p: string) => {
  if (!existsSync(p)) return {};
  try {
    return parse(await Bun.file(p).text()) ?? {};
  } catch {
    return {};
  }
};

const notes: Record<string, unknown> = {};
if (existsSync(NOTES)) {
  for (const f of readdirSync(NOTES)) {
    if (!f.endsWith(".notes.yaml")) continue;
    const name = f.replace(/\.notes\.yaml$/, "");
    const n = await readYaml(join(NOTES, f));
    if (Object.keys(n).length) notes[name] = n;
  }
}

const payloads: Record<string, string> = {};
if (existsSync(PAYLOADS)) {
  for (const f of readdirSync(PAYLOADS)) {
    if (!f.endsWith(".json")) continue;
    payloads[f.replace(/\.json$/i, "")] = await Bun.file(join(PAYLOADS, f)).text();
  }
}

const bundle = {
  format: "json-notes/bundle@1",
  exportedAt: new Date().toISOString(),
  notes,
  features: await readYaml(FEATURES),
  payloads,
};

console.log(JSON.stringify(bundle, null, 2));
console.error(
  `bundled ${Object.keys(payloads).length} payloads, ` +
    `${Object.keys(notes).length} annotated docs, ` +
    `${Object.keys(bundle.features).length} features from ${HOME}`,
);
