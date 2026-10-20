import { describe, expect, it } from "vitest";
import { clampWidth, dragWidth, PANE_WIDTHS, storedWidth } from "../paneResize.js";

const { rail, side } = PANE_WIDTHS;

describe("dragWidth", () => {
  it("grows the rail when dragged right", () => {
    expect(dragWidth(320, 40, rail, 1600)).toBe(360);
    expect(dragWidth(320, -40, rail, 1600)).toBe(280);
  });
  it("shrinks the inspector when dragged right — it sits right of its seam", () => {
    expect(dragWidth(280, 40, side, 1200)).toBe(240);
    expect(dragWidth(280, -40, side, 1200)).toBe(320);
  });
  it("stops at the column minimum", () => {
    expect(dragWidth(320, -500, rail, 1600)).toBe(rail.min);
    expect(dragWidth(280, 500, side, 1200)).toBe(side.min);
  });
  it("stops at half the container so the terminal can't be dragged shut", () => {
    expect(dragWidth(320, 2000, rail, 1600)).toBe(800);
    expect(dragWidth(280, -2000, side, 1000)).toBe(500);
  });
  it("rounds to whole px — the server stores an int", () => {
    expect(dragWidth(320.4, 10.3, rail, 1600)).toBe(331);
  });
});

describe("clampWidth", () => {
  it("lets the minimum win when the container is too narrow for it", () => {
    // A 300px container caps at 150, below the 180 minimum: min wins rather
    // than the clamp inverting.
    expect(clampWidth(400, 180, 150)).toBe(180);
  });
});

describe("storedWidth", () => {
  it("passes a stored px through", () => {
    expect(storedWidth(360)).toBe(360);
  });
  it("falls back to the CSS default for absent or junk values", () => {
    expect(storedWidth(undefined)).toBe(null);
    expect(storedWidth(null)).toBe(null);
    expect(storedWidth("wide")).toBe(null);
    expect(storedWidth(0)).toBe(null);
    expect(storedWidth(Number.NaN)).toBe(null);
  });
});
