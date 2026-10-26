"""Tests for periscope/gitutil.py's stateless git primitives."""

import subprocess

from periscope import worktrees
from periscope.gitutil import worktree_root


def test_worktree_root_matches_worktree_list(tmp_git_repo):
    # `worktree_root` (show-toplevel + realpath) and `_list_worktrees`
    # (worktree list --porcelain + realpath) must agree on the same path — a
    # mismatch leaves `compute_candidates(paths=...)` evaluating nothing while
    # every test that mocks one or the other stays green.
    repo = tmp_git_repo
    subprocess.run(["git", "-C", str(repo), "worktree", "add", ".wt/a", "-b", "fa"], check=True, capture_output=True)
    wt = repo / ".wt" / "a"
    sub = wt / "src"
    sub.mkdir(parents=True)

    assert worktree_root(str(sub)) in {p for p, _ in worktrees._list_worktrees(str(repo))}


def test_worktree_root_falls_back_to_input_when_git_cant_answer():
    assert worktree_root("/nonexistent/x") == "/nonexistent/x"
