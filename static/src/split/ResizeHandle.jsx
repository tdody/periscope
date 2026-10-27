// A draggable vertical seam between two split-view columns. `which` is a key
// of PANE_WIDTHS. The handle is absolutely positioned on the seam (.col-resize
// in styles.css) so it takes no grid cell; its parent is the grid whose
// column it resizes.
//
// Widths go onto #split-view as CSS vars straight from pointermove — no
// signal write per move, because a Split re-render re-renders the whole rail
// and detail. The pref is written once, on release, and Split's effect then
// re-applies the same value from prefs.
//
// The terminal fit is held for the drag (terminalCore.holdTerminalFit): both
// seams change the terminal's width, and a fit per move would resize tmux all
// the way through.

import { setPaneWidth } from "../prefs.js";
import { holdTerminalFit, releaseTerminalFit } from "../terminal/terminalCore.js";
import { dragWidth, PANE_WIDTHS } from "./paneResize.js";

export function ResizeHandle({ which }) {
  const spec = PANE_WIDTHS[which];

  function onPointerDown(e) {
    if (e.button !== 0) return;
    const handle = e.currentTarget;
    const root = document.getElementById("split-view");
    const column = document.getElementById(spec.columnId);
    const container = handle.parentElement;
    if (!root || !column || !container) return;
    e.preventDefault();
    // Measured, not read from prefs: a stored width the CSS clamp overrides
    // (window narrower than when it was set) would otherwise jump on grab.
    const startX = e.clientX;
    const startW = Math.round(column.getBoundingClientRect().width);
    const containerW = container.getBoundingClientRect().width;
    let width = startW;
    // Capture keeps the moves coming while the pointer crosses an iframe
    // (HTML previews), which would otherwise swallow them.
    handle.setPointerCapture(e.pointerId);
    handle.classList.add("dragging");
    document.body.classList.add("col-resizing");
    holdTerminalFit();
    const onMove = (ev) => {
      width = dragWidth(startW, ev.clientX - startX, spec, containerW);
      root.style.setProperty(spec.cssVar, `${width}px`);
    };
    const onUp = () => {
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
      handle.removeEventListener("pointercancel", onUp);
      handle.classList.remove("dragging");
      document.body.classList.remove("col-resizing");
      releaseTerminalFit();
      if (width !== startW) setPaneWidth(spec.pref, width);
    };
    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
    handle.addEventListener("pointercancel", onUp);
  }

  // Deliberately not a focusable role="separator": a handle that takes focus
  // on grab blurs the terminal, and you'd click back in after every resize.
  return (
    <div
      class={`col-resize col-resize-${which}`}
      title="Drag to resize · double-click to reset"
      onPointerDown={onPointerDown}
      onDblClick={() => setPaneWidth(spec.pref, spec.def)}
    />
  );
}
