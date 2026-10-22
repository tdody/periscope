import { describe, expect, it } from "vitest";
import {
  activityAt, activityLabel, BODY, BRUNCH, clockLabel, codingMood, dayFlags, dayKey, gridCells, headlineAt, hourLabel,
  isFirstDayOfSeason, LEGS, MEALS, moodReason, msUntilNextChange, noteKey, occasionAt, occasionShown, PASTIMES,
  SCHEDULE, seasonAt, seasonStart, upNext, WEEKEND,
} from "../tamagotchi.js";

const at = (h, m = 0) => new Date(2026, 9, 21, h, m, 0, 0); // a Wednesday

describe("activityAt", () => {
  it("follows the day's schedule at every boundary", () => {
    const cases = [
      [0, 0, "sleep"], [6, 59, "sleep"],
      [7, 0, "coffee"], [8, 59, "coffee"],
      [9, 0, "code"], [9, 59, "code"], [10, 0, "code"], [11, 59, "code"],
      [12, 0, "eat"], [12, 59, "eat"],
      [13, 0, "code"], [16, 59, "code"],
      [18, 0, "eat"], [18, 59, "eat"],
      [19, 0, "read"], [20, 59, "read"],
      [21, 0, "sleep"], [23, 59, "sleep"],
    ];
    for (const [h, m, id] of cases) expect(activityAt(at(h, m)).id, `${h}:${m}`).toBe(id);
    for (const m of [0, 29, 30, 59]) expect(PASTIMES.map((p) => p.id), `17:${m}`).toContain(activityAt(at(17, m)).id);
  });

  it("covers all 24 hours with no gap or overlap, weekdays and weekends", () => {
    for (const windows of [SCHEDULE, WEEKEND]) {
      for (let h = 0; h < 24; h++) expect(windows.filter((s) => h >= s.from && h < s.to)).toHaveLength(1);
    }
  });
});

describe("the first coding hour", () => {
  it("codes with a coffee on the desk from 9am to 10am, then plain", () => {
    expect(activityAt(at(9, 0)).coffee).toBe(true);
    expect(activityAt(at(9, 59)).coffee).toBe(true);
    expect(activityAt(at(10, 0)).coffee).toBeFalsy();
    expect(activityAt(at(13, 30)).coffee).toBeFalsy();
    expect(activityAt(at(9, 30)).label).toBe("coding with a coffee");
  });
  it("ends the coffee window on the hour", () => {
    expect(msUntilNextChange(at(9, 30))).toBe(30 * 60 * 1000);
  });
});

describe("msUntilNextChange", () => {
  it("counts down to the end of the current window", () => {
    expect(msUntilNextChange(at(8, 30))).toBe(30 * 60 * 1000);
    expect(msUntilNextChange(at(13, 0))).toBe(4 * 60 * 60 * 1000);
  });
  it("changes the evening pastime on the half hour", () => {
    expect(msUntilNextChange(at(17, 0))).toBe(30 * 60 * 1000);
    expect(msUntilNextChange(at(17, 10))).toBe(20 * 60 * 1000);
    expect(msUntilNextChange(at(17, 40))).toBe(20 * 60 * 1000);
  });
  it("rolls past midnight for the late sleep window", () => {
    expect(msUntilNextChange(at(23, 0))).toBe(60 * 60 * 1000);
  });
});

describe("hourLabel", () => {
  it("reads like a clock", () => {
    expect([0, 7, 12, 13, 21, 24].map(hourLabel)).toEqual(["midnight", "7am", "noon", "1pm", "9pm", "midnight"]);
  });
  it("reads a half hour too", () => {
    expect([0.5, 12.5, 17.5].map(hourLabel)).toEqual(["12:30am", "12:30pm", "5:30pm"]);
  });
  it("reads a moment's local time the same way", () => {
    expect([at(0, 0), at(12, 0), at(17, 30), at(9, 15)].map(clockLabel)).toEqual(["midnight", "noon", "5:30pm", "9:15am"]);
  });
});

// Sixty days from a fixed start: enough for every pick to come up, and fixed
// so a failure reproduces.
const days = (h, m) => Array.from({ length: 60 }, (_, n) => new Date(2026, 0, 1 + n, h, m));

