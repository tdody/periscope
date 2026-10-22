# Critter Duty Faces Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every critter shows Clawd's duty faces: happy, `x`, worried and look-down, plus the bell's "!" at its own head. The faces are generated from the eye boxes its sprite already has, and a critter can override any face with its own art.

**Architecture:**
- `build_critters.py` adds `anchors` (eye boxes, the head's top-right), an `ink` colour and optional `faces` override layers to each generated sprite.
- A pure `faceGlyphs(sprite, face)` / `startleGlyph(sprite)` in `critters.js` turns those into sprite-tree nodes.
- `Critter.jsx` draws them over the eyes, hiding the eyes it replaces.
- `TamaScene` picks the face with Clawd's existing rules.
- Clawd's drawing is pinned by a hash over every scene combination, so the work provably never touches him.

**Tech Stack:** Python 3 (`build_critters.py`, pytest), Preact + `preact-render-to-string` (vitest, node environment), SVG pixel art.

**Spec:** `docs/superpowers/specs/2026-10-22-critter-duty-faces-design.md`. Read it first.

---

## Conventions for every task

- **Where to work:** the worktree `.claude/worktrees/critter-faces`, branch `feature/critter-faces`. Run every command from the worktree root.
- **Commits:** one per task, a single-line message, ending with the trailer:
  ```
  Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
  ```
- **Generated files:** `static/src/chrome/critterSprites.js` and `static/critters.css` come from `uv run build_critters.py`. Never hand-edit them. Re-run the script after any change to `build_critters.py` or an SVG, and commit its output in the same commit.
- **Tests:**
  - Python: `uv run pytest tests/test_build_critters.py -q`
  - vitest: `npx vitest run <file>`
  - full suites: `uv run pytest -q` and `npm test`
- **Gate:** `bin/check` must pass with zero violations. The 3 Biome warnings in `Rail.jsx` and `spawnAccountPickerRender.test.jsx` are pre-existing and fine.
- **Python formatting:** after editing Python, run `uv run ruff format build_critters.py tests/test_build_critters.py`. The project formats at line length 120, and `bin/check` fails on unformatted files.
- **Comments** explain *why*, tersely, in the voice of the surrounding code.

## File map

| File | Change |
|---|---|
| `build_critters.py` | `FACE_CLASSES`, `INK_RE`, `clean`, `sprite_box`, `shutters`, `anchors_of`, `ink_of`; face layers parsed out of the root tree; `anchors` / `ink` / `faces` in each sprite |
| `tests/test_build_critters.py` | tests for anchors, ink and face layers; `_svg` gains `svg_attrs` |
| `docs/specs/assets/critters/nox.svg` | `data-ink="#c6e05a"` and a `face-worried` layer |
| `docs/specs/assets/critters/moss.svg` | `data-ink="#0f2e1b"` |
| `static/src/chrome/critterSprites.js`, `static/critters.css` | regenerated |
| `static/src/chrome/critters.js` | `faceGlyphs`, `startleGlyph` |
| `static/src/chrome/__tests__/critters.test.js` | tests for faceGlyphs, startleGlyph and anchors |
| `static/src/chrome/Critter.jsx` | path nodes, `cls`, `face` / `startle` props |
| `static/src/chrome/__tests__/critterRender.test.jsx` | face rendering tests |
| `static/src/chrome/Tamagotchi.jsx` | `critterFace`; Critter gets `face` / `startle`; scene-level `Startle` for Clawd only |
| `static/src/chrome/__tests__/tamagotchiRender.test.jsx` | Clawd hash pin; critter face-rule tests |
| `docs/superpowers/specs/2026-10-21-tamagotchi-critter-picker-design.md` | Follow-ups: faces done |
| `static/dist/app.js` | rebuilt |

---

### Task 0: Worktree

- [ ] **Step 1: Create the worktree from local `main`**

Local `main` is ahead of `origin/main` (it has the spec and this plan), so don't branch from origin:

```bash
cd ~/github/tomplex/periscope
git worktree add .claude/worktrees/critter-faces -b feature/critter-faces main
cd .claude/worktrees/critter-faces
npm install --silent
uv sync -q
```

- [ ] **Step 2: Confirm the starting point is green**

Run: `npx vitest run static/src/chrome && uv run pytest tests/test_build_critters.py -q`
Expected: all pass.

---

### Task 1: Pin Clawd's drawing

This comes first so every later task proves it didn't change Clawd. The hash below was computed at `main` (`a33dcca`) with exactly this matrix: 3264 renders.

**Files:**
- Modify: `static/src/chrome/__tests__/tamagotchiRender.test.jsx` (add an import at the top and a `describe` at the end)

- [ ] **Step 1: Add the pinned test**

Add to the imports at the top of the file:

```js
import { createHash } from "node:crypto";
```

Append at the end of the file:

```js
describe("Clawd's drawing, pinned", () => {
  // Every activity × duty kind × mood × occasion × season, hashed. Critter work
  // must never move a pixel of Clawd: a failure here means a change reached his
  // drawing. Update the hash only for a change to Clawd that's meant.
  it("renders every combination exactly as before", () => {
    const KINDS = [null, "bell", "done", "merged", "ci", "api", "ctx", "update"];
    const hash = createHash("sha256");
    let n = 0;
    for (const activity of [...ids, "nap"]) {
      for (const kind of KINDS) {
        for (const mood of ["calm", "grumpy", "furious"]) {
          for (const occasion of [null, "halloween", "yearend", "newyear"]) {
            for (const season of ["summer", "winter"]) {
              hash.update(render(
                <TamaScene activity={activity} season={season} occasion={occasion} mood={mood} working={2}
                           duty={kind && { kind, label: "1", more: 0 }} party={kind === "merged"}
                           walled={activity === "nap" ? { day: null, time: "3pm" } : null} />,
              ));
              hash.update("\n");
              n += 1;
            }
          }
        }
      }
    }
    expect(n).toBe(3264);
    expect(hash.digest("hex")).toBe("355da01dc9d061fcadcececf89882f0b92f8aa96e78944ec91680969f22be094");
  });
});
```

- [ ] **Step 2: Run it and confirm it passes at the base**

Run: `npx vitest run static/src/chrome/__tests__/tamagotchiRender.test.jsx -t "pinned"`
Expected: PASS.

If the hash differs, the environment renders differently from the one that computed it. Stop and report the printed hash rather than changing it.

- [ ] **Step 3: Commit**

```bash
git add static/src/chrome/__tests__/tamagotchiRender.test.jsx
git commit -m "tamagotchi: pin Clawd's drawing — a hash over every activity × duty × mood × occasion × season, so critter work provably never moves a pixel of him"
```

---

### Task 2: Anchors and ink in the generated sprites

**Files:**
- Modify: `build_critters.py`
- Modify: `docs/specs/assets/critters/nox.svg`, `docs/specs/assets/critters/moss.svg`
- Regenerate: `static/src/chrome/critterSprites.js`, `static/critters.css`
- Test: `tests/test_build_critters.py`

- [ ] **Step 1: Write the failing tests**

In `tests/test_build_critters.py`, add `import json` next to `import re` at the top. Replace the `_svg` helper with this version, which adds `svg_attrs`:

```python
def _svg(tmp_path: Path, body: str, g_attrs: str = "", svg_attrs: str = "") -> Path:
    p = tmp_path / "bad.svg"
    bob = '<animateTransform attributeName="transform" type="translate" values="0 0;0 -1" dur="1s" repeatCount="indefinite" data-bob="x"/>'
    p.write_text(
        f'<svg viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg"{svg_attrs}><g{g_attrs}>{bob}{body}</g></svg>'
    )
    return p
```

Append:

```python
def _sprite(cid: str) -> dict:
    js, _ = build_critters.render()
    line = next(ln for ln in js.splitlines() if ln.startswith(f"  {cid}:"))
    return json.loads(line.split(":", 1)[1].strip().rstrip(","))


# A blinking eye (height dips) and a lid (height grows from 0), as the real SVGs draw them.
EYE = (
    '<rect x="6" y="9" width="2" height="2" fill="#111111">'
    '<animate attributeName="height" values="2;0.4;2" dur="4s" repeatCount="indefinite"/></rect>'
)
LID = (
    '<rect x="6" y="6" width="3" height="0" fill="#222222">'
    '<animate attributeName="height" values="0;3;0" dur="5s" repeatCount="indefinite"/></rect>'
)
BODY = '<rect x="3" y="5" width="14" height="10" fill="#40b8ee"/>'


def test_anchors_list_each_critters_eyes():
    assert _sprite("scope")["anchors"]["eyes"] == [
        {"x": 6, "y": 9, "w": 2, "h": 2, "role": "eye"},
        {"x": 12, "y": 9, "w": 2, "h": 2, "role": "eye"},
    ]
    assert _sprite("moss")["anchors"]["eyes"] == [{"x": 8, "y": 7, "w": 4, "h": 3, "role": "lid"}]
    for cid in build_critters.CRITTERS:
        assert _sprite(cid)["anchors"]["eyes"], cid


def test_anchors_head_is_the_top_right_of_the_sprite_box():
    # Jelly's always-drawn box is x 4, y 3, w 12, h 15 (critters.test.js pins the same box).
    assert _sprite("jelly")["anchors"]["head"] == {"top": 3, "right": 16}


def test_ink_is_the_eye_fill_or_the_declared_colour():
    assert _sprite("scope")["ink"] == "#0f1215"
    assert _sprite("nox")["ink"] == "#c6e05a"
    assert _sprite("moss")["ink"] == "#0f2e1b"


def test_ink_from_an_eye_and_overridden_by_data_ink(tmp_path):
    s = build_critters.convert("t", _svg(tmp_path, BODY + EYE), build_critters.Sheet())
    assert s["ink"] == "#111111"
    s = build_critters.convert("t", _svg(tmp_path, BODY + EYE, svg_attrs=' data-ink="#abcdef"'), build_critters.Sheet())
    assert s["ink"] == "#abcdef"


def test_a_lid_critter_must_declare_its_ink(tmp_path):
    with pytest.raises(ValueError, match="data-ink"):
        build_critters.convert("t", _svg(tmp_path, BODY + LID), build_critters.Sheet())
    s = build_critters.convert("t", _svg(tmp_path, BODY + LID, svg_attrs=' data-ink="#c6e05a"'), build_critters.Sheet())
    assert s["ink"] == "#c6e05a"
    assert s["anchors"]["eyes"] == [{"x": 6, "y": 6, "w": 3, "h": 3, "role": "lid"}]


def test_data_ink_must_be_a_hex_colour(tmp_path):
    with pytest.raises(ValueError, match="data-ink"):
        build_critters.convert("t", _svg(tmp_path, BODY + EYE, svg_attrs=' data-ink="green"'), build_critters.Sheet())
```

- [ ] **Step 2: Run them and watch them fail**

Run: `uv run pytest tests/test_build_critters.py -q -k "anchors or ink"`
Expected: FAIL, with a `KeyError: 'anchors'` or `'ink'`, or `DID NOT RAISE`.

- [ ] **Step 3: Implement the anchors and ink in `build_critters.py`**

After the `MOODS = {...}` line, add:

```python
INK_RE = re.compile(r"^#[0-9a-fA-F]{6}$")
```

After the `drawn()` function, add:

```python
def clean(v: float) -> float:
    """A coordinate as the generated JS should print it: 4 decimals, "16" not "16.0"."""
    v = round(v, 4)
    return int(v) if float(v).is_integer() else v


def sprite_box(root: list[dict]) -> list[float]:
    """critters.js's spriteBox, in Python: the always-drawn layers' [x, y, w, h], mood layers left out."""
    x0 = y0 = float("inf")
    x1 = y1 = float("-inf")

    def walk(n: dict) -> None:
        nonlocal x0, y0, x1, y1
        if "mood" in n:
            return
        if "r" in n:
            x, y, w, h = n["r"]
            x0, y0, x1, y1 = min(x0, x), min(y0, y), max(x1, x + w), max(y1, y + h)
            return
        for c in n.get("g", []):
            walk(c)

    for n in root:
        walk(n)
    return [x0, y0, x1 - x0, y1 - y0]


def shutters(nodes: list[dict]):
    """Every eye and lid node (the roles _convert assigns), depth first."""
    for n in nodes:
        if n.get("role") in ("eye", "lid"):
            yield n
        yield from shutters(n.get("g", []))


def anchors_of(root: list[dict]) -> dict:
    """Where the duty faces go (critters.js faceGlyphs): each eye's box, and the head's top-right corner."""
    x, y, w, _ = sprite_box(root)
    eyes = [dict(zip(("x", "y", "w", "h"), n["g"][0]["r"], strict=True), role=n["role"]) for n in shutters(root)]
    return {"eyes": eyes, "head": {"top": clean(y), "right": clean(x + w)}}


def ink_of(svg_name: str, doc: ET.Element, root: list[dict]) -> str | None:
    """The faces' glyph colour: the eyes' own fill, or data-ink on the <svg> where it can't be read."""
    declared = doc.get("data-ink")
    if declared is not None:
        if not INK_RE.match(declared):
            raise ValueError(f"{svg_name}: data-ink must be #rrggbb, got {declared!r}")
        return declared
    found = list(shutters(root))
    eye = next((n for n in found if n["role"] == "eye"), None)
    fill = eye and (eye["g"][0].get("a", {}).get("fill") or eye.get("a", {}).get("fill"))
    if found and not fill:
        # A lid covers the eye it shuts, so the colour under it isn't in the drawing.
        raise ValueError(f'{svg_name}: its eyes are lids or unpainted; declare the face colour with data-ink="#rrggbb"')
    return fill
```

At the end of `_convert`, replace

```python
    return {"name": doc.get("aria-label") or cid.title(), "root": root}
```

with

```python
    return {
        "name": doc.get("aria-label") or cid.title(),
        "root": root,
        "anchors": anchors_of(root),
        "ink": ink_of(svg.name, doc, root),
    }
```

In the module docstring's conventions list, after the line about lids (`one whose height starts at 0 and grows over the eye.`), add:

```
  - a critter whose eyes are lids declares its face colour with data-ink="#rrggbb"
    on the <svg> (the colour under a lid isn't in the drawing).
```

- [ ] **Step 4: Declare the ink on the two lid critters**

```bash
python3 - <<'EOF'
from pathlib import Path
for name, ink in (("nox", "#c6e05a"), ("moss", "#0f2e1b")):
    p = Path(f"docs/specs/assets/critters/{name}.svg")
    s = p.read_text()
    assert "data-ink" not in s
    p.write_text(s.replace("<svg ", f'<svg data-ink="{ink}" ', 1))
EOF
uv run build_critters.py
```

Expected: `wrote static/src/chrome/critterSprites.js and static/critters.css`. `git diff --stat static/critters.css` shows no change.

- [ ] **Step 5: Run the tests**

Run: `uv run pytest tests/test_build_critters.py -q`
Expected: all pass, including `test_committed_output_is_fresh`.

Run: `npx vitest run static/src/chrome`
Expected: all pass. The sprites only gained keys, and the Clawd pin is unchanged.

- [ ] **Step 6: Commit**

```bash
git add build_critters.py tests/test_build_critters.py docs/specs/assets/critters/nox.svg docs/specs/assets/critters/moss.svg static/src/chrome/critterSprites.js static/critters.css
git commit -m "critters: each sprite carries anchors (its eye boxes, the head's top-right) and an ink colour for the duty faces; lid critters declare data-ink"
```

---

### Task 3: Face override layers

**Files:**
- Modify: `build_critters.py`
- Modify: `docs/specs/assets/critters/nox.svg`
- Regenerate: `static/src/chrome/critterSprites.js`, `static/critters.css`
- Test: `tests/test_build_critters.py`

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_build_critters.py` (the `EYE` and `BODY` constants come from Task 2):

```python
def test_face_layers_are_parsed_out_of_the_drawn_tree(tmp_path):
    face = '<g class="face-happy" fill="#123456"><rect x="1" y="1" width="2" height="1"/></g>'
    s = build_critters.convert("t", _svg(tmp_path, BODY + EYE + face), build_critters.Sheet())
    assert s["faces"] == {"happy": [{"g": [{"r": [1, 1, 2, 1]}], "a": {"fill": "#123456"}}]}
    assert "[1,1,2,1]" not in json.dumps(s["root"], separators=(",", ":"))


def test_no_faces_key_without_face_layers(tmp_path):
    assert "faces" not in build_critters.convert("t", _svg(tmp_path, BODY + EYE), build_critters.Sheet())


@pytest.mark.parametrize(
    "layer,match",
    [
        ('<g class="face-wink"><rect x="1" y="1" width="1" height="1"/></g>', "face-wink"),
        # A face layer nested inside another group would be drawn all the time instead.
        ('<g><g class="face-happy"><rect x="1" y="1" width="1" height="1"/></g></g>', "directly under"),
        ('<rect class="face-happy" x="1" y="1" width="1" height="1"/>', "face-happy"),
        (
            '<g class="face-x"><rect x="1" y="1" width="1" height="1"/></g>'
            '<g class="face-x"><rect x="2" y="2" width="1" height="1"/></g>',
            "twice",
        ),
    ],
)
def test_raises_on_a_bad_face_layer(tmp_path, layer, match):
    with pytest.raises(ValueError, match=match):
        build_critters.convert("t", _svg(tmp_path, BODY + EYE + layer), build_critters.Sheet())


def test_nox_draws_its_own_worried_brows():
    worried = _sprite("nox")["faces"]["worried"]
    assert worried[0]["a"] == {"fill": "#8f9397"}
    assert len(worried[0]["g"]) == 4
```

- [ ] **Step 2: Run them and watch them fail**

Run: `uv run pytest tests/test_build_critters.py -q -k "face"`
Expected: FAIL. `face-wink` and the other classes currently raise `unknown class`, and there's no `faces` key.

- [ ] **Step 3: Implement the face layers in `build_critters.py`**

After `MOODS = {...}`, add:

```python
FACES = {"face-happy": "happy", "face-x": "x", "face-worried": "worried", "face-down": "down"}
```

Replace `mood_of` with:

```python
def mood_of(el: ET.Element) -> str | None:
    cls = el.get("class")
    if cls is None or cls in FACES:  # face layers are kept out of the tree by _convert, not drawn by mood
        return None
    if cls not in MOODS:
        raise ValueError(f"unknown class {cls!r}")
    return MOODS[cls]
```

In `node()`, in the `if t == "rect":` branch, right after `check_attrs(el, {"x", "y", "width", "height"})`, add:

```python
            if el.get("class") in FACES:
                raise ValueError(f"{svg.name}: {el.get('class')} must be a <g>, not a <rect>")
```

In `node()`, in the `if t == "g":` branch, right after `check_attrs(el, set())`, add:

```python
            if el.get("class") in FACES:
                raise ValueError(f"{svg.name}: {el.get('class')} must sit directly under the outer <g>")
```

Replace the root-building loop

```python
    root = []
    for c in kids[1:]:
        if tag(c) not in ("rect", "g"):
            raise ValueError(f"{svg.name}: unsupported element <{tag(c)}> directly under the outer <g>")
        root.append(node(c, False))
```

with

```python
    root = []
    faces: dict[str, list[dict]] = {}
    for c in kids[1:]:
        if tag(c) not in ("rect", "g"):
            raise ValueError(f"{svg.name}: unsupported element <{tag(c)}> directly under the outer <g>")
        if tag(c) == "g" and c.get("class") in FACES:
            # A critter's own art for one duty face, drawn instead of the generated glyph (critters.js
            # faceGlyphs) and never as part of the critter itself.
            name = FACES[c.get("class")]
            if name in faces:
                raise ValueError(f"{svg.name}: {c.get('class')} appears twice")
            check_attrs(c, set())
            layer = {"g": [node(k, False) for k in c]}
            if paint(c):
                layer["a"] = paint(c)
            faces[name] = [layer]
            continue
        root.append(node(c, False))
```

The face layer's children go through `node()`, which only accepts `<rect>` and `<g>` and raises on anything else.

Replace the return statement from Task 2 with:

```python
    out = {
        "name": doc.get("aria-label") or cid.title(),
        "root": root,
        "anchors": anchors_of(root),
        "ink": ink_of(svg.name, doc, root),
    }
    if faces:
        out["faces"] = faces
    return out
```

In the module docstring's conventions list, after the `data-ink` lines from Task 2, add:

```
  - a critter's own art for a duty face is a <g class="face-happy|face-x|face-worried|face-down">
    directly under the outer <g>; it's drawn instead of the generated face, never as the critter.
```

- [ ] **Step 4: Give Nox its worried brows**

Light grey, because the generated dark brows vanish on the black cat. Each brow is two short steps, inner end raised:

```bash
python3 - <<'EOF'
from pathlib import Path
p = Path("docs/specs/assets/critters/nox.svg")
s = p.read_text()
assert "face-worried" not in s
layer = (
    '  <g class="face-worried" fill="#8f9397">'
    '<rect x="5.8" y="5.5" width="1.4" height="0.5"></rect><rect x="7.2" y="5" width="1.6" height="0.5"></rect>'
    '<rect x="11.2" y="5" width="1.6" height="0.5"></rect><rect x="12.8" y="5.5" width="1.4" height="0.5"></rect>'
    "</g>\n      "
)
i = s.rindex("</g>")  # the outer <g>'s close: the last </g> before </svg>
p.write_text(s[:i] + layer + s[i:])
EOF
uv run build_critters.py
```

- [ ] **Step 5: Run the tests**

Run: `uv run pytest tests/test_build_critters.py -q && npx vitest run static/src/chrome`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add build_critters.py tests/test_build_critters.py docs/specs/assets/critters/nox.svg static/src/chrome/critterSprites.js static/critters.css
git commit -m "critters: a face-* layer in a critter's SVG is its own art for that duty face, kept out of its drawing; Nox gets light-grey worried brows"
```

---

### Task 4: `faceGlyphs` and `startleGlyph`

**Files:**
- Modify: `static/src/chrome/critters.js` (append)
- Test: `static/src/chrome/__tests__/critters.test.js`
- Modify: `docs/superpowers/specs/2026-10-22-critter-duty-faces-design.md` (one sentence)

- [ ] **Step 1: Write the failing tests**

In `static/src/chrome/__tests__/critters.test.js`, change the import line to:

```js
import { CLAWD_HEIGHT, CRITTERS, critterById, faceGlyphs, placement, spriteBox, startleGlyph } from "../critters.js";
```

Append:

```js
describe("anchors", () => {
  it.each(sprites.map((c) => [c.id, c.sprite]))("%s's head anchor is its sprite box's top-right", (_id, sprite) => {
    const box = spriteBox(sprite);
    expect(sprite.anchors.head.top).toBeCloseTo(box.y);
    expect(sprite.anchors.head.right).toBeCloseTo(box.x + box.w);
    expect(sprite.anchors.eyes.length).toBeGreaterThan(0);
    expect(sprite.ink).toMatch(/^#[0-9a-f]{6}$/i);
  });
});

describe("faceGlyphs", () => {
  const scope = critterById("scope").sprite;
  const moss = critterById("moss").sprite;
  const nox = critterById("nox").sprite;

  it("draws one glyph per eye, in the critter's ink", () => {
    for (const face of ["happy", "x", "down"]) {
      const [group] = faceGlyphs(scope, face);
      expect(group.g, face).toHaveLength(2);
      expect(Object.values(group.a), face).toContain(scope.ink);
    }
    expect(faceGlyphs(moss, "happy")[0].g).toHaveLength(1);
  });

  it("keeps each glyph on its eye", () => {
    const [down] = faceGlyphs(scope, "down");
    down.g.forEach(({ r: [x, y, w, h] }, i) => {
      const e = scope.anchors.eyes[i];
      expect(x).toBe(e.x);
      expect(w).toBe(e.w);
      expect(y).toBeGreaterThan(e.y);
      expect(y + h).toBeCloseTo(e.y + e.h);
    });
    const [happy] = faceGlyphs(scope, "happy");
    happy.g.forEach(({ p }, i) => expect(p.startsWith(`M${scope.anchors.eyes[i].x} `)).toBe(true));
  });

  it("moves the happy face like Clawd's", () => {
    expect(faceGlyphs(scope, "happy")[0].cls).toBe("tama-happy-eyes");
  });

  it("adds a brow per eye and one sweat drop when worried", () => {
    const worried = faceGlyphs(scope, "worried");
    expect(worried[0].g).toHaveLength(2);
    expect(worried.at(-1).cls).toBe("tama-sweat");
    expect(faceGlyphs(moss, "worried")[0].g).toHaveLength(1);
  });

  it("uses a critter's own face layer over the generated glyph", () => {
    const own = [{ g: [{ r: [1, 1, 1, 1] }] }];
    expect(faceGlyphs({ ...scope, faces: { happy: own } }, "happy")).toEqual(own);
  });

  it("keeps the sweat drop under a critter's own worried brows", () => {
    const worried = faceGlyphs(nox, "worried");
    expect(worried[0]).toBe(nox.faces.worried[0]);
    expect(worried.at(-1).cls).toBe("tama-sweat");
  });

  it("draws nothing for a face it doesn't know", () => {
    expect(faceGlyphs(scope, "wink")).toEqual([]);
  });
});

describe("startleGlyph", () => {
  it("puts the bell's \"!\" just past the head's right edge", () => {
    const scope = critterById("scope").sprite;
    const [bang] = startleGlyph(scope);
    expect(bang.cls).toBe("tama-startle");
    expect(bang.g[0].r[0]).toBeCloseTo(scope.anchors.head.right + 0.4);
    expect(bang.g[0].r[1]).toBeCloseTo(scope.anchors.head.top + 0.5);
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run static/src/chrome/__tests__/critters.test.js`
Expected: FAIL, because `faceGlyphs` and `startleGlyph` aren't exported.

- [ ] **Step 3: Implement them**

Append to `static/src/chrome/critters.js`:

```js
// The duty faces Critter.jsx draws over a critter's eyes (TamaScene picks one
// with Clawd's rules), as nodes in the sprite tree's own format, in sprite
// units: generated from the eye boxes build_critters.py found
// (`sprite.anchors`), in the critter's `ink`, unless its SVG drew its own
// (`sprite.faces`). The worried face's sweat drop is always generated: it's
// the head's, not the eyes'.
const STROKE = 0.75; // Clawd's 0.45-unit glyph stroke, at a critter's ~0.6 scale
const r4 = (v) => Math.round(v * 1e4) / 1e4;
const stroked = (ink, width = STROKE) => ({ fill: "none", stroke: ink, "stroke-width": width, "stroke-linecap": "square" });

// Inner ends raised, as Clawd's Worried. One eye (Moss) gets a single tent-shaped brow.
function brows(eyes) {
  if (eyes.length === 1) {
    const { x, y, w } = eyes[0];
    return [{ p: `M${r4(x - 0.3)} ${r4(y - 0.7)} l${r4(w / 2 + 0.3)} -0.8 l${r4(w / 2 + 0.3)} 0.8` }];
  }
  const mid = eyes.reduce((s, e) => s + e.x + e.w / 2, 0) / eyes.length;
  return eyes.map(({ x, y, w }) => (x + w / 2 < mid
    ? { p: `M${r4(x - 0.3)} ${r4(y - 1.1)} l${r4(w + 0.4)} -0.8` }
    : { p: `M${r4(x - 0.1)} ${r4(y - 1.9)} l${r4(w + 0.4)} 0.8` }));
}

export function faceGlyphs(sprite, face) {
  const { eyes, head } = sprite.anchors;
  const ink = sprite.ink;
  const own = sprite.faces?.[face];
  if (face === "worried") {
    const sweat = {
      p: `M${r4(head.right - 0.4)} ${r4(head.top + 1)} q1.2 1.8 0 2.7 q-1.2 -0.9 0 -2.7z`,
      cls: "tama-sweat", a: { fill: "#7fb6e6", "shape-rendering": "geometricPrecision" },
    };
    return [...(own || [{ g: brows(eyes), a: stroked(ink, 0.6) }]), sweat];
  }
  if (own) return own;
  if (face === "happy") {
    return [{
      cls: "tama-happy-eyes", a: stroked(ink),
      g: eyes.map(({ x, y, w, h }) => ({ p: `M${x} ${r4(y + 0.75 * h)} l${r4(w / 2)} ${r4(-h / 2)} l${r4(w / 2)} ${r4(h / 2)}` })),
    }];
  }
  if (face === "x") {
    return [{
      a: stroked(ink),
      g: eyes.map(({ x, y, w, h }) => ({
        p: `M${r4(x + 0.1)} ${r4(y + 0.1)} L${r4(x + w - 0.1)} ${r4(y + h - 0.1)} M${r4(x + w - 0.1)} ${r4(y + 0.1)} L${r4(x + 0.1)} ${r4(y + h - 0.1)}`,
      })),
    }];
  }
  if (face === "down") {
    return [{ a: { fill: ink }, g: eyes.map(({ x, y, w, h }) => ({ r: [x, r4(y + 0.45 * h), w, r4(0.55 * h)] })) }];
  }
  return [];
}

// The bell's "!" away from the desk, beside the critter's own head: Clawd's
// Startle sits at his right edge, which floats off any narrower critter.
export function startleGlyph(sprite) {
  const { head } = sprite.anchors;
  const x = r4(head.right + 0.4);
  return [{
    cls: "tama-startle", a: { fill: "#f2c14e" },
    g: [{ r: [x, r4(head.top + 0.5), 1, 3] }, { r: [x, r4(head.top + 4.1), 1, 1] }],
  }];
}
```

- [ ] **Step 4: Record the sweat-drop rule in the spec**

In `docs/superpowers/specs/2026-10-22-critter-duty-faces-design.md`, find the sentence in "Geometry":

```
If `sprite.faces[face]` exists, those nodes are returned instead of the generated shapes.
```

Replace it with:

```
If `sprite.faces[face]` exists, those nodes are returned instead of the generated eye shapes. The worried face's sweat drop is still generated, because it belongs to the head, not the eyes. Override layers are rects only, like the rest of the generated art.
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run static/src/chrome/__tests__/critters.test.js`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add static/src/chrome/critters.js static/src/chrome/__tests__/critters.test.js docs/superpowers/specs/2026-10-22-critter-duty-faces-design.md
git commit -m "critters: faceGlyphs and startleGlyph — the duty faces as sprite nodes, generated from each critter's eye boxes in its ink, or its own art"
```

---

### Task 5: `Critter` draws a face

**Files:**
- Modify: `static/src/chrome/Critter.jsx` (whole file below)
- Test: `static/src/chrome/__tests__/critterRender.test.jsx`

- [ ] **Step 1: Write the failing tests**

Append inside the `describe("<Critter>", () => { ... })` block in `static/src/chrome/__tests__/critterRender.test.jsx`, before its closing `});`:

```js
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
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run static/src/chrome/__tests__/critterRender.test.jsx`
Expected: FAIL. There's no `data-face`, and the eyes are still drawn.

- [ ] **Step 3: Implement**

Replace `static/src/chrome/Critter.jsx` with:

```jsx
// One critter (critters.js), drawn from its generated sprite tree in its own
// 20×20 units. Motion is the classes in static/critters.css; the caller places
// and scales it (Tamagotchi.jsx in the header, TamaPicker.jsx in Settings).

