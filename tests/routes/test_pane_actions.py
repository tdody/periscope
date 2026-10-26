"""POST /api/pane/permission and /api/pane/reply — the agent-acting banner
buttons. Each re-checks the pane when pressed; these tests pin every refusal,
because a wrong yes approves a tool call nobody saw, and a wrong reply runs in
a shell or picks a dialog option. Nothing here reaches tmux: capture and
_send_to_target are mocked, and the rows are real ones in a per-test DB."""

import re
from collections import deque
from pathlib import Path

import pytest
from fastapi import HTTPException

import pane_permission_hook as hook
from periscope.panes import parse_pane
from periscope.routes import pane_actions

_DIALOGS = Path(__file__).resolve().parent.parent / "fixtures" / "permission_dialogs"
_IDLE = "⏺ Done.\n\n" + "─" * 60 + "\n❯ \n" + "─" * 60 + "\n  ⏵⏵ auto mode on (shift+tab to cycle)\n"
# An idle Claude an unmapped pane still reads as Claude: its status line.
_CLAUDE_ON_SCREEN = "⏺ Done.\n\n❯ \n  17% | ↑30k ↓74 | $0.50 | Opus 4.7 (1M context)\n"
_SHELL = "tom@mac periscope % git status\nnothing to commit, working tree clean\ntom@mac periscope % \n"
_ASK = (
    "─" * 60 + "\nWhich database?\n\n❯ 1. Postgres\n  2. SQLite\n\nEnter to select · ↑/↓ to navigate · Esc to cancel\n"
)
_WAITING = {"state": "needs-input", "waiting_for": "permission prompt"}
_REQUEST = "a1b2c3d4e5f60718"

# The keys the hook stores for each fixture's request (pane_permission_hook.match_key).
_BASH_KEY = hook.match_key("Bash", {"command": "touch probe.txt", "description": "Create empty probe.txt file"})
_MULTILINE_KEY = hook.match_key("Bash", {"command": "touch a.txt\ntouch b.txt", "description": "Create two files"})
_NOTES = "/tmp/probe/notes.md"


def _screen(name: str) -> str:
    return (_DIALOGS / name).read_text()


def _row(act, request_id=_REQUEST, tool="Bash", key=_BASH_KEY, summary="touch probe.txt", created_at=999.4, pane="%9"):
    """A row as pane_permission_hook.py writes it."""
    with act._LOCK:
        c = act._conn()
        c.execute(
            "INSERT INTO pane_permissions "
            "(pane_id, session_id, agent_id, request_id, tool, summary, match_key, created_at) "
            "VALUES (?,?,?,?,?,?,?,?)",
            (pane, "sid-1", None, request_id, tool, summary, key, created_at),
        )
        c.commit()


@pytest.fixture(autouse=True)
def _fresh_answers(monkeypatch):
    # The answered-once memory is module state; each test starts with none.
    monkeypatch.setattr(pane_actions, "_ANSWERED", deque(maxlen=256))


@pytest.fixture
def pane(mocker):
    """A live Claude pane ab12cd34 (%9, s:4) that has waited on a permission
    prompt since t=1000, showing the Bash dialog. Returns the _send_to_target
    spy."""
    window = {"session": "s", "index": 4, "pane_id": "%9", "current_command": "claude.exe"}
    mocker.patch.object(pane_actions, "window_by_pid", return_value=("ab12cd34", "%9", window))
    mocker.patch.object(pane_actions, "session_id_for_pane", return_value="sid-1")
    mocker.patch.object(pane_actions, "session_state_for", return_value=dict(_WAITING))
    mocker.patch.object(pane_actions, "needs_since_for", return_value=1000)
    mocker.patch.object(pane_actions, "capture", return_value=_screen("bash.txt"))
    return mocker.patch.object(pane_actions, "_send_to_target", return_value={"ok": True})


def _permission(client, **body):
    return client.post("/api/pane/permission", json={"pid": "ab12cd34", "request_id": _REQUEST, **body})


def _reply(client, text="Postgres, please"):
    return client.post("/api/pane/reply", json={"pid": "ab12cd34", "text": text})


# --- /api/pane/permission: the presses that go through ------------------------


