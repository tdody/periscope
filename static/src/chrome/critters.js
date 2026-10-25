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
// A critter stands taller than Clawd: fit to his 10-unit height, a square-ish
// sprite covers about half his 17-wide body. 12 fits every scene but two
// (13.5 put Jelly's party hat off the top of the scene and the beer friends'
// heads together): under the Halloween sheets,
// cut for Clawd (Tamagotchi.jsx, CritterKid), a critter goes back to Clawd's
// height; at the desk, the duty bubble's tail covers a seated critter's ear
// tips. Everything else a critter wears or holds follows placement(), so it
// all grows with it.
export const CRITTER_HEIGHT = 12;
const FEET = 19;  // the scene's floor line, where standing Clawd's legs end
const SEAT = 17;  // where seated Clawd's body ends, on the chair / armchair seat

// The visible box of the always-drawn layers, in sprite units. Mood layers
// are left out: Jelly's furious sparks sit outside its body, and counting them
// would move the critter sideways whenever its mood changed. With `seated`,
// it's the box without the legs a seated critter hides (`legs`, not
// `keepSeated`) — placement()'s seated bottom.
export function spriteBox(sprite, { seated = false } = {}) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const walk = (n) => {
    if (n.mood) return;
    if (seated && n.legs && !n.keepSeated) return;
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

// Where a critter stands in Clawd's spot: CRITTER_HEIGHT tall (or `height`:
// the kids are half that), centred on Clawd's centre, on the floor line
// standing and on the seat sitting (on the floor line it would sink through
// the chair). `top` is its head, for the props that sit on one (hats, stars,
// the "!").
export function placement(sprite, { x0, sitting, height = CRITTER_HEIGHT }) {
  const box = spriteBox(sprite);
  const scale = height / box.h;
  // Seated, its body ends on the seat as Clawd's does: the legs it hides
  // (`legs`, not `keepSeated`) don't count, at standing's scale.
  const foot = sitting ? (({ y, h }) => y + h)(spriteBox(sprite, { seated: true })) : box.y + box.h;
  const ty = (sitting ? SEAT : FEET) - scale * foot;
  // Rounded like the rest of the module's geometry: an unrounded tx/ty leaks
  // into the critter's own `translate(…)` as e.g. `7.299999999999999`.
  return { scale, tx: r4(x0 + 8.5 - scale * (box.x + box.w / 2)), ty: r4(ty), top: r4(ty + scale * box.y) };
}

const STROKE = 0.75; // sprite units: grows with the critter, ~0.56 scene units at CRITTER_HEIGHT, against Clawd's fixed 0.45
const r4 = (v) => Math.round(v * 1e4) / 1e4;
const stroked = (ink, width = STROKE) => ({ fill: "none", stroke: ink, "stroke-width": width, "stroke-linecap": "square" });

// A striding critter's legs (TamaScene, on the run, the bike, the dog walk):
// its stance (tama-legs-a) and every leg rect two units toward its middle
// (tama-legs-b), swapped by styles.css on the scene's tempo like Clawd's
// tamagotchi.js LEGS. Two units, not Clawd's one: one read too subtle at a
// critter's scale.
export function strideRoot(sprite) {
  const box = spriteBox(sprite);
  const mid = box.x + box.w / 2;
  const step = (n) => (n.r
    ? { ...n, r: [r4(n.r[0] + (n.r[0] + n.r[2] / 2 < mid ? 2 : -2)), ...n.r.slice(1)] }
    : { ...n, g: n.g.map(step) });
  return sprite.root.flatMap((n) => (n.legs ? [{ g: [n], cls: "tama-legs-a" }, { g: [step(n)], cls: "tama-legs-b" }] : [n]));
}

// The faces Critter.jsx draws in place of the eyes (lids shut over them).
// Worried is the one duty face that keeps the eyes, drawing brows over them.
export const EYE_FACES = new Set(["happy", "x", "down"]);

// Inner ends raised, as Clawd's Worried. One eye (Moss) gets a single tent-shaped brow.
function brows(eyes) {
  if (eyes.length === 1) {
    // 0.7 above the eye, not the two-eyed brows' 1.1: Moss's eye fills most of
    // its head, so 1.1 would push the tent's peak above the head row.
    const { x, y, w } = eyes[0];
    return [{ p: `M${r4(x - 0.3)} ${r4(y - 0.7)} l${r4(w / 2 + 0.3)} -0.8 l${r4(w / 2 + 0.3)} 0.8` }];
  }
  const mid = eyes.reduce((s, e) => s + e.x + e.w / 2, 0) / eyes.length;
  return eyes.map(({ x, y, w }) => (x + w / 2 < mid
    ? { p: `M${r4(x - 0.3)} ${r4(y - 1.1)} l${r4(w + 0.4)} -0.8` }
    : { p: `M${r4(x - 0.1)} ${r4(y - 1.9)} l${r4(w + 0.4)} 0.8` }));
}

// The duty faces Critter.jsx draws over a critter's eyes (TamaScene picks one
// with Clawd's rules), as nodes in the sprite tree's own format, in sprite
// units: generated from the eye boxes build_critters.py found
// (`sprite.anchors`), in the critter's `ink`, unless its SVG drew its own
// (`sprite.faces`). Two node fields ride alongside the tree's `r` rects and
// `g` groups, for Critter.jsx to draw the same way: `p` (an SVG path's `d`)
// and `cls` (a CSS class). The worried face's sweat drop is always generated:
// it's the head's, not the eyes'.
export function faceGlyphs(sprite, face) {
  const { eyes, head } = sprite.anchors;
  const ink = sprite.ink;
  const own = sprite.faces?.[face];
  if (face === "worried") {
    const sweat = {
      // A curve, unlike the eyes' and brows' straight strokes: those keep the
      // scene's crispEdges (Tamagotchi.jsx's root svg), which drops the
      // anti-aliasing a drop this small needs, leaving it stair-stepped.
      p: `M${r4(head.right - 0.4)} ${r4(head.top + 1)} q1.2 1.8 0 2.7 q-1.2 -0.9 0 -2.7z`,
      cls: "tama-sweat", a: { fill: "#7fb6e6", "shape-rendering": "geometricPrecision" },
    };
    // 0.6, not the eyes' 0.75: also sprite units, ~0.45 scene units at
    // CRITTER_HEIGHT against Clawd's fixed 0.4 — a touch thinner reads
    // better than the eyes' glyphs.
    return [...(own || [{ g: brows(eyes), a: stroked(ink, 0.6) }]), sweat];
  }
  if (own) return [...own];
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
// Startle sits at his right edge, which floats off any narrower critter. A
// limb that reaches ends at a tip to the right (holdTip, or the bass's fret),
// where the "!" would otherwise land and be swallowed — `reach` moves it to
// the body's left instead, since every reach is to the right. Paws on the
// controller (no reach) sit low and centred, so the "!" stays at its usual spot.
export function startleGlyph(sprite, reach = false) {
  const { head } = sprite.anchors;
  const x = reach ? r4(spriteBox(sprite).x - 1.4) : r4(head.right + 0.4);
  return [{
    cls: "tama-startle", a: { fill: "#f2c14e" },
    g: [{ r: [x, r4(head.top + 0.5), 1, 3] }, { r: [x, r4(head.top + 4.1), 1, 1] }],
  }];
}

// Clawd's hats are drawn for his head: its top centre at (9, 9) with x0 = 0,
// 12 wide (Tamagotchi.jsx's SantaHat/PartyHat, TamaPastimes' Toque/Helmet,
// the snowcap). This maps that head onto a critter's hat seat (anchors.hat,
// declared in its SVG), in sprite units, so a hat sizes to the head and bobs
// with it.
export function hatTransform(sprite) {
  const { cx, top, w } = sprite.anchors.hat;
  return `translate(${cx} ${top}) scale(${r4(w / 12)}) translate(-9 -9)`;
}

// What a critter wears for a pastime, rebuilt around its own eyes and neck:
// Clawd's Goggles and Scarf (TamaPastimes.jsx) sit on his eyes and neck row.
// Nodes in the sprite tree's format, in Clawd's colours and classes.
export function wornGlyphs(sprite, kind) {
  if (kind === "goggles") {
    const { eyes } = sprite.anchors;
    const y = eyes.reduce((s, e) => s + e.y + e.h / 2, 0) / eyes.length;
    const x0 = Math.min(...eyes.map((e) => e.x)) - 2;
    const x1 = Math.max(...eyes.map((e) => e.x + e.w)) + 2;
    const lens = { rx: 1, fill: "#7fd1e6", "fill-opacity": 0.45, stroke: "#2b2f36", "stroke-width": 0.5 };
    return [{
      cls: "tama-goggles",
      g: [
        { r: [r4(x0), r4(y - 0.4), r4(x1 - x0), 0.8], a: { fill: "#2b2f36" } },
        ...eyes.map((e) => ({ r: [r4(e.x - 0.6), r4(e.y - 0.6), r4(e.w + 1.2), r4(e.h + 1.2)], a: lens })),
      ],
    }];
  }
  if (kind === "scarf") {
    const { y, x0, x1 } = sprite.anchors.neck;
    const stripes = [];
    for (let x = x0 + 2; x + 0.7 <= x1; x += 3) stripes.push({ r: [r4(x), y, 0.7, 1.6] });
    return [{
      cls: "tama-scarf",
      g: [
        { r: [x0, y, r4(x1 - x0), 1.6], a: { fill: "#d64541" } },
        { g: stripes, a: { fill: "#f4f4f6" } },
        { r: [r4(x0 - 3), r4(y + 0.3), 3.6, 1.1], cls: "tama-scarf-tail", a: { fill: "#d64541" } },
      ],
    }];
  }
  return [];
}

// A colour's hue turned by `deg` (HSL), for a critter's friend (TamaPastimes.jsx):
// the same creature, another individual, as Clawd's friend is Clawd in blue.
// Computed rather than a CSS filter, which WebKit applies unreliably to SVG
// children. Anything but #rrggbb (none, var(--…)) passes through; greys have
// no hue to turn.
export function hueRotate(color, deg) {
  const m = /^#([0-9a-f]{6})$/i.exec(color || "");
  if (!m) return color;
  const n = Number.parseInt(m[1], 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => v / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  if (d === 0) return color.toLowerCase();
  // HSL's chroma is max-min (`d`) and its lift (`l - c/2`) is just `min` —
  // both fall out of l = (max+min)/2 and c = d algebraically, so skip l.
  const h0 = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  const h = (((h0 * 60 + deg) % 360) + 360) % 360;
  const x = d * (1 - Math.abs(((h / 60) % 2) - 1));
  const [r1, g1, b1] = h < 60 ? [d, x, 0] : h < 120 ? [x, d, 0] : h < 180 ? [0, d, x]
    : h < 240 ? [0, x, d] : h < 300 ? [x, 0, d] : [d, 0, x];
  return `#${[r1, g1, b1].map((v) => Math.round((v + min) * 255).toString(16).padStart(2, "0")).join("")}`;
}

// Where a critter's appendage reaches for each prop it holds (TamaPastimes.jsx
// CritterHeld, Spoon, Dog): `reach` right of its limb's root and `at` down its
// body, a fraction of its sprite box. The reviewed batch-1 draft's numbers.
export const HOLDS = {
  pint: { reach: 2.6, at: 0.42 },
  mug: { reach: 2.2, at: 0.55 },
  spoon: { reach: 2.4, at: 0.55 },
  can: { reach: 2.6, at: 0.45 },
  leash: { reach: 2.4, at: 0.65 },
};

export function holdTip(sprite, prop) {
  const box = spriteBox(sprite);
  const { reach, at } = HOLDS[prop];
  return [r4(sprite.limb.root[0] + reach), r4(box.y + at * box.h)];
}

// The same tip in scene units, for what's drawn outside the critter's wrapper
// (the spoon into the pot, the leash to the dog), through the very placement
// the wrapper uses: handed it rather than recomputing one, so a scene that
// sizes its critter differently moves the hold with it.
export function holdTipInScene(sprite, prop, { scale, tx, ty }) {
  const [x, y] = holdTip(sprite, prop);
  return [r4(tx + scale * x), r4(ty + scale * y)];
}

// A scene point in a critter's sprite units, through the placement its
// wrapper is drawn with (placement's inverse): how a fixed spot on a prop
// drawn in scene units, the fret on Clawd's bass neck, becomes a limb's tip.
export function sceneToSprite({ scale, tx, ty }, [X, Y]) {
  return [r4((X - tx) / scale), r4((Y - ty) / scale)];
}

// A critter's appendage from its limb's root (declared in its SVG) to a prop's
// tip, as sprite nodes in its limb colour:
// - arm: a bar out, a bar up or down to the tip, a hand;
// - tentacle: cells stepped from root to tip, curled at the end;
// - tail: along the floor, up to the tip, hooked over the prop, with Ember's
//   spade when declared, and Nox's outline: a stroked copy under a plain one,
//   as Nox's own tail is drawn — stroking the one group would outline every
//   seam between its parts.
// `tip` overrides the prop's (`holdTip`) for a reach to a fixed spot in the
// scene: the fret on the bass's neck (sceneToSprite). Assumes a tip right of
// its root: the arm and tail bars run x0 → x1, and the tail's riser assumes a
// tip above its root.
export function limbGlyphs(sprite, prop, tip = holdTip(sprite, prop)) {
  const { style, root: [x0, y0], width: t, color, outline, spade } = sprite.limb;
  const [x1, y1] = tip;
  const r = (x, y, w, h) => ({ r: [r4(x), r4(y), r4(w), r4(h)] });
  if (style === "arm") {
    return [{
      a: { fill: color },
      g: [r(x0, y0, x1 - x0, t), r(x1 - t, Math.min(y0, y1), t, Math.abs(y1 - y0) + t), r(x1 - t * 1.1, y1 - t * 0.4, t * 1.4, t)],
    }];
  }
  if (style === "tentacle") {
    const n = Math.max(2, Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) / (0.75 * t)));
    const cells = [];
    for (let i = 0; i <= n; i++) cells.push(r(x0 + ((x1 - x0) * i) / n - 0.45 * t, y0 + ((y1 - y0) * i) / n - 0.45 * t, 0.95 * t, 0.95 * t));
    return [{ a: { fill: color }, g: [...cells, r(x1 + 0.3 * t, y1 - 0.9 * t, 0.8 * t, 0.8 * t)] }];
  }
  const parts = [r(x0, y0, x1 - x0, t), r(x1 - t, y1, t, y0 - y1 + t), r(x1 - t, y1 - t * 0.2, t * 1.6, t)];
  return [
    ...(outline ? [{ a: { fill: color, stroke: outline, "stroke-width": 1 }, g: parts }] : []),
    { a: { fill: color }, g: [...parts, ...(spade ? [r(x1 + 0.4, y1 - 0.9, 1.2, 1.2)] : [])] },
  ];
}

// A sprite's side arms (`arms`, hold-arms in its SVG), each rect with the fill
// it's painted in, nested ones included; mood layers aren't arms.
function armRects(nodes, inArms = false, fill = undefined) {
  return nodes.flatMap((n) => {
    if (n.mood) return [];
    const f = n.a?.fill ?? fill;
    if (n.r) return inArms ? [{ r: n.r, fill: f }] : [];
    return armRects(n.g, inArms || !!n.arms, f);
  });
}

// Whether a critter cheers with its limb: it has no side arms to raise.
export function cheersWithLimb(sprite) {
  return armRects(sprite.root).length === 0;
}

// A critter's arms up when it celebrates at the desk (TamaScene, as Clawd's
// ArmsUp): with side arms, a bar up from each in its own colour, bouncing in
// turn like his (tama-cheer, tama-cheer2); without, its limb waves up beside
// its head. Sprite units, drawn by Critter.
export function cheerGlyphs(sprite) {
  const arms = armRects(sprite.root);
  if (arms.length) {
    return arms.map(({ r: [x, y, w], fill }, i) => ({
      r: [x, r4(y - 4), w, 4], a: { fill }, cls: i ? "tama-cheer tama-cheer2" : "tama-cheer",
    }));
  }
  const box = spriteBox(sprite);
  return [{ cls: "tama-cheer", g: limbGlyphs(sprite, null, [r4(sprite.limb.root[0] + 1.6), r4(box.y + 0.12 * box.h)]) }];
}
