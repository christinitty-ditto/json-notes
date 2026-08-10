/**
 * Serves the built dist/ exactly as a static host would, so the production output can
 * be checked before publishing.
 *
 *   bun scripts/build.ts && bun scripts/preview.ts
 */
import { existsSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const DIST = resolve(import.meta.dir, "..", "dist");
if (!existsSync(DIST)) {
  console.error("no dist/ — run: bun scripts/build.ts");
  process.exit(1);
}

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".png": "image/png",
  ".xml": "application/xml",
  ".txt": "text/plain; charset=utf-8",
};

const server = Bun.serve({
  port: Number(process.env.PORT ?? 5175),
  async fetch(req) {
    const url = new URL(req.url);
    let path = decodeURIComponent(url.pathname);
    let file = join(DIST, path);

    // Directory URLs serve their index.html, as a static host does.
    if (existsSync(file) && statSync(file).isDirectory()) file = join(file, "index.html");
    if (!existsSync(file)) return new Response("not found", { status: 404 });

    const ext = file.slice(file.lastIndexOf("."));
    return new Response(Bun.file(file), {
      headers: {
        "content-type": TYPES[ext] ?? "application/octet-stream",
        "cache-control": "no-store",
      },
    });
  },
});

console.log(`preview of dist/  →  http://localhost:${server.port}`);
console.log(`  landing  http://localhost:${server.port}/`);
console.log(`  app      http://localhost:${server.port}/app/`);
