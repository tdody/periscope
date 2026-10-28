"""GET /api/pane (single-pane detail) and POST /api/rename (rename window).

Pane returns the captured screen + every derived field the modal needs
(git state, PR badge, activity timeline, channel reply queue).
Mostly an aggregator over already-cached subsystems.
"""

import os
import re
import time
from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from periscope import config
from periscope.activity import cached_pane_activity, stamp_pane_rename
from periscope.channels import _resolve_window_by_pid, channel_state_for
from periscope.git_pr import cached_git_state, cached_pr_state, linear_ticket_fields
from periscope.log import log
from periscope.panes import (
    list_windows,
    note_action,
    parse_pane,
    smooth_parsed,
)
from periscope.pids import _attach_git_then_resolve_pids
from periscope.routes.send import _send_to_target
from periscope.session_status import pane_claude_pids, session_state_for
from periscope.store import get_window, linear_team_keys, set_window_fields
from periscope.tabs import activate_tab, close_tab, open_tab
from periscope.tmux import _ANSI_SGR_RE, capture, pane_meta, tmux, window_identity
from periscope.turns import get_turns_for_pane, session_id_for_pane

router = APIRouter()


class RenameBody(BaseModel):
    name: str


class NamePinBody(BaseModel):
    pid: str
    pinned: bool


class TabOpenBody(BaseModel):
    pid: str
    path: str
    line: int | None = None


class TabCloseBody(BaseModel):
    pid: str
    path: str


class TabActivateBody(BaseModel):
    pid: str
    tab: str


@router.get("/api/pane")
def pane(session: str, index: int, lines: int = 200):
    """Capture last N lines of a pane plus parsed status fields. Session/index
    passed as query params so slash-bearing session names (e.g. 'tc/foo/bar')
    don't conflict with path routing."""
    target = f"{session}:{index}"
    # -e preserves ANSI escape sequences for the modal viewer. parse_pane
    # handles the colored content itself — it strips for content parsing
    # but uses the raw prompt-line color info to filter ghost-text input.
    content = tmux("capture-pane", "-t", target, "-p", "-e", "-S", f"-{lines}")
    parsed = parse_pane(content)
    try:
        window_name, cwd = pane_meta(target)
    except Exception:
        window_name, cwd = "", ""
    git = cached_git_state(cwd) or {}
    pid_raw, pane_id, window_id = window_identity(target)
    one = [
        {
            "session": session,
            "index": index,
            "name": window_name,
            "active": False,
            "cwd": cwd,
            "pid_raw": pid_raw,
            "pane_id": pane_id,
            "window_id": window_id,
        }
    ]
    _attach_git_then_resolve_pids(one)
    pid = one[0].get("pid")
    pr = cached_pr_state(cwd, git.get("branch")) or {}
    # Shorten $HOME → ~ for display. Done server-side because the browser
    # doesn't know the user's home dir.
    home = os.path.expanduser("~")
    cwd_display = cwd
    if cwd and (cwd == home or cwd.startswith(home + "/")):
        cwd_display = "~" + cwd[len(home) :]
    # Channel data: look up pane_id via list_windows since the route doesn't
    # take it directly. Single iteration is fine — list_windows is cached at
    # tmux's speed (sub-ms) and we already pay it on every state() poll.
    pane_id = ""
    for w in list_windows():
        if w["session"] == session and w["index"] == index:
            pane_id = w.get("pane_id", "")
            break
    smooth_parsed(pane_id=pane_id, parsed=parsed)
    activity = cached_pane_activity(target, pane_id, cwd, git.get("branch"))
    channel = channel_state_for(pane_id)
    # Persisted links — same override semantics as /api/state.
    persisted = get_window(str(pid) if pid else "")
    linked_pr = persisted.get("linked_pr")
    if linked_pr:
        pr = dict(pr)
        pr["pr"] = str(linked_pr)
        pr["pr_linked"] = True
        # ci/ci_checks/pr_base describe the branch's own PR, not the linked
        # one — this route doesn't look up the linked PR's state, so drop
        # them rather than mislabel them under the linked number.
        pr.pop("ci", None)
        pr.pop("ci_checks", None)
        pr.pop("pr_base", None)
    return {
        "content": content,
        "target": target,
        "name": window_name,
        "cwd": cwd_display,
        "cwd_raw": cwd,
        "session": session,
        "pid": pid,
        "pane_id": pane_id,
        "activity": activity,
        "channel_attached": channel["attached"],
        "channel_unread": channel["unread"],
        **linear_ticket_fields(persisted, git.get("branch"), pr.get("pr_title"), linear_team_keys()),
        **parsed,
        **git,
        **pr,
    }


