"""WS /ws/pane — bridges xterm.js to a tmux pane via the control-mode mirror.

Initial paint mirrors tmux's screen state (size, cursor, alt-screen) so the
blob renders into an xterm state matching tmux's. Live bytes and
self-healing reconcile frames come from periscope.tmux_mirror — any mirror
desync heals at the next frame, so this handler no longer needs the byte
stream to be perfect, only the frames to keep coming. Design spec:
docs/superpowers/specs/2026-06-10-terminal-mirror-reconciliation-design.md
"""

import asyncio
import contextlib
import json
import threading

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from periscope import state_hub, tmux_input, tmux_mirror
from periscope.log import _bg, _task, log
from periscope.panes import note_action
from periscope.tmux import tmux

router = APIRouter()


def _size_message(size: tmux_mirror.PaneSize) -> str:
    return json.dumps({"type": "size", "cols": size.cols, "rows": size.rows})


# Every resize of a viewed window, as one tmux invocation's argv: callers may
# chain more commands onto it. No cols resizes the height alone
# (`resize-window -y`), keeping the window's width — see the resize message.
def _resize_argv(target: str, cols: int | None, rows: int) -> list[str]:
    width = ["-x", str(cols)] if cols else []
    return ["setw", "-t", target, "window-size", "manual", ";", "resize-window", "-t", target, *width, "-y", str(rows)]


class _WindowHeights:
    """Each live /ws/pane viewer's last asked rows, by the window it views.

    A window has one height, and each of its viewers asks for its own
    container's: resize-window applies an ask to the whole window. Left to the
    clients, the last ask won and nothing gave a height back — when the shorter
    of two viewers left, the window kept its height and the other viewer a
    blank band under the pane, since a client undoes only its own shrinks and
    sees no other viewer leave. So a window takes its smallest live viewer's
    ask, re-applied when a viewer asks again or leaves. The width stays the
    last ask's. Read from the event loop and executor threads, hence the lock.
    """

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._asks: dict[object, tuple[str, str, int]] = {}  # viewer -> (window @id, pane %id, rows)

    def ask(self, viewer: object, window: str, pane: str, rows: int) -> None:
        with self._lock:
            self._asks[viewer] = (window, pane, rows)

    def floor(self, window: str | None) -> int:
        """The smallest live ask on `window`; 0 when it has none."""
        with self._lock:
            return min((r for w, _p, r in self._asks.values() if w == window), default=0)

    def window_of(self, pane: str) -> str | None:
        """The window a live viewer of `pane` saw it in: known before our own meta is."""
        with self._lock:
            return next((w for w, p, _r in self._asks.values() if p == pane), None)

    def leave(self, viewer: object) -> str | None:
        """Forget `viewer`. Its window when it was holding it down (the viewers
        left all ask more), else None: a window's last viewer leaving restores
        nothing (see ws_pane)."""
        with self._lock:
            window, _pane, rows = self._asks.pop(viewer, (None, None, 0))
            rest = [r for w, _p, r in self._asks.values() if w == window]
        return window if rest and min(rest) > rows else None


_HEIGHTS = _WindowHeights()
# Serializes the resizes that apply a floor, each reading it inside: two
# computed apart could land in either order, the stale floor last.
_RESIZE_LOCK = threading.Lock()


def _apply_floor(target: str, window: str, cols: int | None = None) -> None:
    """Resize `target`'s window to `window`'s floor, and to `cols` if given.
    The resize's %layout-change makes the mirror reconcile every subscribed
    pane, which announces the new size to each viewer."""
    with _RESIZE_LOCK, contextlib.suppress(Exception):
        rows = _HEIGHTS.floor(window)
        if rows:
            tmux(*_resize_argv(target, cols, rows))


