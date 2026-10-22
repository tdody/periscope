"""Per-repo threading.Lock registry.

`git worktree add` is not atomic with branch creation; concurrent
spawns against the same repo race. The coarse store._STATE_LOCK is
too coarse — it would serialize unrelated state writes during a slow
git operation. Instead, every git-mutating verb acquires a lock
keyed on the repo's realpath.

This module is used by phase 2+ verbs (new project, new worktree-tab,
PR review, cleanup). Phase 1 doesn't itself call any git-mutating
verb, but introduces the infrastructure so later phases don't
re-invent it.

The same registry holds a second, separate namespace: `open_lock`, the
per-dir create-or-focus lock of open_ops.
"""

import contextlib
import os
import threading

_REGISTRY_LOCK = threading.Lock()
_LOCKS: dict[tuple[str, str], threading.Lock] = {}


def _key(repo_path: str) -> str:
    """Canonicalize a repo path to its registry key."""
    return os.path.realpath(repo_path)


def _lock_for(namespace: str, path: str) -> threading.Lock:
    key = (namespace, _key(path))
    with _REGISTRY_LOCK:
        lock = _LOCKS.get(key)
        if lock is None:
            lock = threading.Lock()
            _LOCKS[key] = lock
    return lock


@contextlib.contextmanager
def repo_lock(repo_path: str):
    """Hold the per-repo lock for the duration of the `with` block.

    Nested acquisition of the SAME repo by the SAME thread will
    deadlock — these are non-reentrant. Callers should hold the lock
    only across the git mutation itself, not surrounding state work.

    Multiple concurrent operations on DIFFERENT repos run in parallel.
    """
    with _lock_for("repo", repo_path):
        yield


@contextlib.contextmanager
def open_lock(pinned_dir: str):
    """Hold the create-or-focus lock for one dir (open_ops._open_path).

    Its own namespace rather than repo_lock(dir): a main checkout's dir IS
    its repo, so sharing would queue an open behind an unrelated `git
    worktree add`, and deadlock (non-reentrant) the day the open path takes
    the repo lock itself. Non-reentrant too; opens of different dirs run in
    parallel.
    """
    with _lock_for("open", pinned_dir):
        yield