@pytest.mark.parametrize(("choice", "keys"), [("allow", ["1"]), ("deny", ["Escape"])])
def test_permission_sends_the_choices_key(client, pane, fresh_activity_db, choice, keys):
    _row(fresh_activity_db)
    r = _permission(client, choice=choice)
    assert r.status_code == 200, r.text
    assert r.json() == {"ok": True}
    pane.assert_called_once_with("s:4", None, keys)
    # Looked up by the pane the pid resolves to now, never by the banner's target.
    pane_actions.session_id_for_pane.assert_called_with("%9")
    pane_actions.needs_since_for.assert_called_with("ab12cd34")
    pane_actions.capture.assert_called_with("s:4")


@pytest.mark.parametrize(
    ("fixture", "tool", "key"),
    [
        ("bash.txt", "Bash", _BASH_KEY),
        ("bash_narrow.txt", "Bash", _BASH_KEY),
        ("bash_multiline.txt", "Bash", _MULTILINE_KEY),
        # The dialog names notes.md; the hook stored the absolute path.
        ("write.txt", "Write", _NOTES),
        ("edit.txt", "Edit", _NOTES),
    ],
)
def test_allow_answers_each_dialog_its_row_names(client, pane, fresh_activity_db, mocker, fixture, tool, key):
    _row(fresh_activity_db, tool=tool, key=key)
    mocker.patch.object(pane_actions, "capture", return_value=_screen(fixture))
    r = _permission(client, choice="allow")
    assert r.status_code == 200, r.text
    pane.assert_called_once_with("s:4", None, ["1"])


def test_the_keys_pane_actions_sends_fit_the_dialogs_options():
    # `1` is Yes in every dialog; No's number moves (4 for Bash, 3 for Write),
    # so Deny is Escape, which the footer offers.
    assert pane_actions._PERMISSION_KEYS == {"allow": ["1"], "deny": ["Escape"]}
    for name, no in (("bash.txt", 4), ("write.txt", 3)):
        screen = _screen(name)
        assert re.search(r"^\s*❯ 1\. Yes\s*$", screen, re.M), name
        assert re.search(rf"^\s*{no}\. No\s*$", screen, re.M), name
        footer = [line for line in screen.splitlines() if line.strip()][-1]
        assert footer.strip().startswith("Esc to cancel"), name


# --- /api/pane/permission: refusals before anything is read --------------------


def test_permission_rejects_any_other_choice(client, pane, fresh_activity_db):
    _row(fresh_activity_db)
    r = _permission(client, choice="always")
    assert r.status_code == 400
    pane.assert_not_called()


def test_permission_404s_for_a_pane_that_is_gone(client, pane, fresh_activity_db, mocker):
    _row(fresh_activity_db)
    mocker.patch.object(pane_actions, "window_by_pid", return_value=("", "", {}))
    assert _permission(client, choice="allow").status_code == 404
    pane.assert_not_called()


@pytest.mark.parametrize("headers", [{}, {"content-type": "text/plain"}], ids=["no-type", "text-plain"])
def test_permission_refuses_a_body_that_is_not_json(client, pane, fresh_activity_db, headers):
    # A POST without a JSON content type is a CORS simple request: any page could send it.
    _row(fresh_activity_db)
    body = f'{{"pid": "ab12cd34", "request_id": "{_REQUEST}", "choice": "allow"}}'
    r = client.post("/api/pane/permission", content=body, headers=headers)
    assert r.status_code == 415
    pane.assert_not_called()


# --- /api/pane/permission: the row must still be this request ------------------


def test_permission_409s_on_a_different_request(client, pane, fresh_activity_db):
    _row(fresh_activity_db, request_id="ffff000000000000")
    assert _permission(client, choice="allow").status_code == 409
    pane.assert_not_called()


@pytest.mark.parametrize(
    "sess",
    [
        {"state": "working", "waiting_for": None},
        {"state": "idle", "waiting_for": None},
        {"state": "needs-input", "waiting_for": "approve AskUserQuestion"},
        None,
    ],
    ids=["working", "idle", "another-dialog", "no-live-session"],
)
def test_permission_409s_unless_the_session_waits_on_a_permission_prompt(client, pane, fresh_activity_db, mocker, sess):
    # The dialog is still on screen in each case; the session file says otherwise (or nothing).
    _row(fresh_activity_db)
    mocker.patch.object(pane_actions, "session_state_for", return_value=sess)
    assert _permission(client, choice="allow").status_code == 409
    pane.assert_not_called()


