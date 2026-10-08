import { describe, expect, it } from "vitest";
import { fitDims } from "../terminalCore.js";

describe("fitDims", () => {
  it("keeps rows at the pane's height, not the container's", () => {
    // Regression: a 32-row pane in a split 62-row window. Fitting the xterm
    // to the container left 30 rows tmux never repaints, holding a frozen
    // older copy of the screen under the live one.
    expect(fitDims(239, 62, 239, 32)).toEqual({ cols: 239, rows: 32, pinnedCols: 239 });
  });

  it("falls back to the container's rows before the server reports a size", () => {
    expect(fitDims(120, 40, 0, 0)).toEqual({ cols: 120, rows: 40, pinnedCols: 0 });
  });

  it("snaps width wobble back to the pin and re-pins a real resize", () => {
    expect(fitDims(118, 40, 120, 40).cols).toBe(120);
    expect(fitDims(150, 40, 120, 40)).toEqual({ cols: 150, rows: 40, pinnedCols: 150 });
  });
});
