// Reduces /api/state's `usage_plan` — a mapping of account id → that
// subscription's plan meters — to the rows the usage pill renders.
//
// The pill answers one question at a glance: WHICH ACCOUNT HAS ROOM. That is
// why each account collapses to a single `headline` meter (its highest-percent
// one, i.e. the limit that actually binds right now) while `meters` keeps the
// full ordered set for the expanded view.
import { accountLabel } from "../accounts.js";
import { accounts } from "../store.js";

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

const KNOWN_METERS = ["session", "week_all", "week_opus", "week_sonnet"];
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

function orderMeters(meters) {
  const extra = Object.keys(meters).filter((k) => !KNOWN_METERS.includes(k)).sort();
  return [...KNOWN_METERS, ...extra]
    .filter((k) => meters[k])
    .map((k) => ({ key: k, label: meterLabel(k), m: meters[k] }));
}

// Registered accounts first, in registry order; anything else (a meter set for
// an id no longer registered) sorted after, so an unknown id is visible rather
// than silently dropped.
function orderAccounts(ids) {
  const known = accounts.value.map((a) => a.id).filter((id) => ids.includes(id));
  const rest = ids.filter((id) => !known.includes(id)).sort();
  return [...known, ...rest];
}

/** usage_plan mapping → [{ id, label, available, stale, fetchedAt, meters, headline }]. */
export function summarizeAccounts(plan, nowSec) {
  if (!plan) return [];
  return orderAccounts(Object.keys(plan)).map((id) => {
    const entry = plan[id] || {};
    const meters = entry.available && entry.meters ? orderMeters(entry.meters) : [];
    // `available: true` with an empty meter set says nothing renderable — treat
    // it as unavailable so the row shows "—" instead of a bare letter.
    const available = meters.length > 0;
    // Max percent, first-in-canonical-order on a tie. Ties are common at 0%,
    // where "session" is the more honest headline than an arbitrary week meter.
    const headline = available
      ? meters.reduce((best, x) => ((x.m.percent || 0) > (best.m.percent || 0) ? x : best))
      : null;
    return {
      id,
      label: accountLabel(id),
      available,
      stale: available && isStale(entry, nowSec),
      fetchedAt: entry.fetched_at || null,
      meters,
      headline,
    };
  });
}

// What the collapsed row hides: the account's other meters that are burning
// (🔥) or on track to hit their limit (red →). Clawd's mood reads every meter,
// so the collapsed pill marks these too rather than leave Clawd furious next
// to a pill with no 🔥 on it.
export function hiddenAlerts(a) {
  const others = (a.meters || []).filter((x) => x !== a.headline);
  return {
    hot: others.filter((x) => x.m.hot),
    blow: others.filter((x) => !x.m.hot && projectsPastLimit(x.m)),
  };
}

// Whether an account's Fable budget is on pace to go unused: its week_fable*
// meter projects under 100% at reset AND the reset is within 48h — past the
// point where the remaining budget is likely to be burned. The inverse of the
// server's 🔥 signal, from the same projected_percent field. Takes the raw
// plan entry (not a summarizeAccounts row) so it composes with either.
//
// The prefix scan mirrors launch_policy.sublimit on the server: sub-limit keys
// are slugified display names, so "Fable 5.1" would arrive as week_fable_5_1.
// Kept client-side rather than stamped by the server so this display rule
// ships without a Python change. `isFableKey` is the one home of the rule;
// the pill's tooltip line uses it too.
export const WASTE_HORIZON_S = 48 * 3600;

export function isFableKey(k) {
  return k === "week_fable" || k.startsWith("week_fable_");
}

export function wasteMark(entry, nowSec) {
  const meters = (entry?.available && entry.meters) || {};
  const key = Object.keys(meters).find(isFableKey);
  const m = key && meters[key];
  if (!m || m.projected_percent == null || !m.resets_at) return false;
  // A reset already in the past is stale data, not a budget about to expire.
  const left = m.resets_at - nowSec;
  return m.projected_percent < 100 && left > 0 && left < WASTE_HORIZON_S;
}
