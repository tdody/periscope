"""Tests for periscope.updater — the self-update nag + spawn."""

import subprocess
import time

import pytest

from periscope import config, updater


@pytest.fixture(autouse=True)
def _reset(monkeypatch):
    """updater keeps module-level cache/handle state; reset between tests."""
    monkeypatch.setattr(updater, "_checked_at", 0.0)
    monkeypatch.setattr(updater, "_behind", 0)
    monkeypatch.setattr(updater, "_ahead", 0)
    monkeypatch.setattr(updater, "_target", "")
    monkeypatch.setattr(updater, "_releases", [])
    monkeypatch.setattr(updater, "_proc", None)
    monkeypatch.setattr(updater, "_started_at", 0.0)


# --- check() ---------------------------------------------------------------

CHANGELOG = """# Changelog

## v0.3.0 — 2026-11-01

Third, with **markdown**.

### Detail
- a

## v0.2.0 — 2026-10-28

Second.

## v0.1.0

First.
"""

# A checkout on v0.2.0 with v0.3.0 out: 12 commits behind, nothing local.
RELEASED = {
    "fetch": "",
    "tag": "v0.3.0\nv0.2.0\nv0.1.0",
    "rev-list": "12\t0",
    "show": CHANGELOG,
    "describe": "v0.2.0",
}


def _git_stub(overrides=None):
    """Map first-arg -> stdout over RELEASED. None for anything unlisted."""
    responses = {**RELEASED, **(overrides or {})}

    def fake(*args, **kwargs):
        return responses.get(args[0])

    return fake


def test_check_counts_commits_behind_the_newest_release(monkeypatch):
    monkeypatch.setattr(updater, "_git", _git_stub())
    assert updater.check() == 12
    assert updater.summary()["behind"] == 12
    assert updater.summary()["target"] == "v0.3.0"


def test_check_targets_the_canonical_repos_newest_tag(monkeypatch):
    """Tags come from RELEASES_URL, not the tracked remote, and the count is
    against the newest tag — the same target `bin/periscope update` will
    fast-forward to. A contributor's checkout can track a fork whose main is
    hundreds of commits stale; its tags would never arrive."""
    calls = []

    def fake(*args, **kwargs):
        calls.append(args)
        return _git_stub()(*args)

    monkeypatch.setattr(updater, "_git", fake)
    updater.check()
    fetch = next(c for c in calls if c[0] == "fetch")
    assert updater.RELEASES_URL in fetch
    assert "+refs/tags/v*:refs/tags/v*" in fetch
    rev_list = next(c for c in calls if c[0] == "rev-list")
    assert "v0.3.0...HEAD" in rev_list
    assert ("show", "v0.3.0:CHANGELOG.md") in calls


def test_check_counts_local_commits_ahead(monkeypatch):
    """`ahead` is why the Update button refuses, so the pill has to know it.

    The update fast-forwards to the release, which refuses once the checkout
    carries commits the release doesn't AND the release has moved. Counting
    only `behind` rendered "↑ 10 behind" over a button that could not possibly
    succeed, with the reason nowhere in the UI (the fdy fork: one unpushed
    commit sat on `main` for two weeks while origin moved 10 ahead).
    """
    monkeypatch.setattr(updater, "_git", _git_stub({"rev-list": "10\t1"}))
    assert updater.check() == 10
    assert updater.summary()["ahead"] == 1
    assert updater.status()["ahead"] == 1


def test_check_keeps_last_ahead_when_it_cannot_answer(monkeypatch):
    # Same rule as the count it travels with: a failed probe leaves it standing.
    monkeypatch.setattr(updater, "_git", _git_stub({"rev-list": "4\t2"}))
    updater.check()
    monkeypatch.setattr(updater, "_git", _git_stub({"fetch": None}))
    updater.check(force=True)
    assert updater.summary()["ahead"] == 2


def test_check_records_notes_newer_than_the_running_release(monkeypatch):
    monkeypatch.setattr(updater, "_git", _git_stub())
    updater.check()
    assert updater.status()["releases"] == [
        {"heading": "v0.3.0 — 2026-11-01", "body": "Third, with **markdown**.\n\n### Detail\n- a"},
    ]
    # Popover-only: /api/state's 3s payload must not grow by a changelog.
    assert "releases" not in updater.summary()


