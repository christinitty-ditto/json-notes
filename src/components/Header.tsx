import type { FilterMode } from "../types.ts";
import type { Counts } from "../walker.ts";

const FILTERS: { id: FilterMode; label: string }[] = [
  { id: "all", label: "all" },
  { id: "untriaged", label: "untriaged" },
  { id: "interesting", label: "*" },
  { id: "question", label: "?" },
];

type Props = {
  counts: Counts;
  search: string;
  filter: FilterMode;
  onSearch: (v: string) => void;
  onFilter: (f: FilterMode) => void;
  onSubmit: () => void;
  onStep: (delta: number) => void;
  searchRef?: React.RefObject<HTMLInputElement | null>;
};

export function Header({
  counts,
  search,
  filter,
  onSearch,
  onFilter,
  onSubmit,
  onStep,
  searchRef,
}: Props) {
  return (
    <div className="header">
      <div className="counts">
        <b>{counts.total}</b> keys
        <span className="sep">·</span>
        <b>{counts.marked}</b> marked
        <span className="sep">·</span>
        <b className={counts.untriaged === 0 ? "done" : ""}>{counts.untriaged}</b> untriaged
      </div>

      <div className="filters">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            className={`fb${filter === f.id ? " on" : ""}`}
            onClick={() => onFilter(f.id)}
          >
            {f.label}
          </button>
        ))}
      </div>

      <input
        ref={searchRef}
        className="search"
        value={search}
        spellCheck={false}
        placeholder="search keys, paths, values…   ↓↑ pick, ⏎ go to it"
        onChange={(e) => onSearch(e.target.value)}
        onKeyDown={(e) => {
          // Arrows move the cursor through the matches without leaving the field, so
          // Enter can go to the one you actually want.
          if (e.key === "Enter") {
            e.preventDefault();
            onSubmit();
          } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            onStep(e.key === "ArrowDown" ? 1 : -1);
          }
        }}
      />
      {search && (
        <button className="clear" onClick={() => onSearch("")}>
          ✕
        </button>
      )}
    </div>
  );
}
