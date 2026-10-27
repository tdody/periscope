"""periscope.reviews — the on-disk walkthrough/comments convention and the
queue assembly. Files live outside the repo (~/.claude/reviews); tests point
REVIEWS_DIR at tmp_path."""

import os
import subprocess

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
    monkeypatch.setattr(reviews, "_DEFAULT_BRANCH", {})
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


def test_parse_header_non_ascii_digit_pr_is_none():
    # str.isdigit() accepts "²" but int("²") raises, which 500'd /api/reviews.
    h = reviews.parse_header("# T\n\n> branch: feat/x · head: abc · pr: ²\n")
    assert h is not None and h["pr"] is None


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


def test_parse_comments_tolerates_hand_edited_resolved_line():
    text = "## 2026-10-26T09:14 · A\n> resolved: no\n\nfirst\n\n## 2026-10-26T09:20 · B  \n> resolved: Yes \n\nsecond\n"
    got = reviews.parse_comments(text)
    assert [(c["stop"], c["resolved"], c["body"]) for c in got] == [("A", False, "first"), ("B", True, "second")]


def test_clear_review_refuses_paths_outside_reviews_dir(tmp_path):
    reviews.append_comment("fdy", "feat/x", "S", "b", "2026-10-26T09:14")
    for repo, branch in (("", ""), ("..", "x")):
        with pytest.raises(ValueError):
            reviews.clear_review(repo, branch)
    assert (tmp_path / "fdy" / "feat--x" / "comments.md").exists()


def _win(**over):
    base = {
        "pid": "p1",
        "pane_id": "%1",
        "session": "s",
        "index": 1,
        "name": "work",
        "cwd": "/dev/fdy/.claude/worktrees/x",
        "repo_key": "/dev/fdy",
        "repo_label": "fdy",
        "branch": "feat/x",
        "agent": "claude",
        "channel_attached": True,
        "activity": 100,
        "track_id": "/dev/fdy",
        "pr": None,
        "pr_state": None,
        "ci": None,
    }
    return {**base, **over}


def test_owner_for_picks_attached_claude_on_the_branch_most_recent():
    wins = [
        _win(pid="shell", agent=None),
        _win(pid="other", branch="feat/y"),  # same track, other branch
        _win(pid="detached", channel_attached=False),
        _win(pid="old", activity=50),
        _win(pid="new", activity=200),
    ]
    assert reviews.owner_for(wins, "fdy", "feat/x")["pid"] == "new"
    assert reviews.owner_for(wins, "fdy", "feat/z") is None
    assert reviews.owner_for(wins, "other-repo", "feat/x") is None


def test_worktree_for_cached_and_fresh(mocker):
    cached = mocker.patch("periscope.worktrees._cached_worktrees", return_value=[("/wt/x", "feat/x")])
    fresh = mocker.patch("periscope.worktrees.for_branch", return_value="/wt/fresh")
    wins = [_win()]
    assert reviews.worktree_for(wins, "fdy", "feat/x") == "/wt/x"
    cached.assert_called_once_with("/dev/fdy")
    assert reviews.worktree_for(wins, "fdy", "feat/x", fresh=True) == "/wt/fresh"
    fresh.assert_called_once_with("/dev/fdy", "feat/x")
    assert reviews.worktree_for(wins, "nope", "feat/x") is None  # no window knows the repo path


def _git_repo(path):
    subprocess.run(["git", "init", "-q", "-b", "main", str(path)], check=True)
    env = {"GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@t", "GIT_COMMITTER_NAME": "t", "GIT_COMMITTER_EMAIL": "t@t"}
    for n in ("a", "b", "c"):
        (path / n).write_text(n)
        subprocess.run(["git", "-C", str(path), "add", n], check=True)
        subprocess.run(["git", "-C", str(path), "commit", "-q", "-m", n], check=True, env={**os.environ, **env})
    return subprocess.run(
        ["git", "-C", str(path), "rev-list", "--all"], capture_output=True, text=True, check=True
    ).stdout.split()


def test_stale_by_counts_commits_since_head(tmp_path):
    shas = _git_repo(tmp_path / "r")  # newest first
    assert reviews.stale_by(str(tmp_path / "r"), shas[0]) == 0
    assert reviews.stale_by(str(tmp_path / "r"), shas[2]) == 2
    assert reviews.stale_by(str(tmp_path / "r"), "0000000") is None
    assert reviews.stale_by(None, shas[0]) is None


MINE = '[{"number": 1234, "title": "Gauge", "headRefName": "feat/x", "isDraft": false, "statusCheckRollup": [], "author": {"login": "tom"}}]'
REQUESTED = (
    '[{"number": 1234, "title": "Gauge", "headRefName": "feat/x", "isDraft": false, "statusCheckRollup": [], "author": {"login": "tom"}},'
    ' {"number": 99, "title": "Teammate PR", "headRefName": "feat/theirs", "isDraft": true, "statusCheckRollup": [], "author": {"login": "sam"}}]'
)


