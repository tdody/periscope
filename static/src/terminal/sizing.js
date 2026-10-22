// The terminal's sizing rules: the xterm's dims, and what tmux is asked for.
// Pure — no xterm, socket, DOM or module state. terminalCore holds the
// measurements and the per-socket memo, and applies these (docs/invariants.md
// #3 has the incidents behind them).

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

// Pure: the dims to ask tmux for, on a resize or a reconnect — the CONTAINER's
// (the pinned width, the fitted rows), never the xterm's. Those are the pane's,
// a slice of the window on a split, and resize-window applies the hint to the
// whole window: echoing them back shrank a split window on every reconnect.
// Nothing measured yet (a pane only ever shown hidden): 0, no hint at all.
export function hintDims({ pinnedCols, fitRows }) {
  return { cols: pinnedCols, rows: fitRows };
}

// Pure: what a fit must ask tmux for, or null. `container` is the fit's
// hintDims; `sent` the socket's memo of its last ask (afterSend). A width
// change always; a height-only change when the container is now shorter than
// the pane, or to undo a height-only shrink of our own — back up to the
// height asked before it, never past. See scheduleFit for why height-only
// growth is otherwise never sent.
// A height-only ask is `{ rows }` alone, and the server keeps the window's
// width for it (`resize-window -y`). With our pin in it, a shorter viewer's
// shrink also set a shared window's width, reverting a wider or narrower
// viewer's on every change it made. Nor the pane's cols: on a left/right
// split that is a slice of the window, and each ask halved it.
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
// is the height asked before an outstanding height-only shrink of ours: kept
// across further shrinks and partial regrowth, cleared once regrown to it or
// by a width change, which asks for the container's full height anyway.
export function afterSend(sent, ask) {
  const cols = ask.cols ?? sent.cols;
  let shrunkFrom = 0;
  if (cols === sent.cols) {
    if (ask.rows < sent.rows) shrunkFrom = sent.shrunkFrom || sent.rows;
    else if (ask.rows < sent.shrunkFrom) shrunkFrom = sent.shrunkFrom;
  }
  return { cols, rows: ask.rows, shrunkFrom };
}
