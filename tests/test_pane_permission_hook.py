"""pane_permission_hook.py — the PermissionRequest recorder behind a banner's
Allow / Deny — and its registration by `bin/periscope install-claude-hook`.

A PermissionRequest hook's JSON stdout is read as its decision on the dialog,
so the subprocess tests pin the one property that matters most: it prints
nothing and exits 0, whatever it's fed."""

import contextlib
import hashlib
import io
import json
import os
import shlex
import sqlite3
import subprocess
import sys
import time
from pathlib import Path

import pytest

import pane_permission_hook as hook

REPO = Path(__file__).resolve().parent.parent
SCRIPT = REPO / "pane_permission_hook.py"

# The full set _HIDDEN_RE strips, as code points — not \u string literals,
# so this file carries no raw bidi/zero-width bytes and no backslash-u text
# that could itself be misread. Mirrored by panes.py's squash;
# tests/test_panes.py (fa77a5e) asserts the two sets, and VERIFIABLE_TOOLS,
# agree.
_HIDDEN_CODEPOINTS = (
    0x00AD,
    0x061C,
    0x180E,
    0x200B,
    0x200C,
    0x200D,
    0x200E,
    0x200F,
    0x202A,
    0x202B,
    0x202C,
    0x202D,
    0x202E,
    0x2060,
    0x2066,
    0x2067,
    0x2068,
    0x2069,
    0xFEFF,
)


def _salted(text: str) -> str:
    """`text` with every hidden control spliced in once, mid-string."""
    half = len(text) // 2
    hidden = "".join(chr(c) for c in _HIDDEN_CODEPOINTS)
    return text[:half] + hidden + text[half:]


def _bash_key(squashed: str) -> str:
    return "sha256:" + hashlib.sha256(squashed.encode()).hexdigest()


def _payload(tool="Bash", tool_input=None, **extra) -> str:
    return json.dumps(
        {
            "session_id": "sess-1",
            "transcript_path": "/tmp/t.jsonl",
            "cwd": "/tmp/probe",
            "permission_mode": "default",
            "hook_event_name": "PermissionRequest",
            "tool_name": tool,
            "tool_input": {"command": "touch probe.txt"} if tool_input is None else tool_input,
            "permission_suggestions": [],
            **extra,
        }
    )


def _rows(db: Path) -> list[tuple]:
    with contextlib.closing(sqlite3.connect(db)) as c, c:
        return c.execute(
            "SELECT pane_id, session_id, agent_id, request_id, tool, summary FROM pane_permissions"
        ).fetchall()


def test_summary_per_tool():
    # Whole command, not just its first line: Allow approves all of it.
    assert hook.summarize("Bash", {"command": "  git status\n  && rm -rf build"}) == "git status && rm -rf build"
    assert hook.summarize("Bash", {"command": "echo   a\tb"}) == "echo a b"
    assert hook.summarize("Edit", {"file_path": "/r/src/app.py", "old_string": "x"}) == "/r/src/app.py"
    assert hook.summarize("Write", {"file_path": "/r/notes.md", "content": "hello"}) == "/r/notes.md"
    assert hook.summarize("NotebookEdit", {"notebook_path": "/r/a.ipynb", "new_source": "x"}) == "/r/a.ipynb"
    assert (
        hook.summarize("WebFetch", {"url": "https://example.com/a", "prompt": "summarise"}) == "https://example.com/a"
    )
    assert hook.summarize("mcp__linear__save_issue", {"team": 3, "title": " Fix  it ", "x": "y"}) == "Fix it"
    assert hook.summarize("Bash", "not a dict") == ""
    assert hook.summarize("Glob", {}) == ""


def test_summary_is_capped_at_80_characters():
    long_cmd = hook.summarize("Bash", {"command": "echo " + "a" * 200})
    assert len(long_cmd) == 80 and long_cmd.endswith("…")
    # A path keeps its end, so the banner still shows the filename.
    long_path = hook.summarize("Write", {"file_path": "/very" * 40 + "/notes.md"})
    assert len(long_path) == 80 and long_path.startswith("…") and long_path.endswith("/notes.md")


