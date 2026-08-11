import { useEffect, useLayoutEffect, useRef, useState } from "react";

type Props = {
  value: string;
  features: string[];
  placeholder?: string;
  onChange: (v: string) => void;
  onClose: () => void;
};

/** Token immediately left of the caret, if it is a `@feature` being typed. */
function activeToken(text: string, caret: number): { start: number; q: string } | null {
  let i = caret - 1;
  while (i >= 0 && /[\w-]/.test(text[i]!)) i--;
  if (i < 0 || text[i] !== "@") return null;
  return { start: i, q: text.slice(i + 1, caret).toLowerCase() };
}

export function NoteEditor({ value, features, placeholder, onChange, onClose }: Props) {
  // Local state so typing never re-renders the tree; the parent is told on a debounce.
  const [text, setText] = useState(value);
  const [caret, setCaret] = useState(value.length);
  const [pick, setPick] = useState(0);
  const ref = useRef<HTMLTextAreaElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  function push(next: string) {
    setText(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => onChange(next), 200);
  }

  function commit(next: string) {
    if (timer.current) clearTimeout(timer.current);
    onChange(next);
  }

  const tok = activeToken(text, caret);
  const matches = tok
    ? features.filter((f) => f.toLowerCase().startsWith(tok.q)).slice(0, 6)
    : [];
  const showNew = !!tok && tok.q.length > 0 && !features.includes(tok.q);
  const options = showNew ? [...matches, `${tok!.q} — new feature`] : matches;

  function choose(i: number) {
    if (!tok) return;
    const id = showNew && i === options.length - 1 ? tok.q : matches[i];
    if (!id) return;
    const next = `${text.slice(0, tok.start)}@${id} ${text.slice(caret)}`;
    setText(next);
    commit(next);
    requestAnimationFrame(() => {
      const el = ref.current;
      if (!el) return;
      const at = tok.start + id.length + 2;
      el.setSelectionRange(at, at);
      setCaret(at);
    });
  }

  return (
    <div className="note-editor">
      <textarea
        ref={ref}
        value={text}
        rows={2}
        spellCheck={false}
        placeholder={placeholder ?? "note — @ links a feature"}
        onChange={(e) => {
          push(e.target.value);
          setCaret(e.target.selectionStart);
          setPick(0);
        }}
        onSelect={(e) => setCaret((e.target as HTMLTextAreaElement).selectionStart)}
        onBlur={() => {
          commit(text);
          if (!options.length) onClose();
        }}
        onKeyDown={(e) => {
          if (options.length) {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setPick((p) => (p + 1) % options.length);
              return;
            }
            if (e.key === "ArrowUp") {
              e.preventDefault();
              setPick((p) => (p - 1 + options.length) % options.length);
              return;
            }
            if (e.key === "Enter" || e.key === "Tab") {
              e.preventDefault();
              choose(pick);
              return;
            }
          }
          if (e.key === "Escape") {
            e.preventDefault();
            commit(text);
            onClose();
          }
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            commit(text);
            onClose();
          }
        }}
      />
      {options.length > 0 && (
        <div className="ac">
          {options.map((o, i) => (
            <div
              key={o}
              className={`ac-item${i === pick ? " on" : ""}`}
              onMouseDown={(e) => {
                e.preventDefault();
                choose(i);
              }}
            >
              @{o}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
