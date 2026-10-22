// The header's Claude tamagotchi (Tamagotchi.jsx): the pure parts, so the
// day schedule and the sprite unit-test without a clock or a DOM.

import { isStale, meterLabel, projectsPastLimit } from "./usageRules.js";

// What Claude is up to, by local hour. Each window runs [from, to); every
// boundary is on the hour, so the hour alone finds the window. `coffee` keeps
// the morning's mug on the desk through the first coding hour. A `meal` window
// serves a dish; a `pastime` window splits into half hours, each one of
// PASTIMES (activityAt resolves both).
export const SCHEDULE = [
  { from: 0, to: 7, id: "sleep", label: "sleeping" },
  { from: 7, to: 9, id: "coffee", label: "having coffee" },
  { from: 9, to: 10, id: "code", label: "coding with a coffee", coffee: true },
  { from: 10, to: 12, id: "code", label: "coding" },
  { from: 12, to: 13, id: "eat", meal: "lunch" },
  { from: 13, to: 17, id: "code", label: "coding" },
  { from: 17, to: 18, pastime: true },
  { from: 18, to: 19, id: "eat", meal: "dinner" },
  { from: 19, to: 21, id: "read", label: "reading" },
  { from: 21, to: 24, id: "sleep", label: "sleeping" },
];

// Weekends off: a lie-in, brunch, and the afternoon free. The duty bubble
// still rings anywhere; only the desk scenes (moods, the walled nap) go.
export const WEEKEND = [
  { from: 0, to: 9, id: "sleep", label: "sleeping" },
  { from: 9, to: 11, id: "eat", meal: "brunch" },
  { from: 11, to: 18, pastime: true },
  { from: 18, to: 19, id: "eat", meal: "dinner" },
  { from: 19, to: 21, id: "read", label: "reading" },
  { from: 21, to: 24, id: "sleep", label: "sleeping" },
];

// The evening's first half hour: Friday's pint, the day's verdicts and
// Halloween's rounds all land from here. With every account walled, a weekday
// knocks off an hour early rather than napping at the desk until then.
const EVENING = 17;
const KNOCK_OFF = 16;
const HALF = 0.5;

// `seasons` keeps the outdoor ones to their weather: sledding stands in for
// the ride on snow.
export const PASTIMES = [
  { id: "run", label: "out for a run" },
  { id: "cycle", label: "out cycling", seasons: ["spring", "summer", "autumn"] },
  { id: "music", label: "practicing bass" },
  { id: "beer", label: "having a beer with friends" },
  { id: "kids", label: "spending time with the kids" },
  { id: "game", label: "playing video games" },
  { id: "garden", label: "gardening", seasons: ["spring", "summer"] },
  { id: "cook", label: "cooking" },
  { id: "dog", label: "walking the dog" },
  { id: "swim", label: "out for a swim", seasons: ["summer"] },
  { id: "sled", label: "out sledding", seasons: ["winter"] },
];
const TRICKS = { run: "trick-or-treating", kids: "trick-or-treating with the kids" };

// Labels read "having <label> for lunch".
export const MEALS = [
  { id: "ramen", label: "ramen" },
  { id: "pizza", label: "pizza" },
  { id: "burger", label: "a burger" },
  { id: "sushi", label: "sushi" },
  { id: "tacos", label: "tacos" },
  { id: "pasta", label: "pasta" },
  { id: "salad", label: "a salad" },
  { id: "soup", label: "soup", seasons: ["winter"] },
];
export const BRUNCH = [
  { id: "pancakes", label: "pancakes" },
  { id: "waffles", label: "waffles" },
  { id: "eggs", label: "eggs and bacon" },
];
// The year-end dinner is a roast. Summer and Halloween week end dinner on a
// dessert, its last half hour; the occasion outranks the season.
const ROAST = { id: "roast", label: "a roast" };
const DESSERTS = { halloween: { id: "pie", label: "pumpkin pie" }, summer: { id: "icecream", label: "ice cream" } };

