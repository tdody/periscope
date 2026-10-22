# Tamagotchi Critter Picker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Settings → Tamagotchi choice of which creature (Clawd by default, or Scope, Jelly, Nox, Ember, Volt, Moss) lives in the header corner. It swaps immediately and survives reload.

**Architecture:** A stdlib-only `build_critters.py` converts the six source SVGs into committed sprite trees (`critterSprites.js`) and CSS keyframes (`critters.css`). `critters.js` holds the list, the fallback and the placement math, all pure. `Critter.jsx` draws one sprite: its mood layers, and its shut eyes while asleep. `TamaScene` draws the critter in Clawd's place and keeps every scene prop. The pick is stored as `ui.tama_critter` through `prefs.js`, validated by `/api/prefs/ui`.

**Tech Stack:** Preact + `@preact/signals`, Vite, vitest with `preact-render-to-string` (node env); FastAPI + Pydantic, pytest; Python 3.11 stdlib (`xml.etree`) for the converter.

**Spec:** `docs/superpowers/specs/2026-10-21-tamagotchi-critter-picker-design.md`. Source art: `docs/specs/assets/critters/*.svg`.

**Prototyped:** every code block below was run in a throwaway worktree of `c6e97db` before this plan was written:
- the full vitest suite passed (517) and the new pytest cases passed (33);
- ruff, ruff format, ty and biome were clean (biome's 3 warnings are already on `main`);
- `vite build` succeeded;
- a browser check rendered all six critters in three moods plus asleep, with all 87 CSS animations running.

Expect the counts in "Expected" lines to match.

---

## Before you start

Follow the dev loop in `CLAUDE.md` ("Development workflow").

1. `git push origin main`. `EnterWorktree` branches from `origin/main`, and this plan's spec commits are on local `main`.
2. `EnterWorktree(name: "critter-picker")`. All paths below are relative to the worktree root.
3. `uv sync` (keeps `.venv` in step, see `docs/testing.md`) and `npm install`.
4. Other worktrees (`clawd-bigger`, `header-tweaks`, `clawd-pastimes`, `coding-moods`) touch `Tamagotchi.jsx` / `styles.css`. If any merged to `main` since `c6e97db`, re-read `TamaScene` before Task 6: the edits below are anchored on its current text.

Commit after every task, straight on the branch, with single-line messages. End every commit message with a blank line and:

```
Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
```

(the `git commit` commands below pass it as a second `-m`).

## File map

| File | Status | Responsibility |
|---|---|---|
| `build_critters.py` | create | SVG → sprite trees + CSS keyframes; raises on unsupported SVG |
| `static/src/chrome/critterSprites.js` | generated, committed | `SPRITES = { id: { name, root } }` |
| `static/critters.css` | generated, committed | one class + `@keyframes` per SMIL animation |
| `static/src/chrome/critters.js` | create | `CRITTERS`, `CRITTER_IDS`, `critterById`, `spriteBox`, `placement` (pure) |
| `static/src/chrome/Critter.jsx` | create | draws one sprite: mood layers, shut eyes asleep |
| `static/src/chrome/Tamagotchi.jsx` | modify | `TamaScene` `critter` prop; `ClawdSprite`; `Head`; `Tamagotchi()` reads the pref |
| `static/src/prefs.js` | modify | `getTamaCritter` / `setTamaCritter` |
| `static/src/overlays/TamaPicker.jsx` | create | Settings fieldset: 7 radios with previews, saves on change |
| `static/src/overlays/SettingsModal.jsx` | modify | mounts `<TamaPicker />` |
| `static/index.html` | modify | links `/critters.css` |
| `static/styles.css` | modify | picker tiles; `.critter-preview *` under reduced motion |
| `periscope/routes/prefs.py` | modify | `TAMA_CRITTERS`, `UIPatch.tama_critter`, 400 on unknown |
| `tests/test_build_critters.py` | create | freshness + conventions |
| `tests/routes/test_prefs.py` | modify | round-trip, reject, ids agree with the converter |
| `static/src/chrome/__tests__/critters.test.js` | create | list, fallback, box, placement, getter |
| `static/src/chrome/__tests__/critterRender.test.jsx` | create | mood exclusivity, sleep |
| `static/src/chrome/__tests__/tamagotchiRender.test.jsx` | modify | critters in the scene + hover |
| `static/src/overlays/__tests__/tamaPickerRender.test.jsx` | create | radios, previews, checked state |
| `static/src/__tests__/styles.test.js` | modify | no keyframes clash with `critters.css` |
| `static/dist/app.js` | rebuilt, committed | — |

---

### Task 1: The SVG converter and its generated output

**Files:**
- Create: `tests/test_build_critters.py`
- Create: `build_critters.py`
- Generate: `static/src/chrome/critterSprites.js`, `static/critters.css`

- [ ] **Step 1: Write the failing tests**

`tests/test_build_critters.py`:

```python
"""build_critters.py — the critter SVGs → committed sprite data + CSS."""

from pathlib import Path

import pytest

import build_critters


def test_committed_output_is_fresh():
    # Edit an SVG (or the script) without re-running it and the header shows
    # stale art: the committed files must be exactly what the script writes.
    js, css = build_critters.render()
    assert build_critters.OUT_JS.read_text() == js, "re-run: uv run build_critters.py"
    assert build_critters.OUT_CSS.read_text() == css, "re-run: uv run build_critters.py"


def test_every_sprite_shuts_its_eyes():
    js, _ = build_critters.render()
    for cid in build_critters.CRITTERS:
        line = next(ln for ln in js.splitlines() if ln.startswith(f"  {cid}:"))
        assert '"role":"eye"' in line or '"role":"lid"' in line, cid


def test_drops_the_idle_bob_and_converts_the_rest():
    _, css = build_critters.render()
    assert "data-bob" not in css
    assert "@keyframes crit-jelly-1 " in css
    assert "steps(1, end)" in css  # calcMode="discrete"


def _svg(tmp_path: Path, body: str) -> Path:
    p = tmp_path / "bad.svg"
    bob = '<animateTransform attributeName="transform" type="translate" values="0 0;0 -1" dur="1s" repeatCount="indefinite" data-bob="x"/>'
    p.write_text(f'<svg viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg"><g>{bob}{body}</g></svg>')
    return p


def test_raises_on_an_element_it_does_not_know(tmp_path):
    with pytest.raises(ValueError, match="circle"):
        build_critters.convert("bad", _svg(tmp_path, '<circle r="1"/>'), build_critters.Sheet())


def test_raises_on_an_attribute_it_does_not_know(tmp_path):
    with pytest.raises(ValueError, match="rx"):
        build_critters.convert(
            "bad", _svg(tmp_path, '<rect x="0" y="0" width="1" height="1" rx="1"/>'), build_critters.Sheet()
        )
```

- [ ] **Step 2: Run them to verify they fail**

Run: `uv run pytest tests/test_build_critters.py -q`
Expected: collection error, `ModuleNotFoundError: No module named 'build_critters'`.

- [ ] **Step 3: Write the converter**

`build_critters.py` (repo root, next to `build_icons.py`):

```python
# /// script
# requires-python = ">=3.11"
# ///
"""Turn the critter SVGs into the header tamagotchi's sprite data + CSS.

The source art (docs/specs/assets/critters/*.svg) animates with SMIL, which
`prefers-reduced-motion` can't stop, and carries a C2PA metadata block that
doesn't belong in the bundle. This rewrites each SVG as a tree of rects and
groups (static/src/chrome/critterSprites.js) and each SMIL animation as a CSS
class + @keyframes (static/critters.css), the way the rest of the tamagotchi
moves (styles.css `.tama`). Both outputs are committed; re-run after editing
or adding an SVG:

    uv run build_critters.py

Conventions the SVGs follow, and this script enforces (it raises on anything
else, so a new SVG fails loudly instead of drawing wrong):
  - one outer <g> whose first child is the idle-bob <animateTransform data-bob>,
    which is dropped: the scene already bobs the creature per activity and mood;
  - mood layers carry class="mood-calm|mood-grumpy|mood-furious";
  - animations are <animate> on x / y / height / opacity of a rect, or a
    translate <animateTransform> on a group;
  - a blinking eye is a rect outside any mood layer whose height dips; a lid is
    one whose height starts at 0 and grows over the eye.
"""

from __future__ import annotations

import json
import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).parent
SRC = ROOT / "docs" / "specs" / "assets" / "critters"
OUT_JS = ROOT / "static" / "src" / "chrome" / "critterSprites.js"
OUT_CSS = ROOT / "static" / "critters.css"

# Display order in Settings, after Clawd. A new critter is an SVG plus a line here.
CRITTERS = ["scope", "jelly", "nox", "ember", "volt", "moss"]

PAINT = ("fill", "stroke", "stroke-width", "opacity")
MOODS = {"mood-calm": "calm", "mood-grumpy": "grumpy", "mood-furious": "furious"}


def tag(el: ET.Element) -> str:
    return el.tag.rsplit("}", 1)[-1]


def num(s: str) -> float:
    v = float(s)
    return int(v) if v.is_integer() else v  # "11" not "11.0" in the generated JS


def fmt(v: float) -> str:
    s = f"{v:.4f}".rstrip("0").rstrip(".")
    return "0" if s in ("-0", "") else s


def paint(el: ET.Element) -> dict:
    return {k: el.get(k) for k in PAINT if el.get(k) is not None}


def mood_of(el: ET.Element) -> str | None:
    cls = el.get("class")
    if cls is None:
        return None
    if cls not in MOODS:
        raise ValueError(f"unknown class {cls!r}")
    return MOODS[cls]


def check_attrs(el: ET.Element, allowed: set[str]) -> None:
    extra = set(el.attrib) - allowed - set(PAINT) - {"class"}
    if extra:
        raise ValueError(f"<{tag(el)}> has unsupported attributes {sorted(extra)}")


def rect_geom(el: ET.Element) -> list[float]:
    return [num(el.get(k, "0")) for k in ("x", "y", "width", "height")]


class Anim:
    """One SMIL element, normalised: attr, its values (scalars, or (dx, dy) moves for a translate), times."""

    def __init__(self, el: ET.Element):
        check_attrs(el, {"attributeName", "type", "values", "keyTimes", "dur", "repeatCount", "calcMode", "data-bob"})
        if el.get("repeatCount") != "indefinite":
            raise ValueError("only indefinite animations are supported")
        self.attr = el.get("attributeName") or ""
        raw = (el.get("values") or "").split(";")
        self.frames = len(raw)
        self.values: list[float] = []
        self.moves: list[tuple[float, float]] = []
        if tag(el) == "animateTransform":
            if el.get("type") != "translate" or self.attr != "transform":
                raise ValueError("only translate <animateTransform> is supported")
            self.moves = [(num(dx), num(dy)) for dx, dy in (v.split() for v in raw)]
        elif self.attr in ("x", "y", "height", "opacity"):
            self.values = [num(v) for v in raw]
        else:
            raise ValueError(f"unsupported animated attribute {self.attr!r}")
        self.discrete = el.get("calcMode") == "discrete"
        self.dur = el.get("dur")
        kt = el.get("keyTimes")
        self.key_times = [num(t) for t in kt.split(";")] if kt else None

    def timing(self) -> tuple:
        return (self.dur, self.discrete, tuple(self.key_times or ()), self.frames)

    def times(self) -> list[float]:
        n = self.frames
        if self.key_times:
            return self.key_times
        return [i / n for i in range(n)] if self.discrete else [i / (n - 1) for i in range(n)]


class Sheet:
    def __init__(self):
        self.rules: list[str] = []
        self.counts: dict[str, int] = {}

    def add(self, cid: str, anims: list[Anim], geom: list[float] | None) -> str:
        """One class + @keyframes for every SMIL animation on one element."""
        if len({a.timing() for a in anims}) != 1:
            raise ValueError("animations on one element must share dur / keyTimes / calcMode")
        # Numbered per critter, so editing one SVG never renames another's classes.
        self.counts[cid] = self.counts.get(cid, 0) + 1
        name = f"crit-{cid}-{self.counts[cid]}"
        a0 = anims[0]
        by = {a.attr: a for a in anims}
        frames = []
        for i, t in enumerate(a0.times()):
            props = []
            if "transform" in by:
                dx, dy = by["transform"].moves[i]
                props.append(f"transform: translate({fmt(dx)}px, {fmt(dy)}px)")
            elif {"x", "y", "height"} & by.keys():
                if geom is None:
                    raise ValueError("x / y / height animations belong on a rect")
                x0, y0, _, h0 = geom
                dx = by["x"].values[i] - x0 if "x" in by else 0
                dy = by["y"].values[i] - y0 if "y" in by else 0
                s = by["height"].values[i] / h0 if "height" in by else 1
                props.append(f"transform: translate({fmt(dx)}px, {fmt(dy)}px) scaleY({fmt(s)})")
            if "opacity" in by:
                props.append(f"opacity: {fmt(by['opacity'].values[i])}")
            frames.append((t, "; ".join(props)))
        if a0.discrete and frames[-1][0] < 1:
            frames.append((1.0, frames[-1][1]))  # hold the last value to the loop
        timing = "steps(1, end)" if a0.discrete else "linear"
        body = " ".join(f"{fmt(t * 100)}% {{ {p}; }}" for t, p in frames)
        self.rules.append(
            f".{name} {{ animation: {name} {a0.dur} {timing} infinite; }}\n@keyframes {name} {{ {body} }}"
        )
        return name


def eye_rects(root: ET.Element) -> list[list[float]]:
    """Blinking eyes: rects outside any mood layer whose height dips."""
    out = []

    def walk(el: ET.Element, in_mood: bool) -> None:
        in_mood = in_mood or mood_of(el) is not None
        if tag(el) == "rect" and not in_mood:
            heights = [Anim(a).values for a in el if tag(a) == "animate" and a.get("attributeName") == "height"]
            if heights and heights[0][0] > 0:
                out.append(rect_geom(el))
        for c in el:
            walk(c, in_mood)

    walk(root, False)
    return out


def inside(r: list[float], box: list[float]) -> bool:
    return r[0] >= box[0] and r[1] >= box[1] and r[0] + r[2] <= box[0] + box[2] and r[1] + r[3] <= box[1] + box[3]


def convert(cid: str, svg: Path, sheet: Sheet) -> dict:
    text = re.sub(r"<metadata>.*?</metadata>", "", svg.read_text(), flags=re.S)
    doc = ET.fromstring(text)
    if doc.get("viewBox") != "0 0 20 20":
        raise ValueError(f"{svg.name}: expected viewBox 0 0 20 20")
    outer = [c for c in doc if tag(c) == "g"]
    if len(outer) != 1:
        raise ValueError(f"{svg.name}: expected one outer <g>")
    kids = list(outer[0])
    if not kids or tag(kids[0]) != "animateTransform" or kids[0].get("data-bob") is None:
        raise ValueError(f"{svg.name}: the outer <g> must open with the data-bob idle bob")
    eyes = eye_rects(outer[0])

    def node(el: ET.Element, in_mood: bool) -> dict | None:
        t = tag(el)
        mood = mood_of(el)
        if t == "rect":
            check_attrs(el, {"x", "y", "width", "height"})
            geom = rect_geom(el)
            anims = [Anim(a) for a in el if tag(a) == "animate"]
            if not anims:
                out = {"r": geom}
                if paint(el):
                    out["a"] = paint(el)
                return {"g": [out], "mood": mood} if mood else out
            heights = next((a.values for a in anims if a.attr == "height"), None)
            if heights:
                geom[3] = max(heights)  # drawn at full height, scaled down by the keyframes
            inner = {"r": geom}
            if paint(el):
                inner["a"] = paint(el)
            g = {"g": [inner], "anim": sheet.add(cid, anims, geom)}
            if mood:
                g["mood"] = mood
            if heights and not in_mood and not mood:
                if heights[0] == 0:
                    g["role"], g["shut"] = "lid", geom
                else:
                    i = heights.index(min(heights))
                    ys = next((a.values for a in anims if a.attr == "y"), None)
                    g["role"] = "eye"
                    g["shut"] = [geom[0], ys[i] if ys else geom[1], geom[2], heights[i]]
            return g
        if t == "g":
            check_attrs(el, set())
            anims = [Anim(a) for a in el if tag(a) == "animateTransform"]
            children = [n for c in el if (n := node(c, in_mood or mood is not None))]
            out = {"g": children}
            if paint(el):
                out["a"] = paint(el)
            if mood:
                out["mood"] = mood
                rects = [c["r"] for c in children if "r" in c]
                # Highlights riding on the blinking eyes: hidden while asleep, with the eyes shut.
                whole = bool(rects) and len(rects) == len(children)
                if mood == "calm" and whole and all(any(inside(r, e) for e in eyes) for r in rects):
                    out["role"] = "glint"
            if anims:
                out["anim"] = sheet.add(cid, anims, None)
            return out
        if t in ("animate", "animateTransform"):
            return None  # read by the parent
        raise ValueError(f"{svg.name}: unsupported element <{t}>")

    root = [n for c in kids[1:] if (n := node(c, False))]
    return {"name": doc.get("aria-label") or cid.title(), "root": root}


def render() -> tuple[str, str]:
    """(critterSprites.js, critters.css) as they should be committed."""
    sheet = Sheet()
    sprites = {cid: convert(cid, SRC / f"{cid}.svg", sheet) for cid in CRITTERS}
    header = "Generated by build_critters.py from docs/specs/assets/critters/*.svg — edit the SVGs and re-run."
    js = [f"// {header}", "", "export const SPRITES = {"]
    js += [f"  {cid}: {json.dumps(s, separators=(',', ':'))}," for cid, s in sprites.items()]
    js += ["};", ""]
    css = [
        f"/* {header}",
        "   Loaded after styles.css; its reduced-motion rule stops all of this. */",
        ".critter g { transform-box: fill-box; transform-origin: 0 0; }",
        *sheet.rules,
        "",
    ]
    return "\n".join(js), "\n".join(css)


def main() -> int:
    js, css = render()
    OUT_JS.write_text(js)
    OUT_CSS.write_text(css)
    print(f"wrote {OUT_JS.relative_to(ROOT)} and {OUT_CSS.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 4: Generate the output**

Run: `uv run build_critters.py`
Expected: `wrote static/src/chrome/critterSprites.js and static/critters.css`. `grep -c @keyframes static/critters.css` prints `32`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `uv run pytest tests/test_build_critters.py -q`
Expected: `5 passed`.

- [ ] **Step 6: Lint**

Run: `uv run ruff check build_critters.py tests/test_build_critters.py && uv run ruff format --check build_critters.py tests/test_build_critters.py && uv run ty check build_critters.py tests/test_build_critters.py`
Expected: `All checks passed!` twice and `2 files already formatted`.

- [ ] **Step 7: Commit**

```bash
git add build_critters.py tests/test_build_critters.py static/src/chrome/critterSprites.js static/critters.css
git commit -m "tamagotchi: build_critters.py turns the critter SVGs into sprite trees + CSS keyframes (SMIL can't honour reduced motion)" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: `critters.js` — the list, the fallback, the placement

**Files:**
- Create: `static/src/chrome/__tests__/critters.test.js`
- Create: `static/src/chrome/critters.js`

- [ ] **Step 1: Write the failing tests**

`static/src/chrome/__tests__/critters.test.js`:

```js
import { describe, expect, it } from "vitest";
import { CLAWD_HEIGHT, CRITTER_IDS, CRITTERS, critterById, placement, spriteBox } from "../critters.js";

const sprites = CRITTERS.filter((c) => c.sprite);

// Every group in a sprite tree, depth first.
function groups(nodes, out = []) {
  for (const n of nodes) {
    if (n.g) { out.push(n); groups(n.g, out); }
  }
  return out;
}

describe("CRITTERS", () => {
  it("is Clawd first, then the six, each id once", () => {
    expect(CRITTER_IDS).toEqual(["clawd", "scope", "jelly", "nox", "ember", "volt", "moss"]);
  });

  it("leaves Clawd without a sprite: Tamagotchi.jsx draws it", () => {
    expect(critterById("clawd").sprite).toBeNull();
  });

  it.each(sprites.map((c) => [c.id, c]))("%s has all three moods and eyes that can shut", (_id, c) => {
    const gs = groups(c.sprite.root);
    for (const mood of ["calm", "grumpy", "furious"]) expect(gs.some((g) => g.mood === mood), mood).toBe(true);
    const shutters = gs.filter((g) => g.role === "eye" || g.role === "lid");
    expect(shutters.length).toBeGreaterThan(0);
    for (const g of shutters) expect(g.shut).toHaveLength(4);
  });
});

describe("critterById", () => {
  it("finds a critter by id", () => {
    expect(critterById("jelly").name).toBe("Jelly");
  });

  it("falls back to Clawd for an unset or unknown id", () => {
    expect(critterById(undefined).id).toBe("clawd");
    expect(critterById("dragon").id).toBe("clawd");
  });
});

describe("spriteBox", () => {
  it("measures the always-drawn layers", () => {
    expect(spriteBox(critterById("jelly").sprite)).toEqual({ x: 4, y: 3, w: 12, h: 15 });
  });

  it("ignores mood layers, so a mood never moves the critter", () => {
    const sprite = { root: [{ r: [5, 5, 10, 10] }, { g: [{ r: [0, 0, 1, 1] }], mood: "furious" }] };
    expect(spriteBox(sprite)).toEqual({ x: 5, y: 5, w: 10, h: 10 });
  });
});

describe("placement", () => {
  const bottomOf = (p, box) => p.ty + p.scale * (box.y + box.h);
  const centreOf = (p, box) => p.tx + p.scale * (box.x + box.w / 2);

  it.each(sprites.map((c) => [c.id, c.sprite]))("stands %s as tall as Clawd, on Clawd's spot", (_id, sprite) => {
    const box = spriteBox(sprite);
    const p = placement(sprite, { x0: 8, sitting: false });
    expect(p.scale * box.h).toBeCloseTo(CLAWD_HEIGHT);
    expect(bottomOf(p, box)).toBeCloseTo(19);
    expect(centreOf(p, box)).toBeCloseTo(16.5);
    expect(p.top).toBe(9);
  });

  it("seats a sitting critter on the seat, not through it", () => {
    const sprite = critterById("nox").sprite;
    const box = spriteBox(sprite);
    const p = placement(sprite, { x0: 3, sitting: true });
    expect(bottomOf(p, box)).toBeCloseTo(17);
    expect(centreOf(p, box)).toBeCloseTo(11.5);
    expect(p.top).toBe(7);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run static/src/chrome/__tests__/critters.test.js`
Expected: FAIL, `Failed to resolve import "../critters.js"`.

- [ ] **Step 3: Write `critters.js`**

`static/src/chrome/critters.js`:

```js
// The creatures that can live in the header corner instead of Clawd
// (Settings → Tamagotchi): the pure part, so the list, the fallback and the
// placement unit-test without a DOM. The sprites themselves are generated
// (critterSprites.js, by build_critters.py); Clawd has none — Tamagotchi.jsx
// draws it.

import { SPRITES } from "./critterSprites.js";

export const CRITTERS = [
  { id: "clawd", name: "Clawd", sprite: null },
  ...Object.entries(SPRITES).map(([id, sprite]) => ({ id, name: sprite.name, sprite })),
];
export const CRITTER_IDS = CRITTERS.map((c) => c.id);

// An id nobody knows (unset, or a critter since removed) is Clawd.
export function critterById(id) {
  return CRITTERS.find((c) => c.id === id) || CRITTERS[0];
}

// Clawd standing, in scene units: body 4 rows × 2 + legs 2.
export const CLAWD_HEIGHT = 10;
const FEET = 19;  // the scene's floor line, where standing Clawd's legs end
const SEAT = 17;  // where seated Clawd's body ends, on the chair / armchair seat

// The visible box of the always-drawn layers, in sprite units. Mood layers
// are left out: Jelly's furious sparks sit outside its body, and counting them
// would move the critter sideways whenever its mood changed.
export function spriteBox(sprite) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const walk = (n) => {
    if (n.mood) return;
    if (n.r) {
      const [x, y, w, h] = n.r;
      x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x + w); y1 = Math.max(y1, y + h);
      return;
    }
    n.g.forEach(walk);
  };
  sprite.root.forEach(walk);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

// Where a critter stands in Clawd's spot: as tall as standing Clawd, centred
// on Clawd's centre, on the floor line standing and on the seat sitting (on
// the floor line it would sink through the chair). `top` is its head, for the
// props that sit on one (hats, stars, the "!").
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

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run static/src/chrome/__tests__/critters.test.js`
Expected: `19 passed`.

- [ ] **Step 5: Commit**

```bash
git add static/src/chrome/critters.js static/src/chrome/__tests__/critters.test.js
git commit -m "tamagotchi: critters.js — the critter list, Clawd fallback, and placement on Clawd's spot (seated on the seat)" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: `Critter.jsx` — one sprite, its mood, its sleep

**Files:**
- Create: `static/src/chrome/__tests__/critterRender.test.jsx`
- Create: `static/src/chrome/Critter.jsx`

- [ ] **Step 1: Write the failing tests**

`static/src/chrome/__tests__/critterRender.test.jsx`:

```jsx
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
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run static/src/chrome/__tests__/critterRender.test.jsx`
Expected: FAIL, `Failed to resolve import "../Critter.jsx"`.

- [ ] **Step 3: Write `Critter.jsx`**

`static/src/chrome/Critter.jsx`:

```jsx
// One critter (critters.js), drawn from its generated sprite tree in its own
// 20×20 units. Motion is the classes in static/critters.css; the caller places
// and scales it (Tamagotchi.jsx in the header, TamaPicker.jsx in Settings).

// A mood layer shows only in its mood. Asleep, an eye or a lid is drawn as its
// `shut` frame, held, and the glint riding on a blinking eye goes away.
function Node({ n, mood, asleep }) {
  if (n.mood && n.mood !== mood) return null;
  if (asleep && n.role === "glint") return null;
  if (n.r) {
    const [x, y, w, h] = n.r;
    return <rect x={x} y={y} width={w} height={h} {...n.a} />;
  }
  if (asleep && n.shut) {
    const [x, y, w, h] = n.shut;
    return <rect data-role="shut" x={x} y={y} width={w} height={h} {...n.g[0].a} />;
  }
  return (
    <g class={n.anim} data-mood={n.mood} data-role={n.role} {...n.a}>
      {n.g.map((c, i) => <Node key={i} n={c} mood={mood} asleep={asleep} />)}
    </g>
  );
}

export function Critter({ sprite, mood = "calm", asleep = false }) {
  return (
    <g class="critter">
      {sprite.root.map((n, i) => <Node key={i} n={n} mood={mood} asleep={asleep} />)}
    </g>
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run static/src/chrome/__tests__/critterRender.test.jsx`
Expected: `15 passed`.

- [ ] **Step 5: Commit**

```bash
git add static/src/chrome/Critter.jsx static/src/chrome/__tests__/critterRender.test.jsx
git commit -m "tamagotchi: Critter.jsx draws a sprite in one mood, eyes held shut asleep" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: The pref — `getTamaCritter` / `setTamaCritter`

**Files:**
- Modify: `static/src/chrome/__tests__/critters.test.js`
- Modify: `static/src/prefs.js` (imports at the top; new functions just above `getPinnedPids`)

- [ ] **Step 1: Write the failing tests**

In `static/src/chrome/__tests__/critters.test.js`, replace the first line:

```js
import { describe, expect, it } from "vitest";
```

with:

```js
import { afterEach, describe, expect, it } from "vitest";
import { getTamaCritter, prefsSignal } from "../../prefs.js";
```

and append at the end of the file:

```js

describe("getTamaCritter", () => {
  const withUI = (ui) => { prefsSignal.value = { ...prefsSignal.value, loaded: true, ui }; };
  afterEach(() => withUI({}));

  it("is Clawd until one is picked", () => {
    withUI({});
    expect(getTamaCritter()).toBe("clawd");
  });

  it("returns the picked critter", () => {
    withUI({ tama_critter: "moss" });
    expect(getTamaCritter()).toBe("moss");
  });

  it("falls back to Clawd for an id it doesn't know", () => {
    withUI({ tama_critter: "dragon" });
    expect(getTamaCritter()).toBe("clawd");
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run static/src/chrome/__tests__/critters.test.js`
Expected: FAIL, `getTamaCritter is not a function` (or a missing-export error).

- [ ] **Step 3: Add the pref**

In `static/src/prefs.js`, replace:

```js
import { signal } from "@preact/signals";
import { apiCall } from "./util.js";
```

with:

```js
import { signal } from "@preact/signals";
import { CRITTER_IDS } from "./chrome/critters.js";
import { apiCall } from "./util.js";
```

and insert immediately above `export function getPinnedPids() {`:

```js
// The header tamagotchi's creature (chrome/critters.js), picked in Settings.
// Unset, or an id no longer in the list, is Clawd — the default nobody has to
// opt out of.
export function getTamaCritter() {
  const id = P().ui?.tama_critter;
  return CRITTER_IDS.includes(id) ? id : "clawd";
}

export function setTamaCritter(id) {
  return patchUI({ tama_critter: id });
}


```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run static/src/chrome/__tests__/critters.test.js`
Expected: `22 passed`.

- [ ] **Step 5: Commit**

```bash
git add static/src/prefs.js static/src/chrome/__tests__/critters.test.js
git commit -m "prefs: getTamaCritter / setTamaCritter (ui.tama_critter), Clawd for unset or unknown" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: The server accepts `tama_critter`

**Files:**
- Modify: `tests/routes/test_prefs.py`
- Modify: `periscope/routes/prefs.py`

- [ ] **Step 1: Write the failing tests**

In `tests/routes/test_prefs.py`, replace the module docstring line:

```python
"""Tests for /api/prefs/*."""
```

with:

```python
"""Tests for /api/prefs/*."""

import pytest

import build_critters
from periscope.routes.prefs import TAMA_CRITTERS
```

and insert immediately above `def test_put_window_annotation(client, clean_state):`:

```python
@pytest.mark.parametrize("critter", TAMA_CRITTERS)
def test_patch_prefs_ui_tama_critter_round_trips(client, clean_state, critter):
    r = client.patch("/api/prefs/ui", json={"tama_critter": critter})
    assert r.status_code == 200
    assert r.json()["ui"]["tama_critter"] == critter


def test_patch_prefs_ui_rejects_unknown_tama_critter(client, clean_state):
    r = client.patch("/api/prefs/ui", json={"tama_critter": "dragon"})
    assert r.status_code == 400
    assert "tama_critter" in r.json()["detail"]


def test_tama_critters_match_the_generated_sprites():
    # The client builds its list from build_critters.py's; a critter added
    # there but not here would 400 on pick.
    assert ("clawd", *build_critters.CRITTERS) == TAMA_CRITTERS


```

- [ ] **Step 2: Run them to verify they fail**

Run: `uv run pytest tests/routes/test_prefs.py -q`
Expected: collection error, `ImportError: cannot import name 'TAMA_CRITTERS'`.

- [ ] **Step 3: Declare and validate the field**

In `periscope/routes/prefs.py`, replace:

```python
router = APIRouter()
```

with:

```python
router = APIRouter()

# The header tamagotchi's creatures: Clawd plus build_critters.py's CRITTERS,
# the list static/src/chrome/critters.js is built from. A test keeps the two
# in step (tests/routes/test_prefs.py).
TAMA_CRITTERS = ("clawd", "scope", "jelly", "nox", "ember", "volt", "moss")
```

In `UIPatch`, replace:

```python
    side_hidden: bool | None = None
```

with:

```python
    side_hidden: bool | None = None
    # Settings → Tamagotchi: one of TAMA_CRITTERS. Declared, or Pydantic drops
    # it and the client's optimistic pick reverts on the echo.
    tama_critter: str | None = None
```

In `patch_prefs_ui`, replace:

```python
    if "detail_mode_by_pid" in patch:
```

with:

```python
    if "tama_critter" in patch and patch["tama_critter"] not in TAMA_CRITTERS:
        raise HTTPException(400, f"invalid tama_critter: {patch['tama_critter']!r}")
    if "detail_mode_by_pid" in patch:
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `uv run pytest tests/routes/test_prefs.py tests/test_build_critters.py -q`
Expected: `33 passed`.

- [ ] **Step 5: Lint**

Run: `uv run ruff check periscope/routes/prefs.py tests/routes/test_prefs.py && uv run ruff format --check periscope/routes/prefs.py tests/routes/test_prefs.py`
Expected: `All checks passed!` and `2 files already formatted`.

- [ ] **Step 6: Commit**

```bash
git add periscope/routes/prefs.py tests/routes/test_prefs.py
git commit -m "prefs: /api/prefs/ui takes tama_critter, 400 on an unknown critter; ids pinned to build_critters.py's" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: The critter takes Clawd's place in `TamaScene`

**Files:**
- Modify: `static/src/chrome/__tests__/tamagotchiRender.test.jsx`
- Modify: `static/src/chrome/Tamagotchi.jsx`

- [ ] **Step 1: Write the failing tests**

In `static/src/chrome/__tests__/tamagotchiRender.test.jsx`, replace:

```jsx
import { accounts, usage } from "../../store.js";
import { Tamagotchi, TamaScene } from "../Tamagotchi.jsx";
```

with:

```jsx
import { prefsSignal } from "../../prefs.js";
import { accounts, usage } from "../../store.js";
import { CRITTERS, critterById } from "../critters.js";
import { Tamagotchi, TamaScene } from "../Tamagotchi.jsx";
```

and append at the end of the file:

```jsx

describe("critters", () => {
  const critters = CRITTERS.filter((c) => c.sprite);
  const scenes = [...ids, "nap"];
  const scene = (critter, activity, extra = {}) =>
    render(<TamaScene activity={activity === "nap" ? "code" : activity} walled={activity === "nap" ? { day: null, time: "3pm" } : null}
                      critter={critter} {...extra} />);

  it.each(critters.map((c) => [c.id, c]))("%s takes Clawd's place in every scene", (_id, c) => {
    for (const id of scenes) {
      const html = scene(c, id);
      expect(html, id).toContain(`data-critter="${c.id}"`);
      expect(html, id).toContain('class="critter"');
      expect(html, id).not.toContain("tama-body");
      expect(html, id).not.toContain("tama-legs-a");
    }
  });

  it("keeps drawing Clawd by default", () => {
    const html = render(<TamaScene activity="code" />);
    expect(html).toContain("tama-body");
    expect(html).not.toContain("data-critter");
  });

  it("keeps the scene's props", () => {
    const jelly = critterById("jelly");
    expect(scene(jelly, "code")).toContain("tama-desk");
    expect(scene(jelly, "read")).toContain("tama-fire");
    expect(scene(jelly, "run", { season: "winter" })).toContain("tama-scenery");
    expect(scene(jelly, "eat", { duty: { kind: "ci", label: "1", more: 0 } })).toContain("tama-bubble");
  });

  it("shows the coding mood in the critter's own layers, not Clawd's face", () => {
    const html = scene(critterById("ember"), "code", { mood: "furious" });
    expect(html).toContain('data-mood="furious"');
    expect(html).toContain("tama-smoke");
    expect(html).not.toContain("tama-brows");
    expect(html).not.toContain("tama-hand");
  });

  it("stays calm in the critter while on duty, as Clawd does", () => {
    const html = scene(critterById("ember"), "code", { mood: "furious", duty: { kind: "ci", label: "1", more: 0 } });
    expect(html).toContain('data-mood="calm"');
    expect(html).not.toContain('data-mood="furious"');
  });

  it("shuts the critter's eyes asleep, not while the bell rings", () => {
    const volt = critterById("volt");
    expect(scene(volt, "sleep")).toContain('data-role="shut"');
    expect(scene(volt, "nap")).toContain('data-role="shut"');
    expect(scene(volt, "code")).not.toContain('data-role="shut"');
    expect(scene(volt, "sleep", { duty: { kind: "bell", label: "1", more: 0 } })).not.toContain('data-role="shut"');
  });

  it("drops the overlays drawn for Clawd's body", () => {
    const moss = critterById("moss");
    const done = scene(moss, "code", { duty: { kind: "done", label: "1", more: 0 } });
    expect(done).toContain("tama-sparkle");
    expect(done).not.toContain("tama-cheer");
    expect(scene(moss, "code", { duty: { kind: "bell", label: "1", more: 0 } })).not.toContain("tama-slap");
  });

  it("lifts the hats onto a seated critter's head, and leaves a standing one's alone", () => {
    const nox = critterById("nox");
    expect(scene(nox, "read", { occasion: "yearend" })).toMatch(/<g transform="translate\(0 -2\)"><g class="tama-hat-santa"/);
    expect(scene(nox, "eat", { occasion: "yearend" })).not.toContain('translate(0 -2)');
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run static/src/chrome/__tests__/tamagotchiRender.test.jsx`
Expected: the new `critters` cases FAIL (no `data-critter`, `tama-body` still drawn); the existing 39 cases pass.

- [ ] **Step 3: Import the critter modules**

In `static/src/chrome/Tamagotchi.jsx`, replace:

```jsx
import { clickHandlers } from "./clawdClick.js";
```

with:

```jsx
import { clickHandlers } from "./clawdClick.js";
import { Critter } from "./Critter.jsx";
import { CRITTERS, placement } from "./critters.js";
```

- [ ] **Step 4: Add `ClawdSprite` and `Head` above `Eyes`**

Replace:

```jsx
function Eyes({ closed, x0 }) {
```

with:

```jsx
// Clawd on its own, standing, for the Settings picker (overlays/TamaPicker.jsx).
export function ClawdSprite() {
  return (
    <g>
      <Cells cells={BODY_CELLS} cls="tama-body" x0={0} />
      <Eyes x0={0} />
      <Cells cells={LEG_CELLS[0]} cls="tama-legs-a" x0={0} y0={LEGS_Y0} />
    </g>
  );
}

// Props drawn on Clawd's head (top at Y0) move with a critter's head instead:
// a seated critter's head is higher than seated Clawd's. A wrapper, not a
// transform on the prop, which may animate its own.
function Head({ dy, children }) {
  return dy ? <g transform={`translate(0 ${dy})`}>{children}</g> : children;
}

function Eyes({ closed, x0 }) {
```

- [ ] **Step 5: Give `TamaScene` the `critter` prop and its placement**

Replace:

```jsx
  duty = null, working, walled = null, party = false,
}) {
```

with:

```jsx
  duty = null, working, walled = null, party = false, critter = CRITTERS[0],
}) {
```

Replace:

```jsx
  const { x0, sitting } = POSES[scene] || STANDING;
```

with:

```jsx
  const { x0, sitting } = POSES[scene] || STANDING;
  // Any creature but Clawd is a sprite (critters.js) standing in Clawd's spot,
  // showing its own moods and shutting its own eyes; the overlays drawn for
  // Clawd's body (its face kinds, brows, hands) stay Clawd's.
  const sprite = critter.sprite;
  const place = sprite && placement(sprite, { x0, sitting });
  const headDy = place ? place.top - Y0 : 0;
```

Replace:

```jsx
  const face = ghost ? <GhostSheet x0={x0} />
    : moody ?
```

with:

```jsx
  const face = ghost ? <GhostSheet x0={x0} />
    : sprite ? null
    : moody ?
```

Replace:

```jsx
         data-working={mirroring ? Math.min(working, 4) : undefined}>
```

with:

```jsx
         data-working={mirroring ? Math.min(working, 4) : undefined} data-critter={sprite ? critter.id : undefined}>
```

- [ ] **Step 6: Draw the critter inside the creature group**

Replace this block (inside `<g key={petKey} class={`tama-creature…`}>`):

```jsx
        <Cells cells={BODY_CELLS} cls="tama-body" x0={x0} />
        {face}
        {pose === "api" && <Stars x0={x0} />}
        {pose === "ctx" && <Worried x0={x0} />}
        {atDesk && celebrating && <ArmsUp x0={x0} />}
        {atDesk && pose === "ci" && <Extinguisher />}
        {deskBell && <SlapHand />}
        {pose === "bell" && !deskBell && <Startle x0={x0} />}
        {!sitting && <Cells cells={LEG_CELLS[0]} cls="tama-legs-a" x0={x0} y0={LEGS_Y0} />}
        {activity === "run" && <Cells cells={LEG_CELLS[1]} cls="tama-legs-b" x0={x0} y0={LEGS_Y0} />}
        {ghost && <Pail x0={x0} />}
        {activity === "run" && season === "winter" && !hat && !ghost && (
          <rect class="tama-snowcap" x={x0 + 3} y="8.4" width="12" height="0.7" rx="0.3" fill="#f4f8fb" />
        )}
        {hat === "santa" && <SantaHat x0={x0} />}
        {hat === "party" && <PartyHat x0={x0} />}
```

with:

```jsx
        {sprite ? (
          // Placement is an attribute on a wrapper no animation targets: a CSS
          // transform (the creature's bob, shake, hop) would override it.
          <g class="tama-critter" transform={`translate(${place.tx} ${place.ty}) scale(${place.scale})`}>
            <Critter sprite={sprite} mood={moody ? mood : "calm"} asleep={asleep} />
          </g>
        ) : <Cells cells={BODY_CELLS} cls="tama-body" x0={x0} />}
        {face}
        <Head dy={headDy}>{pose === "api" && <Stars x0={x0} />}</Head>
        {!sprite && pose === "ctx" && <Worried x0={x0} />}
        {!sprite && atDesk && celebrating && <ArmsUp x0={x0} />}
        {atDesk && pose === "ci" && <Extinguisher />}
        {!sprite && deskBell && <SlapHand />}
        <Head dy={headDy}>{pose === "bell" && !deskBell && <Startle x0={x0} />}</Head>
        {!sprite && !sitting && <Cells cells={LEG_CELLS[0]} cls="tama-legs-a" x0={x0} y0={LEGS_Y0} />}
        {!sprite && activity === "run" && <Cells cells={LEG_CELLS[1]} cls="tama-legs-b" x0={x0} y0={LEGS_Y0} />}
        {ghost && <Pail x0={x0} />}
        <Head dy={headDy}>
          {activity === "run" && season === "winter" && !hat && !ghost && (
            <rect class="tama-snowcap" x={x0 + 3} y="8.4" width="12" height="0.7" rx="0.3" fill="#f4f8fb" />
          )}
          {hat === "santa" && <SantaHat x0={x0} />}
          {hat === "party" && <PartyHat x0={x0} />}
        </Head>
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run static/src/chrome`
Expected: all chrome test files pass. `tamagotchiRender.test.jsx` reports 52 (39 existing + 13 new).

- [ ] **Step 8: Commit**

```bash
git add static/src/chrome/Tamagotchi.jsx static/src/chrome/__tests__/tamagotchiRender.test.jsx
git commit -m "tamagotchi: TamaScene draws a picked critter in Clawd's spot — scene props kept, Clawd-only overlays dropped, hats on a seated critter's head" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: The header reads the pref and names the critter

**Files:**
- Modify: `static/src/chrome/__tests__/tamagotchiRender.test.jsx`
- Modify: `static/src/chrome/Tamagotchi.jsx`

- [ ] **Step 1: Write the failing tests**

Append to `static/src/chrome/__tests__/tamagotchiRender.test.jsx`:

```jsx

describe("<Tamagotchi> with a critter", () => {
  afterEach(() => {
    vi.useRealTimers();
    prefsSignal.value = { ...prefsSignal.value, ui: {} };
  });

  it("draws the picked critter and names it in the hover", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 21, 14, 30));
    prefsSignal.value = { ...prefsSignal.value, loaded: true, ui: { tama_critter: "nox" } };
    const html = render(<Tamagotchi />);
    expect(html).toContain('data-critter="nox"');
    expect(html).toContain('title="Nox is coding (1pm–5pm)');
  });

  it("stays Clawd, called Claude, with nothing picked", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 21, 14, 30));
    const html = render(<Tamagotchi />);
    expect(html).not.toContain("data-critter");
    expect(html).toContain('title="Claude is coding (1pm–5pm)');
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run static/src/chrome/__tests__/tamagotchiRender.test.jsx`
Expected: "draws the picked critter and names it in the hover" FAILS (no `data-critter`, title says `Claude`); the rest pass.

- [ ] **Step 3: Read the pref in `Tamagotchi()`**

In `static/src/chrome/Tamagotchi.jsx`, replace:

```jsx
import { selectedPid } from "../keys.js";
```

with:

```jsx
import { selectedPid } from "../keys.js";
import { getTamaCritter } from "../prefs.js";
```

Replace:

```jsx
import { CRITTERS, placement } from "./critters.js";
```

with:

```jsx
import { CRITTERS, critterById, placement } from "./critters.js";
```

Replace:

```jsx
  const [now, setNow] = useState(() => new Date());
  const [pets, setPets] = useState(0);
```

with:

```jsx
  const [now, setNow] = useState(() => new Date());
  const [pets, setPets] = useState(0);
  const critter = critterById(getTamaCritter());
```

Replace:

```jsx
  const label = `Claude is ${doing}
```

with:

```jsx
  // Clawd keeps its banner name; any other critter goes by its own.
  const label = `${critter.sprite ? critter.name : "Claude"} is ${doing}
```

(the rest of that template literal is unchanged).

Replace:

```jsx
                 working={d.working} walled={d.wall} party={d.items.some((i) => i.kind === "merged")} />
```

with:

```jsx
                 working={d.working} walled={d.wall} party={d.items.some((i) => i.kind === "merged")}
                 critter={critter} />
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run static/src/chrome`
Expected: all pass. `tamagotchiRender.test.jsx` reports 54.

- [ ] **Step 5: Commit**

```bash
git add static/src/chrome/Tamagotchi.jsx static/src/chrome/__tests__/tamagotchiRender.test.jsx
git commit -m "tamagotchi: the header draws the picked critter and the hover goes by its name" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Load `critters.css`; keep its keyframes apart; stop previews under reduced motion

**Files:**
- Modify: `static/src/__tests__/styles.test.js`
- Modify: `static/index.html`
- Modify: `static/styles.css` (the `@media (prefers-reduced-motion: reduce)` block, ~line 1416)

- [ ] **Step 1: Write the failing test**

In `static/src/__tests__/styles.test.js`, insert above `  it("doesn't count a commented-out block", () => {`:

```js
  it("shares no keyframes name with the generated critters.css", () => {
    // Both sheets load on one page, so a clash would restyle across them.
    const read = (f) => keyframeNames(readFileSync(new URL(`../../${f}`, import.meta.url), "utf8"));
    const critters = read("critters.css");
    expect(critters.length).toBeGreaterThan(0);
    expect(critters.filter((n) => read("styles.css").includes(n))).toEqual([]);
    expect(critters.filter((n, i) => critters.indexOf(n) !== i)).toEqual([]);
  });

```

- [ ] **Step 2: Run it**

Run: `npx vitest run static/src/__tests__/styles.test.js`
Expected: PASS (`critters.css` exists from Task 1). This is a guard against a future clash, not a red-green step.

- [ ] **Step 3: Link the stylesheet**

In `static/index.html`, replace:

```html
  <link rel="stylesheet" href="/styles.css">
```

with:

```html
  <link rel="stylesheet" href="/styles.css">
  <link rel="stylesheet" href="/critters.css">
```

- [ ] **Step 4: Stop the Settings previews under reduced motion**

In `static/styles.css`, replace:

```css
  .tama * { animation: none !important; }
```

with:

```css
  .tama *, .critter-preview * { animation: none !important; }
```

- [ ] **Step 5: Commit**

```bash
git add static/index.html static/styles.css static/src/__tests__/styles.test.js
git commit -m "tamagotchi: load critters.css; its keyframes can't clash with styles.css; Settings previews stop under reduced motion" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: Settings → Tamagotchi picker

**Files:**
- Create: `static/src/overlays/__tests__/tamaPickerRender.test.jsx`
- Create: `static/src/overlays/TamaPicker.jsx`
- Modify: `static/src/overlays/SettingsModal.jsx`
- Modify: `static/styles.css` (above `.settings-overrides-empty {`)

- [ ] **Step 1: Write the failing tests**

`static/src/overlays/__tests__/tamaPickerRender.test.jsx`:

```jsx
// The Settings picker must show the saved critter as the checked radio, or a
// reopened modal lies about what's in the header.

import render from "preact-render-to-string";
import { afterEach, describe, expect, it } from "vitest";
import { prefsSignal } from "../../prefs.js";
import { TamaPicker } from "../TamaPicker.jsx";

const withUI = (ui) => { prefsSignal.value = { ...prefsSignal.value, loaded: true, ui }; };
const checked = (html) => [...html.matchAll(/<input[^>]*value="(\w+)"[^>]*checked/g)].map((m) => m[1]);

describe("<TamaPicker>", () => {
  afterEach(() => withUI({}));

  it("offers Clawd and the six as real radios, each with a preview and its name", () => {
    const html = render(<TamaPicker />);
    expect(html.match(/<input type="radio" name="tama-critter"/g)).toHaveLength(7);
    expect(html.match(/class="critter-preview"/g)).toHaveLength(7);
    for (const name of ["Clawd", "Scope", "Jelly", "Nox", "Ember", "Volt", "Moss"]) expect(html).toContain(`<span>${name}</span>`);
  });

  it("checks Clawd when nothing is picked", () => {
    withUI({});
    expect(checked(render(<TamaPicker />))).toEqual(["clawd"]);
  });

  it("checks the saved critter", () => {
    withUI({ tama_critter: "volt" });
    expect(checked(render(<TamaPicker />))).toEqual(["volt"]);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run static/src/overlays/__tests__/tamaPickerRender.test.jsx`
Expected: FAIL, `Failed to resolve import "../TamaPicker.jsx"`.

- [ ] **Step 3: Write the picker**

`static/src/overlays/TamaPicker.jsx`:

```jsx
// Settings → Tamagotchi: which creature lives in the header corner
// (chrome/critters.js). Saves on change, like a toggle — the modal's Save and
// Cancel are for its other fields, and Cancel doesn't undo a pick.
import { Critter } from "../chrome/Critter.jsx";
import { CRITTERS } from "../chrome/critters.js";
import { ClawdSprite } from "../chrome/Tamagotchi.jsx";
import { getTamaCritter, setTamaCritter } from "../prefs.js";

// 40px, calm and awake. Clawd's sprite sits in scene units (17 wide, rows
// 9–19), so its box is shifted to frame it like the 20×20 critters.
function Preview({ critter }) {
  return (
    <svg class="critter-preview" viewBox={critter.sprite ? "0 0 20 20" : "-1.5 1 20 20"} width="40" height="40"
         shape-rendering="crispEdges" aria-hidden="true">
      {critter.sprite ? <Critter sprite={critter.sprite} /> : <ClawdSprite />}
    </svg>
  );
}

export function TamaPicker() {
  const current = getTamaCritter();
  return (
    <fieldset class="tama-picker">
      <legend>Tamagotchi</legend>
      <div class="tama-picker-options" role="radiogroup" aria-label="Tamagotchi">
        {CRITTERS.map((c) => (
          <label key={c.id} class="tama-picker-option">
            <input type="radio" name="tama-critter" value={c.id} checked={c.id === current}
                   onChange={() => setTamaCritter(c.id)} />
            <Preview critter={c} />
            <span>{c.name}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run static/src/overlays/__tests__/tamaPickerRender.test.jsx`
Expected: `3 passed`.

- [ ] **Step 5: Mount it in the Settings modal**

In `static/src/overlays/SettingsModal.jsx`, replace:

```jsx
import { modalRequest } from "./modalRequest.js";
```

with:

```jsx
import { modalRequest } from "./modalRequest.js";
import { TamaPicker } from "./TamaPicker.jsx";
```

and replace:

```jsx
        <form id="settings-form" onSubmit={handleSubmit}>
```

with:

```jsx
        <form id="settings-form" onSubmit={handleSubmit}>
          <TamaPicker />
```

- [ ] **Step 6: Style the tiles**

In `static/styles.css`, insert immediately above `.settings-overrides-empty {`:

```css
/* Settings → Tamagotchi (overlays/TamaPicker.jsx): a row of tiles, each a
   real radio — kept focusable but invisible over its tile — a 40px preview
   and the name. ID-qualified to outrank #settings-form label / input, which
   would make every radio a full-width block. */
.tama-picker-options { display: flex; flex-wrap: wrap; gap: 6px; }
#settings-form .tama-picker-option {
  position: relative; display: flex; flex-direction: column; align-items: center; gap: 2px;
  margin: 0; padding: 4px 6px; border: 1px solid var(--line); border-radius: 6px;
  font-size: 0.8em; cursor: pointer;
}
#settings-form .tama-picker-option input {
  position: absolute; inset: 0; width: 100%; height: 100%; margin: 0; padding: 0; opacity: 0; cursor: pointer;
}
#settings-form .tama-picker-option:has(input:checked) { border-color: var(--accent); background: var(--bg-1); }
#settings-form .tama-picker-option:has(input:focus-visible) { outline: 2px solid var(--accent); outline-offset: 1px; }
.critter-preview { display: block; }
```

- [ ] **Step 7: Commit**

```bash
git add static/src/overlays/TamaPicker.jsx static/src/overlays/__tests__/tamaPickerRender.test.jsx static/src/overlays/SettingsModal.jsx static/styles.css
git commit -m "settings: Tamagotchi picker — seven radio tiles with previews, saves on change" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: Build, gate, and check it in the browser

**Files:**
- Rebuild: `static/dist/app.js`

- [ ] **Step 1: Run every test suite**

Run: `npm test && uv run pytest -q`
Expected:
- vitest: 517 tests at prototype time (`c6e97db` + this plan), all passing;
- pytest: all passing, including the 14 new cases (5 in `test_build_critters.py`; 9 in `test_prefs.py`: 7 parametrised round-trips, the reject, the id agreement).

If `test_channel_shim.py` fails spuriously, run `uv sync` and re-run (`docs/testing.md`).

- [ ] **Step 2: Run the lint/type gate**

Run: `bin/check`
Expected: zero violations (biome may still print its 3 warnings already on `main` in `Rail.jsx` / `spawnAccountPickerRender.test.jsx`).

- [ ] **Step 3: Build and commit the bundle**

```bash
npm run build
git add static/dist/
git commit -m "build: static/dist for the critter picker" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 4: Check it in the dev server**

Run: `PERISCOPE_PORT=17375 PERISCOPE_DEV=1 uv run server.py` and open http://127.0.0.1:17375/. Check each of these, and note any failure before moving on:
1. A default install shows Clawd in the header.
2. Open Settings (🛠). The Tamagotchi row shows seven tiles with moving previews. Tab moves focus into the group, and arrow keys move the selection.
3. Pick **Nox**. The header swaps immediately, with no Save needed. Reload: Nox is still there.
4. Hover the header: the label starts "Nox is …".
5. Pick each critter in turn. Each stands on the floor line in standing scenes and on the seat while coding or reading, with no sinking through the chair. (To see other scenes, temporarily change the system clock, or use the vitest render tests as the oracle for scenes you can't reach.)
6. System Settings → Accessibility → Display → Reduce motion: the header critter and the Settings previews stop moving.
7. Pick **Clawd** again: the original mascot returns, unchanged.

- [ ] **Step 5: Merge and ship (CLAUDE.md dev loop, steps 4–6)**

`ExitWorktree(action: "keep")`, then on `main`: `git merge <branch>`, `bin/periscope restart`. After that, `git worktree remove .claude/worktrees/critter-picker` and `git branch -d <branch>`; don't `--force` past either refusal.
