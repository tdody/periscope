import { describe, expect, it } from "vitest";
import { fitDims, hintDims } from "../terminalCore.js";

describe("fitDims", () => {
  it("keeps rows at the pane's height, not the container's", () => {
    // Regression: a 32-row pane in a split 62-row window. Fitting the xterm
    // to the container left 30 rows tmux never repaints, holding a frozen
    // older copy of the screen under the live one.
    expect(fitDims(239, 62, 239, 239, 32)).toEqual({ cols: 239, rows: 32, pinnedCols: 239 });
  });

  it("keeps cols at a narrower pane's width, and the pin at the container's", () => {
    // A left/right split: the pane is half the window periscope sized to the
    // container. The xterm shows the pane; the pin is what tmux is asked for.
    expect(fitDims(200, 50, 200, 100, 50)).toEqual({ cols: 100, rows: 50, pinnedCols: 200 });
  });

  it("falls back to the container's rows before the server reports a size", () => {
    expect(fitDims(120, 40, 0, 0, 0)).toEqual({ cols: 120, rows: 40, pinnedCols: 0 });
  });

  it("snaps width wobble back to the pin and re-pins a real resize", () => {
    expect(fitDims(118, 40, 120, 0, 40).cols).toBe(120);
    expect(fitDims(150, 40, 120, 0, 40)).toEqual({ cols: 150, rows: 40, pinnedCols: 150 });
  });
});

describe("hintDims", () => {
  it("asks tmux for the container, not the pane the xterm shows", () => {
    // Regression: on a split window the xterm holds the pane's dims, a slice
    // of the window. Echoed back as the reconnect hint they resize the WINDOW
    // to the pane's size, so it shrank on every retry (200 → 100 → 50 cols
    // on a left/right split).
    expect(hintDims({ pinnedCols: 200, fitRows: 62, termCols: 100, termRows: 32 })).toEqual({ cols: 200, rows: 62 });
  });

  it("falls back to the xterm's dims before a fit has measured the container", () => {
    expect(hintDims({ pinnedCols: 0, fitRows: 0, termCols: 80, termRows: 24 })).toEqual({ cols: 80, rows: 24 });
  });
});
