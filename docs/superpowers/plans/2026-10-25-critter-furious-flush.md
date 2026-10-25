# Furious Critters Flush Red (THI-421) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A furious critter at the desk gets Clawd's pulsing red flush over its silhouette, its eyes and own furious face redrawn crisp on top, and gritted teeth in its shouting mouth (the approved option C with teeth). Clawd stays byte-identical.

**Architecture:**
- **`critters.js`:** gains `FLUSH` and `teethGlyph`.
- **`Critter.jsx`'s `Node`:** gains a `flush` mode, which draws the silhouette unpainted under every existing visibility rule.
- **`Critter`:** when furious, it draws the flush group, then the face nodes again, then the teeth.
- **No `TamaScene` change.** It already passes `mood="furious"` only when furious at the desk.

**Spec:** `docs/superpowers/specs/2026-10-25-critter-furious-flush-design.md`.

## Conventions

- **Worktree:** `.claude/worktrees/critter-flush`, branch `feature/critter-flush`. Run every command from there.
- **Commits:** one per task: a single-line message, a blank line, then `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`. Don't commit `package-lock.json`. Rebuild `static/dist` only in Task 2.
- **Gate:**
  - `npx vitest run static/src/chrome static/src/overlays`
  - `npm test`
  - `bin/check`, which must end "all checks passed"
- **Imports:** Biome's organizeImports order (case-insensitive). Check with `npx biome check --formatter-enabled=false <files>`, and never run `bin/check --fix`.
- **Clawd invariant:** the "Clawd's drawing, pinned" hash must not change. Never edit it.
- **Comments:** explain *why*, tersely.

### Task 0: Worktree

```bash
cd ~/github/tomplex/periscope
git worktree add .claude/worktrees/critter-flush -b feature/critter-flush main
cd .claude/worktrees/critter-flush && npm install --silent && uv sync -q && git checkout -- package-lock.json
npx vitest run static/src/chrome
```

### Task 1: The flush, the face over it, and the teeth

**Files:**
- `static/src/chrome/critters.js`
- `static/src/chrome/Critter.jsx`
- tests in `critters.test.js`, `critterRender.test.jsx` and `tamagotchiRender.test.jsx`

- [ ] **Step 1: Failing tests.**
  - **`critters.test.js`:**
    - For every critter, `teethGlyph(sprite)` is one path whose points all lie inside the widest rect of its furious layer.
    - A synthetic sprite without a furious mouth gives `[]`.
  - **`critterRender.test.jsx`:**
    - `draw({ sprite, mood: "furious" })`:
      - contains `<g class="tama-flush" fill="#ff3b2f">`;
      - inside that group: no `fill=`, no `stroke=` and no `data-mood`;
      - the face's own furious layer (`data-mood="furious"`) appears again after the flush group;
      - the teeth path (`stroke="#f3f5f8"`) comes last.
    - With `mood: "calm"` or `"grumpy"`: no `tama-flush` and no teeth.
    - **Synthetic sprite:** a `rest` node and a `legs` node, drawn furious with `tip` set and `seated`, are absent from the flush group.
    - **Anim classes:** an animated node's `anim` class appears inside the flush group.
    - **The exact-markup pin** stays green.
  - **`tamagotchiRender.test.jsx`,** for every critter:
    - `activity="code" mood="furious" working={2}`: the mascot's critter group (`groupAt`) contains `class="tama-flush"` and a teeth path.
    - `mood="grumpy"` and calm: neither.
    - **Nox furious:**
      - nothing from its resting tail in the flush, because typing makes it reach;
      - the tail's rects `x="15" y="16"` and `x="17" y="12"` are not inside the flush group.
    - **Scope furious:** no foot rect `x="5" y="16"` inside the flush group, because it's seated.
    - **Nox furious:** its outline is in the flush group as `stroke="#ff3b2f" stroke-width="1"`.
    - **Octocat furious:** the same, for its outline.
    - **Typing furious:** the limb's last rect is inside the flush group.
- [ ] **Step 2:** Run the tests and watch them fail.
- [ ] **Step 3: `critters.js`.** Append:

