// Render-path tests for one critter: which layers a mood and sleep draw.

import render from "preact-render-to-string";
import { describe, expect, it } from "vitest";
import { Critter } from "../Critter.jsx";
import { CRITTERS, critterById, hueRotate } from "../critters.js";

const sprites = CRITTERS.filter((c) => c.sprite).map((c) => [c.id, c.sprite]);
const MOODS = ["calm", "grumpy", "furious"];
const count = (html, needle) => html.split(needle).length - 1;
const draw = (props) => render(<svg aria-hidden="true"><Critter {...props} /></svg>);

describe("<Critter>", () => {
  it.each(sprites)("%s draws one mood's layers at a time", (_id, sprite) => {
    for (const mood of MOODS) {
      const html = draw({ sprite, mood });
      expect(html, mood).toContain(`data-mood="${mood}"`);
      for (const other of MOODS.filter((m) => m !== mood)) expect(html, `${mood} shows ${other}`).not.toContain(`data-mood="${other}"`);
    }
  });

  it("hides the other moods' layers", () => {
    const sprite = {
      root: [{ r: [0, 0, 1, 1] }, { g: [{ r: [1, 1, 1, 1] }], mood: "calm" }, { g: [{ r: [2, 2, 1, 1] }], mood: "furious" }],
    };
    const calm = draw({ sprite });
    expect(calm).toContain('x="1"');
    expect(calm).not.toContain('x="2"');
    const furious = draw({ sprite, mood: "furious" });
    expect(furious).toContain('x="2"');
    expect(furious).not.toContain('x="1"');
  });

  it.each(sprites)("%s shuts its eyes asleep and drops the glint", (_id, sprite) => {
    const awake = draw({ sprite });
    const asleep = draw({ sprite, asleep: true });
    const shutters = count(awake, 'data-role="eye"') + count(awake, 'data-role="lid"');
    expect(shutters).toBeGreaterThan(0);
    expect(count(asleep, 'data-role="shut"')).toBe(shutters);
    for (const role of ["eye", "lid", "glint"]) expect(asleep).not.toContain(`data-role="${role}"`);
  });

  it("holds the blink's closed frame as the shut eye", () => {
    const sprite = { root: [{ g: [{ r: [7, 7, 2, 2], a: { fill: "#222" } }], anim: "crit-x-1", role: "eye", shut: [7, 8, 2, 0.4] }] };
    const html = draw({ sprite, asleep: true });
    expect(html).toContain('<rect data-role="shut" x="7" y="8" width="2" height="0.4" fill="#222"');
    expect(html).not.toContain("crit-x-1");
  });

  it("keeps each animation's class on its group", () => {
    expect(draw({ sprite: critterById("jelly").sprite })).toMatch(/<g class="crit-jelly-\d+"/);
  });

  const shutters = (html) => count(html, 'data-role="eye"') + count(html, 'data-role="lid"');

  it.each(sprites)("%s swaps its eyes for the happy, x and look-down glyphs", (_id, sprite) => {
    const lids = count(draw({ sprite }), 'data-role="lid"');
    for (const face of ["happy", "x", "down"]) {
      const html = draw({ sprite, face });
      expect(html, face).toContain(`data-face="${face}"`);
      for (const role of ["eye", "lid", "glint"]) expect(html, `${face} ${role}`).not.toContain(`data-role="${role}"`);
      // A lid is drawn shut over the eye it covers; an open eye just goes.
      expect(count(html, 'data-role="shut"'), face).toBe(lids);
    }
  });

  it.each(sprites)("%s keeps its eyes when worried, under brows and a sweat drop", (_id, sprite) => {
    const html = draw({ sprite, face: "worried" });
    expect(shutters(html)).toBe(shutters(draw({ sprite })));
    expect(html).toContain('class="tama-sweat"');
  });

  // scope has no own worried face (critters.js falls back to generated brows)
  // and keeps two eyes with a glint: the eyes never left, brows just sit over them.
  it("draws the generated brows over scope's eyes, keeping the glint", () => {
    const sprite = critterById("scope").sprite;
    const html = draw({ sprite, face: "worried" });
    expect(html).toContain('stroke-width="0.6"');
    expect(html).toContain('data-role="glint"');
  });

  it("draws the happy glyphs with Clawd's class and in the critter's ink", () => {
    const sprite = critterById("scope").sprite;
    const html = draw({ sprite, face: "happy" });
    expect(html).toContain('class="tama-happy-eyes"');
    expect(html).toContain(`stroke="${sprite.ink}"`);
  });

  it("draws the bell's \"!\" only when startled", () => {
    const sprite = critterById("volt").sprite;
    expect(draw({ sprite, startle: true })).toContain('class="tama-startle"');
    expect(draw({ sprite })).not.toContain("tama-startle");
  });

  // One of every node kind Node handled before the duty faces: a plain rect, a
  // painted group, an anim group, a calm-only mood layer (furious sits beside
  // it and must not show), an eye and a lid that can shut, and a glint. The
  // expected strings came from rendering this same sprite through the Critter
  // that predates the faces (git show 1011413:static/src/chrome/Critter.jsx),
  // so a render without a face must still match it byte for byte.
  it("draws a sprite exactly as before without a face", () => {
    const sprite = {
      root: [
        { r: [0, 0, 1, 1], a: { fill: "#111" } },
        { g: [{ r: [1, 1, 1, 1] }], a: { fill: "#222" } },
        { g: [{ r: [2, 2, 1, 1] }], anim: "crit-x-1" },
        { g: [{ r: [3, 3, 1, 1] }], mood: "calm" },
        { g: [{ r: [4, 4, 1, 1] }], mood: "furious" },
        { g: [{ r: [5, 5, 2, 2], a: { fill: "#333" } }], role: "eye", shut: [5, 6, 2, 0.4] },
        { g: [{ r: [6, 6, 2, 2], a: { fill: "#444" } }], role: "lid", shut: [6, 7, 2, 0.4] },
        { g: [{ r: [7, 7, 0.7, 0.7] }], role: "glint", mood: "calm" },
      ],
    };
    const awake =
      '<svg aria-hidden="true"><g class="critter"><rect x="0" y="0" width="1" height="1" fill="#111"></rect>' +
      '<g fill="#222"><rect x="1" y="1" width="1" height="1"></rect></g>' +
      '<g class="crit-x-1"><rect x="2" y="2" width="1" height="1"></rect></g>' +
      '<g data-mood="calm"><rect x="3" y="3" width="1" height="1"></rect></g>' +
      '<g data-role="eye"><rect x="5" y="5" width="2" height="2" fill="#333"></rect></g>' +
      '<g data-role="lid"><rect x="6" y="6" width="2" height="2" fill="#444"></rect></g>' +
      '<g data-mood="calm" data-role="glint"><rect x="7" y="7" width="0.7" height="0.7"></rect></g>' +
      "</g></svg>";
    const asleep =
      '<svg aria-hidden="true"><g class="critter"><rect x="0" y="0" width="1" height="1" fill="#111"></rect>' +
      '<g fill="#222"><rect x="1" y="1" width="1" height="1"></rect></g>' +
      '<g class="crit-x-1"><rect x="2" y="2" width="1" height="1"></rect></g>' +
      '<g data-mood="calm"><rect x="3" y="3" width="1" height="1"></rect></g>' +
      '<rect data-role="shut" x="5" y="6" width="2" height="0.4" fill="#333"></rect>' +
      '<rect data-role="shut" x="6" y="7" width="2" height="0.4" fill="#444"></rect>' +
      "</g></svg>";
    expect(draw({ sprite })).toBe(awake);
    expect(draw({ sprite, asleep: true })).toBe(asleep);
  });

  it("turns every fill and stroke by `tint`, the face glyphs' ink too", () => {
    const sprite = critterById("scope").sprite;
    const html = draw({ sprite, tint: 150, face: "happy" });
    expect(html).toContain(`fill="${hueRotate("#40b8ee", 150)}"`);
    expect(html).not.toContain('fill="#40b8ee"');
    expect(html).toContain(`stroke="${hueRotate(sprite.ink, 150)}"`);
  });

  it("tints a lid drawn shut, and strokes, the same way", () => {
    const sprite = critterById("nox").sprite;
    const html = draw({ sprite, tint: 150, face: "x" });
    expect(html).toContain('data-role="shut"');
    expect(html).not.toContain('stroke="#4a4f57"');
  });
});
