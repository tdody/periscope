// The review queue: one row per (repo, branch) across every track, from the
// `reviews` signal. Actions are messages to the owning pane — prepare and
// merge never touch git from here (spec D1); clear removes a review dir.
import { useEffect, useState } from "preact/hooks";
import { confirmDialog } from "../overlays/Dialog.jsx";
import { refreshReviews } from "../poll.js";
import { selectReview } from "../split/alertFeed.js";
import { linearTicket } from "../split/linearTicket.js";
import { reviews, reviewsQuery } from "../store.js";
import { prStateMeta } from "../util.js";
import { filterRows, sortRows } from "./walkthrough.js";

// `busy` is per row: a second click while the POST is in flight would send a
// second prompt to the pane (the server's 409 only spans the request).
async function act(url, row, setNote, setBusy) {
  setBusy(true);
  try {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ repo: row.repo, branch: row.branch }) });
    const data = await res.json().catch(() => ({}));
    setNote(res.ok
      ? (data.mode === "spawned" ? (data.checked_out ? "checked out the PR and spawned a pane to prepare" : "spawned a pane to prepare") : "sent")
      : (data.detail || `HTTP ${res.status}`));
    refreshReviews();
  } catch (e) {
    setNote(String(e));
  } finally {
    setBusy(false);
  }
}

// The PR ref (classes shared with every PR badge — see styles.css) with the
// row's Linear ticket after it; with no PR the ticket fills the cell alone. A
// landed PR's CI glyph is dropped, as on the pane pill and detail header, so a
// stale ✓/✗ can't ride a merged PR.
function PrCell({ row }) {
  const lin = linearTicket(row);
  const linLink = lin && <a class="rq-linear" href={lin.href} target="_blank" rel="noopener" title={lin.tip}>{lin.id}</a>;
  if (!row.pr) return linLink || "—";
  const meta = prStateMeta(row.pr.state);
  const cls = `rq-pr-link ${meta.cls}`;
  return <>
    {row.pr.url ? <a class={cls} href={row.pr.url} target="_blank" rel="noopener">#{row.pr.number}</a> : <span class={cls}>#{row.pr.number}</span>}
    {linLink ? <> · {linLink}</> : null}
    {row.pr.draft ? " draft" : ""} {row.pr.state || ""} {row.pr.ci && !meta.cls ? row.pr.ci : ""}<div class="rq-repo">{row.pr.title}</div></>;
}

// The box's visible text is also its accessible name, so a voice user can say what they read.
const SEARCH_HINT = "filter branches, PRs, people, tickets";

function Row({ row }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const merged = row.pr?.state === "merged";
  // An open PR nobody has checked out is still preparable: the server fetches it
  // first. Open only — a closed or not-yet-known PR has nothing the server will fetch.
  const canPrepare = !!row.owner || !!row.worktree || row.pr?.state === "open";
  const wt = row.walkthrough;
  const prepareTitle = row.owner ? "ask the owning pane to write the walkthrough"
    : row.worktree ? "spawn a pane in the worktree to write the walkthrough"
    : canPrepare ? `check out PR #${row.pr.number} and spawn a pane to write the walkthrough`
    : "open the branch first (⌘K)";
  const mergeTitle = row.unresolved > 0
    ? `${row.unresolved} unresolved comment${row.unresolved === 1 ? "" : "s"}`
    : row.owner ? "ask the owning pane to merge" : "no pane on this branch";
  return (
    <tr class={`rq-row rq-${row.role}${merged ? " is-merged" : ""}`}>
      <td class="rq-branch">
        {wt ? <button type="button" class="rq-open" onClick={() => selectReview(row.repo, row.branch)}>{row.branch}</button> : row.branch}
        <div class="rq-repo">{row.repo} · {row.role === "review-requested" ? "review requested" : row.role}</div>
      </td>
      <td class="rq-pr"><PrCell row={row} /></td>
      <td class="rq-wt">{wt ? <>{wt.stops} stop{wt.stops === 1 ? "" : "s"}{wt.stale_by > 0 ? ` · stale ${wt.stale_by}` : wt.stale_by === null && row.worktree ? " · stale: unknown" : ""}</> : "none"}</td>
      <td class="rq-comments">{row.unresolved ? <b>{row.unresolved} open</b> : "—"}</td>
      <td class="rq-owner">
        {row.owner ? row.owner.name : row.pr?.author ? `opened by ${row.pr.author}` : "—"}
        {row.owner ? null : <div class="rq-repo">{row.worktree ? "no pane" : "not checked out"}</div>}
      </td>
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
  const query = reviewsQuery.value;
  const shown = filterRows(sorted, query);
  const noun = `branch${sorted.length === 1 ? "" : "es"}`;
  return (
    <div class="reviews-queue">
      <header class="wt-head">
        <h2>Reviews</h2>
        {/* type=search: WebKit and Chromium clear it on Esc and draw the ✕ themselves. Ahead of the
            count, whose width changes as you type — after it, the box slid under the caret. */}
        <input type="search" class="rq-search" placeholder={SEARCH_HINT} aria-label={SEARCH_HINT}
          spellcheck={false} autocomplete="off"
          value={query} onInput={(e) => { reviewsQuery.value = e.currentTarget.value; }} />
        <span class="wt-sub" aria-live="polite">{query.trim() ? `${shown.length} of ${sorted.length} ${noun}` : `${sorted.length} ${noun}`}</span>
      </header>
      {sorted.length === 0 ? <div class="wt-empty">nothing open</div>
        : shown.length === 0 ? <div class="wt-empty">no branches match "{query.trim()}"</div> : (
        <table class="rq-table">
          <thead><tr><th>branch</th><th>PR</th><th>walkthrough</th><th>comments</th><th>who</th><th></th></tr></thead>
          <tbody>{shown.map((r) => <Row key={`${r.repo}/${r.branch}`} row={r} />)}</tbody>
        </table>
      )}
    </div>
  );
}
