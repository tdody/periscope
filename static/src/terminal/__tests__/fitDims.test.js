import { describe, expect, it } from "vitest";
import { hintDims, pinWidth, resizeNeeded, xtermDims } from "../terminalCore.js";

describe("xtermDims", () => {
  it("keeps rows at the pane's height, not the container's", () => {
    // Regression: a 32-row pane in a split 62-row window. Fitting the xterm
    // to the container left 30 rows tmux never repaints, holding a frozen
    // older copy of the screen under the live one.
    expect(xtermDims(239, 32, 239, 62)).toEqual({ cols: 239, rows: 32 });
  });

  it("caps rows at a container shorter than the pane", () => {
    // Regression: an unsplit 62-row pane, window dragged to 40 rows. The xterm
    // stayed 62 rows in a 40-row box (.detail-xterm is overflow: hidden), so
    // the pane's bottom rows — prompt, input box, cursor — were clipped away.
    expect(xtermDims(239, 62, 239, 40)).toEqual({ cols: 239, rows: 40 });
  });

  it("keeps cols at a narrower pane's width", () => {
    // A left/right split: the pane is half the window periscope sized to the
    // container. The xterm shows the pane; the pin is what tmux is asked for.
    expect(xtermDims(100, 50, 200, 50)).toEqual({ cols: 100, rows: 50 });
  });

  it("caps a pane announced bigger than the container", () => {
    // Another viewer's taller, wider container resized the window: no fit
    // runs here, only the size message, and it goes through this rule too.
    expect(xtermDims(239, 62, 200, 40)).toEqual({ cols: 200, rows: 40 });
  });

  it("takes the container's dims before the server reports a size, and the pane's before a measure", () => {
    expect(xtermDims(0, 0, 120, 40)).toEqual({ cols: 120, rows: 40 });
    expect(xtermDims(200, 50, 0, 0)).toEqual({ cols: 200, rows: 50 });
  });
});

describe("pinWidth", () => {
  it("pins the first width it measures", () => {
    expect(pinWidth(120, 0)).toBe(120);
  });

  it("snaps width wobble back to the pin and re-pins a real resize", () => {
    expect(pinWidth(118, 120)).toBe(120);
    expect(pinWidth(150, 120)).toBe(150);
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

describe("resizeNeeded", () => {
  it("sends a width change", () => {
    expect(resizeNeeded({ cols: 150, rows: 40 }, 120, 40)).toBe(true);
  });

  it("drops height-only growth: a SIGWINCH redraw for rows the pane doesn't need", () => {
    expect(resizeNeeded({ cols: 120, rows: 62 }, 120, 40)).toBe(false);
  });

  it("sends a height-only shrink below the pane, which no longer fits", () => {
    // Unsent, the 62-row pane never shrinks to the 40-row container and the
    // xterm can't show its bottom rows until the next width change.
    expect(resizeNeeded({ cols: 239, rows: 40 }, 239, 62)).toBe(true);
  });

  it("drops a height-only shrink the pane still fits in", () => {
    // A top/bottom split: the pane is a 31-row slice, well inside 40 rows.
    expect(resizeNeeded({ cols: 239, rows: 40 }, 239, 31)).toBe(false);
  });

  it("drops height-only changes before the server has reported the pane", () => {
    expect(resizeNeeded({ cols: 239, rows: 40 }, 239, 0)).toBe(false);
  });
});
