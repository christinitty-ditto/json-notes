import { useEffect, useRef, useState } from "react";
import type { FeatureSets, Features } from "../types.ts";
import { setStatus, type DocFeature } from "../features.ts";

type Props = {
  /** Everything applicable to this payload — picked, brought in by a set, or linked. */
  rows: DocFeature[];
  features: Features;
  sets: FeatureSets;
  picked: string[];
  onPick: (id: string, on: boolean) => void;
  onJump: (path: string) => void;
};

const WHY: Record<DocFeature["status"], string> = {
  missing: "applicable to this payload, but no key here links it",
  unresolved: "linked here, and at least one linked key is still marked ?",
  covered: "linked here, and no linked key is marked ?",
};

/** Where a chip came from, so un-picking is never a guess. */
function origin(f: DocFeature): string {
  if (f.viaSets.length) return `via set ${f.viaSets.map((s) => `@${s}`).join(", ")}`;
  if (f.picked) return "picked for this payload";
  return "linked from a note here";
}

export function FeatureStrip({ rows, features, sets, picked, onPick, onJump }: Props) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const byId = new Map(rows.map((f) => [f.id, f]));

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

  const setIds = Object.keys(sets).sort((a, b) => a.localeCompare(b));
  const featureIds = Object.keys(features).sort((a, b) => a.localeCompare(b));
  const nothing = !setIds.length && !featureIds.length && !rows.length;

  return (
    <div className="fstrip">
      {rows.map((f) => (
        <span
          key={f.id}
          className={`chip c-${f.status}${f.links.length ? " go" : ""}`}
          title={`@${f.id} — ${WHY[f.status]} · ${origin(f)}`}
          onClick={() => f.links[0] && onJump(f.links[0].path)}
        >
          <span className={`dot d-${f.status}`} />
          @{f.id}
          {f.links.length > 0 && <span className="chip-n">{f.links.length}</span>}
          {f.picked && (
            <button
              className="chip-x"
              title="no longer applicable to this payload"
              onClick={(e) => {
                e.stopPropagation();
                onPick(f.id, false);
              }}
            >
              ✕
            </button>
          )}
        </span>
      ))}

      {nothing && <span className="fstrip-hint">no features yet</span>}

      <div className="menu-wrap" ref={box}>
        <button className={`chip pick${open ? " on" : ""}`} onClick={() => setOpen((o) => !o)}>
          + pick
        </button>
        {open && (
          <div className="menu pickmenu">
            <div className="menu-note">
              What this payload is supposed to support. Anything you link with{" "}
              <code>@id</code> in a note is applicable already.
            </div>

            {setIds.length > 0 && <div className="pick-h">sets</div>}
            {setIds.map((id) => {
              const members = sets[id]!.features;
              const on = picked.includes(id);
              return (
                <button key={id} className="menu-item pick-row" onClick={() => onPick(id, !on)}>
                  <span className="pick-box">{on ? "☑" : "☐"}</span>
                  <span className={`dot d-${setStatus(members, byId)}`} />
                  <span>@{id}</span>
                  <span className="menu-hint">
                    {members.length} feature{members.length === 1 ? "" : "s"}
                  </span>
                </button>
              );
            })}

            {featureIds.length > 0 && <div className="pick-h">features</div>}
            {featureIds.map((id) => {
              const f = byId.get(id);
              const on = picked.includes(id);
              // A feature linked from a note is applicable by that fact. Offering a
              // checkbox that cannot be unticked would be a lie, so it says why instead.
              const derived = !!f && !on && (!!f.links.length || !!f.viaSets.length);
              return (
                <button
                  key={id}
                  className={`menu-item pick-row${derived ? " derived" : ""}`}
                  disabled={derived}
                  onClick={() => onPick(id, !on)}
                >
                  <span className="pick-box">{on || derived ? "☑" : "☐"}</span>
                  {f && <span className={`dot d-${f.status}`} />}
                  <span>@{id}</span>
                  {derived && (
                    <span className="menu-hint">
                      {f!.viaSets.length ? `via @${f!.viaSets[0]}` : "linked in a note"}
                    </span>
                  )}
                </button>
              );
            })}

            {nothing && (
              <div className="menu-note">
                Declare one in the features tab, or type <code>@some-name</code> in any note.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
