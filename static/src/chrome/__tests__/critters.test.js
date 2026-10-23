import { afterEach, describe, expect, it } from "vitest";
import { getTamaCritter, prefsSignal } from "../../prefs.js";
import {
  CLAWD_HEIGHT,
  CRITTERS,
  EYE_FACES,
  HOLDS,
  critterById,
  faceGlyphs,
  hatTransform,
  holdTip,
  holdTipInScene,
  hueRotate,
  limbGlyphs,
  placement,
  spriteBox,
  startleGlyph,
  wornGlyphs,
} from "../critters.js";

const sprites = CRITTERS.filter((c) => c.sprite);

// Every group in a sprite tree, depth first.
function groups(nodes, out = []) {
  for (const n of nodes) {
    if (n.g) { out.push(n); groups(n.g, out); }
  }
  return out;
}

describe("CRITTERS", () => {
  it("is Clawd first, then the seven, each id once", () => {
    expect(CRITTERS.map((c) => c.id)).toEqual(["clawd", "scope", "jelly", "nox", "ember", "volt", "moss", "octocat"]);
  });

  it("leaves Clawd without a sprite: Tamagotchi.jsx draws it", () => {
    expect(critterById("clawd").sprite).toBeNull();
  });

  it.each(sprites.map((c) => [c.id, c]))("%s has all three moods and eyes that can shut", (_id, c) => {
    const gs = groups(c.sprite.root);
    for (const mood of ["calm", "grumpy", "furious"]) expect(gs.some((g) => g.mood === mood), mood).toBe(true);
    const shutters = gs.filter((g) => g.role === "eye" || g.role === "lid");
    expect(shutters.length).toBeGreaterThan(0);
    for (const g of shutters) expect(g.shut).toHaveLength(4);
  });
});

describe("critterById", () => {
  it("finds a critter by id", () => {
    expect(critterById("jelly").name).toBe("Jelly");
  });

  it("falls back to Clawd for an unset or unknown id", () => {
    expect(critterById(undefined).id).toBe("clawd");
    expect(critterById("dragon").id).toBe("clawd");
  });
});

describe("spriteBox", () => {
  it("measures the always-drawn layers", () => {
    expect(spriteBox(critterById("jelly").sprite)).toEqual({ x: 4, y: 3, w: 12, h: 15 });
  });

  it("ignores mood layers, so a mood never moves the critter", () => {
    const sprite = { root: [{ r: [5, 5, 10, 10] }, { g: [{ r: [0, 0, 1, 1] }], mood: "furious" }] };
    expect(spriteBox(sprite)).toEqual({ x: 5, y: 5, w: 10, h: 10 });
  });
});

describe("placement", () => {
  const bottomOf = (p, box) => p.ty + p.scale * (box.y + box.h);
  const centreOf = (p, box) => p.tx + p.scale * (box.x + box.w / 2);

  it.each(sprites.map((c) => [c.id, c.sprite]))("stands %s as tall as Clawd, on Clawd's spot", (_id, sprite) => {
    const box = spriteBox(sprite);
    const p = placement(sprite, { x0: 8, sitting: false });
    expect(p.scale * box.h).toBeCloseTo(CLAWD_HEIGHT);
    expect(bottomOf(p, box)).toBeCloseTo(19);
    expect(centreOf(p, box)).toBeCloseTo(16.5);
    expect(p.top).toBe(9);
  });

  it("seats a sitting critter on the seat, not through it", () => {
    const sprite = critterById("nox").sprite;
    const box = spriteBox(sprite);
    const p = placement(sprite, { x0: 3, sitting: true });
    expect(bottomOf(p, box)).toBeCloseTo(17);
    expect(centreOf(p, box)).toBeCloseTo(11.5);
    expect(p.top).toBe(7);
  });
});

describe("getTamaCritter", () => {
  const withUI = (ui) => { prefsSignal.value = { ...prefsSignal.value, loaded: true, ui }; };
  afterEach(() => withUI({}));

  it("is Clawd until one is picked", () => {
    withUI({});
    expect(getTamaCritter()).toBe("clawd");
  });

  it("returns the picked critter", () => {
    withUI({ tama_critter: "moss" });
    expect(getTamaCritter()).toBe("moss");
  });

  it("falls back to Clawd for an id it doesn't know", () => {
    withUI({ tama_critter: "dragon" });
    expect(getTamaCritter()).toBe("clawd");
  });
});

