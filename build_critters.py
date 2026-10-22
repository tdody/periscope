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
  - a critter whose eyes are lids declares its face colour with data-ink="#rrggbb"
    on the <svg> (the colour under a lid isn't in the drawing).
  - a critter's own art for a duty face is a <g class="face-happy|face-x|face-worried|face-down">
    directly under the outer <g>; it's drawn instead of the generated face, never as the critter.
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

# Display order in Settings, after Clawd. A new critter is an SVG plus a line here and in
# periscope/routes/prefs.py's TAMA_CRITTERS (tests/routes/test_prefs.py keeps the two in step).
CRITTERS = ["scope", "jelly", "nox", "ember", "volt", "moss", "octocat"]

PAINT = ("fill", "stroke", "stroke-width", "opacity")
MOODS = {"mood-calm": "calm", "mood-grumpy": "grumpy", "mood-furious": "furious"}
FACES = {"face-happy": "happy", "face-x": "x", "face-worried": "worried", "face-down": "down"}


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
    if cls is None or cls in FACES:  # face layers are kept out of the tree by _convert, not drawn by mood
        return None
    if cls not in MOODS:
        raise ValueError(f"unknown class {cls!r} (expected one of {sorted({*MOODS, *FACES})!r})")
    return MOODS[cls]


def check_attrs(el: ET.Element, allowed: set[str]) -> None:
    extra = set(el.attrib) - allowed - set(PAINT) - {"class"}
    if extra:
        raise ValueError(f"<{tag(el)}> has unsupported attributes {sorted(extra)}")


def rect_geom(el: ET.Element) -> list[float]:
    return [num(el.get(k, "0")) for k in ("x", "y", "width", "height")]


DUR_RE = re.compile(r"^\d+(\.\d+)?m?s$")


class Anim:
    """One SMIL element, normalised: attr, its values (scalars, or (dx, dy) moves for a translate), times."""

    def __init__(self, el: ET.Element):
        check_attrs(el, {"attributeName", "type", "values", "keyTimes", "dur", "repeatCount", "calcMode", "data-bob"})
        if el.get("repeatCount") != "indefinite":
            raise ValueError("only indefinite animations are supported")
        calc_mode = el.get("calcMode")
        if calc_mode not in (None, "linear", "discrete"):
            raise ValueError(f"unsupported calcMode {calc_mode!r}")
        self.discrete = calc_mode == "discrete"
        self.dur = el.get("dur")
        if not self.dur or not DUR_RE.match(self.dur):
            raise ValueError(f"unsupported dur {self.dur!r}")
        self.attr = el.get("attributeName") or ""
        raw = (el.get("values") or "").split(";")
        self.frames = len(raw)
        if self.frames < 2:
            raise ValueError(f"animation needs at least 2 values, got {self.frames}")
        self.values: list[float] = []
        self.moves: list[tuple[float, float]] = []
        if tag(el) == "animateTransform":
            if el.get("type") != "translate" or self.attr != "transform":
                raise ValueError("only translate <animateTransform> is supported")
            for v in raw:
                parts = v.split()
                if len(parts) != 2:
                    raise ValueError(f"translate <animateTransform> value {v!r} must have exactly 2 numbers")
                self.moves.append((num(parts[0]), num(parts[1])))
        elif self.attr in ("x", "y", "height", "opacity"):
            self.values = [num(v) for v in raw]
            if self.attr == "height" and max(self.values) == 0:
                # Sheet.add divides by this rect's max height to get scaleY; a max of 0 would divide by zero.
                raise ValueError("height animation's max value is 0, can't scale from it")
        else:
            raise ValueError(f"unsupported animated attribute {self.attr!r}")
        kt = el.get("keyTimes")
        self.key_times = [num(t) for t in kt.split(";")] if kt else None
        if self.key_times is not None:
            if len(self.key_times) != self.frames:
                raise ValueError(f"keyTimes has {len(self.key_times)} entries, values has {self.frames}")
            if self.key_times[0] != 0:
                raise ValueError(f"keyTimes must start at 0, got {self.key_times!r}")
            if any(b < a for a, b in zip(self.key_times, self.key_times[1:], strict=False)):
                raise ValueError(f"keyTimes must be non-decreasing, got {self.key_times!r}")
            if not self.discrete and self.key_times[-1] != 1:
                raise ValueError(f"linear keyTimes must end at 1, got {self.key_times!r}")

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


def shutter_kind(heights: list[float]) -> str | None:
    """Classify a height animation outside any mood layer: dips from open = eye, grows from 0 = lid."""
    if heights[0] > 0 and min(heights) < heights[0]:
        return "eye"
    if heights[0] == 0 < max(heights):
        return "lid"
    return None


def eye_rects(root: ET.Element) -> list[list[float]]:
    """Blinking eyes: rects outside any mood layer whose height dips, skipping face-* override layers."""
    out = []

    def walk(el: ET.Element, in_mood: bool) -> None:
        if tag(el) == "g" and el.get("class") in FACES:
            return  # a critter's own face art is never an eye box, however it happens to be drawn
        in_mood = in_mood or mood_of(el) is not None
        if tag(el) == "rect" and not in_mood:
            heights = [Anim(a).values for a in el if tag(a) == "animate" and a.get("attributeName") == "height"]
            if heights and shutter_kind(heights[0]) == "eye":
                out.append(rect_geom(el))
        for c in el:
            walk(c, in_mood)

    walk(root, False)
    return out


def inside(r: list[float], box: list[float]) -> bool:
    return r[0] >= box[0] and r[1] >= box[1] and r[0] + r[2] <= box[0] + box[2] and r[1] + r[3] <= box[1] + box[3]


def drawn(n: dict) -> bool:
    """Would this converted node render outside its own mood layer, however deeply nested?"""
    return "mood" not in n and ("r" in n or any(drawn(c) for c in n.get("g", [])))


def clean(v: float) -> float:
    """Round off the drift x1 - x0 picks up (Nox's head: 1.8 + 16.4 lands a hair short of 18.2); "16" not "16.0"."""
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
        if "mood" in n:
            continue
        if n.get("role") in ("eye", "lid"):
            yield n
        yield from shutters(n.get("g", []))


def anchors_of(root: list[dict]) -> dict:
    """Where the duty faces go (critters.js faceGlyphs): each eye's box, and the head's top-right corner."""
    x, y, w, _ = sprite_box(root)
    eyes = [dict(zip(("x", "y", "w", "h"), n["g"][0]["r"], strict=True), role=n["role"]) for n in shutters(root)]
    return {"eyes": eyes, "head": {"top": clean(y), "right": clean(x + w)}}


INK_RE = re.compile(r"^#[0-9a-fA-F]{6}$")


def ink_of(svg_name: str, doc: ET.Element, root: list[dict]) -> str:
    """The faces' glyph colour: the eyes' own fill, or data-ink on the <svg> where it can't be read."""
    declared = doc.get("data-ink")
    if declared is not None:
        if not INK_RE.fullmatch(declared):
            raise ValueError(f"{svg_name}: data-ink must be #rrggbb, got {declared!r}")
        return declared
    found = list(shutters(root))
    if not found:
        raise ValueError(f"{svg_name}: no eye or lid, so the duty faces have nothing to sit on")
    eye = next((n for n in found if n["role"] == "eye"), None)
    fill = eye and eye["g"][0].get("a", {}).get("fill")
    if not fill or not INK_RE.fullmatch(fill):
        # A lid covers the eye it shuts; a parent <g>'s fill never lands on the rect node() reads.
        raise ValueError(
            f'{svg_name}: its eyes are lids, or painted by a parent <g>; declare the face colour with data-ink="#rrggbb"'
        )
    return fill


def convert(cid: str, svg: Path, sheet: Sheet) -> dict:
    """convert, with svg.name prefixed onto any ValueError that doesn't already carry it."""
    try:
        return _convert(cid, svg, sheet)
    except ValueError as e:
        prefix = f"{svg.name}: "
        msg = str(e)
        raise ValueError(msg if msg.startswith(prefix) else f"{prefix}{msg}") from e


def _convert(cid: str, svg: Path, sheet: Sheet) -> dict:
    text = re.sub(r"<metadata>.*?</metadata>", "", svg.read_text(), flags=re.S)
    doc = ET.fromstring(text)
    if doc.get("viewBox") != "0 0 20 20":
        raise ValueError(f"{svg.name}: expected viewBox 0 0 20 20")
    outer = []
    for c in doc:
        ct = tag(c)
        if ct == "g":
            outer.append(c)
        elif ct not in ("style", "metadata"):
            raise ValueError(f"{svg.name}: unsupported top-level element <{ct}>")
    if len(outer) != 1:
        raise ValueError(f"{svg.name}: expected one outer <g>")
    if outer[0].attrib:
        # Paint, class or a mood on the outer <g> would be silently dropped — it never reaches node().
        raise ValueError(f"{svg.name}: the outer <g> must have no attributes, got {sorted(outer[0].attrib)}")
    kids = list(outer[0])
    if not kids or tag(kids[0]) != "animateTransform" or kids[0].get("data-bob") is None:
        raise ValueError(f"{svg.name}: the outer <g> must open with the data-bob idle bob")
    eyes = eye_rects(outer[0])

    def node(el: ET.Element, in_mood: bool) -> dict:
        t = tag(el)
        mood = mood_of(el)
        if t == "rect":
            check_attrs(el, {"x", "y", "width", "height"})
            if el.get("class") in FACES:
                raise ValueError(f"{svg.name}: {el.get('class')} must be a <g>, not a <rect>")
            for c in el:
                if tag(c) != "animate":
                    raise ValueError(f"{svg.name}: <rect> may only contain <animate>, found <{tag(c)}>")
            anims = [Anim(c) for c in el]
            if el.get("opacity") is not None and any(a.attr == "opacity" for a in anims):
                # SMIL's animated opacity replaces the static one; the CSS wrapper's would multiply with it.
                raise ValueError(f"{svg.name}: <rect> has both a static opacity attribute and an animated opacity")
            geom = rect_geom(el)
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
                kind = shutter_kind(heights)
                if kind is None:
                    raise ValueError(
                        f"{svg.name}: height animation on <rect> is neither an eye blink nor a lid: {heights!r}"
                    )
                if kind == "lid":
                    g["role"], g["shut"] = "lid", geom
                else:
                    i = heights.index(min(heights))
                    ys = next((a.values for a in anims if a.attr == "y"), None)
                    g["role"] = "eye"
                    g["shut"] = [geom[0], ys[i] if ys else geom[1], geom[2], heights[i]]
            return g
        if t == "g":
            check_attrs(el, set())
            if el.get("class") in FACES:
                raise ValueError(f"{svg.name}: {el.get('class')} must sit directly under the outer <g>")
            anims = []
            kids2 = []
            for c in el:
                ct = tag(c)
                if ct == "animateTransform":
                    anims.append(Anim(c))
                elif ct == "animate":
                    raise ValueError(f"{svg.name}: <g> may only animate via a translate <animateTransform>")
                elif ct in ("rect", "g"):
                    kids2.append(c)
                else:
                    raise ValueError(f"{svg.name}: unsupported element <{ct}> inside <g>")
            children = [node(c, in_mood or mood is not None) for c in kids2]
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
        raise AssertionError(f"unreachable: callers only pass rect/g, got <{t}>")

    def face_layer(c: ET.Element) -> dict:
        """A face-* layer is static art: rects and groups only, never animated, never moody, never empty."""
        face_cls = c.get("class")

        def check(el: ET.Element) -> None:
            t = tag(el)
            if t not in ("rect", "g"):
                raise ValueError(f"{svg.name}: {face_cls} may only hold <rect> and <g>, found <{t}>")
            if el.get("class") in MOODS:
                raise ValueError(
                    f"{svg.name}: {face_cls} can't hold a mood layer — a face always shows over the calm mood"
                )
            for sub in el:
                check(sub)

        for k in c:
            check(k)
        if not any(tag(d) == "rect" for d in c.iter() if d is not c):
            raise ValueError(f"{svg.name}: {face_cls} draws nothing")
        check_attrs(c, set())
        layer = {"g": [node(k, False) for k in c]}
        if paint(c):
            layer["a"] = paint(c)
        return layer

    root = []
    faces: dict[str, list[dict]] = {}
    for c in kids[1:]:
        if tag(c) not in ("rect", "g"):
            raise ValueError(f"{svg.name}: unsupported element <{tag(c)}> directly under the outer <g>")
        face_cls = c.get("class")
        if tag(c) == "g" and face_cls in FACES:
            # A critter's own art for one duty face, drawn instead of the generated glyph (critters.js
            # faceGlyphs) and never as part of the critter itself.
            name = FACES[face_cls]
            if name in faces:
                raise ValueError(f"{svg.name}: {face_cls} appears twice")
            faces[name] = [face_layer(c)]
            continue
        root.append(node(c, False))
    if not any(drawn(n) for n in root):
        # Every layer conditioned on a mood, however deeply nested: nothing renders by default,
        # so spriteBox is Infinity downstream. Also catches an empty root.
        raise ValueError(f"{svg.name}: every layer is inside a mood group, nothing is always drawn")
    out = {
        "name": doc.get("aria-label") or cid.title(),
        "root": root,
        "anchors": anchors_of(root),
        "ink": ink_of(svg.name, doc, root),
    }
    if faces:
        out["faces"] = faces
    return out


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
