// The review queue: one row per (repo, branch) across every track, from the
// `reviews` signal. Actions are messages to the owning pane — prepare and
// merge never touch git from here (spec D1); clear removes a review dir.
import { useEffect, useState } from "preact/hooks";
import { refreshReviews } from "../poll.js";
import { selectReview } from "../split/alertFeed.js";
import { reviews } from "../store.js";
import { sortRows } from "./walkthrough.js";

async function act(url, row, setNote) {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ repo: row.repo, branch: row.branch }) });
  const data = await res.json().catch(() => ({}));
  setNote(res.ok ? (data.mode === "spawned" ? "spawned a pane to prepare" : "sent") : (data.detail || `HTTP ${res.status}`));
  refreshReviews();
}

function Row({ row }) {
  const [note, setNote] = useState("");
  const merged = row.pr?.state === "merged";
  const canPrepare = !!row.owner || !!row.worktree;
  const wt = row.walkthrough;
  const prepareTitle = canPrepare
    ? "ask the owning pane to write the walkthrough"
    : row.role === "review-requested" ? `check out the PR first (⌘K: review PR #${row.pr?.number})` : "open the branch first (⌘K)";
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
        <button type="button" disabled={!canPrepare} title={prepareTitle}
          onClick={() => act("/api/reviews/prepare", row, setNote)}>{wt ? "re-prepare" : "prepare"}</button>
        <button type="button" disabled={!row.owner || merged || row.unresolved > 0} title={mergeTitle}
          onClick={() => act("/api/reviews/merge", row, setNote)}>merge</button>
        {(merged || !row.worktree) && (wt || row.unresolved) ? (
          <button type="button" title="remove this review's files" onClick={() => act("/api/reviews/clear", row, setNote)}>clear</button>
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
