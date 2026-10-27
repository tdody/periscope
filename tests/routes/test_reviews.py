"""/api/reviews* — the queue, a walkthrough, comment/prepare/merge/clear.
Windows come from a patched state_hub._last_blob (the route never computes
the state blob — docs/testing.md's no-thread rule); delivery and spawn are
AsyncMocks."""

import json
from unittest.mock import AsyncMock

import pytest

from periscope import reviews, state_hub

WT = "# T\n\n> branch: feat/x · head: abc\n\nProblem.\n\n## Stop A\n> kind: reuse · refs: a.py:1-3\n\nbody\n"


def _win(**over):
    base = {
        "pid": "p1",
        "pane_id": "%1",
        "session": "s",
        "index": 1,
        "name": "work",
        "cwd": "/dev/fdy/wt",
        "repo_key": "/dev/fdy",
        "repo_label": "fdy",
        "branch": "feat/x",
        "agent": "claude",
        "channel_attached": True,
        "activity": 1,
        "track_id": "/dev/fdy",
        "pr": None,
        "pr_state": None,
        "ci": None,
    }
    return {**base, **over}


@pytest.fixture
def place(mocker):
    # Never the real rail write or a live tmux listing.
    mocker.patch("periscope.routes.reviews.list_windows", return_value=[])
    return mocker.patch("periscope.routes.reviews.open_ops.place_in_rail")


@pytest.fixture(autouse=True)
def _env(tmp_path, monkeypatch, mocker, place):
    monkeypatch.setattr(reviews, "REVIEWS_DIR", tmp_path)
    monkeypatch.setattr(state_hub, "_last_blob", json.dumps({"windows": [_win()]}))
    mocker.patch("periscope.worktrees._cached_worktrees", return_value=[])
    mocker.patch("periscope.worktrees.for_branch", return_value=None)
    mocker.patch("periscope.reviews.git_pr.cached_linked_pr_state", return_value=None)
    # Never the real thing in tests: it starts a _bg thread (docs/testing.md).
    mocker.patch("periscope.reviews.cached_open_prs", return_value=[])
    mocker.patch("periscope.routes.reviews.open_ops.discover_repos", return_value=["/dev/fdy"])
    yield


def _write_wt():
    p = reviews.walkthrough_path("fdy", "feat/x")
    p.parent.mkdir(parents=True)
    p.write_text(WT)


def test_list(client):
    _write_wt()
    r = client.get("/api/reviews")
    assert r.status_code == 200
    rows = r.json()["rows"]
    assert len(rows) == 1 and rows[0]["branch"] == "feat/x" and rows[0]["walkthrough"]["stops"] == 1


def test_walkthrough_404_without_file_and_no_diff_without_worktree(client):
    assert client.get("/api/reviews/walkthrough", params={"repo": "fdy", "branch": "feat/x"}).status_code == 404
    _write_wt()
    r = client.get("/api/reviews/walkthrough", params={"repo": "fdy", "branch": "feat/x"})
    assert r.status_code == 200
    body = r.json()
    assert body["text"] == WT and body["comments"] == [] and body["diff"] is None and body["stale_by"] is None


def test_comment_appends_and_delivers(client, mocker):
    deliver = mocker.patch("periscope.channels._deliver", new=AsyncMock(return_value={"ok": True}))
    r = client.post("/api/reviews/comment", json={"repo": "fdy", "branch": "feat/x", "stop": "Stop A", "body": "why?"})
    assert r.status_code == 200 and r.json() == {"ok": True}
    pane_id, msg, sender = deliver.call_args.args
    assert pane_id == "%1" and sender == "periscope"
    assert 'Review comment on "Stop A"' in msg and msg.endswith("why?")
    got = reviews.parse_comments(reviews.comments_path("fdy", "feat/x").read_text())
    assert got[0]["stop"] == "Stop A" and got[0]["body"] == "why?"


def test_comment_without_owner_still_appends_409(client, monkeypatch):
    monkeypatch.setattr(state_hub, "_last_blob", json.dumps({"windows": []}))
    r = client.post("/api/reviews/comment", json={"repo": "fdy", "branch": "feat/x", "stop": "Stop A", "body": "why?"})
    assert r.status_code == 409 and "no owning pane" in r.json()["detail"]
    assert reviews.unresolved(reviews.comments_path("fdy", "feat/x").read_text()) == 1


