// Clawd's side effects (Tamagotchi.jsx): the little state its duty rules
// (clawdDuty.js) need that /api/state doesn't carry — when each live question
// was first seen, and which linked PRs just merged. Non-component, like
// split/alertFeed.js, so it keeps watching whether or not the widget is drawn
// (it hides under 1100px). Started once from the widget.
import { effect, signal } from "@preact/signals";
import { windows } from "../store.js";
import { nextMergeWatch, nextNeedsSince } from "./clawdDuty.js";

export const needsSince = signal({});    // pid -> first poll that showed it waiting
export const mergeParties = signal([]);  // [{ key, pid, target, pr, title, at }]

let started = false;
let mergeStates = {};

const sameKeys = (a, b) => {
  const ka = Object.keys(a);
  return ka.length === Object.keys(b).length && ka.every((k) => b[k] === a[k]);
};

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
}
