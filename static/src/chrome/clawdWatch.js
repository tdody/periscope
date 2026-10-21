// Clawd's side effects (Tamagotchi.jsx): the little state its duty rules
// (clawdDuty.js) need that /api/state doesn't carry — when each live question
// was first seen, which linked PRs just merged, and how many worktrees cleanup
// would offer. Non-component, like split/alertFeed.js, so it keeps watching
// whether or not the widget is drawn (it hides under 1100px). Started once
// from the widget.
import { effect, signal } from "@preact/signals";
import { cleanupOpen } from "../overlays/CleanupModal.jsx";
import { windows } from "../store.js";
import { nextMergeWatch, nextNeedsSince } from "./clawdDuty.js";

export const needsSince = signal({});    // pid -> first poll that showed it waiting
export const mergeParties = signal([]);  // [{ key, pid, target, pr, title, at }]
export const cleanupCount = signal(0);

// Cleanup candidates aren't on /api/state: computing them walks every
// worktree's git state. Five minutes matches the server's PR-state cache, so a
// tighter poll would only re-read the same answer.
const CLEANUP_POLL_MS = 5 * 60_000;

let started = false;
let mergeStates = {};

const sameKeys = (a, b) => {
  const ka = Object.keys(a);
  return ka.length === Object.keys(b).length && ka.every((k) => b[k] === a[k]);
};

async function refreshCleanup() {
  try {
    const res = await fetch("/api/cleanup/candidates");
    if (res.ok) cleanupCount.value = ((await res.json()).candidates || []).length;
  } catch (_) {
    // Keep the last count; the connection banner already reports a dead server.
  }
}

export function endParty(key) {
  mergeParties.value = mergeParties.value.filter((p) => p.key !== key);
}

export function startClawdWatch() {
  if (started) return;
  started = true;
  effect(() => {
    const ws = windows.value;
    const now = Date.now() / 1000;
    const since = nextNeedsSince(needsSince.peek(), ws, now);
    if (!sameKeys(since, needsSince.peek())) needsSince.value = since;
    const prev = mergeParties.peek();
    const m = nextMergeWatch({ states: mergeStates, parties: prev }, ws, now);
    mergeStates = m.states;
    if (m.parties.length !== prev.length || m.parties.some((p, i) => p.key !== prev[i].key)) mergeParties.value = m.parties;
  });
  // Archiving in the modal is the one thing that changes the count right away.
  let wasOpen = false;
  effect(() => {
    const isOpen = cleanupOpen.value;
    if (wasOpen && !isOpen) refreshCleanup();
    wasOpen = isOpen;
  });
  refreshCleanup();
  setInterval(refreshCleanup, CLEANUP_POLL_MS);
}