describe("the evening pastime", () => {
  it("holds one pastime through each half hour, and changes at the half", () => {
    const first = activityAt(at(17, 0));
    expect(activityAt(at(17, 29))).toEqual(first);
    expect([first.from, first.to]).toEqual([17, 17.5]);
    const second = activityAt(at(17, 30));
    expect(activityAt(at(17, 59))).toEqual(second);
    expect([second.from, second.to]).toEqual([17.5, 18]);
    expect(first.label).toBe(PASTIMES.find((p) => p.id === first.id).label);
  });

  it("never does the same thing twice in one evening, and gives every pastime of the season a turn", () => {
    for (const [season, month] of [["winter", 0], ["summer", 6]]) {
      const seen = new Set();
      Array.from({ length: 60 }, (_, n) => new Date(2026, month, 1 + n, 17)).forEach((d, n) => {
        const [a, b] = [activityAt(d).id, activityAt(new Date(d.getTime() + 30 * 60_000)).id];
        expect(a, `${season} day ${n}`).not.toBe(b);
        seen.add(a).add(b);
      });
      const pool = PASTIMES.filter((p) => !p.seasons || p.seasons.includes(season)).map((p) => p.id);
      expect([...seen].sort(), season).toEqual(pool.sort());
    }
  });

  it("keeps the outdoor pastimes to their seasons: sledding replaces the ride in winter", () => {
    const ids = (month) => new Set(Array.from({ length: 28 }, (_, n) => [
      activityAt(new Date(2026, month, 1 + n, 17)).id, activityAt(new Date(2026, month, 1 + n, 17, 30)).id,
    ]).flat());
    expect(ids(0).has("cycle")).toBe(false);
    for (const month of [4, 9]) expect(ids(month).has("sled"), `month ${month}`).toBe(false);
    for (const month of [0, 4, 9]) expect(ids(month).has("swim"), `month ${month}`).toBe(false);
    expect(ids(0).has("garden")).toBe(false);
  });
});

