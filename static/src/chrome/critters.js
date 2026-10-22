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
