import { useState } from "react";
import type { FeatureSets, Features } from "../types.ts";
import { ID_RE, setStatus, type DocFeature } from "../features.ts";

/** One payload's view of the features, in tab order. */
export type DocRows = { doc: string; rows: DocFeature[] };

type Props = {
  features: Features;
  sets: FeatureSets;
  perDoc: DocRows[];
  onNeed: (id: string, need: string) => void;
  onAdd: (id: string) => void;
  onDrop: (id: string) => void;
  onSetNeed: (id: string, need: string) => void;
  onAddSet: (id: string) => void;
  onDropSet: (id: string) => void;
  onSetMember: (setId: string, featureId: string, on: boolean) => void;
  onJump: (doc: string, path: string) => void;
};

const MISSING_BLURB = "applicable to this payload, but no key here links it";

function Declare({
  placeholder,
  action,
  onAdd,
}: {
  placeholder: string;
  action: string;
  onAdd: (id: string) => void;
}) {
  const [v, setV] = useState("");
  const ok = ID_RE.test(v.trim().replace(/^@/, ""));
  const go = () => {
    if (!ok) return;
    onAdd(v);
    setV("");
  };
  return (
    <div className="add-feat">
      <input
        value={v}
        spellCheck={false}
        placeholder={placeholder}
        onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && go()}
      />
      <button disabled={!ok} onClick={go}>
        {action}
      </button>
    </div>
  );
}