describe("the evening's rules", () => {
  const evening = (d, day) => [17, 17.5].map((t) => activityAt(new Date(d.getFullYear(), d.getMonth(), d.getDate(), 17, (t % 1) * 60), day));
  // Weekdays in January: no occasion, and every day of the week.
  const weekdays = Array.from({ length: 40 }, (_, n) => new Date(2026, 0, 5 + n)).filter((d) => d.getDay() % 6);
  // A verdict is the hour it was noted (dayFlags): a morning one is known all evening.
  const MORNING = 11;

  it("trick-or-treats every Halloween evening, alternating the ghost run with the kids", () => {
    for (let date = 24; date <= 31; date++) {
      const [a, b] = evening(new Date(2026, 9, date));
      expect([a.id, b.id].sort(), `Oct ${date}`).toEqual(["kids", "run"]);
      expect(a.trick && b.trick, `Oct ${date}`).toBe(true);
    }
    const [a, b] = evening(new Date(2026, 9, 26));
    const kids = a.id === "kids" ? a : b;
    expect(kids.label).toBe("trick-or-treating with the kids");
    expect((a.id === "run" ? a : b).label).toBe("trick-or-treating");
    // Only the evening: a Halloween-weekend afternoon is an ordinary one.
    expect(activityAt(new Date(2026, 9, 31, 14)).trick).toBeFalsy();
    expect(evening(new Date(2026, 10, 2)).some((x) => x.trick)).toBe(false);
  });

  it("makes Friday's 5:30 a pint with friends", () => {
    for (const d of weekdays.filter((x) => x.getDay() === 5)) {
      const [a, b] = evening(d);
      expect(b.id, d.toDateString()).toBe("beer");
      expect(a.id, d.toDateString()).not.toBe("beer");
    }
  });

  it("toasts a merged PR, and runs off a furious day first", () => {
    for (const d of weekdays.filter((x) => x.getDay() !== 5)) {
      expect(evening(d, { merged: MORNING }).map((x) => x.id), d.toDateString()).toContain("beer");
      expect(evening(d, { furious: MORNING })[0].id, d.toDateString()).toBe("run");
      expect(evening(d, { merged: MORNING, furious: MORNING }).map((x) => x.id), d.toDateString()).toEqual(["run", "beer"]);
    }
    const friday = weekdays.find((x) => x.getDay() === 5);
    expect(evening(friday, { merged: MORNING, furious: MORNING }).map((x) => x.id)).toEqual(["run", "beer"]);
  });

  it("books a verdict only into a half hour still running or to come, so the scene now never steps aside for it", () => {
    const late = 17 + 40 / 60; // 5:40pm
    let rolledBeer = 0;
    for (const d of Array.from({ length: 120 }, (_, n) => new Date(2026, 0, 5 + n)).filter((x) => x.getDay() % 6 && x.getDay() !== 5)) {
      const plain = evening(d);
      if (plain[1].id === "beer") rolledBeer += 1;
      // 5:00 is over: the pint goes to 5:30, and a 5:30 already at the pub stays there.
      expect(evening(d, { merged: late })[1].id, d.toDateString()).toBe("beer");
      expect(evening(d, { furious: late })[1].id, d.toDateString()).toBe("run");
      // Past 6pm the evening is over: nothing left to book.
      expect(evening(d, { merged: 18.2, furious: 18.2 }), d.toDateString()).toEqual(plain);
    }
    expect(rolledBeer).toBeGreaterThan(0);
  });

  it("lets a pastime already under way cover the verdict rather than step aside for it", () => {
    // Weekends (and walled weekdays) have halves before 5pm: the 4:30 one is
    // running when a 4:40 merge lands, so it can't be the one that moves.
    const at = (d, h, m) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m);
    let covered = 0;
    for (const d of Array.from({ length: 365 }, (_, n) => new Date(2026, 0, 1 + n)).filter((x) => !(x.getDay() % 6))) {
      if (occasionShown(d)?.id === "halloween") continue;
      const running = activityAt(at(d, 16, 40));
      const day = { merged: 16 + 40 / 60 };
      expect(activityAt(at(d, 16, 40), day), d.toDateString()).toEqual(running);
      if (running.id === "beer") {
        covered += 1;
        expect(activityAt(at(d, 17, 0), day).id, d.toDateString()).not.toBe("beer");
      } else {
        expect(activityAt(at(d, 17, 0), day).id, d.toDateString()).toBe("beer");
      }
    }
    expect(covered).toBeGreaterThan(0);
  });

  it("moves the unforced half only for a collision", () => {
    for (const d of weekdays.filter((x) => x.getDay() !== 5)) {
      const [early, late] = evening(d);
      const [first, forcedLate] = evening(d, { merged: MORNING });
      if (first.id !== "beer" || late.id === "beer") continue;
      // Either it kept its pick, or the plain evening's 5:00 had taken its roll.
      if (forcedLate.id !== late.id) expect(early.id, d.toDateString()).toBe(forcedLate.id);
    }
  });

  it("knocks off at 4pm when every account is walled, instead of napping until 5", () => {
    const walled = { walled: true };
    expect(activityAt(at(15, 59), walled).id).toBe("code");
    const early = activityAt(at(16, 0), walled);
    expect(PASTIMES.map((p) => p.id)).toContain(early.id);
    expect([early.from, early.to]).toEqual([16, 16.5]);
    expect(activityAt(at(16, 30), walled).id).not.toBe(early.id);
    expect(msUntilNextChange(at(15, 30), walled)).toBe(30 * 60 * 1000);
    expect(activityAt(at(16, 0)).id).toBe("code");
  });
});

describe("weekends off", () => {
  const sat = (h, m = 0) => new Date(2026, 9, 24, h, m);
  const sun = (h, m = 0) => new Date(2026, 9, 25, h, m);

  it("sleeps in, has brunch, and takes the afternoon off", () => {
    expect(activityAt(sat(8, 59)).id).toBe("sleep");
    const brunch = activityAt(sat(9, 0));
    expect(brunch.id).toBe("eat");
    expect(BRUNCH.map((b) => b.id)).toContain(brunch.dish);
    expect(brunch.label).toMatch(/ for brunch$/);
    expect([brunch.from, brunch.to]).toEqual([9, 11]);
    for (let t = 11; t < 18; t += 0.5) {
      const a = activityAt(sun(Math.floor(t), (t % 1) * 60));
      expect(PASTIMES.map((p) => p.id), `${t}`).toContain(a.id);
      expect([a.from, a.to], `${t}`).toEqual([t, t + 0.5]);
    }
  });

  it("never codes, and never repeats a pastime back to back", () => {
    for (const d of [sat, sun]) {
      let prev = null;
      for (let h = 0; h < 24; h++) {
        for (const m of [0, 30]) {
          const a = activityAt(d(h, m));
          expect(a.id, `${h}:${m}`).not.toBe("code");
          if (a.pastime) expect(a.id, `${h}:${m}`).not.toBe(prev);
          prev = a.pastime ? a.id : null;
        }
      }
    }
  });
});

