/**
 * Getting JSON out of whatever was actually handed over.
 *
 * A sample response rarely arrives as a clean `.json` file. It is pasted out of a
 * terminal with the `curl` line still above it, saved as `response.txt`, written to a
 * log one record per line, or typed by hand with a comment and a trailing comma. Every
 * one of those is the same payload, and refusing them on a strict `JSON.parse` makes the
 * tool useless at exactly the moment it is needed.
 *
 * So the reading gets progressively looser, and each step says what it had to do — the
 * repair is reported rather than applied silently, because a payload that had to be
 * rescued out of a log is worth knowing about before you annotate it.
 *
 * Valid JSON always takes the first step and is stored byte for byte, so nothing here
 * touches a file that was already fine.
 */

export type Loose = {
  value: unknown;
  /** The text to store — the original, unchanged, whenever it parsed as-is. */
  text: string;
  /** What had to be done to read it, or null if it was already valid JSON. */
  repaired: string | null;
};

/** Byte-order mark, and the `)]}'` guard some APIs put in front of a JSON body. */
const FRONT = /^\uFEFF/;
const XSSI = /^\)\]\}'?[,\s]*/;

type Attempt = { ok: true; value: unknown } | { ok: false; error: Error };

function attempt(text: string): Attempt {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (e) {
    return { ok: false, error: e as Error };
  }
}

/**
 * Index just past the `{...}` or `[...]` value starting at `from`, or -1 if it never
 * closes. String-aware, so a brace inside a string value does not shift the depth.
 */
function endOfValue(text: string, from: number): number {
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = from; i < text.length; i++) {
    const c = text[i]!;
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === "{" || c === "[") depth++;
    else if (c === "}" || c === "]") {
      if (--depth === 0) return i + 1;
    }
  }
  return -1;
}

/** Every complete object or array in the text, in order, ignoring what sits between. */
function slices(text: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c !== "{" && c !== "[") {
      i++;
      continue;
    }
    const end = endOfValue(text, i);
    // Unterminated: there is no complete value here or after it.
    if (end < 0) break;
    out.push(text.slice(i, end));
    i = end;
  }
  return out;
}

/** Strip line and block comments. String-aware, so a URL in a value survives. */
function stripComments(text: string): string {
  let out = "";
  let inStr = false;
  let esc = false;
  let i = 0;
  while (i < text.length) {
    const c = text[i]!;
    if (inStr) {
      out += c;
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      i++;
      continue;
    }
    if (c === '"') {
      inStr = true;
      out += c;
      i++;
      continue;
    }
    if (c === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && text[i + 1] === "*") {
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/**
 * Drop a comma that closes nothing. Scanned rather than matched with a regex: a string
 * value can perfectly well contain `, }`, and rewriting that would corrupt the payload.
 */
function dropTrailingCommas(text: string): string {
  let out = "";
  let inStr = false;
  let esc = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (inStr) {
      out += c;
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === ",") {
      let j = i + 1;
      while (j < text.length && /\s/.test(text[j]!)) j++;
      if (text[j] === "}" || text[j] === "]") continue;
    }
    out += c;
  }
  return out;
}

const relax = (text: string) => dropTrailingCommas(stripComments(text));

/** A recovered payload is stored re-serialized: what was read is what gets annotated. */
const recovered = (value: unknown, repaired: string): Loose => ({
  value,
  text: JSON.stringify(value, null, 2),
  repaired,
});

/**
 * Read JSON out of `raw`, or throw with what went wrong. Never returns a partial answer:
 * either the whole payload was recovered or nothing was.
 */
export function parseLoose(raw: string): Loose {
  const direct = attempt(raw);
  if (direct.ok) return { value: direct.value, text: raw, repaired: null };

  const clean = raw.replace(FRONT, "").replace(XSSI, "").trim();
  if (!clean) throw new Error("nothing to read — it is empty");

  const whole = attempt(clean);
  if (whole.ok) return recovered(whole.value, "trimmed the whitespace and wrapper around it");

  const relaxed = attempt(relax(clean));
  if (relaxed.ok) return recovered(relaxed.value, "dropped comments and trailing commas");

  // What is left is JSON sitting inside something else: a log line, a `curl -v`
  // transcript, or one record per line. Take every complete value, in order.
  const found: unknown[] = [];
  for (const slice of slices(clean)) {
    const one = attempt(slice);
    if (one.ok) {
      found.push(one.value);
      continue;
    }
    const loose = attempt(relax(slice));
    if (loose.ok) found.push(loose.value);
  }
  if (found.length === 1) return recovered(found[0], "pulled the JSON out of the text around it");
  if (found.length > 1) return recovered(found, `read ${found.length} JSON values as one array`);

  throw new Error(`not JSON — ${whole.error.message}`);
}

/** One line about the top of a payload, for confirming a paste before adding it. */
export function shapeOf(value: unknown): string {
  if (Array.isArray(value)) return `array · ${value.length} item${value.length === 1 ? "" : "s"}`;
  if (value && typeof value === "object") {
    const n = Object.keys(value as object).length;
    return `object · ${n} key${n === 1 ? "" : "s"}`;
  }
  return value === null ? "null" : typeof value;
}
