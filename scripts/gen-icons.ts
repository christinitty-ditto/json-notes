/**
 * Generates the PWA icons. No image deps — writes PNGs directly.
 *   bun scripts/gen-icons.ts
 */
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  const body = out.subarray(4, 8 + data.length);
  dv.setUint32(8 + data.length, crc32(body));
  return out;
}

function png(size: number, rgba: Uint8Array): Uint8Array {
  const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, size);
  dv.setUint32(4, size);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  // scanlines, each prefixed with filter byte 0
  const raw = new Uint8Array(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    raw.set(rgba.subarray(y * size * 4, (y + 1) * size * 4), y * (size * 4 + 1) + 1);
  }
  const parts = [sig, chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", new Uint8Array(0))];
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

type RGB = [number, number, number];

const BG: RGB = [23, 26, 31];
const BLUE: RGB = [127, 178, 217];
const GREEN: RGB = [143, 199, 154];
const AMBER: RGB = [217, 180, 90];

/** Coverage of a rounded rect at a point, supersampled 3x3 for smooth edges. */
function coverage(px: number, py: number, x: number, y: number, w: number, h: number, r: number) {
  let hits = 0;
  for (let sy = 0; sy < 3; sy++) {
    for (let sx = 0; sx < 3; sx++) {
      const cx = px + (sx + 0.5) / 3;
      const cy = py + (sy + 0.5) / 3;
      if (cx < x || cy < y || cx > x + w || cy > y + h) continue;
      const qx = Math.min(Math.max(cx, x + r), x + w - r);
      const qy = Math.min(Math.max(cy, y + r), y + h - r);
      const dx = cx - qx;
      const dy = cy - qy;
      if (dx * dx + dy * dy <= r * r) hits++;
    }
  }
  return hits / 9;
}

function draw(size: number, maskable: boolean): Uint8Array {
  const buf = new Uint8Array(size * size * 4);
  const S = size;

  const rect = (
    x: number,
    y: number,
    w: number,
    h: number,
    r: number,
    [cr, cg, cb]: RGB,
  ) => {
    const x0 = Math.max(0, Math.floor(x));
    const y0 = Math.max(0, Math.floor(y));
    const x1 = Math.min(S, Math.ceil(x + w));
    const y1 = Math.min(S, Math.ceil(y + h));
    for (let py = y0; py < y1; py++) {
      for (let px = x0; px < x1; px++) {
        const a = coverage(px, py, x, y, w, h, r);
        if (a <= 0) continue;
        const i = (py * S + px) * 4;
        const inv = 1 - a;
        buf[i] = Math.round(cr * a + buf[i]! * inv);
        buf[i + 1] = Math.round(cg * a + buf[i + 1]! * inv);
        buf[i + 2] = Math.round(cb * a + buf[i + 2]! * inv);
        buf[i + 3] = Math.round(255 * a + buf[i + 3]! * inv);
      }
    }
  };

  // Maskable icons are full-bleed and keep content inside the safe circle.
  if (maskable) rect(0, 0, S, S, 0, BG);
  else rect(0, 0, S, S, S * 0.22, BG);

  const scale = maskable ? 0.62 : 0.86;
  const off = (1 - scale) / 2;
  const u = (v: number) => (off + v * scale) * S;
  const bar = (x: number, y: number, w: number, c: RGB) =>
    rect(u(x), u(y), w * scale * S, 0.088 * scale * S, 0.044 * scale * S, c);

  // A collapsed tree: two levels of indent, with one key flagged.
  bar(0.1, 0.14, 0.52, BLUE);
  bar(0.24, 0.32, 0.4, GREEN);
  bar(0.24, 0.5, 0.3, GREEN);
  bar(0.1, 0.68, 0.24, BLUE);
  rect(u(0.72), u(0.5), 0.088 * scale * S, 0.088 * scale * S, 0.02 * scale * S, AMBER);

  return buf;
}

mkdirSync("public", { recursive: true });
const targets: [string, number, boolean][] = [
  ["public/icon-192.png", 192, false],
  ["public/icon-512.png", 512, false],
  ["public/icon-maskable-512.png", 512, true],
];
for (const [file, size, maskable] of targets) {
  writeFileSync(file, png(size, draw(size, maskable)));
  console.log(`wrote ${file}`);
}
