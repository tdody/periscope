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
//
// The rules live in runPass, pure, so they unit-test without Tauri; the
// effect only applies its result. A pass must never throw: the effect runs
// inside applyState's `stateSeq.value += 1`, so a throw would land in
// poll.js as a bad frame and could raise the "disconnected" banner.
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
  dragState,
  editingTarget,
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

const NO_NEWS = { sends: [], flush: [], badge: null };

// One pass -> what to do: { state, recent, held, heldSince, lastBadge } to
// carry to the next pass, `sends` and `flush` (a summary) to notify, `badge`
// to set (null: unchanged). ctx: { state, recent, held, heldSince, lastBadge,
// editing }, where `editing` is a rename or drag in flight. `build` is
// injectable so a test can make one banner throw.
export function runPass(ctx, snap, prefs, nowMs, build = payloadFor) {
  let { state, recent, held, heldSince, lastBadge } = ctx;
  const quiet = { quiet_when_focused: prefs.quiet_when_focused };
  // WKWebView throttles setTimeout in a hidden window, so the burst timer can
  // fire long late; the next pass flushes an overdue summary instead. Clearing
  // `held` here is what keeps the timer from sending it again.
  const flush = [];
  if (held.length && nowMs - heldSince >= BURST_MS) {
    flush.push({ ...summaryPayload(held), ...quiet });
    held = [];
    heldSince = null;
  }
  const out = (extra) => ({
    state, recent, held, heldSince, lastBadge, ...NO_NEWS, flush,
    timerAt: held.length ? heldSince + BURST_MS : null,
    ...extra,
  });
  // null until the first /api/state: unknown, not empty. Seeding from it would
  // announce every waiting pane as new on the first real poll.
  if (snap.alerts === null) return out();
  // Panes waiting on you, as the rail counts them, not alert rows. Computed
  // before the seeding/editing skip below, so a fresh context that can't seed
  // yet still sets the dock badge.
  const waiting = waitingPanes(snap.windows, snap.alerts, snap.dismissedAlertIds, snap.dismissedNeedsPids, nowMs / 1000);
  const count = prefs.badge ? waiting.size : 0;
  // Only on change: it's a native call every pass otherwise (one a second on
  // the WS push). lastBadge starts undefined, so a new JS context always sends.
  const badge = count === lastBadge ? null : count;
  lastBadge = count;
  // Seeding from a partial snapshot would announce the rest as new once it
  // lands: the first state can be empty (tmux answering nothing — with zero
  // windows the feed doesn't seed, so usage and window-less question banners
  // stay silent until a window exists; an accepted edge) or have its windows
  // held back by a rename/drag. Waiting only delays the seed.
  if (!state && (!snap.windows.length || ctx.editing)) return out({ badge });
  const sends = [];
  // Mid-rename/drag applyState freezes `windows` but still moves `alerts`;
  // detecting on that mix would pair new alerts with stale panes. The badge
  // still follows.
  if (!ctx.editing) {
    const r = detect(state, snap, nowMs / 1000);
    state = r.state;
    // Toggles apply at send time: an event skipped while its kind was off is
    // still recorded, so turning the kind back on doesn't replay it.
    const plan = planBurst(r.events.filter((e) => enabled(prefs, e.kind)), recent, nowMs, prefs.group);
    recent = plan.recent;
    const bctx = { accounts: snap.accounts, windows: snap.windows };
    for (const ev of plan.now) {
      // One bad event mustn't cost the others their banner, or the badge.
      let p = null;
      try {
        p = build(ev, bctx);
      } catch (e) {
        console.error("[notify] banner failed", ev.key, e);
      }
      if (p) sends.push({ ...p, ...quiet });
    }
    if (plan.held.length) {
      held = [...held, ...plan.held];
      heldSince ??= nowMs;
    }
  }
  return out({ sends, badge });
}

let started = false;

export function startNotifyFeed() {
  if (started || !inTauri()) return;
  started = true;
  const storage = typeof localStorage === "undefined" ? null : localStorage;
  let ctx = { state: resumeState(storage, Date.now()), recent: [], held: [], heldSince: null, lastBadge: undefined };
  let timer = null;
  // The heldSince + BURST_MS the live `timer` targets, so a pass that flushes
  // the old batch and holds a new one in the same tick reschedules instead of
  // firing on the stale deadline (which would fire ~3s early and split the
  // new burst into two summaries).
  let timerFor = null;

  // The backstop for a burst that ends with no further pass; runPass flushes
  // it first when a pass comes due, and either path empties `held`.
  const flushHeld = () => {
    timer = null;
    timerFor = null;
    const batch = ctx.held;
    ctx = { ...ctx, held: [], heldSince: null };
    if (batch.length) notify({ ...summaryPayload(batch), quiet_when_focused: getNotifyPrefs().quiet_when_focused });
  };

  onNotificationOpened(openFromBanner);
  effect(() => {
    // The only tracked read: one pass per applied /api/state (see the header
    // comment). Everything else is peeked below so it can't trigger its own pass.
    stateSeq.value;
    untracked(() => {
      try {
        const snap = {
          windows: windows.peek() || [], alerts: alerts.peek(), dismissedAlertIds: dismissedAlertIds.peek(),
          dismissedNeedsPids: dismissedNeedsPids.peek(), dismissedReadyPids: dismissedReadyPids.peek(),
          plan: usage.peek()?.plan || {}, accounts: accounts.peek(),
        };
        const editing = !!(editingTarget.peek() || dragState.peek());
        const nowMs = Date.now();
        const prevState = ctx.state;
        const { sends, flush, badge, timerAt, ...next } = runPass({ ...ctx, editing }, snap, getNotifyPrefs(), nowMs);
        ctx = next;
        if (ctx.state !== prevState) saveState(storage, ctx.state, nowMs);
        for (const p of [...flush, ...sends]) notify(p);
        // Reschedule whenever the target deadline moves, not just when a
        // timer is/isn't running — a pass that flushes the old batch and
        // holds a new one in the same tick must drop the stale timer, or it
        // fires on the old `heldSince` and sends the new batch ~3s early.
        if (timerAt == null) {
          if (timer) clearTimeout(timer);
          timer = null;
          timerFor = null;
        } else if (timerAt !== timerFor) {
          if (timer) clearTimeout(timer);
          timerFor = timerAt;
          timer = setTimeout(flushHeld, Math.max(0, timerAt - nowMs));
        }
        if (badge !== null) setBadgeCount(badge);
      } catch (e) {
        console.error("[notify] pass failed", e);
      }
    });
  });
}
