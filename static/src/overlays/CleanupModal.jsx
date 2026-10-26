// Cleanup modal. Loads candidates from /api/cleanup/candidates, renders a
// checklist with signal badges, submits selected to /api/cleanup/archive.
// Ported from static/cleanup-modal.js. The innerHTML rendering becomes JSX;
// the dirty-row "not auto-selected" rule, the live submit-count, and the
// partial-failure refresh path are preserved.
//
// CSS contract preserved: #cleanup-modal / .cleanup-modal-overlay / -card /
// -head / -sub / -controls / -list / -error / -actions, .cleanup-row /
// -dirty / -check / -body / -title / -meta / -signals, .cleanup-badge /
// -badge-${kind}, .cleanup-dirty / .cleanup-loading / .cleanup-empty /
// .cleanup-delete-branches, body.cleanup-modal-open. Escape closes via the
// shared LIFO useEscape hook.
import { signal } from "@preact/signals";
import { useEffect, useRef, useState } from "preact/hooks";
import { useEscape } from "../hooks/useEscape.js";
import { track } from "../track.js";
import { modalRequest } from "./modalRequest.js";

const open = signal(false);
// The worktree dirs a notification's "Clean up worktree" scoped this opening
// to: null for the full list, [] for an explicit "nothing matched" scope —
// refresh() treats those two differently (see candidatesUrl's caller there).
const scope = signal(null);

// Copies (isolating the signal from caller mutation) and drops empties;
// null/undefined stay null so "no scope" survives distinct from "[]".
export function scopeOf(paths) {
  return paths == null ? null : [...paths].filter(Boolean);
}

