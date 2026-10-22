"""build_critters.py — the critter SVGs → committed sprite data + CSS."""

import json
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


def _svg(tmp_path: Path, body: str, g_attrs: str = "", svg_attrs: str = "") -> Path:
    p = tmp_path / "bad.svg"
    bob = '<animateTransform attributeName="transform" type="translate" values="0 0;0 -1" dur="1s" repeatCount="indefinite" data-bob="x"/>'
    p.write_text(
        f'<svg viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg"{svg_attrs}><g{g_attrs}>{bob}{body}</g></svg>'
    )
    return p


def _sprite(cid: str) -> dict:
    js, _ = build_critters.render()
    line = next(ln for ln in js.splitlines() if ln.startswith(f"  {cid}:"))
    return json.loads(line.split(":", 1)[1].strip().rstrip(","))


# A blinking eye (height dips) and a lid (height grows from 0), as the real SVGs draw them.
EYE = (
    '<rect x="6" y="9" width="2" height="2" fill="#111111">'
    '<animate attributeName="height" values="2;0.4;2" dur="4s" repeatCount="indefinite"/></rect>'
)
EYE_NO_FILL = (
    '<rect x="6" y="9" width="2" height="2">'
    '<animate attributeName="height" values="2;0.4;2" dur="4s" repeatCount="indefinite"/></rect>'
)
EYE_FILL_NONE = (
    '<rect x="6" y="9" width="2" height="2" fill="none">'
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


def test_anchors_head_is_fractional_for_nox():
    # x1 - x0 (1.8 + 16.4) drifts off 18.2 in raw float; clean() rounds it back.
    assert _sprite("nox")["anchors"]["head"] == {"top": 3, "right": 18.2}


def test_mixed_lid_then_eye_keeps_document_order_and_inks_from_the_eye(tmp_path):
    s = build_critters.convert("t", _svg(tmp_path, BODY + LID + EYE), build_critters.Sheet())
    assert s["anchors"]["eyes"] == [
        {"x": 6, "y": 6, "w": 3, "h": 3, "role": "lid"},
        {"x": 6, "y": 9, "w": 2, "h": 2, "role": "eye"},
    ]
    assert s["ink"] == "#111111"


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
    with pytest.raises(ValueError, match="#rrggbb, got"):
        build_critters.convert("t", _svg(tmp_path, BODY + EYE, svg_attrs=' data-ink="green"'), build_critters.Sheet())


def test_an_eye_painted_by_a_parent_g_raises(tmp_path):
    # node() only ever records paint on the eye's own rect; a parent <g>'s fill never reaches it.
    body = f'<g fill="#123456">{EYE_NO_FILL}</g>'
    with pytest.raises(ValueError, match="data-ink"):
        build_critters.convert("t", _svg(tmp_path, BODY + body), build_critters.Sheet())


def test_a_derived_eye_fill_that_is_not_hex_raises(tmp_path):
    with pytest.raises(ValueError, match="data-ink"):
        build_critters.convert("t", _svg(tmp_path, BODY + EYE_FILL_NONE), build_critters.Sheet())


def test_no_eye_or_lid_raises(tmp_path):
    with pytest.raises(ValueError, match="nothing to sit on"):
        build_critters.convert("t", _svg(tmp_path, BODY), build_critters.Sheet())


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
        ('<g class="face-wink"><rect x="1" y="1" width="1" height="1"/></g>', "unknown class 'face-wink'"),
        # A face layer nested inside another group would be drawn all the time instead.
        ('<g><g class="face-happy"><rect x="1" y="1" width="1" height="1"/></g></g>', "directly under"),
        ('<rect class="face-happy" x="1" y="1" width="1" height="1"/>', "must be a <g>"),
        (
            '<g class="face-x"><rect x="1" y="1" width="1" height="1"/></g>'
            '<g class="face-x"><rect x="2" y="2" width="1" height="1"/></g>',
            "twice",
        ),
        # Face art is static — no SMIL, however it's spelled.
        (
            '<g class="face-happy"><animateTransform attributeName="transform" type="translate" '
            'values="0 0;1 0" dur="1s" repeatCount="indefinite"/><rect x="1" y="1" width="1" height="1"/></g>',
            "may only hold",
        ),
        ('<g class="face-happy"><circle r="1"/></g>', "may only hold"),
        (
            '<g class="face-happy"><rect x="1" y="1" width="1" height="1">'
            '<animate attributeName="height" values="1;0.5" dur="1s" repeatCount="indefinite"/></rect></g>',
            "may only hold",
        ),
        # A face always shows over the calm mood — it can't itself be conditioned on one.
        (
            '<g class="face-happy"><g class="mood-grumpy"><rect x="1" y="1" width="1" height="1"/></g></g>',
            "can't hold a mood",
        ),
        ('<g class="face-happy"></g>', "draws nothing"),
    ],
)
def test_raises_on_a_bad_face_layer(tmp_path, layer, match):
    with pytest.raises(ValueError, match=match):
        build_critters.convert("t", _svg(tmp_path, BODY + EYE + layer), build_critters.Sheet())


def test_face_art_outside_the_body_never_grows_the_head_anchor(tmp_path):
    # anchors_of walks `root`, which face layers never join — a face can reach past the sprite box.
    base = build_critters.convert("t", _svg(tmp_path, BODY + EYE), build_critters.Sheet())
    face = '<g class="face-happy"><rect x="18" y="0" width="1" height="1"/></g>'
    with_face = build_critters.convert("t", _svg(tmp_path, BODY + EYE + face), build_critters.Sheet())
    assert with_face["anchors"]["head"] == base["anchors"]["head"]


def test_mood_plus_face_layer_alone_still_raises_always_drawn(tmp_path):
    # The face layer never joins `root`, so it can't rescue an SVG that otherwise draws nothing.
    body = '<g class="mood-calm"><rect x="1" y="1" width="1" height="1"/></g>'
    face = '<g class="face-happy"><rect x="2" y="2" width="1" height="1"/></g>'
    with pytest.raises(ValueError, match="always drawn"):
        build_critters.convert("t", _svg(tmp_path, body + face), build_critters.Sheet())


def test_nox_draws_its_own_worried_brows():
    worried = _sprite("nox")["faces"]["worried"]
    assert worried[0]["a"] == {"fill": "#d5d8dc"}
    assert len(worried[0]["g"]) == 4


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
