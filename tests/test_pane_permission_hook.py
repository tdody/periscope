"""pane_permission_hook.py — the PermissionRequest recorder behind a banner's
Allow / Deny — and its registration by `bin/periscope install-claude-hook`.

Whatever a PermissionRequest hook prints is read as its decision on the
dialog, so the subprocess tests pin the one property that matters most: it
prints nothing and exits 0, whatever it's fed."""

import io
import json
import os
import sqlite3
import subprocess
import sys
import time
from pathlib import Path

import pane_permission_hook as hook

REPO = Path(__file__).resolve().parent.parent
SCRIPT = REPO / "pane_permission_hook.py"


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
    with sqlite3.connect(db) as c:
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
    # A path keeps its end: the dialog is matched on the basename.
    long_path = hook.summarize("Write", {"file_path": "/very" * 40 + "/notes.md"})
    assert len(long_path) == 80 and long_path.startswith("…") and long_path.endswith("/notes.md")


def test_bash_summary_is_the_whole_multiline_command():
    # The banner's screen check strips all whitespace, so a summary spanning
    # lines still matches a dialog that wraps the same command.
    assert hook.summarize("Bash", {"command": "cd /tmp\nrm -rf build"}) == "cd /tmp rm -rf build"
    long_cmd = hook.summarize("Bash", {"command": "echo a\n" + "b " * 100})
    assert len(long_cmd) == 80 and long_cmd.endswith("…")


def test_summary_strips_bidi_and_zero_width_controls():
    hidden = "‮rm​ -rf‌ /‍‎‏﻿"
    assert hook.summarize("Bash", {"command": hidden}) == "rm -rf /"
    assert hook.summarize("WebFetch", {"url": "https://x⁦.example⁩.com"}) == "https://x.example.com"


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


def test_rows_older_than_a_day_are_pruned_on_insert(tmp_path, monkeypatch):
    monkeypatch.setenv("XDG_CONFIG_HOME", str(tmp_path))
    monkeypatch.setenv("TMUX_PANE", "%56")
    monkeypatch.setattr("sys.stdin", io.StringIO(_payload()))
    hook.record()
    db = tmp_path / "periscope" / "periscope.db"
    with sqlite3.connect(db) as c:
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


def _run_hook(stdin: str, xdg: Path, pane: str = "%9") -> subprocess.CompletedProcess:
    return subprocess.run(
        [sys.executable, str(SCRIPT)],
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


def _periscope(home: Path, *args: str) -> subprocess.CompletedProcess:
    # HOME redirects both ~/.claude and the state.json the account list comes from.
    return subprocess.run(
        ["sh", str(REPO / "bin" / "periscope"), *args],
        text=True,
        capture_output=True,
        env={**os.environ, "HOME": str(home)},
        timeout=60,
    )


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
    assert entry["command"].startswith("python3 ")
    assert Path(entry["command"].split(" ", 1)[1]).resolve() == SCRIPT
    # Idempotent.
    _periscope(tmp_path, "install-claude-hook")
    assert json.loads(settings.read_text())["hooks"]["PermissionRequest"] == groups

    r = _periscope(tmp_path, "uninstall-claude-hook")
    assert r.returncode == 0, r.stderr
    assert json.loads(settings.read_text())["hooks"]["PermissionRequest"] == [mine]