@contextlib.asynccontextmanager
async def _viewing(viewer: object, window: str, pane: str, rows: int):
    """Hold `viewer`'s ask (`rows`; 0 = none yet) while it views `window`, and
    on leaving give back the height it held the window down to."""
    if rows:
        _HEIGHTS.ask(viewer, window, pane, rows)
    try:
        yield
    finally:
        held = _HEIGHTS.leave(viewer)
        if held:
            # A thread, not an awaited executor job: a handler being cancelled
            # (shutdown, the test client's close) drops the await.
            _bg("ws-pane-height", _apply_floor, held, held)


@router.websocket("/ws/state")
async def ws_state(websocket: WebSocket):
    """Push the dashboard state blob (the /api/state payload) on the hub's
    clock. Replaces the browser's 3s poll; the REST endpoint stays as fallback.
    """
    await websocket.accept()
    q = state_hub.subscribe()

    # A reader task so a client disconnect is noticed promptly even between
    # ticks (the send loop alone would only see it on the next blob).
    async def drain_in():
        with contextlib.suppress(Exception):
            while True:
                msg = await websocket.receive()
                if msg.get("type") == "websocket.disconnect":
                    break

    reader = _task("ws-state-reader", drain_in())
    try:
        while True:
            blob = await q.get()
            await websocket.send_text(blob)
    except (WebSocketDisconnect, RuntimeError):
        # RuntimeError: send after the socket closed (reader saw disconnect).
        pass
    finally:
        reader.cancel()
        state_hub.unsubscribe(q)


