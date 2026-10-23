# A Critter's Friend and Kids Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a critter is picked, the beer scene's friend is that critter (mirrored, hue-shifted, happy), and the kids are two half-size copies of it. Clawd's scenes stay byte-identical.

**Architecture:**
- **Pure helpers in `critters.js`:** `hueRotate(color, deg)`, and an optional `height` for `placement`.
- **`Critter.jsx`:** a `tint` prop that rotates every fill and stroke.
- **`TamaPastimes.jsx`:** `Friend` and `Kids` draw critter versions when given a critter with a sprite.
- **`Tamagotchi.jsx`:** passes the critter through `PastimeBehind`.

**Tech Stack:** Preact + `preact-render-to-string`; vitest in a node environment; SVG pixel art.

**Spec:** `docs/superpowers/specs/2026-10-22-critter-friend-and-kids-design.md`. Read it first.

---

## Conventions for every task

- **Where to work:** the worktree `.claude/worktrees/critter-friends`, branch `feature/critter-friends`. Run every command from the worktree root.
- **Commits:** one per task, with a single-line message, then a blank line, then exactly `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.
- **Tests:** `npx vitest run <file>`; full suites `npm test` and `uv run pytest -q`.
- **Gate:**
  - `npx biome lint <touched files>` must be clean.
  - `bin/check` must end with "all checks passed"; the 3 Biome warnings in `Rail.jsx` / `spawnAccountPickerRender.test.jsx` are pre-existing.
  - Biome is lint-only. Keep the terse, hand-written style of the surrounding code.
- **Clawd invariant:** `static/src/chrome/__tests__/tamagotchiRender.test.jsx` has two guards:
  - "Clawd's drawing, pinned", a sha256 over 3264 renders;
  - "critter faces follow Clawd's in every scene".

  Both must keep passing. Never edit the hash.
- **Comments** explain *why*, tersely, in the voice of the surrounding code.
- **Don't commit `package-lock.json`.** Rebuild `static/dist` only in Task 4.

---

### Task 0: Worktree

- [ ] **Step 1: Create the worktree from local `main`**

Local `main` is ahead of `origin/main`, so branch from it:

```bash
cd ~/github/tomplex/periscope
git worktree add .claude/worktrees/critter-friends -b feature/critter-friends main
cd .claude/worktrees/critter-friends && npm install --silent && uv sync -q && git checkout -- package-lock.json
npx vitest run static/src/chrome
```

Expected: all pass.

---

### Task 1: `hueRotate` and `placement`'s `height`

**Files:**
- Modify: `static/src/chrome/critters.js`
- Test: `static/src/chrome/__tests__/critters.test.js`

- [ ] **Step 1: Write the failing tests**

Add `hueRotate` to the import from `../critters.js` at the top of `critters.test.js`, keeping the list sorted alphabetically for Biome. Append:

```js
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
```

- [ ] **Step 2: Run and watch them fail**

Run: `npx vitest run static/src/chrome/__tests__/critters.test.js`
Expected: FAIL, because `hueRotate` isn't exported and `height` is ignored.

- [ ] **Step 3: Implement**

In `static/src/chrome/critters.js`, replace `placement`:

```js
export function placement(sprite, { x0, sitting }) {
  const box = spriteBox(sprite);
  const scale = CLAWD_HEIGHT / box.h;
  const bottom = sitting ? SEAT : FEET;
  return {
    scale,
    tx: x0 + 8.5 - scale * (box.x + box.w / 2),
    ty: bottom - scale * (box.y + box.h),
    top: bottom - CLAWD_HEIGHT,
  };
}
```

with:

```js
export function placement(sprite, { x0, sitting, height = CLAWD_HEIGHT }) {
  const box = spriteBox(sprite);
  const scale = height / box.h;
  const bottom = sitting ? SEAT : FEET;
  return {
    scale,
    tx: x0 + 8.5 - scale * (box.x + box.w / 2),
    ty: bottom - scale * (box.y + box.h),
    top: bottom - height,
  };
}
```

Then add `height` to the comment above `placement`. After `as tall as standing Clawd`, insert `(or \`height\`: the kids are half that)`.

Append to the end of `critters.js`:

```js
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
  const l = (max + min) / 2;
  const c = (1 - Math.abs(2 * l - 1)) * (d / (1 - Math.abs(2 * l - 1)));
  const h0 = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  const h = (((h0 * 60 + deg) % 360) + 360) % 360;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const [r1, g1, b1] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x]
    : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  const lift = l - c / 2;
  return `#${[r1, g1, b1].map((v) => Math.round((v + lift) * 255).toString(16).padStart(2, "0")).join("")}`;
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run static/src/chrome`
Expected: all pass. Existing `placement` callers pass no `height`, so they're unchanged.

- [ ] **Step 5: Commit**

```bash
git add static/src/chrome/critters.js static/src/chrome/__tests__/critters.test.js
git commit -m "critters: hueRotate for a friend's colours, and placement takes a height for the kids"
```

---

### Task 2: `Critter` takes a `tint`

**Files:**
- Modify: `static/src/chrome/Critter.jsx`
- Test: `static/src/chrome/__tests__/critterRender.test.jsx`

- [ ] **Step 1: Write the failing tests**

In `critterRender.test.jsx`, add `import { hueRotate } from "../critters.js";`. If `critters.js` is already imported there, add `hueRotate` to that import instead. Inside `describe("<Critter>", …)`, before its closing `});`, add:

```js
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
```

- [ ] **Step 2: Run and watch them fail**

Run: `npx vitest run static/src/chrome/__tests__/critterRender.test.jsx`
Expected: FAIL. The original fills are still drawn.

- [ ] **Step 3: Implement**

In `static/src/chrome/Critter.jsx`:

Change the import to:

```js
import { EYE_FACES, faceGlyphs, hueRotate, startleGlyph } from "./critters.js";
```

Add above `function Node`:

```js
// A friend's colours (TamaPastimes.jsx): every fill and stroke turned by
// `tint` degrees. No tint draws the critter's own paint, untouched.
function painted(a, tint) {
  if (!tint || !a) return a;
  const out = { ...a };
  if (a.fill) out.fill = hueRotate(a.fill, tint);
  if (a.stroke) out.stroke = hueRotate(a.stroke, tint);
  return out;
}
```

In `Node`:
- Change the signature to `function Node({ n, mood, asleep, hide, tint })`.
- Replace every `{...n.a}` with `{...painted(n.a, tint)}`. There are three: the rect, the path and the group.
- Replace `{...n.g[0].a}` in the shut rect with `{...painted(n.g[0].a, tint)}`.
- Pass `tint={tint}` in the recursive `<Node … />`.

In `Critter`:
- Change the signature to `export function Critter({ sprite, mood = "calm", asleep = false, face = null, startle = false, tint = 0 })`.
- Add `tint={tint}` to all three `<Node … />` usages.
- Extend its comment with: `` `tint` turns its colours (a critter's friend). ``

- [ ] **Step 4: Run the tests**

Run: `npx vitest run static/src/chrome static/src/overlays`
Expected: all pass, including the exact-markup pin "draws a sprite exactly as before without a face". With no tint, `painted` returns the same object.

- [ ] **Step 5: Commit**

```bash
git add static/src/chrome/Critter.jsx static/src/chrome/__tests__/critterRender.test.jsx
git commit -m "critter: a tint turns every fill and stroke, for a critter's friend"
```

---

### Task 3: The friend and the kids match the mascot

**Files:**
- Modify: `static/src/chrome/TamaPastimes.jsx` (`Friend`, `Kid`, `Kids`, and the imports)
- Modify: `static/src/chrome/Tamagotchi.jsx` (`PastimeBehind`, and its one call in `TamaScene`)
- Test: `static/src/chrome/__tests__/tamagotchiRender.test.jsx`

- [ ] **Step 1: Write the failing tests**

In `tamagotchiRender.test.jsx`:
- Change the `TamaPastimes.jsx` import to `import { FRIEND_HUE, PASTIME_SCENES } from "../TamaPastimes.jsx";`.
- Add `hueRotate` and `placement` to the `../critters.js` import, keeping it sorted.

Inside `describe("critters at their pastimes", …)`, before its closing `});`, add:

```js
  const count = (html, needle) => html.split(needle).length - 1;

  it("has a beer with a friend of its own kind: mirrored, in other colours, smiling", () => {
    const html = scene(nox, "beer");
    expect(count(html, 'class="critter"')).toBe(2);
    const friend = html.slice(html.indexOf('class="tama-friend"'));
    expect(friend).toMatch(/<g class="tama-critter" style="transform-box: view-box" transform="translate\([^)]*\) scale\(-/);
    expect(friend).toContain('data-face="happy"');
    expect(friend).toContain(`fill="${hueRotate("#c6e05a", FRIEND_HUE)}"`);
    expect(html).not.toContain('fill="#6f93d6"'); // no blue Clawd
    expect(friend).toContain("tama-pint");
  });

  it("plays with two half-size kids of its own kind", () => {
    const html = scene(nox, "kids");
    expect(count(html, 'class="critter"')).toBe(3);
    const kidScale = Math.round(placement(nox.sprite, { x0: 0, sitting: false, height: 5 }).scale * 1e4) / 1e4;
    expect(count(html, `scale(${kidScale})`)).toBe(2);
    expect(count(html, 'class="tama-kid')).toBe(2);
  });

  it("still dresses the kids in sheets on a Halloween evening", () => {
    expect(count(scene(nox, "kids", { trick: true }), 'class="tama-kid-sheet"')).toBe(2);
  });

  it("keeps Clawd's own friend and kids for Clawd", () => {
    expect(render(<TamaScene activity="beer" />)).toContain('fill="#6f93d6"');
    expect(render(<TamaScene activity="beer" />)).not.toContain('class="critter"');
    expect(render(<TamaScene activity="kids" />)).not.toContain('class="critter"');
  });
```

- [ ] **Step 2: Run and watch them fail**

Run: `npx vitest run static/src/chrome/__tests__/tamagotchiRender.test.jsx -t "pastimes"`
Expected: FAIL, because `FRIEND_HUE` isn't exported and the friend and kids are still Clawd.

- [ ] **Step 3: Implement in `TamaPastimes.jsx`**

Add to the imports at the top:

```js
import { Critter } from "./Critter.jsx";
import { CLAWD_HEIGHT, placement } from "./critters.js";
```

Biome sorts imports, so put them in the right order next to the existing `./TamaDishes.jsx` and `./tamagotchi.js` imports, and check with `npx biome lint`.

Replace the friend constants and `Friend`. That's from `// ---- a beer with friends` through the end of `function Friend`, keeping `Pint`, `ClawdPint` and `BULBS` exactly as they are. Concretely:

1. Under `const FRIEND = "#6f93d6";` add:

```js
// A critter's friend is that critter, mirrored, its colours turned this far:
// another individual of the same kind, as Clawd's is Clawd in blue.
export const FRIEND_HUE = 150;
const r4 = (v) => Math.round(v * 1e4) / 1e4;

// Placed like the mascot on the friend's spot, then mirrored about its own
// centre so it faces the mascot. The wrapper carries the view-box pivot for
// the same reason as the mascot's (Tamagotchi.jsx): `.tama g` pivots on its
// fill-box.
function CritterFriend({ sprite }) {
  const { scale, tx, ty } = placement(sprite, { x0: FRIEND_X0, sitting: false });
  const cx = FRIEND_X0 + 8.5;
  return (
    <g class="tama-critter" style="transform-box: view-box"
       transform={`translate(${r4(2 * cx - tx)} ${r4(ty)}) scale(${r4(-scale)} ${r4(scale)})`}>
      <Critter sprite={sprite} face="happy" tint={FRIEND_HUE} />
    </g>
  );
}
```

2. Change `export function Friend() {` to `export function Friend({ critter }) {`. Then replace the four children of `<g class="tama-friend">` with:

```jsx
      <g class="tama-friend">
        {critter?.sprite ? <CritterFriend sprite={critter.sprite} /> : (
          <>
            <Sprite cells={FRIEND_CELLS.body} x0={FRIEND_X0} fill={FRIEND} />
            <Sprite cells={FRIEND_CELLS.legs} x0={FRIEND_X0} y0={Y0 + 2 * BODY.length} fill={FRIEND} />
            <g fill="none" stroke={EYE} stroke-width="0.45" stroke-linecap="square">
              <path d={`M${FRIEND_X0 + 3.8} ${Y0 + 3.5} l0.7 -0.9 l0.7 0.9`} />
              <path d={`M${FRIEND_X0 + 10.8} ${Y0 + 3.5} l0.7 -0.9 l0.7 0.9`} />
            </g>
          </>
        )}
        <Pint x={FRIEND_X0 + 1.2} cls="tama-pint tama-clink tama-clink2" />
      </g>
```

The fragment renders no element, so Clawd's markup is unchanged.

3. Replace `function Kid` and `export function Kids` with:

```jsx
// A critter's kid: the critter at half height on a kid's spot (8.5 wide, so
// centred at x + 4.25), feet on the floor.
function CritterKid({ x, sprite }) {
  const { scale, tx, ty } = placement(sprite, { x0: x - 4.25, sitting: false, height: CLAWD_HEIGHT / 2 });
  return (
    <g class="tama-critter" style="transform-box: view-box" transform={`translate(${r4(tx)} ${r4(ty)}) scale(${r4(scale)})`}>
      <Critter sprite={sprite} />
    </g>
  );
}

function Kid({ x, cls, costume, sprite }) {
  return (
    <g class={cls}>
      {sprite ? <CritterKid x={x} sprite={sprite} /> : (
        <>
          <Sprite cells={KID_CELLS.body} x0={x} y0={14} w={0.5} h={1} />
          <Sprite cells={KID_CELLS.legs} x0={x} y0={18} w={0.5} h={1} />
        </>
      )}
      {costume ? <KidSheet x={x} /> : !sprite && (
        <g fill={EYE}>
          <rect x={x + 2.5} y="15" width="0.5" height="1" />
          <rect x={x + 6} y="15" width="0.5" height="1" />
        </g>
      )}
    </g>
  );
}

export function Kids({ trick = false, critter }) {
  return (
    <g>
      <Kid x={17.4} cls="tama-kid" costume={trick} sprite={critter?.sprite} />
      <Kid x={25.4} cls="tama-kid tama-kid2" costume={trick} sprite={critter?.sprite} />
    </g>
  );
}
```

4. Update the section comments, keeping their voice:
   - The beer one becomes `The friend is Clawd mirrored, in another colour, arm to arm at x 18; a critter's is that critter (CritterFriend).`
   - The kids one becomes `two half-size Clawds (or the picked critter), hand in hand, hopping`.

The test rounds `kidScale` to 4 decimals, as `r4` does in `CritterKid`.

- [ ] **Step 4: Pass the critter through `PastimeBehind`**

In `static/src/chrome/Tamagotchi.jsx`, replace:

```jsx
function PastimeBehind({ p, season, trick }) {
  const drawn = <p.Behind season={season} trick={trick} />;
```

with:

```jsx
// The critter goes to the friend and the kids (TamaPastimes.jsx), which match
// the mascot; the other pastimes' props ignore it.
function PastimeBehind({ p, season, trick, critter }) {
  const drawn = <p.Behind season={season} trick={trick} critter={critter} />;
```

In `TamaScene`, change `<PastimeBehind p={p} season={season} trick={trick} />` to `<PastimeBehind p={p} season={season} trick={trick} critter={critter} />`.

- [ ] **Step 5: Run the tests**

Run: `npx vitest run static/src/chrome static/src/overlays`
Expected: all pass, including "Clawd's drawing, pinned" and "critter faces follow Clawd's in every scene" (unchanged). Then `npx biome lint` on the three touched files, and `bin/check`.

- [ ] **Step 6: Commit**

```bash
git add static/src/chrome/TamaPastimes.jsx static/src/chrome/Tamagotchi.jsx static/src/chrome/__tests__/tamagotchiRender.test.jsx
git commit -m "tamagotchi: a critter's friend is that critter (mirrored, in other colours, smiling) and its kids are half-size copies"
```

---

### Task 4: Hand check, docs, bundle, gate

- [ ] **Step 1: Render the beer and kids scenes for every critter, and look**

Render `TamaScene` for each entry of `CRITTERS` in three scenes: `beer`, `kids`, and `kids` with `trick: true` (Halloween). Use a throwaway `vite-node` script outside the repo, like the earlier hand checks. Leave out the reduced-motion `@media` block from styles.css, so animations run as in the app. Check:
- the friend faces the mascot, reads as the same kind in other colours, smiles, and holds its pint;
- the kids are small copies standing on the floor;
- the Halloween sheets cover them.

If a friend reads poorly, tune `FRIEND_HUE` in `TamaPastimes.jsx`; the tests use the constant.

- [ ] **Step 2: Note it in the critter-picker spec**

In `docs/superpowers/specs/2026-10-21-tamagotchi-critter-picker-design.md`, find the `**Status:**` paragraph under `### Critters as expressive as Clawd`. Append this sentence:

`The beer friend and the kids now match the mascot too (docs/superpowers/specs/2026-10-22-critter-friend-and-kids-design.md).`

- [ ] **Step 3: Bundle and gate**

```bash
npm run build
bin/check && npm test && uv run pytest -q
```

Expected:
- `static/dist/app.js` changes;
- `bin/check` ends "all checks passed";
- vitest and pytest pass.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/2026-10-21-tamagotchi-critter-picker-design.md static/dist/app.js
git commit -m "docs + build: a critter's friend and kids match it; static/dist rebuilt"
```
