"""periscope.reviews — the on-disk walkthrough/comments convention and the
queue assembly. Files live outside the repo (~/.claude/reviews); tests point
REVIEWS_DIR at tmp_path."""

import pytest

from periscope import reviews

WALKTHROUGH = """# Cost pressure gauge

> branch: feat/x · head: 3f2a1c9 · pr: 1234
> repo: fdy

Panes with a bloated context cost more per turn and nothing said so.

## Adds a per-pane cost-pressure gauge
> kind: new-subsystem · refs: periscope/cost_pressure.py, static/src/split/ctxBand.js:1-40

Prose.

```
## not a stop (fenced)
```

## Reuses the PR cache
> kind: reuse · refs: periscope/git_pr.py:223-276

More prose.
"""

COMMENTS = """## 2026-10-26T09:14 · Adds a per-pane cost-pressure gauge
> resolved: no

Why does this bypass the signals store?
## looks like a heading but is body text

## 2026-10-26T09:20 · Reuses the PR cache
> resolved: yes

Fine.
"""


@pytest.fixture(autouse=True)
def _dir(tmp_path, monkeypatch):
    monkeypatch.setattr(reviews, "REVIEWS_DIR", tmp_path)
    yield tmp_path


def test_slug_and_paths(tmp_path):
    assert reviews.slug_for("feat/a/b") == "feat--a--b"
    assert reviews.review_dir("fdy", "feat/a") == tmp_path / "fdy" / "feat--a"
    assert reviews.walkthrough_path("fdy", "feat/a").name == "walkthrough.md"
    assert reviews.comments_path("fdy", "feat/a").name == "comments.md"


def test_meta_pairs_splits_on_dot_and_newline():
    assert reviews.meta_pairs(["branch: feat/x · head: abc", "repo: fdy"]) == {
        "branch": "feat/x",
        "head": "abc",
        "repo": "fdy",
    }


def test_meta_pairs_rejects_markup():
    assert reviews.meta_pairs(["**For agentic workers:** REQUIRED"]) is None
    assert reviews.meta_pairs(["just a quote"]) is None


def test_parse_header():
    assert reviews.parse_header(WALKTHROUGH) == {"branch": "feat/x", "head": "3f2a1c9", "pr": 1234, "repo": "fdy"}
    assert reviews.parse_header("# T\n\n> head: abc\n") is None  # branch required
    assert reviews.parse_header("# T\n\n> **bold**: x\n") is None


def test_count_stops_ignores_fenced_headings():
    assert reviews.count_stops(WALKTHROUGH) == 2


def test_parse_comments_and_unresolved():
    got = reviews.parse_comments(COMMENTS)
    assert [c["stop"] for c in got] == ["Adds a per-pane cost-pressure gauge", "Reuses the PR cache"]
    assert got[0]["resolved"] is False and got[1]["resolved"] is True
    assert got[0]["ts"] == "2026-10-26T09:14"
    assert "## looks like a heading" in got[0]["body"]
    assert reviews.unresolved(COMMENTS) == 1
    assert reviews.parse_comments("") == []


def test_append_comment_creates_then_appends(tmp_path):
    reviews.append_comment("fdy", "feat/x", "Stop A", "first", "2026-10-26T09:14")
    reviews.append_comment("fdy", "feat/x", "Stop B", "second\nline", "2026-10-26T09:15")
    text = (tmp_path / "fdy" / "feat--x" / "comments.md").read_text()
    got = reviews.parse_comments(text)
    assert [(c["stop"], c["body"], c["resolved"]) for c in got] == [
        ("Stop A", "first", False),
        ("Stop B", "second\nline", False),
    ]


def test_clear_review_removes_only_that_dir(tmp_path):
    reviews.append_comment("fdy", "feat/x", "S", "b", "2026-10-26T09:14")
    reviews.append_comment("fdy", "feat/y", "S", "b", "2026-10-26T09:14")
    reviews.clear_review("fdy", "feat/x")
    assert not (tmp_path / "fdy" / "feat--x").exists()
    assert (tmp_path / "fdy" / "feat--y").exists()
    reviews.clear_review("fdy", "nope")  # missing dir is a no-op
