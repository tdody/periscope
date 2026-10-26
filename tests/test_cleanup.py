"""Unit tests for cleanup signal evaluation.

The cleanup verb keys "which panes/activity belong to this worktree" off the
worktree's cwd, NOT tmux session identity — panes collapse into one shared
session, so session-equality is broken (mass-match or never-match). These
tests pin the two cwd-keyed signals: PR-link discovery (Signal 1) and the
idle/active check (Signal 4).
"""

from periscope import cleanup


def _project(name, session, repo):
    return {
        "name": name,
        "tmux_session": session,
        "repo": repo,
        "archived_at": None,
        "base_branch": "main",
    }


def test_signal1_linked_pr_keys_on_worktree_cwd(mocker):
    # Two panes in ONE shared session, each at a different worktree cwd, each
    # carrying its OWN linked_pr. Evaluating worktree A must pick up A's PR,
    # never B's — session-equality would have grabbed whichever matched first.
    mocker.patch.object(cleanup, "_pr_state", return_value="MERGED")
    mocker.patch.object(cleanup, "_is_branch_merged", return_value=False)
    mocker.patch.object(cleanup, "_remote_branch_exists", return_value=True)
    mocker.patch.object(cleanup, "_last_commit_age_days", return_value=1)
    mocker.patch.object(cleanup, "_is_dirty", return_value=False)

    project_by_pinned = {
        "/repo/a": _project("a", "shared", "/repo"),
        "/repo/b": _project("b", "shared", "/repo"),
    }
    windows_snapshot = {
        "%pa": {"linked_pr": 11, "last_seen": {"session": "shared", "cwd": "/repo/a"}},
        "%pb": {"linked_pr": 22, "last_seen": {"session": "shared", "cwd": "/repo/b"}},
    }

    cand = cleanup._evaluate_worktree(
        "/repo/a",
        "feat-a",
        "/repo",
        "main",
        project_by_pinned,
        windows_snapshot,
        alive_worktree_cwds={"/repo/a", "/repo/b"},
        idle_threshold=14,
    )
    assert cand is not None
    # _pr_state called with worktree A's PR number, never B's.
    assert cleanup._pr_state.call_args.args[1] == 11
    assert any(s["kind"] == "pr_merged" and "#11" in s["label"] for s in cand["signals"])


def test_signal4_idle_keys_on_live_pane_cwd(mocker):
    # No PR/branch signals fire; the only question is active-vs-idle. A worktree
    # is "active" iff a live pane sits IN it (its realpath'd cwd is in the
    # alive set), independent of tmux session.
    mocker.patch.object(cleanup, "_pr_state", return_value=None)
    mocker.patch.object(cleanup, "_is_branch_merged", return_value=False)
    mocker.patch.object(cleanup, "_remote_branch_exists", return_value=True)
    mocker.patch.object(cleanup, "_last_commit_age_days", return_value=99)
    mocker.patch.object(cleanup, "_is_dirty", return_value=False)

    project_by_pinned = {"/repo/a": _project("a", "shared", "/repo")}

    # A live pane sits in the worktree → NOT idle → healthy → no candidate.
    assert (
        cleanup._evaluate_worktree(
            "/repo/a",
            "feat-a",
            "/repo",
            "main",
            project_by_pinned,
            {},
            alive_worktree_cwds={"/repo/a"},
            idle_threshold=14,
        )
        is None
    )

    # No live pane in the worktree → idle fires.
    cand = cleanup._evaluate_worktree(
        "/repo/a",
        "feat-a",
        "/repo",
        "main",
        project_by_pinned,
        {},
        alive_worktree_cwds={"/repo/other"},
        idle_threshold=14,
    )
    assert cand is not None
    assert any(s["kind"] == "idle" for s in cand["signals"])


def test_compute_candidates_paths_evaluates_only_those_worktrees(mocker):
    # A notification's "Clean up worktree" asks about one worktree; walking
    # every worktree (gh + git per worktree) is what makes the full list slow.
    mocker.patch.object(
        cleanup, "all_projects", return_value={"/r/a": _project("a", "s", "/r"), "/q/b": _project("b", "s", "/q")}
    )
    mocker.patch.object(
        cleanup.worktrees,
        "_cached_worktrees",
        side_effect=lambda repo: {"/r": [("/r", "main"), ("/r/a", "fa"), ("/r/c", "fc")], "/q": [("/q/b", "fb")]}[repo],
    )
    default = mocker.patch.object(cleanup, "_detect_default_branch", return_value="main")
    seen = []
    mocker.patch.object(cleanup, "_evaluate_worktree", side_effect=lambda wt, *a, **k: seen.append(wt))
    mocker.patch("periscope.panes.list_windows", return_value=[])
    mocker.patch("periscope.store.all_windows", return_value={})
    mocker.patch.object(cleanup, "get_settings", return_value={})
    # A pane's cwd can be a subdirectory: it resolves to its worktree root.
    mocker.patch.object(cleanup, "worktree_root", side_effect=lambda p: "/r/a" if p.startswith("/r/a") else p)

    cleanup.compute_candidates(paths=["/r/a/src"])

    assert seen == ["/r/a"]
    # A repo holding none of the paths is skipped before its default branch is looked up.
    default.assert_called_once_with("/r")


def test_compute_candidates_blank_path_evaluates_nothing(mocker):
    # `?paths=` with no value arrives as `[""]`. A blank path must never
    # resolve to the server's own checkout (`git -C "" rev-parse
    # --show-toplevel` answers for the server's cwd) — it must evaluate
    # nothing, not fall back to a full walk.
    mocker.patch.object(
        cleanup, "all_projects", return_value={"/r/a": _project("a", "s", "/r"), "/q/b": _project("b", "s", "/q")}
    )
    mocker.patch.object(
        cleanup.worktrees,
        "_cached_worktrees",
        side_effect=lambda repo: {"/r": [("/r", "main"), ("/r/a", "fa"), ("/r/c", "fc")], "/q": [("/q/b", "fb")]}[repo],
    )
    default = mocker.patch.object(cleanup, "_detect_default_branch", return_value="main")
    evaluate = mocker.patch.object(cleanup, "_evaluate_worktree")
    mocker.patch("periscope.panes.list_windows", return_value=[])
    mocker.patch("periscope.store.all_windows", return_value={})
    mocker.patch.object(cleanup, "get_settings", return_value={})

    assert cleanup.compute_candidates(paths=[""]) == []

    default.assert_not_called()
    evaluate.assert_not_called()


def test_compute_candidates_without_paths_walks_every_worktree(mocker):
    mocker.patch.object(cleanup, "all_projects", return_value={"/r/a": _project("a", "s", "/r")})
    mocker.patch.object(cleanup.worktrees, "_cached_worktrees", return_value=[("/r/a", "fa"), ("/r/c", "fc")])
    mocker.patch.object(cleanup, "_detect_default_branch", return_value="main")
    seen = []
    mocker.patch.object(cleanup, "_evaluate_worktree", side_effect=lambda wt, *a, **k: seen.append(wt))
    mocker.patch("periscope.panes.list_windows", return_value=[])
    mocker.patch("periscope.store.all_windows", return_value={})
    mocker.patch.object(cleanup, "get_settings", return_value={})

    cleanup.compute_candidates()

    assert seen == ["/r/a", "/r/c"]
