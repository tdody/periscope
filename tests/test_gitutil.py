"""Tests for periscope/gitutil.py's stateless git primitives."""

import os
import subprocess

from periscope import worktrees
from periscope.gitutil import worktree_root


def test_worktree_root_matches_worktree_list(tmp_git_repo):
    # `worktree_root` (show-toplevel + realpath) and `_list_worktrees`
    # (worktree list --porcelain + realpath) must agree on the same path — a
    # mismatch leaves `compute_candidates(paths=...)` evaluating nothing while
    # every test that mocks one or the other stays green. `in {...}` alone
    # would also pass if worktree_root wrongly resolved to the MAIN checkout
    # (the first entry _list_worktrees returns) — exactly the regression that
    # would make the scoped modal come up empty — so pin the exact match too.
    repo = tmp_git_repo
    subprocess.run(["git", "-C", str(repo), "worktree", "add", ".wt/a", "-b", "fa"], check=True, capture_output=True)
    wt = repo / ".wt" / "a"
    sub = wt / "src"
    sub.mkdir(parents=True)

    assert worktree_root(str(sub)) == str(wt)
    assert str(wt) in {p for p, _ in worktrees._list_worktrees(str(repo))}


def test_worktree_root_resolves_through_a_symlink(tmp_git_repo, tmp_path):
    # /tmp -> /private/tmp style indirection: a pane's cwd can be reached
    # through a symlink, and `worktree_root` must still land on the real
    # worktree path (realpath'd), not the symlinked one.
    repo = tmp_git_repo
    subprocess.run(["git", "-C", str(repo), "worktree", "add", ".wt/a", "-b", "fa"], check=True, capture_output=True)
    wt = repo / ".wt" / "a"
    (wt / "src").mkdir(parents=True)
    link = tmp_path / "link"
    os.symlink(wt, link)

    assert worktree_root(str(link / "src")) == str(wt)


def test_worktree_root_falls_back_to_input_when_git_cant_answer():
    assert worktree_root("/nonexistent/x") == "/nonexistent/x"