def test_comment_deliver_failure_is_409(client, mocker):
    mocker.patch(
        "periscope.channels._deliver", new=AsyncMock(return_value={"ok": False, "error": "target not attached"})
    )
    r = client.post("/api/reviews/comment", json={"repo": "fdy", "branch": "feat/x", "stop": "Stop A", "body": "why?"})
    assert r.status_code == 409 and "not attached" in r.json()["detail"]


def test_prepare_with_owner_delivers(client, mocker, place):
    deliver = mocker.patch("periscope.channels._deliver", new=AsyncMock(return_value={"ok": True}))
    r = client.post("/api/reviews/prepare", json={"repo": "fdy", "branch": "feat/x"})
    assert r.status_code == 200 and r.json() == {"ok": True, "mode": "delivered"}
    msg = deliver.call_args.args[1]
    assert "walkthrough" in msg and str(reviews.walkthrough_path("fdy", "feat/x")) in msg
    place.assert_not_called()


def test_prepare_without_owner_spawns_in_worktree(client, mocker, monkeypatch, place):
    monkeypatch.setattr(state_hub, "_last_blob", json.dumps({"windows": [_win(agent=None)]}))
    mocker.patch("periscope.worktrees.for_branch", return_value="/dev/fdy/wt")
    mocker.patch("periscope.routes.reviews.tracks.repo_default_track", return_value="/dev/fdy")
    mocker.patch(
        "periscope.routes.reviews.open_ops.resolve_worktree_session", return_value=("fdy-wt", {"repo": "/dev/fdy"})
    )
    spawn = mocker.patch(
        "periscope.channels.spawn_claude_with_prompt",
        new=AsyncMock(
            return_value={"target": "fdy-wt:2", "session": "fdy-wt", "index": 2, "pid": "k", "pane_id": "%5"}
        ),
    )
    r = client.post("/api/reviews/prepare", json={"repo": "fdy", "branch": "feat/x"})
    assert r.status_code == 200 and r.json()["mode"] == "spawned"
    args, kwargs = spawn.call_args
    assert args[0] == "/dev/fdy/wt" and args[1] == "/dev/fdy" and kwargs["session"] == "fdy-wt"
    assert "walkthrough" in args[2] and str(reviews.walkthrough_path("fdy", "feat/x")) in args[2]
    place.assert_called_once_with("fdy-wt", {"repo": "/dev/fdy"}, ["k"])


def test_prepare_with_no_windows_at_all_still_finds_the_worktree(client, mocker, monkeypatch):
    # The queue found the repo via discover_repos; the route must too, or the
    # queue enables prepare on a row whose click 409s.
    monkeypatch.setattr(state_hub, "_last_blob", json.dumps({"windows": []}))
    mocker.patch("periscope.worktrees.for_branch", return_value="/dev/fdy/wt")
    mocker.patch("periscope.routes.reviews.tracks.repo_default_track", return_value="/dev/fdy")
    mocker.patch(
        "periscope.routes.reviews.open_ops.resolve_worktree_session", return_value=("fdy-wt", {"repo": "/dev/fdy"})
    )
    spawn = mocker.patch(
        "periscope.channels.spawn_claude_with_prompt",
        new=AsyncMock(
            return_value={"target": "fdy-wt:2", "session": "fdy-wt", "index": 2, "pid": "k", "pane_id": "%5"}
        ),
    )
    r = client.post("/api/reviews/prepare", json={"repo": "fdy", "branch": "feat/x"})
    assert r.status_code == 200 and spawn.call_args.args[0] == "/dev/fdy/wt"


def test_prepare_without_owner_or_worktree_409(client, monkeypatch):
    monkeypatch.setattr(state_hub, "_last_blob", json.dumps({"windows": []}))
    r = client.post("/api/reviews/prepare", json={"repo": "fdy", "branch": "feat/x"})
    assert r.status_code == 409


def test_bad_repo_or_branch_is_400(client):
    assert (
        client.post("/api/reviews/comment", json={"repo": "../x", "branch": "b", "stop": "s", "body": "t"}).status_code
        == 400
    )
    assert client.post("/api/reviews/clear", json={"repo": "fdy", "branch": "../../etc"}).status_code == 400


def test_merge_without_owner_409(client, monkeypatch):
    monkeypatch.setattr(state_hub, "_last_blob", json.dumps({"windows": []}))
    assert client.post("/api/reviews/merge", json={"repo": "fdy", "branch": "feat/x"}).status_code == 409


def test_clear_removes_dir(client):
    _write_wt()
    r = client.post("/api/reviews/clear", json={"repo": "fdy", "branch": "feat/x"})
    assert r.status_code == 200
    assert not reviews.review_dir("fdy", "feat/x").exists()


