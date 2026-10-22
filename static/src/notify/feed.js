// Native macOS notifications, in the Tauri shell only. The feed watches the
// pushed state, decides what's news (detect.js), words it (copy.js), groups a
// burst (burst.js) and sends it through tauri.js. It also owns the dock badge.
// Non-component, like split/alertFeed.js: it runs whatever is rendered.
// Started once from Split.jsx.
//
// Runs once per applied /api/state, not once per signal change: poll.js's
// applyState writes ~20 signals one at a time (alerts first, untouched when
// a rename/drag defers the rest), so an effect tracking all of them would
// fire mid-write and pair new alerts with stale windows. detect.js also
// counts its dedupe grace in passes (GRACE_PASSES), so extra passes shrink
// it. stateSeq (store.js) is bumped once per applyState call, after every
// signal it writes, so it's the only signal this effect tracks; everything
// else is peeked inside `untracked` so prefs/other signal changes don't
// trigger their own pass (toggles still apply at send time, just a poll late).
import { effect, untracked } from "@preact/signals";
import { openUsageDetails } from "../chrome/UsagePill.jsx";
import { getNotifyPrefs } from "../prefs.js";
import { revealPane, selectPane } from "../split/alertFeed.js";
import { waitingPanes } from "../split/attention.js";
import {
  accounts,
  alerts,
  dismissedAlertIds,
  dismissedNeedsPids,
  dismissedReadyPids,
  stateSeq,
  usage,
  windows,
} from "../store.js";
import { inTauri, notify, onNotificationOpened, openExternal, setBadgeCount } from "../tauri.js";
import { BURST_MS, planBurst, summaryPayload } from "./burst.js";
import { payloadFor } from "./copy.js";
import { detect } from "./detect.js";
import { resumeState, saveState } from "./persist.js";

// A kind's toggle in Settings → Notifications; a question rides on needs-input's.
const TOGGLE = { question: "needs_input" };
export const enabled = (prefs, kind) => prefs[TOGGLE[kind] || kind] !== false;

// A click on a banner that carries a kind (notifications.rs emits
// periscope:notification-opened). An older shell sends only the pane target,
// to alertFeed's onNotificationClick listener, which reveals it.
export function openFromBanner({ target, data = {} } = {}) {
  if (data.open === "url" && data.url) {
    openExternal(data.url);
    return;
  }
  if (data.open === "usage") {
    openUsageDetails();
    return;
  }
  // By pid first: tmux renumbers windows, so a target can name a neighbour by now.
  const w = data.pid != null && (windows.value || []).find((x) => String(x.pid) === String(data.pid));
  if (w) selectPane(w);
  else revealPane(target);
}

let started = false;

export function startNotifyFeed() {
  if (started || !inTauri()) return;
  started = true;
  const storage = typeof localStorage === "undefined" ? null : localStorage;
  let state = resumeState(storage, Date.now());
  let recent = [];
  let held = [];
  let timer = null;

  const send = (payload) => notify({ ...payload, quiet_when_focused: getNotifyPrefs().quiet_when_focused });
  const flush = () => {
    timer = null;
    const batch = held;
    held = [];
    if (batch.length) send(summaryPayload(batch));
  };

  onNotificationOpened(openFromBanner);
  effect(() => {
    // The only tracked read: one pass per applied /api/state (see the header
    // comment). Everything else is peeked below so it can't trigger its own pass.
    stateSeq.value;
    untracked(() => {
      const list = alerts.peek();
      // null until the first /api/state: unknown, not empty. Seeding from it would
      // announce every waiting pane as new on the first real poll.
      if (list === null) return;
      const prefs = getNotifyPrefs();
      const snap = {
        windows: windows.peek() || [], alerts: list, dismissedAlertIds: dismissedAlertIds.peek(),
        dismissedNeedsPids: dismissedNeedsPids.peek(), dismissedReadyPids: dismissedReadyPids.peek(),
        plan: usage.peek()?.plan || {},
      };
      const nowMs = Date.now();
      const r = detect(state, snap, nowMs / 1000);
      state = r.state;
      saveState(storage, state, nowMs);
      // Toggles apply at send time: an event skipped while its kind was off is
      // still recorded, so turning the kind back on doesn't replay it.
      const plan = planBurst(r.events.filter((e) => enabled(prefs, e.kind)), recent, nowMs, prefs.group);
      recent = plan.recent;
      const ctx = { accounts: accounts.peek(), windows: snap.windows };
      for (const ev of plan.now) {
        const p = payloadFor(ev, ctx);
        if (p) send(p);
      }
      if (plan.held.length) {
        held.push(...plan.held);
        if (!timer) timer = setTimeout(flush, BURST_MS);
      }
      // Panes waiting on you, as the rail counts them, not alert rows.
      const waiting = waitingPanes(snap.windows, list, snap.dismissedAlertIds, snap.dismissedNeedsPids, nowMs / 1000);
      setBadgeCount(prefs.badge ? waiting.size : 0);
    });
  });
}
