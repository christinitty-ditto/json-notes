import { useEffect, useRef, useState } from "react";

export type MenuItem =
  | { label: string; hint?: string; onClick: () => void }
  | { separator: true }
  | { note: string };

export function Menu({ items }: { items: MenuItem[] }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  return (
    <div className="menu-wrap" ref={box}>
      <button
        className={`tool menu-btn${open ? " on" : ""}`}
        title="export, import, storage"
        onClick={() => setOpen((o) => !o)}
      >
        ⋯
      </button>
      {open && (
        <div className="menu">
          {items.map((it, i) =>
            "separator" in it ? (
              <div key={i} className="menu-sep" />
            ) : "note" in it ? (
              <div key={i} className="menu-note">
                {it.note}
              </div>
            ) : (
              <button
                key={i}
                className="menu-item"
                onClick={() => {
                  setOpen(false);
                  it.onClick();
                }}
              >
                <span>{it.label}</span>
                {it.hint && <span className="menu-hint">{it.hint}</span>}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}
