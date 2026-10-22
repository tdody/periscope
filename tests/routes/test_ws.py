"""Tests for WS /ws/pane.

The handler consumes periscope.tmux_mirror's Subscription; tests patch
the subscribe boundary with a fake (the only mocked seam — parsing,
frames, and timing are unit-tested in tests/test_tmux_mirror.py) and
fake_tmux for the fork-path display-message/capture-pane calls.
"""

import asyncio
import contextlib
import json
import time

import pytest

from periscope.routes import ws as ws_route
from periscope.tmux_mirror import PaneSize


@pytest.fixture(autouse=True)
def _no_viewers_left_over(mocker):
    """The window-height owner is process-wide: a viewer one test left
    registered would floor the next test's window. And a leaving viewer's
    restore runs inline, not on a `_bg` thread: one that outlived its test
    would run the real `tmux`, against the developer's own server."""
    ws_route._HEIGHTS._asks.clear()
    mocker.patch("periscope.routes.ws._bg", side_effect=lambda _name, fn, *args: fn(*args))
    yield
    ws_route._HEIGHTS._asks.clear()


class FakeSubscription:
    def __init__(self):
        self.q = asyncio.Queue()
        self.loop = None  # captured in fake_subscribe (app's loop)
        self.reconciles = 0
        self.exited = False
        self.size = None  # armed by the route at subscribe; see test_ws_pane_arms_size_announcements

    def push(self, chunk):
        # TestClient runs the app loop in another thread; a plain
        # put_nowait from the test thread rides on anyio internals.
        self.loop.call_soon_threadsafe(self.q.put_nowait, chunk)

    def request_reconcile(self):
        self.reconciles += 1

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_exc):
        self.exited = True

    def __aiter__(self):
        return self

    async def __anext__(self):
        chunk = await self.q.get()
        if chunk is None:
            raise StopAsyncIteration
        return chunk


def _patch_mirror(mocker):
    sub = FakeSubscription()

    async def fake_subscribe(session, pane_id, *, size):
        sub.session, sub.pane_id, sub.size = session, pane_id, size
        # Apart from `size`, which a route could still set after the call.
        sub.subscribed_with = size
        sub.loop = asyncio.get_running_loop()
        return sub

    mocker.patch("periscope.routes.ws.tmux_mirror.subscribe", side_effect=fake_subscribe)
    return sub


def _fake_tmux(calls=None):
    def fake(*args):
        if calls is not None:
            calls.append(args)
        # The handshake chains setw ; resize-window ; display-message into one
        # invocation; real tmux returns the final display-message output for
        # the whole chain, so match the command anywhere in the argv.
        if "display-message" in args:
            # fields: width|height|cx|cy|alt|pane_id|session|window|mouse_any|window_id
            return "80|24|0|0|0|%7|main|0|0|@3"
        if "capture-pane" in args:
            return "hello\n"
        return ""

    return fake


def test_ws_pane_initial_paint(client, mocker):
    """Connect → size frame + initial paint blob arrive, in that order."""
    mocker.patch("periscope.routes.ws.tmux", side_effect=_fake_tmux())
    sub = _patch_mirror(mocker)

    with client.websocket_connect("/ws/pane?pane_id=%7") as ws:
        payload = json.loads(ws.receive_text())
        assert payload == {"type": "size", "cols": 80, "rows": 24}
        mouse = json.loads(ws.receive_text())
        assert mouse == {"type": "mouse", "on": False}
        blob = ws.receive_bytes()
        assert b"hello" in blob
        assert b"\x1b[2J" in blob  # initial paint still clears before body

    assert sub.session == "main"
    assert sub.pane_id == "%7"
    assert sub.exited  # disconnect unsubscribed


def test_ws_pane_recency_stamp_keyed_on_session_index(client, mocker):
    """Connect stamps acted_at on the recency map keyed by session:index
    (from display-message), NOT on the %pane_id URL param — window_view
    reads recency_stamps_for(f"{session}:{index}"), so a %N key would be
    a dead write."""
    from periscope.panes import recency_stamps_for

    mocker.patch("periscope.routes.ws.tmux", side_effect=_fake_tmux())
    _patch_mirror(mocker)

    with client.websocket_connect("/ws/pane?pane_id=%7") as ws:
        _ = ws.receive_text()  # size
        _ = ws.receive_text()  # mouse
        _ = ws.receive_bytes()

    assert recency_stamps_for("main:0")["acted_at"] > 0
    # The pane-id key must NOT have been stamped.
    assert recency_stamps_for("%7")["acted_at"] == 0


