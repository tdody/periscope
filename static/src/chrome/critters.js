// The creatures that can live in the header corner instead of Clawd
// (Settings → Tamagotchi): the pure part, so the list, the fallback and the
// placement unit-test without a DOM. The sprites themselves are generated
// (critterSprites.js, by build_critters.py); Clawd has none — Tamagotchi.jsx
// draws it.

import { SPRITES } from "./critterSprites.js";

export const CRITTERS = [
  { id: "clawd", name: "Clawd", sprite: null },
  ...Object.entries(SPRITES).map(([id, sprite]) => ({ id, name: sprite.name, sprite })),
];

// An id nobody knows (unset, or a critter since removed) is Clawd.
export function critterById(id) {
  return CRITTERS.find((c) => c.id === id) || CRITTERS[0];
}

// Clawd standing, in scene units: body 4 rows × 2 + legs 2.
export const CLAWD_HEIGHT = 10;
const FEET = 19;  // the scene's floor line, where standing Clawd's legs end
const SEAT = 17;  // where seated Clawd's body ends, on the chair / armchair seat

// The visible box of the always-drawn layers, in sprite units. Mood layers
// are left out: Jelly's furious sparks sit outside its body, and counting them
// would move the critter sideways whenever its mood changed.
export function spriteBox(sprite) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const walk = (n) => {
    if (n.mood) return;
    if (n.r) {
      const [x, y, w, h] = n.r;
      x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x + w); y1 = Math.max(y1, y + h);
      return;
    }
    n.g.forEach(walk);
  };
  sprite.root.forEach(walk);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

// Where a critter stands in Clawd's spot: as tall as standing Clawd, centred
// on Clawd's centre, on the floor line standing and on the seat sitting (on
// the floor line it would sink through the chair). `top` is its head, for the
// props that sit on one (hats, stars, the "!").
export function placement(sprite, { x0, sitting }) {
  const box = spriteBox(sprite);
  const scale = CLAWD_HEIGHT / box.h;
  const bottom = sitting ? SEAT : FEET;
  return {
    scale,
    tx: x0 + 8.5 - scale * (box.x + box.w / 2),
    ty: bottom - scale * (box.y + box.h),
    top: bottom - CLAWD_HEIGHT,
  };
}

// The duty faces Critter.jsx draws over a critter's eyes (TamaScene picks one
// with Clawd's rules), as nodes in the sprite tree's own format, in sprite
// units: generated from the eye boxes build_critters.py found
// (`sprite.anchors`), in the critter's `ink`, unless its SVG drew its own
// (`sprite.faces`). The worried face's sweat drop is always generated: it's
// the head's, not the eyes'.
const STROKE = 0.75; // Clawd's 0.45-unit glyph stroke, at a critter's ~0.6 scale
const r4 = (v) => Math.round(v * 1e4) / 1e4;
const stroked = (ink, width = STROKE) => ({ fill: "none", stroke: ink, "stroke-width": width, "stroke-linecap": "square" });

// Inner ends raised, as Clawd's Worried. One eye (Moss) gets a single tent-shaped brow.
function brows(eyes) {
  if (eyes.length === 1) {
    const { x, y, w } = eyes[0];
    return [{ p: `M${r4(x - 0.3)} ${r4(y - 0.7)} l${r4(w / 2 + 0.3)} -0.8 l${r4(w / 2 + 0.3)} 0.8` }];
  }
  const mid = eyes.reduce((s, e) => s + e.x + e.w / 2, 0) / eyes.length;
  return eyes.map(({ x, y, w }) => (x + w / 2 < mid
    ? { p: `M${r4(x - 0.3)} ${r4(y - 1.1)} l${r4(w + 0.4)} -0.8` }
    : { p: `M${r4(x - 0.1)} ${r4(y - 1.9)} l${r4(w + 0.4)} 0.8` }));
}

export function faceGlyphs(sprite, face) {
  const { eyes, head } = sprite.anchors;
  const ink = sprite.ink;
  const own = sprite.faces?.[face];
  if (face === "worried") {
    const sweat = {
      p: `M${r4(head.right - 0.4)} ${r4(head.top + 1)} q1.2 1.8 0 2.7 q-1.2 -0.9 0 -2.7z`,
      cls: "tama-sweat", a: { fill: "#7fb6e6", "shape-rendering": "geometricPrecision" },
    };
    return [...(own || [{ g: brows(eyes), a: stroked(ink, 0.6) }]), sweat];
  }
  if (own) return own;
  if (face === "happy") {
    return [{
      cls: "tama-happy-eyes", a: stroked(ink),
      g: eyes.map(({ x, y, w, h }) => ({ p: `M${x} ${r4(y + 0.75 * h)} l${r4(w / 2)} ${r4(-h / 2)} l${r4(w / 2)} ${r4(h / 2)}` })),
    }];
  }
  if (face === "x") {
    return [{
      a: stroked(ink),
      g: eyes.map(({ x, y, w, h }) => ({
        p: `M${r4(x + 0.1)} ${r4(y + 0.1)} L${r4(x + w - 0.1)} ${r4(y + h - 0.1)} M${r4(x + w - 0.1)} ${r4(y + 0.1)} L${r4(x + 0.1)} ${r4(y + h - 0.1)}`,
      })),
    }];
  }
  if (face === "down") {
    return [{ a: { fill: ink }, g: eyes.map(({ x, y, w, h }) => ({ r: [x, r4(y + 0.45 * h), w, r4(0.55 * h)] })) }];
  }
  return [];
}

// The bell's "!" away from the desk, beside the critter's own head: Clawd's
// Startle sits at his right edge, which floats off any narrower critter.
export function startleGlyph(sprite) {
  const { head } = sprite.anchors;
  const x = r4(head.right + 0.4);
  return [{
    cls: "tama-startle", a: { fill: "#f2c14e" },
    g: [{ r: [x, r4(head.top + 0.5), 1, 3] }, { r: [x, r4(head.top + 4.1), 1, 1] }],
  }];
}
