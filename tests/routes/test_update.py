"""Tests for /api/update + /api/update/status."""


def test_status_reports_target_and_release_notes(client, mocker, monkeypatch):
    """Runs the real status(): it is the popover's only transport for the
    release notes, and a mocked shape would drift silently."""
    from periscope import updater

    monkeypatch.setattr(updater, "_behind", 7)
    monkeypatch.setattr(updater, "_target", "v0.3.0")
    monkeypatch.setattr(updater, "_releases", [{"heading": "v0.3.0 — 2026-11-01", "body": "Adds X."}])
    mocker.patch("periscope.updater.tail", return_value=[])
    r = client.get("/api/update/status")
    assert r.status_code == 200
    assert r.json()["behind"] == 7
    assert r.json()["target"] == "v0.3.0"
    assert r.json()["releases"] == [{"heading": "v0.3.0 — 2026-11-01", "body": "Adds X."}]


def test_post_starts_update(client, mocker):
    start = mocker.patch("periscope.updater.start")
    r = client.post("/api/update")
    assert r.status_code == 200
    assert r.json()["ok"] is True
    start.assert_called_once()


def test_post_conflicts_on_dev_instance(client, mocker):
    """Route convention: errors are HTTPException with a real status code,
    never {"ok": False}. A dev instance refusing to self-update is a 409."""
    mocker.patch(
        "periscope.updater.start", side_effect=RuntimeError("self-update is prod-only (this is a dev instance)")
    )
    r = client.post("/api/update")
    assert r.status_code == 409
    assert "prod-only" in r.json()["detail"]


def test_post_conflicts_when_already_running(client, mocker):
    mocker.patch("periscope.updater.start", side_effect=RuntimeError("an update is already running"))
    r = client.post("/api/update")
    assert r.status_code == 409


def test_state_carries_update_summary(client, mocker):
    """The nag rides /api/state so the header pill needs no extra request."""
    mocker.patch("periscope.updater.summary", return_value={"behind": 3, "checked_at": 1.0, "running": False})
    r = client.get("/api/state")
    assert r.status_code == 200
    assert r.json()["update"]["behind"] == 3
