# Critters' Hands at the Desk Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Critters type when grumpy or furious, raise their arms when celebrating, and slap the service bell, all with their own appendages, matching the approved draft. Clawd stays byte-identical.

**Architecture:**
- **`critters.js`:**
  - `cheerGlyphs(sprite)`: raised bars over the `hold-arms` rects, or the limb waving up.
  - `cheersWithLimb(sprite)`.
- **`Critter`:** gains `cheer`, and a resting tail also goes when it cheers with the limb.
- **`TamaPastimes.jsx`:** exports batch 2's `Paw`.
- **`TamaDuty.jsx`:** gains the desk's reach points (`KEYS_REACH`, `BELL_REACH`) and the critter's paws (`TypingPaws`, `SlapPaw`).
- **`TamaScene`:**
  - passes the critter a `tip` mapped from those points (`sceneToSprite` through the drawn placement);
  - passes `cheer` when it celebrates at the desk;
  - draws the paws in front of the critter.

**Tech Stack:** Preact plus `preact-render-to-string` (vitest), SVG pixel art.

**Spec:** `docs/superpowers/specs/2026-10-24-critter-hands-design.md`. Read it first.

---

## Conventions for every task

- **Worktree:** `.claude/worktrees/critter-hands`, branch `feature/critter-hands`. Run every command from the worktree root.
- **Commits:** one per task, with a single-line message, a blank line, then exactly `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`. Don't commit `package-lock.json`. Rebuild `static/dist` only in Task 3.
- **Tests:**
  - `npx vitest run static/src/chrome static/src/overlays`
  - `npm test`
- **Linting:**
  - `npx biome lint static/src/chrome`
  - `bin/check` must end "all checks passed". 3 pre-existing Biome warnings, in `Rail.jsx` and `spawnAccountPickerRender.test.jsx`, are fine.
  - Keep import lists in Biome's organizeImports order. Check with `npx biome check --formatter-enabled=false <files>`. Never run `bin/check --fix`: with the formatter off, it mangles lines.
- **Clawd invariant:**
  - "Clawd's drawing, pinned" (`tamagotchiRender.test.jsx`) must pass with its current hash. Never edit it. Nothing here changes Clawd.
  - `critterRender.test.jsx`'s exact-markup pin must pass too.
- **Comments** explain *why*, tersely, in the voice of the surrounding code.

---

### Task 0: Worktree

```bash
cd ~/github/tomplex/periscope
git worktree add .claude/worktrees/critter-hands -b feature/critter-hands main
cd .claude/worktrees/critter-hands && npm install --silent && uv sync -q && git checkout -- package-lock.json
npx vitest run static/src/chrome
```

---

### Task 1: A critter's arms go up

**Files:**
- Modify: `static/src/chrome/critters.js`, `static/src/chrome/Critter.jsx`
- Test: `static/src/chrome/__tests__/critters.test.js`, `static/src/chrome/__tests__/critterRender.test.jsx`

- [ ] **Step 1: Write the failing tests**

In `critters.test.js`:
- add `cheerGlyphs` and `cheersWithLimb` to the sorted `../critters.js` import;
- add:

```js
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
```

In `critterRender.test.jsx`, inside `describe("<Critter>", …)`, add:

```js
  it("cheers: raises its side arms, or waves its limb (and a resting tail it waves goes)", () => {
    const nox = critterById("nox").sprite;
    const waving = draw({ sprite: nox, cheer: true });
    expect(waving).toContain('<g class="tama-cheer">');
    expect(waving).not.toContain("crit-nox-1");
    const ember = critterById("ember").sprite;
    const arms = draw({ sprite: ember, cheer: true });
    expect(arms).toContain('class="tama-cheer"');
    expect(arms).toContain('class="tama-cheer tama-cheer2"');
    expect(arms).toContain("crit-ember-1"); // its tail stays: its arms do the cheering
    expect(draw({ sprite: ember })).not.toContain("tama-cheer");
  });
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `npx vitest run static/src/chrome/__tests__/critters.test.js static/src/chrome/__tests__/critterRender.test.jsx`

- [ ] **Step 3: Implement in `critters.js`**

Append the code below. `r4`, `spriteBox` and `limbGlyphs` are already in the file.

```js
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
```

- [ ] **Step 4: Implement in `Critter.jsx`**

1. Add `cheerGlyphs` and `cheersWithLimb` to the `./critters.js` import, keeping Biome's order.
2. Add `cheer = false` to `Critter`'s parameters, after `paws`.
3. Compute `const rest = !!reach || (cheer && cheersWithLimb(sprite));` and pass `rest={rest}` on the root map, replacing `rest={!!reach}`.
4. After the limb line, add:

```jsx
      {cheer && cheerGlyphs(sprite).map((n, i) => <Node key={`cheer-${i}`} n={n} mood={mood} tint={tint} />)}