function sameScope(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

// `paths` scopes the list (and its preselection) to those worktrees. Same
// scope as last time (e.g. the same banner clicked twice) keeps the existing
// signal value so an in-flight edit isn't wiped by a no-op refetch.
export function openCleanupModal({ paths } = {}) {
  const next = scopeOf(paths);
  if (!sameScope(next, scope.value)) scope.value = next;
  open.value = true;
  track("overlay.open", { which: "cleanup", scoped: !!scope.value });
}

export function candidatesUrl(paths) {
  if (!paths?.length) return "/api/cleanup/candidates";
  return `/api/cleanup/candidates?${paths.map((p) => `paths=${encodeURIComponent(p)}`).join("&")}`;
}

function close() {
  open.value = false;
  scope.value = null;
}

export function CleanupModal() {
  useEscape(close, open.value);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [candidates, setCandidates] = useState([]);
  // Per-candidate checked state, keyed by index. Dirty rows seed false.
  const [checked, setChecked] = useState({});
  const [deleteBranches, setDeleteBranches] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  // Guards a stale in-flight load: a header full walk takes minutes, and a
  // scoped banner open that starts and finishes inside that window must not
  // have the full walk land over it afterwards and replace its list.
  const loadSeq = useRef(0);

  useEffect(() => {
    const btn = document.getElementById("cleanup-btn");
    const onClick = () => openCleanupModal();
    if (btn) btn.addEventListener("click", onClick);
    return () => { if (btn) btn.removeEventListener("click", onClick); };
  }, []);

  async function refresh() {
    const seq = ++loadSeq.current;
    setError("");
    setLoading(true);
    setCandidates([]);
    setChecked({});
    const sc = scope.peek();
    if (sc && sc.length === 0) {
      // An explicit empty scope means nothing matched: never fall through to
      // the unscoped URL, which would fetch and check every candidate.
      setLoading(false);
      return;
    }
    const { data, error: err } = await modalRequest("load candidates", candidatesUrl(sc));
    if (seq !== loadSeq.current) return; // stale: a close or a newer scoped open abandoned us
    setLoading(false);
    if (err) { setError(err); setCandidates([]); return; }
    const cands = data.candidates || [];
    setCandidates(cands);
    // Healthy candidates checked, dirty ones unchecked.
    const seed = {};
    cands.forEach((c, i) => { seed[i] = !c.dirty; });
    setChecked(seed);
  }

  useEffect(() => {
    if (!open.value) {
      loadSeq.current++; // abandon any in-flight load across a close
      return;
    }
    setDeleteBranches(false);
    refresh();
  }, [open.value, scope.value]);

  const selectedCount = Object.values(checked).filter(Boolean).length;

  async function handleSubmit() {
    setError("");
    const selected = [];
    candidates.forEach((c, i) => {
      if (checked[i]) selected.push({ pinned_dir: c.pinned_dir, delete_branch: deleteBranches });
    });
    if (selected.length === 0) return;
    setSubmitting(true);
    const { data: result, error: err } = await modalRequest("archive", "/api/cleanup/archive", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ candidates: selected }),
    });
    setSubmitting(false);
    if (err) { setError(err); return; }
    if (result.failed && result.failed.length > 0) {
      setError(
        `Archived ${result.archived.length}, ${result.failed.length} failed: ` +
        result.failed.map((f) => `${f.pinned_dir.split("/").pop()}: ${f.error}`).join("; ")
      );
      await refresh();
      return;
    }
    close();
  }

  if (!open.value) return null;

  return (
    <div
      id="cleanup-modal"
      class="cleanup-modal-overlay"
      onClick={(e) => { if (e.target.id === "cleanup-modal") close(); }}
    >
      <div class="cleanup-modal-card">
        <header class="cleanup-modal-head">
          <h2>🧹 cleanup</h2>
          <button id="cleanup-modal-close" title="close" onClick={close}>×</button>
        </header>
        <p class="cleanup-modal-sub">
          Worktrees with merged/closed PRs, deleted remote branches, or idle activity. Dirty worktrees are NOT auto-selected.
        </p>
        <div id="cleanup-modal-controls">
          <label class="cleanup-delete-branches">
            <input
              type="checkbox"
              id="cleanup-delete-branches"
              checked={deleteBranches}
              onChange={(e) => setDeleteBranches(e.currentTarget.checked)}
            /> also delete local branches
          </label>
        </div>
        <div id="cleanup-modal-list">
          {loading ? (
            <div class="cleanup-loading">Walking worktrees…</div>
          ) : candidates.length === 0 && !error ? (
            <div class="cleanup-empty">
              {scope.value
                ? "Nothing to clean up here: only a worktree (never a main checkout) whose PR is merged or closed, whose remote branch is gone, or that sits idle."
                : "No cleanup candidates. 🎉"}
            </div>
          ) : (
            candidates.map((c, i) => {
              const name = c.project_name || `(untracked: ${c.pinned_dir.split("/").pop()})`;
              return (
                <label key={c.pinned_dir} class={c.dirty ? "cleanup-row cleanup-row-dirty" : "cleanup-row"} data-i={i}>
                  <input
                    type="checkbox"
                    class="cleanup-row-check"
                    checked={!!checked[i]}
                    onChange={(e) => setChecked((prev) => ({ ...prev, [i]: e.currentTarget.checked }))}
                  />
                  <div class="cleanup-row-body">
                    <div class="cleanup-row-title">{name}</div>
                    <div class="cleanup-row-meta">
                      {c.branch} {c.dirty ? <span class="cleanup-dirty">⚠ dirty</span> : null}
                    </div>
                    <div class="cleanup-row-signals">
                      {(c.signals || []).map((s, si) => (
                        <span key={si} class={`cleanup-badge cleanup-badge-${s.kind}`}>{s.label}</span>
                      ))}
                    </div>
                  </div>
                </label>
              );
            })
          )}
        </div>
        <div id="cleanup-modal-error" class="cleanup-modal-error" hidden={!error}>{error}</div>
        <div class="cleanup-modal-actions">
          <button type="button" id="cleanup-cancel" onClick={close}>cancel</button>
          <button
            type="button"
            id="cleanup-submit"
            disabled={loading || submitting || selectedCount === 0}
            onClick={handleSubmit}
          >
            archive selected ({selectedCount})
          </button>
        </div>
      </div>
    </div>
  );
}