describe("meals", () => {
  it("serves one dish for the whole meal, and names it", () => {
    const lunch = activityAt(at(12, 0));
    expect(activityAt(at(12, 59))).toEqual(lunch);
    expect([lunch.id, lunch.from, lunch.to]).toEqual(["eat", 12, 13]);
    expect(lunch.label).toBe(`having ${MEALS.find((m) => m.id === lunch.dish).label} for lunch`);
    expect(activityAt(at(18, 30)).label).toMatch(/^having .+ for dinner$/);
  });

  it("never serves dinner what was for lunch, and puts every dish of the season on the menu", () => {
    const seen = new Set();
    days(12, 0).filter((d) => d.getDay() % 6).forEach((d, n) => {
      const lunch = activityAt(d).dish;
      const dinner = activityAt(new Date(d.getTime() + 6 * 3600_000)).dish;
      expect(lunch, `day ${n}`).not.toBe(dinner);
      seen.add(lunch).add(dinner);
    });
    expect([...seen].sort()).toEqual(MEALS.filter((m) => !m.seasons || m.seasons.includes("winter")).map((m) => m.id).sort());
  });

  it("serves soup only in winter", () => {
    const dishes = (month) => new Set(Array.from({ length: 28 }, (_, n) => activityAt(new Date(2026, month, 1 + n, 18)).dish));
    expect(dishes(0).has("soup")).toBe(true);
    for (const month of [4, 6, 9]) expect(dishes(month).has("soup"), `month ${month}`).toBe(false);
  });

  it("ends dinner on a dessert in summer and Halloween week: the last half hour", () => {
    const main = activityAt(new Date(2026, 6, 15, 18, 10));
    expect([main.from, main.to]).toEqual([18, 18.5]);
    const dessert = activityAt(new Date(2026, 6, 15, 18, 30));
    expect([dessert.dish, dessert.label, dessert.from, dessert.to]).toEqual(["icecream", "having ice cream for dessert", 18.5, 19]);
    expect(activityAt(new Date(2026, 9, 28, 18, 45)).dish).toBe("pie");
    expect(msUntilNextChange(new Date(2026, 6, 15, 18, 10))).toBe(20 * 60 * 1000);
    expect(activityAt(at(18, 45)).to).toBe(19); // an ordinary autumn dinner is the whole hour
  });

  it("roasts for the year-end dinner", () => {
    expect(activityAt(new Date(2026, 11, 19, 18, 15)).label).toBe("having a roast for dinner");
  });
});

describe("upNext", () => {
  it("names the next change for the hover", () => {
    const next = upNext(at(12, 10));
    expect(next.at).toEqual(at(13, 0));
    expect(next.activity.label).toBe("coding");
  });
  it("skips past more of the same: a night's sleep announces the morning", () => {
    const next = upNext(at(23, 0));
    expect(next.at).toEqual(new Date(2026, 9, 22, 7));
    expect(next.activity.id).toBe("coffee");
    expect(upNext(new Date(2026, 9, 23, 23)).activity.label).toMatch(/ for brunch$/);
  });
  it("doesn't announce the coding already under way when only the mug goes", () => {
    expect(upNext(at(7, 30))).toMatchObject({ at: at(9, 0), label: "coding with a coffee" });
    expect(upNext(at(9, 10))).toMatchObject({ at: at(12, 0), label: activityAt(at(12, 0)).label });
  });
  it("says what the hover would: a walled coding window is the nap, and nap to nap is no change", () => {
    const walled = { walled: true };
    const said = (a) => (a.id === "code" && walled.walled ? "napping at the desk" : a.label);
    expect(upNext(at(12, 10), walled, said)).toMatchObject({ at: at(13, 0), label: "napping at the desk" });
    expect(upNext(at(7, 30), walled, said)).toMatchObject({ at: at(9, 0), label: "napping at the desk" });
    expect(upNext(at(9, 10), walled, said).at).toEqual(at(12, 0));
  });
});