def test_open_prs_merges_both_lists_and_assigns_roles(mocker):
    mocker.patch("periscope.reviews._GH_AVAILABLE", True)
    mocker.patch("periscope.reviews.gitutil.github_slug", return_value="tom/fdy")
    run = mocker.patch("periscope.reviews._run", side_effect=[(0, MINE), (0, REQUESTED)])
    got = reviews.open_prs("/dev/fdy")
    assert [(p["number"], p["role"], p["branch"], p["author"], p["draft"]) for p in got] == [
        (1234, "mine", "feat/x", "tom", False),
        (99, "review-requested", "feat/theirs", "sam", True),
    ]
    first, second = run.call_args_list
    assert "--author" in first.args[0] and "@me" in first.args[0] and first.kwargs["cwd"] == "/dev/fdy"
    assert "--search" in second.args[0] and "review-requested:@me" in second.args[0]


def test_open_prs_without_gh_is_empty(mocker):
    mocker.patch("periscope.reviews._GH_AVAILABLE", False)
    assert reviews.open_prs("/dev/fdy") == []


def test_list_reviews_assembles_prs_then_local_then_orphans(tmp_path, mocker, monkeypatch):
    monkeypatch.setattr(reviews.gitutil, "detect_default_branch", lambda root: "main")
    mocker.patch("periscope.worktrees._cached_worktrees", return_value=[("/dev/fdy/.claude/worktrees/x", "feat/x")])
    mocker.patch(
        "periscope.reviews.cached_open_prs",
        return_value=[
            {
                "number": 1234,
                "title": "Gauge",
                "branch": "feat/x",
                "draft": False,
                "ci": "✓",
                "role": "mine",
                "author": "tom",
            },
            {
                "number": 99,
                "title": "Theirs",
                "branch": "feat/theirs",
                "draft": True,
                "ci": None,
                "role": "review-requested",
                "author": "sam",
            },
        ],
    )
    linked = mocker.patch(
        "periscope.reviews.git_pr.cached_linked_pr_state", return_value={"pr_state": "merged", "ci": "✓"}
    )
    mocker.patch("periscope.reviews.stale_by", return_value=None)
    # my PR's branch has a walkthrough + one unresolved comment
    wt = reviews.walkthrough_path("fdy", "feat/x")
    wt.parent.mkdir(parents=True)
    wt.write_text(WALKTHROUGH)
    reviews.append_comment("fdy", "feat/x", "Stop", "hm", "2026-10-26T09:14")
    # orphan dir: no PR, no live window; its header names a closed PR
    o = reviews.walkthrough_path("fdy", "old/branch")
    o.parent.mkdir(parents=True)
    o.write_text("# T\n\n> branch: old/branch · head: abc · pr: 500\n")
    wins = [_win(), _win(pid="p2", branch="feat/local")]

    rows = reviews.list_reviews(wins, ["/dev/fdy"])
    assert [(r["repo"], r["branch"], r["role"]) for r in rows] == [
        ("fdy", "feat/x", "mine"),
        ("fdy", "feat/theirs", "review-requested"),
        ("fdy", "feat/local", "local"),
        ("fdy", "old/branch", "local"),
    ]
    x = rows[0]
    assert x["pr"] == {"number": 1234, "title": "Gauge", "draft": False, "state": "open", "ci": "✓", "author": "tom"}
    assert x["walkthrough"] == {"stops": 2, "head": "3f2a1c9", "stale_by": None}
    assert x["unresolved"] == 1
    assert x["owner"] == {"pid": "p1", "pane_id": "%1", "session": "s", "index": 1, "name": "work"}
    assert x["worktree"] == "/dev/fdy/.claude/worktrees/x"
    theirs = rows[1]
    assert theirs["owner"] is None and theirs["worktree"] is None and theirs["walkthrough"] is None
    local = rows[2]
    assert local["pr"] is None and local["owner"]["pid"] == "p2"
    ob = rows[3]
    assert ob["pr"] == {"number": 500, "title": "", "draft": False, "state": "merged", "ci": "✓", "author": None}
    linked.assert_called_with("/dev/fdy", 500)
    assert ob["owner"] is None and ob["slug"] == "old--branch"


def test_open_prs_skips_repos_without_github_and_returns_none_on_failure(mocker):
    mocker.patch("periscope.reviews._GH_AVAILABLE", True)
    mocker.patch("periscope.reviews.gitutil.github_slug", return_value=None)
    assert reviews.open_prs("/dev/local-only") == []
    mocker.patch("periscope.reviews.gitutil.github_slug", return_value="tom/fdy")
    mocker.patch("periscope.reviews._run", return_value=(1, "auth error"))
    assert reviews.open_prs("/dev/fdy") is None


