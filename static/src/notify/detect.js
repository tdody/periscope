// What deserves a native notification (notify/feed.js sends them): the pure
// part, so every trigger and its dedupe unit-test without signals or Tauri.
//
// detect(prev, snapshot, nowSec) -> { state, events }. `prev` is the last
// state, or null to seed: the first snapshot records what is already there and
// announces nothing, so a reload never replays old news. Each event fires once
// per key; `seen` maps each key to the pass it was last seen on and drops it
// GRACE_PASSES after that, so the state prunes itself.

import { isStale, meterMood } from "../chrome/usageRules.js";
import { buildNeedsYou } from "../split/attention.js";

export const KINDS = ["needs_input", "question", "done", "ci_failed", "pr_merged", "usage"];

// A key missing from a pass is kept this many passes. A pass is one applied
// /api/state (feed.js), so about 1 s on the WS push (state_hub's tick), 3 s on
// the REST fallback: about 2 min, or longer, which is harmless. One empty or
// garbled state (tmux answering nothing) would otherwise drop every key, and
// the next one would re-announce every waiting, done and question pane.
// Passes, not seconds: a sleep, a relaunch or a webview recycle runs no passes
// (the counter persists with the state), where a wall-clock grace replayed
// everything still waiting on wake.
export const GRACE_PASSES = 120;

// One PR, however many panes show it.
export const prKey = (w) => `${w.repo_slug || w.repo_key || ""}#${w.pr}`;

const MOOD_RANK = { calm: 0, grumpy: 1, furious: 2 };

export function detect(prev, snap, nowSec) {
  const {
    windows = [], alerts = [], dismissedAlertIds = new Set(), dismissedNeedsPids = new Set(),
    dismissedReadyPids = new Set(), plan = {},
  } = snap;
  const seeding = !prev;
  const prevPass = prev?.pass ?? 0;
  const pass = prevPass + 1;
  // What the last pass kept is known; this pass's absences are counted once
  // it's over. A value that isn't a pass number (`true`, or epoch seconds,
  // from states saved before passes were counted) reads as expired.
  const prevSeen = prev?.seen || {};
  const known = new Set();
  for (const [key, at] of Object.entries(prevSeen)) {
    if (typeof at === "number" && at <= prevPass && prevPass - at <= GRACE_PASSES) known.add(key);
  }
  const seen = {};
  const events = [];
  const note = (key, ev) => {
    seen[key] = pass;
    if (!seeding && !known.has(key)) events.push({ key, ...ev });
  };
  // Dismissals live in memory only and reset on a reload; a dismissed item
  // stays seen so a resumed state doesn't announce it as new.
  const keep = (key) => { seen[key] = pass; };

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
  // buildNeedsYou leaves dismissed rows out, so find them on the windows.
  for (const w of windows) {
    if (w.state === "needs-input" && dismissedNeedsPids.has(w.pid)) keep(`needs:${w.pid}@${w.needs_since || 0}`);
  }
  for (const r of rows) {
    if (r.kind !== "event") continue;
    const key = `question:${r.id}`;
    // Hidden behind its pane's dialog: not recorded, so it announces once the
    // dialog closes if still unanswered (engaging the pane acks it). One
    // already announced before the dialog opened stays seen past the grace.
    if (r.w && asking.has(r.w.pid)) {
      if (seeding || known.has(key)) keep(key);
    } else note(key, { kind: "question", w: r.w, alert: r });
  }
  for (const a of alerts) {
    if (a.kind === "need_human" && dismissedAlertIds.has(a.id)) keep(`question:${a.id}`);
  }

  // Done: each finished turn (completed_at), the rail's READY rule.
  for (const w of windows) {
    if (w.state !== "done") continue;
    const key = `done:${w.pid}@${w.completed_at || 0}`;
    if (dismissedReadyPids.has(w.pid)) keep(key);
    else note(key, { kind: "done", w });
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
    // A linked PR whose cache is cold (or gh failed) carries no pr_state and
    // no ci: it says nothing, or it would record "no CI" and the next red poll
    // would re-announce.
    if (w.pr_linked && !w.pr_state) continue;
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
  // window, and at most one banner per account per pass (the worst). The
  // window is keyed by the minute: the server truncates fractional resets_at,
  // so it flickers a second either way within one window. The highest mood
  // reached is kept until the window resets, not while the meter is present,
  // so neither flapping back to calm nor a stale or unavailable fetch (left
  // out, as the pill and Clawd's mood do) re-arms it.
  const meters = {};
  for (const [k, rank] of Object.entries(prev?.meters || {})) {
    if (Number(k.slice(k.lastIndexOf("/") + 1)) * 60 > nowSec) meters[k] = rank;
  }
  for (const [account, entry] of Object.entries(plan || {})) {
    if (!entry?.available || !entry.meters || isStale(entry, nowSec)) continue;
    let worst = null;
    for (const [meter, m] of Object.entries(entry.meters)) {
      // No reset time, no window to dedupe within.
      if (!m?.resets_at) continue;
      const mood = meterMood(m);
      const k = `${account}/${meter}/${Math.round(m.resets_at / 60)}`;
      const was = meters[k] ?? 0;
      meters[k] = Math.max(was, MOOD_RANK[mood]);
      if (!seeding && MOOD_RANK[mood] > was && (!worst || MOOD_RANK[mood] > MOOD_RANK[worst.mood])) {
        worst = { key: `usage:${k}:${mood}`, kind: "usage", account, meter, m, mood };
      }
    }
    if (worst) events.push(worst);
  }

  for (const key of known) {
    if (!(key in seen) && pass - prevSeen[key] <= GRACE_PASSES) seen[key] = prevSeen[key];
  }

  return { state: { pass, seen, ci, prs, meters }, events };
}