describe("the day log", () => {
  it("keys on the local date and minute, and only counts today", () => {
    expect(dayKey(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05");
    expect(noteKey(new Date(2026, 0, 5, 9, 7))).toBe("2026-01-05T09:07");
    const log = { merged: "2026-10-21T17:45", furious: "2026-10-20T11:00" };
    expect(dayFlags(log, at(17))).toEqual({ merged: 17.75, furious: null });
    expect(dayFlags({}, at(17))).toEqual({ merged: null, furious: null });
  });
});

describe("sprite", () => {
  it("keeps the banner mascot's shape: 12-wide body, 16-wide arms, 4 legs per frame", () => {
    expect(gridCells([BODY[0]])).toHaveLength(12);
    expect(gridCells([BODY[2]])).toHaveLength(16);
    for (const frame of LEGS) expect(gridCells([frame])).toHaveLength(4);
  });
  it("maps grid cells to coordinates", () => {
    expect(gridCells(["#.", ".#"])).toEqual([{ x: 0, y: 0 }, { x: 1, y: 1 }]);
  });
});

describe("seasonAt", () => {
  // Astronomical, like the standup bot: the season turns on the local day of
  // the equinox / solstice. Dates sit two days off each boundary so the test
  // doesn't depend on the machine's time zone.
  it("turns on the equinoxes and solstices", () => {
    const d = (m, day) => seasonAt(new Date(2026, m - 1, day, 12));
    expect([d(3, 18), d(3, 22)]).toEqual(["winter", "spring"]);
    expect([d(6, 19), d(6, 23)]).toEqual(["spring", "summer"]);
    expect([d(9, 20), d(9, 24)]).toEqual(["summer", "autumn"]);
    expect([d(12, 19), d(12, 23)]).toEqual(["autumn", "winter"]);
    expect(d(1, 15)).toBe("winter");
  });

  it("puts each start within a day of the textbook date", () => {
    const start = (s) => seasonStart(s, 2026);
    expect(start("spring").getUTCMonth()).toBe(2);
    expect(Math.abs(start("spring").getUTCDate() - 20)).toBeLessThanOrEqual(1);
    expect(Math.abs(start("winter").getUTCDate() - 21)).toBeLessThanOrEqual(1);
  });

  it("knows the first day of a season", () => {
    const solstice = seasonStart("winter", 2026);
    const local = new Date(solstice.getFullYear(), solstice.getMonth(), solstice.getDate(), 12);
    expect(isFirstDayOfSeason(local)).toBe(true);
    expect(isFirstDayOfSeason(new Date(local.getTime() + 86400000))).toBe(false);
  });
});

describe("occasionAt", () => {
  const on = (m, day) => occasionAt(new Date(2026, m - 1, day, 12))?.id ?? null;
  it("matches the standup bot's windows, inclusive", () => {
    expect([on(10, 23), on(10, 24), on(10, 31), on(11, 1)]).toEqual([null, "halloween", "halloween", null]);
    expect([on(12, 17), on(12, 18), on(12, 26), on(12, 27)]).toEqual([null, "yearend", "yearend", null]);
  });
  it("wraps the new year across December 31", () => {
    expect([on(12, 30), on(12, 31), on(1, 1), on(1, 2), on(1, 3)]).toEqual([null, "newyear", "newyear", "newyear", null]);
  });
});

describe("headlines and labels", () => {
  it("adds the occasion's headline to the hover line", () => {
    expect(headlineAt(new Date(2026, 9, 28, 12))).toMatch(/Halloween/);
    expect(headlineAt(new Date(2026, 6, 10, 12))).toBe(null);
  });
  it("lets the first day of a season outrank an occasion, as the bot does", () => {
    const solstice = seasonStart("winter", 2026); // lands inside the year-end window
    const local = new Date(solstice.getFullYear(), solstice.getMonth(), solstice.getDate(), 12);
    expect(occasionAt(local)?.id).toBe("yearend");
    expect(headlineAt(local)).toMatch(/winter solstice/);
    // The props go too (no Santa hat under a solstice headline), not just the line.
    expect(occasionShown(local)).toBe(null);
    expect(occasionShown(new Date(local.getTime() + 86400000))?.id).toBe("yearend");
  });
  it("turns a Halloween-week evening into trick-or-treating", () => {
    const labels = [17, 17.5].map((t) => activityLabel(activityAt(new Date(2026, 9, 28, 17, (t % 1) * 60))));
    expect(labels.sort()).toEqual(["trick-or-treating", "trick-or-treating with the kids"]);
  });
});

describe("codingMood", () => {
  // Reads the usage pill's own fields: 🔥 `hot` is furious, a projection at
  // or past 100% at reset (the pill's red →) is grumpy. Worst meter wins,
  // across every account.
  const now = 1_800_000_000;
  const meter = (o = {}) => ({ percent: 40, projected_percent: 80, projected_recent: 90, hot: false, ...o });
  const acct = (meters, o = {}) => ({ available: true, fetched_at: now - 60, meters, ...o });

  it("is calm with no usage, an unavailable account, or every meter on pace", () => {
    expect(codingMood(null, now).mood).toBe("calm");
    expect(codingMood({ default: { available: false } }, now).mood).toBe("calm");
    expect(codingMood({ default: acct({ week_all: meter() }) }, now).mood).toBe("calm");
  });

  it("is grumpy when a meter is on track to hit its limit by either projection", () => {
    expect(codingMood({ default: acct({ week_all: meter({ projected_percent: 104 }) }) }, now).mood).toBe("grumpy");
    expect(codingMood({ default: acct({ session: meter({ projected_recent: 130 }) }) }, now))
      .toEqual({ mood: "grumpy", account: "default", meter: "session", atLimit: false });
  });

  it("is furious when a meter burns hot, over a grumpy one", () => {
    const plan = { default: acct({ session: meter({ projected_recent: 130 }), week_all: meter({ hot: true }) }) };
    expect(codingMood(plan, now)).toEqual({ mood: "furious", account: "default", meter: "week_all", atLimit: false });
  });

  it("keeps an earlier furious meter over a later grumpy one", () => {
    // The order production hits: the server emits session before week_all.
    const one = { default: acct({ session: meter({ hot: true }), week_all: meter({ projected_percent: 120 }) }) };
    expect(codingMood(one, now)).toMatchObject({ mood: "furious", meter: "session" });
    const two = { default: acct({ week_all: meter({ hot: true }) }), b: acct({ session: meter({ projected_recent: 130 }) }) };
    expect(codingMood(two, now)).toMatchObject({ mood: "furious", account: "default", meter: "week_all" });
  });

  it("turns grumpy exactly at a 100% projection, as the pill turns red", () => {
    expect(codingMood({ default: acct({ week_all: meter({ projected_percent: 100, projected_recent: 50 }) }) }, now).mood).toBe("grumpy");
    expect(codingMood({ default: acct({ week_all: meter({ projected_percent: 99, projected_recent: 99 }) }) }, now).mood).toBe("calm");
  });

  it("knows a meter that has already hit its limit", () => {
    const plan = { default: acct({ week_all: meter({ percent: 100, projected_percent: 175, projected_recent: null }) }) };
    expect(codingMood(plan, now)).toEqual({ mood: "grumpy", account: "default", meter: "week_all", atLimit: true });
  });

  it("takes the worst meter across every account", () => {
    const plan = { default: acct({ week_all: meter() }), b: acct({ week_all: meter({ hot: true }) }) };
    expect(codingMood(plan, now)).toEqual({ mood: "furious", account: "b", meter: "week_all", atLimit: false });
  });

  it("ignores a stale account rather than guess", () => {
    const plan = { b: acct({ week_all: meter({ hot: true }) }, { fetched_at: now - 3600 }) };
    expect(codingMood(plan, now).mood).toBe("calm");
  });
});

describe("mood labels", () => {
  const code = SCHEDULE.find((s) => s.id === "code" && !s.coffee);
  const coffee = SCHEDULE.find((s) => s.coffee);
  const run = PASTIMES.find((p) => p.id === "run");

  it("says how Claude is coding", () => {
    expect(activityLabel(code, "furious")).toBe("coding furiously");
    expect(activityLabel(coffee, "grumpy")).toBe("coding grumpily with a coffee");
    expect(activityLabel(code, "calm")).toBe("coding");
    // The adverb follows the verb, whatever the schedule calls it.
    expect(activityLabel({ id: "code", label: "typing with a coffee" }, "furious")).toBe("typing furiously with a coffee");
  });

  it("leaves every other activity alone", () => {
    expect(activityLabel(run, "furious")).toBe(run.label);
  });

  it("names the meter behind the mood, and the account when there are several", () => {
    expect(moodReason({ mood: "furious", account: "default", meter: "week_all" }, null)).toBe("week usage is burning 🔥");
    expect(moodReason({ mood: "grumpy", account: "b", meter: "session" }, "B")).toBe("session usage on account B is on track to hit its limit");
    expect(moodReason({ mood: "calm", account: null, meter: null }, null)).toBe(null);
    expect(moodReason({ mood: "grumpy", account: "default", meter: "week_all", atLimit: true }, null)).toBe("week usage has hit its limit");
  });
});
