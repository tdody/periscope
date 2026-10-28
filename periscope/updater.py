"""Self-update: how far behind the newest release the checkout is, and
driving the update.

See docs/updating.md for the design and why a plain `git pull` + `restart` is
not equivalent. The invariants that live in THIS file:

- `start()` spawns DETACHED (`start_new_session=True`). The script calls
  `launchctl bootout`, which tears down the launchd job — a plain child would
  be killed mid-update by the very teardown it requested.
- Both entry points are prod-only. A dev instance runs from a worktree on a
  feature branch, where a pull would clobber work in progress.
"""

import re
import subprocess
import threading
import time
from pathlib import Path

from periscope import config
from periscope.log import log

# Hourly. The check forks a `git fetch`, so it is not free, and a checkout
# that is 40 commits behind does not become urgent within the hour.
CHECK_INTERVAL_S = 3600

# An updater still alive past this is wedged, not working: the script's own
# worst case is ~5 min (bootout wait + bootstrap retries + healthz poll) plus
# the pull. Without a cap, one hung `git pull` pins running() true forever and
# every later attempt 409s until the server restarts — days, on a box that is
# only ever restarted BY this feature.
STALE_PROC_S = 15 * 60

# Releases are `v*` tags on the canonical repo, fetched from it directly
# rather than from whatever remote `main` tracks: a contributor's checkout may
# track a fork whose main sat 898 commits stale. Must match RELEASES_URL in
# bin/periscope — the two sides must agree on the target, or the pill arms a
# button that installs something else.
RELEASES_URL = "https://github.com/tomplex/periscope.git"

_LOCK = threading.Lock()
_checked_at = 0.0
_behind = 0
_ahead = 0
_target = ""
_releases: list[dict] = []
_proc: subprocess.Popen | None = None
_started_at = 0.0


def log_path() -> Path:
    return config.config_dir() / "update.log"


def _git(*args: str, timeout: float = 10.0) -> str | None:
    """Run git in the checkout. None on any failure — every caller treats a
    failed probe as 'no update information', never as an error worth raising."""
    try:
        out = subprocess.run(
            ["git", "-C", str(config.REPO_ROOT), *args],
            capture_output=True,
            text=True,
            timeout=timeout,
        )
    except (subprocess.SubprocessError, OSError):
        return None
    return out.stdout.strip() if out.returncode == 0 else None


def release_notes(changelog: str, current: str | None) -> list[dict]:
    """CHANGELOG.md's `## vX.Y.Z …` sections newer than `current`, newest
    first. `current` absent from the file (or None — no release behind HEAD)
    means every section is news."""
    out = []
    for chunk in re.split(r"^## ", changelog, flags=re.M)[1:]:
        heading, _, body = chunk.partition("\n")
        if heading.split()[:1] == [current]:
            break
        out.append({"heading": heading.strip(), "body": body.strip()})
    return out


def check(force: bool = False) -> int:
    """Fetch release tags and recount commits behind AND ahead of the newest.
    Throttled to CHECK_INTERVAL_S unless `force`. Blocking — call from a
    worker thread.

    A probe that can't answer LEAVES THE LAST COUNT STANDING rather than
    resetting to zero: going offline doesn't make the checkout less behind, and
    publishing 0 would claim "up to date", which is the one wrong answer.
    """
    global _checked_at, _behind, _ahead, _target, _releases
    with _LOCK:
        if not force and time.time() - _checked_at < CHECK_INTERVAL_S:
            return _behind
        _checked_at = time.time()
        known = _behind
    # Same fetch, same tag choice as `bin/periscope update`, which will
    # fast-forward to exactly this target.
    if _git("fetch", "--quiet", RELEASES_URL, "+refs/tags/v*:refs/tags/v*", timeout=30.0) is None:
        return known  # offline
    target = (_git("tag", "--list", "v*", "--sort=-v:refname") or "").partition("\n")[0]
    if not target:
        return known  # nothing released yet
    # ONE call answers both directions — left = release-only (behind), right =
    # local-only (ahead). Ahead is not decoration: the fast-forward refuses
    # once BOTH counts are non-zero. Counting only `behind` rendered
    # "↑ 10 behind" over a button that could not succeed, with the reason
    # nowhere in the UI.
    counts = (_git("rev-list", "--count", "--left-right", f"{target}...HEAD") or "").split()
    if len(counts) != 2 or not all(c.isdigit() for c in counts):
        return known
    behind, ahead = int(counts[0]), int(counts[1])
    # Notes come from the TARGET's changelog — the checkout's predates them —
    # and stop at the release HEAD is on (describe fails when no release is
    # behind HEAD: then every section is news).
    changelog = _git("show", f"{target}:CHANGELOG.md")
    current = _git("describe", "--tags", "--abbrev=0", "--match", "v*", "HEAD")
    with _LOCK:
        _behind = behind
        _ahead = ahead
        _target = target
        # Same rule as the count: a probe that can't answer leaves the last
        # notes standing.
        if changelog is not None:
            _releases = release_notes(changelog, current)
    return behind