import { faceGlyphs, startleGlyph } from "./critters.js";

// A mood layer shows only in its mood. Asleep, an eye or a lid is drawn as its
// `shut` frame, held, and the glint riding on a blinking eye goes away. Under a
// face (`hide`), the face's glyph replaces the eye: the eye and its glint go,
// and a lid shuts over the eye it covers.
function Node({ n, mood, asleep, hide }) {
  if (n.mood && n.mood !== mood) return null;
  if ((asleep || hide) && n.role === "glint") return null;
  if (hide && n.role === "eye") return null;
  if (n.r) {
    const [x, y, w, h] = n.r;
    return <rect class={n.cls} x={x} y={y} width={w} height={h} {...n.a} />;
  }
  if (n.p) return <path class={n.cls} d={n.p} {...n.a} />;
  if ((asleep || hide) && n.shut) {
    const [x, y, w, h] = n.shut;
    return <rect data-role="shut" x={x} y={y} width={w} height={h} {...n.g[0].a} />;
  }
  return (
    <g class={n.anim || n.cls} data-mood={n.mood} data-role={n.role} {...n.a}>
      {n.g.map((c, i) => <Node key={i} n={c} mood={mood} asleep={asleep} hide={hide} />)}
    </g>
  );
}

// `face` is one of the duty faces (critters.js faceGlyphs) and `startle` the
// bell's "!": both drawn inside the critter's own group, so they scale and bob
// with it.
export function Critter({ sprite, mood = "calm", asleep = false, face = null, startle = false }) {
  const hide = face === "happy" || face === "x" || face === "down";
  return (
    <g class="critter" data-face={face || undefined}>
      {sprite.root.map((n, i) => <Node key={i} n={n} mood={mood} asleep={asleep} hide={hide} />)}
      {face && faceGlyphs(sprite, face).map((n, i) => <Node key={`face-${i}`} n={n} mood={mood} />)}
      {startle && startleGlyph(sprite).map((n, i) => <Node key={`startle-${i}`} n={n} mood={mood} />)}
    </g>
  );
}
```

`class={undefined}` and `data-face={undefined}` render nothing, so a critter without a face, as in the Settings picker, draws byte-identically to before.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run static/src/chrome static/src/overlays`
Expected: all pass, including the existing `<Critter>`, picker and Clawd pin tests.

