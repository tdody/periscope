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

Installed/removed by `bin/periscope {install-hook,uninstall-hook}`. Registered
with `python3 -I -S` (bin/periscope): the hook runs on whatever `python3` is
first on PATH, which can be the Mac's /usr/bin/python3 (3.9) — so this file
stays 3.9-compatible (`from __future__ import annotations`, no `match`
statements, no bare `X | Y` at runtime) and avoids a site/venv it doesn't own.
"""

from __future__ import annotations

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
    "  match_key   TEXT,"
    "  created_at  REAL NOT NULL"
    ")"
)
_INDEX = "CREATE INDEX IF NOT EXISTS idx_pane_permissions_pane ON pane_permissions (pane_id, created_at)"

_KEEP_S = 86400  # a dialog left open longer than a day is not a banner's business
_SUMMARY_MAX = 80
# The dialog names these by file (relative to the cwd); the banner shows the path.
_FILE_TOOLS = ("Edit", "Write", "NotebookEdit")
# Bidi overrides/isolates, zero-width marks and other invisible formatting
# controls: invisible in the dialog but can reorder or hide characters (the
# trojan-source pattern — https://trojansource.codes/), so a summary or
# match_key built from them could read as something other than what Allow
# actually approves. Written with \u escapes, never the raw characters, for
# the same reason a linter flags the raw ones. Mirrored by panes.py's squash
# — tests assert the two sets agree — and stripped before anything else
# touches the text.
_HIDDEN_RE = re.compile("[\\u00ad\\u061c\\u180e\\u200b-\\u200f\\u202a-\\u202e\\u2060\\u2066-\\u2069\\ufeff]")

# Tools whose dialog can be checked for an exact match before Allow fires
# (routes/pane_actions.py, panes.dialog_matches). Mirrored in periscope/panes.py
# — this constant must stay in sync with it (tests/test_panes.py asserts the
# two agree) — because the hook runs on bare `python3` and can't import
# periscope. Everything else (NotebookEdit, WebFetch, MCP tools, …) has no
# verifiable on-screen match, so it gets no Allow.
VERIFIABLE_TOOLS = ("Bash", "Edit", "Write")


def _squash(text: str) -> str:
    """ALL whitespace and hidden controls removed (not just collapsed): the
    exact-match key, paired with the same squash of the parsed dialog block in
    panes.dialog_matches. Squashing (not collapsing) means a wrapped line in
    the dialog still equals the unwrapped command here — the price is losing
    whitespace-only differences, an accepted limit (match_key's docstring)."""
    return re.sub(r"\s+", "", _HIDDEN_RE.sub("", text))


def match_key(tool_name: str, tool_input: object) -> str | None:
    """What Allow must find verbatim on screen before it fires
    (panes.dialog_matches), or None when the tool's dialog can't be verified
    (anything outside VERIFIABLE_TOOLS) or there's nothing to key on.

    Bash: a sha256 digest of the squashed command + description — not the
    text itself, since a command can carry secrets/tokens and periscope.db is
    0644. The screen side hashes its own squashed block the same way and
    compares digests, so the match is exactly as strict as comparing the text
    would be; a stored key that's merely a PREFIX of the block (Task 1's
    `git push origin main` matching `... --force`) still can't match, because
    a different-length block hashes to a different digest.
    Edit/Write: the absolute path, kept in the clear (unclipped) — the
    dialog's shown-path suffix check needs the real string, and paths don't
    wrap inside the question line, so squashing would only hide a real
    difference.

    Accepted limit, shared with the screen side: squashing drops
    whitespace-only differences and the boundary between command and
    description (`rm -rf / tmp/x` and `rm -rf /tmp/x` squash the same). The
    single pending-request-per-pane rule and the request id narrow this to a
    non-issue in practice."""
    if tool_name not in VERIFIABLE_TOOLS:
        return None
    if not isinstance(tool_input, dict):
        return None
    if tool_name == "Bash":
        block = _squash(str(tool_input.get("command") or "")) + _squash(str(tool_input.get("description") or ""))
        return "sha256:" + hashlib.sha256(block.encode()).hexdigest() if block else None
    # Edit / Write, the only tools left after the VERIFIABLE_TOOLS gate above.
    path = _HIDDEN_RE.sub("", str(tool_input.get("file_path") or ""))
    return path or None


def _clip(text: str, keep_end: bool = False) -> str:
    """Hidden bidi/zero-width characters stripped, whitespace collapsed (so a
    multi-line command still fits in one line), at most _SUMMARY_MAX
    characters. Display only, for the banner's body — whether Allow actually
    fires is match_key's job (panes.dialog_matches), not this. A path keeps
    its end so the banner still shows the filename when the directory is
    long."""
    s = re.sub(r"\s+", " ", _HIDDEN_RE.sub("", text)).strip()
    if len(s) <= _SUMMARY_MAX:
        return s
    return "…" + s[1 - _SUMMARY_MAX :] if keep_end else s[: _SUMMARY_MAX - 1] + "…"


def summarize(tool: str, tool_input: object) -> str:
    """What the dialog asks about, in a few words, for the banner's body —
    display only; see match_key for what actually gates Allow."""
    if not isinstance(tool_input, dict):
        return ""
    if tool == "Bash":
        # The WHOLE command, not just its first line: a banner that only
        # showed "cd /tmp" for "cd /tmp && rm -rf build" would mislead
        # whoever Touch-IDs against it.
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
    agent_id = payload.get("agent_id")
    agent_id = str(agent_id) if agent_id else None
    now = time.time()
    base = os.environ.get("XDG_CONFIG_HOME") or os.path.expanduser("~/.config")
    db = os.path.join(base, "periscope", "periscope.db")
    os.makedirs(os.path.dirname(db), exist_ok=True)
    # `timeout` is a wait BUDGET, not a hard limit: SQLite's busy-wait can run
    # well past it under contention (measured: timeout=2.0 actually waited
    # ~5.7s, ~3x nominal) — and Claude kills this hook at 5s. 0.5s keeps the
    # realistic wait under that budget; a row that's missed just degrades the
    # banner to Open-only, never blocks the prompt.
    with contextlib.closing(sqlite3.connect(db, timeout=0.5)) as c, c:
        c.execute(_SCHEMA)
        # An existing DB predates match_key: ALTER it in, or every INSERT
        # below fails — silently, since main() swallows everything — forever.
        cols = {row[1] for row in c.execute("PRAGMA table_info(pane_permissions)")}
        if "match_key" not in cols:
            c.execute("ALTER TABLE pane_permissions ADD COLUMN match_key TEXT")
        c.execute(_INDEX)
        c.execute("DELETE FROM pane_permissions WHERE created_at < ?", (now - _KEEP_S,))
        c.execute(
            "INSERT OR IGNORE INTO pane_permissions "
            "(pane_id, session_id, agent_id, request_id, tool, summary, match_key, created_at) "
            "VALUES (?,?,?,?,?,?,?,?)",
            (
                pane,
                sid,
                agent_id,
                request_id(sid, tool, tool_input, now),
                tool,
                summarize(tool, tool_input),
                match_key(tool, tool_input),
                now,
            ),
        )


def main() -> None:
    with contextlib.suppress(Exception):
        record()
    sys.exit(0)


if __name__ == "__main__":
    main()
