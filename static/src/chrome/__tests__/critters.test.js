import { afterEach, describe, expect, it } from "vitest";
import { getTamaCritter, prefsSignal } from "../../prefs.js";
import { CLAWD_HEIGHT, CRITTER_IDS, CRITTERS, critterById, placement, spriteBox } from "../critters.js";

const sprites = CRITTERS.filter((c) => c.sprite);

// Every group in a sprite tree, depth first.
function groups(nodes, out = []) {
  for (const n of nodes) {
    if (n.g) { out.push(n); groups(n.g, out); }
  }
  return out;
}

describe("CRITTERS", () => {
  it("is Clawd first, then the six, each id once", () => {
    expect(CRITTER_IDS).toEqual(["clawd", "scope", "jelly", "nox", "ember", "volt", "moss"]);
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
