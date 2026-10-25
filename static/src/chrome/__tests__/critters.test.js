import { afterEach, describe, expect, it } from "vitest";
import { getTamaCritter, prefsSignal } from "../../prefs.js";
import {
  CLAWD_HEIGHT,
  CRITTER_HEIGHT,
  CRITTERS,
  cheerGlyphs,
  cheersWithLimb,
  critterById,
  EYE_FACES,
  faceGlyphs,
  HOLDS,
  hatTransform,
  holdTip,
  holdTipInScene,
  hueRotate,
  limbGlyphs,
  placement,
  sceneToSprite,
  spriteBox,
  startleGlyph,
  strideRoot,
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

  it.each(sprites.map((c) => [c.id, c.sprite]))("stands %s taller than Clawd (CRITTER_HEIGHT), on Clawd's spot", (_id, sprite) => {
    const box = spriteBox(sprite);
    const p = placement(sprite, { x0: 8, sitting: false });
    expect(p.scale * box.h).toBeCloseTo(CRITTER_HEIGHT);
    expect(bottomOf(p, box)).toBeCloseTo(19);
    expect(centreOf(p, box)).toBeCloseTo(16.5);
    expect(p.top).toBe(19 - CRITTER_HEIGHT);
  });

  // The constraint that rejected 13.5 (docs/superpowers/specs/…-design.md):
  // every hat stays inside the scene. hatTransform maps Clawd's head frame
  // (top centre (9, 9), 12 wide) onto a critter's `anchors.hat`, so a hat
  // point at Clawd-frame y `Y` lands at `hat.top + hat.w/12*(Y-9)` in the
  // critter's own sprite units; `placement()`'s `ty`/`scale` and the pose's
  // `lift` (TamaScene draws the creature inside a `translate(0 -lift)`
  // wrapper) carry that onto the scene.
  const HAT_TOPS = {
    // SantaHat (Tamagotchi.jsx): its two highest crown rects, y 4.6.
    santa: 4.6,
    // PartyHat (Tamagotchi.jsx): the pompom circle, cy 3.6 r 0.8 → top 2.8.
    party: 2.8,
    // Toque (TamaPastimes.jsx): its middle pouf, cy Y0-3=6 r 1.8 → top 4.2.
    toque: 4.2,
    // Helmet (TamaPastimes.jsx): the dome's crown, where its two Q curves
    // meet at Y0-1.6=7.4 — also the curves' true minimum y.
    helmet: 7.4,
  };
  const HAT_SCENES = [
    ["santa", { x0: 3, sitting: true }], // code's seated pose
    ["party", { x0: 3, sitting: true }],
    ["toque", { x0: 2 }], // cook, standing
    ["helmet", { x0: 7, lift: 2 }], // cycle, lifted onto the saddle
  ];
  function hatTop(sprite, { x0, sitting = false, lift = 0 }, Y) {
    const { hat } = sprite.anchors;
    const { ty, scale } = placement(sprite, { x0, sitting });
    return ty + scale * (hat.top + (hat.w / 12) * (Y - 9)) - lift;
  }

  it.each(sprites.map((c) => [c.id, c.sprite]))("keeps every hat's top on screen for %s, 12 tall (13.5 didn't)", (_id, sprite) => {
    for (const [name, pose] of HAT_SCENES) expect(hatTop(sprite, pose, HAT_TOPS[name]), name).toBeGreaterThanOrEqual(0);
  });

  it("stands a critter 12 tall: a fifth over Clawd, so a square one isn't half his size", () => {
    expect(CRITTER_HEIGHT).toBe(12);
    expect(CRITTER_HEIGHT).toBeGreaterThan(CLAWD_HEIGHT);
  });

  it("still fits any height it's given", () => {
    const sprite = critterById("nox").sprite;
    const p = placement(sprite, { x0: 8, sitting: false, height: CLAWD_HEIGHT });
    expect(p.scale * spriteBox(sprite).h).toBeCloseTo(CLAWD_HEIGHT);
    expect(p.top).toBe(9);
  });

  it("seats a sitting critter on the seat, not through it", () => {
    const sprite = critterById("nox").sprite;
    const box = spriteBox(sprite);
    const p = placement(sprite, { x0: 3, sitting: true });
    expect(bottomOf(p, box)).toBeCloseTo(17);
    expect(centreOf(p, box)).toBeCloseTo(11.5);
    expect(p.top).toBe(17 - CRITTER_HEIGHT);
  });

  // Legged critters: seated, it's the *hidden* legs' bottom that lands on the
  // seat, not the full (standing) box's — the body ends where Clawd's does,
  // at standing's scale.
  const LEGGED = ["scope", "ember", "volt", "moss", "octocat"];
  it.each(LEGGED)("seats %s on the seat by its legs-hidden box, at standing's scale", (id) => {
    const sprite = critterById(id).sprite;
    const box = spriteBox(sprite);
    const seatedBox = spriteBox(sprite, { seated: true });
    const standing = placement(sprite, { x0: 3, sitting: false });
    const p = placement(sprite, { x0: 3, sitting: true });
    expect(p.ty + p.scale * (seatedBox.y + seatedBox.h)).toBeCloseTo(17);
    expect(p.scale).toBeCloseTo(standing.scale);
    expect(p.top).toBeCloseTo(p.ty + p.scale * box.y);
  });

  // Nox's toes and Jelly's tentacles are `keepSeated`: their seated box is the
  // same as the standing one, so the feet-on-seat rule is unchanged.
  it.each(["nox", "jelly"])("keeps %s's feet on the seat, unchanged by the legs-hidden rule", (id) => {
    const sprite = critterById(id).sprite;
    const box = spriteBox(sprite);
    const p = placement(sprite, { x0: 3, sitting: true });
    expect(bottomOf(p, box)).toBeCloseTo(17);
  });
});

