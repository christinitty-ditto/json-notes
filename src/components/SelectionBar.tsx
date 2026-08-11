import type { Mark, Notes } from "../types.ts";
import { NoteEditor } from "./NoteEditor.tsx";

const MARKS: { m: Mark; glyph: string; label: string }[] = [
  { m: "interesting", glyph: "*", label: "interesting" },
  { m: "question", glyph: "?", label: "open question" },
  { m: "ignore", glyph: "–", label: "ignore" },
];

type Props = {
  paths: string[];
  notes: Notes;
  editing: boolean;
  featureIds: string[];
  onMark: (m: Mark) => void;
  onNote: (note: string) => void;
  onEdit: (on: boolean) => void;
  onClear: () => void;
};

export function SelectionBar({
  paths,
  notes,
  editing,
  featureIds,
  onMark,
  onNote,
  onEdit,
  onClear,
}: Props) {
  const n = paths.length;
  const every = (m: Mark) => paths.every((p) => notes[p]?.mark === m);

  // One note is written to every selected key, so it can only start from text they all
  // already share. Where they differ, the field starts empty and says what saving costs —
  // a bulk write that silently ate four different notes would be unrecoverable.
  const existing = paths.map((p) => notes[p]?.note ?? "");
  const common = existing.every((t) => t === existing[0]) ? existing[0]! : "";
  const clobbers = existing.filter((t) => t && t !== common).length;

  return (
    <div className="selbar">
      <div className="selbar-row">
        <b>{n}</b> selected
        <span className="selbar-marks">
          {MARKS.map(({ m, glyph, label }) => (
            <button
              key={m}
              className={`mk${every(m) ? " on" : ""}`}
              title={`mark all ${n} ${label}${every(m) ? " — again to clear" : ""}`}
              onClick={() => onMark(m)}
            >
              {glyph}
            </button>
          ))}
        </span>
        <button className="selbar-btn" onClick={() => onEdit(!editing)}>
          ⏎ note all {n}
        </button>
        <button className="selbar-btn" onClick={onClear}>
          esc clear
        </button>
        <span className="selbar-paths" title={paths.join("\n")}>
          {paths.join("  ")}
        </span>
      </div>

      {editing && (
        <>
          {clobbers > 0 && (
            <div className="selbar-warn">
              {clobbers} of these already {clobbers === 1 ? "has a note" : "have notes"} —
              saving replaces {clobbers === 1 ? "it" : "them"}.
            </div>
          )}
          <NoteEditor
            value={common}
            features={featureIds}
            placeholder={`one note for ${n} keys — @ links a feature`}
            onChange={onNote}
            onClose={() => onEdit(false)}
          />
        </>
      )}
    </div>
  );
}
