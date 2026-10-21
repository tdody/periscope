import { describe, expect, it } from "vitest";
import { activityAt, BODY, gridCells, hourLabel, LEGS, msUntilNextChange, SCHEDULE } from "../tamagotchi.js";

const at = (h, m = 0) => new Date(2026, 9, 21, h, m, 0, 0);

describe("activityAt", () => {
  it("follows the day's schedule at every boundary", () => {
    const cases = [
      [0, 0, "sleep"], [6, 59, "sleep"],
      [7, 0, "coffee"], [8, 59, "coffee"],
      [9, 0, "code"], [11, 59, "code"],
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