@router.get("/api/pane/turns")
def pane_turns(session: str, index: int):
    """Structured turn transcript for a Claude pane. Full message list per call
    (the client reconciles by uuid). Resolves the pane's SPECIFIC Claude session
    (not just newest-in-cwd — many panes share a cwd). Returns {turns: null} when
    the pane has no live transcript. Session/index are query params so
    slash-bearing session names don't collide with path routing (invariant 6)."""
    out = get_turns_for_pane(session, index)
    return out if out is not None else {"turns": None}


# Tab mutations are granular (open/close/activate) rather than a whole-state
# PUT so a browser action and an MCP open_document landing in the same poll
# window can't clobber each other — the server merges per-operation.
@router.post("/api/pane/tabs/open")
def pane_tabs_open(body: TabOpenBody):
    if not body.pid.strip() or not body.path.strip():
        raise HTTPException(400, "pid and path must be non-empty")
    return {"ok": True, **open_tab(body.pid, body.path, body.line)}


@router.post("/api/pane/tabs/close")
def pane_tabs_close(body: TabCloseBody):
    if not body.pid.strip() or not body.path.strip():
        raise HTTPException(400, "pid and path must be non-empty")
    return {"ok": True, **close_tab(body.pid, body.path)}


@router.post("/api/pane/tabs/activate")
def pane_tabs_activate(body: TabActivateBody):
    if not body.pid.strip() or not body.tab.strip():
        raise HTTPException(400, "pid and tab must be non-empty")
    return {"ok": True, **activate_tab(body.pid, body.tab)}


@router.post("/api/rename")
def rename(session: str, index: int, body: RenameBody):
    target = f"{session}:{index}"
    name = body.name.strip()
    if not name:
        raise HTTPException(400, "empty name")
    tmux("rename-window", "-t", target, name)
    note_action(target)
    # A human chose this name — pin it, so the narrator is locked out for good
    # rather than for RENAME_COOLDOWN_S. A 30-minute cooldown reads as
    # permanent right when you set the name and expires unnoticed; the
    # orchestrator pane was renamed by hand and had drifted through five
    # generated names by the end of the afternoon. The cooldown stamp still
    # goes in: it carries `seen_name`, which is how the narrator knows this
    # rename wasn't its own. Unpin from the rail to hand the name back.
    #
    # The route only has session:index. `pid_raw` is the live @periscope_id
    # stamp — non-empty for any window a poll has seen, which is every window
    # the rail can offer a rename for. Empty means the window died between the
    # two tmux calls, or is brand-new and unstamped: nothing to pin.
    pane_id = tmux("display-message", "-t", target, "-p", "#{pane_id}").strip()
    if pane_id:
        stamp_pane_rename(pane_id, name=name, at=int(time.time()))
    pid = window_identity(target)[0]
    if pid:
        set_window_fields(pid, name_pinned=True)
    else:
        log.warning("rename of %s not pinned: no @periscope_id stamp", target)
    return {"ok": True, "target": target, "name": name, "name_pinned": bool(pid)}


@router.post("/api/name-pin")
def name_pin(body: NamePinBody):
    """Toggle a pane's name pin. Unpinning is the ONLY release — the pin
    survives later renames, because it marks the window as hand-named rather
    than blessing one particular string."""
    pid = body.pid.strip()
    if not pid:
        raise HTTPException(400, "pid must be non-empty")
    # False removes the key rather than storing it (set_window_fields drops
    # None), so an unpinned window is indistinguishable from one never pinned.
    set_window_fields(pid, name_pinned=True if body.pinned else None)
    return {"ok": True, "pid": pid, "name_pinned": body.pinned}


def _slash_arg(setting: str, value: str) -> str:
    """What to type after `/<setting>`, or 400. Effort's "default" is Claude's
    `auto` (the model's own level). The model takes any alias Claude does,
    `default` included, so only the character set is checked — the same
    config.model_env rule as the spawn pin; "auto" is the pin's chooser
    value and means nothing to a running session."""
    v = (value or "").strip()
    if setting == "effort":
        if v in ("default", "auto"):
            return "auto"
        if config.effort_level(v):
            return v
    elif v == "default" or config.model_env(v):
        return v
    raise HTTPException(400, f"{setting} {value!r} is not a valid value")


# What Claude prints under a typed /model or /effort, which is the only way to
# know whether it took. Refusals first: "Not applied" contains "applied".
_REFUSED_RE = re.compile(
    r"Not applied|overrides this session|Failed to set effort|Model switch failed"
    r"|Unknown model|isn't available"
)
_CONFIRM_RE = re.compile(r"Switch model\?|confirmation required")
# "exceeds the cap" is deliberately NOT applied: Claude then runs at the cap,
# not the requested level, and recording the request would mislabel the pane.
_APPLIED_RE = {
    "effort": re.compile(r"(?:Set effort level to|Effort level set to)"),
    "model": re.compile(r"(?:Set model to|Model set to|Model reset to) "),
}
_OUTCOME_WAIT_S = 3.0


