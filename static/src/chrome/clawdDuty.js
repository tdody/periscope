// What Clawd is on duty for (Tamagotchi.jsx): the pure part, so the priority
// rule and every trigger unit-test without signals or a DOM.
//
// Needs-you, ready and running come from the rail's own builders
// (split/attention.js) with the same dismissals, and the context band from the
// rail's ctxClass: Clawd and the rail can never disagree about a pane.

import { buildNeedsYou, buildReady, isSoftQuestion, waitTier } from "../split/attention.js";
import { ctxClass } from "../split/ctxBand.js";
import { paneLabel } from "../util.js";
import { STALE_AFTER_S } from "./usageSummary.js";

// One slot, highest first: what each one is costing you right now. A blocked
// agent beats a stalled API beats a blocked merge beats waiting results; the
// merge party is ten minutes long and a context warning can wait that long;
// cleanup and the update are housekeeping.
export const DUTY_ORDER = ["bell", "api", "ci", "done", "merged", "ctx", "clean", "update"];
export const PARTY_S = 600;

const plural = (n, one) => `${n} ${n === 1 ? one : `${one}s`}`;

function waited(sinceSec, nowSec) {
  const min = Math.floor((nowSec - sinceSec) / 60);
  if (min < 1) return "";
  return min < 60 ? ` (${min} min)` : ` (${Math.floor(min / 60)}h ${min % 60}m)`;
}

const paneTarget = (w, extra = {}) =>
  w ? { action: "pane", target: w.target, pid: w.pid, says: `open ${paneLabel(w)}`, ...extra } : null;