describe("strideRoot", () => {
  // Every rect in a node, depth first, in sprite-tree order.
  function rects(n, out = []) {
    if (n.r) { out.push(n.r); return out; }
    for (const c of n.g) rects(c, out);
    return out;
  }

  it.each(sprites.map((c) => [c.id, c.sprite]))("steps %s's legs two units toward the middle in frame B, leaves frame A as drawn", (_id, sprite) => {
    const mid = spriteBox(sprite).x + spriteBox(sprite).w / 2;
    const legRoots = sprite.root.filter((n) => n.legs);
    expect(legRoots.length).toBeGreaterThan(0);
    const out = strideRoot(sprite);
    // Walk sprite.root and out in lockstep: a plain node consumes one out
    // slot (itself, untouched); a legs node consumes two (frame A, frame B).
    let j = 0;
    for (const n of sprite.root) {
      if (!n.legs) {
        expect(out[j]).toBe(n);
        j++;
        continue;
      }
      const frameA = out[j];
      const frameB = out[j + 1];
      expect(frameA).toEqual({ g: [n], cls: "tama-legs-a" });
      expect(frameB.cls).toBe("tama-legs-b");
      const before = rects(n);
      const after = rects(frameB.g[0]);
      expect(after).toHaveLength(before.length);
      before.forEach(([x, y, w, h], k) => {
        const [ax, ay, aw, ah] = after[k];
        const dir = x + w / 2 < mid ? 2 : -2;
        expect(ax).toBeCloseTo(x + dir);
        expect(ay).toBeCloseTo(y);
        expect(aw).toBeCloseTo(w);
        expect(ah).toBeCloseTo(h);
      });
      j += 2;
    }
    expect(out).toHaveLength(j);
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

  it.each(sprites.map((c) => [c.id, c]))("%s moves the \"!\" left of its body when holding, else it's unmoved", (_id, c) => {
    const box = spriteBox(c.sprite);
    const [free] = startleGlyph(c.sprite);
    for (const r of free.g) expect(r.r[0]).toBeCloseTo(c.sprite.anchors.head.right + 0.4);
    const [held] = startleGlyph(c.sprite, true);
    for (const r of held.g) expect(r.r[0]).toBeLessThan(box.x);
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

  // Do two rects overlap or touch?
  const touch = ([ax, ay, aw, ah], [bx, by, bw, bh]) =>
    ax <= bx + bw + 1e-6 && bx <= ax + aw + 1e-6 && ay <= by + bh + 1e-6 && by <= ay + ah + 1e-6;

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
      // Unbroken: each piece has area and touches the one before it. The ends
      // alone miss a riser that skips its bar: the hand covers the tip by itself.
      const pieces = nodes.at(-1).g.map((c) => c.r);
      for (const [i, [, , w, h]] of pieces.entries()) {
        expect(w > 0 && h > 0, `${prop} piece ${i} size`).toBe(true);
        if (i) expect(touch(pieces[i - 1], pieces[i]), `${prop} piece ${i}`).toBe(true);
      }
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

  it.each(sprites)("%s's limb reaches a tip right of its root, given, not just a prop's", (_id, sprite) => {
    const tip = [sprite.limb.root[0] + 4, sprite.limb.root[1] - 3];
    const nodes = limbGlyphs(sprite, "bass", tip);
    expect(covers(nodes, tip)).toBe(true);
    expect(covers(nodes, [sprite.limb.root[0] + 0.1, sprite.limb.root[1] + 0.1])).toBe(true);
  });

  it("maps a scene point into a critter's sprite units, placement's inverse", () => {
    const sprite = critterById("scope").sprite;
    const place = placement(sprite, { x0: 6, sitting: false });
    const [x, y] = sceneToSprite(place, [24, 11.7]);
    expect(place.tx + place.scale * x).toBeCloseTo(24);
    expect(place.ty + place.scale * y).toBeCloseTo(11.7);
  });
});

describe("cheering", () => {
  // A sprite's arm rects ([x, y, w, h], with their fill), nested ones included.
  const armRects = (nodes, inArms = false, fill) => nodes.flatMap((n) => {
    if (n.mood) return [];
    const f = n.a?.fill ?? fill;
    return n.r ? (inArms ? [[n.r, f]] : []) : armRects(n.g, inArms || !!n.arms, f);
  });

  it.each(["ember", "volt", "moss"])("%s raises its own side arms: a bar up from each, in its colour", (id) => {
    const sprite = critterById(id).sprite;
    const arms = armRects(sprite.root);
    expect(arms.length).toBeGreaterThan(0);
    expect(cheersWithLimb(sprite)).toBe(false);
    const bars = cheerGlyphs(sprite);
    expect(bars).toHaveLength(arms.length);
    bars.forEach((b, i) => {
      const [[x, y, w], fill] = arms[i];
      expect(b.r).toEqual([x, y - 4, w, 4]);
      expect(b.a.fill).toBe(fill);
      expect(b.cls).toBe(i ? "tama-cheer tama-cheer2" : "tama-cheer");
    });
  });

  // Pinned against Moss's own sprite data, not just the test's own recursive
  // walk above (armRects): both could share the same bug (e.g. dropping into
  // its second arm, nested one level deeper than the first — critterSprites.js
  // moss's `arms` group), and the test above would never notice.
  it("pins Moss's two raised bars explicitly", () => {
    const moss = critterById("moss").sprite;
    expect(cheerGlyphs(moss)).toEqual([
      { r: [4, 6, 1, 4], a: { fill: "#2e9a56" }, cls: "tama-cheer" },
      { r: [15, 6, 1, 4], a: { fill: "#2e9a56" }, cls: "tama-cheer tama-cheer2" },
    ]);
  });

  // A bar's own arm paints it, not the sprite's limb colour (a synthetic
  // sprite whose two differ, so a bar wrongly coloured by `sprite.limb` fails).
  it("colours each bar by its own arm's fill, not the limb's", () => {
    const sprite = {
      root: [{ g: [{ r: [1, 5, 1, 2], a: { fill: "#111111" } }], arms: true }],
      limb: { style: "arm", root: [0, 0], width: 1, color: "#eeeeee" },
    };
    const [bar] = cheerGlyphs(sprite);
    expect(bar.r).toEqual([1, 1, 1, 4]);
    expect(bar.a.fill).toBe("#111111");
  });

  it.each(["scope", "jelly", "nox", "octocat"])("%s, with no side arms, waves its limb up beside its head", (id) => {
    const sprite = critterById(id).sprite;
    expect(cheersWithLimb(sprite)).toBe(true);
    const [wave] = cheerGlyphs(sprite);
    expect(wave.cls).toBe("tama-cheer");
    const box = spriteBox(sprite);
    const tip = [sprite.limb.root[0] + 1.6, box.y + 0.12 * box.h];
    expect(wave.g).toEqual(limbGlyphs(sprite, null, tip.map((v) => Math.round(v * 1e4) / 1e4)));
  });
});