def test_ws_pane_resizes_tmux_before_capture(client, mocker):
    """Connect-time cols/rows hint resizes the pane before capture-pane — the
    initial-paint width-race fix. The resize is chained with display-message
    into one tmux invocation (one fork, not two) whose ordering guarantees the
    resize lands before the meta read; capture-pane follows as its own call."""
    calls: list[tuple] = []
    mocker.patch("periscope.routes.ws.tmux", side_effect=_fake_tmux(calls))
    _patch_mirror(mocker)

    with client.websocket_connect("/ws/pane?pane_id=%7&cols=100&rows=30") as ws:
        _ = ws.receive_text()  # size
        _ = ws.receive_text()  # mouse
        _ = ws.receive_bytes()

    def call_idx(pred):
        return next(i for i, c in enumerate(calls) if pred(c))

    resize_i = call_idx(lambda c: "resize-window" in c)
    capture_i = call_idx(lambda c: "capture-pane" in c)
    assert resize_i < capture_i

    # The resize rides in the same chained call as the meta read, carrying the
    # client's hinted dims, and there's exactly one of them (periscope holds the
    # pane size after disconnect — no restore).
    resize_calls = [c for c in calls if "resize-window" in c]
    assert len(resize_calls) == 1
    resize = resize_calls[0]
    assert "display-message" in resize
    assert "-x" in resize and "100" in resize
    assert "-y" in resize and "30" in resize


def test_ws_pane_handshake_survives_resize_failure(client, mocker):
    """tmux aborts a `;`-chain at the first failing command, yielding empty
    output. A resize failure has always been non-fatal, so the handler must
    re-ask for the meta alone rather than close the socket on an empty chain."""
    calls: list[tuple] = []

    def fake(*args):
        calls.append(args)
        # The chained call (contains resize-window) "fails": empty output, as
        # tmux does when an earlier command in the chain errors. A standalone
        # display-message still succeeds.
        if "resize-window" in args:
            return ""
        if "display-message" in args:
            return "80|24|0|0|0|%7|main|0|0|@3"
        if "capture-pane" in args:
            return "hello\n"
        return ""

    mocker.patch("periscope.routes.ws.tmux", side_effect=fake)
    _patch_mirror(mocker)

    with client.websocket_connect("/ws/pane?pane_id=%7&cols=100&rows=30") as ws:
        assert json.loads(ws.receive_text())["type"] == "size"  # handshake survived
        _ = ws.receive_text()  # mouse
        assert ws.receive_bytes()

    # The chained attempt ran, then a bare display-message recovered the meta.
    assert any("resize-window" in c for c in calls)
    standalone = [c for c in calls if "display-message" in c and "resize-window" not in c]
    assert len(standalone) == 1


def test_ws_streams_subscription_bytes(client, mocker):
    mocker.patch("periscope.routes.ws.tmux", side_effect=_fake_tmux())
    sub = _patch_mirror(mocker)

    with client.websocket_connect("/ws/pane?pane_id=%7") as ws:
        _ = ws.receive_text()  # size
        _ = ws.receive_text()  # mouse
        _ = ws.receive_bytes()
        sub.push(b"live-bytes")
        assert ws.receive_bytes() == b"live-bytes"


def test_ws_pane_arms_size_announcements(client, mocker):
    """The mirror announces a pane resize only to a subscription armed with
    a `size`, comparing it with the pane's (width, height) — so the route must
    arm it at subscribe with the dims it tells the client. Left unarmed, a
    split under an open terminal never reaches the xterm, and every test of the
    mirror (which arms it itself) still passes. AT subscribe, not after: the
    connect-time reconcile is requested inside subscribe(), so an arm after
    the route's first await lets it land unannounced — read from what
    subscribe() was passed, which a late `sub.size = …` can't fake."""
    mocker.patch("periscope.routes.ws.tmux", side_effect=_fake_tmux())
    sub = _patch_mirror(mocker)

    with client.websocket_connect("/ws/pane?pane_id=%7") as ws:
        _ = ws.receive_text()  # size
        _ = ws.receive_text()  # mouse
        _ = ws.receive_bytes()
        assert sub.subscribed_with == PaneSize(cols=80, rows=24)


def test_ws_sends_size_announcement_as_text_ahead_of_its_frame(client, mocker):
    """A size announcement is a JSON control message: a text frame, which the
    client parses, never bytes it would write into the terminal as data. And it
    stays ahead of the frame painted at the new size."""
    mocker.patch("periscope.routes.ws.tmux", side_effect=_fake_tmux())
    sub = _patch_mirror(mocker)

    with client.websocket_connect("/ws/pane?pane_id=%7") as ws:
        _ = ws.receive_text()  # size
        _ = ws.receive_text()  # mouse
        _ = ws.receive_bytes()
        sub.push(PaneSize(cols=80, rows=12))
        sub.push(b"frame")
        assert json.loads(ws.receive_text()) == {"type": "size", "cols": 80, "rows": 12}
        assert ws.receive_bytes() == b"frame"


