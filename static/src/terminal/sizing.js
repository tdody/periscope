// The terminal's sizing rules: the xterm's dims, and what tmux is asked for.
// Pure — no xterm, socket, DOM or module state. terminalCore holds the
// measurements and the memo of what the mount last asked, and applies these
// (docs/invariants.md #3 has the incidents behind them).

export const NOTHING_SENT = { cols: 0, rows: 0, shrunkFrom: 0 };

const WIDTH_PIN_TOLERANCE = 4;   // cols; absorbs scrollbar/rounding wobble, not a real resize

// The pane's rows once the server has reported them, capped at the
// container's: an xterm taller than its box is clipped (`.detail-xterm` is
// overflow: hidden), and what's clipped is the pane's bottom — prompt, input
// box, cursor.
const capped = (pane, container) => (pane > 0 && container > 0 ? Math.min(pane, container) : pane || container);

// Pure: the width to pin for a measured container width. Wobble within
// tolerance snaps back to the pin; beyond it, or with nothing pinned yet, the
// measured width is the new pin.
export function pinWidth(measuredCols, pinned) {
  return pinned > 0 && Math.abs(measuredCols - pinned) <= WIDTH_PIN_TOLERANCE ? pinned : measuredCols;
}

// Pure: the xterm's dims — the pane's once the server has reported them, rows
// capped at the container's; the container's until then. 0 = not known yet.
// Cols are never capped: a pane wider than the container (our resize not yet
// landed, a wider viewer's, a hidden mount that couldn't measure) in a
// narrower xterm autowraps the capture and every frame row, pushing a junk
// line into scrollback per frame. Right-clipped, it stays coherent.
// The one sizing rule: the mount, every fit and every size message go through
// it (syncXtermSize).
export function xtermDims(knownPaneCols, knownPaneRows, containerCols, containerRows) {
  return { cols: knownPaneCols || containerCols, rows: capped(knownPaneRows, containerRows) };
}

// Pure: what a fit must ask tmux for, or null. `container` is the measured
// container (the pinned width, the fitted rows); `sent` the memo of what this
// mount last asked (afterSend: kept across reconnects, reset by
// stopLiveTerminal); `knownPaneRows` the pane's height from the last size
// message, 0 before one.
// A width change is always asked. A height-only change is not: it reflows
// nothing, but resize-window still raises SIGWINCH, and Claude's TUI redraws
// its frame on each one, which mangles scrollback (the failure class of the
// width reflows routes/ws.py avoids). A dropped growth costs blank rows under
// the pane until the next width change — blank because the xterm keeps the
// pane's height (xtermDims); grown to the container, they showed a stale copy
// of the screen. Comparing with the memo also drops the no-op ask the
// ResizeObserver's first fire would make after the connect hint. Two
// height-only changes are asked:
//   - A shrink below the pane, whether the container shrank or a size message
//     announced the pane taller than it (a sibling closed, a zoom, a taller
//     viewer's resize): the pane no longer fits. Capped at the container, its
//     rows past the last all paint onto it, hiding the prompt; uncapped, the
//     box clipped the prompt and cursor away. One redraw is the lesser cost.
//     (A splitter drag asks once, on release: holdTerminalFit.)
//   - The growth that undoes a shrink of ours (any ask below the height asked
//     before it, a width change's included), back to that height and no
//     further: the window is `window-size manual`, so nothing else regrows
//     it, and it kept a blank band under the pane for every viewer. It asks for our height, not the window's: the server sizes a
//     shared window to its shortest viewer's ask (routes/ws.py
//     _WindowHeights), so it never undoes a shorter viewer's shrink.
// A height-only ask is `{ rows }` alone, and the server keeps the window's
// width for it (`resize-window -y`). With our pin in it, a shorter viewer's
// shrink also set a shared window's width, reverting a wider or narrower
// viewer's on every change it made. Never the xterm's dims either: they are
// the pane's, and on a left/right split the pane is a slice of the window, so
// each ask halved it.
export function resizeAsk(container, sent, knownPaneRows) {
  if (container.cols !== sent.cols) return container;
  if (knownPaneRows > 0 && container.rows < knownPaneRows) return { rows: container.rows };
  if (sent.shrunkFrom > 0 && container.rows > sent.rows) {
    return { rows: Math.min(container.rows, sent.shrunkFrom) };
  }
  return null;
}

// Pure: the memo after sending `ask` (or hinting it at connect, from
// NOTHING_SENT). A rows-only ask keeps the width last asked for. `shrunkFrom`
// is the height asked before an outstanding shrink of ours: kept across
// further shrinks, partial regrowth and width changes, cleared once an ask
// reaches it. A width ask carries the container's current rows, so one made
// while shrunk is itself short: clearing the shrink there left the window
// short once the container grew back.
export function afterSend(sent, ask) {
  const before = sent.shrunkFrom || sent.rows;
  return { cols: ask.cols ?? sent.cols, rows: ask.rows, shrunkFrom: ask.rows < before ? before : 0 };
}
