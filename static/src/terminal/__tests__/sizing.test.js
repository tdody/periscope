import { describe, expect, it } from "vitest";
import { afterSend, hintDims, NOTHING_SENT, pinWidth, resizeAsk, xtermDims } from "../sizing.js";

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

  it("caps a pane announced taller than the container, but not wider", () => {
    // Another viewer's bigger container resized the window: no fit runs here,
    // only the size message, and it goes through this rule too. Rows cap (the
    // clipped part would be the prompt and cursor). Cols don't: an xterm
    // narrower than the pane autowraps the capture and every frame row, a junk
    // line into scrollback per frame (a pane mounted hidden, in transcript
    // mode, at a 200-col window under a 150-col pin); right-clipped it stays
    // coherent until the pane comes back to the container's width.
    expect(xtermDims(239, 62, 200, 40)).toEqual({ cols: 239, rows: 40 });
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

  it("sends no hint before a fit has measured the container, never the xterm's dims", () => {
    // Regression: a left/right split viewed only in transcript mode since page
    // load — nothing measured, the xterm at the pane's 100 cols. Hinted on a
    // reconnect, those resized the 200-col window to 100, then 50 on the next.
    // 0 makes connectTerminalWs omit the hint, and tmux's view stands.
    expect(hintDims({ pinnedCols: 0, fitRows: 0, termCols: 100, termRows: 32 })).toEqual({ cols: 0, rows: 0 });
  });
});