def test_permission_409s_when_no_poll_has_seen_the_pane_waiting(client, pane, fresh_activity_db, mocker):
    _row(fresh_activity_db)
    mocker.patch.object(pane_actions, "needs_since_for", return_value=0)
    assert _permission(client, choice="allow").status_code == 409
    pane.assert_not_called()


@pytest.mark.parametrize(
    "rows",
    [
        # Parallel tool calls, or back-to-back prompts inside one poll: can't be told apart.
        [{"request_id": _REQUEST}, {"request_id": "b2b2b2b2b2b2b2b2", "created_at": 999.8}],
        # The row is from an earlier wait.
        [{"created_at": 990.0}],
        # Another pane's row.
        [{"pane": "%8"}],
        # A tool whose dialog can't be verified gets no key, so no Allow.
        [{"tool": "WebFetch", "key": None, "summary": "https://example.com"}],
    ],
    ids=["two-rows", "earlier-wait", "another-pane", "no-match-key"],
)
def test_permission_409s_unless_exactly_one_keyed_row_falls_in_this_wait(client, pane, fresh_activity_db, rows):
    for row in rows:
        _row(fresh_activity_db, **row)
    assert _permission(client, choice="allow").status_code == 409
    pane.assert_not_called()


def test_a_request_is_answered_once(client, pane, fresh_activity_db):
    # A second press (the banner and the rail card, a double click) could pass
    # every check before Claude redraws, and its key would land on whatever is
    # up next.
    _row(fresh_activity_db)
    assert _permission(client, choice="allow").status_code == 200
    assert _permission(client, choice="allow").status_code == 409
    assert _permission(client, choice="deny").status_code == 409
    pane.assert_called_once_with("s:4", None, ["1"])


def test_a_failed_send_is_not_retried_from_a_banner(client, pane, fresh_activity_db):
    # The key may or may not have gone in; the retry's 409 reveals the pane instead.
    _row(fresh_activity_db)
    pane.side_effect = HTTPException(500, "tmux: no such window")
    assert _permission(client, choice="allow").status_code == 500
    pane.side_effect = None
    assert _permission(client, choice="allow").status_code == 409
    assert pane.call_count == 1


# --- /api/pane/permission: the screen must show exactly that request ----------


@pytest.mark.parametrize(
    ("tool", "key"),
    [
        # A stale row for another command: another fixture's key, then a made-up one.
        ("Bash", _MULTILINE_KEY),
        ("Bash", hook.match_key("Bash", {"command": "rm -rf build", "description": "Clean the build"})),
        # The same command, described differently.
        ("Bash", hook.match_key("Bash", {"command": "touch probe.txt", "description": "Make a file"})),
        # A file tool's row against a Bash dialog, whose command mentions the file.
        ("Write", "/tmp/probe/probe.txt"),
    ],
    ids=["other-fixture", "other-command", "other-description", "file-tool-row"],
)
def test_permission_409s_when_the_screen_shows_another_request(client, pane, fresh_activity_db, tool, key):
    _row(fresh_activity_db, tool=tool, key=key)
    assert _permission(client, choice="allow").status_code == 409
    pane.assert_not_called()


@pytest.mark.parametrize(
    ("fixture", "tool", "key"),
    [
        ("write.txt", "Edit", _NOTES),
        ("edit.txt", "Write", _NOTES),
        ("write.txt", "Write", "/tmp/probe/old-notes.md"),
        ("write.txt", "Write", "/tmp/probe/docs/other.md"),
    ],
    ids=["edit-row-on-write", "write-row-on-edit", "no-slash-boundary", "other-file"],
)
def test_permission_409s_when_a_file_dialog_is_for_another_tool_or_file(
    client, pane, fresh_activity_db, mocker, fixture, tool, key
):
    _row(fresh_activity_db, tool=tool, key=key)
    mocker.patch.object(pane_actions, "capture", return_value=_screen(fixture))
    assert _permission(client, choice="allow").status_code == 409
    pane.assert_not_called()


