// The header's Claude tamagotchi (Tamagotchi.jsx): the pure parts, so the
// day schedule and the sprite unit-test without a clock or a DOM.

import { isStale, meterLabel, projectsPastLimit } from "./usageRules.js";

// What Claude is up to, by local hour. Each window runs [from, to); every
// boundary is on the hour, so the hour alone decides. `coffee` keeps the
// morning's mug on the desk through the first coding hour.
export const SCHEDULE = [
  { from: 0, to: 7, id: "sleep", label: "sleeping" },
  { from: 7, to: 9, id: "coffee", label: "having coffee" },
  { from: 9, to: 10, id: "code", label: "coding with a coffee", coffee: true },
  { from: 10, to: 12, id: "code", label: "coding" },
  { from: 12, to: 13, id: "eat", label: "having lunch" },
  { from: 13, to: 17, id: "code", label: "coding" },
  { from: 17, to: 18, id: "run", label: "out for a run" },
  { from: 18, to: 19, id: "eat", label: "having dinner" },
  { from: 19, to: 21, id: "read", label: "reading" },
  { from: 21, to: 24, id: "sleep", label: "sleeping" },
];

export function activityAt(date) {
  const h = date.getHours();
  return SCHEDULE.find((s) => h >= s.from && h < s.to);
}

// Milliseconds until the current window ends, so the sprite changes on the
// hour rather than up to a minute late. setHours(24) rolls to next midnight.
export function msUntilNextChange(date) {
  const end = new Date(date);
  end.setHours(activityAt(date).to, 0, 0, 0);
  return end - date;
}

// Seasons and occasions follow Faraday's slack-standup-bot (seasons.js), so the
// dashboard and the morning standup agree on what time of year it is: a season
// turns on the local day of its equinox / solstice, and a few narrow occasions
// outrank it. Northern hemisphere, like the bot.
const MEAN_SEASON_TERMS = {
  spring: [2451623.80984, 365242.37404, 0.05169, -0.00411, -0.00057],
  summer: [2451716.56767, 365241.62603, 0.00325, 0.00888, -0.0003],
  autumn: [2451810.21715, 365242.01767, -0.11575, 0.00337, 0.00078],
  winter: [2451900.05952, 365242.74049, -0.06223, -0.00823, 0.00032],
};
const SEASONS = ["spring", "summer", "autumn", "winter"];

// Mean equinox / solstice instant (Meeus, Astronomical Algorithms ch. 27):
// well under an hour off, plenty for a whole-day theme.
export function seasonStart(season, year) {
  const [a, b, c, d, e] = MEAN_SEASON_TERMS[season];
  const y = (year - 2000) / 1000;
  const julianDay = a + b * y + c * y ** 2 + d * y ** 3 + e * y ** 4;
  return new Date((julianDay - 2440587.5) * 86400000);
}

const dayNumber = (d) => d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();

// The season in effect on `date`'s local day, with the instant it began.
function currentSeason(date) {
  const year = date.getFullYear();
  const today = dayNumber(date);
  return [year - 1, year]
    .flatMap((y) => SEASONS.map((season) => ({ season, start: seasonStart(season, y) })))
    .sort((a, b) => a.start - b.start)
    .filter((s) => dayNumber(s.start) <= today)
    .pop();
}

export function seasonAt(date) {
  return currentSeason(date).season;
}

export function isFirstDayOfSeason(date) {
  return dayNumber(currentSeason(date).start) === dayNumber(date);
}

const FIRST_DAY_HEADLINES = {
  winter: "❄️ The winter solstice arrives — the longest night is upon us",
  spring: "🌱 The spring equinox arrives — light and dark stand in balance",
  summer: "☀️ The summer solstice arrives — the sun holds the sky the longest",
  autumn: "🍂 The autumn equinox arrives — the harvest season begins",
};

// [month, day] windows, inclusive; one whose end sorts before its start wraps
// across December 31. Same windows and headlines as the standup bot.
export const OCCASIONS = [
  { id: "halloween", start: [10, 24], end: [10, 31], headline: "🎃 Halloween week — the veil is at its thinnest" },
  { id: "yearend", start: [12, 18], end: [12, 26], headline: "🌟 The year-end wind-down — code freeze, hearts warm" },
  { id: "newyear", start: [12, 31], end: [1, 2], headline: "🎆 The year turns — the ledger resets" },
];

