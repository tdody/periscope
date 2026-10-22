// The cross-pane alert feed: exposes `alertItems` as the read model and the
// row behaviours the rail and Clawd share. The list itself arrives on the
// pushed /api/state blob (store.alerts) rather than a poll of its own, so it
// shares the state hub's transport and its notify()-driven kick — an alert
// lands as soon as the tool call that raised it returns. Native banners and
// the dock badge are notify/feed.js's. Started once from Split.jsx.
import * as prefs from "../prefs.js";
import { alerts, dismissedNeedsPids, dismissedReadyPids, railSelection, windows } from "../store.js";
import { onNotificationClick } from "../tauri.js";
import { isSoftQuestion } from "./attention.js";

// The pushed feed IS the read model — re-exported so consumers keep importing
// alerts from the module that owns their semantics.
export const alertItems = alerts;

let started = false;

// Reveal a pane from an alert/native-notification click via inline rail
// selection. No-op when the pane isn't in the live window list (closed
// since the alert fired).
export function revealPane(target) {
  if (!target) return;
  selectPane((windows.value || []).find((x) => x.target === target));
}

// Select a live window inline in the rail, as clicking its row does.
export function selectPane(w) {
  if (!w?.pid) return;
  railSelection.value = `pane:${w.pid}`;
  prefs.setLastSelected({ kind: "pane", pid: w.pid });
}

// What clicking a live NEEDS YOU / READY row does, shared by the rail
// (AttentionSections) and the header's Clawd so the two can't drift. A soft
// question (no real dialog) is dismissed for this episode; a real dialog stays
// sticky. A done row is always dismissed: selecting normally acks it through
// the terminal's WS connect, but an already-selected pane won't reconnect.
export function openNeedsPane(w) {
  if (isSoftQuestion(w)) dismissedNeedsPids.value = new Set([...dismissedNeedsPids.value, w.pid]);
  selectPane(w);
}

export function openReadyPane(w) {
  if (w?.pid) dismissedReadyPids.value = new Set([...dismissedReadyPids.value, w.pid]);
  selectPane(w);
}

export function startAlertFeed() {
  if (started) return;
  started = true;
  // An older shell's banner click carries only the pane target (a newer one
  // sends kinds to notify/feed.js instead).
  onNotificationClick((target) => revealPane(target));
}
