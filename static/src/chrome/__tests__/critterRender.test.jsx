// Render-path tests for one critter: which layers a mood and sleep draw.

import render from "preact-render-to-string";
import { describe, expect, it } from "vitest";
import { Critter } from "../Critter.jsx";
import { CRITTERS, critterById, hueRotate, limbGlyphs, strideRoot, teethGlyph } from "../critters.js";

const sprites = CRITTERS.filter((c) => c.sprite).map((c) => [c.id, c.sprite]);
const MOODS = ["calm", "grumpy", "furious"];
const count = (html, needle) => html.split(needle).length - 1;
const draw = (props) => render(<svg aria-hidden="true"><Critter {...props} /></svg>);
// The `<g class="tama-flush"` group, whole, as groupAt does in tamagotchiRender.test.jsx.
const flushGroup = (html) => {
  const open = html.indexOf('<g class="tama-flush"');
  if (open < 0) return null;
  let depth = 0;
  for (const m of html.slice(open).matchAll(/<g[\s>]|<\/g>/g)) {
    depth += m[0] === "</g>" ? -1 : 1;
    if (depth === 0) return html.slice(open, open + m.index + 4);
  }
  return html.slice(open);
};
// A limb node as Node draws it. A limb's colours are its body's too, so a bare fill= match passes with no limb.
const markup = ({ a, g }) => `<g ${Object.entries(a).map(([k, v]) => `${k}="${v}"`).join(" ")}>` +
  g.map(({ r: [x, y, w, h] }) => `<rect x="${x}" y="${y}" width="${w}" height="${h}"></rect>`).join("") + "</g>";

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

  it("keeps the startle's \"!\" at its usual spot for a paws hold (no limb reach)", () => {
    // Paws (the controller) sit low and centred, unlike a limb reaching right,
    // so the "!" doesn't need to move left to clear them.
    const nox = critterById("nox").sprite;
    const unheld = draw({ sprite: nox, startle: true });
    const paws = draw({ sprite: nox, startle: true, holding: "controller" });
    expect(paws.replace(' data-holding="controller"', "")).toBe(unheld);
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
        // A resting tail (`rest`): drawn as any group when nothing is held.
        { g: [{ r: [8, 8, 1, 1] }], rest: true },
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
      '<g><rect x="8" y="8" width="1" height="1"></rect></g>' +
      "</g></svg>";
    const asleep =
      '<svg aria-hidden="true"><g class="critter"><rect x="0" y="0" width="1" height="1" fill="#111"></rect>' +
      '<g fill="#222"><rect x="1" y="1" width="1" height="1"></rect></g>' +
      '<g class="crit-x-1"><rect x="2" y="2" width="1" height="1"></rect></g>' +
      '<g data-mood="calm"><rect x="3" y="3" width="1" height="1"></rect></g>' +
      '<rect data-role="shut" x="5" y="6" width="2" height="0.4" fill="#333"></rect>' +
      '<rect data-role="shut" x="6" y="7" width="2" height="0.4" fill="#444"></rect>' +
      '<g><rect x="8" y="8" width="1" height="1"></rect></g>' +
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
    // The shut rect itself: Moss's lid carries its own fill (#47cf79), drawn
    // from `n.g[0].a` once the happy face shuts it over the eye — Nox's lid
    // paints no colour of its own (its `g[0].a` is empty), so asserting on it
    // would stay green even if `painted(n.g[0].a, tint)` were reverted.
    const moss = critterById("moss").sprite;
    const shutHtml = draw({ sprite: moss, tint: 150, face: "happy" });
    expect(shutHtml).toMatch(new RegExp(`data-role="shut"[^>]*fill="${hueRotate("#47cf79", 150)}"`));
    // A stroke tints the same way: Nox's body outline (#4a4f57) is gone, and
    // its tinted form shows up instead.
    const strokeHtml = draw({ sprite: critterById("nox").sprite, tint: 150, face: "x" });
    expect(strokeHtml).not.toContain('stroke="#4a4f57"');
    expect(strokeHtml).toContain(`stroke="${hueRotate("#4a4f57", 150)}"`);
  });

  it("wears goggles or a scarf when told to, marked on its group", () => {
    const sprite = critterById("scope").sprite;
    expect(draw({ sprite, worn: "goggles" })).toContain('data-worn="goggles"');
    expect(draw({ sprite, worn: "goggles" })).toContain('class="tama-goggles"');
    expect(draw({ sprite, worn: "scarf" })).toContain('class="tama-scarf-tail"');
    expect(draw({ sprite })).not.toContain("data-worn");
  });

  it("holds with its limb, and a tail that holds isn't also drawn resting", () => {
    const nox = critterById("nox").sprite;
    expect(draw({ sprite: nox })).toContain("crit-nox-1");
    const holding = draw({ sprite: nox, holding: "pint" });
    expect(holding).toContain('data-holding="pint"');
    expect(holding).not.toContain("crit-nox-1");
    for (const n of limbGlyphs(nox, "pint")) expect(holding).toContain(markup(n));
    const scope = critterById("scope").sprite;
    const [arm] = limbGlyphs(scope, "mug");
    expect(draw({ sprite: scope, holding: "mug", tint: 150 })).toContain(markup({ ...arm, a: { fill: hueRotate(arm.a.fill, 150) } }));
    expect(draw({ sprite: scope })).not.toContain("data-holding");
  });

  it("reaches a given tip, over a prop it plays (children), or holds with no limb at all", () => {
    const nox = critterById("nox").sprite;
    const tip = [22, 6];
    const html = render(<svg aria-hidden="true"><Critter sprite={nox} holding="bass" tip={tip}><g class="the-bass"></g></Critter></svg>);
    for (const n of limbGlyphs(nox, "bass", tip)) expect(html).toContain(markup(n));
    expect(html).not.toContain("crit-nox-1"); // the tail frets, so it isn't resting
    // The prop it plays sits over its body and under its limb.
    expect(html.indexOf('class="the-bass"')).toBeGreaterThan(html.indexOf("crit-nox-2"));
    expect(html.indexOf('class="the-bass"')).toBeLessThan(html.indexOf(markup(limbGlyphs(nox, "bass", tip).at(-1))));
    // A prop held without the limb (the controller's paws): no limb drawn, the tail
    // rests. Nox has no hold-arms, so a paws hold draws it exactly as unheld.
    const paws = draw({ sprite: nox, holding: "controller" });
    expect(paws).toContain('data-holding="controller"');
    expect(paws).toContain("crit-nox-1");
    expect(paws.replace(' data-holding="controller"', "")).toBe(draw({ sprite: nox }));
  });

  it("rests a tail for a bare reach too, no prop held (the desk's keys or bell, TamaScene)", () => {
    const nox = critterById("nox").sprite;
    expect(draw({ sprite: nox, tip: [22, 6] })).not.toContain("crit-nox-1");
  });

  // A rest group nested inside another group (Nox's and Ember's own are
  // top-level): `rest` has to thread through Node's recursive call, not just
  // the first.
  it("hides a rest node nested inside another group", () => {
    const sprite = {
      root: [{ g: [{ g: [{ r: [1, 1, 1, 1] }], a: { fill: "#123456" }, rest: true }] }],
      limb: { style: "arm", root: [10, 10], width: 1, color: "#654321" },
    };
    expect(draw({ sprite })).toContain("#123456");
    expect(draw({ sprite, holding: "pint" })).not.toContain("#123456");
  });

  // A prop held in paws (no limb reach) takes the side arms with it: they're
  // on the prop (the controller), drawn in TamaPastimes, not on the critter.
  it("hides the side arms (hold-arms), top-level or nested, only when the scene says `paws`", () => {
    const sprite = {
      root: [
        { g: [{ r: [1, 1, 1, 1] }], a: { fill: "#abcdef" }, arms: true },
        { g: [{ g: [{ r: [2, 2, 1, 1] }], a: { fill: "#fedcba" }, arms: true }] },
      ],
      limb: { style: "arm", root: [10, 10], width: 1, color: "#654321" },
    };
    const unheld = draw({ sprite });
    expect(unheld).toContain("#abcdef");
    expect(unheld).toContain("#fedcba");
    const controller = draw({ sprite, holding: "controller", paws: true });
    expect(controller).not.toContain("#abcdef");
    expect(controller).not.toContain("#fedcba");
    // `paws` alone decides it, independent of `holding`: never set with a
    // limb reach in practice (TamaScene's `p?.paws` is only true for the
    // controller), but there's no other guard against it here.
    const noHolding = draw({ sprite, paws: true });
    expect(noHolding).not.toContain("#abcdef");
    expect(noHolding).not.toContain("#fedcba");
  });

  // `paws` is explicit (TamaScene's `p?.paws`), not inferred from `holding`
  // having no reach: a `HOLDING` value never declared in `HOLDS` must not
  // silently shed the arms just because nothing else gave it a tip.
  it("keeps the side arms for a holding prop with no reach when the scene doesn't say `paws`", () => {
    const sprite = {
      root: [{ g: [{ r: [1, 1, 1, 1] }], a: { fill: "#abcdef" }, arms: true }],
      limb: { style: "arm", root: [10, 10], width: 1, color: "#654321" },
    };
    expect(draw({ sprite, holding: "controller" })).toContain("#abcdef");
  });

  it("ember's side arms show by default and go when the scene says `paws`", () => {
    const ember = critterById("ember").sprite;
    expect(draw({ sprite: ember })).toContain('<rect x="3" y="9"');
    expect(draw({ sprite: ember, holding: "controller", paws: true })).not.toContain('<rect x="3" y="9"');
    // `holding` alone (no `paws`) isn't enough: the inference is gone.
    expect(draw({ sprite: ember, holding: "controller" })).toContain('<rect x="3" y="9"');
  });

  it("cheers: raises its side arms, or waves its limb (and a resting tail it waves goes)", () => {
    const nox = critterById("nox").sprite;
    const waving = draw({ sprite: nox, cheer: true });
    expect(waving).toContain('<g class="tama-cheer">');
    expect(waving).not.toContain("crit-nox-1");
    // The waving limb draws after the body (sprite.root.map, ahead of cheerGlyphs).
    expect(waving.indexOf('<g class="tama-cheer">')).toBeGreaterThan(waving.indexOf("crit-nox-2"));
    const ember = critterById("ember").sprite;
    const arms = draw({ sprite: ember, cheer: true });
    expect(arms).toContain('class="tama-cheer"');
    expect(arms).toContain('class="tama-cheer tama-cheer2"');
    expect(arms).toContain("crit-ember-1"); // its tail stays: its arms do the cheering
    expect(draw({ sprite: ember })).not.toContain("tama-cheer");
  });

  it("seated hides a legs node, nested included, but keeps one that's keepSeated", () => {
    const sprite = {
      root: [
        { g: [{ r: [1, 1, 1, 1] }], legs: true, a: { fill: "#111111" } },
        { g: [{ r: [2, 2, 1, 1] }], a: { fill: "#222222" } },
        { g: [{ g: [{ r: [3, 3, 1, 1] }], legs: true, a: { fill: "#333333" } }] },
        { g: [{ r: [4, 4, 1, 1] }], legs: true, keepSeated: true, a: { fill: "#444444" } },
      ],
    };
    const everything = draw({ sprite });
    expect(everything).toContain("#111111");
    expect(everything).toContain("#222222");
    expect(everything).toContain("#333333");
    expect(everything).toContain("#444444");
    const seated = draw({ sprite, seated: true });
    expect(seated).not.toContain("#111111");
    expect(seated).toContain("#222222");
    expect(seated).not.toContain("#333333");
    expect(seated).toContain("#444444");
  });

  it("hides scope's feet when seated, keeps Nox's toes (keepSeated)", () => {
    const scope = critterById("scope").sprite;
    expect(draw({ sprite: scope })).toContain('<rect x="5" y="16"');
    expect(draw({ sprite: scope, seated: true })).not.toContain('<rect x="5" y="16"');
    const nox = critterById("nox").sprite;
    expect(draw({ sprite: nox, seated: true })).toContain('<rect x="6" y="17"');
  });

  it("strides: draws both leg frames when told to, neither otherwise", () => {
    const ember = critterById("ember").sprite;
    const striding = draw({ sprite: ember, stride: true });
    expect(striding).toContain("tama-legs-a");
    expect(striding).toContain("tama-legs-b");
    const still = draw({ sprite: ember });
    expect(still).not.toContain("tama-legs-a");
    expect(still).not.toContain("tama-legs-b");
    // Matches strideRoot's own tree, not just the class names.
    expect(striding).toBe(draw({ sprite: { ...ember, root: strideRoot(ember) } }));
  });

  describe("furious flush", () => {
    it.each(sprites)("%s washes its silhouette red at half opacity, with its face crisp on top and its teeth last of all", (_id, sprite) => {
      const html = draw({ sprite, mood: "furious" });
      // opacity="0.5" matches Clawd's own flush (Tamagotchi.jsx MoodFace): under
      // reduced motion styles.css's pulse stops, and an unset opacity would
      // paint every furious critter as a flat, solid red shape.
      expect(html).toContain('<g class="tama-flush" fill="#ff3b2f" opacity="0.5">');
      const group = flushGroup(html);
      expect(group).not.toBeNull();
      // Only the wrapper itself carries a fill; nothing inside it does.
      const inner = group.slice(group.indexOf(">") + 1);
      expect(inner).not.toContain("fill=");
      expect(inner).not.toContain("data-mood");
      expect(inner).not.toContain("data-role");
      // The face's own furious layer is drawn after the flush group, and the
      // teeth, inside its furious mouth, are the very last child of all.
      const afterFlush = html.slice(html.indexOf(group) + group.length);
      expect(afterFlush).toContain('data-mood="furious"');
      expect(afterFlush.lastIndexOf('stroke="#f3f5f8"')).toBeGreaterThan(afterFlush.lastIndexOf('data-mood="furious"'));
      const [teeth] = teethGlyph(sprite);
      const teethMarkup = `<path d="${teeth.p}" fill="${teeth.a.fill}" stroke="${teeth.a.stroke}" ` +
        `stroke-width="${teeth.a["stroke-width"]}" stroke-linejoin="${teeth.a["stroke-linejoin"]}"></path>`;
      expect(html.endsWith(`${teethMarkup}</g></svg>`)).toBe(true);
      // The face is drawn once: not also in the main pass before the wash,
      // where a second animated copy would stack under it.
      const beforeFlush = html.slice(0, html.indexOf(group));
      expect(beforeFlush).not.toContain('data-mood="furious"');
      expect(beforeFlush).not.toContain("data-role=");
    });

    it.each(["calm", "grumpy"])("draws no flush and no teeth for %s", (mood) => {
      const html = draw({ sprite: critterById("nox").sprite, mood });
      expect(html).not.toContain("tama-flush");
      expect(html).not.toContain('stroke="#f3f5f8"');
    });

    it("drops a synthetic sprite's hidden rest, seated legs and mood layers from the flush, typing furiously", () => {
      const sprite = {
        root: [
          { g: [{ r: [1, 1, 1, 1] }], rest: true, a: { fill: "#111111" } },
          { g: [{ r: [2, 2, 1, 1] }], legs: true, a: { fill: "#222222" } },
          { g: [{ r: [3, 3, 2, 2] }], anim: "crit-x-1", a: { fill: "#333333" } },
          // Mood-matching too: `n.mood && n.mood !== mood` alone would let a
          // node whose own mood equals the current one straight through.
          { g: [{ r: [7, 7, 1, 1] }], mood: "furious" },
        ],
        limb: { style: "arm", root: [10, 10], width: 1, color: "#654321" },
      };
      const html = draw({ sprite, mood: "furious", tip: [20, 10], seated: true });
      const group = flushGroup(html);
      expect(group).not.toContain('x="1"');
      expect(group).not.toContain('x="2"');
      expect(group).not.toContain('x="7" y="7"');
      // Its anim class rides along into the flush group.
      expect(group).toContain("crit-x-1");
      // The limb it reaches with is washed too.
      expect(group).toContain('x="10"');
    });

    it("recolours Nox's outline to the flush, at its own stroke width", () => {
      const html = draw({ sprite: critterById("nox").sprite, mood: "furious" });
      const group = flushGroup(html);
      expect(group).toContain('stroke="#ff3b2f" stroke-width="1"');
    });

    // The eyes/lids redrawn crisp after the wash are exactly the top-level
    // nodes carrying a role, or containing one: scope/jelly/ember/volt/octocat
    // tag their eye groups directly (role="eye"), and Moss its lid
    // (role="lid"); only Nox's lids are nested inside a role-less wrapper, so
    // Nox alone exercises the "contains one at any depth" half of `hasRole`.
    // Deleting the "contains one at any depth" half of the filter (`hasRole`)
    // would pass the flush-group/teeth checks above untouched, since neither
    // looks at what comes after the flush group — this looks there directly.
    it.each([
      ["scope", "eye"], ["jelly", "eye"], ["ember", "eye"], ["volt", "eye"], ["octocat", "eye"],
      ["nox", "lid"], ["moss", "lid"],
    ])("redraws %s's role-tagged eyes/lids crisp, as data-role=\"%s\", after the wash", (id, role) => {
      const sprite = critterById(id).sprite;
      const html = draw({ sprite, mood: "furious" });
      const group = flushGroup(html);
      const afterFlush = html.slice(html.indexOf(group) + group.length);
      expect(afterFlush).toContain(`data-role="${role}"`);
    });

    // A nested rest/arms node, and sleep: the recursion into the flush
    // group's own children has to carry every visibility rule along (not
    // just the top-level call's), and the top-level gate must still hold
    // asleep.
    it("threads rest/paws through the flush's own nested recursion, and never flushes asleep", () => {
      const sprite = {
        root: [
          { g: [{ g: [{ r: [1, 1, 1, 1] }], rest: true, a: { fill: "#111111" } }] },
          { g: [{ r: [2, 2, 1, 1] }], arms: true, a: { fill: "#222222" } },
        ],
        limb: { style: "arm", root: [10, 10], width: 1, color: "#654321" },
      };
      const typing = draw({ sprite, mood: "furious", tip: [20, 10], paws: true });
      const group = flushGroup(typing);
      expect(group).not.toContain('x="1"'); // the nested resting part goes: the limb reaches instead
      expect(group).not.toContain('x="2"'); // the side arms go: they're on the held prop (paws)
      expect(draw({ sprite, mood: "furious", asleep: true })).not.toContain("tama-flush");
    });

    it("remounts the whole critter on entering or leaving furious, so every animated copy starts in phase", () => {
      const sprite = critterById("jelly").sprite;
      const calm = Critter({ sprite, mood: "calm" });
      const grumpy = Critter({ sprite, mood: "grumpy" });
      const furious = Critter({ sprite, mood: "furious" });
      expect(furious.key).not.toBe(calm.key);
      expect(furious.key).not.toBe(grumpy.key);
      expect(calm.key).toBe(grumpy.key); // neither mounts the flush: no need to remount between them
    });
  });
});