def test_bash_summary_is_the_whole_multiline_command():
    # Display only: a banner that only showed the first line of a multi-line
    # command would mislead whoever Touch-IDs against it.
    assert hook.summarize("Bash", {"command": "cd /tmp\nrm -rf build"}) == "cd /tmp rm -rf build"
    long_cmd = hook.summarize("Bash", {"command": "echo a\n" + "b " * 100})
    assert len(long_cmd) == 80 and long_cmd.endswith("…")


def test_summary_strips_bidi_and_zero_width_controls():
    assert hook.summarize("Bash", {"command": _salted("rm -rf /")}) == "rm -rf /"
    assert hook.summarize("WebFetch", {"url": _salted("https://x.example.com")}) == "https://x.example.com"


def test_match_key_per_tool():
    # The real fixtures' requests (tests/fixtures/permission_dialogs/): the
    # command + description, squashed and hashed.
    assert hook.match_key(
        "Bash", {"command": "touch probe.txt", "description": "Create empty probe.txt file"}
    ) == _bash_key("touchprobe.txtCreateemptyprobe.txtfile")
    assert hook.match_key(
        "Bash", {"command": "touch a.txt\ntouch b.txt", "description": "Create two files"}
    ) == _bash_key("toucha.txttouchb.txtCreatetwofiles")
    # No description: just the squashed command, hashed.
    assert hook.match_key("Bash", {"command": "touch probe.txt"}) == _bash_key("touchprobe.txt")
    # Edit/Write: the absolute path, in the clear (not hashed) and unclipped —
    # the suffix check on the shown path needs the real string.
    assert hook.match_key("Write", {"file_path": "/r/notes.md", "content": "hello"}) == "/r/notes.md"
    assert hook.match_key("Edit", {"file_path": "/r/src/app.py", "old_string": "x"}) == "/r/src/app.py"
    # Unverifiable tools get no key, so they get no Allow.
    assert hook.match_key("NotebookEdit", {"notebook_path": "/r/a.ipynb", "new_source": "x"}) is None
    assert hook.match_key("WebFetch", {"url": "https://example.com/a"}) is None
    assert hook.match_key("mcp__linear__save_issue", {"title": "Fix it"}) is None
    assert hook.match_key("Bash", "not a dict") is None
    # Empty normalises to None, not a hash of the empty string.
    assert hook.match_key("Bash", {}) is None
    assert hook.match_key("Write", {}) is None


def test_match_key_is_none_for_a_sandbox_disabled_bash_request():
    # dangerouslyDisableSandbox isn't keyed (only command + description are),
    # and the dialog may not show it — so an unsandboxed retry of the same
    # command must not match a stale sandboxed row's key. Open-only instead.
    assert hook.match_key("Bash", {"command": "touch probe.txt", "dangerouslyDisableSandbox": True}) is None
    # Falsy/absent: keyed normally.
    assert hook.match_key("Bash", {"command": "touch probe.txt", "dangerouslyDisableSandbox": False}) == _bash_key(
        "touchprobe.txt"
    )


def test_match_key_is_non_none_exactly_for_verifiable_tools():
    tool_input = {"command": "touch probe.txt", "file_path": "/r/notes.md", "description": "d"}
    assert hook.VERIFIABLE_TOOLS == ("Bash", "Edit", "Write")
    for tool in hook.VERIFIABLE_TOOLS:
        assert hook.match_key(tool, tool_input) is not None
    for tool in ("NotebookEdit", "WebFetch", "Glob", "mcp__x__y"):
        assert tool not in hook.VERIFIABLE_TOOLS
        assert hook.match_key(tool, tool_input) is None


def test_match_key_strips_hidden_controls():
    assert hook.match_key("Bash", {"command": _salted("rm -rf /")}) == _bash_key("rm-rf/")
    assert hook.match_key("Write", {"file_path": _salted("/r/notes.md")}) == "/r/notes.md"


def test_request_id_is_16_hex_and_names_one_request():
    rid = hook.request_id("s", "Bash", {"command": "ls"}, 1000.5)
    assert len(rid) == 16 and all(c in "0123456789abcdef" for c in rid)
    # Key order in tool_input doesn't change it; the moment does.
    assert hook.request_id("s", "Bash", {"a": 1, "b": 2}, 1.0) == hook.request_id("s", "Bash", {"b": 2, "a": 1}, 1.0)
    assert rid != hook.request_id("s", "Bash", {"command": "ls"}, 1000.6)


