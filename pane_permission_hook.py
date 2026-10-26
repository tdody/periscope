#!/usr/bin/env python3
"""periscope permission recorder — Claude `PermissionRequest` hook.

Records which tool call a pane's permission dialog asks about, so a native
banner can offer Allow / Deny for exactly that request
(window_view.pending_permission_for publishes it; routes/pane_actions.py
answers it). Claude runs the hook before the dialog renders, so the row is
there by the time periscope sees the pane waiting.

It only observes. Whatever a PermissionRequest hook prints is read as its
decision on the dialog, so this one prints NOTHING, swallows every failure and
always exits 0: a broken hook must never answer, or block, a prompt. The
payload carries no tool_use_id, so a request is named by a hash of what it
asks and when (`request_id`).

Writes one row into `pane_permissions` in
<XDG_CONFIG_HOME|~/.config>/periscope/periscope.db, opening its own short-lived
connection as pane_session_hook.py does, and prunes rows older than a day. A
pane without TMUX_PANE writes nothing.

Installed/removed by `bin/periscope {install-hook,uninstall-hook}`.
"""

import contextlib
import hashlib
import json
import os
import re
import sqlite3
import sys
import time

# Same DDL as periscope/activity.py's _SCHEMA: whichever opens the DB first
# creates the table (tests/test_pane_permission_hook.py checks they agree).
_SCHEMA = (
    "CREATE TABLE IF NOT EXISTS pane_permissions ("
    "  pane_id     TEXT NOT NULL,"
    "  session_id  TEXT,"
    "  agent_id    TEXT,"
    "  request_id  TEXT PRIMARY KEY,"
    "  tool        TEXT NOT NULL,"
    "  summary     TEXT NOT NULL,"
    "  created_at  REAL NOT NULL"
    ")"
)
_INDEX = "CREATE INDEX IF NOT EXISTS idx_pane_permissions_pane ON pane_permissions (pane_id, created_at)"

_KEEP_S = 86400  # a dialog left open longer than a day is not a banner's business
_SUMMARY_MAX = 80
# The dialog names these by file (relative to the cwd); the banner shows the path.
_FILE_TOOLS = ("Edit", "Write", "NotebookEdit")
# Bidi overrides/isolates and zero-width marks: invisible in the dialog but can
# reorder or hide characters, so a summary built from them could read as
# something other than what Allow actually approves. Stripped before anything
# else touches the text.
_HIDDEN_RE = re.compile("[​-‏‪-‮⁦-⁩﻿]")


def _clip(text: str, keep_end: bool = False) -> str:
    """Hidden bidi/zero-width characters stripped, whitespace collapsed (so a
    multi-line command still fits in one line), at most _SUMMARY_MAX
    characters. A path keeps its end: routes/pane_actions.py matches a file
    tool's dialog on the basename."""
    s = re.sub(r"\s+", " ", _HIDDEN_RE.sub("", text)).strip()
    if len(s) <= _SUMMARY_MAX:
        return s
    return "…" + s[1 - _SUMMARY_MAX :] if keep_end else s[: _SUMMARY_MAX - 1] + "…"


def summarize(tool: str, tool_input: object) -> str:
    """What the dialog asks about, in a few words, for the banner's body."""
    if not isinstance(tool_input, dict):
        return ""
    if tool == "Bash":
        # The WHOLE command, not just its first line: Allow approves all of
        # it, and the dialog (what the screen check matches against) shows
        # it wrapped across lines, not truncated to the first.
        return _clip(str(tool_input.get("command") or ""))
    if tool in _FILE_TOOLS:
        path = tool_input.get("file_path") or tool_input.get("notebook_path") or ""
        return _clip(str(path), keep_end=True)
    if tool == "WebFetch":
        return _clip(str(tool_input.get("url") or ""))
    return _clip(next((v for v in tool_input.values() if isinstance(v, str) and v.strip()), ""))


def request_id(session_id: str, tool: str, tool_input: object, created_at: float) -> str:
    """The request's name: no tool_use_id reaches this hook, so it's what the
    call asks and when, hashed. 16 hex characters."""
    raw = "\x1f".join((session_id, tool, json.dumps(tool_input, sort_keys=True), repr(created_at)))
    return hashlib.sha1(raw.encode(), usedforsecurity=False).hexdigest()[:16]


def record() -> None:
    pane = os.environ.get("TMUX_PANE", "")
    if not pane.startswith("%"):
        return
    payload = json.load(sys.stdin)
    if not isinstance(payload, dict):
        return
    tool = str(payload.get("tool_name") or "")
    if not tool:
        return
    tool_input = payload.get("tool_input")
    sid = str(payload.get("session_id") or "")
    now = time.time()
    base = os.environ.get("XDG_CONFIG_HOME") or os.path.expanduser("~/.config")
    db = os.path.join(base, "periscope", "periscope.db")
    os.makedirs(os.path.dirname(db), exist_ok=True)
    # `timeout`: periscope may be mid-write; SQLite serialises writers, and
    # the DB is in WAL mode (set by the server), so the wait is short.
    with sqlite3.connect(db, timeout=2.0) as c:
        c.execute(_SCHEMA)
        c.execute(_INDEX)
        c.execute("DELETE FROM pane_permissions WHERE created_at < ?", (now - _KEEP_S,))
        c.execute(
            "INSERT OR IGNORE INTO pane_permissions "
            "(pane_id, session_id, agent_id, request_id, tool, summary, created_at) VALUES (?,?,?,?,?,?,?)",
            (
                pane,
                sid,
                payload.get("agent_id") or None,
                request_id(sid, tool, tool_input, now),
                tool,
                summarize(tool, tool_input),
                now,
            ),
        )


def main() -> None:
    with contextlib.suppress(Exception):
        record()
    sys.exit(0)


if __name__ == "__main__":
    main()