def _running_locked() -> bool:
    """Caller must hold _LOCK. A spawned updater counts as running only until
    STALE_PROC_S — past that it is wedged, and treating it as live would 409
    every future attempt forever."""
    if _proc is None or _proc.poll() is not None:
        return False
    return time.time() - _started_at < STALE_PROC_S


def running() -> bool:
    """True while a spawned updater is live. Naturally self-clearing: a
    SUCCESSFUL update kills this process, so the replacement boots with no
    handle and a changed SHA. A FAILED update leaves the handle here, exited,
    with the reason in the log."""
    with _LOCK:
        return _running_locked()


def summary() -> dict:
    """The nag, without the log. Rides on every /api/state poll (3s), so it
    must stay allocation-cheap and touch no disk.

    Reads everything under ONE acquire — `_LOCK` is a plain Lock, so calling
    the public `running()` from inside the block would self-deadlock the
    hottest endpoint in the app.
    """
    with _LOCK:
        return {
            "behind": _behind,
            "ahead": _ahead,
            "target": _target,
            "checked_at": _checked_at,
            "running": _running_locked(),
        }


def status() -> dict:
    """summary() plus the release notes the update would bring and the
    current run's transcript — for the on-demand /api/update/status probe (the
    popover opening, the post-click watch), the only callers that need
    either."""
    log_tail = tail()  # disk read stays outside the lock
    with _LOCK:
        return {
            "behind": _behind,
            "ahead": _ahead,
            "target": _target,
            "checked_at": _checked_at,
            "running": _running_locked(),
            "releases": list(_releases),
            "log": log_tail,
        }


def tail(limit: int = 40) -> list[str]:
    try:
        lines = log_path().read_text(errors="replace").splitlines()
    except OSError:
        return []
    return lines[-limit:]


def start() -> None:
    """Spawn the detached updater. Raises RuntimeError if this instance must
    not self-update or one is already in flight."""
    global _proc, _started_at
    # Prod-only. A dev instance runs from a worktree on a feature branch, where
    # a fast-forward would either fail or pull the WRONG branch over the
    # work in progress. (`bin/periscope update` refuses from a worktree too —
    # this gate and that one are independent, since the script is also a
    # user-facing verb.)
    if not config.is_prod():
        raise RuntimeError("self-update is prod-only (this is a dev instance)")
    with _LOCK:
        if _running_locked():
            raise RuntimeError("an update is already running")
        # Past STALE_PROC_S but still alive = wedged (a `git pull` blocked on
        # the network). Kill it before spawning, or two updaters race on the
        # same checkout and launchd job.
        if _proc is not None and _proc.poll() is None:
            log.warning("killing wedged updater (pid %d)", _proc.pid)
            _proc.kill()
        script = config.REPO_ROOT / "bin" / "periscope"
        log_path().parent.mkdir(parents=True, exist_ok=True)
        # Truncate: the log is the CURRENT run's transcript, which is what
        # status() reports back to a dashboard asking "why did that fail?".
        handle = log_path().open("w")
        try:
            _proc = subprocess.Popen(
                [str(script), "update"],
                cwd=str(config.REPO_ROOT),
                stdout=handle,
                stderr=subprocess.STDOUT,
                stdin=subprocess.DEVNULL,
                start_new_session=True,  # survive the bootout it will trigger
            )
        finally:
            handle.close()  # the child holds its own dup
        _started_at = time.time()
        log.info("self-update started (pid %d)", _proc.pid)