def test_a_row_lands_for_the_pane(tmp_path, monkeypatch):
    monkeypatch.setenv("XDG_CONFIG_HOME", str(tmp_path))
    monkeypatch.setenv("TMUX_PANE", "%56")
    monkeypatch.setattr("sys.stdin", io.StringIO(_payload(agent_id="agent-7")))
    hook.record()
    [(pane, sid, agent, rid, tool, summary)] = _rows(tmp_path / "periscope" / "periscope.db")
    assert (pane, sid, agent, tool, summary) == ("%56", "sess-1", "agent-7", "Bash", "touch probe.txt")
    assert len(rid) == 16


def test_agent_id_is_stored_as_a_string(tmp_path, monkeypatch):
    monkeypatch.setenv("XDG_CONFIG_HOME", str(tmp_path))
    monkeypatch.setenv("TMUX_PANE", "%56")
    monkeypatch.setattr("sys.stdin", io.StringIO(_payload(agent_id=42)))
    hook.record()
    [(_, _, agent, _, _, _)] = _rows(tmp_path / "periscope" / "periscope.db")
    assert agent == "42"


def test_a_row_lands_with_its_match_key(tmp_path, monkeypatch):
    monkeypatch.setenv("XDG_CONFIG_HOME", str(tmp_path))
    monkeypatch.setenv("TMUX_PANE", "%56")
    monkeypatch.setattr(
        "sys.stdin",
        io.StringIO(_payload(tool_input={"command": "touch probe.txt", "description": "Create empty probe.txt file"})),
    )
    hook.record()
    db = tmp_path / "periscope" / "periscope.db"
    with contextlib.closing(sqlite3.connect(db)) as c, c:
        [(key,)] = c.execute("SELECT match_key FROM pane_permissions").fetchall()
    assert key == _bash_key("touchprobe.txtCreateemptyprobe.txtfile")


def test_an_existing_table_without_match_key_gets_the_column_added(tmp_path, monkeypatch):
    monkeypatch.setenv("XDG_CONFIG_HOME", str(tmp_path))
    monkeypatch.setenv("TMUX_PANE", "%56")
    db = tmp_path / "periscope" / "periscope.db"
    db.parent.mkdir(parents=True)
    with contextlib.closing(sqlite3.connect(db)) as c, c:
        c.execute(
            "CREATE TABLE pane_permissions ("
            "  pane_id TEXT NOT NULL,"
            "  session_id TEXT,"
            "  agent_id TEXT,"
            "  request_id TEXT PRIMARY KEY,"
            "  tool TEXT NOT NULL,"
            "  summary TEXT NOT NULL,"
            "  created_at REAL NOT NULL"
            ")"
        )
    monkeypatch.setattr("sys.stdin", io.StringIO(_payload()))
    hook.record()  # must not fail silently against the pre-match_key schema
    with contextlib.closing(sqlite3.connect(db)) as c, c:
        cols = {row[1] for row in c.execute("PRAGMA table_info(pane_permissions)")}
        [(key,)] = c.execute("SELECT match_key FROM pane_permissions").fetchall()
    assert "match_key" in cols
    assert key == _bash_key("touchprobe.txt")


def test_rows_older_than_a_day_are_pruned_on_insert(tmp_path, monkeypatch):
    monkeypatch.setenv("XDG_CONFIG_HOME", str(tmp_path))
    monkeypatch.setenv("TMUX_PANE", "%56")
    monkeypatch.setattr("sys.stdin", io.StringIO(_payload()))
    hook.record()
    db = tmp_path / "periscope" / "periscope.db"
    with contextlib.closing(sqlite3.connect(db)) as c, c:
        c.execute("UPDATE pane_permissions SET created_at = ?", (time.time() - 2 * 86400,))
    monkeypatch.setattr("sys.stdin", io.StringIO(_payload(tool_input={"command": "ls"})))
    hook.record()
    assert [r[5] for r in _rows(db)] == ["ls"]


