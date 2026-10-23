# Critters Hold Things (Batch 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Critters hold the pint, the coffee mug, the spoon, the watering can and the leash with their own appendage: an arm, a tentacle or the tail. This matches the approved batch-1 draft. Clawd stays byte-identical.

**Architecture:**
- **Declared limb.** Each critter SVG declares its limb (`data-limb`, `data-limb-color`, optionally an outline and a spade tip), and marks a resting tail `class="hold-rest"`.
- **Generated poses.** `critters.js` generates the appendage from the limb root to a per-prop tip (`HOLDS`, `holdTip`, `holdTipInScene`, `limbGlyphs`).
- **Rendering.** `Critter` draws it (`holding`). `TamaPastimes.jsx` draws Clawd's own props at the tip (`CritterHeld`, plus `Spoon` and `Dog` taking a start point). `TamaScene` maps the activity to the held prop.

**Tech Stack:** Python 3 (pytest), Preact + `preact-render-to-string` (vitest, node environment), SVG pixel art.

**Spec:** `docs/superpowers/specs/2026-10-23-critter-held-props-batch1-design.md`. Read it first.

---

## Conventions for every task

- **Where to work:** the worktree `.claude/worktrees/critter-holds`, branch `feature/critter-holds`. Run every command from the worktree root.
- **Commits:** one per task, with a single-line message, a blank line, then exactly `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`. Don't commit `package-lock.json`. Rebuild `static/dist` only in Task 4.
- **Tests:**
  - `uv run pytest tests/test_build_critters.py -q`
  - `npx vitest run <file>`
  - the full suites: `npm test` and `uv run pytest -q`
- **Linting:**
  - Python: `uv run ruff format build_critters.py tests/test_build_critters.py`.
  - `npx biome lint` must be clean on touched JS.
  - `bin/check` must end "all checks passed". The 3 warnings in `Rail.jsx` / `spawnAccountPickerRender.test.jsx` are pre-existing.
- **Generated files:** never hand-edit `static/src/chrome/critterSprites.js` or `static/critters.css`. Re-run `uv run build_critters.py`.
- **Clawd invariant:** these must keep passing, and the hash must never be edited:
  - `tamagotchiRender.test.jsx`'s "Clawd's drawing, pinned" (it covers beer, coffee, cook, garden and dog);
  - the two "… follow Clawd's in every scene" parity tests;
  - `critterRender.test.jsx`'s exact-markup pin.
- **Comments** explain *why*, tersely, in the voice of the surrounding code.

---

### Task 0: Worktree

- [ ] **Step 1: Create the worktree and confirm a green start**

```bash
cd ~/github/tomplex/periscope
git worktree add .claude/worktrees/critter-holds -b feature/critter-holds main
cd .claude/worktrees/critter-holds && npm install --silent && uv sync -q && git checkout -- package-lock.json
npx vitest run static/src/chrome && uv run pytest tests/test_build_critters.py -q
```

Expected: all pass.

---

### Task 1: Declared limbs and resting tails

**Files:**
- Modify: `build_critters.py`
- Modify: all 7 `docs/specs/assets/critters/*.svg` (root attributes), plus one `class` each in `nox.svg` and `ember.svg`
- Regenerate: `static/src/chrome/critterSprites.js`, `static/critters.css`
- Test: `tests/test_build_critters.py`

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_build_critters.py`. `_svg`, `_sprite`, `BODY` and `EYE` already exist.

```python
def test_a_declared_limb_becomes_sprite_data(tmp_path):
    arm = ' data-limb="arm 17 10.6 1.2" data-limb-color="#2a86b3"'
    s = build_critters.convert("t", _svg(tmp_path, BODY + EYE, svg_attrs=arm), build_critters.Sheet())
    assert s["limb"] == {"style": "arm", "root": [17, 10.6], "width": 1.2, "color": "#2a86b3"}
    tail = ' data-limb="tail 15.2 16" data-limb-color="#1a1c20" data-limb-outline="#4a4f57" data-limb-tip="spade"'
    s = build_critters.convert("t", _svg(tmp_path, BODY + EYE, svg_attrs=tail), build_critters.Sheet())
    assert s["limb"] == {
        "style": "tail", "root": [15.2, 16], "width": 1, "color": "#1a1c20", "outline": "#4a4f57", "spade": True,
    }


def test_convert_leaves_an_undeclared_limb_out(tmp_path):
    assert "limb" not in build_critters.convert("t", _svg(tmp_path, BODY + EYE), build_critters.Sheet())


@pytest.mark.parametrize(
    "attrs,match",
    [
        (' data-limb="wing 17 10" data-limb-color="#2a86b3"', "style"),
        (' data-limb="arm 17" data-limb-color="#2a86b3"', "numbers"),
        (' data-limb="arm 17 nan" data-limb-color="#2a86b3"', "numbers"),
        (' data-limb="arm 17 10 0" data-limb-color="#2a86b3"', "width"),
        (' data-limb="arm 17 10"', "data-limb-color"),
        (' data-limb="arm 17 10" data-limb-color="blue"', "data-limb-color"),
        (' data-limb="arm 17 10" data-limb-color="#2a86b3" data-limb-outline="grey"', "data-limb-outline"),
        (' data-limb="arm 17 10" data-limb-color="#2a86b3" data-limb-tip="claw"', "data-limb-tip"),
    ],
)
def test_raises_on_a_malformed_limb(tmp_path, attrs, match):
    with pytest.raises(ValueError, match=match):
        build_critters.convert("t", _svg(tmp_path, BODY + EYE, svg_attrs=attrs), build_critters.Sheet())


