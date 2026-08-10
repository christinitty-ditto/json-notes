#!/usr/bin/env bun
/**
 * A static file server, nothing more. The app is entirely client-side: payloads and
 * annotations live in the browser's IndexedDB and never touch this process. That means
 * the built output can equally be dropped on any static host.
 */
import { join } from "node:path";
import index from "./index.html";

const PUBLIC = join(import.meta.dir, "public");
const DEV = process.env.NODE_ENV !== "production";

const asset = (name: string, type: string) => () =>
  new Response(Bun.file(join(PUBLIC, name)), {
    headers: { "content-type": type, "cache-control": "no-cache" },
  });

const server = Bun.serve({
  port: Number(process.env.PORT ?? 5174),
  development: DEV,
  routes: {
    "/": index,
    "/manifest.webmanifest": asset("manifest.webmanifest", "application/manifest+json"),
    // Served from the root so the worker's scope covers the whole app.
    "/sw.js": asset("sw.js", "text/javascript"),
    "/icon-192.png": asset("icon-192.png", "image/png"),
    "/icon-512.png": asset("icon-512.png", "image/png"),
    "/icon-maskable-512.png": asset("icon-maskable-512.png", "image/png"),
  },
});

console.log(`json-notes  →  http://localhost:${server.port}   [${DEV ? "dev" : "production"}]`);
console.log("  payloads and notes live in the browser; this process stores nothing");
