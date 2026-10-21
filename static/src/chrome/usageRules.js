// The usage pill's rules that don't need the account registry: when a reading
// is stale, when a meter is on track to hit its limit, what a meter is called.
// Store-free, so tamagotchi.js (Clawd's coding mood) can share them and stay
// pure; usageSummary.js builds the pill's rows on top of them.

// Stale once the fetch is two refresh intervals old (server refreshes every
// 5 min on success) — beyond that the server is failing to fetch, not just
// between refreshes, and the percentages describe the past. Per ACCOUNT: one
// dead credential must not grey out the other subscription's live numbers.
export const STALE_AFTER_S = 600;

// The one home of the stale rule: the pill greys the row out on it, and
// Clawd's coding mood (tamagotchi.codingMood) leaves the account out.
export function isStale(entry, nowSec) {
  return !!entry?.fetched_at && nowSec - entry.fetched_at > STALE_AFTER_S;
}

// On track to hit the limit by either projection heuristic: the pill's red
// arrow and Clawd's grumpy. No arrow when the projection adds nothing over
// the bar itself, which is also why a meter already pinned at 100% only stays
// red while its projection still runs past it.
export function projectsPastLimit(m) {
  const cands = [m?.projected_percent, m?.projected_recent].filter((v) => v != null);
  if (!cands.length) return false;
  const hi = Math.max(...cands);
  return hi > (m.percent ?? 0) && hi >= 100;
}

const METER_LABELS = {
  session: "session",
  week_all: "week",
  week_opus: "opus",
  week_sonnet: "sonnet",
};

// Scoped per-model meters (week_fable, ...) are keyed dynamically by the
// server and differ between accounts — an account can be missing a meter the
// other one has. Never assume a fixed key set.
export function meterLabel(k) {
  return METER_LABELS[k] || k.replace(/^week_/, "");
}