def test_list_reviews_skips_default_branch_and_detached_windows(mocker):
    mocker.patch("periscope.reviews.cached_open_prs", return_value=[])
    mocker.patch("periscope.reviews.gitutil.detect_default_branch", return_value="main")
    mocker.patch("periscope.worktrees._cached_worktrees", return_value=[])
    reviews._DEFAULT_BRANCH.clear()
    wins = [_win(pid="a", branch="main"), _win(pid="b", branch="@abc1234"), _win(pid="c", branch="?")]
    assert reviews.list_reviews(wins, ["/dev/fdy"]) == []
    rows = reviews.list_reviews([_win(branch="feat/x")], ["/dev/fdy"])
    assert [(r["branch"], r["role"]) for r in rows] == [("feat/x", "local")]


def test_cached_open_prs_serves_stale_rows_and_refreshes_once(mocker):
    root = "/dev/stale-test"
    rows = [{"number": 1}]
    reviews._prs_cache[root] = (0, rows)
    bg = mocker.patch("periscope.reviews._bg")  # no real thread (docs/testing.md)
    try:
        assert reviews.cached_open_prs(root) == rows
        assert reviews.cached_open_prs(root) == rows
        bg.assert_called_once()
    finally:
        reviews._prs_cache.pop(root, None)
        reviews._prs_fetching.discard(root)


def test_fetch_failure_keeps_last_good_rows_and_clears_flag(mocker):
    root = "/dev/fail-test"
    rows = [{"number": 1}]
    reviews._prs_cache[root] = (0, rows)
    reviews._prs_fetching.add(root)
    mocker.patch("periscope.reviews.open_prs", return_value=None)
    try:
        reviews._fetch_prs_into_cache(root)
        assert reviews._prs_cache[root][1] == rows
        assert reviews._prs_cache[root][0] > 0
        assert root not in reviews._prs_fetching
    finally:
        reviews._prs_cache.pop(root, None)


def test_stale_by_does_not_cache_unknown_head(tmp_path):
    shas = _git_repo(tmp_path / "r")
    assert reviews.stale_by(str(tmp_path / "r"), "0000000") is None
    assert not any(k[1] == "0000000" for k in reviews._STALE_CACHE)
    assert reviews.stale_by(str(tmp_path / "r"), shas[1]) == 1


def test_review_requested_pr_matches_its_pr_n_checkout(mocker):
    mocker.patch(
        "periscope.reviews.cached_open_prs",
        return_value=[
            {
                "number": 123,
                "title": "T",
                "branch": "feat/theirs",
                "draft": False,
                "ci": None,
                "role": "review-requested",
                "author": "sam",
            },
        ],
    )
    mocker.patch("periscope.worktrees._cached_worktrees", return_value=[("/wt/pr-123", "pr-123")])
    mocker.patch("periscope.reviews.stale_by", return_value=None)
    mocker.patch("periscope.reviews.gitutil.detect_default_branch", return_value="main")
    wins = [_win(pid="rv", branch="pr-123", cwd="/wt/pr-123")]
    rows = reviews.list_reviews(wins, ["/dev/fdy"])
    assert [(r["branch"], r["role"]) for r in rows] == [("feat/theirs", "review-requested")]
    assert rows[0]["worktree"] == "/wt/pr-123"
    assert rows[0]["owner"]["pid"] == "rv"


def test_stale_by_rejects_option_like_head(mocker):
    run = mocker.patch("periscope.reviews._run", side_effect=AssertionError("must not run git"))
    assert reviews.stale_by("/wt", "-x") is None
    run.assert_not_called()


def test_aliases_for_cache_header_or_neither(tmp_path, monkeypatch):
    import time

    monkeypatch.setattr(reviews, "REVIEWS_DIR", tmp_path)
    monkeypatch.setitem(reviews._prs_cache, "/dev/fdy", (time.time(), [{"number": 7, "branch": "feat/x"}]))
    assert reviews.aliases_for("/dev/fdy", "fdy", "feat/x") == {"pr-7"}
    assert reviews.aliases_for("/dev/fdy", "fdy", "feat/y") == set()
    p = reviews.walkthrough_path("fdy", "feat/y")
    p.parent.mkdir(parents=True)
    p.write_text("# T\n\n> branch: feat/y · head: abc1234 · pr: 9\n\nbody\n")
    assert reviews.aliases_for("/dev/other", "fdy", "feat/y") == {"pr-9"}
    assert reviews.aliases_for(None, "fdy", "feat/y") == {"pr-9"}
