// The header's Claude tamagotchi (Tamagotchi.jsx): the pure parts, so the
// day schedule and the sprite unit-test without a clock or a DOM.

import { isStale, meterLabel, meterMood } from "./usageRules.js";

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
// Halloween's rounds all land from here.
const EVENING = 17;
const KNOCK_OFF = 16;
const HALF = 0.5;

// A weekday with every account walled: Clawd naps at the desk through the
// coding hours (the 9am mug still on it) and knocks off an hour early rather
// than napping on until 5. Weekends have no desk, so they don't change.
const WALLED = SCHEDULE.map((s) => {
  const nap = s.id === "code" ? { ...s, id: "nap", label: "napping at the desk" } : s;
  return nap.to === EVENING ? { ...nap, to: KNOCK_OFF } : nap.from === EVENING ? { ...nap, from: KNOCK_OFF } : nap;
});

const isWeekend = (date) => date.getDay() === 0 || date.getDay() === 6;
const windowAt = (windows, h) => windows.find((s) => h >= s.from && h < s.to);
// The half hours a day's pastimes are planned over: a weekday's from the
// knock-off, walled or not, so the walls coming or going don't re-plan the
// evening; they decide only whether 4–5pm is spent at the desk (and a 4:30
// at the desk covers no verdict).
const pastimeSpan = (date) => windowAt(isWeekend(date) ? WEEKEND : WALLED, EVENING);

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
// null) plus `walls`: the stretches every account was walled, as the server
// dated them ([from, until] epoch ms; until Infinity while they hold with no
// reset reported). A moment is walled only inside one, so the forecast past
// the reset is the plain day's. Each counts in whole minutes, its reset from
// the minute the hover names (wallLabel): resets land a second or so before a
// minute, and a nap cut at 2:29pm under walls held to 2:29:59 would re-arm its
// wake, already due, for that whole minute. A stretch first seen past its
// reset (by a server just started) never held.
const minute = (t) => Math.floor(t / 60_000) * 60_000;
const stretches = (day) => (day.walls || []).map((s) => s.map(minute)).filter(([from, until]) => from < until);
export const walledAt = (date, day) => stretches(day).some(([from, until]) => from <= date.getTime() && date.getTime() < until);

// `date`'s day at hour `h` (17.5 → 5:30pm, 24 → the next midnight).
function dateAt(date, h) {
  const d = new Date(date);
  d.setHours(Math.floor(h), Math.round((h % 1) * 60), 0, 0);
  return d;
}

// Where the walls switch a weekday between its tables: where they land or
// lift, or at the end of the knock-off half they land or lift in. A half
// hour's plan is fixed when it starts, so a knock-off pastime under way when
// the walls lift runs to its end, and a half begun at the desk when they land
// stays there (walls landing and lifting inside one switch nothing). The one
// switch time: the scene, the cover and the hover's range all read it, so
// they can't drift apart.
function switchAt(t) {
  if (!Number.isFinite(t)) return t;
  const h = hours(new Date(t));
  return windowAt(WALLED, h).pastime ? dateAt(new Date(t), Math.ceil(h / HALF) * HALF).getTime() : t;
}
const switches = (day) => stretches(day).map((s) => s.map(switchAt)).filter(([from, until]) => from < until);