- [ ] **Step 5: Commit**

```bash
git add static/src/chrome/Critter.jsx static/src/chrome/__tests__/critterRender.test.jsx
git commit -m "critter: draws a duty face over its eyes (they go, a lid shuts) and the bell's \"!\" inside its own group, so both scale and bob with it"
```

---

### Task 6: `TamaScene` gives critters Clawd's faces

**Files:**
- Modify: `static/src/chrome/Tamagotchi.jsx` (in `TamaScene`)
- Test: `static/src/chrome/__tests__/tamagotchiRender.test.jsx`

- [ ] **Step 1: Write the failing tests**

In `static/src/chrome/__tests__/tamagotchiRender.test.jsx`, inside `describe("critters", () => { ... })`, add before its closing `});`:

```js
  const faceOf = (html) => html.match(/<g class="critter"(?: data-face="(\w+)")?/)[1] ?? null;
  const duty = (kind) => ({ duty: { kind, label: "1", more: 0 } });

  it.each(critters.map((c) => [c.id, c]))("%s makes Clawd's duty faces when he would", (_id, c) => {
    expect(faceOf(scene(c, "code", duty("done")))).toBe("happy");
    expect(faceOf(scene(c, "code", { ...duty("merged"), party: true }))).toBe("happy");
    expect(faceOf(scene(c, "eat", duty("done")))).toBe("happy"); // a face kind, away from the desk
    expect(faceOf(scene(c, "code", duty("api")))).toBe("x");
    expect(faceOf(scene(c, "code", duty("ctx")))).toBe("worried");
    expect(faceOf(scene(c, "code", duty("update")))).toBe("down");
    expect(faceOf(scene(c, "beer"))).toBe("happy"); // a smiling pastime
  });

  it.each(critters.map((c) => [c.id, c]))("%s keeps its own face otherwise", (_id, c) => {
    expect(faceOf(scene(c, "code"))).toBeNull();
    expect(faceOf(scene(c, "code", { mood: "furious" }))).toBeNull(); // the mood stays its own layers
    expect(faceOf(scene(c, "code", duty("ci")))).toBeNull();
    expect(faceOf(scene(c, "eat", duty("update")))).toBeNull(); // update only shows at the desk
    expect(faceOf(scene(c, "sleep"))).toBeNull();
    expect(faceOf(scene(c, "beer", duty("api")))).toBe("x"); // on duty, the smile gives way
  });

  it("puts the bell's \"!\" on the critter's own head, and only away from the desk", () => {
    const nox = critterById("nox");
    const away = scene(nox, "beer", duty("bell"));
    expect(count(away, "tama-startle")).toBe(1);
    expect(away.slice(away.indexOf('class="critter"'))).toContain("tama-startle");
    expect(scene(nox, "code", duty("bell"))).not.toContain("tama-startle");
  });
```