// Everything pending, in DUTY_ORDER. Each item: { kind, label (the bubble's
// text), count (what it adds to the other items' "+N"), phrase (the hover's
// clause), target (what a click does), urgent }.
//
// `selectedPid` is the pane open in the detail view: Clawd never rings about
// the thing already in front of you. The merge party is the exception — it
// asks nothing of you, and you're usually looking at the pane that merged.
export function dutyItems({
  windows = [], alerts = [], dismissedAlertIds = new Set(), dismissedNeedsPids = new Set(),
  dismissedReadyPids = new Set(), selectedPid = null, needsSince = {}, parties = [], update = null, nowSec,
}) {
  const items = [];
  const notSelected = (w) => !w || selectedPid == null || String(w.pid) !== String(selectedPid);
  const live = windows.filter(notSelected);

  // A live question has no start time on /api/state; clawdWatch records the
  // first poll that showed it.
  const needs = buildNeedsYou(windows, alerts, dismissedAlertIds, dismissedNeedsPids).filter((r) => notSelected(r.w));
  if (needs.length) {
    const since = (r) => (r.kind === "event" ? r.ts : (needsSince[r.pid] ?? nowSec));
    const oldest = needs.reduce((a, b) => (since(b) < since(a) ? b : a));
    const name = oldest.w ? paneLabel(oldest.w) : oldest.name || oldest.session || "a pane";
    items.push({
      kind: "bell", count: needs.length, label: String(needs.length),
      urgent: waitTier(since(oldest), nowSec) !== "fresh",
      phrase: needs.length === 1 ? `${name} needs you${waited(since(oldest), nowSec)}`
        : `needs you in ${needs.length} panes · ${name} has waited longest${waited(since(oldest), nowSec)}`,
      target: oldest.kind === "live"
        ? paneTarget(oldest.w, { dismissNeeds: isSoftQuestion(oldest.w) })
        : { action: "pane", target: oldest.target, pid: oldest.w?.pid, says: `open ${name}` },
    });
  }

  const api = live.filter((w) => w.api_error);
  if (api.length) {
    items.push({
      kind: "api", count: api.length, label: "API",
      phrase: `the Anthropic API is erroring in ${plural(api.length, "pane")}, not your code`,
      target: paneTarget(api[0]),
    });
  }

  // One PR can have several panes; it counts once, and drops out entirely
  // when any of them is the one you're looking at.
  const prs = new Map();
  for (const w of windows) {
    if (w.ci !== "✗" || !w.pr || (w.pr_state && w.pr_state !== "open")) continue;
    const key = `${w.repo_slug || w.repo_key || ""}#${w.pr}`;
    if (!prs.has(key)) prs.set(key, { pr: w.pr, panes: [] });
    prs.get(key).panes.push(w);
  }
  const red = [...prs.values()].filter((p) => p.panes.every(notSelected));
  if (red.length) {
    items.push({
      kind: "ci", count: red.length, label: String(red.length),
      phrase: red.length === 1 ? `PR #${red[0].pr} is failing CI` : `${red.length} PRs failing CI`,
      target: paneTarget(red[0].panes[0]),
    });
  }

  const ready = buildReady(windows, alerts, dismissedAlertIds, dismissedReadyPids).filter((r) => notSelected(r.w));
  if (ready.length) {
    const first = ready[0];
    const name = first.w ? paneLabel(first.w) : first.name || "a pane";
    items.push({
      kind: "done", count: ready.length, label: String(ready.length),
      phrase: ready.length === 1 ? `${name} finished` : `${ready.length} panes finished`,
      target: first.kind === "live"
        ? paneTarget(first.w, { dismissReady: true })
        : { action: "pane", target: first.target, pid: first.w?.pid, says: `open ${name}` },
    });
  }

  const partying = parties.filter((p) => nowSec - p.at < PARTY_S);
  if (partying.length) {
    const p = partying[partying.length - 1];
    items.push({
      kind: "merged", count: partying.length, label: String(partying.length),
      phrase: partying.length === 1 ? `PR #${p.pr} merged 🎉` : `${partying.length} PRs merged 🎉`,
      target: { action: "party", target: p.target, pid: p.pid, key: p.key, says: `open PR #${p.pr}` },
    });
  }

  const hot = live.filter((w) => ctxClass(w) === " ctx-hot");
  if (hot.length) {
    const fullest = hot.reduce((a, b) => ((b.context_pct ?? 0) > (a.context_pct ?? 0) ? b : a));
    const pct = fullest.context_pct != null ? Math.round(fullest.context_pct) : null;
    items.push({
      kind: "ctx", count: hot.length, label: pct != null ? `${pct}%` : String(hot.length), pct,
      phrase: hot.length === 1 ? `${paneLabel(fullest)} is running out of context${pct != null ? ` (${pct}%)` : ""}`
        : `${hot.length} panes running out of context`,
      target: paneTarget(fullest),
    });
  }

  // A pane whose linked PR has merged or closed: its worktree's work is done.
  // Read off /api/state, not /api/cleanup/candidates — that walks every
  // worktree's git state (two minutes on a checkout with a hundred of them)
  // and lists long-idle worktrees no pane is using, a standing count that
  // would keep Clawd sweeping forever.
  const finished = new Map();
  for (const w of live) {
    const key = w.cwd || w.target;
    if (w.pr && (w.pr_state === "merged" || w.pr_state === "closed") && !finished.has(key)) finished.set(key, w);
  }
  if (finished.size) {
    const [w] = finished.values();
    items.push({
      kind: "clean", count: finished.size, label: String(finished.size),
      phrase: finished.size === 1 ? `PR #${w.pr} is ${w.pr_state}: ${paneLabel(w)}'s worktree can be cleaned up`
        : `${finished.size} worktrees ready to clean up`,
      target: { action: "cleanup", says: "review the cleanup" },
    });
  }

  if (update?.behind > 0 && !update.running) {
    items.push({
      kind: "update", count: 1, label: "new",
      phrase: `a periscope update is ready (${plural(update.behind, "new commit")})`,
      target: { action: "update", says: "see the update" },
    });
  }

  return items.sort((a, b) => DUTY_ORDER.indexOf(a.kind) - DUTY_ORDER.indexOf(b.kind));
}