@pytest.mark.parametrize(
    "repo,branch",
    [
        ("", "b"),
        ("fdy", ""),
        ("fdy", ".."),
        ("fdy", "a/../b"),
        ("fdy", "/abs"),
        ("fdy", "."),
        (".", "b"),
        ("..", "b"),
        ("a/b", "b"),
    ],
)
def test_check_rejects_traversal(client, repo, branch):
    assert client.post("/api/reviews/clear", json={"repo": repo, "branch": branch}).status_code == 400
    assert client.get("/api/reviews/walkthrough", params={"repo": repo, "branch": branch}).status_code == 400


def test_clear_dot_branch_never_touches_repo_dir(client):
    _write_wt()
    assert client.post("/api/reviews/clear", json={"repo": "fdy", "branch": "."}).status_code == 400
    assert reviews.walkthrough_path("fdy", "feat/x").exists()


def test_comment_timestamp_is_minute_precision(client, mocker):
    mocker.patch("periscope.channels._deliver", new=AsyncMock(return_value={"ok": True}))
    client.post("/api/reviews/comment", json={"repo": "fdy", "branch": "feat/x", "stop": "Stop A", "body": "why?"})
    got = reviews.parse_comments(reviews.comments_path("fdy", "feat/x").read_text())
    assert len(got) == 1 and len(got[0]["ts"]) == 16


def test_prepare_spawn_without_pid_is_500(client, mocker, monkeypatch):
    monkeypatch.setattr(state_hub, "_last_blob", json.dumps({"windows": []}))
    mocker.patch("periscope.worktrees.for_branch", return_value="/dev/fdy/wt")
    mocker.patch("periscope.routes.reviews.tracks.repo_default_track", return_value="/dev/fdy")
    mocker.patch(
        "periscope.routes.reviews.open_ops.resolve_worktree_session", return_value=("fdy-wt", {"repo": "/dev/fdy"})
    )
    mocker.patch(
        "periscope.channels.spawn_claude_with_prompt",
        new=AsyncMock(return_value={"target": "fdy-wt:2", "session": "fdy-wt", "index": 2, "pid": "", "pane_id": "%5"}),
    )
    assert client.post("/api/reviews/prepare", json={"repo": "fdy", "branch": "feat/x"}).status_code == 500


@pytest.mark.parametrize("stop", ["", "  ", "a\nb", "a\rb"])
def test_comment_bad_stop_is_400(client, stop):
    r = client.post("/api/reviews/comment", json={"repo": "fdy", "branch": "feat/x", "stop": stop, "body": "t"})
    assert r.status_code == 400
    assert not reviews.comments_path("fdy", "feat/x").exists()


def test_merge_prompt_gates_on_resolved(client, mocker):
    deliver = mocker.patch("periscope.channels._deliver", new=AsyncMock(return_value={"ok": True}))
    assert client.post("/api/reviews/merge", json={"repo": "fdy", "branch": "feat/x"}).status_code == 200
    msg = deliver.call_args.args[1]
    assert "resolved: yes" in msg and "do not merge" in msg


def test_concurrent_prepare_spawns_once(mocker, monkeypatch, place):
    import asyncio

    import httpx

    from periscope import app as app_mod
    from periscope.routes import reviews as route

    monkeypatch.setattr(state_hub, "_last_blob", json.dumps({"windows": []}))
    mocker.patch("periscope.worktrees.for_branch", return_value="/dev/fdy/wt")
    mocker.patch("periscope.routes.reviews.tracks.repo_default_track", return_value="/dev/fdy")
    mocker.patch(
        "periscope.routes.reviews.open_ops.resolve_worktree_session", return_value=("fdy-wt", {"repo": "/dev/fdy"})
    )

    async def run():
        gate = asyncio.Event()

        async def slow_spawn(*a, **k):
            await gate.wait()
            return {"target": "fdy-wt:2", "session": "fdy-wt", "index": 2, "pid": "k", "pane_id": "%5"}

        spawn = mocker.patch("periscope.channels.spawn_claude_with_prompt", new=AsyncMock(side_effect=slow_spawn))
        body = {"repo": "fdy", "branch": "feat/x"}
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app_mod.app), base_url="http://t") as c:
            first = asyncio.create_task(c.post("/api/reviews/prepare", json=body))
            while not spawn.await_count and not spawn.call_count:
                await asyncio.sleep(0.01)
            second = await c.post("/api/reviews/prepare", json=body)
            gate.set()
            return (await first).status_code, second.status_code, spawn.call_count

    assert asyncio.run(run()) == (200, 409, 1)
    assert route._preparing == set()
