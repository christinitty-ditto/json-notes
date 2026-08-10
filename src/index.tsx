import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import "./styles.css";

/**
 * Injected rather than written into index.html: bun's HTML bundler treats `<link href>`
 * as a build input and fails to resolve these, which the server serves at fixed paths.
 */
function link(rel: string, href: string, type?: string) {
  const el = document.createElement("link");
  el.rel = rel;
  el.href = href;
  if (type) el.type = type;
  document.head.appendChild(el);
}

// Relative, not absolute: GitHub Pages serves this from a subpath, and the same build
// has to work at the domain root, under /json-notes/app/, and on localhost.
link("manifest", "manifest.webmanifest");
link("icon", "icon-192.png", "image/png");
link("apple-touch-icon", "icon-192.png");

createRoot(document.getElementById("root")!).render(<App />);

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => {
      /* installability is a nicety; the app works without it */
    });
  });
}
