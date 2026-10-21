import { describe, expect, it } from "vitest";
import {
  activityAt, activityLabel, BODY, gridCells, headlineAt, hourLabel, isFirstDayOfSeason, LEGS,
  msUntilNextChange, occasionAt, SCHEDULE, seasonAt, seasonStart,
} from "../tamagotchi.js";

const at = (h, m = 0) => new Date(2026, 9, 21, h, m, 0, 0);

describe("activityAt", () => {
  it("follows the day's schedule at every boundary", () => {
    const cases = [
      [0, 0, "sleep"], [6, 59, "sleep"],
      [7, 0, "coffee"], [8, 59, "coffee"],
      [9, 0, "code"], [9, 59, "code"], [10, 0, "code"], [11, 59, "code"],
      [12, 0, "eat"], [12, 59, "eat"],
      [13, 0, "code"], [16, 59, "code"],
      [17, 0, "run"], [17, 59, "run"],
      [18, 0, "eat"], [18, 59, "eat"],
      [19, 0, "read"], [20, 59, "read"],
      [21, 0, "sleep"], [23, 59, "sleep"],
    ];
    for (const [h, m, id] of cases) expect(activityAt(at(h, m)).id, `${h}:${m}`).toBe(id);
  });

  it("covers all 24 hours with no gap or overlap", () => {
    for (let h = 0; h < 24; h++) {
      expect(SCHEDULE.filter((s) => h >= s.from && h < s.to)).toHaveLength(1);
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
    expect(msUntilNextChange(at(17, 0))).toBe(60 * 60 * 1000);
  });
  it("rolls past midnight for the late sleep window", () => {
    expect(msUntilNextChange(at(23, 0))).toBe(60 * 60 * 1000);
  });
});

describe("hourLabel", () => {
  it("reads like a clock", () => {
    expect([0, 7, 12, 13, 21, 24].map(hourLabel)).toEqual(["midnight", "7am", "noon", "1pm", "9pm", "midnight"]);
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
  });
  it("turns a Halloween-week run into trick-or-treating", () => {
    const run = SCHEDULE.find((s) => s.id === "run");
    expect(activityLabel(run, { id: "halloween" })).toBe("trick-or-treating");
    expect(activityLabel(run, null)).toBe(run.label);
  });
});