def test_ws_closes_on_subscription_eof(client, mocker):
    """EOF (pane/mirror died) closes the websocket — feeds the client's
    reconnect FSM instead of going silent like the old dead FIFO."""
    mocker.patch("periscope.routes.ws.tmux", side_effect=_fake_tmux())
    sub = _patch_mirror(mocker)

    with client.websocket_connect("/ws/pane?pane_id=%7") as ws:
        _ = ws.receive_text()  # size
        _ = ws.receive_text()  # mouse
        _ = ws.receive_bytes()
        sub.push(None)  # EOF sentinel
        with pytest.raises(Exception):  # noqa: B017 — starlette's closed-ws exception type is an internal detail
            ws.receive_bytes()


def _send_resize(ws, sub, msg):
    ws.send_text(json.dumps(msg))
    # Resize handling is async; poll briefly for the side effect.
    for _i in range(50):
        if sub.reconciles:
            break
        import time

        time.sleep(0.02)


def test_ws_resize_message_triggers_reconcile(client, mocker):
    calls = []
    mocker.patch("periscope.routes.ws.tmux", side_effect=_fake_tmux(calls))
    sub = _patch_mirror(mocker)

    with client.websocket_connect("/ws/pane?pane_id=%7") as ws:
        _ = ws.receive_text()  # size
        _ = ws.receive_text()  # mouse
        _ = ws.receive_bytes()
        _send_resize(ws, sub, {"type": "resize", "cols": 90, "rows": 30})
        assert sub.reconciles == 1
    resize = [c for c in calls if "resize-window" in c and "display-message" not in c]
    assert len(resize) == 1
    assert resize[0][resize[0].index("-x") + 1] == "90"
    assert resize[0][resize[0].index("-y") + 1] == "30"


def test_ws_rows_only_resize_keeps_the_window_width(client, mocker):
    """A height-only ask carries no cols (resizeAsk), and resizes the window's
    height alone. With the client's pinned width in it, a shorter viewer's
    shrink also set a shared window's width, reverting a wider viewer's on
    every change it made."""
    calls = []
    mocker.patch("periscope.routes.ws.tmux", side_effect=_fake_tmux(calls))
    sub = _patch_mirror(mocker)

    with client.websocket_connect("/ws/pane?pane_id=%7") as ws:
        _ = ws.receive_text()  # size
        _ = ws.receive_text()  # mouse
        _ = ws.receive_bytes()
        _send_resize(ws, sub, {"type": "resize", "rows": 22})
        assert sub.reconciles == 1
    resize = [c for c in calls if "resize-window" in c and "display-message" not in c]
    assert len(resize) == 1
    assert "-x" not in resize[0]
    assert resize[0][resize[0].index("-y") + 1] == "22"


def test_ws_reconcile_message_repaints_without_resizing(client, mocker):
    """⌘R with a terminal focused: an explicit repaint pull. Must NOT resize —
    the mirror's self-heal is a timer, and this is the manual path for when it
    has visibly drifted and you don't want to wait for the next tick."""
    calls = []
    mocker.patch("periscope.routes.ws.tmux", side_effect=_fake_tmux(calls))
    sub = _patch_mirror(mocker)

    with client.websocket_connect("/ws/pane?pane_id=%7") as ws:
        _ = ws.receive_text()  # size
        _ = ws.receive_text()  # mouse
        _ = ws.receive_bytes()
        before = sum(1 for c in calls if "resize-window" in c)
        ws.send_text(json.dumps({"type": "reconcile"}))
        for _i in range(50):
            if sub.reconciles:
                break
            import time

            time.sleep(0.02)
        assert sub.reconciles == 1
        assert sum(1 for c in calls if "resize-window" in c) == before


def test_ws_reconcile_message_is_not_forwarded_as_keystrokes(client, mocker):
    """The control message must be swallowed, not typed into the pane — a
    stray `{"type":"reconcile"}` landing in Claude's prompt would be worse
    than no repaint at all."""
    mocker.patch("periscope.routes.ws.tmux", side_effect=_fake_tmux())
    sub = _patch_mirror(mocker)
    sent = []
    mocker.patch("periscope.routes.ws.tmux_input.send", side_effect=lambda target, data: sent.append(data))

    with client.websocket_connect("/ws/pane?pane_id=%7") as ws:
        _ = ws.receive_text()
        _ = ws.receive_text()
        _ = ws.receive_bytes()
        ws.send_text(json.dumps({"type": "reconcile"}))
        for _i in range(50):
            if sub.reconciles:
                break
            import time

            time.sleep(0.02)
    assert sub.reconciles == 1
    assert not any("reconcile" in s for s in sent)


# -- one window, several viewers --