`count` isn't defined in this `describe` (it lives in "Clawd on duty"), so add this line right after the `const scene = ...` definition at the top of `describe("critters", ...)`:

```js
  const count = (html, needle) => html.split(needle).length - 1;
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run static/src/chrome/__tests__/tamagotchiRender.test.jsx -t "critters"`
Expected: FAIL. No critter has a `data-face` yet, and the "!" is drawn at scene level.

- [ ] **Step 3: Implement in `TamaScene`**

In `static/src/chrome/Tamagotchi.jsx`, right after the `const face = ghost ? <GhostSheet x0={x0} /> ... : <Eyes x0={x0} />;` chain, add:

```js
  // A critter's duty face (Critter.jsx draws it over its eyes): Clawd's rules
  // above, with the moods left to the critter's own layers.
  const critterFace = !sprite || ghost || asleep || moody ? null
    : celebrating ? "happy"
    : pose === "api" ? "x"
    : pose === "update" ? "down"
    : pose === "ctx" ? "worried"
    : !pose && p?.smile ? "happy"
    : null;
```

Replace

```jsx
            <Critter sprite={sprite} mood={moody ? mood : "calm"} asleep={asleep} />
```

with

```jsx
            <Critter sprite={sprite} mood={moody ? mood : "calm"} asleep={asleep} face={critterFace}
                     startle={pose === "bell" && !deskBell} />
```

