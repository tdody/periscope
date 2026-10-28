// The native review walkthrough: stops as cards (structural claims), the
// branch diff's matching hunks collapsed under each, and a comment box per
// stop. Reads /api/reviews/walkthrough; the file is the artifact, this is a
// lens on it (spec D2/D5). No pane target here, so hunk heads and unmatched
// chips are inert.
import { useEffect, useState } from "preact/hooks";
import { Hunk, langFor } from "../diff/ChangesTab.jsx";
import { refreshReviews } from "../poll.js";
import { renderMarkdown } from "../split/markdown.jsx";
import { prStateMeta } from "../util.js";
import { matchRefs, parseWalkthrough } from "./walkthrough.js";

async function postJson(url, body) {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

function Comments({ list }) {
  if (!list.length) return null;
  return (
    <ul class="wt-comments">
      {list.map((c, i) => (
        <li key={i} class={c.resolved ? "is-resolved" : ""}>
          <span class="wt-comment-ts">{c.ts}</span>
          <span class="wt-comment-state">{c.resolved ? "resolved" : "open"}</span>
          <div class="wt-comment-body">{renderMarkdown(c.body, { demote: false, softBreaks: "space" })}</div>
        </li>
      ))}
    </ul>
  );
}

function CommentBox({ repo, branch, stop, onPosted }) {
  const [text, setText] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  async function post() {
    if (busy || !text.trim()) return;
    setBusy(true);
    try {
      const r = await postJson("/api/reviews/comment", { repo, branch, stop, body: text });
      if (r.ok) { setText(""); setNote("sent to the owning pane"); }
      else if (r.status === 409) { setText(""); setNote(`saved, ${r.data.detail || "not delivered"}`); }
      else setNote(r.data.detail || `HTTP ${r.status}`);
      onPosted();
    } catch (e) {
      setNote(String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div class="wt-comment-box">
      <textarea rows={2} value={text} placeholder="comment on this stop…"
        onInput={(e) => setText(e.currentTarget.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) post(); }} />
      <div class="wt-comment-actions">
        <button type="button" disabled={busy || !text.trim()} onClick={post}>comment</button>
        {note ? <span class="wt-comment-note">{note}</span> : null}
      </div>
    </div>
  );
}

function Stop({ stop, diffFiles, comments, repo, branch, hl, onPosted }) {
  const [open, setOpen] = useState(false);
  const matched = matchRefs(stop.refs, diffFiles || []);
  const total = matched.reduce((n, m) => n + m.hunks.length, 0);
  const cite = (c) => {
    const hit = matched.find((m) => m.ref.raw === c.raw && m.hunks.length);
    return (
      <button type="button" class={`md-cite${hit ? "" : " is-inert"}`}
        title={hit ? "show hunks" : "no hunk in this branch's diff"}
        onClick={() => hit && setOpen(true)}>{c.raw}</button>
    );
  };
  return (
    <section class="wt-stop" id={`stop-${stop.id}`}>
      <h3 class="wt-stop-title">
        {stop.kind ? <span class={`wt-kind wt-kind-${stop.knownKind ? stop.kind : "other"}`}>{stop.kind}</span> : null}
        {stop.title}
      </h3>
      {stop.refs.length ? (
        <div class="md-meta">
          <span class="md-meta-kv" data-key="refs">
            <span class="md-meta-k">refs</span>
            <span class="md-meta-v">{stop.refs.map((r, i) => <span key={i}>{i ? ", " : ""}{cite(r)}</span>)}</span>
          </span>
        </div>
      ) : null}
      <div class="md-doc wt-stop-body">
        {renderMarkdown(stop.bodyMarkdown, { demote: false, softBreaks: "space", mermaid: true, meta: true, cite })}
      </div>
      {diffFiles && stop.refs.length ? (
        <div class="wt-evidence">
          <button type="button" class="wt-evidence-toggle" onClick={() => setOpen(!open)}>
            {open ? "▾" : "▸"} {total} hunk{total === 1 ? "" : "s"}
          </button>
          {open && matched.map((m, i) => (
            <div key={i} class="wt-evidence-file">
              <div class="wt-evidence-path">
                {m.ref.raw}{m.file ? (m.generated ? " — generated, not shown" : "") : " — not in this diff"}
              </div>
              {m.hunks.map((h, j) => <Hunk key={j} hunk={h} lang={langFor(m.ref.path)} hl={hl} onOpen={null} />)}
            </div>
          ))}
        </div>
      ) : null}
      <Comments list={comments} />
      <CommentBox repo={repo} branch={branch} stop={stop.title} onPosted={onPosted} />
    </section>
  );
}

// `sig` changes when the row's head / staleness / unresolved count does (from
// the 10 s reviews poll), so a reply, a resolve or a re-prepare refetches the
// open view instead of leaving it stale until re-selected.
export function Walkthrough({ repo, branch, pr, sig }) {
  const [state, setState] = useState({ loading: true, error: null, data: null });
  const [hl, setHl] = useState(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let alive = true;
    import("../preview/highlightCode.jsx").then((m) => { if (alive) setHl(() => m.highlightCode); }).catch(() => {});
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch(`/api/reviews/walkthrough?repo=${encodeURIComponent(repo)}&branch=${encodeURIComponent(branch)}`);
        const body = await res.json().catch(() => ({}));
        if (!alive) return;
        // Keep the last good data on a failed refetch: unmounting every Stop
        // would drop the open hunks and any half-typed comment.
        if (!res.ok) { setState((s) => ({ loading: false, error: body.detail || `HTTP ${res.status}`, data: s.data })); return; }
        setState({ loading: false, error: null, data: body });
      } catch (e) {
        if (alive) setState((s) => ({ loading: false, error: String(e), data: s.data }));
      }
    })();
    return () => { alive = false; };
  }, [repo, branch, nonce, sig]);

  const onPosted = () => { setNonce((n) => n + 1); refreshReviews(); };

  if (state.loading) return <div class="wt-empty">loading…</div>;
  if (!state.data) return <div class="wt-empty">{state.error}</div>;
  const { text, comments, diff, stale_by } = state.data;
  const w = parseWalkthrough(text);
  const byStop = new Map();
  for (const c of comments) (byStop.get(c.stop) || byStop.set(c.stop, []).get(c.stop)).push(c);
  const attached = new Set(w.stops.map((s) => s.title));
  const unattached = comments.filter((c) => !attached.has(c.stop));

  return (
    <div class="walkthrough">
      {state.error ? <div class="wt-empty wt-error">refresh failed: {state.error}</div> : null}
      <header class="wt-head">
        <h2>{w.title || branch}</h2>
        <span class="wt-sub">
          {repo} · {branch}
          {/* Styled like the queue's PR link (THI-442): unclassed, it was the UA's default blue. */}
          {w.header?.pr ? <> · {pr?.url && pr.number === w.header.pr ? <a class={`rq-pr-link ${prStateMeta(pr.state).cls}`} href={pr.url} target="_blank" rel="noopener">PR #{w.header.pr}</a> : `PR #${w.header.pr}`}</> : ""}
          {stale_by == null && w.header ? (diff ? "" : " · no worktree — hunks unavailable") : stale_by > 0 ? ` · stale: ${stale_by} commit${stale_by === 1 ? "" : "s"} since` : ""}
        </span>
      </header>
      {w.problem ? <p class="wt-problem">{w.problem}</p> : null}
      {w.stops.map((s) => (
        <Stop key={s.id} stop={s} diffFiles={diff?.files || null} comments={byStop.get(s.title) || []}
          repo={repo} branch={branch} hl={hl} onPosted={onPosted} />
      ))}
      {unattached.length ? (
        <section class="wt-stop">
          <h3 class="wt-stop-title">unattached comments</h3>
          <Comments list={unattached} />
        </section>
      ) : null}
    </div>
  );
}
