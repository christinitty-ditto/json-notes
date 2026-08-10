import { useState } from "react";

export type FeatureStatus = "covered" | "unresolved" | "missing";

export type FeatureRow = {
  id: string;
  need?: string;
  status: FeatureStatus;
  links: { doc: string; path: string; question: boolean; note: string }[];
};

const ORDER: FeatureStatus[] = ["missing", "unresolved", "covered"];

const BLURB: Record<FeatureStatus, string> = {
  missing: "declared, but no key in any open payload is linked to it",
  unresolved: "linked, but at least one linked key is still marked ?",
  covered: "linked, and no linked key is marked ?",
};

type Props = {
  rows: FeatureRow[];
  onNeed: (id: string, need: string) => void;
  onJump: (doc: string, path: string) => void;
  onAdd: (id: string) => void;
  onDrop: (id: string) => void;
};

function AddFeature({ onAdd }: { onAdd: (id: string) => void }) {
  const [v, setV] = useState("");
  const ok = /^@?[A-Za-z0-9][\w-]*$/.test(v.trim());
  return (
    <div className="add-feat">
      <input
        value={v}
        spellCheck={false}
        placeholder="declare something you need, e.g. prior-claims"
        onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && ok) {
            onAdd(v);
            setV("");
          }
        }}
      />
      <button
        disabled={!ok}
        onClick={() => {
          onAdd(v);
          setV("");
        }}
      >
        declare
      </button>
    </div>
  );
}

export function FeaturesPanel({ rows, onNeed, onJump, onAdd, onDrop }: Props) {
  return (
    <div className="fpanel">
      <AddFeature onAdd={onAdd} />

      {!rows.length && (
        <div className="empty-state">
          <p>No features yet.</p>
          <p className="hint">
            Type <code>@some-name</code> in any note to link a key to a feature, or declare
            one above to track something the payload may not cover at all.
          </p>
        </div>
      )}

      {ORDER.map((status) => {
        const group = rows.filter((r) => r.status === status);
        if (!group.length) return null;
        return (
          <section key={status}>
            <h2 className={`st st-${status}`}>
              {status} <span className="st-n">{group.length}</span>
              <span className="st-blurb">{BLURB[status]}</span>
            </h2>
            {group.map((f) => (
              <div key={f.id} className="feat">
                <div className="feat-head">
                  <span className={`dot d-${f.status}`} />
                  <code className="feat-id">@{f.id}</code>
                  <input
                    className="feat-need"
                    defaultValue={f.need ?? ""}
                    spellCheck={false}
                    placeholder="what do you need this for?"
                    onBlur={(e) => onNeed(f.id, e.target.value)}
                  />
                  {!f.links.length && (
                    <button
                      className="feat-drop"
                      title="remove this declaration"
                      onClick={() => onDrop(f.id)}
                    >
                      ✕
                    </button>
                  )}
                </div>
                {f.links.length > 0 && (
                  <div className="feat-links">
                    {f.links.map((l) => (
                      <div
                        key={l.doc + l.path}
                        className={`flink${l.question ? " q" : ""}`}
                        onClick={() => onJump(l.doc, l.path)}
                      >
                        <span className="flink-doc">{l.doc}</span>
                        <code>{l.path}</code>
                        {l.question && <span className="flink-q">?</span>}
                        {l.note && <span className="flink-note">{l.note}</span>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </section>
        );
      })}
    </div>
  );
}
