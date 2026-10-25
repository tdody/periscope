# Critters' Strides and Legs When Sitting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Critters step their legs on the run, the bike and the dog walk. Scope, Ember, Volt, Moss and Octocat sit without their legs, lowered onto the seat. Nox and Jelly keep theirs. Clawd stays byte-identical.

**Architecture:**
- **SVGs:** mark each critter's legs, `legs` or `legs-kept`; `build_critters.py` emits the flags.
- **`critters.js`:**
  - `strideRoot` builds the two stride frames;
  - `spriteBox(…, { seated })` and `placement` sit a seated critter's body on the seat.
- **`Critter`:** takes `seated` and `stride`.
- **`TamaScene`:** passes them.

**Spec:** `docs/superpowers/specs/2026-10-25-critter-strides-and-seats-design.md`. Read it first.

---

## Conventions for every task

- **Worktree:** `.claude/worktrees/critter-strides`, branch `feature/critter-strides`. Run every command from the worktree root.
- **Commits:** one per task, with a single-line message, a blank line, then exactly `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`. Don't commit `package-lock.json`. Rebuild `static/dist` only in Task 4.
- **Tests:**
  - `uv run pytest tests/test_build_critters.py -q`
  - `npx vitest run static/src/chrome static/src/overlays`
  - `npm test`
- **Linting:** `bin/check` must end "all checks passed". The 3 pre-existing Biome warnings are fine.
- **Imports:** keep them in Biome's organizeImports order (a case-insensitive sort). Check with `npx biome check --formatter-enabled=false <files>`. You may sort with `npx biome check --write --formatter-enabled=false <files>`, then `git diff` to confirm nothing else changed, and fix any spacing it mangles by hand. Never run `bin/check --fix`.
- **Generated files:** never hand-edit `critterSprites.js` or `critters.css`. Run `uv run build_critters.py`. `critters.css` must not change.
- **Clawd invariant:** "Clawd's drawing, pinned" (`tamagotchiRender.test.jsx`) must pass with its current hash. Never edit it.
- **Comments** explain *why*, tersely, in the voice of the surrounding code.

---

### Task 0: Worktree

```bash
cd ~/github/tomplex/periscope
git worktree add .claude/worktrees/critter-strides -b feature/critter-strides main
cd .claude/worktrees/critter-strides && npm install --silent && uv sync -q && git checkout -- package-lock.json
npx vitest run static/src/chrome && uv run pytest tests/test_build_critters.py -q
```

---

### Task 1: Mark the legs (generator + SVGs)

**Files:** `build_critters.py`, `tests/test_build_critters.py`, and `docs/specs/assets/critters/{scope,jelly,nox,ember,volt,moss,octocat}.svg`. Regenerate `static/src/chrome/critterSprites.js`.

- [ ] **Step 1: Failing tests** in `tests/test_build_critters.py`, mirroring the `hold-arms` tests already there.
  - A `<g class="legs">` emits `"legs": True`.
  - A `<g class="legs-kept">` emits `"legs": True, "keepSeated": True`.
  - A `<rect class="legs">` or `<rect class="legs-kept">` is rejected ("must be a <g>").
  - Either class inside a face layer is rejected.
  - **The shipped critters:**
    - each has exactly one node with `legs`, counted recursively;
    - `keepSeated` is set for exactly jelly and nox;
    - the legs nodes are top-level root nodes.
- [ ] **Step 2:** Run the tests and watch them fail.
- [ ] **Step 3: Implement in `build_critters.py`,** following `HOLD_ARMS` exactly.
  - Add next to it:
    ```python
    LEGS = "legs"  # legs that stride, and a seated critter hides (critters.js strideRoot, placement)
    LEGS_KEPT = "legs-kept"  # legs that stride but stay when it sits: Nox's toes, Jelly's tentacles
    ```
  - Add both to:
    - `mood_of`'s skip list and its error listing;
    - the `<rect>` rejection;
    - the face-layer rejection.
  - In `node()`'s `g` branch:
    - `LEGS` sets `out["legs"] = True`;
    - `LEGS_KEPT` sets `out["legs"] = True` and `out["keepSeated"] = True`.
  - Add a docstring line for the two classes.