def test_no_tmux_pane_writes_nothing(tmp_path, monkeypatch):
    monkeypatch.setenv("XDG_CONFIG_HOME", str(tmp_path))
    monkeypatch.delenv("TMUX_PANE", raising=False)
    monkeypatch.setattr("sys.stdin", io.StringIO(_payload()))
    hook.record()
    assert not (tmp_path / "periscope" / "periscope.db").exists()


def _run_hook(stdin: str, xdg: Path, pane: str = "%9", python: str = sys.executable) -> subprocess.CompletedProcess:
    # -I -S: exactly what bin/periscope registers (isolated, stdlib only).
    return subprocess.run(
        [python, "-I", "-S", str(SCRIPT)],
        input=stdin,
        text=True,
        capture_output=True,
        env={**os.environ, "TMUX_PANE": pane, "XDG_CONFIG_HOME": str(xdg)},
        timeout=30,
    )


def test_the_hook_prints_nothing_and_exits_0_when_it_records(tmp_path):
    r = _run_hook(_payload(), tmp_path)
    assert (r.returncode, r.stdout, r.stderr) == (0, "", "")
    assert len(_rows(tmp_path / "periscope" / "periscope.db")) == 1


def test_the_hook_prints_nothing_and_exits_0_on_garbage(tmp_path):
    for stdin in ("{", "[]", "null", "", '{"tool_name": "Bash"}'):
        r = _run_hook(stdin, tmp_path)
        assert (r.returncode, r.stdout, r.stderr) == (0, "", ""), stdin


def test_the_hook_prints_nothing_and_exits_0_on_an_unwritable_db(tmp_path):
    (tmp_path / "periscope").write_text("a file where the config dir should be")
    r = _run_hook(_payload(), tmp_path)
    assert (r.returncode, r.stdout, r.stderr) == (0, "", "")


def test_the_hook_runs_under_the_system_python3_when_present(tmp_path):
    # bin/periscope registers this with a bare `python3` (-I -S, stdlib only),
    # which on a Mac can resolve to /usr/bin/python3 (3.9) rather than this
    # repo's uv-managed interpreter — every prompt would get a hook-error
    # notice and no row if the file didn't stay 3.9-compatible.
    system_python3 = "/usr/bin/python3"
    if not os.path.exists(system_python3):
        pytest.skip("no /usr/bin/python3 on this machine")
    r = _run_hook(_payload(), tmp_path, python=system_python3)
    assert (r.returncode, r.stdout, r.stderr) == (0, "", "")
    assert len(_rows(tmp_path / "periscope" / "periscope.db")) == 1


def _periscope(home: Path, *args: str) -> subprocess.CompletedProcess:
    # HOME redirects both ~/.claude and the state.json the account list comes from.
    return subprocess.run(
        ["sh", str(REPO / "bin" / "periscope"), *args],
        text=True,
        capture_output=True,
        env={**os.environ, "HOME": str(home)},
        timeout=60,
    )


def _entry_script_path(command: str) -> Path:
    assert command.startswith("python3 -I -S ")
    # `|| true` trails the registered command (fail-open), so there can be
    # more than one token left once the fixed prefix is stripped.
    path, *_rest = shlex.split(command[len("python3 -I -S ") :])
    return Path(path)


def test_install_registers_permission_request_for_every_tool_and_uninstall_removes_it(tmp_path):
    claude = tmp_path / ".claude"
    claude.mkdir()
    settings = claude / "settings.json"
    mine = {"matcher": "Bash", "hooks": [{"type": "command", "command": "mine.sh"}]}
    settings.write_text(json.dumps({"hooks": {"PermissionRequest": [mine]}}))

    r = _periscope(tmp_path, "install-claude-hook")
    assert r.returncode == 0, r.stderr
    groups = json.loads(settings.read_text())["hooks"]["PermissionRequest"]
    # The user's Bash-only group is left alone and not joined: it would narrow ours to Bash.
    assert groups[0] == mine
    assert groups[1]["matcher"] == ""
    [entry] = groups[1]["hooks"]
    assert entry["timeout"] == 5
    # -I -S: stdlib-only, so this runs even under a bare /usr/bin/python3 with
    # no venv or site/sitecustomize poisoning it.
    assert _entry_script_path(entry["command"]).resolve() == SCRIPT
    # Idempotent.
    _periscope(tmp_path, "install-claude-hook")
    assert json.loads(settings.read_text())["hooks"]["PermissionRequest"] == groups

    r = _periscope(tmp_path, "uninstall-claude-hook")
    assert r.returncode == 0, r.stderr
    assert json.loads(settings.read_text())["hooks"]["PermissionRequest"] == [mine]