def test_check_lists_every_release_when_none_is_behind_head(monkeypatch):
    # A checkout from before the first tag: describe fails, so it's all news.
    monkeypatch.setattr(updater, "_git", _git_stub({"describe": None}))
    updater.check()
    assert [r["heading"] for r in updater.status()["releases"]] == [
        "v0.3.0 — 2026-11-01",
        "v0.2.0 — 2026-10-28",
        "v0.1.0",
    ]


def test_release_notes_stop_on_the_version_not_a_prefix_of_it():
    # v0.1 is not v0.1.0: a heading matches on its whole first word.
    assert len(updater.release_notes(CHANGELOG, "v0.1")) == 3
    assert updater.release_notes(CHANGELOG, "v0.3.0") == []


@pytest.mark.parametrize(
    "broken",
    [
        {"fetch": None},
        # The count answered, the changelog read didn't: count refreshes, notes stand.
        {"rev-list": "3\t0", "show": None},
    ],
)
def test_check_keeps_last_notes_when_it_cannot_answer(monkeypatch, broken):
    monkeypatch.setattr(updater, "_git", _git_stub())
    updater.check()
    monkeypatch.setattr(updater, "_git", _git_stub(broken))
    updater.check(force=True)
    assert [r["heading"] for r in updater.status()["releases"]] == ["v0.3.0 — 2026-11-01"]


def test_check_is_throttled(monkeypatch):
    calls = []

    def fake(*args, **kwargs):
        calls.append(args[0])
        return _git_stub()(*args)

    monkeypatch.setattr(updater, "_git", fake)
    assert updater.check() == 12
    calls.clear()
    # Second call inside CHECK_INTERVAL_S must not fork git at all — the fetch
    # is the expensive part and a stale checkout isn't urgent within the hour.
    assert updater.check() == 12
    assert calls == []


def test_check_force_bypasses_throttle(monkeypatch):
    monkeypatch.setattr(updater, "_git", _git_stub())
    updater.check()
    calls = []

    def fake(*args, **kwargs):
        calls.append(args[0])
        return _git_stub()(*args)

    monkeypatch.setattr(updater, "_git", fake)
    updater.check(force=True)
    assert "fetch" in calls


def test_check_silent_before_the_first_release(monkeypatch):
    # No tag anywhere: nothing to update to, so no pill.
    monkeypatch.setattr(updater, "_git", _git_stub({"tag": ""}))
    assert updater.check() == 0
    assert updater.summary()["behind"] == 0
    assert updater.summary()["target"] == ""


@pytest.mark.parametrize(
    "broken",
    [
        {"fetch": None},  # offline
        {"tag": None},  # tag listing failed
        {"rev-list": ""},  # bad count
        {"rev-list": "9"},  # one-sided count
    ],
)
def test_check_keeps_last_count_when_it_cannot_answer(monkeypatch, broken):
    """A failed probe must LEAVE THE COUNT STANDING, not reset it to 0.

    Publishing 0 would render as "up to date" — the one wrong answer. Going
    offline doesn't make the checkout less behind. Asserts through summary(),
    which is what the pill actually reads; check()'s return value alone would
    pass even if _behind were being clobbered.
    """
    monkeypatch.setattr(updater, "_git", _git_stub({"rev-list": "9\t0"}))
    updater.check()
    assert updater.summary()["behind"] == 9

    monkeypatch.setattr(updater, "_git", _git_stub(broken))
    assert updater.check(force=True) == 9
    assert updater.summary()["behind"] == 9
    assert updater.summary()["target"] == "v0.3.0"


# --- start() ---------------------------------------------------------------


def test_start_refuses_on_dev_instance(monkeypatch):
    # A dev instance runs from a worktree on a feature branch: a fast-forward
    # there would fail, or pull the WRONG branch over live work.
    monkeypatch.setattr(config, "DEV", True)
    with pytest.raises(RuntimeError, match="prod-only"):
        updater.start()