def test_a_hold_rest_group_is_marked_rest(tmp_path):
    rest = '<g class="hold-rest"><rect x="1" y="1" width="1" height="1"/></g>'
    s = build_critters.convert("t", _svg(tmp_path, BODY + EYE + rest), build_critters.Sheet())
    assert [n for n in s["root"] if n.get("rest")] == [{"g": [{"r": [1, 1, 1, 1]}], "rest": True}]
    with pytest.raises(ValueError, match="hold-rest"):
        build_critters.convert(
            "t", _svg(tmp_path, BODY + EYE + '<rect class="hold-rest" x="1" y="1" width="1" height="1"/>'),
            build_critters.Sheet(),
        )


def test_every_shipped_critter_declares_a_limb_and_only_tails_rest():
    for cid in build_critters.CRITTERS:
        s = _sprite(cid)
        assert "limb" in s, cid
        rests = [n for n in s["root"] if n.get("rest")]
        assert len(rests) == (1 if s["limb"]["style"] == "tail" else 0), cid


def test_render_raises_for_a_critter_without_a_limb(tmp_path, monkeypatch):
    _svg(tmp_path, BODY + EYE, svg_attrs=' data-hat="10 4 8" data-neck="12 3 17"')
    monkeypatch.setattr(build_critters, "SRC", tmp_path)
    monkeypatch.setattr(build_critters, "CRITTERS", ["bad"])
    with pytest.raises(ValueError, match="data-limb"):
        build_critters.render()
```

- [ ] **Step 2: Run and watch them fail**

Run: `uv run pytest tests/test_build_critters.py -q -k "limb or rest"`
Expected: FAIL. There's no `limb` key, and `hold-rest` raises "unknown class".

- [ ] **Step 3: Implement in `build_critters.py`**

1. Next to `FACES = {…}`, add:

```python
HOLD_REST = "hold-rest"  # what a holding pose hides: the resting tail it curls up instead
LIMB_STYLES = ("arm", "tentacle", "tail")
```

2. In `mood_of`, change the first check to `if cls is None or cls in FACES or cls == HOLD_REST:`. Also add `HOLD_REST` to the names listed in its "unknown class" error, e.g. `sorted({*MOODS, *FACES, HOLD_REST})`.

3. In `node()`, `rect` branch, right after the existing face-class check, add:

```python
            if el.get("class") == HOLD_REST:
                raise ValueError(f"{svg.name}: {HOLD_REST} must be a <g>, not a <rect>")
```

4. In `node()`, `g` branch, right after `out = {"g": children}`, add:

```python
            if el.get("class") == HOLD_REST:
                out["rest"] = True
```

5. After `ink_of`, add:

```python
def limb_of(svg_name: str, doc: ET.Element) -> dict | None:
    """The appendage a critter holds things with (critters.js limbGlyphs): data-limb="style x y [width]"
    (arm, tentacle or tail, from its root point), data-limb-color, and optionally data-limb-outline (an
    outline copy, as Nox's body has) and data-limb-tip="spade" (Ember's tail). None when undeclared."""
    raw = doc.get("data-limb")
    if raw is None:
        return None
    style, *rest = raw.split() or [""]
    if style not in LIMB_STYLES:
        raise ValueError(f"{svg_name}: data-limb style must be one of {list(LIMB_STYLES)}, got {style!r}")
    try:
        vals = [num(v) for v in rest]
    except ValueError:
        vals = []
    if len(vals) not in (2, 3) or not all(math.isfinite(v) for v in vals):
        raise ValueError(f"{svg_name}: data-limb must be a style then 2 or 3 numbers (root x y, width), got {raw!r}")
    width = vals[2] if len(vals) == 3 else 1
    if width <= 0:
        raise ValueError(f"{svg_name}: data-limb width must be > 0, got {width}")
    color = doc.get("data-limb-color")
    if color is None or not INK_RE.fullmatch(color):
        raise ValueError(f"{svg_name}: data-limb-color must be #rrggbb, got {color!r}")
    out = {"style": style, "root": vals[:2], "width": width, "color": color}
    outline = doc.get("data-limb-outline")
    if outline is not None:
        if not INK_RE.fullmatch(outline):
            raise ValueError(f"{svg_name}: data-limb-outline must be #rrggbb, got {outline!r}")
        out["outline"] = outline
    tip = doc.get("data-limb-tip")
    if tip is not None:
        if tip != "spade":
            raise ValueError(f"{svg_name}: data-limb-tip must be 'spade', got {tip!r}")
        out["spade"] = True
    return out
```

6. In `_convert`, after the `if faces: out["faces"] = faces` lines and before `return out`, add:

```python
    limb = limb_of(svg.name, doc)
    if limb:
        out["limb"] = limb