describe("resizeAsk", () => {
  const sent = (cols, rows, shrunkFrom = 0) => ({ cols, rows, shrunkFrom });

  it("sends a width change", () => {
    expect(resizeAsk({ cols: 150, rows: 40 }, sent(120, 40), 40)).toEqual({ cols: 150, rows: 40 });
  });

  it("drops height-only growth: a SIGWINCH redraw for rows the pane doesn't need", () => {
    expect(resizeAsk({ cols: 120, rows: 62 }, sent(120, 40), 40)).toBe(null);
  });

  it("sends a height-only shrink below the pane, which no longer fits", () => {
    // Unsent, the 62-row pane never shrinks to the 40-row container and the
    // xterm can't show its bottom rows until the next width change. Rows only:
    // the width isn't what changed (see the two-viewer case below).
    expect(resizeAsk({ cols: 239, rows: 40 }, sent(239, 62), 62)).toStrictEqual({ rows: 40 });
  });

  it("sends a pane announced taller than the container back down to it", () => {
    // The rule the size handler applies (its call site: terminalCore.test.js).
    // A 40-row window split to 20, the container then shrunk to 30 (the pane
    // still fit: nothing sent). A sibling closed (or a zoom) and the pane is
    // all 40: the xterm capped at 30, every row past it painted onto the
    // last, the prompt hidden. Asked back to 30 — a shrink of ours below the
    // 40 asked before, regrown if the container is.
    expect(resizeAsk({ cols: 100, rows: 30 }, sent(100, 40), 40)).toStrictEqual({ rows: 30 });
    expect(afterSend(sent(100, 40), { rows: 30 })).toEqual({ cols: 100, rows: 30, shrunkFrom: 40 });
  });

  it("drops a height-only shrink the pane still fits in", () => {
    // A top/bottom split: the pane is a 31-row slice, well inside 40 rows.
    expect(resizeAsk({ cols: 239, rows: 40 }, sent(239, 62), 31)).toBe(null);
  });

  it("drops height-only changes before the server has reported the pane", () => {
    expect(resizeAsk({ cols: 239, rows: 40 }, sent(239, 62), 0)).toBe(null);
  });

  it("undoes its own height-only shrink when the container grows back", () => {
    // Regression: an unsplit 239x62 pane, the window shortened to 40 rows and
    // restored. The shrink went to tmux; the restore didn't (height-only
    // growth), so the pane stayed 40 rows — a blank band under Claude's TUI,
    // for every viewer, until the next width change.
    let memo = afterSend(sent(0, 0), { cols: 239, rows: 62 }); // the connect hint
    let paneRows = 62;
    const fitTo = (rows) => {
      const ask = resizeAsk({ cols: 239, rows }, memo, paneRows);
      if (ask) {
        memo = afterSend(memo, ask);
        paneRows = ask.rows; // unsplit: the pane is the window tmux was sized to
      }
      return ask;
    };
    expect(fitTo(40)).toStrictEqual({ rows: 40 });
    expect(fitTo(50)).toStrictEqual({ rows: 50 });
    expect(fitTo(62)).toStrictEqual({ rows: 62 });
    // Back where it was asked to be: further growth is plain height-only
    // growth again, never sent.
    expect(fitTo(70)).toBe(null);
  });

  it("regrows no further than the height it had asked for before shrinking", () => {
    const memo = afterSend(sent(239, 62), { cols: 239, rows: 40 });
    expect(resizeAsk({ cols: 239, rows: 80 }, memo, 40)).toStrictEqual({ rows: 62 });
  });

  it("never regrows a pane another viewer shrank", () => {
    // Two viewers: ours 62 rows, theirs 40. Their shrink isn't ours to undo
    // — regrowing it would make them shrink it again, and on.
    expect(resizeAsk({ cols: 239, rows: 62 }, sent(239, 62), 40)).toBe(null);
  });

  it("never sets a shared window's width with a height-only ask", () => {
    // Regression: one pane, two viewers — A's box 143x36, B's 230x22 (the
    // Tauri app and a browser tab). B's shrink to its height carried B's
    // pinned width, so each time A widened its box B shrank the window back
    // AND reset it to 230 cols: A right-clipped, two resize-windows (one a
    // width reflow) per change, and A never got its width. Height-only asks
    // are rows only, and the server keeps the window's width for them.
    const win = { cols: 0, rows: 0 };
    const A = { box: { cols: 143, rows: 36 }, memo: NOTHING_SENT };
    const B = { box: { cols: 230, rows: 22 }, memo: NOTHING_SENT };
    const send = (v, ask) => {
      v.memo = afterSend(v.memo, ask);
      win.cols = ask.cols ?? win.cols; // resize-window -y alone keeps it
      win.rows = ask.rows;
    };
    // Every resize is announced to both, and each runs its fit (unsplit: the
    // pane is the window).
    const settle = () => {
      for (let i = 0; i < 4; i++) {
        for (const v of [A, B]) {
          const ask = resizeAsk(v.box, v.memo, win.rows);
          if (ask) send(v, ask);
        }
      }
    };
    send(A, A.box); // the connect hints: the last to connect sets the width
    send(B, B.box);
    settle();
    expect(win).toEqual({ cols: 230, rows: 22 });
    A.box = { cols: 200, rows: 36 };
    settle();
    expect(win).toEqual({ cols: 200, rows: 22 });
  });

  it("keeps a split window's width through its own shrink and regrow", () => {
    // A left/right split: the pane is 71 of the window's 143 cols. Asking
    // for the pane's width instead of none halved the window on each ask.
    let memo = afterSend(NOTHING_SENT, { cols: 143, rows: 36 });
    for (const [rows, paneRows] of [[28, 36], [36, 28]]) {
      const ask = resizeAsk({ cols: 143, rows }, memo, paneRows);
      expect(ask).toStrictEqual({ rows });
      memo = afterSend(memo, ask);
    }
    expect(memo).toEqual({ cols: 143, rows: 36, shrunkFrom: 0 });
  });

  it("forgets the shrink once a width change resizes to the container", () => {
    const shrunk = afterSend(sent(239, 62), { cols: 239, rows: 40 });
    const widened = afterSend(shrunk, { cols: 200, rows: 40 });
    expect(resizeAsk({ cols: 200, rows: 62 }, widened, 40)).toBe(null);
  });
});
