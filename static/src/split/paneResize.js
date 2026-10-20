// Drag-to-resize for the split view's two vertical seams: rail | detail and
// terminal | inspector. Pure pieces live here so they unit-test without a DOM;
// the handle itself is ResizeHandle.jsx.
//
// `def` and `min` mirror the clamp() in styles.css (#split-view): CSS applies
// them on every layout (a window shrink re-clamps without JS), and the drag
// applies them so the stored width is the width you actually saw.

export const PANE_WIDTHS = {
  // dir +1: the column sits LEFT of its seam, so dragging right grows it.
  rail: { pref: "rail_width", cssVar: "--rail-w", columnId: "rail", def: 320, min: 180, dir: 1 },
  // dir -1: the inspector sits RIGHT of its seam, so dragging right shrinks it.
  side: { pref: "side_width", cssVar: "--side-w", columnId: "detail-side", def: 280, min: 200, dir: -1 },
};

// Neither column may take more than this share of its container, so the
// terminal between them can't be dragged shut.
export const MAX_SHARE = 0.5;

export function clampWidth(px, min, max) {
  return Math.round(Math.min(Math.max(px, min), Math.max(min, max)));
}

// The width after dragging `dx` px from a drag that started at `startW`.
export function dragWidth(startW, dx, spec, containerW) {
  return clampWidth(startW + spec.dir * dx, spec.min, containerW * MAX_SHARE);
}

// A stored pref → the px to apply, or null (use the CSS default) for anything
// that isn't a usable number — an absent key or a hand-edited state.json.
export function storedWidth(v) {
  return Number.isFinite(v) && v > 0 ? v : null;
}