export function FeaturesPanel({
  features,
  sets,
  perDoc,
  onNeed,
  onAdd,
  onDrop,
  onSetNeed,
  onAddSet,
  onDropSet,
  onSetMember,
  onJump,
}: Props) {
  const featureIds = [...new Set([...Object.keys(features), ...perDoc.flatMap((d) => d.rows.map((r) => r.id))])].sort(
    (a, b) => a.localeCompare(b),
  );
  const setIds = Object.keys(sets).sort((a, b) => a.localeCompare(b));

  /** Every payload this feature is applicable to, with how it stands there. */
  const where = (id: string) =>
    perDoc
      .map((d) => ({ doc: d.doc, row: d.rows.find((r) => r.id === id) }))
      .filter((x): x is { doc: string; row: DocFeature } => !!x.row);

  const inAnySet = (id: string) => setIds.some((s) => sets[s]!.features.includes(id));

  if (!featureIds.length && !setIds.length) {
    return (
      <div className="fpanel">
        <div className="declare-row">
          <Declare placeholder="a feature you need, e.g. oa-status" action="declare" onAdd={onAdd} />
          <Declare placeholder="a set of features, e.g. work-card" action="declare set" onAdd={onAddSet} />
        </div>
        <div className="empty-state">
          <p>No features yet.</p>
          <p className="hint">
            Type <code>@some-name</code> in any note to link a key to a feature, or declare
            one above to track something the payload may not cover at all. A set groups
            features so a payload can be told what it owes in one pick.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="fpanel">
      <div className="declare-row">
        <Declare placeholder="a feature you need, e.g. oa-status" action="declare" onAdd={onAdd} />
        <Declare placeholder="a set of features, e.g. work-card" action="declare set" onAdd={onAddSet} />
      </div>

      {setIds.length > 0 && (
        <section>
          <h2 className="st">
            sets <span className="st-n">{setIds.length}</span>
            <span className="st-blurb">pick one against a payload to apply every feature in it</span>
          </h2>
          {setIds.map((id) => {
            const set = sets[id]!;
            const applied = perDoc.filter((d) =>
              set.features.some((m) => d.rows.some((r) => r.id === m && r.viaSets.includes(id))),
            );
            return (
              <div key={id} className="feat">
                <div className="feat-head">
                  <code className="feat-id">@{id}</code>
                  <input
                    className="feat-need"
                    defaultValue={set.need ?? ""}
                    spellCheck={false}
                    placeholder="what is this set for?"
                    onBlur={(e) => onSetNeed(id, e.target.value)}
                  />
                  <button className="feat-drop" title="remove this set" onClick={() => onDropSet(id)}>
                    ✕
                  </button>
                </div>

                <div className="set-body">
                  <div className="set-members">
                    {set.features.map((m) => (
                      <span key={m} className="chip">
                        @{m}
                        <button
                          className="chip-x"
                          title={`take @${m} out of @${id}`}
                          onClick={() => onSetMember(id, m, false)}
                        >
                          ✕
                        </button>
                      </span>
                    ))}
                    {!set.features.length && <span className="hint">empty — add a feature</span>}
                  </div>
                  <AddMember
                    options={featureIds.filter((f) => !set.features.includes(f))}
                    onAdd={(f) => onSetMember(id, f, true)}
                  />
                </div>

                <div className="set-applied">
                  {applied.length ? (
                    <>
                      applied to{" "}
                      {applied.map((d) => (
                        <span key={d.doc} className={`chip c-${setStatus(set.features, new Map(d.rows.map((r) => [r.id, r])))}`}>
                          <span
                            className={`dot d-${setStatus(set.features, new Map(d.rows.map((r) => [r.id, r])))}`}
                          />
                          {d.doc}
                        </span>
                      ))}
                    </>
                  ) : (
                    <span className="hint">not applied to any payload yet — pick it on a payload's feature strip</span>
                  )}
                </div>
              </div>
            );
          })}
        </section>
      )}

      <section>
        <h2 className="st">
          features <span className="st-n">{featureIds.length}</span>
          <span className="st-blurb">status is per payload — a key is only missing somewhere</span>
        </h2>
        {featureIds.map((id) => {
          const places = where(id);
          return (
            <div key={id} className="feat">
              <div className="feat-head">
                <code className="feat-id">@{id}</code>
                <input
                  className="feat-need"
                  defaultValue={features[id]?.need ?? ""}
                  spellCheck={false}
                  placeholder="what do you need this for?"
                  onBlur={(e) => onNeed(id, e.target.value)}
                />
                {!places.length && !inAnySet(id) && (
                  <button className="feat-drop" title="remove this declaration" onClick={() => onDrop(id)}>
                    ✕
                  </button>
                )}
              </div>

              {places.length ? (
                places.map(({ doc, row }) => (
                  <div key={doc} className="feat-doc">
                    <div className="feat-doc-head">
                      <span className={`dot d-${row.status}`} />
                      <span className="flink-doc">{doc}</span>
                      <span className="feat-doc-st">{row.status}</span>
                      {row.status === "missing" && <span className="hint">{MISSING_BLURB}</span>}
                    </div>
                    <div className="feat-links">
                      {row.links.map((l) => (
                        <div
                          key={l.path}
                          className={`flink${l.question ? " q" : ""}`}
                          onClick={() => onJump(doc, l.path)}
                        >
                          <code>{l.path}</code>
                          {l.question && <span className="flink-q">?</span>}
                          {l.note && <span className="flink-note">{l.note}</span>}
                        </div>
                      ))}
                    </div>
                  </div>
                ))
              ) : (
                <div className="feat-doc">
                  <span className="hint">
                    not applicable to any payload yet
                    {inAnySet(id) ? " — it is in a set, so picking that set applies it" : ""}
                  </span>
                </div>
              )}
            </div>
          );
        })}
      </section>
    </div>
  );
}

function AddMember({ options, onAdd }: { options: string[]; onAdd: (id: string) => void }) {
  const [v, setV] = useState("");
  const id = v.trim().replace(/^@/, "");
  const ok = ID_RE.test(id);
  const go = () => {
    if (!ok) return;
    onAdd(id);
    setV("");
  };
  return (
    <div className="add-member">
      <input
        list="feature-ids"
        value={v}
        spellCheck={false}
        placeholder="+ feature"
        onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && go()}
      />
      <datalist id="feature-ids">
        {options.map((o) => (
          <option key={o} value={o} />
        ))}
      </datalist>
      <button disabled={!ok} onClick={go}>
        add
      </button>
    </div>
  );
}
