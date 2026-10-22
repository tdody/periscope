// Render-path tests for one critter: which layers a mood and sleep draw.

import render from "preact-render-to-string";
import { describe, expect, it } from "vitest";
import { Critter } from "../Critter.jsx";
import { CRITTERS, critterById } from "../critters.js";

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

  it.each(sprites)("%s draws exactly as before without a face", (_id, sprite) => {
    const html = draw({ sprite });
    expect(html).not.toContain("data-face");
    expect(html).not.toContain("<path");
  });
});