def test_install_joins_a_group_whose_matcher_is_star(tmp_path):
    claude = tmp_path / ".claude"
    claude.mkdir()
    settings = claude / "settings.json"
    settings.write_text(json.dumps({"hooks": {"PermissionRequest": [{"matcher": "*", "hooks": []}]}}))

    r = _periscope(tmp_path, "install-claude-hook")
    assert r.returncode == 0, r.stderr
    groups = json.loads(settings.read_text())["hooks"]["PermissionRequest"]
    # "*" (like None or "") means "every tool": joined, not duplicated into a
    # second, "" matcher group.
    assert len(groups) == 1
    assert groups[0]["matcher"] == "*"
    assert len(groups[0]["hooks"]) == 1


def test_install_repoints_a_stale_path(tmp_path):
    claude = tmp_path / ".claude"
    claude.mkdir()
    settings = claude / "settings.json"
    stale = {
        # /old/checkout doesn't exist on disk: this is the "repoint" case —
        # the entry's target is actually gone, so rewriting it is safe.
        "matcher": "",
        "hooks": [{"type": "command", "command": "python3 -I -S /old/checkout/pane_permission_hook.py", "timeout": 5}],
    }
    settings.write_text(json.dumps({"hooks": {"PermissionRequest": [stale]}}))

    r = _periscope(tmp_path, "install-claude-hook")
    assert r.returncode == 0, r.stderr
    groups = json.loads(settings.read_text())["hooks"]["PermissionRequest"]
    # Repointed in place, not appended as a second entry: re-running install
    # from a different checkout (a worktree, say) must not leave the old path
    # dangling alongside the new one.
    assert len(groups) == 1
    [entry] = groups[0]["hooks"]
    assert "/old/checkout/" not in entry["command"]
    assert _entry_script_path(entry["command"]).resolve() == SCRIPT


def test_install_does_not_repoint_a_live_target_at_another_checkout(tmp_path):
    claude = tmp_path / ".claude"
    claude.mkdir()
    other_checkout = tmp_path / "other-checkout"
    other_checkout.mkdir()
    (other_checkout / "pane_permission_hook.py").write_text("# a live checkout, not this one\n")
    settings = claude / "settings.json"
    live_command = f"python3 -I -S {other_checkout / 'pane_permission_hook.py'} || true"
    live = {"matcher": "", "hooks": [{"type": "command", "command": live_command, "timeout": 5}]}
    settings.write_text(json.dumps({"hooks": {"PermissionRequest": [live]}}))

    r = _periscope(tmp_path, "install-claude-hook")
    assert r.returncode == 0, r.stderr
    groups = json.loads(settings.read_text())["hooks"]["PermissionRequest"]
    # The existing entry's target still resolves (prod's, or another
    # worktree's, live checkout): installing from HERE must never hijack it —
    # removing THIS worktree later would otherwise leave that other pane's
    # hook pointing at a dead path, blocking every prompt there (exit 2 on
    # UserPromptSubmit).
    assert len(groups) == 1
    [entry] = groups[0]["hooks"]
    assert entry["command"] == live_command


def test_install_rewrites_an_entry_for_this_same_checkout_to_the_current_form(tmp_path):
    claude = tmp_path / ".claude"
    claude.mkdir()
    settings = claude / "settings.json"
    # The old form: no `|| true`, this worktree's own real path. Running
    # install-hook from main after this merges must move an entry like this
    # (prod's, say) onto the current fail-open form, not leave it alone just
    # because it already resolves.
    old_form = f"python3 {REPO / 'pane_session_hook.py'}"
    mine = {"matcher": "", "hooks": [{"type": "command", "command": old_form, "timeout": 5}]}
    settings.write_text(json.dumps({"hooks": {"SessionStart": [mine]}}))

    r = _periscope(tmp_path, "install-claude-hook")
    assert r.returncode == 0, r.stderr
    groups = json.loads(settings.read_text())["hooks"]["SessionStart"]
    assert len(groups) == 1
    [entry] = groups[0]["hooks"]
    assert entry["command"] == old_form + " || true"

    # Idempotent.
    _periscope(tmp_path, "install-claude-hook")
    assert json.loads(settings.read_text())["hooks"]["SessionStart"] == groups