export function occasionAt(date) {
  const today = (date.getMonth() + 1) * 100 + date.getDate();
  const found = OCCASIONS.find(({ start, end }) => {
    const from = start[0] * 100 + start[1];
    const to = end[0] * 100 + end[1];
    return from <= to ? today >= from && today <= to : today >= from || today <= to;
  });
  return found || null;
}

// On the first day of a season the occasion drops out entirely (label, props,
// headline), as in the bot's getTheme.
export function occasionShown(date) {
  return isFirstDayOfSeason(date) ? null : occasionAt(date);
}

// The hover line's extra: a season's first-day headline outranks an occasion,
// as it does in the bot.
export function headlineAt(date) {
  if (isFirstDayOfSeason(date)) return FIRST_DAY_HEADLINES[seasonAt(date)];
  return occasionAt(date)?.headline || null;
}

// Clawd's coding moods, in rank order: everything a mood means lives here.
export const MOODS = {
  calm: { rank: 0 },
  grumpy: { rank: 1, adverb: "grumpily", why: "is on track to hit its limit" },
  furious: { rank: 2, adverb: "furiously", why: "is burning 🔥" },
};

// Halloween-week runs are trick-or-treat rounds; coding says how it's going,
// the adverb after the verb ("coding furiously with a coffee").
export function activityLabel(activity, occasion, mood = "calm") {
  if (activity.id === "run" && occasion?.id === "halloween") return "trick-or-treating";
  const adverb = activity.id === "code" && MOODS[mood]?.adverb;
  if (!adverb) return activity.label;
  const [verb, ...rest] = activity.label.split(" ");
  return [verb, adverb, ...rest].join(" ");
}

// Clawd's mood while coding follows the usage trend, worst meter across every
// account, by the pill's own rules (usageSummary.js): a meter burning at least
// twice its even pace (`hot`, the pill's 🔥) is furious; one on track to hit
// its limit (projectsPastLimit, the pill's red →) is grumpy; anything else is
// calm. A stale or unavailable account counts as calm rather than replaying
// an old reading. `atLimit` says the worst meter is already there, not on its
// way.
export function codingMood(plan, nowSec) {
  let worst = { mood: "calm", account: null, meter: null, atLimit: false };
  for (const [account, entry] of Object.entries(plan || {})) {
    if (!entry?.available || !entry.meters || isStale(entry, nowSec)) continue;
    for (const [meter, m] of Object.entries(entry.meters)) {
      if (!m) continue;
      const mood = m.hot ? "furious" : projectsPastLimit(m) ? "grumpy" : "calm";
      if (MOODS[mood].rank > MOODS[worst.mood].rank) worst = { mood, account, meter, atLimit: (m.percent ?? 0) >= 100 };
    }
  }
  return worst;
}

// The hover line's why: "week usage is burning 🔥". `accountName` is given
// only when there are several accounts to tell apart.
export function moodReason({ mood, meter, atLimit }, accountName) {
  if (!MOODS[mood]?.why || !meter) return null;
  const on = accountName ? ` on account ${accountName}` : "";
  const why = mood === "grumpy" && atLimit ? "has hit its limit" : MOODS[mood].why;
  return `${meterLabel(meter)} usage${on} ${why}`;
}

export function hourLabel(h) {
  if (h === 0 || h === 24) return "midnight";
  if (h === 12) return "noon";
  return `${h % 12}${h < 12 ? "am" : "pm"}`;
}

// Clawd, the Claude Code banner mascot, transcribed from its quadrant-block
// art: ▐▛███▜▌ / ▝▜█████▛▘ / ▘▘ ▝▝. One cell per terminal quadrant, which is
// twice as tall as it is wide, so the scene draws each cell 1×2. The eyes
// (the two quadrants ▛ and ▜ leave out of row 1) are drawn separately so they
// can blink and close.
export const Y0 = 9; // the mascot's top row; each sprite row is 2 units tall
export const SKIN = "#d97757";
export const EYE = "#2b1d16";

export const BODY = [
  "...############..",
  "...############..",
  ".################",
  "...############..",
];
export const EYES = [5, 12]; // columns, in row 1
// Two stride frames: the banner's stance, and every leg one step inward.
export const LEGS = [
  "....#.#....#.#...",
  ".....#.#..#.#....",
];

// [{x, y}] for every "#" in a grid of strings.
export function gridCells(rows) {
  const cells = [];
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) if (row[x] === "#") cells.push({ x, y });
  });
  return cells;
}