class LiveProc:
    pid = 999
    killed = False

    def poll(self):
        return None  # still running

    def kill(self):
        self.killed = True


def test_start_refuses_when_already_running(monkeypatch):
    monkeypatch.setattr(config, "PORT", config.PROD_PORT)
    monkeypatch.setattr(config, "DEV", False)
    monkeypatch.setattr(updater, "_proc", LiveProc())
    monkeypatch.setattr(updater, "_started_at", time.time())
    with pytest.raises(RuntimeError, match="already running"):
        updater.start()


def test_start_kills_a_wedged_updater(monkeypatch, tmp_path):
    """A `git pull` blocked on the network would otherwise pin running() true
    forever, 409ing every later attempt until the server restarts — on a box
    that is only ever restarted BY this feature."""
    monkeypatch.setattr(config, "PORT", config.PROD_PORT)
    monkeypatch.setattr(config, "DEV", False)
    monkeypatch.setattr(updater, "log_path", lambda: tmp_path / "update.log")
    wedged = LiveProc()
    monkeypatch.setattr(updater, "_proc", wedged)
    monkeypatch.setattr(updater, "_started_at", time.time() - updater.STALE_PROC_S - 1)
    assert updater.running() is False  # past the cap, so no longer "live"

    monkeypatch.setattr(subprocess, "Popen", lambda argv, **kw: LiveProc())
    updater.start()  # must not raise
    assert wedged.killed is True


def test_start_spawns_detached(monkeypatch, tmp_path):
    """The load-bearing detail: the updater calls `launchctl bootout`, which
    tears down the launchd job. Without start_new_session the child is in that
    job's process group and gets killed by the teardown it just requested."""
    monkeypatch.setattr(config, "PORT", config.PROD_PORT)
    monkeypatch.setattr(config, "DEV", False)
    monkeypatch.setattr(updater, "log_path", lambda: tmp_path / "update.log")
    seen = {}

    class FakeProc:
        pid = 4242

        def poll(self):
            return None

    def fake_popen(argv, **kwargs):
        seen["argv"] = argv
        seen["kwargs"] = kwargs
        return FakeProc()

    monkeypatch.setattr(subprocess, "Popen", fake_popen)
    updater.start()

    assert seen["kwargs"]["start_new_session"] is True
    assert seen["argv"][1] == "update"
    assert seen["argv"][0].endswith("bin/periscope")
    # stdin detached too: the child outlives its parent's terminal.
    assert seen["kwargs"]["stdin"] is subprocess.DEVNULL


def test_running_false_after_exit(monkeypatch):
    class DeadProc:
        def poll(self):
            return 1

    monkeypatch.setattr(updater, "_proc", DeadProc())
    monkeypatch.setattr(updater, "_started_at", time.time())
    assert updater.running() is False


def test_summary_does_not_deadlock_on_the_hot_path(monkeypatch):
    """_LOCK is a plain Lock and summary() rides every 3s /api/state poll, so
    a re-entrant acquire would hang the whole dashboard, not just this call."""
    monkeypatch.setattr(updater, "_proc", LiveProc())
    monkeypatch.setattr(updater, "_started_at", time.time())
    assert updater.summary()["running"] is True


# --- status()/summary() ----------------------------------------------------


def test_summary_touches_no_disk(monkeypatch):
    """summary() rides every 3s /api/state poll; the log tail belongs to the
    on-demand probe only."""
    monkeypatch.setattr(updater, "tail", lambda *a, **k: pytest.fail("read disk"))
    assert "log" not in updater.summary()


def test_status_includes_log(monkeypatch, tmp_path):
    p = tmp_path / "update.log"
    p.write_text("working tree is dirty — commit or stash before updating\n")
    monkeypatch.setattr(updater, "log_path", lambda: p)
    assert "dirty" in updater.status()["log"][0]


def test_tail_missing_log_is_empty(monkeypatch, tmp_path):
    monkeypatch.setattr(updater, "log_path", lambda: tmp_path / "nope.log")
    assert updater.tail() == []