def test_permission_never_takes_the_tool_or_key_from_the_caller(client, pane, fresh_activity_db):
    # The row is for rm; a body naming the dialog's own tool and key changes nothing.
    _row(fresh_activity_db, key=hook.match_key("Bash", {"command": "rm -rf build"}))
    r = _permission(client, choice="allow", tool="Bash", match_key=_BASH_KEY, summary="touch probe.txt")
    assert r.status_code == 409
    pane.assert_not_called()


@pytest.mark.parametrize("screen", [_IDLE, _ASK, _SHELL], ids=["idle", "ask-user-question", "shell"])
def test_permission_409s_when_no_permission_dialog_is_on_screen(client, pane, fresh_activity_db, mocker, screen):
    _row(fresh_activity_db)
    mocker.patch.object(pane_actions, "capture", return_value=screen)
    assert _permission(client, choice="allow").status_code == 409
    pane.assert_not_called()


def test_permission_500s_and_sends_nothing_when_the_pane_cannot_be_read(client, pane, fresh_activity_db, mocker):
    _row(fresh_activity_db)
    mocker.patch.object(pane_actions, "capture", side_effect=RuntimeError("can't find pane"))
    assert _permission(client, choice="allow").status_code == 500
    pane.assert_not_called()


# --- /api/pane/reply -----------------------------------------------------------


@pytest.fixture
def idle(mocker):
    """The pane is an idle Claude: a live session, nothing open on screen."""
    mocker.patch.object(pane_actions, "session_state_for", return_value={"state": "idle", "waiting_for": None})
    mocker.patch.object(pane_actions, "capture", return_value=_IDLE)


def test_reply_pastes_then_enters(client, pane, idle):
    r = _reply(client, "  Postgres, please  ")
    assert r.status_code == 200, r.text
    assert r.json() == {"ok": True}
    pane.assert_called_once_with("s:4", "Postgres, please", ["Enter"])


def test_reply_goes_to_a_working_agent(client, pane, mocker):
    # Claude queues a message typed while it works; Ask agent to fix relies on it.
    mocker.patch.object(pane_actions, "session_state_for", return_value={"state": "working", "waiting_for": None})
    mocker.patch.object(pane_actions, "capture", return_value=_IDLE)
    assert _reply(client).status_code == 200
    pane.assert_called_once()


def test_reply_goes_to_an_unmapped_pane_showing_claude(client, pane, mocker):
    assert parse_pane(_CLAUDE_ON_SCREEN)["agent"] == "claude"
    mocker.patch.object(pane_actions, "session_state_for", return_value=None)
    mocker.patch.object(pane_actions, "capture", return_value=_CLAUDE_ON_SCREEN)
    assert _reply(client).status_code == 200
    pane.assert_called_once_with("s:4", "Postgres, please", ["Enter"])


def test_reply_rejects_empty_text(client, pane, idle):
    assert _reply(client, "   ").status_code == 400
    pane.assert_not_called()


def test_reply_404s_for_a_pane_that_is_gone(client, pane, idle, mocker):
    mocker.patch.object(pane_actions, "window_by_pid", return_value=("", "", {}))
    assert _reply(client, "hi").status_code == 404
    pane.assert_not_called()


@pytest.mark.parametrize("headers", [{}, {"content-type": "text/plain"}], ids=["no-type", "text-plain"])
def test_reply_refuses_a_body_that_is_not_json(client, pane, idle, headers):
    r = client.post("/api/pane/reply", content='{"pid": "ab12cd34", "text": "hi"}', headers=headers)
    assert r.status_code == 415
    pane.assert_not_called()


@pytest.mark.parametrize("waiting_for", ["approve AskUserQuestion", "permission prompt", None])
def test_reply_409s_while_the_session_waits_on_something(client, pane, mocker, waiting_for):
    # waitingFor is best-effort: a wait without one is still a wait.
    mocker.patch.object(
        pane_actions, "session_state_for", return_value={"state": "needs-input", "waiting_for": waiting_for}
    )
    mocker.patch.object(pane_actions, "capture", return_value=_IDLE)
    assert _reply(client, "1 sounds good").status_code == 409
    pane.assert_not_called()