```

7. In `render()`, change the required-anchors check to also require a limb:

```python
        missing = [a for a in ("hat", "neck") if a not in s["anchors"]] + ([] if "limb" in s else ["limb"])
        if missing:
            raise ValueError(
                f"{cid}.svg: declare data-hat, data-neck and data-limb on the <svg> (missing: {', '.join(missing)})"
            )
```

8. In the module docstring's conventions list, add:

```
  - every critter declares the appendage it holds things with: data-limb="arm|tentacle|tail x y [width]"
    and data-limb-color (optionally data-limb-outline, data-limb-tip="spade"); a <g class="hold-rest">
    is what a holding pose hides (a resting tail curled up instead).
```

- [ ] **Step 4: Declare the limbs and mark the tails**

```bash
python3 - <<'EOF'
from pathlib import Path
L = {
    "scope": 'data-limb="arm 17 10.6 1.2" data-limb-color="#2a86b3"',
    "jelly": 'data-limb="tentacle 16 10.2" data-limb-color="#7d62c9"',
    "nox": 'data-limb="tail 15.2 16 1" data-limb-color="#1a1c20" data-limb-outline="#4a4f57"',
    "ember": 'data-limb="tail 16 13.4 1" data-limb-color="#b8403a" data-limb-tip="spade"',
    "volt": 'data-limb="arm 17.4 9.4 1.2" data-limb-color="#d1a92b"',
    "moss": 'data-limb="arm 15.6 10.6 1.1" data-limb-color="#2e9a56"',
    "octocat": 'data-limb="tentacle 16.6 12.4" data-limb-color="#24292f"',
}
for cid, attrs in L.items():
    p = Path(f"docs/specs/assets/critters/{cid}.svg")
    s = p.read_text()
    assert "data-limb" not in s
    s = s.replace("<svg ", f"<svg {attrs} ", 1)
    if cid == "nox":  # the tail: the second-level <g> holding its own sway
        old = "\n        <g>\n          <animateTransform"
        assert s.count(old) == 1
        s = s.replace(old, '\n        <g class="hold-rest">\n          <animateTransform')
    if cid == "ember":  # the spiky tail: the #b8403a group with its own wag (the other is the arms and feet)
        old = '<g fill="#b8403a">\n          <animateTransform'
        assert s.count(old) == 1
        s = s.replace(old, '<g fill="#b8403a" class="hold-rest">\n          <animateTransform')
    p.write_text(s)