def test_install_entries_fail_open_and_uninstall_still_finds_them(tmp_path):
    claude = tmp_path / ".claude"
    claude.mkdir()
    settings = claude / "settings.json"
    settings.write_text(json.dumps({"hooks": {}}))

    r = _periscope(tmp_path, "install-claude-hook")
    assert r.returncode == 0, r.stderr
    hooks = json.loads(settings.read_text())["hooks"]
    # pane_session_hook.py (SessionStart/UserPromptSubmit) and
    # pane_permission_hook.py (PermissionRequest) are pure observers: a
    # missing file must still exit 0, since Claude treats a nonzero
    # UserPromptSubmit as BLOCKING the prompt.
    for ev in ("SessionStart", "UserPromptSubmit", "PermissionRequest"):
        [entry] = hooks[ev][0]["hooks"]
        assert entry["command"].endswith(" || true")
    # The history indexer (SessionEnd) doesn't gate a prompt, so it's plain.
    [hist_entry] = hooks["SessionEnd"][0]["hooks"]
    assert not hist_entry["command"].endswith(" || true")

    r = _periscope(tmp_path, "uninstall-claude-hook")
    assert r.returncode == 0, r.stderr
    # The marker substring match still finds each entry despite the
    # trailing " || true", so uninstall removes all four, leaving nothing.
    assert json.loads(settings.read_text()).get("hooks", {}) == {}


def _table_shape(c: sqlite3.Connection) -> tuple[list, list]:
    return (
        c.execute("PRAGMA table_info(pane_permissions)").fetchall(),
        c.execute("PRAGMA index_info(idx_pane_permissions_pane)").fetchall(),
    )


def test_the_hook_and_the_server_create_the_same_table(tmp_path, fresh_activity_db):
    # Whichever opens periscope.db first creates pane_permissions.
    with contextlib.closing(sqlite3.connect(tmp_path / "hook.db")) as c:
        c.execute(hook._SCHEMA)
        c.execute(hook._INDEX)
        hook_shape = _table_shape(c)
    with fresh_activity_db._LOCK:
        server_shape = _table_shape(fresh_activity_db._conn())
    assert hook_shape == server_shape
    assert "match_key" in {col[1] for col in server_shape[0]}


# pane_permissions as the first hook release created it, before match_key.
_PRE_MATCH_KEY_DDL = (
    "CREATE TABLE pane_permissions ("
    "  pane_id TEXT NOT NULL, session_id TEXT, agent_id TEXT, request_id TEXT PRIMARY KEY,"
    "  tool TEXT NOT NULL, summary TEXT NOT NULL, created_at REAL NOT NULL"
    ")"
)


def test_the_hook_and_the_server_heal_a_pre_match_key_table_the_same_way(tmp_path, monkeypatch, fresh_activity_db):
    # Whichever opens an older periscope.db first adds the column; either way
    # the other must find the shape it would have made.
    monkeypatch.setenv("XDG_CONFIG_HOME", str(tmp_path / "xdg"))
    monkeypatch.setenv("TMUX_PANE", "%56")
    hook_db = tmp_path / "xdg" / "periscope" / "periscope.db"
    hook_db.parent.mkdir(parents=True)
    server_db = fresh_activity_db.config.ACTIVITY_DB
    for db in (hook_db, server_db):
        with contextlib.closing(sqlite3.connect(db)) as c, c:
            c.execute(_PRE_MATCH_KEY_DDL)
    monkeypatch.setattr("sys.stdin", io.StringIO(_payload()))
    hook.record()
    with contextlib.closing(sqlite3.connect(hook_db)) as c:
        hook_shape = _table_shape(c)
    with fresh_activity_db._LOCK:
        server_shape = _table_shape(fresh_activity_db._conn())
    assert hook_shape == server_shape
    assert "match_key" in {col[1] for col in server_shape[0]}
