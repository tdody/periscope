# Critter Hats and Worn Props Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Critters wear Clawd's hats (Santa, party, toque, helmet, snowcap), fitted to their own heads, and get the goggles and the scarf back, rebuilt around their own eyes and neck. Clawd stays byte-identical.

**Architecture:**
- **Generator.** Each critter SVG declares `data-hat="cx top w"` and `data-neck="y x0 x1"`. `build_critters.py` emits them as `anchors.hat` / `anchors.neck`.
- **Pure helpers.** `critters.js` gains `hatTransform(sprite)` (Clawd's head mapped onto the hat seat) and `wornGlyphs(sprite, kind)` (goggles and scarf as sprite nodes).
- **Rendering.** `Critter` gains a `worn` prop. `TamaScene` draws a critter's hats inside its wrapper under `hatTransform`, and guards Clawd's own hat code with `!sprite`.

**Tech Stack:** Python 3 (pytest), Preact + `preact-render-to-string` (vitest, node environment), SVG pixel art.

**Spec:** `docs/superpowers/specs/2026-10-23-critter-hats-and-worn-props-design.md`. Read it first.

---

## Conventions for every task

- **Where to work:** the worktree `.claude/worktrees/critter-hats`, branch `feature/critter-hats`. Run every command from the worktree root.
- **Commits:** one per task, a single-line message, a blank line, then exactly `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`. Don't commit `package-lock.json`. Rebuild `static/dist` only in Task 4.
- **Tests:**
  - Python: `uv run pytest tests/test_build_critters.py -q`
  - JavaScript: `npx vitest run <file>`
  - Full suites: `npm test` and `uv run pytest -q`
- **Linting:**
  - After editing Python, run `uv run ruff format build_critters.py tests/test_build_critters.py`.
  - `npx biome lint` must be clean on the touched JS files.
  - `bin/check` must end with "all checks passed". The 3 warnings in `Rail.jsx` / `spawnAccountPickerRender.test.jsx` are pre-existing.
- **Generated files:** never hand-edit `static/src/chrome/critterSprites.js` or `static/critters.css`. Re-run `uv run build_critters.py`.
- **Clawd invariant:** `tamagotchiRender.test.jsx` has three guards that must keep passing. Never edit the hash.
  - "Clawd's drawing, pinned";
  - "critter faces follow Clawd's in every scene";
  - the existing Clawd hat, goggle and scarf tests.
- **Comments** explain *why*, tersely, in the voice of the surrounding code.

---

### Task 0: Worktree

- [ ] **Step 1: Create the worktree and confirm a green start**

```bash
cd ~/github/tomplex/periscope
git worktree add .claude/worktrees/critter-hats -b feature/critter-hats main
cd .claude/worktrees/critter-hats && npm install --silent && uv sync -q && git checkout -- package-lock.json
npx vitest run static/src/chrome && uv run pytest tests/test_build_critters.py -q
```

Expected: all pass.

---

### Task 1: Declared hat and neck anchors

**Files:**
- Modify: `build_critters.py`
- Modify: all 7 `docs/specs/assets/critters/*.svg` (root attributes only)
- Regenerate: `static/src/chrome/critterSprites.js`, `static/critters.css`
- Test: `tests/test_build_critters.py`

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_build_critters.py`. `_svg(tmp_path, body, g_attrs="", svg_attrs="")`, `_sprite(cid)`, `BODY` and `EYE` already exist.

```python
def test_declared_hat_and_neck_become_anchors(tmp_path):
    s = build_critters.convert(
        "t", _svg(tmp_path, BODY + EYE, svg_attrs=' data-hat="10 4 8" data-neck="12.5 3 17"'), build_critters.Sheet()
    )
    assert s["anchors"]["hat"] == {"cx": 10, "top": 4, "w": 8}
    assert s["anchors"]["neck"] == {"y": 12.5, "x0": 3, "x1": 17}


def test_convert_leaves_undeclared_anchors_out(tmp_path):
    s = build_critters.convert("t", _svg(tmp_path, BODY + EYE), build_critters.Sheet())
    assert "hat" not in s["anchors"] and "neck" not in s["anchors"]


@pytest.mark.parametrize(
    "attrs,match",
    [
        (' data-hat="10 4"', "3 numbers"),
        (' data-hat="10 4 wide"', "3 numbers"),
        (' data-hat="10 4 0"', "width"),
        (' data-neck="12 17 3"', "x0"),
        (' data-neck="12 3"', "3 numbers"),
    ],
)
def test_raises_on_a_malformed_anchor(tmp_path, attrs, match):
    with pytest.raises(ValueError, match=match):
        build_critters.convert("t", _svg(tmp_path, BODY + EYE, svg_attrs=attrs), build_critters.Sheet())


def test_every_shipped_critter_declares_its_hat_and_neck():
    for cid in build_critters.CRITTERS:
        anchors = _sprite(cid)["anchors"]
        assert "hat" in anchors and "neck" in anchors, cid


def test_render_raises_for_a_critter_without_a_hat_or_neck(tmp_path, monkeypatch):
    _svg(tmp_path, BODY + EYE)  # writes tmp_path/bad.svg, no data-hat / data-neck
    monkeypatch.setattr(build_critters, "SRC", tmp_path)
    monkeypatch.setattr(build_critters, "CRITTERS", ["bad"])
    with pytest.raises(ValueError, match="data-hat"):
        build_critters.render()
```

- [ ] **Step 2: Run and watch them fail**

Run: `uv run pytest tests/test_build_critters.py -q -k "anchor or hat or neck"`
Expected: FAIL, with `KeyError: 'hat'` and DID NOT RAISE.

- [ ] **Step 3: Implement in `build_critters.py`**

After `anchors_of`, add:

```python
def numbers(svg_name: str, doc: ET.Element, attr: str, n: int) -> list[float] | None:
    """An attribute holding n space-separated numbers, or None when it's absent."""
    raw = doc.get(attr)
    if raw is None:
        return None
    try:
        vals = [num(p) for p in raw.split()]
    except ValueError:
        vals = []
    if len(vals) != n:
        raise ValueError(f"{svg_name}: {attr} must be {n} numbers, got {raw!r}")
    return vals


def declared_anchors(svg_name: str, doc: ET.Element) -> dict:
    """The anchors a critter declares rather than the drawing showing them: where a hat sits
    (data-hat="cx top w") and its neck row (data-neck="y x0 x1"). An antenna, ears, horns or a
    dome all sit above the head, so no box of the drawing says where a hat goes."""
    out = {}
    hat = numbers(svg_name, doc, "data-hat", 3)
    if hat is not None:
        cx, top, w = hat
        if w <= 0:
            raise ValueError(f"{svg_name}: data-hat width must be > 0, got {w}")
        out["hat"] = {"cx": cx, "top": top, "w": w}
    neck = numbers(svg_name, doc, "data-neck", 3)
    if neck is not None:
        y, x0, x1 = neck
        if x0 >= x1:
            raise ValueError(f"{svg_name}: data-neck x0 must be left of x1, got {x0} and {x1}")
        out["neck"] = {"y": y, "x0": x0, "x1": x1}
    return out
```

In `_convert`, replace `"anchors": anchors_of(root),` with `"anchors": {**anchors_of(root), **declared_anchors(svg.name, doc)},`.

In `render()`, right after `sprites = {cid: convert(cid, SRC / f"{cid}.svg", sheet) for cid in CRITTERS}`, add:

```python
    for cid, s in sprites.items():
        # Required for the shipped critters (a hat and a scarf need them), not by convert(),
        # so the synthetic test SVGs stay minimal.
        missing = [a for a in ("hat", "neck") if a not in s["anchors"]]
        if missing:
            raise ValueError(f"{cid}.svg: declare data-hat and data-neck on the <svg> (missing: {', '.join(missing)})")
```

In the module docstring's conventions list, add after the `data-ink` lines:

```
  - every critter declares where a hat sits and its neck row on the <svg>:
    data-hat="cx top w" and data-neck="y x0 x1" (sprite units).
```

- [ ] **Step 4: Declare the anchors on the 7 critters**

```bash
python3 - <<'EOF'
from pathlib import Path
A = {
    "scope": ("10 6 12", "13 3 17"), "jelly": ("10 3 8", "10.5 4 16"), "nox": ("10 5 9", "12 6 14"),
    "ember": ("10 5 10", "12.6 4 16"), "volt": ("10 6 10", "12.4 3 17"), "moss": ("10 4 7", "12.4 5 15"),
    "octocat": ("10 4 12", "11.6 4 16"),
}
for cid, (hat, neck) in A.items():
    p = Path(f"docs/specs/assets/critters/{cid}.svg")
    s = p.read_text()
    assert "data-hat" not in s
    p.write_text(s.replace("<svg ", f'<svg data-hat="{hat}" data-neck="{neck}" ', 1))
EOF
uv run build_critters.py
```

Expected: `git diff --stat static/critters.css` shows no change. `critterSprites.js` gains `hat` and `neck` in every sprite's `anchors`.

- [ ] **Step 5: Run the tests**

Run: `uv run ruff format build_critters.py tests/test_build_critters.py && uv run pytest tests/test_build_critters.py -q && npx vitest run static/src/chrome`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add build_critters.py tests/test_build_critters.py docs/specs/assets/critters/*.svg static/src/chrome/critterSprites.js static/critters.css
git commit -m "critters: each critter declares where a hat sits and its neck row (data-hat, data-neck), emitted as anchors"
```

---

### Task 2: `hatTransform`, `wornGlyphs` and `Critter`'s `worn`

**Files:**
- Modify: `static/src/chrome/critters.js`, `static/src/chrome/Critter.jsx`
- Test: `static/src/chrome/__tests__/critters.test.js`, `static/src/chrome/__tests__/critterRender.test.jsx`

- [ ] **Step 1: Write the failing tests**

In `critters.test.js`, add `hatTransform` and `wornGlyphs` to the `../critters.js` import (keep it sorted). Append:

```js
describe("hatTransform", () => {
  it("maps Clawd's head top-centre onto the critter's hat seat, at its width", () => {
    const sprite = critterById("nox").sprite;
    const { cx, top, w } = sprite.anchors.hat;
    expect(hatTransform(sprite)).toBe(`translate(${cx} ${top}) scale(${Math.round((w / 12) * 1e4) / 1e4}) translate(-9 -9)`);
  });
});

describe("wornGlyphs", () => {
  const scope = critterById("scope").sprite;
  const moss = critterById("moss").sprite;

  it("puts a goggle lens around each eye, and a strap across them", () => {
    const [goggles] = wornGlyphs(scope, "goggles");
    expect(goggles.cls).toBe("tama-goggles");
    const [strap, ...lenses] = goggles.g;
    expect(lenses).toHaveLength(scope.anchors.eyes.length);
    lenses.forEach(({ r: [x, y, w, h] }, i) => {
      const e = scope.anchors.eyes[i];
      expect(x).toBeLessThan(e.x);
      expect(y).toBeLessThan(e.y);
      expect(x + w).toBeGreaterThan(e.x + e.w);
      expect(y + h).toBeGreaterThan(e.y + e.h);
    });
    const [sx, , sw] = strap.r;
    expect(sx).toBeLessThan(Math.min(...scope.anchors.eyes.map((e) => e.x)));
    expect(sx + sw).toBeGreaterThan(Math.max(...scope.anchors.eyes.map((e) => e.x + e.w)));
    expect(wornGlyphs(moss, "goggles")[0].g).toHaveLength(2); // one-eyed: a strap and one lens
  });

  it("wraps the scarf along the neck row, its tail animated", () => {
    const [scarf] = wornGlyphs(scope, "scarf");
    const { y, x0, x1 } = scope.anchors.neck;
    expect(scarf.cls).toBe("tama-scarf");
    const [band, , tail] = scarf.g;
    expect(band.r).toEqual([x0, y, x1 - x0, 1.6]);
    expect(tail.cls).toBe("tama-scarf-tail");
  });

  it("draws nothing it doesn't know", () => {
    expect(wornGlyphs(scope, "monocle")).toEqual([]);
  });
});
```

In `critterRender.test.jsx`, inside `describe("<Critter>", …)` before its closing `});`, add:

```js
  it("wears goggles or a scarf when told to, marked on its group", () => {
    const sprite = critterById("scope").sprite;
    expect(draw({ sprite, worn: "goggles" })).toContain('data-worn="goggles"');
    expect(draw({ sprite, worn: "goggles" })).toContain('class="tama-goggles"');
    expect(draw({ sprite, worn: "scarf" })).toContain('class="tama-scarf-tail"');
    expect(draw({ sprite })).not.toContain("data-worn");
  });
```

- [ ] **Step 2: Run and watch them fail**

Run: `npx vitest run static/src/chrome/__tests__/critters.test.js static/src/chrome/__tests__/critterRender.test.jsx`
Expected: FAIL. `hatTransform` and `wornGlyphs` don't exist, and there's no `data-worn`.

- [ ] **Step 3: Implement in `critters.js`**

Append. `r4` is already defined in this file.

```js
// Clawd's hats are drawn for his head: its top centre at (9, 9) with x0 = 0,
// 12 wide (Tamagotchi.jsx's SantaHat/PartyHat, TamaPastimes' Toque/Helmet,
// the snowcap). This maps that head onto a critter's hat seat (anchors.hat,
// declared in its SVG), in sprite units, so a hat sizes to the head and bobs
// with it.
export function hatTransform(sprite) {
  const { cx, top, w } = sprite.anchors.hat;
  return `translate(${cx} ${top}) scale(${r4(w / 12)}) translate(-9 -9)`;
}

// What a critter wears for a pastime, rebuilt around its own eyes and neck:
// Clawd's Goggles and Scarf (TamaPastimes.jsx) sit on his eyes and neck row.
// Nodes in the sprite tree's format, in Clawd's colours and classes.
export function wornGlyphs(sprite, kind) {
  if (kind === "goggles") {
    const { eyes } = sprite.anchors;
    const y = eyes.reduce((s, e) => s + e.y + e.h / 2, 0) / eyes.length;
    const x0 = Math.min(...eyes.map((e) => e.x)) - 2;
    const x1 = Math.max(...eyes.map((e) => e.x + e.w)) + 2;
    const lens = { rx: 1, fill: "#7fd1e6", "fill-opacity": 0.45, stroke: "#2b2f36", "stroke-width": 0.5 };
    return [{
      cls: "tama-goggles",
      g: [
        { r: [r4(x0), r4(y - 0.4), r4(x1 - x0), 0.8], a: { fill: "#2b2f36" } },
        ...eyes.map((e) => ({ r: [r4(e.x - 0.6), r4(e.y - 0.6), r4(e.w + 1.2), r4(e.h + 1.2)], a: lens })),
      ],
    }];
  }
  if (kind === "scarf") {
    const { y, x0, x1 } = sprite.anchors.neck;
    const stripes = [];
    for (let x = x0 + 2; x < x1; x += 3) stripes.push({ r: [r4(x), y, 0.7, 1.6] });
    return [{
      cls: "tama-scarf",
      g: [
        { r: [x0, y, r4(x1 - x0), 1.6], a: { fill: "#d64541" } },
        { g: stripes, a: { fill: "#f4f4f6" } },
        { r: [r4(x0 - 3), r4(y + 0.3), 3.6, 1.1], cls: "tama-scarf-tail", a: { fill: "#d64541" } },
      ],
    }];
  }
  return [];
}
```

- [ ] **Step 4: Implement in `Critter.jsx`**

1. Change the import to `import { EYE_FACES, faceGlyphs, hueRotate, startleGlyph, wornGlyphs } from "./critters.js";`.
2. Change `Critter`'s signature by adding `worn = null` after `tint = 0`.
3. Add `data-worn={worn || undefined}` to the `<g class="critter" …>` element, after `data-face`.
4. Add this line after the `{face && …}` line and before the `{startle && …}` line:

```jsx
      {worn && wornGlyphs(sprite, worn).map((n, i) => <Node key={`worn-${i}`} n={n} mood={mood} tint={tint} />)}
```

5. Add to `Critter`'s comment: `` `worn` is what it wears for a pastime (critters.js wornGlyphs), drawn over its face. ``

- [ ] **Step 5: Run the tests**

Run: `npx vitest run static/src/chrome static/src/overlays`
Expected: all pass. That includes the exact-markup pin "draws a sprite exactly as before without a face": `data-worn={undefined}` renders nothing.

- [ ] **Step 6: Commit**

```bash
git add static/src/chrome/critters.js static/src/chrome/Critter.jsx static/src/chrome/__tests__/critters.test.js static/src/chrome/__tests__/critterRender.test.jsx
git commit -m "critters: hatTransform fits Clawd's hats to a critter's head; wornGlyphs and Critter's worn bring back goggles and the scarf"
```

---

### Task 3: `TamaScene` fits hats and worn props to critters

**Files:**
- Modify: `static/src/chrome/Tamagotchi.jsx`
- Test: `static/src/chrome/__tests__/tamagotchiRender.test.jsx`

- [ ] **Step 1: Update and add the failing tests**

In `tamagotchiRender.test.jsx`, add `hatTransform` to the `../critters.js` import (keep it sorted).

In `describe("critters", …)`, **replace** the test `"lifts the hats onto a seated critter's head, and leaves a standing one's alone"` with:

```js
  it("fits Clawd's hats to the critter's head, inside its own group", () => {
    const nox = critterById("nox");
    const seat = `<g class="tama-hat-seat" style="transform-box: view-box" transform="${hatTransform(nox.sprite)}">`;
    for (const activity of ["read", "eat"]) {
      const html = scene(nox, activity, { occasion: "yearend" });
      expect(html, activity).toContain(`${seat}<g class="tama-hat-santa"`);
      expect(html.indexOf("tama-hat-santa"), activity).toBeGreaterThan(html.indexOf('class="tama-critter"'));
      expect(html, activity).not.toMatch(/translate\(0 -2\)"><g class="tama-hat-santa"/);
    }
    expect(scene(nox, "code", { party: true, duty: { kind: "merged", label: "1", more: 0 } })).toContain(`${seat}<g class="tama-hat-party"`);
  });
```

In `describe("critters at their pastimes", …)`, **replace** the test `"keeps a pastime's props but drops what Clawd wears on his face and neck"` with:

```js
  it("wears the goggles and the scarf on its own eyes and neck, not Clawd's", () => {
    expect(render(<TamaScene activity="swim" />)).toContain("tama-goggles");
    const swim = scene(nox, "swim");
    expect(swim).toContain('data-worn="goggles"');
    expect(swim.split("tama-goggles").length - 1).toBe(1); // the critter's, not Clawd's too
    const sled = scene(nox, "sled", { season: "winter" });
    expect(sled).toContain('data-worn="scarf"');
    expect(sled.split('class="tama-scarf"').length - 1).toBe(1);
    expect(scene(nox, "cycle")).toContain(`transform="${hatTransform(nox.sprite)}"><g class="tama-helmet"`);
  });
```

**Replace** the test `"lifts the head props onto a seated critter's head at a pastime too"` with:

```js
  it("seats the head props on the critter's head at a pastime too", () => {
    const seat = `transform="${hatTransform(nox.sprite)}">`;
    expect(scene(nox, "sled", { season: "winter" })).toContain(`${seat}<rect class="tama-snowcap"`);
    expect(scene(nox, "game", { occasion: "yearend" })).toContain(`${seat}<g class="tama-hat-santa"`);
    expect(scene(nox, "cook")).toContain(`${seat}<g class="tama-toque"`);
  });
```

- [ ] **Step 2: Run and watch them fail**

Run: `npx vitest run static/src/chrome/__tests__/tamagotchiRender.test.jsx -t "critters"`
Expected: FAIL. There's no `tama-hat-seat` and no `data-worn`.

- [ ] **Step 3: Implement in `Tamagotchi.jsx`**

1. Add `hatTransform` to the `./critters.js` import (keep it sorted).

2. After `function PartyHat` (before `function GhostSheet`), add:

```jsx
// A critter's hats: Clawd's own, drawn inside its group and fitted to its head
// (critters.js hatTransform) rather than on Clawd's spot. Which hat shows
// follows Clawd's rules (TamaScene). The wrapper carries the view-box pivot
// for the same reason as the critter's own: `.tama g` pivots on its fill-box.
function CritterHats({ sprite, p, hat, season, ghost }) {
  const headwear = p?.Headwear && !hat;
  const snowcap = p?.snowcap && season === "winter" && !hat && !ghost;
  if (!headwear && !snowcap && !hat) return null;
  return (
    <g class="tama-hat-seat" style="transform-box: view-box" transform={hatTransform(sprite)}>
      {headwear && <p.Headwear x0={0} />}
      {snowcap && <rect class="tama-snowcap" x="3" y="8.4" width="12" height="0.7" rx="0.3" fill="#f4f8fb" />}
      {hat === "santa" && <SantaHat x0={0} />}
      {hat === "party" && <PartyHat x0={0} />}
    </g>
  );
}
```

3. In `TamaScene`, right after the `critterFace` definition, add:

```js
  // What a critter wears for the pastime, rebuilt on its own eyes and neck
  // (critters.js wornGlyphs); Clawd's Goggles and Scarf fit only Clawd.
  const worn = sprite && p?.Held === Goggles ? "goggles" : sprite && p?.Held === Scarf ? "scarf" : null;
```

4. Inside the critter wrapper, replace:

```jsx
            <Critter sprite={sprite} mood={moody ? mood : "calm"} asleep={asleep} face={critterFace}
                     startle={pose === "bell" && !deskBell} />
```

with:

```jsx
            <Critter sprite={sprite} mood={moody ? mood : "calm"} asleep={asleep} face={critterFace}
                     startle={pose === "bell" && !deskBell} worn={worn} />
            <CritterHats sprite={sprite} p={p} hat={hat} season={season} ghost={ghost} />
```

5. Guard Clawd's head props with `!sprite`. Replace:

```jsx
        <Head dy={headDy}>{p?.Headwear && !hat && <p.Headwear x0={x0} />}</Head>
```

with:

```jsx
        {!sprite && <Head dy={headDy}>{p?.Headwear && !hat && <p.Headwear x0={x0} />}</Head>}
```

Replace the final head block:

```jsx
        <Head dy={headDy}>
          {p?.snowcap && season === "winter" && !hat && !ghost && (
            <rect class="tama-snowcap" x={x0 + 3} y="8.4" width="12" height="0.7" rx="0.3" fill="#f4f8fb" />
          )}
          {hat === "santa" && <SantaHat x0={x0} />}
          {hat === "party" && <PartyHat x0={x0} />}
        </Head>
```

with:

```jsx
        {!sprite && (
          <Head dy={headDy}>
            {p?.snowcap && season === "winter" && !hat && !ghost && (
              <rect class="tama-snowcap" x={x0 + 3} y="8.4" width="12" height="0.7" rx="0.3" fill="#f4f8fb" />
            )}
            {hat === "santa" && <SantaHat x0={x0} />}
            {hat === "party" && <PartyHat x0={x0} />}
          </Head>
        )}
```

For Clawd, `!sprite` is true, so his markup is unchanged. The hash pin proves it.

6. Update the comment above `WORN_ON_CLAWD`. Clawd's own goggles and scarf are still skipped for a critter, but it now wears its own (`wornGlyphs`). Make it say so.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run static/src/chrome static/src/overlays`
Expected: all pass, including "Clawd's drawing, pinned" (hash unchanged) and the face parity test.

Then `npx biome lint` on the touched files, and `bin/check`.

- [ ] **Step 5: Commit**

```bash
git add static/src/chrome/Tamagotchi.jsx static/src/chrome/__tests__/tamagotchiRender.test.jsx
git commit -m "tamagotchi: critters wear Clawd's hats fitted to their own heads, and their own goggles and scarf"
```

---

### Task 4: Hand check, tune, docs, bundle, gate

- [ ] **Step 1: Render and look**

Render `TamaScene` for every critter in each of these scenes, using a throwaway `vite-node` script outside the repo:
- `read` with `occasion: "yearend"` (Santa);
- `code` with `party: true` and a merged duty (party hat);
- `cook` (toque);
- `cycle` (helmet);
- `run` in winter (snowcap);
- `swim` (goggles);
- `sled` in winter (scarf).

Leave out styles.css's reduced-motion `@media` block, so the animations run. Check that:
- every hat sits on the head, sized to it;
- the goggles are on the eyes;
- the scarf is on the neck.

Tune `data-hat` / `data-neck` in the SVGs, run `uv run build_critters.py`, and re-render. Commit the tuning as `critters: tune the hat seats and neck rows against the hand-check grid`. The JS tests derive their expectations from the anchors, so they keep passing. Re-run `uv run pytest tests/test_build_critters.py -q` anyway.

- [ ] **Step 2: Note it in the critter-picker spec**

In `docs/superpowers/specs/2026-10-21-tamagotchi-critter-picker-design.md`, find the `**Status:**` paragraph under `### Critters as expressive as Clawd` and append:

`Hats now fit each critter's head, and the goggles and scarf are back (part 2a, docs/superpowers/specs/2026-10-23-critter-hats-and-worn-props-design.md); held props are part 2b.`

- [ ] **Step 3: Bundle and gate**

```bash
npm run build
bin/check && npm test && uv run pytest -q
```

Expected: `static/dist/app.js` changes, and everything passes.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/2026-10-21-tamagotchi-critter-picker-design.md static/dist/app.js
git commit -m "docs + build: critters wear hats, goggles and scarves; static/dist rebuilt"
```