function windowsFor(date, day) {
  if (isWeekend(date)) return WEEKEND;
  const t = date.getTime();
  return switches(day).some(([from, until]) => from <= t && t < until) ? WALLED : SCHEDULE;
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

// The pastime span's half hours (pastimeSpan), in order. Forced first:
// Halloween's trick-or-treat rounds, Friday's pint, then the day's verdicts
// (Friday's pint covers the toast). The rest roll from the season's
// pastimes, never the same twice running, forced neighbours included
// (rollFrom), so forcing one half leaves the others as they were.
function pastimePlan(slot, date, day) {
  const byId = (id) => PASTIMES.find((p) => p.id === id);
  const n = (slot.to - slot.from) / HALF;
  const at = (t) => (t - slot.from) / HALF;
  const start = (i) => slot.from + i * HALF;
  const evening = [EVENING, EVENING + HALF].map(at);
  // Whether a half is drawn as its pastime: a weekday's 4–5pm only under
  // the walls.
  const drawn = (i) => !!windowAt(windowsFor(dateAt(date, start(i)), day), start(i)).pastime;
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
    // Each verdict books the first free evening half that starts after it
    // was noted, against the evening as it stood then: they're placed in the
    // order they were noted (a run first within the same minute), and the
    // half under way, begun before the note, is never re-planned. Being the
    // verdict's pastime, it covers it instead, if it's an evening half or the
    // one just before (4:30, on a weekend or a walled weekday). The stored
    // time keeps every caller on the same plan whenever it's read.
    const verdicts = [["furious", "run"], ["merged", "beer"]]
      .filter(([flag]) => day[flag] != null)
      .sort(([a], [b]) => day[a] - day[b]);
    for (const [flag, id] of verdicts) {
      if (evening.some((i) => forced[i]?.id === id)) continue;
      const underWay = Math.floor(at(day[flag]));
      if (underWay >= evening[0] - 1 && underWay < n && drawn(underWay) && rolled()[underWay].id === id) continue;
      const free = evening.find((i) => !forced[i] && i > underWay);
      if (free !== undefined) forced[free] = byId(id);
    }
  }
  return rolled();
}

export function activityAt(date, day = {}) {
  const slot = windowAt(windowsFor(date, day), date.getHours());
  if (slot.meal) return mealAt(slot, date);
  if (slot.pastime) {
    const span = pastimeSpan(date);
    const i = Math.floor((hours(date) - span.from) / HALF);
    const from = span.from + i * HALF;
    return { ...span, ...pastimePlan(span, date, day)[i], from, to: from + HALF };
  }
  if (slot.id !== "code" && slot.id !== "nap") return slot;
  // The desk's hours follow the walls to the minute, so the hover's range
  // agrees with its up-next: the nap runs between the switches, and the
  // coding around it.
  const t = date.getTime();
  const edges = switches(day).flat();
  const from = Math.max(dateAt(date, slot.from).getTime(), ...edges.filter((e) => e <= t));
  const to = Math.min(dateAt(date, slot.to).getTime(), ...edges.filter((e) => e > t));
  return { ...slot, from: hours(new Date(from)), to: hours(new Date(to)) };
}

// Milliseconds until the current window ends, so the sprite changes on the
// hour (or the half hour) rather than up to a minute late. The walls landing
// or lifting wakes any scene, not only the nap they bound, so the hover names
// them exactly while they hold.
export function msUntilNextChange(date, day = {}) {
  const t = date.getTime();
  const { to } = activityAt(date, day);
  return Math.min(dateAt(date, to).getTime(), ...stretches(day).flat().filter((e) => e > t)) - t;
}

// The hover's "up next": the first window after this one with another scene
// (activity and dish), so a night's sleep announces the morning, not more
// sleep at midnight, and 9am's coding (or nap) with a coffee doesn't announce
// 10am's.
export function upNext(date, day = {}) {
  const now = activityAt(date, day);
  let t = date;
  for (let k = 0; k < 8; k++) {
    t = new Date(t.getTime() + msUntilNextChange(t, day));
    const activity = activityAt(t, day);
    if (activity.id !== now.id || activity.dish !== now.dish) return { at: t, activity };
  }
  return null;
}

// What the widget draws at `date`, as a string: its minute backstop
// re-renders only when this changes. Keyed on the window start as well as the
// activity: two adjacent windows can share an id and differ in a prop (9–10am
// codes with the coffee mug), and a laptop asleep from one lunch to the next
// wakes on the same window with another dish; and on the walls holding, which
// the hover names only while they hold.
export function sceneKey(date, day = {}) {
  const a = activityAt(date, day);
  return `${a.from}|${a.id}|${a.dish || ""}|${seasonAt(date)}|${occasionShown(date)?.id || ""}|${headlineAt(date) || ""}`
    + `|${walledAt(date, day)}`;
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
// account, by the pill's own rules (usageRules.meterMood): a meter burning at least
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
      const mood = meterMood(m);
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

// A moment's local time, the same way: 17:30 → "5:30pm".
export function clockLabel(date) {
  return hourLabel(hours(date));
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
