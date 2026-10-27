"""Tests for /api/pane and /api/rename."""


def _patch(mocker, name, **kwargs):
    for prefix in (f"periscope.routes.pane.{name}", f"server.{name}"):
        try:
            return mocker.patch(prefix, **kwargs)
        except (AttributeError, ModuleNotFoundError):
            continue
    return None


def test_pane_returns_parsed_payload(client, mocker):
    def fake_tmux(*args):
        if args and args[0] == "capture-pane":
            return "$ ls\nfoo bar\n"
        return ""

    _patch(mocker, "tmux", side_effect=fake_tmux)
    _patch(mocker, "pane_meta", return_value=("win-name", "/tmp/proj"))
    _patch(mocker, "parse_pane", return_value={"agent": None, "spinner": None})
    _patch(mocker, "smooth_parsed", side_effect=lambda *, pane_id, parsed: parsed)
    _patch(mocker, "cached_git_state", return_value={"branch": "main"})
    _patch(mocker, "cached_pr_state", return_value={"pr": None})
    _patch(mocker, "cached_pane_activity", return_value=[])
    _patch(mocker, "_attach_git_then_resolve_pids")
    _patch(
        mocker,
        "list_windows",
        return_value=[{"session": "main", "index": 0, "name": "x", "pane_id": "%7", "cwd": "/tmp"}],
    )

    r = client.get("/api/pane?session=main&index=0")
    assert r.status_code == 200
    body = r.json()
    assert body["target"] == "main:0"
    assert body["session"] == "main"
    assert body["name"] == "win-name"
    assert "content" in body


def test_pane_drops_branch_prs_checks_and_base_under_a_linked_pr(client, mocker, clean_state):
    """ci_checks/pr_base describe the branch PR's own state, not the linked
    PR's — this route never looks up the linked PR's state, so it must drop
    them the same way it already drops `ci`."""

    def fake_tmux(*args):
        if args and args[0] == "capture-pane":
            return "$ ls\n"
        return ""

    _patch(mocker, "tmux", side_effect=fake_tmux)
    _patch(mocker, "pane_meta", return_value=("win-name", "/tmp/proj"))
    _patch(mocker, "parse_pane", return_value={"agent": None, "spinner": None})
    _patch(mocker, "smooth_parsed", side_effect=lambda *, pane_id, parsed: parsed)
    _patch(mocker, "cached_git_state", return_value={"branch": "main"})
    _patch(
        mocker,
        "cached_pr_state",
        return_value={
            "pr": 42,
            "ci": "✗",
            "ci_checks": [{"name": "build", "state": "failure"}],
            "pr_base": "main",
        },
    )
    _patch(mocker, "cached_pane_activity", return_value=[])

    def fake_resolve(one):
        one[0]["pid"] = "p9"

    _patch(mocker, "_attach_git_then_resolve_pids", side_effect=fake_resolve)
    _patch(
        mocker,
        "list_windows",
        return_value=[{"session": "main", "index": 0, "name": "x", "pane_id": "%7", "cwd": "/tmp"}],
    )
    clean_state["windows"]["p9"] = {"linked_pr": 1234}

    r = client.get("/api/pane?session=main&index=0")
    assert r.status_code == 200
    body = r.json()
    assert body["pr"] == "1234"
    assert body["pr_linked"] is True
    assert "ci" not in body
    assert "ci_checks" not in body
    assert "pr_base" not in body


def test_pane_derives_the_linear_ticket_its_pr_title_names(client, mocker, clean_state):
    # Same derivation as /api/state (THI-441), for the Inspector's card.
    _patch(mocker, "tmux", return_value="")
    _patch(mocker, "pane_meta", return_value=("win-name", "/tmp/proj"))
    _patch(mocker, "parse_pane", return_value={"agent": "claude", "spinner": None})
    _patch(mocker, "smooth_parsed", side_effect=lambda *, pane_id, parsed: parsed)
    _patch(mocker, "cached_git_state", return_value={"branch": "feature/linear-ticket-from-branch"})
    _patch(mocker, "cached_pr_state", return_value={"pr": 45, "pr_title": "THI-441: show the ticket"})
    _patch(mocker, "cached_pane_activity", return_value=[])
    _patch(mocker, "_attach_git_then_resolve_pids")
    _patch(mocker, "list_windows", return_value=[])

    body = client.get("/api/pane?session=main&index=0").json()
    assert body["linked_linear"] is None
    assert body["linear_ticket"] == "THI-441"
    assert body["linear_ticket_source"] == "pr_title"