EOF
uv run build_critters.py
```

Expected:
- `git diff --stat static/critters.css` shows no change.
- `critterSprites.js` gains `limb` on every sprite, and `"rest":true` on the Nox and Ember tail groups.

- [ ] **Step 5: Run the tests**

Run: `uv run ruff format build_critters.py tests/test_build_critters.py && uv run pytest tests/test_build_critters.py -q && npx vitest run static/src/chrome`
Expected: all pass. The new `rest` flag and `limb` key change nothing yet.

- [ ] **Step 6: Commit**

```bash
git add build_critters.py tests/test_build_critters.py docs/specs/assets/critters/*.svg static/src/chrome/critterSprites.js static/critters.css
git commit -m "critters: each critter declares the limb it holds things with (data-limb), and the tail a holding pose hides (hold-rest)"
```

---

### Task 2: Holding poses in `critters.js` and `Critter`

**Files:**
- Modify: `static/src/chrome/critters.js`, `static/src/chrome/Critter.jsx`
- Test: `static/src/chrome/__tests__/critters.test.js`, `static/src/chrome/__tests__/critterRender.test.jsx`

- [ ] **Step 1: Write the failing tests**

In `critters.test.js`, add `HOLDS`, `holdTip`, `holdTipInScene` and `limbGlyphs` to the `../critters.js` import (keep it sorted). Append:

```js
describe("holding", () => {
  const sprites = CRITTERS.filter((c) => c.sprite).map((c) => [c.id, c.sprite]);
  // Does any rect among these nodes cover the point?
  const covers = (nodes, [x, y]) => nodes.flatMap((n) => n.g).some(({ r: [rx, ry, rw, rh] }) =>
    rx - 1e-6 <= x && x <= rx + rw + 1e-6 && ry - 1e-6 <= y && y <= ry + rh + 1e-6);

  it.each(sprites)("%s reaches each prop's tip, a reach right of its limb's root", (_id, sprite) => {
    const box = spriteBox(sprite);
    for (const [prop, { reach, at }] of Object.entries(HOLDS)) {
      const [x, y] = holdTip(sprite, prop);
      expect(x, prop).toBeCloseTo(sprite.limb.root[0] + reach);
      expect(y, prop).toBeCloseTo(box.y + at * box.h);
    }
  });

  it("maps the tip into the scene through the critter's placement", () => {
    const sprite = critterById("scope").sprite;
    const place = placement(sprite, { x0: 1, sitting: false });
    const [x, y] = holdTip(sprite, "leash");
    const [sx, sy] = holdTipInScene(sprite, "leash", place);
    expect(sx).toBeCloseTo(place.tx + place.scale * x);
    expect(sy).toBeCloseTo(place.ty + place.scale * y);
    // Whatever size the placement gives it: the tip follows a bigger critter too.
    const big = placement(sprite, { x0: 1, sitting: false, height: 13 });
    expect(holdTipInScene(sprite, "leash", big)[1]).toBeCloseTo(big.ty + big.scale * y);
  });

  it.each(sprites)("%s's appendage runs from its root to the tip, in its limb colour", (_id, sprite) => {
    for (const prop of Object.keys(HOLDS)) {
      const nodes = limbGlyphs(sprite, prop);
      const [rx, ry] = sprite.limb.root;
      expect(covers(nodes, [rx + 0.1, ry + 0.1]), `${prop} root`).toBe(true);
      expect(covers(nodes, holdTip(sprite, prop)), `${prop} tip`).toBe(true);
      expect(nodes.every((n) => n.a.fill === sprite.limb.color), prop).toBe(true);
    }
  });

  it("draws a tail's outline copy and its spade when declared", () => {
    const nox = limbGlyphs(critterById("nox").sprite, "pint");
    expect(nox[0].a.stroke).toBe("#4a4f57");
    expect(nox).toHaveLength(2);
    const ember = limbGlyphs(critterById("ember").sprite, "pint");
    expect(ember).toHaveLength(1);
    expect(ember[0].g).toHaveLength(4); // base, riser, hook, spade
    expect(limbGlyphs(critterById("scope").sprite, "pint")[0].g).toHaveLength(3); // bar, upright, hand
  });
});
```

In `critterRender.test.jsx`, inside `describe("<Critter>", …)` before its closing `});`, add:

```js
  it("holds with its limb, and a tail that holds isn't also drawn resting", () => {
    const nox = critterById("nox").sprite;
    expect(draw({ sprite: nox })).toContain("crit-nox-1");
    const holding = draw({ sprite: nox, holding: "pint" });
    expect(holding).toContain('data-holding="pint"');
    expect(holding).not.toContain("crit-nox-1");
    expect(holding).toContain('stroke="#4a4f57"');
    const scope = critterById("scope").sprite;
    expect(draw({ sprite: scope, holding: "mug" })).toContain(`fill="${scope.limb.color}"`);
    expect(draw({ sprite: scope })).not.toContain("data-holding");
  });
```

- [ ] **Step 2: Run and watch them fail**

Run: `npx vitest run static/src/chrome/__tests__/critters.test.js static/src/chrome/__tests__/critterRender.test.jsx`
Expected: FAIL. The new exports don't exist yet, and there's no `data-holding`.

- [ ] **Step 3: Implement in `critters.js`**

Append. `r4`, `spriteBox` and `placement` are already in this file.

```js
// Where a critter's appendage reaches for each prop it holds (TamaPastimes.jsx
// CritterHeld, Spoon, Dog): `reach` right of its limb's root and `at` down its
// body, a fraction of its sprite box. The reviewed batch-1 draft's numbers.
export const HOLDS = {
  pint: { reach: 2.6, at: 0.42 },
  mug: { reach: 2.2, at: 0.55 },
  spoon: { reach: 2.4, at: 0.55 },
  can: { reach: 2.6, at: 0.45 },
  leash: { reach: 2.4, at: 0.65 },
};

export function holdTip(sprite, prop) {
  const box = spriteBox(sprite);
  const { reach, at } = HOLDS[prop];
  return [r4(sprite.limb.root[0] + reach), r4(box.y + at * box.h)];
}

// The same tip in scene units, for what's drawn outside the critter's wrapper
// (the spoon into the pot, the leash to the dog), through the very placement
// the wrapper uses: handed it rather than recomputing one, so a scene that
// sizes its critter differently moves the hold with it.
export function holdTipInScene(sprite, prop, { scale, tx, ty }) {
  const [x, y] = holdTip(sprite, prop);
  return [r4(tx + scale * x), r4(ty + scale * y)];
}

// A critter's appendage from its limb's root (declared in its SVG) to a prop's
// tip, as sprite nodes in its limb colour:
// - arm: a bar out, a bar up or down to the tip, a hand;
// - tentacle: cells stepped from root to tip, curled at the end;
// - tail: along the floor, up to the tip, hooked over the prop, with Nox's
//   outline copy and Ember's spade when declared.
export function limbGlyphs(sprite, prop) {
  const { style, root: [x0, y0], width: t, color, outline, spade } = sprite.limb;
  const [x1, y1] = holdTip(sprite, prop);
  const r = (x, y, w, h) => ({ r: [r4(x), r4(y), r4(w), r4(h)] });
  if (style === "arm") {
    return [{
      a: { fill: color },
      g: [r(x0, y0, x1 - x0, t), r(x1 - t, Math.min(y0, y1), t, Math.abs(y1 - y0) + t), r(x1 - t * 1.1, y1 - t * 0.4, t * 1.4, t)],
    }];
  }
  if (style === "tentacle") {
    const n = Math.max(2, Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) / 0.75));
    const cells = [];
    for (let i = 0; i <= n; i++) cells.push(r(x0 + ((x1 - x0) * i) / n - 0.45, y0 + ((y1 - y0) * i) / n - 0.45, 0.95, 0.95));
    return [{ a: { fill: color }, g: [...cells, r(x1 + 0.3, y1 - 0.9, 0.8, 0.8)] }];
  }
  const parts = [r(x0, y0, x1 - x0, t), r(x1 - t, y1, t, y0 - y1 + t), r(x1 - t, y1 - t * 0.2, t * 1.6, t)];
  return [
    ...(outline ? [{ a: { fill: color, stroke: outline, "stroke-width": 1 }, g: parts }] : []),
    { a: { fill: color }, g: [...parts, ...(spade ? [r(x1 + 0.4, y1 - 0.9, 1.2, 1.2)] : [])] },
  ];
}
```

- [ ] **Step 4: Implement in `Critter.jsx`**

1. Add `limbGlyphs` to the `./critters.js` import (keep it sorted).
2. `Node`:
   - change its signature to `function Node({ n, mood, asleep, hide, tint, rest })`;
   - add `if (rest && n.rest) return null;` right after the mood check;
   - pass `rest={rest}` in its recursive `<Node … />`.
3. `Critter`:
   - add `holding = null` to its signature, after `worn = null`;
   - add `data-holding={holding || undefined}` to the `<g class="critter" …>`, after `data-worn`;
   - pass `rest={!!holding}` in the `sprite.root.map(…)` `<Node … />`;
   - add this line after the `{worn && …}` line:

```jsx
      {holding && limbGlyphs(sprite, holding).map((n, i) => <Node key={`hold-${i}`} n={n} mood={mood} tint={tint} />)}
```

4. Extend `Critter`'s comment: `` `holding` is the prop it holds (critters.js limbGlyphs): its appendage is drawn to the prop, and a resting tail it holds with (`rest`) goes. ``

- [ ] **Step 5: Run the tests**

Run: `npx vitest run static/src/chrome static/src/overlays`
Expected: all pass, including the exact-markup pin ("draws a sprite exactly as before without a face").

- [ ] **Step 6: Commit**

```bash
git add static/src/chrome/critters.js static/src/chrome/Critter.jsx static/src/chrome/__tests__/critters.test.js static/src/chrome/__tests__/critterRender.test.jsx
git commit -m "critters: a holding pose per critter — its arm, tentacle or tail from its root to each prop's tip (limbGlyphs), drawn by Critter's holding"
```

---

### Task 3: The scenes hand critters their props

**Files:**
- Modify: `static/src/chrome/TamaPastimes.jsx`, `static/src/chrome/Tamagotchi.jsx`
- Test: `static/src/chrome/__tests__/tamagotchiRender.test.jsx`

- [ ] **Step 1: Write the failing tests**

In `tamagotchiRender.test.jsx`, add `holdTipInScene` and `placement` to the `../critters.js` import (keep it sorted). Inside `describe("critters at their pastimes", …)`, before its closing `});`, add the following. `count` and `nox` already exist in that block; if `count` is missing, define it the same way the block above does.

```js
  const holders = CRITTERS.filter((c) => c.sprite).map((c) => [c.id, c]);
  const HELD = [["beer", "pint"], ["coffee", "mug"], ["cook", "spoon"], ["garden", "can"], ["dog", "leash"]];

  it.each(holders)("%s holds the pint, the mug, the spoon, the can and the leash itself", (_id, c) => {
    for (const [activity, kind] of HELD) {
      const html = render(<TamaScene activity={activity} critter={c} season="summer" />);
      expect(html.slice(html.indexOf('class="tama-creature')), activity).toContain(`data-holding="${kind}"`);
    }
  });

  it.each(holders)("%s's pint, mug and can sit in its own wrapper, once, and Clawd's don't float beside it", (_id, c) => {
    const beer = render(<TamaScene activity="beer" critter={c} />);
    const mascot = beer.slice(beer.indexOf('class="tama-creature'));
    const friend = beer.slice(beer.indexOf('class="tama-friend"'), beer.indexOf('class="tama-cheers"'));
    const pint = 'class="tama-pint tama-clink"';
    expect(count(mascot, pint)).toBe(1);
    expect(mascot.indexOf(pint)).toBeGreaterThan(mascot.indexOf('class="tama-critter"'));
    expect(count(friend, pint)).toBe(1); // its own, inside its mirrored wrapper
    expect(friend.indexOf(pint)).toBeGreaterThan(friend.indexOf('class="tama-critter"'));
    // The mirror already turns the friend's clink toward the mascot; tama-clink2 would turn it back.
    expect(beer).not.toContain("tama-clink2");
    const mugBody = 'x="25.5" y="12" width="3.4" height="4.6"';
    const coffee = render(<TamaScene activity="coffee" critter={c} />);
    expect(count(coffee, mugBody)).toBe(1);
    expect(coffee.indexOf(mugBody)).toBeGreaterThan(coffee.indexOf('class="tama-critter"'));
    const garden = render(<TamaScene activity="garden" critter={c} />);
    expect(count(garden, 'class="tama-can"')).toBe(1);
    expect(garden.indexOf('class="tama-can"')).toBeGreaterThan(garden.indexOf('class="tama-critter"'));
  });

  it.each(holders)("%s's spoon and leash start at its own tip", (_id, c) => {
    const cook = render(<TamaScene activity="cook" critter={c} />);
    const [sx, sy] = holdTipInScene(c.sprite, "spoon", placement(c.sprite, PASTIME_SCENES.cook.pose));
    expect(cook).toContain(`<line class="tama-spoon" x1="${sx}" y1="${sy}"`);
    expect(count(cook, 'class="tama-spoon"')).toBe(1);
    const [lx, ly] = holdTipInScene(c.sprite, "leash", placement(c.sprite, PASTIME_SCENES.dog.pose));
    expect(render(<TamaScene activity="dog" critter={c} />)).toContain(`d="M${lx} ${ly} Q23 12.4 28.1 15"`);
  });

  it("curls a tail up to hold, so the resting one goes, the friend's too", () => {
    expect(render(<TamaScene activity="code" critter={nox} />)).toContain("crit-nox-1");
    expect(render(<TamaScene activity="beer" critter={nox} />)).not.toContain("crit-nox-1");
  });
```

- [ ] **Step 2: Run and watch them fail**

Run: `npx vitest run static/src/chrome/__tests__/tamagotchiRender.test.jsx -t "pastimes"`
Expected: FAIL. There's no `data-holding`, and Clawd's props still float.

- [ ] **Step 3: Implement in `TamaPastimes.jsx`**

1. Change the `./critters.js` import to include `holdTip` and `holdTipInScene` (keep it sorted). `CritterFriend` already destructures `scale` from its `placement(…)`.

2. Before `function Pint`, add:

```jsx
// What a critter holds at its appendage's tip (critters.js holdTip): Clawd's
// own prop at Clawd's size (`scale`, its wrapper's, undone), drawn inside the
// critter's wrapper so it bobs with it. The view-box pivot for the same reason
// as the wrapper's: `.tama g` pivots on its fill-box. The pint's clink is
// Clawd's (toward the friend); the friend's mirror turns its own toward the
// mascot, so it needs no tama-clink2.
export function CritterHeld({ sprite, kind, scale }) {
  const [x, y] = holdTip(sprite, kind);
  const k = r4(1 / scale);
  const at = (fit, inner) => (
    <g style="transform-box: view-box" transform={`translate(${x} ${y}) scale(${k}) ${fit}`}>{inner}</g>
  );
  if (kind === "pint") return at("translate(0 -11.5)", <Pint x={0} cls="tama-pint tama-clink" />);
  // Mirrored so the handle (on the mug's far side from Clawd) faces the critter.
  if (kind === "mug") return at("scale(-1 1) translate(-30.1 -14.2)", <CoffeeMug />);
  if (kind === "can") return at("translate(-17.8 -11.7)", <WateringCan x0={0} />);
  return null;
}
```

3. In `CritterFriend`, replace `<Critter sprite={sprite} face="happy" tint={FRIEND_HUE} />` with:

```jsx
      <Critter sprite={sprite} face="happy" tint={FRIEND_HUE} holding="pint" />
      <CritterHeld sprite={sprite} kind="pint" scale={scale} />
```

4. In `Friend`, replace `<Pint x={FRIEND_X0 + 1.2} cls="tama-pint tama-clink tama-clink2" />` with:

```jsx
        {!critter?.sprite && <Pint x={FRIEND_X0 + 1.2} cls="tama-pint tama-clink tama-clink2" />}
```

5. Add a `CoffeeMug` export: Clawd's morning mug, moved here from `Tamagotchi.jsx`'s `Behind`. Put it near `WateringCan`.

```jsx
// The morning mug: standing by Clawd's arm at x 25.5 (Tamagotchi.jsx Behind),
// or held by its handle in a critter's appendage (CritterHeld).
export function CoffeeMug() {
  return (
    <>
      <g fill="#efe6d8">
        <rect x="25.5" y="12" width="3.4" height="4.6" rx="0.4" />
        <rect x="28.9" y="12.9" width="1.2" height="0.6" />
        <rect x="29.5" y="12.9" width="0.6" height="2.6" />
        <rect x="28.9" y="14.9" width="1.2" height="0.6" />
      </g>
      <rect x="25.5" y="12" width="3.4" height="0.9" fill="#7a4e2d" />
      <rect class="tama-steam" x="26.4" y="8.6" width="0.6" height="2" fill="var(--fg-3)" />
      <rect class="tama-steam tama-steam2" x="27.7" y="7.8" width="0.6" height="2" fill="var(--fg-3)" />
    </>
  );
}
```

6. Change `Spoon` to `export function Spoon({ x0, from })`. Its line's `x1` becomes `{from ? from[0] : x0 + 16.8}` and its `y1` becomes `{from ? from[1] : "13.6"}`. Keep the rest byte-identical: for Clawd, `y1` must still render `13.6`. Add a comment: `` `from`: a critter's tip (TamaScene), in place of Clawd's hand. ``

7. (Superseded in review: `Dog({ from })`, with `from` computed once in `TamaScene`; see the spec.) Change `Dog()` to `Dog({ critter, place })`, where `place` is the mascot's placement (TamaScene's, through `PastimeBehind`). The leash path's `d` becomes:

```jsx
// The leash runs from the holder to the collar: Clawd's arm, or a critter's tip.
const [lx, ly] = place ? holdTipInScene(critter.sprite, "leash", place) : [18.2, 14.2];
```

with `d={`M${lx} ${ly} Q23 12.4 28.1 15`}`. For Clawd this still renders `M18.2 14.2 Q23 12.4 28.1 15`.

- [ ] **Step 4: Implement in `Tamagotchi.jsx`**

1. Add `CoffeeMug`, `CritterHeld` and `Spoon` to the `./TamaPastimes.jsx` import, and `holdTipInScene` to the `./critters.js` import (keep both sorted).

2. In `Behind`, add `mugHeld = false` to its parameters. Replace the whole `case "coffee": return ( <g> … </g> );` body with:

```jsx
    case "coffee":
      // A critter holding the mug (CritterHeld) leaves no mug standing here.
      return <g>{!mugHeld && <CoffeeMug />}</g>;
```

3. Next to `WORN_ON_CLAWD`, add:

```js
// What a critter holds for each pastime, in its own appendage (critters.js
// limbGlyphs, TamaPastimes CritterHeld): Clawd's held props sit at his hand and
// would float beside a critter.
const HOLDING = { beer: "pint", coffee: "mug", cook: "spoon", garden: "can", dog: "leash" };
```

4. In `TamaScene`, right after the `worn` line, add:

```js
  const holding = sprite ? HOLDING[activity] ?? null : null;
```

5. Add `mugHeld={holding === "mug"}` to the `<Behind … />` call. Pass the mascot's placement to the pastimes' backdrops:
   - `PastimeBehind({ p, season, trick, critter, place })`;
   - its `<p.Behind … critter={critter} place={place} />`;
   - TamaScene's `<PastimeBehind … critter={critter} place={place} />`.

   Extend `PastimeBehind`'s comment: "`place` is the mascot's placement, for the leash from a critter's tip (Dog)." For Clawd, `place` is undefined, so nothing renders differently.

6. Inside the critter wrapper, add `holding={holding}` to `<Critter … />`, and after `<CritterHats … />` add:

```jsx
            {holding && <CritterHeld sprite={sprite} kind={holding} scale={place.scale} />}
```

7. Replace:

```jsx
        {p?.Held && !(sprite && WORN_ON_CLAWD.has(p.Held)) && <p.Held x0={x0} />}
```

with:

```jsx
        {p?.Held && !(sprite && (WORN_ON_CLAWD.has(p.Held) || holding)) && <p.Held x0={x0} />}
        {holding === "spoon" && <Spoon x0={x0} from={holdTipInScene(sprite, "spoon", place)} />}
```

For Clawd, `sprite` is null, so his markup is unchanged. The hash pin proves it.

8. In `TamaScene`'s comment above `const sprite = critter.sprite;`, change "hands and held props are still Clawd-only." to "a critter holds the pint, mug, spoon, can and leash in its own appendage (`holding`); hands, the bass and the controller are still Clawd-only."

- [ ] **Step 5: Run the tests**

Run: `npx vitest run static/src/chrome static/src/overlays`
Expected: all pass, including "Clawd's drawing, pinned" (hash unchanged), the two parity tests, and the existing Clawd beer, coffee, cook, garden and dog tests.

Then `npx biome lint` on the touched files, and `bin/check`.

- [ ] **Step 6: Commit**

```bash
git add static/src/chrome/TamaPastimes.jsx static/src/chrome/Tamagotchi.jsx static/src/chrome/__tests__/tamagotchiRender.test.jsx
git commit -m "tamagotchi: critters hold the pint, the mug, the spoon, the watering can and the leash themselves; the friend holds its own pint"
```

---

### Task 3b: Critters stand taller (12, not Clawd's 10)

**Decided with the user, from a size mock:**
- A critter is fit to Clawd's height today (10 scene units), so a square-ish critter covers about half of Clawd's 17-wide body.
- The mock tried 12 and 13.5 in ten scenes. At 13.5 the beer friends' heads nearly touch and tall critters' hats reach the top edge.
- The user chose **12 everywhere**: one constant, applied in every scene.
- A critter's kids stay half its height (6).
- Clawd is untouched.

**Why it's a one-constant change:** every critter piece follows `placement()`: the wrapper, hats, faces, worn props, the "!", the held props (batch 1), the friend and the kids.

**Files:**
- Modify: `static/src/chrome/critters.js`, `static/src/chrome/TamaPastimes.jsx` (`CritterKid`)
- Test: `static/src/chrome/__tests__/critters.test.js`, `static/src/chrome/__tests__/tamagotchiRender.test.jsx`

- [ ] **Step 1: Write the failing tests**

In `critters.test.js`'s `describe("placement", …)`:
- Replace the "stands %s as tall as Clawd, on Clawd's spot" test with:

```js
  it.each(sprites.map((c) => [c.id, c.sprite]))("stands %s taller than Clawd (CRITTER_HEIGHT), on Clawd's spot", (_id, sprite) => {
    const box = spriteBox(sprite);
    const p = placement(sprite, { x0: 8, sitting: false });
    expect(p.scale * box.h).toBeCloseTo(CRITTER_HEIGHT);
    expect(bottomOf(p, box)).toBeCloseTo(19);
    expect(centreOf(p, box)).toBeCloseTo(16.5);
    expect(p.top).toBe(19 - CRITTER_HEIGHT);
  });

  it("stands a critter 12 tall: a fifth over Clawd, so a square one isn't half his size", () => {
    expect(CRITTER_HEIGHT).toBe(12);
    expect(CRITTER_HEIGHT).toBeGreaterThan(CLAWD_HEIGHT);
  });

  it("still fits any height it's given", () => {
    const sprite = critterById("nox").sprite;
    const p = placement(sprite, { x0: 8, sitting: false, height: CLAWD_HEIGHT });
    expect(p.scale * spriteBox(sprite).h).toBeCloseTo(CLAWD_HEIGHT);
    expect(p.top).toBe(9);
  });
```

- In "seats a sitting critter on the seat, not through it", change `expect(p.top).toBe(7);` to `expect(p.top).toBe(17 - CRITTER_HEIGHT);`.
- Add `CRITTER_HEIGHT` to the sorted `../critters.js` import.

In `tamagotchiRender.test.jsx`:
- "plays with two half-size kids of its own kind" also pins the kids' height. `mapBoxThrough` returns centre and feet, so compute the height from the transform's scale: `scale * box.h` must be close to `CRITTER_HEIGHT / 2`.
- Add a test that the mascot's own wrapper scale gives `CRITTER_HEIGHT` for every critter in, say, `code` and `beer`. Use the existing helpers (`mapBoxThrough`, or the `drawnPlace` helper if Task 3's fixes added it).
- Add `CRITTER_HEIGHT` to the import.

- [ ] **Step 2: Run the tests and watch them fail.** Run `npx vitest run static/src/chrome`. Expected: FAIL, because `CRITTER_HEIGHT` isn't exported yet.

- [ ] **Step 3: Implement**

In `critters.js`, after `CLAWD_HEIGHT`:

```js
// A critter stands taller than Clawd: fit to his 10-unit height, a square-ish
// sprite covers about half his 17-wide body. 12 fits every scene (13.5 had the
// beer friends' heads touching); everything a critter wears or holds follows
// placement(), so it all grows with it.
export const CRITTER_HEIGHT = 12;
```

Then change `placement`'s default: `export function placement(sprite, { x0, sitting, height = CRITTER_HEIGHT }) {`. Update any comment on `placement` that says the critter matches Clawd's height.

In `TamaPastimes.jsx`'s `CritterKid`, change `height: CLAWD_HEIGHT / 2` to `height: CRITTER_HEIGHT / 2`, and fix the import: add `CRITTER_HEIGHT`, and drop `CLAWD_HEIGHT` if it's now unused. Update `CritterKid`'s comment: "the critter at half its height".

Grep `static/src` for other `placement(` callers and for comments saying "Clawd's height" / "as tall as Clawd" about critters, and update them. Settings' `TamaPicker.jsx` draws a critter in its own viewBox; leave it alone.

- [ ] **Step 4: Run the tests**

`npx vitest run static/src/chrome static/src/overlays`: all pass. "Clawd's drawing, pinned" covers Clawd only, so it's unchanged. Batch 1's held-prop tests read the drawn placement, so they follow the bigger critter.

Then `npm test`, `npx biome lint static/src/chrome` and `bin/check`.

- [ ] **Step 5: Commit**

```bash
git add static/src/chrome/critters.js static/src/chrome/TamaPastimes.jsx static/src/chrome/__tests__/critters.test.js static/src/chrome/__tests__/tamagotchiRender.test.jsx
git commit -m "critters: stand 12 tall, a fifth over Clawd — a square critter was half his size; kids stay half"
```

---

### Task 4: Hand check, docs, bundle, gate

- [ ] **Step 1: Render the five scenes from the branch, and compare with the approved draft**

Render `TamaScene` for every entry of `CRITTERS` in `beer`, `coffee`, `cook`, `garden` and `dog` (summer), with a throwaway `vite-node` script outside the repo. Leave out the reduced-motion `@media` block. Check that it matches the approved draft:
- the appendage reaches the prop;
- the pint clinks with the friend's;
- the mug is held by its handle;
- the spoon goes into the pot;
- the can hangs by its handle;
- the leash runs to the dog;
- Nox's and Ember's resting tails are gone while they hold.

- [ ] **Step 2: Note it in the critter-picker spec**

In `docs/superpowers/specs/2026-10-21-tamagotchi-critter-picker-design.md`, update the `**Status:**` paragraph under `### Critters as expressive as Clawd`:
- say that critters now hold the pint, mug, spoon, watering can and leash with their own appendage (part 2b batch 1, `docs/superpowers/specs/2026-10-23-critter-held-props-batch1-design.md`);
- say that what remains is the bass and the controller (part 2b batch 2), and hands and strides (part 3).

- [ ] **Step 3: Bundle and gate**

```bash
npm run build
bin/check && npm test && uv run pytest -q
```

Expected: `static/dist/app.js` changes, and everything passes.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/2026-10-21-tamagotchi-critter-picker-design.md static/dist/app.js
git commit -m "docs + build: critters hold things (THI-415 part 2b, batch 1); static/dist rebuilt"
```