def _patch_mirror_per_viewer(mocker):
    subs = []

    async def fake_subscribe(session, pane_id, *, size):
        sub = FakeSubscription()
        sub.session, sub.pane_id, sub.size = session, pane_id, size
        sub.loop = asyncio.get_running_loop()
        subs.append(sub)
        return sub

    mocker.patch("periscope.routes.ws.tmux_mirror.subscribe", side_effect=fake_subscribe)
    return subs


def _viewer(scope, client, pane, cols, rows):
    """Connect a viewer that leaves when `scope` closes (the test's choice of order)."""
    ws = scope.enter_context(client.websocket_connect(f"/ws/pane?pane_id={pane}&cols={cols}&rows={rows}"))
    _ = ws.receive_text()  # size
    _ = ws.receive_text()  # mouse
    _ = ws.receive_bytes()
    return ws


def _resizes(calls, since=0):
    """(target, cols or None, rows) for each resize-window, in order."""
    out = []
    for c in calls[since:]:
        if "resize-window" in c:
            i = c.index("resize-window")
            target = c[c.index("-t", i) + 1]
            cols = c[c.index("-x", i) + 1] if "-x" in c[i:] else None
            out.append((target, cols, c[c.index("-y", i) + 1]))
    return out


def _ask(ws, sub, msg):
    before = sub.reconciles
    ws.send_text(json.dumps(msg))
    for _i in range(100):  # handled async: wait for its reconcile
        if sub.reconciles > before:
            return
        time.sleep(0.01)


@pytest.mark.parametrize("taller_first", [False, True])
def test_ws_window_regrows_when_its_shorter_viewer_leaves(client, mocker, taller_first):
    """Two viewers of one pane, A's box 62 rows and B's 22: the window takes
    B's height, whichever connected first, and takes A's back when B leaves.
    Each client can only undo its own shrinks and none sees another leave, so
    left to them A kept B's 22 rows — 40 blank under Claude's TUI — until A
    changed width, switched panes or reconnected."""
    calls = []
    mocker.patch("periscope.routes.ws.tmux", side_effect=_fake_tmux(calls))
    _patch_mirror_per_viewer(mocker)

    with contextlib.ExitStack() as a, contextlib.ExitStack() as b:
        if taller_first:
            _viewer(a, client, "%7", 143, 62)
            _viewer(b, client, "%7", 230, 22)
            assert _resizes(calls) == [("%7", "143", "62"), ("%7", "230", "22")]
        else:
            _viewer(b, client, "%7", 230, 22)
            _viewer(a, client, "%7", 143, 62)
            # Floored at the handshake: not A's 62 and then B's 22 again, two
            # Claude redraws for every viewer.
            assert _resizes(calls) == [("%7", "230", "22"), ("%7", "143", "22")]
        n = len(calls)
        b.close()  # returns once B's handler is done
        assert _resizes(calls, n) == [("@3", None, "62")]

        # The last viewer leaving keeps the window as it is (no restore churn).
        n = len(calls)
        a.close()
        assert _resizes(calls, n) == []


def test_ws_taller_viewers_ask_never_grows_past_a_shorter_viewer(client, mocker):
    """A's regrow of its own shrink asks for A's height; B's 22 rows hold the
    window down. Left to the clients, the regrow grew the window past B's
    height and B asked it back down: two more Claude redraws per regrow."""
    calls = []
    mocker.patch("periscope.routes.ws.tmux", side_effect=_fake_tmux(calls))
    subs = _patch_mirror_per_viewer(mocker)
    with contextlib.ExitStack() as scope:
        a = _viewer(scope, client, "%7", 142, 36)
        _viewer(scope, client, "%7", 229, 22)
        n = len(calls)
        _ask(a, subs[0], {"type": "resize", "rows": 20})
        _ask(a, subs[0], {"type": "resize", "rows": 36})
        _ask(a, subs[0], {"type": "resize", "cols": 200, "rows": 36})
        # A's shrink below B goes through; its regrow and its width change keep B's height.
        assert _resizes(calls, n) == [("%7", None, "20"), ("%7", None, "22"), ("%7", "200", "22")]


def test_ws_viewers_of_sibling_panes_share_their_window_height(client, mocker):
    """A top/bottom split, each half viewed by a different client: one window,
    one height. The floor is per window (@id), not per pane."""
    calls = []
    mocker.patch("periscope.routes.ws.tmux", side_effect=_fake_tmux(calls))
    subs = _patch_mirror_per_viewer(mocker)
    with contextlib.ExitStack() as a_scope, contextlib.ExitStack() as b_scope:
        a = _viewer(a_scope, client, "%7", 143, 62)
        _viewer(b_scope, client, "%8", 143, 40)
        n = len(calls)
        _ask(a, subs[0], {"type": "resize", "rows": 62})
        assert _resizes(calls, n) == [("%7", None, "40")]
        n = len(calls)
        b_scope.close()
        assert _resizes(calls, n) == [("@3", None, "62")]
