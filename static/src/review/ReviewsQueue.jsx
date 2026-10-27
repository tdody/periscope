// The review queue: one row per (repo, branch) across every track, from the
// `reviews` signal. Actions are messages to the owning pane — prepare and
// merge never touch git from here (spec D1); clear removes a review dir.
import { useEffect, useState } from "preact/hooks";
import { confirmDialog } from "../overlays/Dialog.jsx";
import { refreshReviews } from "../poll.js";
import { selectReview } from "../split/alertFeed.js";
import { reviews } from "../store.js";
import { sortRows } from "./walkthrough.js";

// `busy` is per row: a second click while the POST is in flight would send a
// second prompt to the pane (the server's 409 only spans the request).
async function act(url, row, setNote, setBusy) {
  setBusy(true);
  try {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ repo: row.repo, branch: row.branch }) });
    const data = await res.json().catch(() => ({}));
    setNote(res.ok ? (data.mode === "spawned" ? "spawned a pane to prepare" : "sent") : (data.detail || `HTTP ${res.status}`));
    refreshReviews();
  } catch (e) {
    setNote(String(e));
  } finally {
    setBusy(false);
  }
}

function Row({ row }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const merged = row.pr?.state === "merged";
  const canPrepare = !!row.owner || !!row.worktree;
  const wt = row.walkthrough;
  const prepareTitle = canPrepare
    ? "ask the owning pane to write the walkthrough"
    : row.role === "review-requested" ? `check out the PR first (⌘K: #${row.pr?.number})` : "open the branch first (⌘K)";
  const mergeTitle = row.unresolved > 0
    ? `${row.unresolved} unresolved comment${row.unresolved === 1 ? "" : "s"}`
    : row.owner ? "ask the owning pane to merge" : "no pane on this branch";
  return (
    <tr class={`rq-row rq-${row.role}${merged ? " is-merged" : ""}`}>
      <td class="rq-branch">
        {wt ? <button type="button" class="rq-open" onClick={() => selectReview(row.repo, row.branch)}>{row.branch}</button> : row.branch}
        <div class="rq-repo">{row.repo} · {row.role === "review-requested" ? `review requested · ${row.pr?.author || "?"}` : row.role}</div>
      </td>
      <td class="rq-pr">{row.pr ? <>#{row.pr.number}{row.pr.draft ? " draft" : ""} {row.pr.state || ""} {row.pr.ci || ""}<div class="rq-repo">{row.pr.title}</div></> : "—"}</td>
      <td class="rq-wt">{wt ? <>{wt.stops} stop{wt.stops === 1 ? "" : "s"}{wt.stale_by > 0 ? ` · stale ${wt.stale_by}` : wt.stale_by === null && row.worktree ? " · stale: unknown" : ""}</> : "none"}</td>
      <td class="rq-comments">{row.unresolved ? <b>{row.unresolved} open</b> : "—"}</td>
      <td class="rq-owner">{row.owner ? row.owner.name : row.worktree ? "no pane" : "not checked out"}</td>
      <td class="rq-actions">
        <button type="button" disabled={busy || !canPrepare} title={prepareTitle}
          onClick={() => act("/api/reviews/prepare", row, setNote, setBusy)}>{wt ? "re-prepare" : "prepare"}</button>
        <button type="button" disabled={busy || !row.owner || merged || row.unresolved > 0} title={mergeTitle}
          onClick={async () => {
            if (await confirmDialog(`Ask the owning pane to merge ${row.branch}?`, { okLabel: "Merge" })) act("/api/reviews/merge", row, setNote, setBusy);
          }}>merge</button>
        {(merged || !row.worktree) && (wt || row.unresolved) ? (
          <button type="button" disabled={busy} title="remove this review's files" onClick={async () => {
            if (await confirmDialog(`Remove the walkthrough and comments for ${row.branch}? This can't be undone.`, { okLabel: "Clear", danger: true })) act("/api/reviews/clear", row, setNote, setBusy);
          }}>clear</button>
        ) : null}
        {note ? <span class="rq-note">{note}</span> : null}
      </td>
    </tr>
  );
}

export function ReviewsQueue() {
  useEffect(() => { refreshReviews(); }, []);
  const rows = reviews.value;
  if (rows === null) return <div class="wt-empty">loading…</div>;
  const sorted = sortRows(rows);
  return (
    <div class="reviews-queue">
      <header class="wt-head"><h2>Reviews</h2><span class="wt-sub">{sorted.length} branch{sorted.length === 1 ? "" : "es"}</span></header>
      {sorted.length === 0 ? <div class="wt-empty">nothing open</div> : (
        <table class="rq-table">
          <thead><tr><th>branch</th><th>PR</th><th>walkthrough</th><th>comments</th><th>owner</th><th></th></tr></thead>
          <tbody>{sorted.map((r) => <Row key={`${r.repo}/${r.branch}`} row={r} />)}</tbody>
        </table>
      )}
    </div>
  );
}
