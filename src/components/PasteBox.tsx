import { useEffect, useMemo, useRef, useState } from "react";
import { parseLoose, shapeOf } from "../parse.ts";

type Props = {
  /** Text to open with — a payload caught from a ⌘V, or empty for a blank box. */
  seed: string;
  /** Names already taken, so the suggested one does not silently replace a payload. */
  taken: string[];
  onAdd: (name: string, text: string) => void;
  onClose: () => void;
};

/** `pasted`, then `pasted-2` — a paste must never quietly overwrite an earlier one. */
function freeName(taken: string[]): string {
  const used = new Set(taken);
  if (!used.has("pasted")) return "pasted";
  for (let i = 2; ; i++) if (!used.has(`pasted-${i}`)) return `pasted-${i}`;
}

/** Above this, checking on every keystroke costs more than it tells you. */
const LIVE_LIMIT = 2_000_000;

/**
 * Pasting a payload straight in, for when what you have is a response in a chat window
 * rather than a file on disk. The read is the same tolerant one the file path uses, and
 * its verdict is shown before anything is stored — you should be able to see that the
 * thing parsed, and what it turned out to be, without first committing it to a tab.
 */
export function PasteBox({ seed, taken, onAdd, onClose }: Props) {
  const [text, setText] = useState(seed);
  const [name, setName] = useState(() => freeName(taken));
  const [slow, setSlow] = useState<string | null>(null);
  const area = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = area.current;
    if (!el) return;
    el.focus();
    // A seeded box is already what you wanted; put the caret at the end rather than
    // selecting it all, so a stray keystroke cannot wipe the paste.
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);

  // Debounced so a large paste is read once it settles, not once per character.
  useEffect(() => {
    const t = setTimeout(() => setSlow(text), 200);
    return () => clearTimeout(t);
  }, [text]);

  const verdict = useMemo(() => {
    const t = slow ?? "";
    if (!t.trim()) return null;
    if (t.length > LIVE_LIMIT) return { ok: true as const, note: "large payload — read on add" };
    try {
      const r = parseLoose(t);
      return { ok: true as const, note: r.repaired ? `${shapeOf(r.value)} · ${r.repaired}` : shapeOf(r.value) };
    } catch (e) {
      return { ok: false as const, note: (e as Error).message };
    }
  }, [slow]);

  const submit = () => {
    if (!text.trim()) return;
    onAdd(name.trim() || "pasted", text);
  };

  const fromClipboard = async () => {
    try {
      const t = await navigator.clipboard.readText();
      if (t) setText(t);
    } catch {
      // Denied, or no clipboard read on this browser — the textarea still works.
    }
  };

  return (
    <div
      className="modal"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          // Stopped here so the window-level shortcuts do not also act on it.
          e.stopPropagation();
          onClose();
        }
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          e.stopPropagation();
          submit();
        }
      }}
    >
      <div className="modal-box paste-box">
        <div className="modal-head">
          <span className="modal-title">Paste JSON</span>
          <button className="tool" onClick={onClose} title="Close (Esc)">
            ✕
          </button>
        </div>

        <textarea
          ref={area}
          className="paste-area"
          value={text}
          spellCheck={false}
          placeholder={'{\n  "paste a response here"\n}'}
          onChange={(e) => setText(e.target.value)}
        />

        <div className={`paste-verdict${verdict && !verdict.ok ? " bad" : ""}`}>
          {verdict ? verdict.note : "A log line, a curl transcript or one record per line is fine — the JSON is found inside it."}
        </div>

        <div className="modal-acts">
          <label className="paste-name">
            name
            <input
              value={name}
              spellCheck={false}
              onChange={(e) => setName(e.target.value)}
              title="An existing name replaces that payload and keeps its annotations"
            />
          </label>
          {typeof navigator.clipboard?.readText === "function" && (
            <button className="tool" onClick={() => void fromClipboard()}>
              read clipboard
            </button>
          )}
          <span className="spacer" />
          <button className="tool" onClick={onClose}>
            cancel
          </button>
          <button
            className="tool export"
            disabled={!text.trim() || verdict?.ok === false}
            onClick={submit}
            title="⌘↵"
          >
            add payload
          </button>
        </div>
      </div>
    </div>
  );
}