- [ ] **Step 4: Edit the SVGs** with a Python snippet that asserts each match is unique. Leave the metadata line alone.
  - **scope:** wrap the adjacent `<rect x="5" y="16" width="2" height="2" fill="#2a86b3"></rect>` and `<rect x="13" y="16" width="2" height="2" fill="#2a86b3"></rect>` in `<g class="legs">…</g>`.
  - **jelly:** the `<g fill="#7d62c9">` whose next line is the `animateTransform` with `values="0 0;0.6 0;0 0;-0.6 0"` gets `class="legs-kept"`.
  - **nox:** `<g fill="#3a3f46">` (the toes: `<rect x="6" y="17"…`, `<rect x="12" y="17"…`) gets `class="legs-kept"`.
  - **ember:** the `<g fill="#b8403a">` holding `<rect x="6" y="16" width="2" height="1">` and `<rect x="12" y="16"…>` gets `class="legs"`. This is the feet group, not the `hold-arms` or `hold-rest` ones.
  - **volt:** `<g fill="#d1a92b">` holding `<rect x="5" y="15" width="3" height="1">` gets `class="legs"`.
  - **moss:** `<g fill="#2e9a56">` holding `<rect x="6" y="16" width="2" height="1">` gets `class="legs"`.
  - **octocat:** the bare `<g>` whose next line is the `animateTransform` with `values="0 0;0.4 0;0 0;-0.4 0" dur="1.6s"` gets `class="legs"`.
- [ ] **Step 5:** Run `uv run build_critters.py`. Then:
  - `git diff --stat static/critters.css` is empty;
  - `critterSprites.js` only gains the flags, plus Scope's wrapper group;
  - the tests pass, including `test_committed_output_is_fresh`;
  - `npx vitest run static/src/chrome` still passes, with nothing renderable changed. Scope's markup gains only a wrapper `<g>`; check that the exact-markup and hash pins don't involve it.
- [ ] **Step 6: Commit** `build_critters: mark each critter's legs — legs that stride and hide when it sits, legs-kept for Nox's toes and Jelly's tentacles`.

---

### Task 2: Strides and seats in `critters.js` and `Critter`

**Files:** `static/src/chrome/critters.js`, `static/src/chrome/Critter.jsx`, and their tests.

- [ ] **Step 1: Failing tests.**
  - **`critters.test.js`:**
    - `strideRoot(sprite)` replaces each `legs` root node with `{ g: [n], cls: "tama-legs-a" }`, followed by `{ g: [shifted], cls: "tama-legs-b" }`. Every rect in `shifted` is moved 2 units toward `spriteBox(sprite)`'s centre x: +2 when its own centre is left of it, −2 otherwise. Other nodes are unchanged. Check it for all 7 critters.
    - **Seated placement:**
      - for scope, ember, volt, moss and octocat, `ty + scale·(seated box bottom)` ≈ 17, where the seated box is `spriteBox(sprite, { seated: true })`;
      - `scale` equals the standing scale;
      - `top` equals `ty + scale·box.y`.
    - For nox and jelly, the feet bottom is ≈ 17, unchanged from today.
    - The existing "seats a sitting critter on the seat" (Nox) must still pass.
  - **`critterRender.test.jsx`:**
    - **`seated` on a synthetic sprite:** it hides a top-level and a nested `legs` node, keeps a `legs` + `keepSeated` node, and without `seated` everything draws.
    - **On the real sprites:**
      - `draw({ sprite: scope, seated: true })` has no foot rect `x="5" y="16"`;
      - Nox seated keeps its toes `x="6" y="17"`.
    - **`stride`:** `draw({ sprite: ember, stride: true })` contains `tama-legs-a` and `tama-legs-b`; without it, neither.
- [ ] **Step 2:** Run the tests and watch them fail.
- [ ] **Step 3: Implement in `critters.js`.**
  - `spriteBox(sprite, { seated = false } = {})`: in its walk, skip `n.legs && !n.keepSeated` when `seated`. Extend its comment: with `seated`, it's without the legs a seated critter hides (placement).
  - `placement`:
    ```js
    export function placement(sprite, { x0, sitting, height = CRITTER_HEIGHT }) {
      const box = spriteBox(sprite);
      const scale = height / box.h;
      // Seated, its body ends on the seat as Clawd's does: the legs it hides
      // (`legs`, not `keepSeated`) don't count, at standing's scale.
      const foot = sitting ? (({ y, h }) => y + h)(spriteBox(sprite, { seated: true })) : box.y + box.h;
      const ty = (sitting ? SEAT : FEET) - scale * foot;
      return { scale, tx: x0 + 8.5 - scale * (box.x + box.w / 2), ty, top: ty + scale * box.y };
    }
    ```
    Update `placement`'s comment block to match.
  - `strideRoot`:
    ```js
    // A striding critter's legs (TamaScene, on the run, the bike, the dog walk):
    // its stance (tama-legs-a) and every leg rect two units toward its middle
    // (tama-legs-b), swapped by styles.css on the scene's tempo like Clawd's
    // tamagotchi.js LEGS. Two units, not Clawd's one: one read too subtle at a
    // critter's scale.
    export function strideRoot(sprite) {
      const box = spriteBox(sprite);
      const mid = box.x + box.w / 2;
      const step = (n) => n.r
        ? { ...n, r: [r4(n.r[0] + (n.r[0] + n.r[2] / 2 < mid ? 2 : -2)), ...n.r.slice(1)] }
        : { ...n, g: n.g.map(step) };
      return sprite.root.flatMap((n) => n.legs ? [{ g: [n], cls: "tama-legs-a" }, { g: [step(n)], cls: "tama-legs-b" }] : [n]);
    }
    ```