def _plain_rows(raw: str) -> list[str]:
    return [_ANSI_SGR_RE.sub("", r).replace("\xa0", " ").strip() for r in raw.split("\n")]


def _command_outcome(target: str, setting: str, command: str, baseline: int) -> tuple[str, str]:
    """("applied" | "confirm" | "refused" | "unverified", Claude's line) for a
    command just typed into `target`, read off the rows under its echo.

    `baseline` is how many times the echo was already on screen before the
    send: an identical command from an earlier pick can still be in the
    capture with its reply, and reading that would report the old outcome.

    "confirm" is `/model` in a session with history: Claude asks before
    switching, because the conversation is re-read at the new model's cost.
    periscope never answers that for the user."""
    echo = f"❯ {command}"
    deadline = time.monotonic() + _OUTCOME_WAIT_S
    while True:
        time.sleep(0.2)
        try:
            rows = _plain_rows(capture(target))
        except Exception:
            rows = []
        hits = [i for i, r in enumerate(rows) if r == echo]
        for line in rows[hits[-1] + 1 :] if len(hits) > baseline else []:
            text = line.lstrip("⎿").strip()
            if _REFUSED_RE.search(text):
                return "refused", text
            if _CONFIRM_RE.search(text):
                return "confirm", text
            if _APPLIED_RE[setting].search(text):
                return "applied", text
        if time.monotonic() >= deadline:
            return "unverified", ""


@router.post("/api/pane/session-setting")
def pane_session_setting(pid: str, setting: Literal["model", "effort"], value: str):
    """Change a RUNNING Claude pane's model or effort by typing `/model <x>` or
    `/effort <x>` into it — the per-pane counterpart of the header pins, which
    only shape new panes.

    Refused (409) unless the pane is a Claude that is idle with an empty input
    box, read fresh from the pane rather than from the 3s poll: keystrokes into
    a busy pane land mid-turn, and into a half-typed message they are appended
    to the user's draft and submitted with it.

    Typing the command is not the same as it taking, so the pane is read back
    (_command_outcome): Claude refusing is a 409, a model switch waiting on
    Claude's own confirmation comes back as result="confirm", and the value is
    remembered on the window only once Claude says it applied. Claude reports
    effort nowhere else periscope can read.
    """
    arg = _slash_arg(setting, value)
    rpid, pane_id, window = _resolve_window_by_pid(pid)
    if not window:
        raise HTTPException(404, f"no live pane for pid {pid!r}")
    target = f"{window['session']}:{window['index']}"
    try:
        raw = capture(target)
        parsed = parse_pane(raw)
    except Exception as e:
        raise HTTPException(500, f"could not read the pane: {e}") from e
    # The session status file is authoritative when the pane maps to a live
    # session (as in window_view); the scrape decides otherwise.
    sess = session_state_for(session_id_for_pane(pane_id))
    if parsed.get("agent") != "claude" and not sess:
        raise HTTPException(409, "not a Claude pane")
    # A local dialog (the "Switch model?" confirm a previous pick left open) is
    # invisible to the session file, and Enter into it answers the dialog.
    if parsed.get("needs_input"):
        raise HTTPException(409, "the pane has a dialog open — answer it first")
    state = sess["state"] if sess else parsed.get("state")
    if state not in ("idle", "done"):
        raise HTTPException(409, f"pane is {state} — try again when it's idle")
    if parsed.get("pending_input"):
        raise HTTPException(409, "the pane has unsent text in its input box")
    command = f"/{setting} {arg}"
    baseline = _plain_rows(raw).count(f"❯ {command}")
    _send_to_target(target, command, ["Enter"])
    outcome, message = _command_outcome(target, setting, command, baseline)
    if outcome == "refused":
        raise HTTPException(409, f"Claude refused {command}: {message}")
    if outcome == "applied":
        # Tied to the claude process it was typed into: a fresh claude in the
        # same pane starts at its own launch values, and window_view drops it.
        # Keyed by @periscope_id and a real pid, or window_view's _while_live
        # can never match it and the pick would show as applied but never land.
        claude_pid = pane_claude_pids().get(pane_id)
        if rpid and claude_pid:
            set_window_fields(rpid, **{f"session_{setting}": {"value": value.strip(), "claude_pid": claude_pid}})
    return {"ok": True, "pid": rpid or pid, "sent": command, "result": outcome, "message": message}