```js
// Furious Clawd's flush (Tamagotchi.jsx MoodFace), washed over a furious
// critter's silhouette by Critter.
export const FLUSH = "#ff3b2f";
const TEETH = "#f3f5f8";

// Clawd's scowl as gritted teeth inside a furious critter's own shouting mouth
// (the widest rect of its furious layer): a four-stroke zig-zag across it. Its
// furious layer already draws a mouth, so a scowl beside it would clash.
export function teethGlyph(sprite) {
  let mouth = null;
  const walk = (n, furious) => {
    const f = furious || n.mood === "furious";
    if (n.r) {
      if (f && n.r[2] >= 2.4 && n.r[3] >= 1.2 && (!mouth || n.r[2] > mouth[2])) mouth = n.r;
      return;
    }
    (n.g || []).forEach((k) => walk(k, f));
  };
  sprite.root.forEach((n) => walk(n, false));
  if (!mouth) return [];
  const [x, y, w, h] = mouth;
  const top = y + h * 0.3, bot = y + h * 0.7, step = w / 4 - 0.05;
  let d = `M${r4(x + 0.1)} ${r4(bot)}`;
  for (let i = 1; i <= 4; i++) d += ` L${r4(x + 0.1 + step * i)} ${r4(i % 2 ? top : bot)}`;
  return [{ p: d, a: { fill: "none", stroke: TEETH, "stroke-width": 0.35, "stroke-linejoin": "miter" } }];
}
```

- [ ] **Step 4: `Critter.jsx`.**
  - **`Node`:**
    - Add `flush` to its props.
    - First line: `if (flush && n.mood) return null;`. Mood layers aren't body.
    - Pass `flush` recursively.
    - For a rect in flush mode, return `<rect class={n.cls} x={x} y={y} width={r4(w + 0.02)} height={r4(h + 0.02)} />`, with no paint. The 0.02 closes seams, as Clawd's `Sprite` does. Import `r4` from `./critters.js`.
    - For a path in flush mode, return `null`.
    - For a group in flush mode, return `<g class={n.anim || n.cls}>` with the children, and no fill, `data-mood` or `data-role`.
    - **Strokes survive in flush mode,** recoloured: a rect or group whose paint has a `stroke` gets `stroke={FLUSH}` and its own `stroke-width`. Nox's and Octocat's outline copies are stroked, and a wash without them leaves their grey outline around a red body (caught by the user on the first draft).
    - Every other existing check (`rest`, `paws`, `seated`, `hide`, `asleep`) applies unchanged.
  - **`Critter`:**
    - Compute `const furious = mood === "furious" && !asleep;`.
    - Compute the face nodes: the top-level nodes that have a `role`, or contain one at any depth, or are `mood === "furious"`.
    - At the very end, after the limb and cheer lines, add the block below. The wash covers the limb too: when typing furiously, the whole critter goes red.

```jsx
      {furious && (
        <g class="tama-flush" fill={FLUSH}>
          {(stride ? strideRoot(sprite) : sprite.root).map((n, i) => <Node key={i} n={n} mood={mood} hide={hide} rest={rest} paws={paws} seated={seated} flush />)}
          {reach && limbGlyphs(sprite, holding, reach).map((n, i) => <Node key={`hold-${i}`} n={n} mood={mood} flush />)}
        </g>
      )}
      {furious && faceNodes.map((n, i) => <Node key={`fu-${i}`} n={n} mood={mood} hide={hide} tint={tint} rest={rest} paws={paws} seated={seated} />)}
      {furious && teethGlyph(sprite).map((n, i) => <Node key={`teeth-${i}`} n={n} mood={mood} tint={tint} />)}
```

    - Extend the comment: "Furious, its silhouette washes red like Clawd's flush (`tama-flush`), with its eyes and own furious face drawn again on top so they stay crisp, and gritted teeth in its shouting mouth (critters.js teethGlyph)."
    - Keep the imports in Biome order.
- [ ] **Step 5:** Run the gate. Clawd's pin and the exact-markup pin must be unchanged.
- [ ] **Step 6:** Commit with `critters: furious, a critter flushes red like Clawd, its face crisp on top and its teeth gritted (THI-421)`.

### Task 2: Hand check, docs, bundle

- [ ] Re-render the furious-at-the-desk row for all critters from the branch, and compare it with the approved draft's row C with teeth.
- [ ] Add a line to the "Critters as expressive as Clawd" status in `docs/superpowers/specs/2026-10-21-tamagotchi-critter-picker-design.md`: furious critters flush red with gritted teeth (THI-421, this spec).
- [ ] Run `npm run build`, then `bin/check && npm test && uv run pytest -q`.
- [ ] Commit the docs, then `static/dist` as `build: static/dist`.
