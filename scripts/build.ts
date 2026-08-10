/**
 * Produces the deployable site:
 *
 *   dist/index.html      landing page (SEO, no JS)
 *   dist/app/            the tool
 *   dist/robots.txt, sitemap.xml
 *
 * Everything the app references is relative, so the same output works at a domain root,
 * under a GitHub Pages project subpath, or on localhost.
 *
 *   BASE_URL=https://example.com bun scripts/build.ts
 */
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const DIST = join(ROOT, "dist");
const APP = join(DIST, "app");

/** No trailing slash. Defaults to the GitHub Pages project URL. */
const BASE = (process.env.BASE_URL ?? "https://christinitty-ditto.github.io/json-notes").replace(
  /\/+$/,
  "",
);
/** Optional <script> snippet for the landing page only — never the app. */
const ANALYTICS = process.env.ANALYTICS_SNIPPET ?? "";

rmSync(DIST, { recursive: true, force: true });
mkdirSync(APP, { recursive: true });

// ---- app ----------------------------------------------------------------
const built = await Bun.build({
  entrypoints: [join(ROOT, "index.html")],
  outdir: APP,
  minify: true,
  // index.html must stay unhashed so /app/ resolves; JS and CSS get content hashes
  // so they can be cached forever.
  naming: {
    entry: "[dir]/[name].[ext]",
    chunk: "[name]-[hash].[ext]",
    asset: "[name]-[hash].[ext]",
  },
});
if (!built.success) {
  for (const m of built.logs) console.error(m);
  process.exit(1);
}

for (const f of readdirSync(join(ROOT, "public"))) {
  await Bun.write(join(APP, f), Bun.file(join(ROOT, "public", f)));
}

// ---- landing page -------------------------------------------------------
const landing = (await Bun.file(join(ROOT, "site", "index.html")).text())
  .replaceAll("__BASE__", BASE)
  .replace("<!--__ANALYTICS__-->", ANALYTICS);
await Bun.write(join(DIST, "index.html"), landing);

// ---- crawler files ------------------------------------------------------
await Bun.write(
  join(DIST, "robots.txt"),
  `User-agent: *\nAllow: /\n\nSitemap: ${BASE}/sitemap.xml\n`,
);
const today = new Date().toISOString().slice(0, 10);
await Bun.write(
  join(DIST, "sitemap.xml"),
  `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemap.org/schemas/sitemap/0.9">
  <url><loc>${BASE}/</loc><lastmod>${today}</lastmod><priority>1.0</priority></url>
  <url><loc>${BASE}/app/</loc><lastmod>${today}</lastmod><priority>0.8</priority></url>
</urlset>
`,
);

// GitHub Pages otherwise runs the output through Jekyll, which skips files it does not
// recognise and can mangle asset names.
await Bun.write(join(DIST, ".nojekyll"), "");

// ---- report -------------------------------------------------------------
const kb = (n: number) => `${(n / 1024).toFixed(1)} KB`;
function walk(dir: string, prefix = ""): [string, number][] {
  const out: [string, number][] = [];
  for (const f of readdirSync(dir).sort()) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) out.push(...walk(p, `${prefix}${f}/`));
    else out.push([`${prefix}${f}`, statSync(p).size]);
  }
  return out;
}
console.log(`built for ${BASE}${ANALYTICS ? "  (with analytics on the landing page)" : ""}\n`);
let total = 0;
for (const [name, size] of walk(DIST)) {
  total += size;
  console.log(`  ${name.padEnd(34)} ${kb(size).padStart(9)}`);
}
console.log(`\n  ${"total".padEnd(34)} ${kb(total).padStart(9)}`);
if (!existsSync(join(APP, "sw.js"))) console.error("\nwarning: sw.js missing from app output");
