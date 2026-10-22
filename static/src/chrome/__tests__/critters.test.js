import { afterEach, describe, expect, it } from "vitest";
import { getTamaCritter, prefsSignal } from "../../prefs.js";
import { CLAWD_HEIGHT, CRITTERS, EYE_FACES, critterById, faceGlyphs, placement, spriteBox, startleGlyph } from "../critters.js";

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
