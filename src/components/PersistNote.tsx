import type { StorageInfo } from "../store.ts";

/**
 * The one permission this tool asks for, and it is allowed to be refused.
 *
 * Two rules here. The question is never put before there is work worth keeping — a
 * permission prompt on a page you have not used yet is one you have no reason to grant.
 * And a refusal is an answer, not an error: it is explained once, never re-asked on a
 * loop, and nothing in the app stops working because of it.
 */
export type PersistPrompt = "offer" | "result";

export function PersistNote({
  mode,
  info,
  onAsk,
  onExport,
  onDismiss,
}: {
  mode: PersistPrompt;
  info: StorageInfo | null;
  onAsk: () => void;
  onExport: () => void;
  onDismiss: () => void;
}) {
  if (mode === "offer") {
    return (
      <div className="persist">
        <div className="persist-body">
          <b>Ask the browser to keep this data?</b> Your payloads and notes are stored in
          this browser and nowhere else — that is the point, and nothing is uploaded. The
          cost of that: browsers clear site data when the disk runs short, and this site's
          data is your annotations. Marking it persistent makes that unlikely.
        </div>
        <div className="persist-acts">
          <button className="tool export" onClick={onAsk}>
            keep my work
          </button>
          <button className="tool" onClick={onDismiss}>
            not now
          </button>
        </div>
      </div>
    );
  }

  // Asked, and the answer was no. Say which kind of no, because the fix differs.
  const refused = info?.permission === "denied";
  return (
    <div className="persist warn">
      <div className="persist-body">
        <b>Not granted{refused ? "" : " — the browser decided on its own"}.</b> This site
        is not marked persistent, so the browser may clear your payloads and notes if it
        runs short of space. Nothing has been lost now, and everything still works.{" "}
        {refused
          ? "You can change this in your browser's settings for this site."
          : "No prompt appeared, so there was nothing to accept or refuse."}{" "}
        Until then <b>↓ export</b> is what stands between you and a re-read of the payload
        — the file restores everything when you drop it back.
      </div>
      <div className="persist-acts">
        <button className="tool export" onClick={onExport}>
          ↓ export now
        </button>
        <button className="tool" onClick={onDismiss}>
          dismiss
        </button>
      </div>
    </div>
  );
}