Replace

```jsx
        <Head dy={headDy}>{pose === "bell" && !deskBell && <Startle x0={x0} />}</Head>
```

with

```jsx
        {!sprite && <Head dy={headDy}>{pose === "bell" && !deskBell && <Startle x0={x0} />}</Head>}
```

Clawd's branch (`!sprite`) renders the same tree as before. The pinned hash from Task 1 proves it.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run static/src/chrome`
Expected: all pass. In particular `Clawd's drawing, pinned` must still pass unchanged; never edit its hash in this task.

- [ ] **Step 5: Commit**

```bash
git add static/src/chrome/Tamagotchi.jsx static/src/chrome/__tests__/tamagotchiRender.test.jsx
git commit -m "tamagotchi: critters make Clawd's duty faces when he would (happy, x, worried, look-down), and the bell's \"!\" sits on their own head"
```

---

### Task 7: Hand check, docs, bundle, gate

**Files:**
- Modify: `docs/superpowers/specs/2026-10-21-tamagotchi-critter-picker-design.md`
- Rebuild: `static/dist/app.js`

- [ ] **Step 1: Render the critter × pose grid and look at it**

Save this as `/tmp/claude-faces-grid.jsx`, outside the repo:

```jsx
import { readFileSync, writeFileSync } from "node:fs";
import { h } from "preact";
import renderToString from "preact-render-to-string";
const REPO = process.env.REPO;
const { TamaScene } = await import(`${REPO}/static/src/chrome/Tamagotchi.jsx`);
const { CRITTERS } = await import(`${REPO}/static/src/chrome/critters.js`);
const duty = (kind) => ({ kind, label: kind, urgent: false, more: 0 });
const COLS = [
  ["Coding", { activity: "code", working: 2 }], ["Done", { activity: "code", duty: duty("done") }],
  ["Merged", { activity: "code", duty: duty("merged"), party: true }], ["API", { activity: "code", duty: duty("api") }],
  ["Context", { activity: "code", duty: duty("ctx") }], ["Update", { activity: "code", duty: duty("update") }],
  ["Bell away", { activity: "beer", duty: duty("bell") }], ["Beer (smile)", { activity: "beer" }],
  ["Furious", { activity: "code", mood: "furious", working: 2 }], ["Asleep", { activity: "sleep" }],
];
const css = readFileSync(`${REPO}/static/styles.css`, "utf8");
const rules = [...css.matchAll(/(@keyframes[^{]+\{(?:[^{}]*\{[^}]*\})*\s*\})|([^{}@]+\{[^}]*\})/g)]
  .map((m) => m[1] || (m[2].includes(".tama") ? m[2].trim() : "")).join("\n");
const cells = (c) => COLS.map(([, p]) => `<td><div class="tama">${renderToString(h(TamaScene, { critter: c, season: "summer", ...p }))}</div></td>`).join("");
writeFileSync("/tmp/claude-faces-grid.html", `<!doctype html><style>
body{font:12px system-ui;margin:16px} td{padding:3px} th{padding:2px 6px}
.tama{display:block!important;box-sizing:border-box;width:136px;height:96px;margin:0;border:1px solid #ddd;border-radius:6px;background:#f4f1ea;overflow:hidden;--line:#8a8f98}
.tama svg{display:block;width:100%;height:100%}
${rules}
${readFileSync(`${REPO}/static/critters.css`, "utf8")}</style>
<table><tr><th></th>${COLS.map(([n]) => `<th>${n}</th>`).join("")}</tr>
${CRITTERS.map((c) => `<tr><th>${c.name}</th>${cells(c)}</tr>`).join("\n")}</table>`);
console.log("wrote /tmp/claude-faces-grid.html");
```

Run: `REPO=$(pwd) npx vite-node /tmp/claude-faces-grid.jsx && open /tmp/claude-faces-grid.html`

Check in the browser:
- **Done, Merged, API, Context and Update:** every critter differs from its Coding cell (`^`, `x`, brows + sweat, eyes looking down).
- **Bell away:** the "!" sits at each critter's head.
- **Beer:** smiles.
- **Furious:** the critter's own furious layer.
- **Asleep:** shut eyes.
- **Nox:** its worried brows are visible.

If a glyph's stroke or offset reads badly, tune the constants in `faceGlyphs` (`STROKE`, the brow offsets, the 0.45 look-down split). Update the matching assertions in `critters.test.js` if a pinned number moves, re-run Task 4's tests, and commit as `critters: tune the face glyphs against the hand-check grid`.

- [ ] **Step 2: Note the faces as done in the critter-picker spec**

In `docs/superpowers/specs/2026-10-21-tamagotchi-critter-picker-design.md`, under `### Critters as expressive as Clawd`, insert this paragraph directly after the heading:

```
**Status:** duty poses are done as THI-415 part 1 (`docs/superpowers/specs/2026-10-22-critter-duty-faces-design.md`): faces generated from each critter's eye boxes, with optional per-critter face layers, and the bell's "!" on the critter's own head. Hands, strides, worn and held props, and hats remain. They're parts 2 and 3, and both build on the `anchors` those sprites now carry.
```

- [ ] **Step 3: Rebuild the bundle**

Run: `npm run build`
Expected: `static/dist/app.js` changes.

- [ ] **Step 4: Run the full gate**

Run: `bin/check && npm test && uv run pytest -q`
Expected: `✓ all checks passed`; every vitest and pytest test passes.

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/specs/2026-10-21-tamagotchi-critter-picker-design.md static/dist/app.js
git commit -m "docs + build: critter duty faces done (THI-415 part 1); static/dist rebuilt"
```

---

## After the plan

Merge and deploy follow CLAUDE.md steps 4–6:
1. Fast-forward `main` to `feature/critter-faces`.
2. Run `bin/periscope restart`.
3. Remove the worktree and branch with `git worktree remove` and `git branch -d`.

The header shows the faces after a reload. No app rebuild is needed: this is all webview JS.