@pytest.mark.parametrize(
    "screen",
    [_ASK, _screen("bash.txt"), _screen("write.txt"), "Something new\n\n  Esc to cancel\n"],
    ids=["choice-footer", "bash-dialog", "write-dialog", "unknown-dialog"],
)
@pytest.mark.parametrize("sess", [None, {"state": "idle", "waiting_for": None}], ids=["unmapped", "lagging-session"])
def test_reply_409s_on_a_dialog_on_screen(client, pane, mocker, screen, sess):
    # The session file can lag or be missing (an unmapped pane); the screen can't.
    mocker.patch.object(pane_actions, "session_state_for", return_value=sess)
    mocker.patch.object(pane_actions, "capture", return_value=screen)
    assert _reply(client, "1 sounds good").status_code == 409
    pane.assert_not_called()


def test_reply_409s_on_a_pane_not_running_an_agent(client, pane, mocker):
    # A press can come long after the banner: the agent may have exited to its shell.
    mocker.patch.object(pane_actions, "session_state_for", return_value=None)
    mocker.patch.object(pane_actions, "capture", return_value=_SHELL)
    r = _reply(client)
    assert r.status_code == 409
    assert "isn't running an agent" in r.json()["detail"]
    pane.assert_not_called()


@pytest.mark.parametrize("foreground", ["zsh", "-zsh", "bash"])
def test_reply_409s_when_a_shell_is_in_the_foreground(client, pane, idle, mocker, foreground):
    # A Claude suspended with ctrl+z is still a live claude with a session file;
    # the prompt taking input is the shell's.
    window = {"session": "s", "index": 4, "pane_id": "%9", "current_command": foreground}
    mocker.patch.object(pane_actions, "window_by_pid", return_value=("ab12cd34", "%9", window))
    assert _reply(client).status_code == 409
    pane.assert_not_called()


def test_reply_500s_and_sends_nothing_when_the_pane_cannot_be_read(client, pane, idle, mocker):
    mocker.patch.object(pane_actions, "capture", side_effect=RuntimeError("can't find pane"))
    assert _reply(client).status_code == 500
    pane.assert_not_called()


def _composer(prompt_row: str) -> str:
    """An idle Claude 2.1.280 screen as capture -e returns it: a past prompt
    (drawn white on grey, so it reads as typed) and its answer in scrollback,
    then the composer row between its rules."""
    rule = "─" * 60
    past = "\x1b[38;2;80;80;80m\x1b[48;2;55;55;55m❯ \x1b[38;2;255;255;255mWhich database should we use?\x1b[39m\x1b[49m"
    return f"{past}\n\n⏺ Postgres or SQLite?\n\n{rule}\n{prompt_row}\n{rule}\n  ⏵⏵ auto mode on (shift+tab to cycle)\n"


@pytest.mark.parametrize(
    "prompt_row",
    [
        # A draft is drawn in the default fg, like the ❯ (2.1.280).
        "\x1b[39m❯\xa0half a thought",
        # A paste placeholder is grey like a suggestion, but it is the draft.
        "\x1b[39m❯\xa0\x1b[38;5;240m[Pasted text #1 +40 lines]\x1b[39m",
    ],
    ids=["draft", "pasted-block"],
)
def test_reply_409s_on_a_half_typed_draft(client, pane, idle, mocker, prompt_row):
    # The paste would be appended to the draft, and Enter would submit both.
    mocker.patch.object(pane_actions, "capture", return_value=_composer(prompt_row))
    r = _reply(client)
    assert r.status_code == 409
    assert r.json()["detail"] == "the pane has a half-typed draft — finish or clear it first"
    pane.assert_not_called()


@pytest.mark.parametrize(
    "prompt_row",
    [
        "\x1b[39m❯\xa0",
        # Claude's suggestion, dim (SGR 2), as live 2.1.280 panes draw it.
        '\x1b[39m❯\xa0\x1b[2mtry "how does the poll loop work"\x1b[0m',
    ],
    ids=["empty", "suggestion"],
)
def test_reply_goes_to_an_empty_composer(client, pane, idle, mocker, prompt_row):
    mocker.patch.object(pane_actions, "capture", return_value=_composer(prompt_row))
    assert _reply(client).status_code == 200
    pane.assert_called_once_with("s:4", "Postgres, please", ["Enter"])