```

5. Extend the comment: "`cheer`: its arms up when it celebrates at the desk (critters.js cheerGlyphs); a resting tail it waves goes."

- [ ] **Step 5: Run the tests**

Run `npx vitest run static/src/chrome static/src/overlays`. Everything must pass, including both pins. Then run `npx biome lint static/src/chrome` and `bin/check`.

- [ ] **Step 6: Commit**

```bash
git add static/src/chrome/critters.js static/src/chrome/Critter.jsx static/src/chrome/__tests__/critters.test.js static/src/chrome/__tests__/critterRender.test.jsx
git commit -m "critters: a critter's arms go up — its own side arms, or its limb waving (cheerGlyphs)"
```

---

### Task 2: Typing, the bell and arms up at the desk

**Files:**
- Modify: `static/src/chrome/TamaPastimes.jsx`, `static/src/chrome/TamaDuty.jsx`, `static/src/chrome/Tamagotchi.jsx`
- Test: `static/src/chrome/__tests__/tamagotchiRender.test.jsx`

- [ ] **Step 1: Write the failing tests**

In `tamagotchiRender.test.jsx`, hoist `count`, `inside`, `drawnPlace` and `groupAt` from inside `describe("critters at their pastimes", …)` to module scope (just above that describe), unchanged, so a second describe can use them. Then:
- add `KEYS_REACH` and `BELL_REACH` to an import from `../TamaDuty.jsx`, creating it if needed;
- add `cheerGlyphs` to the `../critters.js` import, alongside `limbGlyphs` and `sceneToSprite`, which are already imported;
- add:

```js
describe("critters' hands at the desk", () => {
  const holders = CRITTERS.filter((c) => c.sprite).map((c) => [c.id, c]);
  const duty = (kind) => ({ duty: { kind, label: "1", urgent: false, more: 0 } });
  const mascotOf = (html) => html.slice(html.indexOf('class="tama-creature'));
  // The limb's last rect, as Node draws it, for a reach to a scene point through the drawn placement.
  const limbEnd = (c, html, point) => {
    const [x, y, w, h] = limbGlyphs(c.sprite, null, sceneToSprite(drawnPlace(html), point)).at(-1).g.at(-1).r;
    return `<rect x="${x}" y="${y}" width="${w}" height="${h}">`;
  };

  it.each(holders)("%s types when grumpy or furious: its limb at the keys, two paws tapping", (_id, c) => {
    for (const mood of ["grumpy", "furious"]) {
      const html = render(<TamaScene activity="code" mood={mood} working={2} critter={c} />);
      const mascot = mascotOf(html);
      expect(mascot, mood).toContain(limbEnd(c, html, KEYS_REACH));
      const fill = `fill="${c.sprite.limb.color}"`;
      expect(mascot).toMatch(new RegExp(`<rect class="tama-hand" x="20.7" y="11.9"[^>]*${fill}`));
      expect(mascot).toMatch(new RegExp(`<rect class="tama-hand tama-hand2" x="22.7" y="11.9"[^>]*${fill}`));
      expect(mascot).not.toContain(`fill="${SKIN}"`); // not Clawd's hands
    }
  });

  it.each(holders)("%s slaps the service bell, at the desk and when it wakes from the walled nap", (_id, c) => {
    const desk = render(<TamaScene activity="code" critter={c} {...duty("bell")} />);
    const nap = render(<TamaScene activity="nap" walled={{ day: null, time: "3pm" }} critter={c} {...duty("bell")} />);
    for (const html of [desk, nap]) {
      const mascot = mascotOf(html);
      expect(mascot).toContain(limbEnd(c, html, BELL_REACH));
      expect(mascot).toMatch(new RegExp(`<rect class="tama-slap" x="21.6" y="8.7"[^>]*fill="${c.sprite.limb.color}"`));
      expect(mascot).not.toContain(`fill="${SKIN}"`);
    }
  });

  it.each(holders)("%s puts its arms up for a done and a merged PR", (_id, c) => {
    for (const kind of ["done", "merged"]) {
      const html = render(<TamaScene activity="code" critter={c} {...duty(kind)} party={kind === "merged"} />);
      const wrapAt = html.indexOf('<g class="tama-critter"', html.indexOf('class="tama-creature'));
      expect(inside(html, wrapAt, 'class="tama-cheer'), kind).toBe(true);
      expect(count(html, 'class="tama-cheer')).toBeGreaterThanOrEqual(cheerGlyphs(c.sprite).length);
      expect(mascotOf(html)).not.toContain(`fill="${SKIN}"`); // not Clawd's ArmsUp
    }
  });

  it("keeps the hands for their moments: no paws or cheer while calmly coding", () => {
    for (const [, c] of holders) {
      const html = render(<TamaScene activity="code" working={2} critter={c} />);
      expect(html).not.toContain("tama-hand");
      expect(html).not.toContain("tama-cheer");
      expect(html).not.toContain("tama-slap");
    }
  });
});
```

`count(html, 'class="tama-cheer')` counts the bars, plus the wave group for a limb waver. Adjust it to what's true if the exact count differs, keeping the intent: the cheer glyphs are drawn in the critter's wrapper.

Check the props `TamaScene` actually takes for a duty, `party`, `walled` and `working`. Copy the shapes the existing desk tests use (search for `duty={` or a `duty(` helper in the file) and follow them.

- [ ] **Step 2: Run the tests and watch them fail**

Run: `npx vitest run static/src/chrome/__tests__/tamagotchiRender.test.jsx -t "hands at the desk"`

- [ ] **Step 3: Implement**

1. **`TamaPastimes.jsx`:** `function Paw` becomes `export function Paw`. Its comment gains "(TamaDuty's TypingPaws / SlapPaw use it at the desk)".

2. **`TamaDuty.jsx`:** add `import { Paw } from "./TamaPastimes.jsx";`, keeping Biome's order. Next to `SlapHand`, add:

```jsx
// A critter's hands at the desk (TamaScene), on Clawd's own spots: its limb
// reaches these points (critters.js sceneToSprite, through its placement) and
// its paws tap and slap where his hands do. The desk doesn't move with x0.
export const KEYS_REACH = [21.25, 12.3];
export const BELL_REACH = [22.2, 9.6];

export function TypingPaws({ limb }) {
  return (
    <g>
      <Paw limb={limb} x={20.7} y={11.9} w={1.1} h={0.8} cls="tama-hand" />
      <Paw limb={limb} x={22.7} y={11.9} w={1.1} h={0.8} cls="tama-hand tama-hand2" />
    </g>
  );
}

export function SlapPaw({ limb }) {
  return <Paw limb={limb} x={21.6} y={8.7} w={1.2} h={0.9} cls="tama-slap" />;
}
```

3. **`Tamagotchi.jsx`:**
   - Import `BELL_REACH`, `KEYS_REACH`, `SlapPaw` and `TypingPaws` from `./TamaDuty.jsx`, adding them to the existing multi-name import and keeping Biome's order.
   - After `fret`, add:

```js
  // At the desk a critter's limb reaches the keyboard when it's moody and the
  // service bell when the bell's on duty there (TamaDuty KEYS_REACH /
  // BELL_REACH), through the placement it's drawn with, like the fret.
  const deskTip = sprite && (moody ? KEYS_REACH : deskBell ? BELL_REACH : null);
  const tip = fret ?? (deskTip ? sceneToSprite(place, deskTip) : null);
```

   - In the wrapper's `<Critter …>`, replace `tip={fret}` with `tip={tip}`, and add `cheer={atDesk && celebrating}`.
   - Next to `{!sprite && deskBell && <SlapHand />}`, add:

```jsx
        {sprite && moody && <TypingPaws limb={sprite.limb} />}
        {sprite && deskBell && <SlapPaw limb={sprite.limb} />}
```

   - Update the comment above `const sprite = critter.sprite;` that ends "only Clawd's own hands (MoodFace's typing hands, ArmsUp, SlapHand) are Clawd-only". A critter now types, cheers and slaps with its own appendages (critters.js cheerGlyphs, TamaDuty TypingPaws / SlapPaw); only Clawd's drawings of those stay his.

- [ ] **Step 4: Run the tests**

Run `npx vitest run static/src/chrome static/src/overlays`. Everything must pass, and "Clawd's drawing, pinned" must stay unchanged. The parity tests ("critter faces follow Clawd's…", "hats and worn props follow…") must still pass. If one fails because a critter now legitimately draws hands, stop and report.

Then run `npm test`, `npx biome lint static/src/chrome` and `bin/check`.

- [ ] **Step 5: Commit**

```bash
git add static/src/chrome/TamaPastimes.jsx static/src/chrome/TamaDuty.jsx static/src/chrome/Tamagotchi.jsx static/src/chrome/__tests__/tamagotchiRender.test.jsx
git commit -m "tamagotchi: critters type when moody, slap the service bell and put their arms up, with their own appendages"
```

---

### Task 3: Hand check, docs, bundle, gate

- [ ] **Step 1:** Re-render the desk rows (grumpy, furious, done, merged, the desk bell, the nap bell) and the full every-scene grid from the branch with a throwaway vite-node script outside the repo. Compare with the approved draft.
- [ ] **Step 2:** Update the status line of "Critters as expressive as Clawd" in `docs/superpowers/specs/2026-10-21-tamagotchi-critter-picker-design.md`: hands are done (this spec), and strides and legs-when-sitting remain.
- [ ] **Step 3:** Run `npm run build`, then `bin/check && npm test && uv run pytest -q`.
- [ ] **Step 4:** Commit the docs, then `static/dist` as `build: static/dist`.