const inSeason = (date) => (x) => !x.seasons || x.seasons.includes(seasonAt(date));
const hours = (date) => date.getHours() + date.getMinutes() / 60;

// The day's dice: the same date and salt always roll the same, so a reload, a
// second tab, the hover and the minute backstop all agree on what Clawd is up
// to. FNV-1a, then murmur3's finaliser so the low bits are worth a modulo.
function roll(date, salt) {
  let h = 2166136261;
  for (const c of `${dayKey(date)}|${salt}`) {
    h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  }
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

// The day's pick from `list`, never one of `avoid` (the pick before it, a
// forced neighbour): ramen twice in a day, or the same pastime twice running,
// would read as the scene stuck. A clash steps to the next item rather than
// re-rolling, so ruling one out leaves every other pick as it was.
function rollFrom(list, date, salt, avoid = []) {
  let k = roll(date, salt) % list.length;
  while (avoid.includes(list[k].id)) k = (k + 1) % list.length;
  return list[k];
}

// `day` is what happened today (dayFlags: the hour each verdict was noted, or
// null) plus `walled`, the server's walls.
function windowsFor(date, day) {
  if (date.getDay() === 0 || date.getDay() === 6) return WEEKEND;
  if (!day.walled) return SCHEDULE;
  return SCHEDULE.map((s) =>
    s.to === EVENING ? { ...s, to: KNOCK_OFF } : s.from === EVENING ? { ...s, from: KNOCK_OFF } : s);
}

const served = (slot, dish, course) => ({ ...slot, label: `having ${dish.label} for ${course}`, dish: dish.id });

function mealAt(slot, date) {
  if (slot.meal === "brunch") return served(slot, rollFrom(BRUNCH, date, "brunch"), "brunch");
  const occasion = occasionShown(date)?.id;
  const dessert = slot.meal === "dinner" && (DESSERTS[occasion] || DESSERTS[seasonAt(date)]);
  const half = slot.from + HALF;
  if (dessert && hours(date) >= half) return { ...served(slot, dessert, "dessert"), from: half };
  // Lunch and dinner roll from one menu, and dinner never repeats lunch.
  const menu = MEALS.filter(inSeason(date));
  const lunch = rollFrom(menu, date, "lunch");
  const main = slot.meal === "lunch" ? lunch
    : occasion === "yearend" ? ROAST
    : rollFrom(menu, date, "dinner", [lunch.id]);
  return { ...served(slot, main, slot.meal), ...(dessert ? { to: half } : {}) };
}

// The pastime window's half hours, in order. Forced first: Halloween's
// trick-or-treat rounds, Friday's pint, then the day's verdicts (a furious
// day is run off before a merge is toasted, and Friday's pint covers the
// toast). The rest roll from the season's pastimes, never the same twice
// running, forced neighbours included (rollFrom), so forcing one half leaves
// the others as they were.
function pastimePlan(slot, date, day) {
  const byId = (id) => PASTIMES.find((p) => p.id === id);
  const n = (slot.to - slot.from) / HALF;
  const at = (t) => (t - slot.from) / HALF;
  const start = (i) => slot.from + i * HALF;
  const evening = [EVENING, EVENING + HALF].map(at).filter((i) => i >= 0 && i < n);
  const forced = [];
  const pool = PASTIMES.filter(inSeason(date));
  const rolled = () => {
    const plan = [];
    for (let i = 0; i < n; i++) {
      if (forced[i]) {
        plan.push(forced[i]);
        continue;
      }
      plan.push(rollFrom(pool, date, `pastime${start(i)}`, [plan[i - 1]?.id, forced[i + 1]?.id]));
    }
    return plan;
  };
  if (occasionShown(date)?.id === "halloween") {
    const first = roll(date, "trick") % 2;
    evening.forEach((i, k) => {
      const id = (first + k) % 2 ? "kids" : "run";
      forced[i] = { ...byId(id), label: TRICKS[id], trick: true };
    });
  } else {
    if (date.getDay() === 5) forced[at(EVENING + HALF)] = byId("beer");
    // A verdict books a half hour still running or to come when it's noted,
    // never one already over, and the stored time keeps every caller on the
    // same plan whenever it's read. A pastime already under way then can't
    // step aside for the half after it: being the verdict, it covers it.
    for (const [flag, id] of [["furious", "run"], ["merged", "beer"]]) {
      const noted = day[flag];
      if (noted == null || evening.some((i) => forced[i]?.id === id)) continue;
      const free = evening.find((i) => !forced[i] && start(i + 1) > noted);
      if (free === undefined) continue;
      if (free > 0 && start(free - 1) <= noted && noted < start(free) && rolled()[free - 1].id === id) continue;
      forced[free] = byId(id);
    }
  }
  return rolled();
}

export function activityAt(date, day = {}) {
  const h = date.getHours();
  const slot = windowsFor(date, day).find((s) => h >= s.from && h < s.to);
  if (slot.meal) return mealAt(slot, date);
  if (slot.pastime) {
    const i = Math.floor((hours(date) - slot.from) / HALF);
    const from = slot.from + i * HALF;
    return { ...slot, ...pastimePlan(slot, date, day)[i], from, to: from + HALF };
  }
  return slot;
}

// Milliseconds until the current window ends, so the sprite changes on the
// hour (or the half hour) rather than up to a minute late. setHours(24)
// rolls to next midnight.
export function msUntilNextChange(date, day = {}) {
  const { to } = activityAt(date, day);
  const end = new Date(date);
  end.setHours(Math.floor(to), (to % 1) * 60, 0, 0);
  return end - date;
}

// The hover's "up next": the first window after this one that it would
// describe otherwise, so a night's sleep announces the morning, not more sleep
// at midnight, and 9am's coding with a coffee doesn't announce 10am's coding.
// `said` is the hover's words for a window (Tamagotchi.jsx resolves the walled
// nap through the scene's deskView), so the forecast names the scene drawn.
export function upNext(date, day = {}, said = (a) => a.label) {
  const now = activityAt(date, day);
  const same = (a) => said(a) === said(now) || (a.id === "code" && now.id === "code");
  let t = date;
  for (let k = 0; k < 8; k++) {
    t = new Date(t.getTime() + msUntilNextChange(t, day));
    const activity = activityAt(t, day);
    if (!same(activity)) return { at: t, activity, label: said(activity) };
  }
  return null;
}

const pad = (n) => String(n).padStart(2, "0");

// The local date.
export function dayKey(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// The local date and minute, as the day log stores a verdict
// (prefs.noteClawdDay): the time it was noted decides which half hours it
// can still book.
export function noteKey(date) {
  return `${dayKey(date)}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// What happened today, from the day log (prefs.getClawdDay): the hour each
// verdict was noted, or null; other days' don't count.
export function dayFlags(log, date) {
  const today = dayKey(date);
  const noted = (stamp) => {
    const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/.exec(stamp || "");
    return m?.[1] === today ? Number(m[2]) + Number(m[3]) / 60 : null;
  };
  return { merged: noted(log?.merged), furious: noted(log?.furious) };
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

// Coding says how it's going, the adverb after the verb ("coding furiously
// with a coffee"); everything else says what activityAt named it.
export function activityLabel(activity, mood = "calm") {
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

// A window edge, in hours: 17 → "5pm", 17.5 → "5:30pm".
export function hourLabel(h) {
  if (h === 0 || h === 24) return "midnight";
  if (h === 12) return "noon";
  const m = Math.round((h % 1) * 60);
  return `${Math.floor(h) % 12 || 12}${m ? `:${String(m).padStart(2, "0")}` : ""}${h < 12 ? "am" : "pm"}`;
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
