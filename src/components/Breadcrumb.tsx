import type { Doc, Notes } from "../types.ts";

type Props = { doc: Doc; path: string | null; notes: Notes };

/**
 * Keeps a section note visible while you are scrolled deep inside that section.
 * Annotated ancestors are shown with their mark and note.
 */
export function Breadcrumb({ doc, path, notes }: Props) {
  if (path == null) return <div className="crumb empty" />;

  const anc = doc.ancestorPaths.get(path) ?? [];
  const chain = [...anc, path];
  const annotated = chain.filter((p) => notes[p]?.note || notes[p]?.mark);
  const nearest = annotated.length ? annotated[annotated.length - 1]! : null;
  const nearestNote = nearest && nearest !== path ? notes[nearest]?.note : undefined;

  return (
    <div className="crumb">
      <span className="crumb-path">
        {chain.map((p, i) => {
          // Segment = what this path adds to its parent. `[]` attaches directly
          // to the key it indexes, so it takes no separator dot.
          const seg = i === 0 ? doc.name : p.slice(chain[i - 1]?.length ?? 0);
          if (i > 0 && !seg) return null;
          const e = notes[p];
          const bracket = seg.startsWith("[");
          return (
            <span key={p + i} className={e?.mark ? `cs m-${e.mark}` : "cs"}>
              {i > 0 && !bracket && <span className="cs-sep">.</span>}
              {bracket ? seg : seg.replace(/^\./, "")}
            </span>
          );
        })}
      </span>
      {nearestNote && (
        <span className="crumb-note" title={nearestNote}>
          ↳ {nearestNote}
        </span>
      )}
    </div>
  );
}