@router.websocket("/ws/pane")
async def ws_pane(
    websocket: WebSocket,
    pane_id: str,
    cols: int = 0,
    rows: int = 0,
):
    await websocket.accept()
    # The terminal address is the stable tmux pane id (%N), not the
    # session:index composite: under the shared session with
    # `renumber-windows on`, a window's index drifts on every kill/new
    # — which would stale an OPEN terminal mid-stream. Pane ids never
    # drift. tmux accepts %id for pane commands (capture-pane,
    # display-message, send-keys) and resolves it to its window for
    # window commands (resize-window, setw).
    target = pane_id
    loop = asyncio.get_running_loop()

    # Periscope owns the pane width. Once we resize a window to the modal's
    # dims, we LEAVE IT THERE — no restore when its last viewer disconnects.
    # Rationale: the save/restore dance only matters if a real terminal is
    # also attached at a different size, but in periscope-primary workflows
    # the restore just causes churn — each modal open/close pair would reflow
    # the buffer twice, and reflows during streaming produce duplicated table
    # fragments in Claude's scrollback. Holding the pane at periscope's size
    # means subsequent opens at the same width are no-ops. (A viewer that held
    # a shared window's height down does give it back: _WindowHeights.)
    # A tmux invocation runs its `;`-separated commands in order, so pairing
    # them costs one fork instead of two. Each fork is ~20ms — measurable on
    # the pane-switch path, where this runs on every connect.
    viewer = object()  # this socket, to _HEIGHTS
    asked_rows = rows if cols > 0 and rows > 0 else 0

    # 1+2) One fork: resize to the client's hint, then read tmux's view of the
    #    pane back. The resize must land BEFORE the initial capture or box-
    #    drawing TUIs mangle on the first frame, and chaining guarantees that
    #    ordering — display-message reports the post-resize geometry.
    #    The meta itself is size, cursor and alt-screen (all three needed to
    #    render the initial blob into a matching xterm state) plus
    #    #{session_name}/#{window_index} for the mirror subscription (keyed on
    #    session NAME) and the recency stamp (keyed on session:index, NOT the
    #    %pane_id address — window_view reads recency_stamps_for(
    #    f"{session}:{index}")), and #{window_id} for the window's height
    #    (_HEIGHTS: an index drifts). If the pane is gone, close: the client's
    #    reconnect FSM handles it.
    meta_fmt = (
        "#{pane_width}|#{pane_height}|#{cursor_x}|#{cursor_y}"
        "|#{alternate_on}|#{pane_id}|#{session_name}|#{window_index}"
        "|#{mouse_any_flag}|#{window_id}"
    )

    def size_then_meta(c: int, r: int) -> str:
        if c > 0 and r > 0:
            out = tmux(*_resize_argv(target, c, r), ";", "display-message", "-t", target, "-p", meta_fmt)
            # tmux aborts the chain at the first failing command. A resize
            # failure has always been non-fatal here, so don't let it take the
            # handshake down — re-ask for the meta on its own.
            if out.strip():
                return out
        return tmux("display-message", "-t", target, "-p", meta_fmt)

    def handshake() -> str:
        # Under the resize lock, so no other resize lands between the floor
        # read and ours. A live viewer of this pane names its window, and the
        # hint takes that window's floor: not our height and then the shorter
        # viewer's again, two Claude redraws for every viewer. A sibling
        # pane's viewer isn't known before our meta; if its pane no longer
        # fits, its client asks the window back down.
        with _RESIZE_LOCK:
            floor = _HEIGHTS.floor(_HEIGHTS.window_of(pane_id))
            return size_then_meta(cols, min(rows, floor) if floor else rows)

    try:
        meta = await loop.run_in_executor(None, handshake)
        fields = meta.strip().split("|")
        (cols_s, rows_s, cx_s, cy_s, alt_s, _pane_id, session_name, window_index, mouse_s, window_id) = fields
        cols, rows = int(cols_s), int(rows_s)
        cx, cy = int(cx_s), int(cy_s)
        alt_on = alt_s == "1"
        # tmux consumes the app's mouse-mode DECSET (that's why it's a pane
        # flag), so the xterm mirror never sees `\e[?1003h` and can't forward
        # wheel as mouse events — it converts them to arrows instead. Tell the
        # client the pane's mouse state so it can synthesize wheel reports.
        mouse_on = mouse_s == "1"
    except Exception as e:
        # Usually the pane died between the poll that listed it and this
        # connect, which the client's reconnect FSM handles. But a caller that
        # forgot to percent-encode the `%` of a pane id lands here too, and a
        # bare close() — code 1000, no reason — makes that indistinguishable
        # from a clean shutdown. Name it.
        log.warning("ws/pane handshake failed for target=%r (%s)", target, e)
        await websocket.close()
        return

    # Opening a terminal is the canonical "opened in periscope" action.
    # Stamp it on the recency map's session:index key (window_view's read
    # key), now that we've parsed it — a %pane_id key would be a dead write.
    note_action(f"{session_name}:{window_index}")

    # Armed with the size the client is about to be told: from then on, a
    # reconcile that finds the pane at other dims (split, sibling killed, our
    # own resize-window landing on a split window) announces it ahead of its
    # frame. Armed AT subscribe — the connect-time reconcile is requested
    # there, and arming after the first await let it land unannounced.
    size = tmux_mirror.PaneSize(cols=cols, rows=rows)
    sub = await tmux_mirror.subscribe(session_name, pane_id, size=size)
    async with sub, _viewing(viewer, window_id, pane_id, asked_rows):
        await websocket.send_text(_size_message(size))
        await websocket.send_text(json.dumps({"type": "mouse", "on": mouse_on}))

        # 3) Initial paint, via the fork path — NOT the control client: a
        #    50k-history `-e` capture can run multi-MB, and tmux holds all
        #    %output for the whole session until a reply block completes.
        #    The capture-vs-subscribe byte gap this allows is healed by the
        #    mirror's connect-time reconcile moments later; only scrollback
        #    can miss those few bytes.
        #    `-S -N` asks for N lines of scrollback; tmux clamps to the
        #    pane's history-limit.
        # -N preserves trailing spaces; without it capture-pane strips them and
        # the cursor row renders short while the cursor goes to tmux's true
        # column, leaving a one-cell gap (see tmux_mirror._fire_reconcile).
        initial = await loop.run_in_executor(
            None, lambda: tmux("capture-pane", "-t", target, "-p", "-e", "-N", "-S", "-10000")
        )
        # capture-pane separates lines with \n AND appends one more \n
        # after the final line. Strip exactly that final terminator and
        # convert internal \n to \r\n so xterm wraps each line back to
        # column 0 instead of staircasing. Strip too many → blank lines at
        # the bottom vanish and the cursor lands a row high; too few → the
        # trailing \r\n scrolls one row past the bottom.
        if initial:
            if initial.endswith("\n"):
                initial = initial[:-1]
            body = initial.replace("\n", "\r\n")
        else:
            body = ""
        prefix = ""
        if alt_on:
            prefix += "\x1b[?1049h"  # enter alt-screen buffer
        prefix += "\x1b[2J\x1b[H"  # clear screen, home cursor
        # ANSI positioning is 1-indexed; tmux's #{cursor_x/y} are 0-indexed.
        suffix = f"\x1b[{cy + 1};{cx + 1}H"
        await websocket.send_bytes((prefix + body + suffix).encode("utf-8", errors="replace"))

        # 4) Mirror → websocket. On EOF (pane died, mirror died, shutdown)
        #    close the socket — strictly more honest than the old silent
        #    FIFO; the client's reconnect FSM takes it from there.
        async def forward_out():
            async for chunk in sub:
                if isinstance(chunk, tmux_mirror.PaneSize):
                    await websocket.send_text(_size_message(chunk))
                else:
                    await websocket.send_bytes(chunk)
            with contextlib.suppress(Exception):
                await websocket.close()

        forward_task = _task("ws-forward", forward_out())

        # 5) Keystrokes from the client → tmux. xterm.js's onData sends raw
        #    input including escape sequences. Queue + single drain task so
        #    fast typing / paste coalesces into one control-mode send per
        #    drain cycle while the previous send is in flight.
        keystroke_q: asyncio.Queue[str] = asyncio.Queue()

        async def drain_input():
            while True:
                first = await keystroke_q.get()
                batch = [first]
                while not keystroke_q.empty():
                    batch.append(keystroke_q.get_nowait())
                await tmux_input.send(target, "".join(batch))

        drain_task = _task("ws-deliver", drain_input())

        try:
            while True:
                msg = await websocket.receive()
                if msg.get("type") == "websocket.disconnect":
                    break
                text = msg.get("text")
                if text is None and msg.get("bytes") is not None:
                    text = msg["bytes"].decode("utf-8", errors="replace")
                if not text:
                    continue
                # Resize control message ({"type":"resize",...}). Plain
                # keystrokes are never JSON, so the parse filters them.
                if text.startswith("{"):
                    try:
                        ctrl = json.loads(text)
                    except Exception:
                        ctrl = None
                    # Explicit repaint (⌘R with a terminal focused). The mirror
                    # already self-heals on a timer; this is the manual pull for
                    # when it has visibly drifted and you don't want to wait.
                    if isinstance(ctrl, dict) and ctrl.get("type") == "reconcile":
                        sub.request_reconcile()
                        continue
                    # No cols: a height-only ask (the client's resizeAsk), which
                    # keeps the window's width. Our pin in it set a shared
                    # window's width from a shorter viewer's every shrink. The
                    # height is the window's floor, this ask among it.
                    if isinstance(ctrl, dict) and ctrl.get("type") == "resize":
                        rc = int(ctrl.get("cols") or 0) or None
                        rr = int(ctrl.get("rows") or 0)
                        if rr > 0:
                            _HEIGHTS.ask(viewer, window_id, pane_id, rr)
                            await loop.run_in_executor(None, _apply_floor, target, window_id, rc)
                            # Reflow redraws can race the relay; an
                            # authoritative frame settles the result.
                            sub.request_reconcile()
                        continue
                keystroke_q.put_nowait(text)
        except WebSocketDisconnect:
            pass
        finally:
            forward_task.cancel()
            drain_task.cancel()
