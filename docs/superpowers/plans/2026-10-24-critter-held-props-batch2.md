# Critters Hold Things (Batch 2: Bass, Controller) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Critters play the bass and hold the game controller with their own appendages, matching the approved draft:
- **The bass:** the critter's limb frets the neck, in front of the bass, and a paw strums.
- **The controller:** two paws hold it, and the right one taps.

Clawd stays byte-identical.

**Architecture:**
- **`critters.js`:** `limbGlyphs` takes an optional explicit tip, and a new `sceneToSprite` maps a scene point (the fret spot on Clawd's neck) into a critter's sprite units.
- **`Critter`:** takes a `tip` (no tip means no limb, and the resting tail stays) and `children`, drawn between its body and its limb.
- **`TamaPastimes.jsx`:** gains `Paw`. `Bass` and `Controller` draw paws for a critter's `limb` instead of Clawd's skin hands.
- **`TamaScene`:** puts the bass inside the critter's wrapper as `Critter`'s child, and draws the controller after the wrapper.

**Tech Stack:** Preact plus `preact-render-to-string` (vitest, node environment), SVG pixel art.

**Spec:** `docs/superpowers/specs/2026-10-24-critter-held-props-batch2-design.md`. Batch 1's spec, `2026-10-23-critter-held-props-batch1-design.md`, has the background; read its "Notes for batch 2".

---

## Conventions for every task

- **Where to work:** the worktree `.claude/worktrees/critter-holds2`, branch `feature/critter-holds2`. Run every command from the worktree root.
- **Commits:** one per task, with a single-line message, a blank line, then exactly `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`. Don't commit `package-lock.json`. Rebuild `static/dist` only in Task 3.
- **Tests:**
  - `npx vitest run static/src/chrome static/src/overlays`
  - `npm test`
- **Linting:**
  - `npx biome lint static/src/chrome`
  - `bin/check` must end "all checks passed". 3 pre-existing Biome warnings, in `Rail.jsx` and `spawnAccountPickerRender.test.jsx`, are fine.
- **Clawd invariant:** `tamagotchiRender.test.jsx`'s "Clawd's drawing, pinned" (sha256 over 3264 renders, music and game included) must pass, and the hash must never be edited. `critterRender.test.jsx`'s exact-markup pin must pass too.
- **Comments** explain *why*, tersely, in the voice of the surrounding code.

---

### Task 0: Worktree

```bash
cd ~/github/tomplex/periscope
git worktree add .claude/worktrees/critter-holds2 -b feature/critter-holds2 main
cd .claude/worktrees/critter-holds2 && npm install --silent && uv sync -q && git checkout -- package-lock.json
npx vitest run static/src/chrome
```

---

### Task 1: A limb can reach any tip, and `Critter` takes a tip and a prop to reach over

**Files:**
- Modify: `static/src/chrome/critters.js`, `static/src/chrome/Critter.jsx`
- Test: `static/src/chrome/__tests__/critters.test.js`, `static/src/chrome/__tests__/critterRender.test.jsx`

- [ ] **Step 1: Write the failing tests**

In `critters.test.js`:
- add `sceneToSprite` to the sorted `../critters.js` import;
- inside `describe("holding", …)`, add:

```js
  it.each(sprites)("%s's limb reaches any tip it's given, not just a prop's", (_id, sprite) => {
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
```

In `critterRender.test.jsx`, inside `describe("<Critter>", …)`, add the test below. `limbGlyphs` and `critterById` are already imported; the `markup` helper is defined inside the "holds with its limb…" test, so copy it into this test or hoist it to the describe block.

```js
  it("reaches a given tip, over a prop it plays (children), or holds with no limb at all", () => {
    const nox = critterById("nox").sprite;
    const tip = [22, 6];
    const markup = ({ a, g }) => `<g ${Object.entries(a).map(([k, v]) => `${k}="${v}"`).join(" ")}>` +
      g.map(({ r: [x, y, w, h] }) => `<rect x="${x}" y="${y}" width="${w}" height="${h}"></rect>`).join("") + "</g>";
    const html = render(<svg aria-hidden="true"><Critter sprite={nox} holding="bass" tip={tip}><g class="the-bass"></g></Critter></svg>);
    for (const n of limbGlyphs(nox, "bass", tip)) expect(html).toContain(markup(n));
    expect(html).not.toContain("crit-nox-1"); // the tail frets, so it isn't resting
    // The prop it plays sits over its body and under its limb.
    expect(html.indexOf('class="the-bass"')).toBeGreaterThan(html.indexOf("crit-nox-2"));
    expect(html.indexOf('class="the-bass"')).toBeLessThan(html.indexOf(markup(limbGlyphs(nox, "bass", tip).at(-1))));
    // A prop held without the limb (the controller's paws): no limb drawn, the tail rests.
    const paws = draw({ sprite: nox, holding: "controller" });
    expect(paws).toContain('data-holding="controller"');
    expect(paws).toContain("crit-nox-1");
    expect(paws).not.toContain('stroke="#4a4f57" stroke-width="1"><rect x="15.2"');
  });
```

Before relying on `crit-nox-2` as "a body node after the tail", check it in `critterSprites.js`. Nox's root node 0 is `crit-nox-1`, the tail; any later root node class works. Pick one that is present at rest and not hidden.

- [ ] **Step 2: Run the tests and watch them fail**

Run: `npx vitest run static/src/chrome/__tests__/critters.test.js static/src/chrome/__tests__/critterRender.test.jsx`
Expected: FAIL. `sceneToSprite` doesn't exist yet, `limbGlyphs` ignores the tip, `holdTip(…, "bass")` throws, and there are no `children`.

- [ ] **Step 3: Implement in `critters.js`**

Change `limbGlyphs`' signature and first lines to:

```js
export function limbGlyphs(sprite, prop, tip = holdTip(sprite, prop)) {
  const { style, root: [x0, y0], width: t, color, outline, spade } = sprite.limb;
  const [x1, y1] = tip;
```

Extend its comment: `` `tip` overrides the prop's (`holdTip`) for a reach to a fixed spot in the scene: the fret on the bass's neck (sceneToSprite). ``

After `holdTipInScene`, add:

```js
// A scene point in a critter's sprite units, through the placement its
// wrapper is drawn with (placement's inverse): how a fixed spot on a prop
// drawn in scene units, the fret on Clawd's bass neck, becomes a limb's tip.
export function sceneToSprite({ scale, tx, ty }, [X, Y]) {
  return [r4((X - tx) / scale), r4((Y - ty) / scale)];
}
```

- [ ] **Step 4: Implement in `Critter.jsx`**

Add `HOLDS` and `holdTip` to the `./critters.js` import, keeping it sorted. Change `Critter` to:

```jsx
// `holding` is the prop it holds. Its limb (critters.js limbGlyphs) reaches
// `tip`, by default the prop's own (holdTip); a prop it holds without the limb
// (the controller's paws: not in HOLDS, no tip given) draws none. Only a limb
// that reaches takes a resting tail (`rest`) with it. `children`, the bass, sit
// over the critter and under its limb, which frets in front of it.
export function Critter({ sprite, mood = "calm", asleep = false, face = null, startle = false, tint = 0, worn = null, holding = null, tip = null, children }) {
  const hide = EYE_FACES.has(face);
  const reach = tip ?? (holding && HOLDS[holding] ? holdTip(sprite, holding) : null);
  return (
    <g class="critter" data-face={face || undefined} data-worn={worn || undefined} data-holding={holding || undefined}>
      {sprite.root.map((n, i) => <Node key={i} n={n} mood={mood} asleep={asleep} hide={hide} tint={tint} rest={!!reach} />)}
      {face && faceGlyphs(sprite, face).map((n, i) => <Node key={`face-${i}`} n={n} mood={mood} tint={tint} />)}
      {worn && wornGlyphs(sprite, worn).map((n, i) => <Node key={`worn-${i}`} n={n} mood={mood} tint={tint} />)}
      {startle && startleGlyph(sprite, !!holding).map((n, i) => <Node key={`startle-${i}`} n={n} mood={mood} tint={tint} />)}
      {children}
      {reach && limbGlyphs(sprite, holding, reach).map((n, i) => <Node key={`hold-${i}`} n={n} mood={mood} tint={tint} />)}
    </g>
  );
}
```

Replace the old `holding` sentence in the comment block above `Critter` with this one.

- [ ] **Step 5: Run the tests**

`npx vitest run static/src/chrome static/src/overlays`: all pass, including both pins and batch 1's holding tests. Then `npx biome lint static/src/chrome` and `bin/check`.

- [ ] **Step 6: Commit**

```bash
git add static/src/chrome/critters.js static/src/chrome/Critter.jsx static/src/chrome/__tests__/critters.test.js static/src/chrome/__tests__/critterRender.test.jsx
git commit -m "critters: a limb reaches any tip (sceneToSprite), and Critter takes a tip, a prop to reach over, or none for paws"
```

---

### Task 2: The bass and the controller in the critter's own paws

**Files:**
- Modify: `static/src/chrome/TamaPastimes.jsx`, `static/src/chrome/Tamagotchi.jsx`
- Test: `static/src/chrome/__tests__/tamagotchiRender.test.jsx`

- [ ] **Step 1: Write the failing tests**

In `tamagotchiRender.test.jsx`:
- add `limbGlyphs` and `sceneToSprite` to the `../critters.js` import;
- add `BASS_FRET` to the `../TamaPastimes.jsx` import;
- add `SKIN` to the `../tamagotchi.js` import.

Inside `describe("critters at their pastimes", …)`, after the batch-1 holding tests, add the tests below. They reuse `holders`, `count`, `inside`, `drawnPlace` and `nox`, already defined there.

```js
  // The <g …> group opening at `open`, whole.
  const groupAt = (html, open) => {
    let depth = 0;
    for (const m of html.slice(open).matchAll(/<g[\s>]|<\/g>/g)) {
      depth += m[0] === "</g>" ? -1 : 1;
      if (depth === 0) return html.slice(open, open + m.index + 4);
    }
    return html.slice(open);
  };

  it.each(holders)("%s plays the bass: its limb frets the neck in front, a paw strums, no skin hands", (_id, c) => {
    const html = render(<TamaScene activity="music" critter={c} />);
    const mascot = html.slice(html.indexOf('class="tama-creature'));
    expect(mascot).toContain('data-holding="bass"');
    const wrapAt = mascot.indexOf('<g class="tama-critter"');
    const bassAt = mascot.indexOf('<g class="tama-bass"');
    expect(inside(mascot, wrapAt, 'class="tama-bass"')).toBe(true); // bobs and scales back with the critter
    const bass = groupAt(mascot, bassAt);
    expect(bass).not.toContain(`fill="${SKIN}"`);
    expect(count(bass, 'class="tama-strum"')).toBe(1);
    expect(bass).toContain(`fill="${c.sprite.limb.color}"`);
    // The limb reaches the fret spot through the placement actually drawn, after the bass.
    const { x0 } = PASTIME_SCENES.music.pose;
    const tip = sceneToSprite(drawnPlace(html), [x0 + BASS_FRET.dx, BASS_FRET.y]);
    const last = limbGlyphs(c.sprite, "bass", tip).at(-1).g.at(-1).r;
    const lastRect = `<rect x="${last[0]}" y="${last[1]}" width="${last[2]}" height="${last[3]}">`;
    expect(mascot.indexOf(lastRect)).toBeGreaterThan(bassAt + bass.length - 1);
  });

  it.each(holders)("%s holds the controller in two paws, the right one tapping, no skin thumb", (_id, c) => {
    const html = render(<TamaScene activity="game" critter={c} />);
    const mascot = html.slice(html.indexOf('class="tama-creature'));
    expect(mascot).toContain('data-holding="controller"');
    const ctlAt = mascot.indexOf('<g class="tama-controller"');
    const ctl = groupAt(mascot, ctlAt);
    expect(ctl).not.toContain(`fill="${SKIN}"`);
    expect(count(ctl, `fill="${c.sprite.limb.color}"`)).toBe(2);
    expect(count(ctl, 'class="tama-thumb"')).toBe(1);
    expect(inside(mascot, mascot.indexOf('<g class="tama-critter"'), 'class="tama-controller"')).toBe(false); // in front, in scene units
  });

  it("frets with the tail, so it stops resting, but holds the controller in paws, so it rests", () => {
    expect(render(<TamaScene activity="music" critter={nox} />)).not.toContain("crit-nox-1");
    const game = render(<TamaScene activity="game" critter={nox} />);
    expect(game).toContain("crit-nox-1");
    expect(game).toContain('stroke="#4a4f57" stroke-width="0.25"'); // its black paws outlined on the dark controller
  });
```

Check the exact attribute order Preact renders for `Paw`'s rect, and adjust the `stroke=… stroke-width=…` needle to match. Keep the assertion's intent.

- [ ] **Step 2: Run the tests and watch them fail**

Run: `npx vitest run static/src/chrome/__tests__/tamagotchiRender.test.jsx -t "pastimes"`
Expected: FAIL.

- [ ] **Step 3: Implement in `TamaPastimes.jsx`**

1. Next to `Bass`, add:

```jsx
// Where Clawd's fretting hand holds the bass neck (x0 + 17.5, 11.1, 1×0.9),
// centred on the neck line: a critter's limb reaches here (TamaScene).
export const BASS_FRET = { dx: 18, y: 11.7 };

// One of a critter's hands on a prop it holds the way Clawd does, in scene
// units: a small rect in its limb's colour, round for a tentacle, outlined
// where its limb is (Nox's black paws on the dark controller).
function Paw({ limb, x, y, w, h, cls }) {
  const round = limb.style === "tentacle";
  return (
    <rect class={cls} x={x} y={y} width={w} height={h} rx={round ? h / 2 : 0.25} fill={limb.color}
          stroke={!round && limb.outline ? limb.outline : undefined} stroke-width={!round && limb.outline ? 0.25 : undefined} />
  );
}
```

2. Change `Bass({ x0 })` to `Bass({ x0, limb })`. Replace its two `SKIN` rects, the fret hand and the `tama-strum` one, with:

```jsx
      {limb ? <Paw limb={limb} x={x0 + 7.3} y={14.5} w={1.3} h={1} cls="tama-strum" /> : (
        <>
          <rect x={x0 + 17.5} y="11.1" width="1" height="0.9" fill={SKIN} />
          <rect class="tama-strum" x={x0 + 7.4} y="14.6" width="1.1" height="0.8" fill={SKIN} />
        </>
      )}
```

Keep the two SKIN rects byte-identical to today's markup, and in the same order. Add a comment: `` `limb`: a critter's (TamaScene): its paw strums, its limb frets (Critter), in place of Clawd's hands. ``

3. Change `Controller({ x0 })` to `Controller({ x0, limb })`. Replace its `tama-thumb` SKIN rect with:

```jsx
      {limb ? (
        <>
          <Paw limb={limb} x={x0 + 6.2} y={14.3} w={1.6} h={1.3} />
          <Paw limb={limb} x={x0 + 10} y={14.3} w={1.6} h={1.3} cls="tama-thumb" />
        </>
      ) : <rect class="tama-thumb" x={x0 + 9.7} y="13.6" width="0.9" height="0.7" fill={SKIN} />}
```

Add the comment: `` `limb`: a critter's two paws on the grips, the right one tapping. ``

4. Update the `PASTIME_SCENES` legend's `Held` line if it says Held takes only `{ x0 }`.

- [ ] **Step 4: Implement in `Tamagotchi.jsx`**

1. Add `sceneToSprite` to the `./critters.js` import, and `Bass`, `BASS_FRET`, `Controller` to the `./TamaPastimes.jsx` import. Keep both sorted the way Biome wants.

2. Change `HOLDING` to:

```js
const HOLDING = { beer: "pint", coffee: "mug", cook: "spoon", garden: "can", dog: "leash", music: "bass", game: "controller" };
```

Extend its comment: the bass and the controller are held in paws on Clawd's own drawings (TamaPastimes Paw), and the bass's neck is fretted by the limb.

3. In `TamaScene`, after `holdFrom`, add:

```js
  // The bass sits in the critter's wrapper, mapped back to scene units, as
  // Critter's child: over its body and under its limb, which frets the neck in
  // front of it at Clawd's fret spot.
  const fret = holding === "bass" ? sceneToSprite(place, [x0 + BASS_FRET.dx, BASS_FRET.y]) : null;
```

4. Change the wrapper's `<Critter … holding={holding} />` to pass `tip={fret}`, with children:

```jsx
            <Critter sprite={sprite} mood={moody ? mood : "calm"} asleep={asleep} face={critterFace}
                     startle={pose === "bell" && !deskBell} worn={worn} holding={holding} tip={fret}>
              {fret && (
                <g style="transform-box: view-box" transform={`scale(${r4(1 / place.scale)}) translate(${r4(-place.tx)} ${r4(-place.ty)})`}>
                  <Bass x0={x0} limb={sprite.limb} />
                </g>
              )}
            </Critter>
```

Check that `Tamagotchi.jsx` has an `r4` helper. If not, use the numbers unrounded the way the wrapper's own transform does, or import a rounding helper used nearby. Don't add a new module.

5. After the `{holding === "spoon" && …}` line, add:

```jsx
        {holding === "controller" && <Controller x0={x0} limb={sprite.limb} />}
```

Clawd's `p.Held` is already dropped for any holding critter.

- [ ] **Step 5: Run the tests**

`npx vitest run static/src/chrome static/src/overlays`: all pass. "Clawd's drawing, pinned" must be unchanged. Then `npm test`, `npx biome lint static/src/chrome` and `bin/check`.

- [ ] **Step 6: Commit**

```bash
git add static/src/chrome/TamaPastimes.jsx static/src/chrome/Tamagotchi.jsx static/src/chrome/__tests__/tamagotchiRender.test.jsx
git commit -m "tamagotchi: critters play the bass — the limb frets the neck, a paw strums — and hold the controller in two paws"
```

---

### Task 3: Hand check, docs, bundle, gate

- [ ] **Step 1:** Render the music and game rows, and the full every-scene grid, from the branch with a throwaway vite-node script outside the repo. Compare with the approved draft:
  - the limb frets the neck in front of the bass;
  - a paw strums;
  - two paws are on the controller;
  - Nox's and Ember's tails go only for the bass.
- [ ] **Step 2:** In `docs/superpowers/specs/2026-10-21-tamagotchi-critter-picker-design.md`'s status line for "Critters as expressive as Clawd", note batch 2 done (this spec). Only hands and strides (part 3) remain.
- [ ] **Step 3:** `npm run build`, then `bin/check && npm test && uv run pytest -q`.
- [ ] **Step 4:** Commit:

```bash
git add docs/superpowers/specs/2026-10-21-tamagotchi-critter-picker-design.md static/dist/app.js
git commit -m "docs + build: critters play the bass and the controller (THI-415 part 2b, batch 2); static/dist rebuilt"
```
