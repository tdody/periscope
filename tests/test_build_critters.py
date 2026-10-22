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
