import { memo, useCallback, useEffect, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { Entry, Mark } from "../types.ts";
import type { Row } from "../rows.ts";
import { NoteEditor } from "./NoteEditor.tsx";

const TRUNC = 90;

/** `""`, `null` and the literal string `"null"` must not look alike. */
function ValueView({ value }: { value: unknown }) {
  const [open, setOpen] = useState(false);
  if (value === null) return <span className="v v-null">null</span>;
  if (value === undefined) return null;
  if (typeof value === "number") return <span className="v v-num">{String(value)}</span>;
  if (typeof value === "boolean") return <span className="v v-bool">{String(value)}</span>;
  const s = String(value);
  if (s === "") return <span className="v v-empty">""</span>;
  if (s === "null") return <span className="v v-nullstr">"null"</span>;
  if (s.length > TRUNC && !open) {
    return (
      <span className="v v-str">
        "{s.slice(0, TRUNC)}
        <button
          className="more-inline"
          onClick={(e) => {
            e.stopPropagation();
            setOpen(true);
          }}
        >
          …+{s.length - TRUNC}
        </button>
        "
      </span>
    );
  }
  return <span className="v v-str">"{s}"</span>;
}

const MARKS: { m: Mark; glyph: string; title: string }[] = [
  { m: "interesting", glyph: "*", title: "interesting" },
  { m: "question", glyph: "?", title: "open question" },
  { m: "ignore", glyph: "–", title: "ignore (applies to everything below)" },
];

type RowProps = {
  row: Row;
  index: number;
  entry: Entry | undefined;
  editing: boolean;
  cursor: boolean;
  selected: boolean;
  featureIds: string[];
  onToggle: (headId: number) => void;
  onExpandArray: (arrayId: number) => void;
  onMark: (path: string, m: Mark) => void;
  onNote: (path: string, note: string) => void;
  onEdit: (path: string | null) => void;
  onCopy: (path: string) => void;
  onCursor: (index: number) => void;
  onSelect: (index: number, extend: boolean) => void;
};

const RowView = memo(function RowView({
  row,
  index,
  entry,
  editing,
  cursor,
  selected,
  featureIds,
  onToggle,
  onExpandArray,
  onMark,
  onNote,
  onEdit,
  onCopy,
  onCursor,
  onSelect,
}: RowProps) {
  if (row.more) {
    return (
      <div
        className={`row row-more${cursor ? " cur" : ""}`}
        style={{ paddingLeft: row.depth * 14 + 26 }}
        onMouseDown={() => onCursor(index)}
      >
        <button className="more-btn" onClick={() => onExpandArray(row.more!.arrayId)}>
          + {row.more.count} more {row.more.count === 1 ? "item" : "items"}
        </button>
      </div>
    );
  }

  const mark = entry?.mark;
  const dim = mark === "ignore" || row.inheritedIgnore;
  const cls = [
    "row",
    dim ? "dim" : "",
    mark ? `m-${mark}` : "",
    row.inheritedIgnore && !mark ? "inherited" : "",
    selected ? "sel" : "",
    cursor ? "cur" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      className={cls}
      onMouseDown={(e) => {
        // Shift-click extends from wherever the cursor is, so a run of keys is two
        // clicks rather than one per row.
        if (e.shiftKey) {
          e.preventDefault();
          onSelect(index, true);
        } else {
          onCursor(index);
        }
      }}
    >
      <div className="row-main" style={{ paddingLeft: row.depth * 14 }}>
        <span className="caret" onClick={() => row.hasChildren && onToggle(row.headId)}>
          {row.hasChildren ? (row.expanded ? "▾" : "▸") : ""}
        </span>

        <span className="key" onClick={() => onEdit(editing ? null : row.path)}>
          {row.labels.map((l, i) => (
            <span key={i}>
              {i > 0 && <span className="chain-sep"> › </span>}
              {l}
            </span>
          ))}
        </span>

        {row.kind === "scalar" ? (
          <>
            <span className="colon">:</span>
            <ValueView value={row.value} />
          </>
        ) : (
          <span className="brace">{row.kind === "array" ? "[ ]" : "{ }"}</span>
        )}

        <span className="marks">
          <button
            className={`mk sel-box${selected ? " on" : ""}`}
            title="select — mark or note this together with everything else selected (space)"
            onClick={() => onSelect(index, false)}
          >
            {selected ? "☑" : "☐"}
          </button>
          {MARKS.map(({ m, glyph, title }) => (
            <button
              key={m}
              title={title}
              className={`mk${mark === m ? " on" : ""}`}
              onClick={() => onMark(row.path, m)}
            >
              {glyph}
            </button>
          ))}
          <button className="mk cp" title="copy path" onClick={() => onCopy(row.path)}>
            ⧉
          </button>
        </span>

        {row.inheritedIgnore && !mark && <span className="inh" title="ignored by a parent">–</span>}

        {row.rolledTriage && (
          <span className="rolled" title="settled by an annotation below it — nothing said about this key itself">
            ·
          </span>
        )}

        {!editing && entry?.note && (
          <span className="note" onClick={() => onEdit(row.path)}>
            {entry.note}
          </span>
        )}
      </div>

      {editing && (
        <div style={{ paddingLeft: row.depth * 14 + 26 }}>
          <NoteEditor
            value={entry?.note ?? ""}
            features={featureIds}
            onChange={(v) => onNote(row.path, v)}
            onClose={() => onEdit(null)}
          />
        </div>
      )}
    </div>
  );
});

type Props = {
  rows: Row[];
  notes: Record<string, Entry>;
  editing: string | null;
  cursor: number;
  selected: Set<string>;
  featureIds: string[];
  onToggle: (headId: number) => void;
  onExpandArray: (arrayId: number) => void;
  onMark: (path: string, m: Mark) => void;
  onNote: (path: string, note: string) => void;
  onEdit: (path: string | null) => void;
  onCopy: (path: string) => void;
  onCursor: (index: number) => void;
  onSelect: (index: number, extend: boolean) => void;
};

export function TreeView({
  rows,
  notes,
  editing,
  cursor,
  selected,
  featureIds,
  onToggle,
  onExpandArray,
  onMark,
  onNote,
  onEdit,
  onCopy,
  onCursor,
  onSelect,
}: Props) {
  const parentRef = useRef<HTMLDivElement>(null);

  const virt = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    // First guess only — rows are measured for real, since expanded values and open
    // note editors vary in height. Tracks the base font size.
    estimateSize: useCallback(() => 25, []),
    overscan: 18,
    getItemKey: useCallback((i: number) => rows[i]?.key ?? i, [rows]),
  });

  const items = virt.getVirtualItems();

  // Keep the cursor on screen. `auto` scrolls the minimum needed, so holding j
  // walks the list rather than re-centring on every step.
  useEffect(() => {
    if (cursor >= 0 && cursor < rows.length) virt.scrollToIndex(cursor, { align: "auto" });
  }, [cursor, rows.length]);

  if (!rows.length) {
    return (
      <div className="tree empty-tree">
        <p>Nothing matches.</p>
        <p className="hint">Clear the search, or switch the filter back to “all”.</p>
      </div>
    );
  }

  return (
    <div ref={parentRef} className="tree">
      <div style={{ height: virt.getTotalSize(), position: "relative" }}>
        {items.map((vi) => {
          const row = rows[vi.index]!;
          const isEditing = editing === row.path && !row.more;
          return (
            <div
              key={vi.key}
              data-index={vi.index}
              ref={virt.measureElement}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                transform: `translateY(${vi.start}px)`,
                // translateY makes each row its own stacking context, so the
                // editing row has to outrank later rows for its dropdown to show.
                zIndex: isEditing ? 10 : undefined,
              }}
            >
              <RowView
                row={row}
                index={vi.index}
                entry={notes[row.path]}
                editing={isEditing}
                cursor={vi.index === cursor}
                selected={!row.more && selected.has(row.path)}
                featureIds={featureIds}
                onToggle={onToggle}
                onExpandArray={onExpandArray}
                onMark={onMark}
                onNote={onNote}
                onEdit={onEdit}
                onCopy={onCopy}
                onCursor={onCursor}
                onSelect={onSelect}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