describe("anchors", () => {
  it.each(sprites.map((c) => [c.id, c.sprite]))("%s's head anchor is its sprite box's top-right", (_id, sprite) => {
    const box = spriteBox(sprite);
    expect(sprite.anchors.head.top).toBeCloseTo(box.y);
    expect(sprite.anchors.head.right).toBeCloseTo(box.x + box.w);
    expect(sprite.anchors.eyes.length).toBeGreaterThan(0);
    expect(sprite.ink).toMatch(/^#[0-9a-f]{6}$/i);
  });
});

describe("faceGlyphs", () => {
  const scope = critterById("scope").sprite;
  const moss = critterById("moss").sprite;
  const nox = critterById("nox").sprite;
  const nums = (p) => p.match(/-?[\d.]+/g).map(Number);

  it("draws one glyph per eye, in the critter's ink", () => {
    for (const face of ["happy", "x", "down"]) {
      const [group] = faceGlyphs(scope, face);
      expect(group.g, face).toHaveLength(2);
      expect(Object.values(group.a), face).toContain(scope.ink);
    }
    expect(faceGlyphs(moss, "happy")[0].g).toHaveLength(1);
  });

  it("keeps each glyph on its eye", () => {
    const [down] = faceGlyphs(scope, "down");
    down.g.forEach(({ r: [x, y, w, h] }, i) => {
      const e = scope.anchors.eyes[i];
      expect(x).toBe(e.x);
      expect(w).toBe(e.w);
      expect(y).toBeGreaterThan(e.y);
      expect(y + h).toBeCloseTo(e.y + e.h);
    });
    const [happy] = faceGlyphs(scope, "happy");
    happy.g.forEach(({ p }, i) => { expect(p.startsWith(`M${scope.anchors.eyes[i].x} `)).toBe(true); });
  });

  it("marks the happy face with Clawd's class", () => {
    expect(faceGlyphs(scope, "happy")[0].cls).toBe("tama-happy-eyes");
  });

  it("peaks the happy face at the eye's centre", () => {
    const [happy] = faceGlyphs(scope, "happy");
    happy.g.forEach(({ p }, i) => {
      const e = scope.anchors.eyes[i];
      const [x0, y0, dx0, dy0] = nums(p);
      expect(x0 + dx0).toBeCloseTo(e.x + e.w / 2);
      expect(y0 + dy0).toBeCloseTo(e.y + 0.25 * e.h);
    });
  });

  it("keeps the x inside each eye box", () => {
    const [x] = faceGlyphs(scope, "x");
    x.g.forEach(({ p }, i) => {
      const e = scope.anchors.eyes[i];
      const pts = nums(p);
      for (let j = 0; j < pts.length; j += 2) {
        expect(pts[j]).toBeGreaterThanOrEqual(e.x);
        expect(pts[j]).toBeLessThanOrEqual(e.x + e.w);
        expect(pts[j + 1]).toBeGreaterThanOrEqual(e.y);
        expect(pts[j + 1]).toBeLessThanOrEqual(e.y + e.h);
      }
    });
  });

  it("adds a brow per eye and one sweat drop when worried", () => {
    const worried = faceGlyphs(scope, "worried");
    expect(worried[0].g).toHaveLength(2);
    expect(worried.at(-1).cls).toBe("tama-sweat");
    expect(faceGlyphs(moss, "worried")[0].g).toHaveLength(1);
  });

  it("raises each brow's inner end", () => {
    const [left, right] = faceGlyphs(scope, "worried")[0].g.map(({ p }) => nums(p)); // [x, y, dx, dy]
    expect(left[3]).toBeLessThan(0);
    expect(right[3]).toBeGreaterThan(0);
    // Mirrored: the inner ends meet at one height.
    expect(left[1] + left[3]).toBeCloseTo(right[1]);

    const [tent] = faceGlyphs(moss, "worried")[0].g;
    const [x0, , dx0, dy0] = nums(tent.p);
    expect(x0 + dx0).toBeCloseTo(moss.anchors.eyes[0].x + moss.anchors.eyes[0].w / 2);
    expect(dy0).toBeLessThan(0); // a tent, not a V
  });

  it("uses a critter's own face layer over the generated glyph", () => {
    const own = [{ g: [{ r: [1, 1, 1, 1] }] }];
    expect(faceGlyphs({ ...scope, faces: { happy: own } }, "happy")).toEqual(own);
  });

  it("keeps the sweat drop under a critter's own worried brows", () => {
    const own = [{ g: [{ r: [1, 1, 1, 1] }] }];
    const worried = faceGlyphs({ ...scope, faces: { worried: own } }, "worried");
    expect(worried).toHaveLength(own.length + 1); // own brows instead of the generated ones, not as well
    expect(worried[0]).toEqual(own[0]);
    expect(worried.at(-1).cls).toBe("tama-sweat");
    expect(nox.faces.worried).toBeDefined();
  });

  it("draws nothing for a face it doesn't know", () => {
    expect(faceGlyphs(scope, "wink")).toEqual([]);
  });

  it("gets glyphs for every EYE_FACES member, and worried (eyes kept) isn't one", () => {
    for (const face of EYE_FACES) expect(faceGlyphs(scope, face).length, face).toBeGreaterThan(0);
    expect(EYE_FACES.has("worried")).toBe(false);
  });
});

describe("startleGlyph", () => {
  it("puts the bell's \"!\" just past the head's right edge", () => {
    const scope = critterById("scope").sprite;
    const [bang] = startleGlyph(scope);
    expect(bang.cls).toBe("tama-startle");
    expect(bang.g[0].r[0]).toBeCloseTo(scope.anchors.head.right + 0.4);
    expect(bang.g[0].r[1]).toBeCloseTo(scope.anchors.head.top + 0.5);
  });
});

describe("sprite paint", () => {
  // Every node's own `a.fill`/`a.stroke` (root and faces, depth first).
  function paints(nodes, out = []) {
    for (const n of nodes) {
      if (n.a) out.push(n.a);
      if (n.g) paints(n.g, out);
    }
    return out;
  }
  const HEX = /^#[0-9a-f]{6}$/i;

  // hueRotate (critters.js) passes anything but #rrggbb straight through
  // untinted, so a sprite that painted with `none`, a CSS var, or a 3-digit
  // hex would leave an untinted patch on a critter's friend (tint reaches
  // every paint only if every paint is a 6-digit hex).
  it.each(sprites.map((c) => [c.id, c]))("%s paints every fill and stroke as #rrggbb", (_id, c) => {
    const layers = [...c.sprite.root, ...Object.values(c.sprite.faces || {}).flat()];
    for (const a of paints(layers)) {
      if (a.fill !== undefined) expect(a.fill === "none" || HEX.test(a.fill), a.fill).toBe(true);
      if (a.stroke !== undefined) expect(HEX.test(a.stroke), a.stroke).toBe(true);
    }
  });
});

describe("hueRotate", () => {
  it("turns a colour's hue by the given degrees", () => {
    expect(hueRotate("#ff0000", 120)).toBe("#00ff00");
    expect(hueRotate("#ff0000", 240)).toBe("#0000ff");
    expect(hueRotate("#00FF00", -120)).toBe("#ff0000");
  });

  it("leaves a colour as it is at 0 and 360 degrees", () => {
    expect(hueRotate("#40b8ee", 0)).toBe("#40b8ee");
    expect(hueRotate("#40b8ee", 360)).toBe("#40b8ee");
  });

  it("leaves greys alone: they have no hue to turn", () => {
    expect(hueRotate("#808080", 90)).toBe("#808080");
    // A near-black with a faint hue still turns, and comes back lower-case.
    expect(hueRotate("#1A1C20", 150)).toMatch(/^#[0-9a-f]{6}$/);
    expect(hueRotate("#1A1C20", 150)).not.toBe("#1a1c20");
  });

  it("passes through anything that isn't #rrggbb", () => {
    expect(hueRotate("none", 90)).toBe("none");
    expect(hueRotate("var(--line)", 90)).toBe("var(--line)");
    expect(hueRotate(undefined, 90)).toBeUndefined();
  });
});

describe("placement with a height", () => {
  it("stands a critter that tall, feet on the floor", () => {
    const sprite = critterById("jelly").sprite;
    const box = spriteBox(sprite);
    const p = placement(sprite, { x0: 8, sitting: false, height: 5 });
    expect(p.scale * box.h).toBeCloseTo(5);
    expect(p.ty + p.scale * (box.y + box.h)).toBeCloseTo(19);
    expect(p.top).toBe(14);
  });
});

// Applies an SVG transform list ("translate(…) scale(…) translate(…)", the
// shape hatTransform emits) to a point, composing right-to-left as SVG does:
// a generic matrix walk, not hatTransform's own formula restated.
function applyTransform(transform, [x, y]) {
  const ops = [...transform.matchAll(/(translate|scale)\(([^)]+)\)/g)];
  let px = x;
  let py = y;
  for (let i = ops.length - 1; i >= 0; i--) {
    const [, op, raw] = ops[i];
    const args = raw.trim().split(/\s+/).map(Number);
    if (op === "translate") {
      const [dx, dy = 0] = args;
      px += dx;
      py += dy;
    } else {
      const [sx, sy = sx] = args;
      px *= sx;
      py *= sy;
    }
  }
  return [px, py];
}

describe("hatTransform", () => {
  it("maps Clawd's brim corners onto the critter's hat seat, at its width", () => {
    // Clawd's hats (Tamagotchi.jsx) are drawn for his head, top centred at
    // (9, 9), 12 wide: the brim's left and right corners sit at (3, 9) and
    // (15, 9). Mapping them through hatTransform should land them at the
    // critter's seat edges, (cx − w/2, top) and (cx + w/2, top).
    const sprite = critterById("nox").sprite;
    const { cx, top, w } = sprite.anchors.hat;
    const t = hatTransform(sprite);
    const [leftX, leftY] = applyTransform(t, [3, 9]);
    expect(leftX).toBeCloseTo(cx - w / 2);
    expect(leftY).toBeCloseTo(top);
    const [rightX, rightY] = applyTransform(t, [15, 9]);
    expect(rightX).toBeCloseTo(cx + w / 2);
    expect(rightY).toBeCloseTo(top);
  });
});

describe("wornGlyphs", () => {
  const scope = critterById("scope").sprite;
  const moss = critterById("moss").sprite;

  it("puts a goggle lens around each eye, and a strap across them", () => {
    const [goggles] = wornGlyphs(scope, "goggles");
    expect(goggles.cls).toBe("tama-goggles");
    const [strap, ...lenses] = goggles.g;
    expect(lenses).toHaveLength(scope.anchors.eyes.length);
    lenses.forEach(({ r: [x, y, w, h] }, i) => {
      const e = scope.anchors.eyes[i];
      expect(x).toBeLessThan(e.x);
      expect(y).toBeLessThan(e.y);
      expect(x + w).toBeGreaterThan(e.x + e.w);
      expect(y + h).toBeGreaterThan(e.y + e.h);
    });
    const [sx, sy, sw, sh] = strap.r;
    expect(sx).toBeLessThan(Math.min(...scope.anchors.eyes.map((e) => e.x)));
    expect(sx + sw).toBeGreaterThan(Math.max(...scope.anchors.eyes.map((e) => e.x + e.w)));
    // The strap is a horizontal band across the lenses: it has to cross every
    // eye's own y-range, or it'd float above or below an eye instead of
    // strapping across it.
    scope.anchors.eyes.forEach((e) => {
      expect(sy).toBeLessThan(e.y + e.h);
      expect(sy + sh).toBeGreaterThan(e.y);
    });
    expect(wornGlyphs(moss, "goggles")[0].g).toHaveLength(2); // one-eyed: a strap and one lens
  });

  it("wraps the scarf along the neck row, its tail animated", () => {
    const [scarf] = wornGlyphs(scope, "scarf");
    const { y, x0, x1 } = scope.anchors.neck;
    expect(scarf.cls).toBe("tama-scarf");
    const [band, stripes, tail] = scarf.g;
    expect(band.r).toEqual([x0, y, x1 - x0, 1.6]);
    expect(tail.cls).toBe("tama-scarf-tail");
    // Every stripe sits inside the band, left to right and top to bottom.
    expect(stripes.g.length).toBeGreaterThan(0);
    for (const { r: [sx, sy, sw] } of stripes.g) {
      expect(sx).toBeGreaterThanOrEqual(x0);
      expect(sx + sw).toBeLessThanOrEqual(x1);
      expect(sy).toBe(y);
    }
    // The tail hangs off the band's near end, not inside it.
    expect(tail.r[0]).toBeLessThan(band.r[0]);
  });

  it("keeps a stripe's far edge inside the band even when it would just poke past the end", () => {
    // A neck row whose width leaves the last 3-unit step's stripe just short
    // of x1 under `x < x1`, but inside under `x + 0.7 <= x1`: none of the
    // shipped critters' neck rows happen to land on this edge, so this pins
    // the boundary with a crafted one instead of hoping a real sprite hits it.
    const sprite = { anchors: { neck: { y: 0, x0: 0, x1: 5.3 } } };
    const [scarf] = wornGlyphs(sprite, "scarf");
    const [, stripes] = scarf.g;
    expect(stripes.g.length).toBeGreaterThan(0);
    for (const { r: [sx, , sw] } of stripes.g) expect(sx + sw).toBeLessThanOrEqual(5.3);
  });

  it("draws nothing it doesn't know", () => {
    expect(wornGlyphs(scope, "monocle")).toEqual([]);
  });
});

describe("holding", () => {
  const sprites = CRITTERS.filter((c) => c.sprite).map((c) => [c.id, c.sprite]);
  // Does any rect among these nodes cover the point?
  const covers = (nodes, [x, y]) => nodes.flatMap((n) => n.g).some(({ r: [rx, ry, rw, rh] }) =>
    rx - 1e-6 <= x && x <= rx + rw + 1e-6 && ry - 1e-6 <= y && y <= ry + rh + 1e-6);

  it.each(sprites)("%s reaches each prop's tip, a reach right of its limb's root", (_id, sprite) => {
    const box = spriteBox(sprite);
    for (const [prop, { reach, at }] of Object.entries(HOLDS)) {
      const [x, y] = holdTip(sprite, prop);
      expect(x, prop).toBeCloseTo(sprite.limb.root[0] + reach);
      expect(y, prop).toBeCloseTo(box.y + at * box.h);
    }
  });

  it("maps the tip into the scene through the critter's placement", () => {
    const sprite = critterById("scope").sprite;
    const place = placement(sprite, { x0: 1, sitting: false });
    const [x, y] = holdTip(sprite, "leash");
    const [sx, sy] = holdTipInScene(sprite, "leash", place);
    expect(sx).toBeCloseTo(place.tx + place.scale * x);
    expect(sy).toBeCloseTo(place.ty + place.scale * y);
    // Whatever size the placement gives it: the tip follows a bigger critter too.
    const big = placement(sprite, { x0: 1, sitting: false, height: 13 });
    expect(holdTipInScene(sprite, "leash", big)[1]).toBeCloseTo(big.ty + big.scale * y);
  });

  it.each(sprites)("%s's appendage runs from its root to the tip, in its limb colour", (_id, sprite) => {
    for (const prop of Object.keys(HOLDS)) {
      const nodes = limbGlyphs(sprite, prop);
      const [rx, ry] = sprite.limb.root;
      expect(covers(nodes, [rx + 0.1, ry + 0.1]), `${prop} root`).toBe(true);
      expect(covers(nodes, holdTip(sprite, prop)), `${prop} tip`).toBe(true);
      expect(nodes.every((n) => n.a.fill === sprite.limb.color), prop).toBe(true);
    }
  });

  it("draws a tail's outline copy and its spade when declared", () => {
    const nox = limbGlyphs(critterById("nox").sprite, "pint");
    expect(nox[0].a.stroke).toBe("#4a4f57");
    expect(nox).toHaveLength(2);
    const ember = limbGlyphs(critterById("ember").sprite, "pint");
    expect(ember).toHaveLength(1);
    expect(ember[0].g).toHaveLength(4); // base, riser, hook, spade
    expect(limbGlyphs(critterById("scope").sprite, "pint")[0].g).toHaveLength(3); // bar, upright, hand
  });
});
