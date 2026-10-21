// Clawd's one side effect (Tamagotchi.jsx): spotting a linked PR that just
// merged, which /api/state can't say on its own — it carries each PR's state,
// not the moment it changed. Non-component, like split/alertFeed.js, so it
// keeps watching whether or not the widget is drawn (it hides under 1100px).
// Started once from the widget.
import { effect, signal } from "@preact/signals";
import { noteClawdDay } from "../prefs.js";
import { windows } from "../store.js";
import { nextMergeWatch } from "./clawdDuty.js";
import { dayKey } from "./tamagotchi.js";

export const mergeParties = signal([]);  // [{ key, pid, pr, at }]

let started = false;
let mergeStates = {};

export function endParty(key) {
  mergeParties.value = mergeParties.value.filter((p) => p.key !== key);
}

export function startClawdWatch() {
  if (started) return;
  started = true;
  effect(() => {
    const prev = mergeParties.peek();
    const m = nextMergeWatch({ states: mergeStates, parties: prev }, windows.value, Date.now() / 1000);
    mergeStates = m.states;
    if (m.parties.length !== prev.length || m.parties.some((p, i) => p.key !== prev[i].key)) mergeParties.value = m.parties;
    // A merge also books the evening's pint (tamagotchi.activityAt).
    if (m.parties.some((p) => !prev.some((q) => q.key === p.key))) noteClawdDay("merged", dayKey(new Date()));
  });
}
