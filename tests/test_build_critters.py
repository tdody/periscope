"""build_critters.py — the critter SVGs → committed sprite data + CSS."""

import re
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


def test_scope_eye_blink_keyframe_is_exact():
    # A known conversion, pinned so a refactor of the scaling math can't drift silently.
    _, css = build_critters.render()
    assert "96% { transform: translate(0px, 1px) scaleY(0.2); }" in css


def test_jelly_discrete_tentacle_sway_holds_its_last_frame():
    _, css = build_critters.render()
    start = css.index("@keyframes crit-jelly-1 ")
    rule = css[start : css.index("\n", start)]
    frames = dict(re.findall(r"(\d+)% \{ ([^}]*)\}", rule))
    assert list(frames) == ["0", "25", "50", "75", "100"]
    assert frames["100"] == frames["75"]


def test_glint_role_is_per_critter():
    js, _ = build_critters.render()
    scope_line = next(ln for ln in js.splitlines() if ln.startswith("  scope:"))
    nox_line = next(ln for ln in js.splitlines() if ln.startswith("  nox:"))
    assert '"role":"glint"' in scope_line
    assert '"role":"glint"' not in nox_line


def _svg(tmp_path: Path, body: str, g_attrs: str = "") -> Path:
    p = tmp_path / "bad.svg"
    bob = '<animateTransform attributeName="transform" type="translate" values="0 0;0 -1" dur="1s" repeatCount="indefinite" data-bob="x"/>'
    p.write_text(f'<svg viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg"><g{g_attrs}>{bob}{body}</g></svg>')
    return p


def test_raises_on_an_element_it_does_not_know(tmp_path):
    with pytest.raises(ValueError, match="circle"):
        build_critters.convert("bad", _svg(tmp_path, '<circle r="1"/>'), build_critters.Sheet())


def test_raises_on_an_attribute_it_does_not_know(tmp_path):
    with pytest.raises(ValueError, match="rx"):
        build_critters.convert(
            "bad", _svg(tmp_path, '<rect x="0" y="0" width="1" height="1" rx="1"/>'), build_critters.Sheet()
        )


@pytest.mark.parametrize(
    "body,match,g_attrs",
    [
        # <rect> may only contain <animate> — stray SMIL on a rect isn't swallowed.
        (
            '<rect><animateTransform attributeName="transform" type="translate" values="0 0;1 0" '
            'dur="1s" repeatCount="indefinite"/></rect>',
            "animateTransform",
            "",
        ),
        ('<rect><set attributeName="fill" to="red"/></rect>', "set", ""),
        # <g> may only animate via a translate <animateTransform> — not a bare <animate>. Pinned to
        # the exact message, not just "animate" (which also matches unrelated messages).
        (
            '<g><animate attributeName="opacity" values="0;1" dur="1s" repeatCount="indefinite"/></g>',
            "may only animate via a translate",
            "",
        ),
        # Timing validation in Anim.__init__.
        (
            '<rect x="0" y="0" width="1" height="1">'
            '<animate attributeName="height" values="1;0.5" calcMode="paced" dur="1s" '
            'repeatCount="indefinite"/></rect>',
            "paced",
            "",
        ),
        (
            '<rect x="0" y="0" width="1" height="1">'
            '<animate attributeName="height" values="1;0.5" repeatCount="indefinite"/></rect>',
            "dur",
            "",
        ),
        (
            '<rect x="0" y="0" width="1" height="1">'
            '<animate attributeName="height" values="1" dur="1s" repeatCount="indefinite"/></rect>',
            "values",
            "",
        ),
        (
            '<rect x="0" y="0" width="1" height="1">'
            '<animate attributeName="height" values="1;0.5;1" keyTimes="0;1" dur="1s" '
            'repeatCount="indefinite"/></rect>',
            "keyTimes",
            "",
        ),
        (
            '<rect x="0" y="0" width="1" height="1">'
            '<animate attributeName="height" values="1;0.5;1" keyTimes="0;0.5;0.9" dur="1s" '
            'repeatCount="indefinite"/></rect>',
            "keyTimes",
            "",
        ),
        # keyTimes must be non-decreasing (discrete, so the linear-ends-at-1 rule doesn't interfere).
        (
            '<rect x="0" y="0" width="1" height="1">'
            '<animate attributeName="height" values="1;0.5;1" keyTimes="0;0.6;0.4" calcMode="discrete" '
            'dur="1s" repeatCount="indefinite"/></rect>',
            "non-decreasing",
            "",
        ),
        # A height animation outside a mood layer that neither dips nor grows from 0.
        (
            '<rect x="0" y="0" width="1" height="1">'
            '<animate attributeName="height" values="1;3;1" dur="1s" repeatCount="indefinite"/></rect>',
            "neither",
            "",
        ),
        # Static opacity + an opacity animation on the same rect.
        (
            '<rect x="0" y="0" width="1" height="1" opacity="0.5">'
            '<animate attributeName="opacity" values="1;0" dur="1s" repeatCount="indefinite"/></rect>',
            "opacity",
            "",
        ),
        # A translate <animateTransform> value with the wrong arity (not 2 numbers).
        (
            '<g><animateTransform attributeName="transform" type="translate" values="0 0;1" '
            'dur="1s" repeatCount="indefinite"/></g>',
            "exactly 2 numbers",
            "",
        ),
        # Every top-level layer inside a mood group — nothing is ever always drawn.
        (
            '<g class="mood-calm"><rect x="0" y="0" width="1" height="1"/></g>',
            "always drawn",
            "",
        ),
        # Nothing but the idle bob: an empty root.
        ("", "always drawn", ""),
        # The mood is on a nested <g>, not the direct top-level child — the shallow check missed this.
        (
            '<g><g class="mood-calm"><rect x="0" y="0" width="1" height="1"/></g></g>',
            "always drawn",
            "",
        ),
        # An empty <g> with nothing inside it at all.
        ("<g></g>", "always drawn", ""),
        # The outer <g> (holding the data-bob) must itself carry no attributes.
        ("", "no attributes", ' fill="#fff"'),
    ],
)
def test_raises_on_unsupported_input(tmp_path, body, match, g_attrs):
    with pytest.raises(ValueError, match=match):
        build_critters.convert("bad", _svg(tmp_path, body, g_attrs), build_critters.Sheet())


def test_timing_errors_name_the_svg_file(tmp_path):
    # Structural errors already said which file; Anim's didn't. Now every error does.
    body = (
        '<rect x="0" y="0" width="1" height="1">'
        '<animate attributeName="height" values="1;0.5" calcMode="paced" dur="1s" '
        'repeatCount="indefinite"/></rect>'
    )
    with pytest.raises(ValueError, match="bad.svg"):
        build_critters.convert("bad", _svg(tmp_path, body), build_critters.Sheet())


def test_raises_on_a_stray_top_level_element(tmp_path):
    # _svg nests everything inside the outer <g>; write this one by hand to put a
    # <rect> as a sibling of the outer <g> instead.
    p = tmp_path / "bad.svg"
    p.write_text(
        '<svg viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">'
        '<g><animateTransform attributeName="transform" type="translate" values="0 0;0 -1" '
        'dur="1s" repeatCount="indefinite" data-bob="x"/></g>'
        '<rect x="0" y="0" width="1" height="1"/>'
        "</svg>"
    )
    with pytest.raises(ValueError, match="rect"):
        build_critters.convert("bad", p, build_critters.Sheet())
