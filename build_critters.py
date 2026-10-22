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
