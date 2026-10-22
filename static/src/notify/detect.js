// What deserves a native notification (notify/feed.js sends them): the pure
// part, so every trigger and its dedupe unit-test without signals or Tauri.
//
// detect(prev, snapshot, nowSec) -> { state, events }. `prev` is the last
// state, or null to seed: the first snapshot records what is already there and
// announces nothing, so a reload never replays old news. Each event fires once
// per key; the state holds only keys still live, so it prunes itself.

import { isStale, projectsPastLimit } from "../chrome/usageRules.js";
import { buildNeedsYou } from "../split/attention.js";

export const KINDS = ["needs_input", "question", "done", "ci_failed", "pr_merged", "usage"];

// One PR, however many panes show it.
export const prKey = (w) => `${w.repo_slug || w.repo_key || ""}#${w.pr}`;

const MOOD_RANK = { calm: 0, grumpy: 1, furious: 2 };
const meterMood = (m) => (m.hot ? "furious" : projectsPastLimit(m) ? "grumpy" : "calm");

export function detect(prev, snap, nowSec) {
  const {
    windows = [], alerts = [], dismissedAlertIds = new Set(), dismissedNeedsPids = new Set(),
    dismissedReadyPids = new Set(), plan = {},
  } = snap;
  const seeding = !prev;
  const prevSeen = prev?.seen || {};
  const seen = {};
  const events = [];
  const note = (key, ev) => {
    seen[key] = true;
    if (!seeding && !prevSeen[key]) events.push({ key, ...ev });
  };

  // Needs-you: a live dialog per needs-input episode (needs_since), a
  // question per agent need_human message. One banner per pane: a pane with a
  // dialog open doesn't also announce its message.
  const rows = buildNeedsYou(windows, alerts, dismissedAlertIds, dismissedNeedsPids);
  const asking = new Set();
  for (const r of rows) {
    if (r.kind !== "live") continue;
    asking.add(r.w.pid);
    note(`needs:${r.w.pid}@${r.w.needs_since || 0}`, { kind: "needs_input", w: r.w });
  }
  for (const r of rows) {
    if (r.kind !== "event") continue;
    const key = `question:${r.id}`;
    if (r.w && asking.has(r.w.pid)) seen[key] = true;
    else note(key, { kind: "question", w: r.w, alert: r });
  }

  // Done: each finished turn (completed_at), the rail's READY rule.
  for (const w of windows) {
    if (w.state === "done" && !dismissedReadyPids.has(w.pid)) note(`done:${w.pid}@${w.completed_at || 0}`, { kind: "done", w });
  }

  // PRs, by transition rather than by key: CI turning red, a linked PR
  // merging. A PR first sighted mid-state (already red, already merged) only
  // records it. PRs missing from a poll keep their last state, so a rolling
  // reload can't erase the "open" a merge needs to follow.
  const ci = { ...(prev?.ci || {}) };
  const prs = { ...(prev?.prs || {}) };
  const byPr = new Map();
  for (const w of windows) {
    if (!w.pr) continue;
    const k = prKey(w);
    // The linked pane (it carries pr_state) speaks for the PR.
    if (!byPr.has(k) || (w.pr_state && !byPr.get(k).pr_state)) byPr.set(k, w);
  }
  for (const [k, w] of byPr) {
    const open = !w.pr_state || w.pr_state === "open";
    const glyph = open ? w.ci || null : null;
    if (!seeding && k in ci && ci[k] !== "✗" && glyph === "✗") events.push({ key: `ci:${k}`, kind: "ci_failed", w });
    ci[k] = glyph;
    if (w.pr_state) {
      if (!seeding && prs[k] === "open" && w.pr_state === "merged") events.push({ key: `merged:${k}`, kind: "pr_merged", w });
      prs[k] = w.pr_state;
    }
  }

  // Usage: a meter's mood getting worse, at most once per mood step per reset
  // window (the key carries resets_at). The highest mood reached is kept, so a
  // meter flapping back to calm doesn't re-arm within the window. Stale or
  // unavailable accounts are left out, as the pill and Clawd's mood do.
  const meters = {};
  for (const [account, entry] of Object.entries(plan || {})) {
    if (!entry?.available || !entry.meters || isStale(entry, nowSec)) continue;
    for (const [meter, m] of Object.entries(entry.meters)) {
      if (!m) continue;
      const mood = meterMood(m);
      const k = `${account}/${meter}/${m.resets_at || 0}`;
      const was = prev?.meters?.[k] ?? (seeding ? MOOD_RANK[mood] : 0);
      meters[k] = Math.max(was, MOOD_RANK[mood]);
      if (!seeding && MOOD_RANK[mood] > was) events.push({ key: `usage:${k}:${mood}`, kind: "usage", account, meter, m, mood });
    }
  }

  return { state: { seen, ci, prs, meters }, events };
}