def test_rename_sets_name(client, mocker):
    tmux_mock = mocker.MagicMock(return_value="")
    for path in ("periscope.routes.pane.tmux", "server.tmux"):
        try:
            mocker.patch(path, tmux_mock)
            break
        except (AttributeError, ModuleNotFoundError):
            continue

    r = client.post(
        "/api/rename?session=main&index=0",
        json={"name": "fresh-name"},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is True
    assert body["name"] == "fresh-name"
    assert any(c.args and c.args[0] == "rename-window" and "fresh-name" in c.args for c in tmux_mock.call_args_list)


def test_rename_pins_the_name(client, mocker, clean_state):
    """A name Tom typed locks the narrator out permanently, not for
    RENAME_COOLDOWN_S — the cooldown expired unnoticed and the name drifted."""
    from periscope import narrator, store

    _patch(mocker, "tmux", return_value="")
    _patch(mocker, "window_identity", return_value=("p9", "%7", "@3"))

    r = client.post("/api/rename?session=main&index=0", json={"name": "pit-orchestrator"})
    assert r.status_code == 200
    assert r.json()["name_pinned"] is True
    assert store.get_window("p9")["name_pinned"] is True
    assert narrator.is_name_pinned({"pid": "p9", "name": "pit-orchestrator"})


def test_rename_of_an_unstamped_window_reports_no_pin(client, mocker, clean_state):
    """No @periscope_id means nothing to hang the pin on. The rename still
    applies; the response says so rather than implying a lock that isn't there."""
    _patch(mocker, "tmux", return_value="")
    _patch(mocker, "window_identity", return_value=("", "%7", "@3"))

    r = client.post("/api/rename?session=main&index=0", json={"name": "fresh"})
    assert r.status_code == 200
    assert r.json()["name_pinned"] is False


def test_name_pin_toggles(client, clean_state):
    from periscope import store

    assert client.post("/api/name-pin", json={"pid": "p9", "pinned": True}).status_code == 200
    assert store.get_window("p9")["name_pinned"] is True

    r = client.post("/api/name-pin", json={"pid": "p9", "pinned": False})
    assert r.status_code == 200
    assert r.json()["name_pinned"] is False
    # Unpinned is stored as absence, not False — no third state to reason about.
    assert "name_pinned" not in store.get_window("p9")


def test_name_pin_rejects_empty_pid(client, clean_state):
    r = client.post("/api/name-pin", json={"pid": "  ", "pinned": True})
    assert r.status_code == 400


def test_rename_rejects_empty(client, mocker):
    for path in ("periscope.routes.pane.tmux", "server.tmux"):
        try:
            mocker.patch(path, return_value="")
            break
        except (AttributeError, ModuleNotFoundError):
            continue
    r = client.post("/api/rename?session=main&index=0", json={"name": "   "})
    assert r.status_code == 400
    assert "empty" in r.json()["detail"]


def test_pane_turns_returns_messages_end_to_end(client, mocker, tmp_path, monkeypatch):
    # Exercise route -> get_turns_for_pane -> messages_from_jsonl against a real
    # tmp transcript (the Q1-2026 mocked-migration lesson: don't mock the path
    # the bug would live in). Only the tmux boundary and the session lookup are faked.
    import json

    import periscope.activity as activity

    cwd = "/Users/tom/dev/turnsproj"
    enc = tmp_path / activity._encode_cwd(cwd)
    enc.mkdir(parents=True)
    (enc / "sid-9.jsonl").write_text(
        json.dumps(
            {
                "type": "user",
                "sessionId": "sid-9",
                "cwd": cwd,
                "timestamp": "2026-06-01T10:00:00.000Z",
                "uuid": "u1",
                "parentUuid": None,
                "message": {"role": "user", "content": "hi there"},
            }
        )
        + "\n"
    )
    monkeypatch.setattr(activity, "_PROJECTS_DIR", tmp_path)
    mocker.patch("periscope.turns.tmux", return_value=f"%9\t{cwd}")
    mocker.patch("periscope.turns.session_id_for_pane", return_value="sid-9")

    r = client.get("/api/pane/turns?session=main&index=0")
    assert r.status_code == 200
    body = r.json()
    assert body["session_id"] == "sid-9"
    assert body["messages"][0]["text"] == "hi there"


def test_pane_turns_null_when_no_transcript(client, mocker, tmp_path, monkeypatch):
    import periscope.activity as activity

    monkeypatch.setattr(activity, "_PROJECTS_DIR", tmp_path)  # empty -> no match
    mocker.patch("periscope.turns.tmux", return_value="%9\t/no/such/cwd")
    mocker.patch("periscope.turns.session_id_for_pane", return_value=None)
    r = client.get("/api/pane/turns?session=main&index=0")
    assert r.status_code == 200
    assert r.json() == {"turns": None}


def test_tabs_open_close_activate_roundtrip(client, clean_state, mocker):
    mocker.patch("periscope.store._write_state")

    r = client.post("/api/pane/tabs/open", json={"pid": "p1", "path": "/a/b.md", "line": 3})
    assert r.status_code == 200
    assert r.json() == {
        "ok": True,
        "open_tabs": [{"path": "/a/b.md", "line": 3}],
        "active_tab": "file:/a/b.md",
    }

    r = client.post("/api/pane/tabs/activate", json={"pid": "p1", "tab": "pane"})
    assert r.status_code == 200
    assert r.json() == {"ok": True, "active_tab": "pane"}

    r = client.post("/api/pane/tabs/close", json={"pid": "p1", "path": "/a/b.md"})
    assert r.status_code == 200
    assert r.json() == {"ok": True, "open_tabs": [], "active_tab": "pane"}
    assert clean_state["windows"]["p1"] == {}


def test_tabs_open_rejects_blank_fields(client):
    r = client.post("/api/pane/tabs/open", json={"pid": " ", "path": "/a/b.md"})
    assert r.status_code == 400
    r = client.post("/api/pane/tabs/open", json={"pid": "p1", "path": ""})
    assert r.status_code == 400


def test_rename_stamps_narrator_cooldown(client, mocker):
    def fake_tmux(*args):
        if args[0] == "display-message":
            return "%5\n"
        return ""

    mocker.patch("periscope.routes.pane.tmux", side_effect=fake_tmux)
    stamp = mocker.patch("periscope.routes.pane.stamp_pane_rename")

    r = client.post("/api/rename?session=main&index=0", json={"name": "my-name"})
    assert r.status_code == 200
    stamp.assert_called_once()
    args, kwargs = stamp.call_args
    assert args[0] == "%5"
    assert kwargs["name"] == "my-name"
    assert isinstance(kwargs["at"], int)


# --- per-pane model / effort (POST /api/pane/session-setting) -------------------
# Types `/model x` or `/effort x` into a live Claude pane. The gate is the whole
# feature's safety: keystrokes into a busy pane land mid-turn, and into a pane
# with a half-typed message they get appended to the user's draft.

_WINDOW = {"session": "periscope", "index": 4, "pid_raw": "abc123"}


def _patch_live_pane(mocker, *, parsed=None, sess_state="idle", after="⎿  Set effort level to high"):
    """`after` is what Claude prints under the echoed command — the endpoint
    reads it back to tell applied / needs-confirmation / refused apart."""
    from periscope.routes import pane as pane_route

    mocker.patch.object(pane_route, "_resolve_window_by_pid", return_value=("abc123", "%7", dict(_WINDOW)))
    sent: list[str] = []

    def fake_capture(_target):
        if not sent:
            return "ignored"  # the pre-send readiness read (parse_pane is mocked)
        return f"older output\n❯\xa0{sent[-1]}\n  {after}\n❯\xa0\n"

    mocker.patch.object(pane_route, "capture", side_effect=fake_capture)
    mocker.patch.object(pane_route.time, "sleep")
    mocker.patch.object(pane_route, "_OUTCOME_WAIT_S", 0.05)
    mocker.patch.object(
        pane_route, "parse_pane", return_value=parsed or {"agent": "claude", "state": "idle", "pending_input": None}
    )
    mocker.patch.object(pane_route, "session_id_for_pane", return_value="sid-1")
    mocker.patch.object(pane_route, "session_state_for", return_value={"state": sess_state} if sess_state else None)
    mocker.patch.object(pane_route, "pane_claude_pids", return_value={"%7": 4242})
    return mocker.patch.object(
        pane_route, "_send_to_target", side_effect=lambda t, cmd, keys: sent.append(cmd) or {"ok": True}
    )


def test_session_setting_types_the_slash_command_into_an_idle_pane(client, mocker, clean_state):
    from periscope.store import get_window

    send = _patch_live_pane(mocker)
    r = client.post("/api/pane/session-setting?pid=abc123&setting=effort&value=high")
    assert r.status_code == 200, r.text
    assert r.json()["sent"] == "/effort high"
    assert r.json()["result"] == "applied"
    send.assert_called_once_with("periscope:4", "/effort high", ["Enter"])
    # Remembered, because Claude reports effort nowhere periscope can read —
    # tied to the claude process it was typed into, so a fresh session in the
    # same pane doesn't inherit the label.
    assert get_window("abc123")["session_effort"] == {"value": "high", "claude_pid": 4242}


def test_session_setting_sets_the_model(client, mocker, clean_state):
    from periscope.store import get_window

    send = _patch_live_pane(
        mocker, after="⎿  Set model to Opus 5.5 (1M context) and saved as your default for new sessions"
    )
    r = client.post("/api/pane/session-setting?pid=abc123&setting=model&value=opus%5B1m%5D")
    assert r.status_code == 200, r.text
    send.assert_called_once_with("periscope:4", "/model opus[1m]", ["Enter"])
    assert get_window("abc123")["session_model"] == {"value": "opus[1m]", "claude_pid": 4242}


def test_session_setting_maps_default_effort_to_auto(client, mocker, clean_state):
    # The pickers say "default"; Claude's word for "the model's own effort" is auto.
    send = _patch_live_pane(mocker, after="⎿  Effort level set to auto")
    r = client.post("/api/pane/session-setting?pid=abc123&setting=effort&value=default")
    assert r.status_code == 200, r.text
    send.assert_called_once_with("periscope:4", "/effort auto", ["Enter"])


def test_session_setting_refuses_a_busy_pane(client, mocker, clean_state):
    send = _patch_live_pane(mocker, sess_state="working")
    r = client.post("/api/pane/session-setting?pid=abc123&setting=effort&value=high")
    assert r.status_code == 409
    assert "working" in r.json()["detail"]
    send.assert_not_called()


def test_session_setting_refuses_a_pane_waiting_on_a_prompt(client, mocker, clean_state):
    send = _patch_live_pane(mocker, sess_state="needs-input")
    r = client.post("/api/pane/session-setting?pid=abc123&setting=model&value=sonnet")
    assert r.status_code == 409
    send.assert_not_called()


def test_session_setting_refuses_when_the_user_has_a_draft(client, mocker, clean_state):
    send = _patch_live_pane(mocker, parsed={"agent": "claude", "state": "idle", "pending_input": "half a thought"})
    r = client.post("/api/pane/session-setting?pid=abc123&setting=effort&value=high")
    assert r.status_code == 409
    assert "unsent" in r.json()["detail"]
    send.assert_not_called()


def test_session_setting_falls_back_to_the_scraped_state(client, mocker, clean_state):
    # No session-status file (unmapped pane): the scraped state decides.
    send = _patch_live_pane(
        mocker, sess_state=None, parsed={"agent": "claude", "state": "working", "pending_input": None}
    )
    r = client.post("/api/pane/session-setting?pid=abc123&setting=effort&value=high")
    assert r.status_code == 409
    send.assert_not_called()


def test_session_setting_refuses_a_non_claude_pane(client, mocker, clean_state):
    send = _patch_live_pane(mocker, sess_state=None, parsed={"agent": None, "state": "shell", "pending_input": None})
    r = client.post("/api/pane/session-setting?pid=abc123&setting=effort&value=high")
    assert r.status_code == 409
    assert "Claude" in r.json()["detail"]
    send.assert_not_called()


def test_session_setting_rejects_unknown_values(client, mocker, clean_state):
    send = _patch_live_pane(mocker)
    for q in (
        "setting=effort&value=ultracode",
        "setting=effort&value=HIGH",
        "setting=model&value=opus%20%26%26%20rm",
        "setting=model&value=auto",
        "setting=color&value=red",
    ):
        r = client.post(f"/api/pane/session-setting?pid=abc123&{q}")
        assert r.status_code in (400, 422), (q, r.status_code)
    send.assert_not_called()


def test_session_setting_404s_an_unknown_pid(client, mocker, clean_state):
    from periscope.routes import pane as pane_route

    mocker.patch.object(pane_route, "_resolve_window_by_pid", return_value=("", "", {}))
    r = client.post("/api/pane/session-setting?pid=gone&setting=effort&value=high")
    assert r.status_code == 404


def test_session_setting_refuses_a_real_claude_2_1_draft(client, mocker, clean_state):
    # Regression, end to end through the real parser: Claude 2.1.280 draws a
    # typed draft in the default fg, which the old ghost filter dropped. The
    # endpoint then pasted `/effort high` onto the draft and submitted it as a
    # prompt. The pane below is the captured shape (custom status line, so the
    # scrape doesn't even recognize Claude — the session file does).
    from periscope import panes
    from periscope.routes import pane as pane_route

    send = _patch_live_pane(mocker)
    mocker.patch.object(pane_route, "parse_pane", side_effect=panes.parse_pane)
    mocker.patch.object(
        pane_route,
        "capture",
        return_value=(
            "\x1b[39m❯\xa0half a thought\n"
            "\x1b[38;5;244m" + "─" * 40 + "\n"
            "  📁 periscope 🌿 main  |  🧠 0% | 🤖 opus ⚡high\n"
        ),
    )
    r = client.post("/api/pane/session-setting?pid=abc123&setting=effort&value=high")
    assert r.status_code == 409, r.text
    assert "unsent" in r.json()["detail"]
    send.assert_not_called()


def test_session_setting_reports_a_model_switch_waiting_for_confirmation(client, mocker, clean_state):
    # With history in the session, Claude asks before switching (the whole
    # conversation is re-read at the new model's cost). periscope doesn't
    # answer for the user, and records nothing until it has actually switched.
    from periscope.store import get_window

    _patch_live_pane(mocker, after="Switch model?\n  Your next response will be slower and use more tokens")
    r = client.post("/api/pane/session-setting?pid=abc123&setting=model&value=sonnet")
    assert r.status_code == 200, r.text
    assert r.json()["result"] == "confirm"
    assert "session_model" not in get_window("abc123")


def test_session_setting_surfaces_claudes_refusal(client, mocker, clean_state):
    # A pane launched with CLAUDE_CODE_EFFORT_LEVEL (the pin's first design)
    # types /effort fine but Claude refuses it — that's a failure, not a 200.
    from periscope.store import get_window

    _patch_live_pane(
        mocker, after="⎿  CLAUDE_CODE_EFFORT_LEVEL=xhigh overrides this session — clear it and high takes over"
    )
    r = client.post("/api/pane/session-setting?pid=abc123&setting=effort&value=high")
    assert r.status_code == 409
    assert "overrides this session" in r.json()["detail"]
    assert "session_effort" not in get_window("abc123")


def test_session_setting_reports_when_claude_says_nothing(client, mocker, clean_state):
    from periscope.store import get_window

    _patch_live_pane(mocker, after="")
    r = client.post("/api/pane/session-setting?pid=abc123&setting=effort&value=high")
    assert r.status_code == 200, r.text
    assert r.json()["result"] == "unverified"
    assert "session_effort" not in get_window("abc123")


def test_session_setting_refuses_a_pane_with_a_dialog_open(client, mocker, clean_state):
    # The "Switch model?" confirm a previous pick left open is a local dialog:
    # the session file still says idle, and Enter into it answers the switch.
    send = _patch_live_pane(
        mocker,
        sess_state="idle",
        parsed={"agent": "claude", "state": "needs-input", "needs_input": True, "pending_input": None},
    )
    r = client.post("/api/pane/session-setting?pid=abc123&setting=effort&value=high")
    assert r.status_code == 409
    assert "dialog" in r.json()["detail"]
    send.assert_not_called()


def test_session_setting_ignores_a_stale_echo_of_the_same_command(client, mocker, clean_state):
    # An earlier `/effort high` and its reply are still in the capture; the new
    # echo hasn't painted yet. That is not this command's outcome.
    from periscope.routes import pane as pane_route
    from periscope.store import get_window

    _patch_live_pane(mocker)
    stale = "older output\n❯\xa0/effort high\n  ⎿  Set effort level to high\n❯\xa0\n"
    mocker.patch.object(pane_route, "capture", return_value=stale)
    r = client.post("/api/pane/session-setting?pid=abc123&setting=effort&value=high")
    assert r.status_code == 200, r.text
    assert r.json()["result"] == "unverified"
    assert "session_effort" not in get_window("abc123")


def test_session_setting_reads_the_new_echo_past_a_stale_one(client, mocker, clean_state):
    from periscope.routes import pane as pane_route

    _patch_live_pane(mocker)
    stale = "❯\xa0/effort high\n  ⎿  Not applied: CLAUDE_CODE_EFFORT_LEVEL=low overrides this session\n"
    fresh = stale + "❯\xa0/effort high\n  ⎿  Set effort level to high\n❯\xa0\n"
    mocker.patch.object(pane_route, "capture", side_effect=[stale, stale, fresh])
    r = client.post("/api/pane/session-setting?pid=abc123&setting=effort&value=high")
    assert r.status_code == 200, r.text
    assert r.json()["result"] == "applied"


def test_session_setting_does_not_record_a_capped_effort(client, mocker, clean_state):
    # Claude ran at the cap, not the requested level; recording the request
    # would label the pane with an effort it isn't at.
    from periscope.store import get_window

    _patch_live_pane(mocker, after="⎿  xhigh exceeds the cap for this model, using high")
    r = client.post("/api/pane/session-setting?pid=abc123&setting=effort&value=xhigh")
    assert r.status_code == 200, r.text
    assert r.json()["result"] == "unverified"
    assert "session_effort" not in get_window("abc123")


def test_session_setting_records_nothing_without_a_live_claude_pid(client, mocker, clean_state):
    # window_view only shows the value while claude_pid matches the live one;
    # a None pid never matches, so storing it would be a silent no-op.
    from periscope.routes import pane as pane_route
    from periscope.store import get_window

    _patch_live_pane(mocker)
    mocker.patch.object(pane_route, "pane_claude_pids", return_value={})
    r = client.post("/api/pane/session-setting?pid=abc123&setting=effort&value=high")
    assert r.status_code == 200, r.text
    assert r.json()["result"] == "applied"
    assert "session_effort" not in get_window("abc123")
