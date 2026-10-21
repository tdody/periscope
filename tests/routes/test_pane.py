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
    _patch(mocker, "list_windows", return_value=[
        {"session": "main", "index": 0, "name": "x", "pane_id": "%7", "cwd": "/tmp"}
    ])
    _patch(mocker, "cached_lgtm_state", return_value=None)

    r = client.get("/api/pane?session=main&index=0")
    assert r.status_code == 200
    body = r.json()
    assert body["target"] == "main:0"
    assert body["session"] == "main"
    assert body["name"] == "win-name"
    assert "content" in body


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
    assert any(
        c.args and c.args[0] == "rename-window" and "fresh-name" in c.args
        for c in tmux_mock.call_args_list
    )


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
    (enc / "sid-9.jsonl").write_text(json.dumps({
        "type": "user", "sessionId": "sid-9", "cwd": cwd,
        "timestamp": "2026-06-01T10:00:00.000Z", "uuid": "u1", "parentUuid": None,
        "message": {"role": "user", "content": "hi there"},
    }) + "\n")
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

_IDLE_CLAUDE = "❯ \n" + "─" * 20 + "\n  [Opus 4.8] 12% context\n"
_WINDOW = {"session": "periscope", "index": 4, "pid_raw": "abc123"}


def _patch_live_pane(mocker, *, parsed=None, sess_state="idle"):
    from periscope.routes import pane as pane_route
    mocker.patch.object(pane_route, "_resolve_window_by_pid",
                        return_value=("abc123", "%7", dict(_WINDOW)))
    mocker.patch.object(pane_route, "capture", return_value="ignored")
    mocker.patch.object(pane_route, "parse_pane", return_value=parsed or {
        "agent": "claude", "state": "idle", "pending_input": None})
    mocker.patch.object(pane_route, "session_id_for_pane", return_value="sid-1")
    mocker.patch.object(pane_route, "session_state_for",
                        return_value={"state": sess_state} if sess_state else None)
    mocker.patch.object(pane_route, "pane_claude_pids", return_value={"%7": 4242})
    return mocker.patch.object(pane_route, "_send_to_target",
                               return_value={"target": "periscope:4", "ok": True})


def test_session_setting_types_the_slash_command_into_an_idle_pane(client, mocker, clean_state):
    from periscope.store import get_window
    send = _patch_live_pane(mocker)
    r = client.post("/api/pane/session-setting?pid=abc123&setting=effort&value=high")
    assert r.status_code == 200, r.text
    assert r.json()["sent"] == "/effort high"
    send.assert_called_once_with("periscope:4", "/effort high", ["Enter"])
    # Remembered, because Claude reports effort nowhere periscope can read —
    # tied to the claude process it was typed into, so a fresh session in the
    # same pane doesn't inherit the label.
    assert get_window("abc123")["session_effort"] == {"value": "high", "claude_pid": 4242}


def test_session_setting_sets_the_model(client, mocker, clean_state):
    from periscope.store import get_window
    send = _patch_live_pane(mocker)
    r = client.post("/api/pane/session-setting?pid=abc123&setting=model&value=opus%5B1m%5D")
    assert r.status_code == 200, r.text
    send.assert_called_once_with("periscope:4", "/model opus[1m]", ["Enter"])
    assert get_window("abc123")["session_model"] == {"value": "opus[1m]", "claude_pid": 4242}


def test_session_setting_maps_default_effort_to_auto(client, mocker, clean_state):
    # The pickers say "default"; Claude's word for "the model's own effort" is auto.
    send = _patch_live_pane(mocker)
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
    send = _patch_live_pane(mocker, parsed={
        "agent": "claude", "state": "idle", "pending_input": "half a thought"})
    r = client.post("/api/pane/session-setting?pid=abc123&setting=effort&value=high")
    assert r.status_code == 409
    assert "unsent" in r.json()["detail"]
    send.assert_not_called()


def test_session_setting_falls_back_to_the_scraped_state(client, mocker, clean_state):
    # No session-status file (unmapped pane): the scraped state decides.
    send = _patch_live_pane(mocker, sess_state=None, parsed={
        "agent": "claude", "state": "working", "pending_input": None})
    r = client.post("/api/pane/session-setting?pid=abc123&setting=effort&value=high")
    assert r.status_code == 409
    send.assert_not_called()


def test_session_setting_refuses_a_non_claude_pane(client, mocker, clean_state):
    send = _patch_live_pane(mocker, sess_state=None, parsed={
        "agent": None, "state": "shell", "pending_input": None})
    r = client.post("/api/pane/session-setting?pid=abc123&setting=effort&value=high")
    assert r.status_code == 409
    assert "Claude" in r.json()["detail"]
    send.assert_not_called()


def test_session_setting_rejects_unknown_values(client, mocker, clean_state):
    send = _patch_live_pane(mocker)
    for q in ("setting=effort&value=ultracode", "setting=effort&value=HIGH",
              "setting=model&value=opus%20%26%26%20rm", "setting=model&value=auto",
              "setting=color&value=red"):
        r = client.post(f"/api/pane/session-setting?pid=abc123&{q}")
        assert r.status_code in (400, 422), (q, r.status_code)
    send.assert_not_called()


def test_session_setting_404s_an_unknown_pid(client, mocker, clean_state):
    from periscope.routes import pane as pane_route
    mocker.patch.object(pane_route, "_resolve_window_by_pid", return_value=("", "", {}))
    r = client.post("/api/pane/session-setting?pid=gone&setting=effort&value=high")
    assert r.status_code == 404