- [ ] **Step 4: Implement in `Critter.jsx`.**
  - `Node` takes `seated`, with `if (seated && n.legs && !n.keepSeated) return null;` next to the `paws` check. Pass it recursively.
  - `Critter` takes `seated = false` and `stride = false`.
    - The root map becomes `(stride ? strideRoot(sprite) : sprite.root).map(…)`, passing `seated={seated}`.
    - Extend the comment: "`seated`: the legs it hides sitting go (critters.js placement lowers it onto the seat); `stride`: its legs step (critters.js strideRoot)."
- [ ] **Step 5:** `npx vitest run static/src/chrome static/src/overlays`: all pass, including both pins.
  - Some existing tests may pin a seated critter's placement, headDy or hat seat with numbers derived from the old feet-on-seat rule. Update them only where they compute from `placement()`, and stop and report anything else.
  - Clawd's hash must not change.
- [ ] **Step 6:** Commit `critters: legs that step when a critter strides, and go when it sits — its body lowered onto the seat`.

---

### Task 3: Wire `TamaScene`

**Files:** `static/src/chrome/Tamagotchi.jsx`, `static/src/chrome/__tests__/tamagotchiRender.test.jsx`.

- [ ] **Step 1: Failing tests** in `tamagotchiRender.test.jsx`, in a new `describe("critters' strides and seats")`, using the module-level helpers (`holders`, `count`, `inside`, `drawnPlace`, `groupAt`).
  - **For every critter, in `run`, `cycle` and `dog`:**
    - the mascot's wrapper contains `class="tama-legs-a"` and `class="tama-legs-b"`;
    - in `code` and `beer` (no stride), there's no `tama-legs-b` in the mascot.
  - **For every critter, in `code`, `read`, `game`, `sled` (winter), `swim` and `nap` (walled):**
    - scope, ember, volt, moss and octocat draw none of their legs node's rects in the mascot. Take the needles from `critterSprites.js`'s legs node: e.g. scope `x="5" y="16"`, ember `x="6" y="16"`.
    - nox's toes and jelly's tentacles are still drawn;
    - `drawnPlace(html).ty + scale × spriteBox(sprite, { seated: true }) bottom` ≈ 17.
- [ ] **Step 2:** Run the tests and watch them fail.
- [ ] **Step 3: Implement in `Tamagotchi.jsx`.** The wrapper's `<Critter …>` gains `seated={sitting} stride={!!p?.stride}`. Update the comment above `const sprite = critter.sprite;`: a critter now strides and sits without the legs it hides; only Clawd's own drawings stay his.
- [ ] **Step 4:** `npx vitest run static/src/chrome static/src/overlays`, then `npm test`, then `bin/check`.
  - The parity tests and the batch 1, batch 2 and hands tests must still pass.
  - The seated desk reaches and the controller follow `place`.
  - If a hands test pinned a seated number not derived from `drawnPlace`, fix it to derive from it. Report it.
- [ ] **Step 5:** Commit `tamagotchi: critters stride on the run, the bike and the dog walk, and sit without their legs`.

---

### Task 4: Hand check, docs, bundle, gate

- [ ] **Step 1:** Re-render the stride rows (both frames held still, then live), the seated rows, and the full every-scene grid from the branch. Compare with the approved draft.
- [ ] **Step 2:** Update the picker spec's status line (`docs/superpowers/specs/2026-10-21-tamagotchi-critter-picker-design.md`): THI-415 part 3 is done, and with it the "Critters as expressive as Clawd" follow-up.
- [ ] **Step 3:** Run `npm run build`, then `bin/check && npm test && uv run pytest -q`.
- [ ] **Step 4:** Commit the docs, then `static/dist` as `build: static/dist`.
