// Grouping a burst of needs-you banners (notify/feed.js runs it): the pure
// part. Leading edge: the first two inside BURST_MS go out at once, so a lone
// banner never waits; the third and later are held and folded into one summary
// sent when the window closes. Other kinds rarely burst, and macOS stacks them
// by thread.

import { paneLabel, waitKind } from "../util.js";

export const BURST_MS = 3000;
export const LEADING = 2;
const NEEDS_YOU = new Set(["needs_input", "question"]);

// -> { now, held, recent }. `recent` is the send times of needs-you banners
// still inside the window, carried to the next call.
//
// The window counts only banners actually sent (`sent`), not elapsed time —
// so a sustained trickle slower than one per BURST_MS / LEADING (1.5s) is
// never held, no matter how long it runs. Grouping exists to flatten a
// burst, not to rate-limit a steady stream.
export function planBurst(events, recent, nowMs, group = true) {
  const sent = recent.filter((t) => nowMs - t < BURST_MS);
  const now = [];
  const held = [];
  for (const ev of events) {
    if (!group || !NEEDS_YOU.has(ev.kind)) now.push(ev);
    else if (sent.length < LEADING) {
      now.push(ev);
      sent.push(nowMs);
    } else held.push(ev);
  }
  return { now, held, recent: sent };
}

const why = (ev) => (ev.kind === "question" ? "question" : waitKind(ev.w?.waiting_for) === "permission" ? "permission" : "input");

// A click opens the first held pane: the summary can't name one target, and
// opening nothing reads as a broken click.
export function summaryPayload(held) {
  return {
    kind: "summary", thread: "needs_you", target: "", data: { open: "pane", pid: held[0]?.w?.pid ?? null },
    title: `${held.length} more sessions need you`, subtitle: "",
    body: held.map((ev) => `● ${ev.w ? paneLabel(ev.w) : ev.alert?.name || "a session"} · ${why(ev)}`).join("\n"),
  };
}