// The other items' counts, for the bubble's "+N".
export function moreCount(items) {
  return items.slice(1).reduce((n, i) => n + i.count, 0);
}

// Every account walled (session or weekly at 100%, the meters launch routing
// treats as walls, docs/account-routing.md) means no launch can go anywhere:
// Clawd naps until the soonest account comes back. An account that's stale or
// unavailable can't be called walled, so it keeps Clawd awake. One account
// walled while another has room isn't a nap at all — routing moves work there.
// Returns { until } (epoch seconds, or null when no reset time is known) or null.
const WALL_METERS = ["session", "week_all"];
export function walledUntil(plan, nowSec) {
  const entries = Object.values(plan || {});
  if (!entries.length) return null;
  let soonest = null;
  let known = false;
  for (const e of entries) {
    if (!e?.available || !e.meters) return null;
    if (e.fetched_at && nowSec - e.fetched_at > STALE_AFTER_S) return null;
    const walls = WALL_METERS.map((k) => e.meters[k]).filter((m) => m && m.percent >= 100);
    if (!walls.length) return null;
    // An account is back once every meter walling it has reset.
    const resets = walls.map((m) => m.resets_at).filter(Boolean);
    if (resets.length !== walls.length) continue;
    const back = Math.max(...resets);
    if (!known || back < soonest) soonest = back;
    known = true;
  }
  return { until: known ? soonest : null };
}

// "3pm", "3:40pm"; a reset more than 20 hours out (a weekly wall) also names
// the day: { day: "Thu", time: "3pm" }.
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export function wallLabel(until, nowSec) {
  if (!until) return { day: null, time: "later" };
  const d = new Date(until * 1000);
  const h = d.getHours();
  const m = d.getMinutes();
  const time = `${h % 12 || 12}${m ? `:${String(m).padStart(2, "0")}` : ""}${h < 12 ? "am" : "pm"}`;
  return { day: until - nowSec > 20 * 3600 ? DAYS[d.getDay()] : null, time };
}

export function wallPhrase({ day, time }) {
  return `every account is at its limit until ${day ? `${day} ` : ""}${time}`;
}

// The scene that actually plays at the desk: a nap while every account is
// walled, a sweep when cleanup is the top item, otherwise the schedule's.
export function deskScene(activity, topKind, walled) {
  if (activity !== "code") return activity;
  if (walled) return "nap";
  return topKind === "clean" ? "sweep" : activity;
}

// ---- watcher transitions (clawdWatch.js runs these on every poll) ---------

// pid -> the first poll time that showed the pane waiting on you.
export function nextNeedsSince(prev, windows, nowSec) {
  const next = {};
  for (const w of windows || []) {
    if (w.state === "needs-input" && w.pid) next[w.pid] = prev[w.pid] ?? nowSec;
  }
  return next;
}

// A linked PR's pr_state turning open → merged between two polls throws a
// party. The first sighting of a pane only records its state, so a reload
// never re-throws an old party; panes missing from a poll keep their last
// state, so a rolling reload can't erase the "open" a merge needs to follow.
export function nextMergeWatch({ states, parties }, windows, nowSec) {
  const next = { ...states };
  const out = parties.filter((p) => nowSec - p.at < PARTY_S);
  for (const w of windows || []) {
    if (!w.pid || !w.pr || !w.pr_state) continue;
    const was = states[w.pid];
    next[w.pid] = { pr: w.pr, state: w.pr_state };
    const key = `${w.pid}#${w.pr}`;
    if (was?.pr === w.pr && was.state === "open" && w.pr_state === "merged" && !out.some((p) => p.key === key)) {
      out.push({ key, pid: w.pid, target: w.target, pr: w.pr, title: w.pr_title || "", at: nowSec });
    }
  }
  return { states: next, parties: out };
}
