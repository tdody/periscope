# Native Notifications 2b, PR 2: Agent-Acting Buttons (THI-422) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Native banners gain the buttons that make an agent act:
- **Allow / Deny** on a permission dialog;
- **Reply** on an agent's question;
- **Ask agent to fix** on a red PR.

The server re-checks the live pane each time one is pressed, so a stale banner can only reveal the pane. It never answers the wrong dialog.

**Architecture:**
- **The hook.** A Claude `PermissionRequest` hook, `pane_permission_hook.py`, records which request each pane's dialog asks about. It writes to `pane_permissions` in `periscope.db` and prints nothing.
- **Publishing.** `window_view.pending_permission_for` publishes `w.pending_permission` only when exactly one row fits the pane's current permission wait.
- **The routes.** `routes/pane_actions.py` adds `POST /api/pane/permission` and `POST /api/pane/reply`, JSON bodies only.
  - They find the pane by pid. `pids.window_by_pid` moves out of `channels`, so the route doesn't import the MCP module.
  - Before sending a key, they recompute the request id from the DB and read a fresh capture with `panes.permission_dialog` / `panes.dialog_open`.
- **The JS.** `copy.js` names the new categories and `actions.js` registers their buttons. A press goes out as a POST through a status-aware `util.postJson`; a 409 reveals the pane.
- **No Rust changes.** PR 1's shell registers whatever category set the webview sends (`auth` / `foreground` / `destructive` / `reply`) and reports a reply button's typed text (checked in `src-tauri/src/notifications.rs`). So PR 2 is JS and server only, with no `.app` rebuild.

**Tech Stack:**
- Python: FastAPI, pydantic, sqlite3, pytest, ruff, ty.
- JS: Preact + `@preact/signals`, vitest, Biome.
- Shell: the POSIX `sh` in `bin/periscope`.

**Spec:** `docs/superpowers/specs/2026-10-26-native-notifications-2b-design.md`, its PR 2 sections. Where this plan refines them, "Settled in planning" below says how, and Task 8 writes it into the spec.

---

## Conventions

- **Worktree.** Use `.claude/worktrees/notify-permission` on branch `feature/notify-permission`, and run every command from there.
- **Commits.** One per task: a single-line message, a blank line, then `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`. Never commit `package-lock.json`.
- **Gate:**
  - `bin/check` must end with `✓ all checks passed`.
  - **Never run `bin/check --fix`.** Formatting the files you touched is fine: `uv run ruff format <files>`.
  - `npm test` and `uv run pytest -q` must pass.
- **Imports:**
  - JS: Biome's organizeImports order (case-insensitive). Check with `npx biome check --formatter-enabled=false <files>`.
  - Python: ruff's isort. A comment inside an import block fails `I001`, so put the comment elsewhere.
- **Comments.** Explain *why*, tersely, as the surrounding code does.
- **Read before editing:**
  - `docs/invariants.md`:
    - 5: a paste goes in first, then Enter, which is what `_send_to_target` does;
    - 11: `session:index` targets renumber, so find a pane by pid and build its target just before sending.
  - `docs/channels.md`, "Pane → session mapping". The new hook is `pane_session_hook.py`'s sibling.
  - `docs/testing.md`, the no-leaked-thread rule. These tests use `fresh_activity_db` and the route `client` fixture. That fixture never runs the lifespan, so the tests start no threads.
- **Rust:** none (see Architecture).

## Notes

- **Auto mode is the default** in Claude Code 2.1.280. Permission prompts, and so Allow / Deny banners, appear only:
  - in panes in manual (default) mode;
  - when auto mode defers to you.

  The hand checks need a pane switched out of auto mode.
- **The hook covers only the sessions that have loaded it.** The two docs disagree on when that happens, and Task 9's hand check settles it:
  - the spec says Claude reads hooks at session start, so only sessions started after `bin/periscope install-hook`;
  - `docs/channels.md` says Claude loads new hooks live.

  Either way, a pane without the hook gets the Open-only banner.
- **`parse_pane`'s footer gap is a follow-up, not this PR.**
  - The permission dialog's footer, `Esc to cancel · Tab to amend`, is outside `NEEDS_INPUT_FOOTER_RE`'s family (`Enter to select · … · Esc to cancel`).
  - So `parse_pane` doesn't read an *unmapped* pane (one with no session file) as needs-input while a permission dialog is up. The dialog also covers the status line, so it can read as a shell.
  - Mapped panes are unaffected, because the session file's state wins.
  - PR 2 adds `panes.permission_dialog` beside `parse_pane` and leaves `parse_pane` alone. File a ticket to teach it, with a `tests/test_panes.py` case built from `tests/fixtures/permission_dialogs/bash.txt`.
- **The hook writes prod's `periscope.db` only**, as `pane_session_hook.py` does, because it can't know which instance is looking. A dev server (:17375, `periscope-dev.db`) never publishes `pending_permission`, so Allow / Deny can be tested end to end only on prod.
- **Allow on tools other than Bash and the file tools is unverified.** It relies on the dialog showing the summary's first 40 characters: WebFetch's URL, or an MCP tool's first string argument. If the dialog doesn't show it, Allow answers 409 and reveals the pane, the conservative failure.

## Settled in planning (refinements to the spec's PR 2)

These were checked against real dialogs captured from Claude Code 2.1.280 on a throwaway tmux socket.

- **What `permission_dialog` recognises.**
  - The current footer is outside the `_detect_needs_input` family, so the dialog is recognised by its own shape: a `Do you want to …?` question line, `❯ 1. Yes` on the next line, and an `Esc to cancel` footer among the last two non-empty lines.
  - The spec says to find the footer with `_detect_needs_input` plus the question line, but that can't see this footer.
- **The text it returns** runs from the full-width `─` rule Claude draws above the dialog down to the footer.
  - Not from the question line: Bash's command sits *above* the question.
  - Never further up: the scrollback's `⏺ Bash(touch probe.txt)` can quote the same command, and must not vouch for a different dialog.
- **The screen token.**
  - For Edit / Write / NotebookEdit, it's the file's basename: the dialog shows a path relative to the cwd, and the hook stores it absolute.
  - For anything else, it's the summary's first 40 characters.
  - Both sides are compared with **all** whitespace removed, not collapsed, since a long line wraps mid-word onto an indented row.
- **A file tool's summary keeps the path's end** when it's clipped to 80 characters, so the basename survives.
- **Reply's dialog check** is `panes.dialog_open`: `_detect_needs_input` OR `permission_dialog`.
- **Both endpoints answer 415** to a body that isn't `Content-Type: application/json`.
  - The spec relies on a JSON body needing a CORS preflight.
  - But FastAPI parses a body sent with *no* Content-Type as JSON. A `fetch` with a typeless Blob body is a CORS simple request, so without the explicit check the preflight argument wouldn't hold.
- **Deny sends `Escape`.** Verified: the pane then shows `Interrupted · What should Claude do instead?` and waits. "No" is option 4 for Bash and option 3 for Write, so a number is never sent for it.
- **Allow sends a bare `1`.** Verified: it approves at once, with no Enter.
- **The `question` category's reply placeholder is a fixed "Reply…".** The spec has "Reply to {pane}…", but macOS categories are static, so it can't name the pane.
- **`ci_failed` with a live pane and no URL** gets a new category, `ci_failed_fix`, with Ask agent to fix only.
- **`install-claude-hook` joins only a matcher-less hook group.** Before, it joined `groups[0]`, so a user's own matcher-scoped `PermissionRequest` group (a `"Bash"` one, say) would have silently narrowed ours. This applies to every event the command installs, but only changes fresh installs, since installed entries are found by marker and skipped.
- **`channels.py` imports `window_by_pid as _resolve_window_by_pid`.**
  - The old name keeps working for its four call sites, for `routes/pane.py` and `routes/sessions.py`, and for the ~25 tests that patch `periscope.channels._resolve_window_by_pid`.
  - Pointing those two routes at `pids` too is optional cleanup, left out.

---

### Task 0: Worktree

- [ ] **Step 1:** Create it and install.

```bash
cd ~/github/tomplex/periscope
git worktree add .claude/worktrees/notify-permission -b feature/notify-permission main
cd .claude/worktrees/notify-permission && npm install --silent && uv sync -q && git checkout -- package-lock.json
npx vitest run static/src/notify && uv run pytest -q tests/test_panes.py tests/test_window_view.py tests/test_pids.py
```

Expected: the vitest notify suites pass, and pytest reports every test passed.

---

### Task 1: Recognise a permission dialog on screen

**Files:**
- Create: `tests/fixtures/permission_dialogs/bash.txt`, `tests/fixtures/permission_dialogs/write.txt`
- Modify: `periscope/panes.py`:
  - the imports;
  - new constants after `NEEDS_INPUT_FOOTER_RE` (about line 302);
  - three functions after `_detect_needs_input` (about line 477).
- Test: `tests/test_panes.py`

- [ ] **Step 1: Create the fixtures.**
  - They're real `tmux capture-pane -p` captures from Claude Code 2.1.280.
  - The long scratch path is replaced by `/tmp/probe`. Option 2's path is padded under `/tmp/probe` so it still wraps mid-word at 110 columns, as the live capture did.
  - The NBSP after `⎿` is written as a plain space, and trailing blank lines are trimmed.
  - Create them with these heredocs, so every character lands verbatim:

```bash
mkdir -p tests/fixtures/permission_dialogs
cat > tests/fixtures/permission_dialogs/bash.txt <<'EOF'
 ▐▛███▛█   Claude Code v2.1.280
▝▜██████▀  Opus 5.5 (1M context) · Claude Max
  ▝▝ ▝▝    /tmp/probe


❯ Use the Bash tool to run exactly this command and nothing else: touch probe.txt

⏺ Bash(touch probe.txt)
  ⎿  Waiting…

──────────────────────────────────────────────────────────────────────────────────────────────────────────────
 Bash command
 Tip: auto mode handles these prompts for you — choose "switch to auto mode" below

   touch probe.txt
   Create empty probe.txt file

 Do you want to proceed?
 ❯ 1. Yes
   2. Yes, and always allow access to /tmp/probe/permission-dialog-fixture-with-a-deliberately-long-subdirecto
      ry/dialog-probe from this project
   3. Yes, and switch to auto mode · auto mode handles these prompts for you
   4. No

 Esc to cancel · Tab to amend
EOF
cat > tests/fixtures/permission_dialogs/write.txt <<'EOF'
 ▐▛███▛█   Claude Code v2.1.280
▝▜██████▀  Opus 5.5 (1M context) · Claude Max
  ▝▝ ▝▝    /tmp/probe


❯ Use the Bash tool to run exactly this command and nothing else: touch probe.txt

⏺ Bash(touch probe.txt)
  ⎿  Interrupted · What should Claude do instead?

✻ Cogitated for 1s · done 3:37 PM

❯ Run it now: touch probe.txt

⏺ Bash(touch probe.txt)
  ⎿  Done

⏺ I ran touch probe.txt and it finished without errors, so probe.txt now exists in the working directory.

✻ Sautéed for 4s · done 3:38 PM

❯ Use the Write tool to create notes.md containing the single word hello

⏺ Write(notes.md)

──────────────────────────────────────────────────────────────────────────────────────────────────────────────
 Create file
 notes.md
╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌
  1 hello
╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌
 Do you want to create notes.md?
 ❯ 1. Yes
   2. Yes, and switch to accept edits (auto-approve file edits and common file commands) for this session
      (shift+tab)
   3. No

 Esc to cancel · Tab to amend
EOF
shasum -a 256 tests/fixtures/permission_dialogs/*.txt
```

Expected:

```
ed37fbf55fec8b5c45caaee0af4f76a646461592ad728c3433f2f4788db54c18  tests/fixtures/permission_dialogs/bash.txt
7042456e36584754dbfd4fd05dad4f5f51820908a77a4c80ef2785bb5ae1943f  tests/fixtures/permission_dialogs/write.txt
```

A different hash means a character was mangled; recreate the file before going on.

- [ ] **Step 2: Write the failing tests.** In `tests/test_panes.py`:

1. Change `import textwrap` / blank line / `import pytest` to:

```python
import textwrap
from pathlib import Path

import pytest
```

2. In the `from periscope.panes import (…)` list:
   - add `dialog_open,` and `dialog_shows,` after `_spinner_last_seen,`;
   - add `permission_dialog,` after `parse_pane,`.
3. Append to the end of the file:

```python


# ── Permission dialogs (a banner's Allow / Deny; routes/pane_actions.py) ──
# Real captures from Claude Code 2.1.280 (`tmux capture-pane -p`), the scratch
# path replaced by /tmp/probe. Bash's option 2 wraps mid-word, as it did live.

_DIALOGS = Path(__file__).parent / "fixtures" / "permission_dialogs"
_RULE = "─" * 60
# An idle Claude pane: no dialog, the input box at the bottom.
_IDLE = "\n".join(
    [
        "⏺ Done — notes.md is written.",
        "",
        "✻ Brewed for 3s",
        "",
        _RULE,
        "❯ ",
        _RULE,
        "  ⏵⏵ auto mode on (shift+tab to cycle)",
    ]
)
# A reply quoting a dialog verbatim: every marker is there, but the input box
# is below it, so it isn't on screen as a dialog.
_QUOTED = "\n".join(
    [
        "⏺ The prompt read:",
        "",
        " Do you want to proceed?",
        " ❯ 1. Yes",
        "   2. No",
        "",
        " Esc to cancel · Tab to amend",
        "",
        _RULE,
        "❯ ",
        _RULE,
        "  ⏵⏵ auto mode on (shift+tab to cycle)",
    ]
)
# AskUserQuestion: a choice dialog, not a permission one.
_ASK = "\n".join(
    [
        _RULE,
        " ☐ Database",
        "",
        "Which database should I use?",
        "",
        "❯ 1. Postgres",
        "  2. SQLite",
        "",
        "Enter to select · ↑/↓ to navigate · Esc to cancel",
    ]
)


def _dialog(name: str) -> str:
    return (_DIALOGS / name).read_text()


def test_permission_dialog_reads_a_bash_prompt_from_its_rule_to_its_footer():
    dialog = permission_dialog(_dialog("bash.txt"))
    assert dialog is not None
    rows = dialog.splitlines()
    assert rows[0] == " Bash command"
    assert "   touch probe.txt" in rows
    assert rows[-1] == " Esc to cancel · Tab to amend"
    # Not the scrollback above the rule: `⏺ Bash(touch probe.txt)` quotes the
    # same command and must not vouch for whatever dialog is up.
    assert "⏺" not in dialog


def test_permission_dialog_reads_a_write_prompt():
    dialog = permission_dialog(_dialog("write.txt"))
    assert dialog is not None
    assert " notes.md" in dialog.splitlines()
    assert " Do you want to create notes.md?" in dialog.splitlines()


def test_permission_dialog_strips_the_capture_colours():
    # capture() keeps SGR escapes (-e); the live dialog colours ❯ and Yes.
    coloured = _dialog("bash.txt").replace(
        " ❯ 1. Yes",
        " \x1b[38;2;177;185;249m❯\x1b[39m \x1b[38;2;153;153;153m1.\x1b[39m \x1b[38;2;177;185;249mYes\x1b[39m",
    )
    dialog = permission_dialog(coloured)
    assert dialog is not None
    assert "\x1b" not in dialog


@pytest.mark.parametrize("screen", [_IDLE, _QUOTED, _ASK, ""], ids=["idle", "quoted", "ask", "empty"])
def test_permission_dialog_is_none_without_one(screen):
    assert permission_dialog(screen) is None


def test_dialog_open_sees_permission_and_choice_dialogs():
    assert dialog_open(_dialog("bash.txt"))
    assert dialog_open(_dialog("write.txt"))
    assert dialog_open(_ASK)
    assert not dialog_open(_IDLE)
    assert not dialog_open(_QUOTED)


def test_dialog_shows_the_bash_command_it_asks_about():
    dialog = permission_dialog(_dialog("bash.txt"))
    assert dialog_shows(dialog, "Bash", "touch probe.txt")
    assert not dialog_shows(dialog, "Bash", "rm -rf build")
    assert not dialog_shows(dialog, "Bash", "")


def test_dialog_shows_a_long_command_across_a_mid_word_wrap():
    # The token is the summary's first 40 characters; the dialog wrapped
    # inside them, onto an indented row.
    wrapped = _dialog("bash.txt").replace(
        "   touch probe.txt", "   python3 scripts/regenerate_fix\n   tures.py --source /tmp/probe/captures --out tests"
    )
    dialog = permission_dialog(wrapped)
    assert dialog is not None
    assert dialog_shows(
        dialog, "Bash", "python3 scripts/regenerate_fixtures.py --source /tmp/probe/captures --out tests"
    )


def test_dialog_shows_a_file_by_its_basename():
    # The dialog shows the path relative to the cwd; the hook stores it absolute.
    dialog = permission_dialog(_dialog("write.txt"))
    assert dialog_shows(dialog, "Write", "/tmp/probe/notes.md")
    assert dialog_shows(dialog, "Write", "…/a/clipped/very/long/path/notes.md")
    assert not dialog_shows(dialog, "Write", "/tmp/probe/other.md")


def test_the_keys_pane_actions_sends_select_what_they_should():
    # Allow sends `1`: option 1 is Yes in every dialog. Deny sends Escape,
    # never a number: No is option 4 for Bash and 3 for Write.
    bash = permission_dialog(_dialog("bash.txt")).splitlines()
    write = permission_dialog(_dialog("write.txt")).splitlines()
    assert " ❯ 1. Yes" in bash and " ❯ 1. Yes" in write
    assert "   4. No" in bash and "   3. No" in write
```

- [ ] **Step 3: Run it and confirm it fails.**

Run: `uv run pytest tests/test_panes.py -q`

Expected: a collection error, `ImportError: cannot import name 'dialog_open' from 'periscope.panes'`.

- [ ] **Step 4: Implement.** Make these edits in `periscope/panes.py`.

**(a)** Change the stdlib imports from `import re` / `import time` to:

```python
import os
import re
import time
```

**(b)** Directly after the `NEEDS_INPUT_FOOTER_RE = re.compile(…)` statement, before `RECAP_RE`, insert:

```python

# A permission dialog (Bash, Write, Edit, …), which a native banner's Allow /
# Deny answers (routes/pane_actions.py). Its footer, "Esc to cancel · Tab to
# amend" in 2.1.280, is outside NEEDS_INPUT_FOOTER_RE's family, so it's known
# by its own shape: a "Do you want to …?" question, "❯ 1. Yes" on the next
# line, and the footer ending the screen. Any one of them can turn up in a
# reply; a dialog Claude quotes in a reply still has the input box below it.
PERMISSION_QUESTION_RE = re.compile(r"^\s*Do you want to .+\?\s*$")
PERMISSION_YES_RE = re.compile(r"^\s*❯\s*1\.\s+Yes\b")
DIALOG_CANCEL_RE = re.compile(r"\bEsc\s+to\s+cancel\b")
# The full-width rule Claude draws above the dialog: where its text starts.
DIALOG_RULE_RE = re.compile(r"^\s*─{20,}\s*$")
# Lines the question can sit above the footer: the options under it wrap
# (Bash's "always allow access to <dir>" does), but not past a dozen.
_PERMISSION_TAIL = 12
# Tools whose dialog names the file relative to the cwd, while the hook
# records it absolute (pane_permission_hook.py): matched on the basename.
_FILE_TOOLS = frozenset({"Edit", "Write", "NotebookEdit"})
_WS_RE = re.compile(r"\s+")
```

**(c)** Directly after `def _detect_needs_input(…)`, whose last line is `return any(NEEDS_INPUT_FOOTER_RE.search(line) for line in lines[-5:])`, insert:

```python


def permission_dialog(content: str) -> str | None:
    """The permission dialog on screen, as its lines from below the rule
    Claude draws above it down to its "Esc to cancel" footer, or None when
    there isn't one. `content` is a capture; SGR escapes are stripped here.

    From the rule, not the question: Bash's command sits above the question
    line. Never further up: the scrollback's `⏺ Bash(touch probe.txt)` can
    quote the same command, and must not vouch for a different dialog."""
    _raw, _plain, lines = _split_buffers(content)
    # The footer ends the screen (a status row may follow it).
    tail = range(len(lines) - 1, max(len(lines) - 3, -1), -1)
    footer = next((i for i in tail if DIALOG_CANCEL_RE.search(lines[i])), None)
    if footer is None:
        return None
    above = range(footer - 1, max(footer - 1 - _PERMISSION_TAIL, -1), -1)
    question = next((i for i in above if PERMISSION_QUESTION_RE.match(lines[i])), None)
    if question is None or not PERMISSION_YES_RE.match(lines[question + 1]):
        return None
    top = next((i for i in range(question - 1, -1, -1) if DIALOG_RULE_RE.match(lines[i])), None)
    if top is None:
        return None
    return "\n".join(lines[top + 1 : footer + 1])


def dialog_open(content: str) -> bool:
    """Whether any Claude dialog is up in a capture: a choice dialog's footer
    (AskUserQuestion and its family) or a permission dialog. Text typed into
    one picks an option — `1 sounds good` + Enter answers "Yes" — so
    POST /api/pane/reply refuses while one is open."""
    _raw, _plain, lines = _split_buffers(content)
    return _detect_needs_input(lines) or permission_dialog(content) is not None


def dialog_shows(dialog: str, tool: str, summary: str) -> bool:
    """Whether a permission dialog's text names the request the hook recorded:
    the file's basename for a file tool, else the summary's first 40
    characters. All whitespace is dropped on both sides, since a long line
    wraps mid-word onto an indented row. This is what stops a stale row from
    approving a different dialog that happens to be up."""
    token = os.path.basename(summary) if tool in _FILE_TOOLS else summary[:40]
    token = _WS_RE.sub("", token)
    return bool(token) and token in _WS_RE.sub("", dialog)
```

`_split_buffers` is defined earlier in the file (about line 400), so these can call it.

- [ ] **Step 5: Run the tests and confirm they pass.**

Run:

```bash
uv run pytest tests/test_panes.py -q
uv run ruff format periscope/panes.py tests/test_panes.py && uv run ruff check periscope/panes.py tests/test_panes.py
```

Expected: `37 passed`; ruff reports `All checks passed!`.

- [ ] **Step 6: Commit.**

```bash
git add tests/fixtures/permission_dialogs periscope/panes.py tests/test_panes.py
git commit -m "panes: permission_dialog reads a permission prompt from its rule to its footer; dialog_open and dialog_shows for the pane-action routes (THI-422)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: The `PermissionRequest` hook and its registration

**Files:**
- Create: `pane_permission_hook.py` (at the repo root, beside `pane_session_hook.py`)
- Modify: `bin/periscope`, in `install-claude-hook` (about lines 241–296) and `uninstall-claude-hook` (about lines 305–330)
- Create: `tests/test_pane_permission_hook.py`

- [ ] **Step 1: Write the failing tests.** Create `tests/test_pane_permission_hook.py`:

```python
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
    assert hook.summarize("Bash", {"command": "  git status\n  && rm -rf build"}) == "git status"
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
```

- [ ] **Step 2: Run it and confirm it fails.**

Run: `uv run pytest tests/test_pane_permission_hook.py -q`

Expected: a collection error, `ModuleNotFoundError: No module named 'pane_permission_hook'`.

- [ ] **Step 3: Implement.**

Create `pane_permission_hook.py`:

```python
#!/usr/bin/env python3
"""periscope permission recorder — Claude `PermissionRequest` hook.

Records which tool call a pane's permission dialog asks about, so a native
banner can offer Allow / Deny for exactly that request
(window_view.pending_permission_for publishes it; routes/pane_actions.py
answers it). Claude runs the hook before the dialog renders, so the row is
there by the time periscope sees the pane waiting.

It only observes. Whatever a PermissionRequest hook prints is read as its
decision on the dialog, so this one prints NOTHING, swallows every failure and
always exits 0: a broken hook must never answer, or block, a prompt. The
payload carries no tool_use_id, so a request is named by a hash of what it
asks and when (`request_id`).

Writes one row into `pane_permissions` in
<XDG_CONFIG_HOME|~/.config>/periscope/periscope.db, opening its own short-lived
connection as pane_session_hook.py does, and prunes rows older than a day. A
pane without TMUX_PANE writes nothing.

Installed/removed by `bin/periscope {install-hook,uninstall-hook}`.
"""

import contextlib
import hashlib
import json
import os
import re
import sqlite3
import sys
import time

# Same DDL as periscope/activity.py's _SCHEMA: whichever opens the DB first
# creates the table (tests/test_pane_permission_hook.py checks they agree).
_SCHEMA = (
    "CREATE TABLE IF NOT EXISTS pane_permissions ("
    "  pane_id     TEXT NOT NULL,"
    "  session_id  TEXT,"
    "  agent_id    TEXT,"
    "  request_id  TEXT PRIMARY KEY,"
    "  tool        TEXT NOT NULL,"
    "  summary     TEXT NOT NULL,"
    "  created_at  REAL NOT NULL"
    ")"
)
_INDEX = "CREATE INDEX IF NOT EXISTS idx_pane_permissions_pane ON pane_permissions (pane_id, created_at)"

_KEEP_S = 86400  # a dialog left open longer than a day is not a banner's business
_SUMMARY_MAX = 80
# The dialog names these by file (relative to the cwd); the banner shows the path.
_FILE_TOOLS = ("Edit", "Write", "NotebookEdit")


def _clip(text: str, keep_end: bool = False) -> str:
    """Whitespace collapsed, at most _SUMMARY_MAX characters. A path keeps its
    end: routes/pane_actions.py matches a file tool's dialog on the basename."""
    s = re.sub(r"\s+", " ", text).strip()
    if len(s) <= _SUMMARY_MAX:
        return s
    return "…" + s[1 - _SUMMARY_MAX :] if keep_end else s[: _SUMMARY_MAX - 1] + "…"


def summarize(tool: str, tool_input: object) -> str:
    """What the dialog asks about, in a few words, for the banner's body."""
    if not isinstance(tool_input, dict):
        return ""
    if tool == "Bash":
        lines = str(tool_input.get("command") or "").strip().splitlines()
        return _clip(lines[0] if lines else "")
    if tool in _FILE_TOOLS:
        path = tool_input.get("file_path") or tool_input.get("notebook_path") or ""
        return _clip(str(path), keep_end=True)
    if tool == "WebFetch":
        return _clip(str(tool_input.get("url") or ""))
    return _clip(next((v for v in tool_input.values() if isinstance(v, str) and v.strip()), ""))


def request_id(session_id: str, tool: str, tool_input: object, created_at: float) -> str:
    """The request's name: no tool_use_id reaches this hook, so it's what the
    call asks and when, hashed. 16 hex characters."""
    raw = "\x1f".join((session_id, tool, json.dumps(tool_input, sort_keys=True), repr(created_at)))
    return hashlib.sha1(raw.encode(), usedforsecurity=False).hexdigest()[:16]


def record() -> None:
    pane = os.environ.get("TMUX_PANE", "")
    if not pane.startswith("%"):
        return
    payload = json.load(sys.stdin)
    if not isinstance(payload, dict):
        return
    tool = str(payload.get("tool_name") or "")
    if not tool:
        return
    tool_input = payload.get("tool_input")
    sid = str(payload.get("session_id") or "")
    now = time.time()
    base = os.environ.get("XDG_CONFIG_HOME") or os.path.expanduser("~/.config")
    db = os.path.join(base, "periscope", "periscope.db")
    os.makedirs(os.path.dirname(db), exist_ok=True)
    # `timeout`: periscope may be mid-write; SQLite serialises writers, and
    # the DB is in WAL mode (set by the server), so the wait is short.
    with sqlite3.connect(db, timeout=2.0) as c:
        c.execute(_SCHEMA)
        c.execute(_INDEX)
        c.execute("DELETE FROM pane_permissions WHERE created_at < ?", (now - _KEEP_S,))
        c.execute(
            "INSERT OR IGNORE INTO pane_permissions "
            "(pane_id, session_id, agent_id, request_id, tool, summary, created_at) VALUES (?,?,?,?,?,?,?)",
            (
                pane,
                sid,
                payload.get("agent_id") or None,
                request_id(sid, tool, tool_input, now),
                tool,
                summarize(tool, tool_input),
                now,
            ),
        )


def main() -> None:
    with contextlib.suppress(Exception):
        record()
    sys.exit(0)


if __name__ == "__main__":
    main()
```

In `bin/periscope`, make five edits to the `install-claude-hook` and `uninstall-claude-hook` cases.

**(a)** In `install-claude-hook`'s leading comment, replace:

```sh
    # message). SessionEnd runs the history indexer (`history/`) so the
    # finished transcript is summarized into ~/.claude/history.db — without
    # it the /history search UI has nothing behind it. Idempotent merge —
    # joins existing hook groups, preserves everything else.
```

with:

```sh
    # message). PermissionRequest runs pane_permission_hook.py on every
    # permission dialog (no matcher: every tool) so a native banner can offer
    # Allow / Deny for exactly that request; it prints nothing, since any
    # output would answer the dialog. SessionEnd runs the history indexer
    # (`history/`) so the finished transcript is summarized into
    # ~/.claude/history.db — without it the /history search UI has nothing
    # behind it. Idempotent merge — joins an existing matcher-less hook group,
    # preserves everything else.
```

**(b)** After `pane_cmd = f"python3 {repo}/pane_session_hook.py"`, add:

```python
perm_cmd = f"python3 {repo}/pane_permission_hook.py"
```

**(c)** In `wanted`, after the `("UserPromptSubmit", …)` row, add:

```python
    ("PermissionRequest", perm_cmd, "pane_permission_hook.py", 5),
```

**(d)** Replace:

```python
        entry = {"type": "command", "command": cmd, "timeout": timeout}
        if groups:
            groups[0].setdefault("hooks", []).append(entry)   # join an existing group
        else:
            groups.append({"matcher": "", "hooks": [entry]})
```

with:

```python
        entry = {"type": "command", "command": cmd, "timeout": timeout}
        # Join only a group without a matcher: a matcher-scoped one (a user's
        # "Bash" PermissionRequest group, say) would silently narrow ours.
        open_group = next((g for g in groups if not g.get("matcher")), None)
        if open_group is not None:
            open_group.setdefault("hooks", []).append(entry)
        else:
            groups.append({"matcher": "", "hooks": [entry]})
```

**(e)** In `uninstall-claude-hook`, replace:

```python
    for ev in ("SessionStart", "UserPromptSubmit", "SessionEnd"):
        groups = h.get(ev, [])
        for g in groups:
            g["hooks"] = [x for x in g.get("hooks", [])
                          if "pane_session_hook.py" not in x.get("command", "")
                          and "-m history hook" not in x.get("command", "")]
```

with:

```python
    for ev in ("SessionStart", "UserPromptSubmit", "PermissionRequest", "SessionEnd"):
        groups = h.get(ev, [])
        for g in groups:
            g["hooks"] = [x for x in g.get("hooks", [])
                          if "pane_session_hook.py" not in x.get("command", "")
                          and "pane_permission_hook.py" not in x.get("command", "")
                          and "-m history hook" not in x.get("command", "")]
```

- [ ] **Step 4: Run the tests and confirm they pass.**

Run:

```bash
sh -n bin/periscope && uv run pytest tests/test_pane_permission_hook.py -q
uv run ruff format pane_permission_hook.py tests/test_pane_permission_hook.py && uv run ruff check pane_permission_hook.py tests/test_pane_permission_hook.py
```

Expected:
- `sh -n` is silent;
- `10 passed`;
- ruff reports `All checks passed!`.

The install test prints nothing of its own; a stderr line about an unreadable account registry is expected under the temp HOME.

- [ ] **Step 5: Commit.**

```bash
git add pane_permission_hook.py bin/periscope tests/test_pane_permission_hook.py
git commit -m "hook: pane_permission_hook.py records each permission dialog's request and prints nothing; install-hook registers it for every tool (THI-422)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: `pids.window_by_pid`, moved from channels

**Files:**
- Modify: `periscope/pids.py` (the imports; append `window_by_pid`)
- Modify: `periscope/channels.py`:
  - the module docstring;
  - the imports (about line 41);
  - delete `_resolve_window_by_pid` (about lines 293–322).
- Test: `tests/test_pids.py` (append); `tests/test_channels.py` (delete the four tests that move)

The import graph has no cycle: `panes` imports only `config` and `tmux`, and `pids` already imports `activity`, which imports `panes`.

- [ ] **Step 1: Write the failing tests.** Append to `tests/test_pids.py`:

```python


# --- window_by_pid (moved from channels._resolve_window_by_pid) ---------------


def test_window_by_pid_matches_stamped_handle(mocker):
    from periscope import pids

    rows = [
        {"session": "s", "index": 2, "name": "w", "cwd": "/x", "pane_id": "%7", "pid_raw": "abcd1234"},
    ]
    mocker.patch.object(pids, "list_windows", return_value=rows)

    def _attach(ws, **kw):
        for w in ws:
            w["pid"] = w.pop("pid_raw")

    mocker.patch.object(pids, "_attach_git_then_resolve_pids", side_effect=_attach)

    pid, pane_id, window = pids.window_by_pid("abcd1234")
    assert pid == "abcd1234"
    assert pane_id == "%7"
    assert window["session"] == "s" and window["index"] == 2


def test_window_by_pid_miss_returns_empty(mocker):
    from periscope import pids

    mocker.patch.object(
        pids, "list_windows", return_value=[{"session": "s", "index": 2, "pane_id": "%7", "pid_raw": "other"}]
    )
    mocker.patch.object(pids, "_attach_git_then_resolve_pids")
    assert pids.window_by_pid("abcd1234") == ("", "", {})


def test_window_by_pid_empty_handle_returns_empty(mocker):
    from periscope import pids

    listed = mocker.patch.object(pids, "list_windows")
    assert pids.window_by_pid("") == ("", "", {})
    listed.assert_not_called()


def test_window_by_pid_falls_back_to_pane_id(mocker):
    """A pid can change under a live pane (re-mint, or a rebind that misses
    after a tmux restart). The observed shape was always the same: spawn
    returned a pid, minutes later send_to said "no live window" while the pane
    was alive at the SAME pane_id. Callers hold that pane_id, so it must work
    as a handle — one session read the dead handle as death and respawned a
    duplicate worker onto the live task."""
    from periscope import pids

    rows = [{"session": "s", "index": 1, "name": "w", "cwd": "/a", "pane_id": "%106", "pid_raw": "e42b3b40"}]
    mocker.patch.object(pids, "list_windows", return_value=rows)
    mocker.patch.object(
        pids, "_attach_git_then_resolve_pids", side_effect=lambda ws, **kw: [w.update(pid=w["pid_raw"]) for w in ws]
    )

    # The stale spawn-time pid no longer resolves...
    assert pids.window_by_pid("3dc7686a") == ("", "", {})
    # ...but the pane id the caller still holds does.
    pid, pane_id, _w = pids.window_by_pid("%106")
    assert (pid, pane_id) == ("e42b3b40", "%106")


def test_channels_still_resolves_through_window_by_pid():
    # The MCP tools (and the tests that patch it there) use the old name.
    from periscope import channels, pids

    assert channels._resolve_window_by_pid is pids.window_by_pid
```

In `tests/test_channels.py`, delete these four functions whole, since they're the ones moving to `test_pids.py` above:
- `test_resolve_window_by_pid_matches_stamped_handle`
- `test_resolve_window_by_pid_miss_returns_empty`
- `test_resolve_window_by_pid_empty_handle_returns_empty`
- `test_resolve_window_by_pid_falls_back_to_pane_id`

They patch `periscope.channels.list_windows`, which no longer reaches the moved code.

- [ ] **Step 2: Run it and confirm it fails.**

Run: `uv run pytest tests/test_pids.py -q`

Expected: 5 failures, for example `AttributeError: <module 'periscope.pids' …> does not have the attribute 'list_windows'` and `AttributeError: module 'periscope.pids' has no attribute 'window_by_pid'`.

- [ ] **Step 3: Implement.**

In `periscope/pids.py`, change the imports to:

```python
from periscope import activity, session_status
from periscope import store as _store
from periscope.git_pr import cached_git_state
from periscope.log import log
from periscope.panes import list_windows
from periscope.tmux import tmux
```

Then append this at the end of the file, after `_attach_git_then_resolve_pids`. The body is `channels._resolve_window_by_pid`'s, verbatim; only the name and the docstring's last paragraph are new.

```python


def window_by_pid(handle: str) -> tuple[str, str, dict]:
    """Resolve an @periscope_id handle to (pid, pane_id, window).

    Matches on `pid_raw` — the stamped @periscope_id on the raw list_windows
    row — BEFORE resolution, because resolution attaches `pid` only after a
    match (raw rows carry pid_raw, not pid). peek/terminate read
    session/index off the returned window dict. Returns ("", "", {}) when no
    live window matches.

    Also accepts a tmux pane id (`%N`) as the handle. A pid can change under a
    pane — re-mint, or a rebind that misses after a tmux server restart — and
    the observed failure was always the same shape: `spawn_claude` returned a
    pid, minutes later `send_to` said "no live window" while the pane was alive
    at the SAME pane_id under a new pid. Callers already hold that pane_id
    (spawn_claude and list_claudes both return it), so accepting it turns a
    dead end into a working address. One session read the dead handle as death
    and spawned a duplicate agent onto the same task.

    Lives here rather than in channels.py so a route (pane_actions) finds a
    pane by pid without importing the MCP module; channels.py imports it
    under its old name, _resolve_window_by_pid."""
    if not handle:
        return "", "", {}
    wins = list_windows()
    match = next((w for w in wins if w.get("pid_raw") == handle), None)
    if match is None and handle.startswith("%"):
        match = next((w for w in wins if w.get("pane_id") == handle), None)
    if match is None:
        return "", "", {}
    # Resolve against the FULL window list, never just the match: a
    # single-window pass has an incomplete `carried` set, so an unstamped
    # window could rebind onto an id another live window is still wearing.
    _attach_git_then_resolve_pids(wins, full_roster=True)
    return match.get("pid") or "", match.get("pane_id") or "", match
```

In `periscope/channels.py`:

1. Delete the whole `def _resolve_window_by_pid(handle: str) -> tuple[str, str, dict]:` function (it ends just above `def _do_link_pr_tool(`).
2. After `from periscope.pids import _attach_git_then_resolve_pids, stamp_new_window`, add the line below. Don't put a comment in the import block, or ruff's I001 fails.

```python
from periscope.pids import window_by_pid as _resolve_window_by_pid
```

3. In the module docstring, replace:

```
`note_action` come from `periscope.panes`, `_attach_git_then_resolve_pids`
from `periscope.pids` — no bridges to server.py remain in this module.
```

with:

```
`note_action` come from `periscope.panes`, `_attach_git_then_resolve_pids`
from `periscope.pids` — no bridges to server.py remain in this module. So does
`_resolve_window_by_pid`: it is `pids.window_by_pid` under its old name, so
the tools, and the tests that patch it here, keep working.
```

`routes/pane.py` and `routes/sessions.py` keep importing `_resolve_window_by_pid` from `channels`, and it works unchanged.

- [ ] **Step 4: Run the tests and confirm they pass.**

Run:

```bash
uv run pytest tests/test_pids.py tests/test_channels.py tests/routes/test_pane.py tests/routes/test_sessions.py -q
uv run ruff format periscope/pids.py periscope/channels.py tests/test_pids.py tests/test_channels.py && uv run ruff check periscope/pids.py periscope/channels.py tests/test_pids.py tests/test_channels.py
```

Expected: all pass (`test_pids.py` now has 38 tests and `test_channels.py` 109), and ruff reports `All checks passed!`.

- [ ] **Step 5: Commit.**

```bash
git add periscope/pids.py periscope/channels.py tests/test_pids.py tests/test_channels.py
git commit -m "pids: window_by_pid, moved from channels._resolve_window_by_pid, so a route finds a pane by pid without the MCP module (THI-422)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Publish `w.pending_permission`

**Files:**
- Modify: `periscope/activity.py`:
  - add the `pane_permissions` table to `_SCHEMA`;
  - add `pane_permissions_since` after `prune_pane_sessions`.
- Modify: `periscope/window_view.py`:
  - add `pending_permission_for` above `build_window_view`;
  - call it in `build_window_view`;
  - add the `"pending_permission"` view key.
- Test: `tests/test_window_view.py`; `tests/test_pane_permission_hook.py` (append the schema check)

- [ ] **Step 1: Write the failing tests.**

Append to `tests/test_window_view.py`:

```python


# --- pending_permission: the request a banner's Allow / Deny answers ----------


def _permission_row(act, pane_id: str, request_id: str, created_at: float, summary: str = "touch probe.txt") -> None:
    """A row as pane_permission_hook.py writes it."""
    with act._LOCK:
        c = act._conn()
        c.execute(
            "INSERT INTO pane_permissions (pane_id, session_id, agent_id, request_id, tool, summary, created_at) "
            "VALUES (?,?,?,?,?,?,?)",
            (pane_id, "sid-1", None, request_id, "Bash", summary, created_at),
        )
        c.commit()


def _waiting_on(mocker, waiting_for: str | None, state: str = "needs-input"):
    _stub_subsystems(mocker, pane_content="x")
    mocker.patch(
        "periscope.window_view.parse_pane",
        return_value={"agent": "claude", "state": state, "spinner": None, "waiting_for": waiting_for},
    )


def test_view_publishes_the_one_permission_request_of_this_wait(mocker, clean_state, fresh_activity_db):
    from periscope.window_view import build_window_view

    _waiting_on(mocker, "permission prompt")
    # Answered before this wait began: not the dialog on screen.
    _permission_row(fresh_activity_db, "%5", "0ld0000000000000", 990.0, summary="ls")
    # Stamped by the hook just before the dialog rendered, a poll before needs_since.
    _permission_row(fresh_activity_db, "%5", "a1b2c3d4e5f60718", 999.4)
    # Another pane's prompt is its own.
    _permission_row(fresh_activity_db, "%6", "ffff000000000000", 1000.0)
    view, _ = build_window_view(_window(), now_ts=1000)
    assert view["needs_since"] == 1000
    assert view["pending_permission"] == {
        "request_id": "a1b2c3d4e5f60718",
        "tool": "Bash",
        "summary": "touch probe.txt",
    }


def test_view_has_no_pending_permission_without_a_row(mocker, clean_state, fresh_activity_db):
    from periscope.window_view import build_window_view

    _waiting_on(mocker, "permission prompt")
    view, _ = build_window_view(_window(), now_ts=1000)
    assert view["pending_permission"] is None


def test_view_has_no_pending_permission_when_two_requests_fit(mocker, clean_state, fresh_activity_db):
    # Parallel tool calls each asking (or two prompts inside one poll): which
    # one the dialog shows can't be told, so the banner offers Open only.
    from periscope.window_view import build_window_view

    _waiting_on(mocker, "Permission Prompt")
    _permission_row(fresh_activity_db, "%5", "a1b2c3d4e5f60718", 999.4)
    _permission_row(fresh_activity_db, "%5", "b1b2c3d4e5f60718", 999.8)
    view, _ = build_window_view(_window(), now_ts=1000)
    assert view["pending_permission"] is None


def test_view_has_no_pending_permission_outside_a_permission_wait(mocker, clean_state, fresh_activity_db):
    from periscope.window_view import build_window_view

    _permission_row(fresh_activity_db, "%5", "a1b2c3d4e5f60718", 999.4)
    _waiting_on(mocker, "approve AskUserQuestion")
    assert build_window_view(_window(), now_ts=1000)[0]["pending_permission"] is None
    _waiting_on(mocker, None, state="working")
    assert build_window_view(_window(), now_ts=1000)[0]["pending_permission"] is None


def test_pending_permission_matches_waiting_for_case_insensitively(fresh_activity_db):
    from periscope.window_view import pending_permission_for

    _permission_row(fresh_activity_db, "%5", "a1b2c3d4e5f60718", 999.4)
    assert pending_permission_for("%5", "needs-input", "Permission Prompt", 1000)["request_id"] == "a1b2c3d4e5f60718"
    # needs_since 0 means "not waiting": no episode to scope the rows to.
    assert pending_permission_for("%5", "needs-input", "permission prompt", 0) is None
```

Append to `tests/test_pane_permission_hook.py`:

```python


def test_the_hook_and_the_server_create_the_same_table(tmp_path, fresh_activity_db):
    # Whichever opens periscope.db first creates pane_permissions.
    with sqlite3.connect(tmp_path / "hook.db") as c:
        c.execute(hook._SCHEMA)
        c.execute(hook._INDEX)
        hook_cols = c.execute("PRAGMA table_info(pane_permissions)").fetchall()
        hook_idx = c.execute("PRAGMA index_info(idx_pane_permissions_pane)").fetchall()
    with fresh_activity_db._LOCK:
        c = fresh_activity_db._conn()
        server_cols = c.execute("PRAGMA table_info(pane_permissions)").fetchall()
        server_idx = c.execute("PRAGMA index_info(idx_pane_permissions_pane)").fetchall()
    assert hook_cols == server_cols
    assert hook_idx == server_idx
```

- [ ] **Step 2: Run them and confirm they fail.**

Run: `uv run pytest tests/test_window_view.py tests/test_pane_permission_hook.py -q`

Expected: 6 failures:
- the window_view tests raise `sqlite3.OperationalError: no such table: pane_permissions`, or a `KeyError: 'pending_permission'`;
- the direct test raises `ImportError: cannot import name 'pending_permission_for'`;
- the schema test fails `assert [(0, 'pane_id', …)] == []`.

- [ ] **Step 3: Implement.**

In `periscope/activity.py`, in `_SCHEMA`, replace the `DROP TABLE IF EXISTS first_mate;` line with:

```sql
-- One row per Claude permission dialog, written by pane_permission_hook.py
-- (PermissionRequest) just before the dialog renders and pruned by it after a
-- day; window_view.pending_permission_for reads it. Same DDL as the hook's:
-- whichever opens the DB first creates it (test_pane_permission_hook checks).
CREATE TABLE IF NOT EXISTS pane_permissions (
  pane_id     TEXT NOT NULL,       -- tmux pane id, e.g. '%56'
  session_id  TEXT,                -- Claude session id
  agent_id    TEXT,                -- set for a subagent's call (it asks in this pane)
  request_id  TEXT PRIMARY KEY,    -- sha1(session, tool, input, created_at)[:16]
  tool        TEXT NOT NULL,       -- tool_name, e.g. 'Bash'
  summary     TEXT NOT NULL,       -- what it asks, <= 80 chars
  created_at  REAL NOT NULL        -- unix seconds, when the hook ran
);
CREATE INDEX IF NOT EXISTS idx_pane_permissions_pane ON pane_permissions (pane_id, created_at);
DROP TABLE IF EXISTS first_mate;
```

Still in `activity.py`, directly above the `# --- pane_workspaces: tmux pane id -> workspace id tag -----------------` comment, after `prune_pane_sessions`, insert:

```python
# --- pane_permissions: the permission dialog a pane is showing -----------
#
# Writer is pane_permission_hook.py (out-of-process, Claude's PermissionRequest
# hook; it also prunes). The reader is window_view.pending_permission_for.


def pane_permissions_since(pane_id: str, since: float) -> list[tuple[str, str, str]]:
    """(request_id, tool, summary) of this pane's permission requests stamped
    at or after `since`, oldest first — at most two: the caller only needs to
    know whether exactly one fits."""
    if not pane_id:
        return []
    with _LOCK:
        c = _conn()
        return c.execute(
            "SELECT request_id, tool, summary FROM pane_permissions "
            "WHERE pane_id=? AND created_at>=? ORDER BY created_at LIMIT 2",
            (pane_id, since),
        ).fetchall()


```

In `periscope/window_view.py`, make three edits.

**(a)** Directly above `def build_window_view(` (below `mem_signal`), insert:

```python
# The PermissionRequest hook stamps its row just before the dialog renders,
# and needs_since is whole seconds from the poll that first saw the pane
# waiting: the row can predate it by a little under a poll.
_PERMISSION_SKEW_S = 2


def pending_permission_for(pane_id: str, state: str | None, waiting_for: str | None, needs_since: int) -> dict | None:
    """The permission request a pane's dialog is asking, as {request_id, tool,
    summary}, or None unless it can be told for sure: the pane waits on a
    permission prompt and exactly one pane_permissions row (pane_permission_hook.py)
    falls in this wait. Two or more — parallel tool calls each asking, or
    back-to-back prompts inside one poll so needs_since never moved — can't be
    told apart, so a banner offers Open only: the cost is a button, never a
    wrong approval. Shared by the state build and POST /api/pane/permission,
    which recomputes it rather than trusting the banner's copy."""
    if state != "needs-input" or (waiting_for or "").lower() != "permission prompt":
        return None
    if not pane_id or not needs_since:
        return None
    rows = activity.pane_permissions_since(pane_id, needs_since - _PERMISSION_SKEW_S)
    if len(rows) != 1:
        return None
    request_id, tool, summary = rows[0]
    return {"request_id": request_id, "tool": tool, "summary": summary}


```

**(b)** In `build_window_view`, replace:

```python
    git = cached_git_state(w.get("cwd", "")) or {}
    pr = cached_pr_state(w.get("cwd", ""), git.get("branch")) or {}
```

with:

```python
    # One indexed read, and only for a pane waiting on a permission prompt.
    pending_permission = pending_permission_for(
        w.get("pane_id") or "", parsed.get("state"), parsed.get("waiting_for"), needs_since
    )

    git = cached_git_state(w.get("cwd", "")) or {}
    pr = cached_pr_state(w.get("cwd", ""), git.get("branch")) or {}
```

**(c)** In the `view = {…}` dict, replace:

```python
        "needs_since": needs_since,
        "mem": mem_signal(claude_proc_for(sid)),
```

with:

```python
        "needs_since": needs_since,
        # The request a banner's Allow / Deny would answer (or null: Open only).
        "pending_permission": pending_permission,
        "mem": mem_signal(claude_proc_for(sid)),
```

- [ ] **Step 4: Run the tests and confirm they pass.**

Run:

```bash
uv run pytest tests/test_window_view.py tests/test_pane_permission_hook.py tests/routes/test_state.py -q
uv run ruff format periscope/activity.py periscope/window_view.py tests/test_window_view.py tests/test_pane_permission_hook.py && uv run ruff check periscope/activity.py periscope/window_view.py tests/test_window_view.py tests/test_pane_permission_hook.py
```

Expected: all pass (`test_window_view.py` 46, `test_pane_permission_hook.py` 11), and ruff reports `All checks passed!`.

- [ ] **Step 5: Commit.**

```bash
git add periscope/activity.py periscope/window_view.py tests/test_window_view.py tests/test_pane_permission_hook.py
git commit -m "state: w.pending_permission, the one permission request a waiting pane's dialog asks, from the hook's rows (THI-422)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: The endpoints, `routes/pane_actions.py`

**Files:**
- Create: `periscope/routes/pane_actions.py`
- Modify: `periscope/app.py` (the routes import list and the `for r in (…)` mount tuple)
- Create: `tests/routes/test_pane_actions.py`
- Modify: `tests/test_app.py`

- [ ] **Step 1: Write the failing tests.** Create `tests/routes/test_pane_actions.py`:

```python
"""POST /api/pane/permission and /api/pane/reply — the agent-acting banner
buttons. Each re-checks the pane when pressed; these tests pin every refusal,
because a wrong yes approves a tool call nobody saw."""

from pathlib import Path

import pytest

from periscope.routes import pane_actions

_DIALOGS = Path(__file__).resolve().parent.parent / "fixtures" / "permission_dialogs"
_IDLE = "⏺ Done.\n\n" + "─" * 60 + "\n❯ \n" + "─" * 60 + "\n  ⏵⏵ auto mode on (shift+tab to cycle)\n"
_ASK = (
    "─" * 60 + "\nWhich database?\n\n❯ 1. Postgres\n  2. SQLite\n\nEnter to select · ↑/↓ to navigate · Esc to cancel\n"
)
_WAITING = {"state": "needs-input", "waiting_for": "permission prompt"}


def _screen(name: str) -> str:
    return (_DIALOGS / name).read_text()


def _row(act, request_id="a1b2c3d4e5f60718", tool="Bash", summary="touch probe.txt", created_at=999.4, pane="%9"):
    with act._LOCK:
        c = act._conn()
        c.execute(
            "INSERT INTO pane_permissions (pane_id, session_id, agent_id, request_id, tool, summary, created_at) "
            "VALUES (?,?,?,?,?,?,?)",
            (pane, "sid-1", None, request_id, tool, summary, created_at),
        )
        c.commit()


@pytest.fixture
def pane(mocker):
    """A live pane ab12cd34 (%9, s:4) that has waited on a permission prompt
    since t=1000, showing the Bash dialog. Returns the _send_to_target spy."""
    mocker.patch.object(pane_actions, "window_by_pid", return_value=("ab12cd34", "%9", {"session": "s", "index": 4}))
    mocker.patch.object(pane_actions, "session_id_for_pane", return_value="sid-1")
    mocker.patch.object(pane_actions, "session_state_for", return_value=dict(_WAITING))
    mocker.patch.object(pane_actions, "needs_since_for", return_value=1000)
    mocker.patch.object(pane_actions, "capture", return_value=_screen("bash.txt"))
    return mocker.patch.object(pane_actions, "_send_to_target", return_value={"ok": True})


def _permission(client, **body):
    return client.post("/api/pane/permission", json={"pid": "ab12cd34", "request_id": "a1b2c3d4e5f60718", **body})


# --- /api/pane/permission ------------------------------------------------------


def test_allow_sends_1_and_deny_sends_escape(client, pane, fresh_activity_db):
    _row(fresh_activity_db)
    r = _permission(client, choice="allow")
    assert r.status_code == 200, r.text
    assert r.json() == {"ok": True}
    pane.assert_called_once_with("s:4", None, ["1"])
    pane.reset_mock()
    r = _permission(client, choice="deny")
    assert r.status_code == 200, r.text
    pane.assert_called_once_with("s:4", None, ["Escape"])


def test_allow_answers_a_write_dialog_by_the_files_basename(client, pane, fresh_activity_db, mocker):
    # The dialog names notes.md; the hook stored the absolute path.
    _row(fresh_activity_db, tool="Write", summary="/tmp/probe/notes.md")
    mocker.patch.object(pane_actions, "capture", return_value=_screen("write.txt"))
    assert _permission(client, choice="allow").status_code == 200
    pane.assert_called_once_with("s:4", None, ["1"])


def test_permission_rejects_any_other_choice(client, pane, fresh_activity_db):
    _row(fresh_activity_db)
    r = _permission(client, choice="always")
    assert r.status_code == 400
    pane.assert_not_called()


def test_permission_404s_for_a_pane_that_is_gone(client, pane, fresh_activity_db, mocker):
    mocker.patch.object(pane_actions, "window_by_pid", return_value=("", "", {}))
    assert _permission(client, choice="allow").status_code == 404
    pane.assert_not_called()


def test_permission_409s_on_a_different_request(client, pane, fresh_activity_db):
    _row(fresh_activity_db, request_id="ffff000000000000")
    r = _permission(client, choice="allow")
    assert r.status_code == 409
    pane.assert_not_called()


def test_permission_409s_once_the_pane_left_needs_input(client, pane, fresh_activity_db, mocker):
    _row(fresh_activity_db)
    mocker.patch.object(pane_actions, "session_state_for", return_value={"state": "working", "waiting_for": None})
    assert _permission(client, choice="allow").status_code == 409
    pane.assert_not_called()


def test_permission_409s_when_the_screen_shows_another_command(client, pane, fresh_activity_db):
    # The row says rm; the dialog up asks about touch probe.txt.
    _row(fresh_activity_db, summary="rm -rf build")
    assert _permission(client, choice="allow").status_code == 409
    pane.assert_not_called()


def test_permission_409s_when_no_dialog_is_on_screen(client, pane, fresh_activity_db, mocker):
    _row(fresh_activity_db)
    mocker.patch.object(pane_actions, "capture", return_value=_IDLE)
    assert _permission(client, choice="allow").status_code == 409
    pane.assert_not_called()


@pytest.mark.parametrize("headers", [{}, {"content-type": "text/plain"}], ids=["no-type", "text-plain"])
def test_permission_refuses_a_body_that_is_not_json(client, pane, fresh_activity_db, headers):
    # A POST without a JSON content type is a CORS simple request: any page could send it.
    _row(fresh_activity_db)
    body = '{"pid": "ab12cd34", "request_id": "a1b2c3d4e5f60718", "choice": "allow"}'
    r = client.post("/api/pane/permission", content=body, headers=headers)
    assert r.status_code == 415
    pane.assert_not_called()


# --- /api/pane/reply -----------------------------------------------------------


def test_reply_pastes_then_enters(client, pane, mocker):
    mocker.patch.object(pane_actions, "session_state_for", return_value={"state": "idle", "waiting_for": None})
    mocker.patch.object(pane_actions, "capture", return_value=_IDLE)
    r = client.post("/api/pane/reply", json={"pid": "ab12cd34", "text": "  Postgres, please  "})
    assert r.status_code == 200, r.text
    assert r.json() == {"ok": True}
    pane.assert_called_once_with("s:4", "Postgres, please", ["Enter"])


def test_reply_rejects_empty_text(client, pane):
    assert client.post("/api/pane/reply", json={"pid": "ab12cd34", "text": "   "}).status_code == 400
    pane.assert_not_called()


def test_reply_404s_for_a_pane_that_is_gone(client, pane, mocker):
    mocker.patch.object(pane_actions, "window_by_pid", return_value=("", "", {}))
    assert client.post("/api/pane/reply", json={"pid": "ab12cd34", "text": "hi"}).status_code == 404
    pane.assert_not_called()


def test_reply_409s_while_the_session_waits_on_something(client, pane, mocker):
    mocker.patch.object(
        pane_actions,
        "session_state_for",
        return_value={"state": "needs-input", "waiting_for": "approve AskUserQuestion"},
    )
    mocker.patch.object(pane_actions, "capture", return_value=_IDLE)
    assert client.post("/api/pane/reply", json={"pid": "ab12cd34", "text": "1 sounds good"}).status_code == 409
    pane.assert_not_called()


@pytest.mark.parametrize("screen", [_ASK, _screen("bash.txt")], ids=["choice-footer", "permission-dialog"])
def test_reply_409s_on_a_dialog_on_screen(client, pane, mocker, screen):
    # The session file can lag or be missing (an unmapped pane); the screen can't.
    mocker.patch.object(pane_actions, "session_state_for", return_value=None)
    mocker.patch.object(pane_actions, "capture", return_value=screen)
    assert client.post("/api/pane/reply", json={"pid": "ab12cd34", "text": "1 sounds good"}).status_code == 409
    pane.assert_not_called()
```

Append to `tests/test_app.py`:

```python


def test_app_includes_pane_actions_router():
    from periscope.app import app

    paths = [r.path for r in app.routes if hasattr(r, "path")]
    assert "/api/pane/permission" in paths
    assert "/api/pane/reply" in paths
```

- [ ] **Step 2: Run it and confirm it fails.**

Run: `uv run pytest tests/routes/test_pane_actions.py tests/test_app.py -q`

Expected:
- a collection error, `ImportError: cannot import name 'pane_actions' from 'periscope.routes'`;
- `test_app_includes_pane_actions_router` fails, once that file is collected on its own.

- [ ] **Step 3: Implement.** Create `periscope/routes/pane_actions.py`:

```python
"""POST /api/pane/permission and /api/pane/reply — the buttons that make an agent act.

A native banner's Allow / Deny answers a Claude permission dialog; its Send
and "Ask agent to fix" type a message into the pane (THI-426's rail card reuses
both). Unlike /api/send, a raw key pipe, each re-checks the pane when pressed,
because a banner can be minutes stale: Allow must only ever answer the request
its banner was shown for, and a reply must never land in a dialog, where
`1 sounds good` + Enter picks option 1.

JSON bodies only. A POST without one is a CORS "simple" request any website
could fire at localhost; application/json needs a preflight this server never
answers. FastAPI parses a body with no Content-Type as JSON, so the type is
checked explicitly.
"""

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from periscope.panes import dialog_open, dialog_shows, needs_since_for, permission_dialog
from periscope.pids import window_by_pid
from periscope.routes.send import _send_to_target
from periscope.session_status import session_state_for
from periscope.tmux import capture
from periscope.turns import session_id_for_pane
from periscope.window_view import pending_permission_for


def _json_only(request: Request) -> None:
    ctype = (request.headers.get("content-type") or "").split(";", 1)[0].strip().lower()
    if ctype != "application/json":
        raise HTTPException(415, "send a JSON body (Content-Type: application/json)")


router = APIRouter(dependencies=[Depends(_json_only)])

# `1` is "Yes", taken at once (no Enter). Escape is "No, and tell Claude what
# to do differently": it interrupts ("What should Claude do instead?") and
# leaves the pane waiting for you. Never a number for No: it's option 4 for
# Bash and 3 for Write in 2.1.280, and moves between versions.
_PERMISSION_KEYS = {"allow": ["1"], "deny": ["Escape"]}


class PermissionBody(BaseModel):
    pid: str
    request_id: str
    choice: str


class ReplyBody(BaseModel):
    pid: str
    text: str


def _live_pane(handle: str) -> tuple[str, str, str]:
    """(pid, pane_id, target) of the live pane, found by pid — never by a
    target tmux may have renumbered since the banner was posted."""
    pid, pane_id, window = window_by_pid(handle)
    if not window:
        raise HTTPException(404, f"no live pane for pid {handle!r}")
    return pid, pane_id, f"{window['session']}:{window['index']}"


def _screen(target: str) -> str:
    try:
        return capture(target)
    except Exception as e:
        raise HTTPException(500, f"could not read the pane: {e}") from e


@router.post("/api/pane/permission")
def pane_permission(body: PermissionBody):
    """Answer the pane's permission dialog: `allow` sends `1`, `deny` Escape.

    409 unless the dialog is still the one the caller saw: the pane waits on a
    permission prompt, the request it's asking (recomputed from the hook's
    rows, not taken from the caller) is `request_id`, and a fresh capture
    shows a permission dialog naming it. The screen check is what stops a
    stale row from approving a different dialog that happens to be up."""
    keys = _PERMISSION_KEYS.get(body.choice)
    if keys is None:
        raise HTTPException(400, f"choice must be allow or deny, not {body.choice!r}")
    pid, pane_id, target = _live_pane(body.pid)
    sess = session_state_for(session_id_for_pane(pane_id)) or {}
    pending = pending_permission_for(pane_id, sess.get("state"), sess.get("waiting_for"), needs_since_for(pid))
    if pending is None:
        raise HTTPException(409, "the pane isn't waiting on a permission request periscope can name")
    if pending["request_id"] != body.request_id:
        raise HTTPException(409, "the pane is asking about a different request now")
    dialog = permission_dialog(_screen(target))
    if dialog is None or not dialog_shows(dialog, pending["tool"], pending["summary"]):
        raise HTTPException(409, "the dialog on screen isn't the request's")
    _send_to_target(target, None, keys)
    return {"ok": True}


@router.post("/api/pane/reply")
def pane_reply(body: ReplyBody):
    """Type `text` into the pane and submit it (a bracketed paste, then Enter,
    as the composer does). 409 while any dialog is open, by either signal:
    the session file says the pane waits on something, or the screen shows a
    dialog (a permission dialog's footer is outside parse_pane's family)."""
    text = body.text.strip()
    if not text:
        raise HTTPException(400, "nothing to send")
    _pid, pane_id, target = _live_pane(body.pid)
    sess = session_state_for(session_id_for_pane(pane_id)) or {}
    if sess.get("state") == "needs-input" and sess.get("waiting_for"):
        raise HTTPException(409, f"the pane has a dialog open ({sess['waiting_for']}) — answer it first")
    if dialog_open(_screen(target)):
        raise HTTPException(409, "the pane has a dialog open — answer it first")
    _send_to_target(target, text, ["Enter"])
    return {"ok": True}
```

In `periscope/app.py`, add `pane_actions,` after `pane,` in **both** places:
- the `from periscope.routes import (…)` list (`pane,` is followed by `paste_image,`);
- the `for r in (…)` mount tuple (`pane,` is followed by `paste_image,`).

- [ ] **Step 4: Run the tests and confirm they pass.**

Run:

```bash
uv run pytest tests/routes/test_pane_actions.py tests/test_app.py -q
uv run ruff format periscope/routes/pane_actions.py periscope/app.py tests/routes/test_pane_actions.py tests/test_app.py && uv run ruff check periscope/routes/pane_actions.py periscope/app.py tests/routes/test_pane_actions.py tests/test_app.py && uv run ty check
```

Expected: `25 passed` (16 route tests and 9 app tests); ruff and ty report `All checks passed!`.

- [ ] **Step 5: Commit.**

```bash
git add periscope/routes/pane_actions.py periscope/app.py tests/routes/test_pane_actions.py tests/test_app.py
git commit -m "routes: POST /api/pane/permission and /api/pane/reply, JSON only, re-checked against the request and the screen before a key goes in (THI-422)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Banners name the new categories, and actions.js registers their buttons

**Files:**
- Modify: `static/src/notify/copy.js` (`payloadFor`: the `needs_input`, `question` and `ci_failed` cases)
- Modify: `static/src/notify/actions.js` (the header comment, the button constants, `categories()`)
- Test: `static/src/notify/__tests__/copy.test.js`, `static/src/notify/__tests__/actions.test.js`

- [ ] **Step 1: Write the failing tests.**

In `copy.test.js`, replace the two tests `"gives each other banner the category whose buttons all apply"` and `"offers no buttons on ci_failed or pr_merged without a URL"` with:

```js
  it("gives each other banner the category whose buttons all apply", () => {
    expect(payloadFor({ kind: "pr_merged", w: w({ pr: 7, repo_slug: "o/r", cwd: "/wt/a" }) })).toMatchObject({
      category: "pr_merged", data: { cwd: "/wt/a" },
    });
    expect(payloadFor({ kind: "pr_merged", w: w({ pr: 7, repo_slug: "o/r" }) }).category).toBe("pr_merged_pr");
    expect(payloadFor({ kind: "needs_input", w: w() }).category).toBe("needs_dialog");
  });

  it("offers no PR buttons on pr_merged without a URL", () => {
    expect(payloadFor({ kind: "pr_merged", w: w({ pr: 7, cwd: "/wt/a" }) }).category).toBe("pr_merged_cleanup");
    expect(payloadFor({ kind: "pr_merged", w: w({ pr: 7 }) }).category).toBeUndefined();
  });

  it("asks to allow the request the server named, and only then", () => {
    const perm = { request_id: "a1b2c3d4e5f60718", tool: "Bash", summary: "touch probe.txt" };
    const p = payloadFor({ kind: "needs_input", w: w({ waiting_for: "permission prompt", pending_permission: perm }) });
    expect(p).toMatchObject({
      title: "dual-moas needs you", subtitle: "periscope · main", body: "Allow Bash: touch probe.txt?",
      category: "needs_permission", data: { open: "pane", pid: "p1", request_id: "a1b2c3d4e5f60718" },
    });
    expect(payloadFor({ kind: "needs_input", w: w({ pending_permission: { ...perm, summary: "" } }) }).body).toBe("Allow Bash?");
    // Not named (two requests, or an older pane without the hook): Open only, 2a's words.
    const unnamed = payloadFor({ kind: "needs_input", w: w({ waiting_for: "permission prompt", pending_permission: null }) });
    expect(unnamed).toMatchObject({ body: "Waiting for your approval.", category: "needs_dialog", data: { pid: "p1" } });
    expect(unnamed.data.request_id).toBeUndefined();
    expect(payloadFor({ kind: "needs_input", w: w({ waiting_for: "approve AskUserQuestion" }) }).category).toBe("needs_dialog");
  });

  it("offers Reply on a question only while its pane is live", () => {
    const alert = { target: "gone:2", name: "old", session: "s", message: "Which database?" };
    expect(payloadFor({ kind: "question", w: w(), alert }).category).toBe("question");
    expect(payloadFor({ kind: "question", w: null, alert }).category).toBeUndefined();
  });

  it("offers Ask agent to fix with a live pane, Open PR with a URL", () => {
    const checks = [{ name: "test", state: "failure" }, { name: "lint", state: "success" }, { name: "e2e", state: "failure" }];
    expect(payloadFor({ kind: "ci_failed", w: w({ pr: 7, repo_slug: "o/r", ci_checks: checks }) })).toMatchObject({
      category: "ci_failed", data: { pid: "p1", pr: 7, checks: ["test", "e2e"] },
    });
    expect(payloadFor({ kind: "ci_failed", w: w({ pr: 7 }) })).toMatchObject({ category: "ci_failed_fix", data: { checks: [] } });
    expect(payloadFor({ kind: "ci_failed", w: w({ pr: 7, repo_slug: "o/r", pid: "" }) }).category).toBe("ci_failed_pr");
    expect(payloadFor({ kind: "ci_failed", w: w({ pr: 7, pid: "" }) }).category).toBeUndefined();
  });
```

In the same file, in `"only names categories that actions.js registers, or none"`, replace:

```js
      { kind: "usage", account: "c", meter: "week_all", m: { percent: 90 } },
      // PR 2 adds their categories; today's shell shows no buttons on these.
      { kind: "needs_input", w: w() }, { kind: "question", w: w(), alert },
    ];
```

with:

```js
      { kind: "usage", account: "c", meter: "week_all", m: { percent: 90 } },
      { kind: "needs_input", w: w() },
      { kind: "needs_input", w: w({ pending_permission: { request_id: "r", tool: "Bash", summary: "ls" } }) },
      { kind: "question", w: w(), alert }, { kind: "question", w: null, alert },
      { kind: "ci_failed", w: w({ pr: 7, pid: "" }) }, { kind: "ci_failed", w: w({ pr: 7, repo_slug: "o/r", pid: "" }) },
    ];
```

In `actions.test.js`, replace the first two tests of `describe("categories", …)`, `"gives every banner variant its buttons"` and `"brings the app forward only for buttons that show something in it"`, with:

```js
  it("gives every banner variant its buttons", () => {
    const byId = Object.fromEntries(categories().map((c) => [c.id, c.actions.map((a) => a.id)]));
    expect(byId).toEqual({
      done_seen: ["mark_seen"], ci_failed_pr: ["open_pr"],
      pr_merged: ["cleanup", "open_pr"], pr_merged_cleanup: ["cleanup"], pr_merged_pr: ["open_pr"], usage: ["details"],
      needs_permission: ["allow", "deny", "open"], needs_dialog: ["open"], question: ["send", "open"],
      ci_failed: ["fix", "open_pr"], ci_failed_fix: ["fix"],
    });
  });

  it("brings the app forward only for buttons that show something in it", () => {
    const fg = categories().flatMap((c) => c.actions).filter((a) => a.foreground).map((a) => a.id);
    expect(new Set(fg)).toEqual(new Set(["cleanup", "details", "open"]));
  });

  it("asks for Touch ID on every button that makes an agent act, and only those", () => {
    const auth = categories().flatMap((c) => c.actions).filter((a) => a.auth).map((a) => a.id);
    expect(new Set(auth)).toEqual(new Set(["allow", "send", "fix"]));
  });

  it("draws Deny red and gives Reply a text field", () => {
    const actions = Object.fromEntries(categories().flatMap((c) => c.actions).map((a) => [a.id, a]));
    expect(actions.deny.destructive).toBe(true);
    expect(actions.send).toMatchObject({ title: "Reply", reply: { button: "Send", placeholder: "Reply…" } });
  });
```

- [ ] **Step 2: Run them and confirm they fail.**

Run: `npx vitest run static/src/notify`

Expected: FAIL.
- In copy, the new `category` assertions fail: for example `expected undefined to be 'needs_dialog'`, and `ci_failed_pr` comes back where `ci_failed` is expected.
- In actions, the categories map lacks `needs_permission`, …, and the cross-check names `needs_dialog` / `question` / `ci_failed` / `ci_failed_fix`, which aren't registered yet.

- [ ] **Step 3: Implement.**

In `static/src/notify/copy.js`'s `payloadFor`, replace the `case "needs_input":` and `case "question": {…}` cases with:

```js
    case "needs_input": {
      // Allow / Deny only when the server could name the request the dialog
      // asks (w.pending_permission, from the PermissionRequest hook); it
      // re-checks that on screen before a key goes in. Otherwise Open only.
      const perm = w.pending_permission;
      if (perm?.request_id && w.pid) {
        return {
          ...base, title: `${pane(w)} needs you`, subtitle: where(w),
          body: perm.summary ? `Allow ${perm.tool}: ${perm.summary}?` : `Allow ${perm.tool}?`,
          category: "needs_permission", data: { open: "pane", pid: w.pid, request_id: perm.request_id },
        };
      }
      return {
        ...base, title: `${pane(w)} needs you`, subtitle: where(w),
        body: NEEDS_BODY[waitKind(w.waiting_for)] || NEEDS_BODY.dialog,
        category: "needs_dialog", data: { open: "pane", pid: w.pid },
      };
    }
    case "question": {
      const a = ev.alert;
      return {
        ...base, title: `${clip(w ? paneLabel(w) : a.name || a.session || "A session", 26)} asks`,
        subtitle: w ? where(w) : a.session || "", body: clip(a.message, 180), target: a.target || base.target,
        // Reply types into the live pane; one that has gone has nowhere to send it.
        ...(w?.pid ? { category: "question" } : {}),
        data: { open: "pane", pid: w?.pid ?? null },
      };
    }
```

Then replace the `case "ci_failed": {…}` case with:

```js
    case "ci_failed": {
      const checks = (w.ci_checks || []).map((c) => `${CHECK_MARK[c.state] || "·"} ${c.name}`).join(" · ");
      const url = prUrl(w.repo_slug, w.pr);
      // Ask agent to fix types into the pane, so it needs one; Open PR a URL.
      let category;
      if (w.pid && url) category = "ci_failed";
      else if (w.pid) category = "ci_failed_fix";
      else if (url) category = "ci_failed_pr";
      return {
        ...base, title: `CI failed on #${w.pr}`, subtitle: [w.session, paneLabel(w)].filter(Boolean).join(" · "),
        body: checks || "Checks are failing.",
        ...(category ? { category } : {}),
        // `checks`: the failing ones' names, for Ask agent to fix's message.
        data: {
          open: "url", url, pid: w.pid, pr: w.pr,
          checks: (w.ci_checks || []).filter((c) => c.state === "failure").map((c) => c.name),
        },
      };
    }
```

In `static/src/notify/actions.js`, make three edits.

**(a)** Replace the header comment's second paragraph, the lines from `// A category is a fixed set of buttons, labels included, so copy.js gives` down to `// are PR 2's (docs/superpowers/specs/2026-10-26-native-notifications-2b-design.md).`, with:

```js
// A category is a fixed set of buttons, labels included, so copy.js gives
// each banner the variant whose buttons all apply: no Clean up without a
// worktree, no Open PR without a URL, no Allow / Deny without a request the
// server could name, and Spawn on {B} gets one category per B. Review diff
// isn't offered yet — it waits on review rows keyed by worktree (THI-433).
// Allow / Deny / Reply / Ask agent to fix make an agent act: they POST to
// routes/pane_actions.py, which re-checks the pane when pressed
// (docs/superpowers/specs/2026-10-26-native-notifications-2b-design.md).
```

**(b)** After `const DETAILS = act("details", "Details", { foreground: true });`, add:

```js
const OPEN = act("open", "Open", { foreground: true });
// `auth`: Touch ID or the password first when the screen is locked — every
// button that makes an agent act has it.
const FIX = act("fix", "Ask agent to fix", { auth: true });
```

**(c)** In `categories()`, after `{ id: "usage", actions: [DETAILS] },`, add:

```js
    // Deny is Escape ("No, and tell Claude what to do differently"), so it
    // needs no auth; macOS draws it red.
    {
      id: "needs_permission",
      actions: [act("allow", "Allow", { auth: true }), act("deny", "Deny", { destructive: true }), OPEN],
    },
    { id: "needs_dialog", actions: [OPEN] },
    // A category's buttons are static, so the placeholder can't name the pane.
    { id: "question", actions: [act("send", "Reply", { auth: true, reply: { button: "Send", placeholder: "Reply…" } }), OPEN] },
    { id: "ci_failed", actions: [FIX, OPEN_PR] },
    { id: "ci_failed_fix", actions: [FIX] },
```

`runAction` doesn't handle these buttons yet: a press only logs "unknown action" until Task 7.

- [ ] **Step 4: Run the tests and confirm they pass.**

Run: `npx vitest run static/src/notify && npx biome check --formatter-enabled=false static/src/notify`

Expected: every notify suite passes, and Biome reports no errors.

- [ ] **Step 5: Commit.**

```bash
git add static/src/notify/copy.js static/src/notify/actions.js static/src/notify/__tests__/copy.test.js static/src/notify/__tests__/actions.test.js
git commit -m "notify: permission, dialog, question and CI banners name their categories; actions registers Allow / Deny / Open / Reply / Ask agent to fix (THI-422)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: What the new buttons do

**Files:**
- Modify: `static/src/util.js` (append `postJson`)
- Modify: `static/src/notify/actions.js`:
  - the imports;
  - `OPENERS`;
  - new `fixMessage` and `agentAct`;
  - `runAction`.
- Create: `static/src/__tests__/postJson.test.js`
- Test: `static/src/notify/__tests__/actions.test.js`

`apiCall` toasts every failure and returns `null`, which hides the status. A 409 here isn't an error ("the banner is stale"), so this task adds a status-aware `postJson` beside `apiCall` instead of changing `apiCall`'s contract. THI-426's rail card can reuse it.

- [ ] **Step 1: Write the failing tests.**

Create `static/src/__tests__/postJson.test.js`:

```js
// postJson: the status-aware POST behind the banner buttons that make an
// agent act (notify/actions.js), where a 409 is an answer, not an error to toast.
import { afterEach, describe, expect, it, vi } from "vitest";
import { postJson } from "../util.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("postJson", () => {
  it("sends a JSON body and reports the status", async () => {
    const spy = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) }));
    vi.stubGlobal("fetch", spy);
    expect(await postJson("/api/pane/reply", { pid: "p1", text: "hi" })).toEqual({ ok: true, status: 200, detail: "HTTP 200" });
    expect(spy).toHaveBeenCalledWith("/api/pane/reply", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pid: "p1", text: "hi" }),
    });
  });

  it("hands back a refusal's status and detail instead of toasting", async () => {
    vi.stubGlobal("fetch", async () => ({ ok: false, status: 409, json: async () => ({ detail: "stale" }) }));
    expect(await postJson("/x", {})).toEqual({ ok: false, status: 409, detail: "stale" });
  });

  it("says the status for a validation error's list detail", async () => {
    vi.stubGlobal("fetch", async () => ({ ok: false, status: 422, json: async () => ({ detail: [{ msg: "x" }] }) }));
    expect((await postJson("/x", {})).detail).toBe("HTTP 422");
  });

  it("tolerates a body that isn't JSON", async () => {
    vi.stubGlobal("fetch", async () => ({ ok: false, status: 500, json: async () => { throw new Error("html"); } }));
    expect(await postJson("/x", {})).toEqual({ ok: false, status: 500, detail: "HTTP 500" });
  });

  it("never throws: a network failure is status 0", async () => {
    vi.stubGlobal("fetch", async () => { throw new Error("offline"); });
    expect(await postJson("/x", {})).toEqual({ ok: false, status: 0, detail: "offline" });
  });
});
```

In `static/src/notify/__tests__/actions.test.js`, make four edits.

1. Change `const { categories, runAction, OPENERS } = await import("../actions.js");` to:

```js
const { categories, fixMessage, runAction, OPENERS } = await import("../actions.js");
```

2. Replace the `openers` helper with:

```js
const openers = () => ({
  openExternal: vi.fn(), openUsageDetails: vi.fn(), pickSpawnAccount: vi.fn(), openCleanupModal: vi.fn(),
  markReadySeen: vi.fn(), selectReview: vi.fn(), selectPane: vi.fn(), revealPane: vi.fn(),
  post: vi.fn(async () => ({ ok: true, status: 200, detail: "" })), toast: vi.fn(),
});
```

3. In `"ignores an action it doesn't know, and tolerates null data from the shell"`, change `action: "allow"` to `action: "frobnicate"`, since `allow` is now known.
4. Append to the end of the file:

```js

describe("runAction: the buttons that make an agent act", () => {
  const PERMISSION = { pid: "p1", request_id: "a1b2c3d4e5f60718" };

  it("Allow and Deny answer the banner's request on its pane", async () => {
    const o = openers();
    await runAction({ target: "s:1", action: "allow", data: PERMISSION }, o);
    expect(o.post).toHaveBeenLastCalledWith("/api/pane/permission", { ...PERMISSION, choice: "allow" });
    await runAction({ target: "s:1", action: "deny", data: PERMISSION }, o);
    expect(o.post).toHaveBeenLastCalledWith("/api/pane/permission", { ...PERMISSION, choice: "deny" });
    // Success shows nothing more: the pane's next state shows it working.
    expect(o.selectPane).not.toHaveBeenCalled();
    expect(o.toast).not.toHaveBeenCalled();
  });

  it("a 409 (the banner went stale) shows the pane as it is now, without a toast", async () => {
    const o = { ...openers(), post: vi.fn(async () => ({ ok: false, status: 409, detail: "stale" })) };
    windows.value = [{ pid: "p1", target: "s:4" }];
    await runAction({ target: "s:1", action: "allow", data: PERMISSION }, o);
    expect(o.selectPane).toHaveBeenCalledWith(windows.value[0]);
    expect(o.toast).not.toHaveBeenCalled();
  });

  it("any other failure shows the pane and toasts the error", async () => {
    const o = { ...openers(), post: vi.fn(async () => ({ ok: false, status: 500, detail: "tmux died" })) };
    windows.value = [];
    await runAction({ target: "s:1", action: "deny", data: PERMISSION }, o);
    expect(o.revealPane).toHaveBeenCalledWith("s:1");
    expect(o.toast).toHaveBeenCalledWith("Deny failed: tmux died", "bad", 6000);
  });

  it("never rejects, even when the request itself throws", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const o = { ...openers(), post: vi.fn(async () => { throw new Error("boom"); }) };
    await expect(runAction({ target: "s:1", action: "allow", data: PERMISSION }, o)).resolves.toBeUndefined();
    expect(o.revealPane).toHaveBeenCalledWith("s:1");
  });

  it("a banner without a pane has nothing to answer: it reveals instead", async () => {
    const o = openers();
    await runAction({ target: "s:1", action: "allow", data: { request_id: "a1b2c3d4e5f60718" } }, o);
    expect(o.post).not.toHaveBeenCalled();
    expect(o.revealPane).toHaveBeenCalledWith("s:1");
  });

  it("Reply sends the typed text, trimmed; an empty reply does nothing", async () => {
    const o = openers();
    await runAction({ target: "s:1", action: "send", text: "  Postgres, please ", data: { pid: "p1" } }, o);
    expect(o.post).toHaveBeenCalledWith("/api/pane/reply", { pid: "p1", text: "Postgres, please" });
    o.post.mockClear();
    await runAction({ target: "s:1", action: "send", text: "   ", data: { pid: "p1" } }, o);
    await runAction({ target: "s:1", action: "send", data: { pid: "p1" } }, o);
    expect(Object.values(o).some((f) => f.mock.calls.length)).toBe(false);
  });

  it("Ask agent to fix tells the pane which checks failed on which PR", async () => {
    const o = openers();
    await runAction({ target: "s:1", action: "fix", data: { pid: "p1", pr: 7, checks: ["test", "lint"] } }, o);
    expect(o.post).toHaveBeenCalledWith("/api/pane/reply", {
      pid: "p1", text: "CI failed on #7: test · lint. Please investigate and fix.",
    });
    expect(fixMessage(7, [])).toBe("CI failed on #7: Checks are failing. Please investigate and fix.");
  });

  it("Open shows the live pane, else reveals the banner's target", () => {
    const o = openers();
    windows.value = [{ pid: "p1", target: "s:4" }];
    runAction({ target: "s:1", action: "open", data: { pid: "p1" } }, o);
    expect(o.selectPane).toHaveBeenCalledWith(windows.value[0]);
    windows.value = [];
    runAction({ target: "s:1", action: "open", data: { pid: "p1" } }, o);
    expect(o.revealPane).toHaveBeenCalledWith("s:1");
  });
});
```

- [ ] **Step 2: Run them and confirm they fail.**

Run: `npx vitest run static/src/notify/__tests__/actions.test.js static/src/__tests__/postJson.test.js`

Expected: FAIL:
- `postJson is not a function`;
- the test-double cross-check fails, because OPENERS lacks `post` and `toast`;
- `fixMessage is not a function`;
- the new runAction tests fail, because "unknown action" means `post` is never called.

- [ ] **Step 3: Implement.**

Append to `static/src/util.js`:

```js

// A JSON POST that reports how it went instead of toasting: { ok, status,
// detail }. For callers that treat a status as an answer — a 409 from
// /api/pane/permission means "the banner is stale", not an error — which
// apiCall hides behind null after toasting. Never throws: a network failure
// is status 0. A JSON body is also what the agent-acting routes require
// (routes/pane_actions.py), so this always sends one.
export async function postJson(path, body) {
  let res;
  try {
    res = await fetch(path, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
  } catch (err) {
    return { ok: false, status: 0, detail: err?.message || String(err) };
  }
  let data = {};
  try { data = (await res.json()) || {}; } catch (_) {}
  // FastAPI's 422 detail is a list of errors: say the status instead.
  const detail = typeof data.detail === "string" ? data.detail : data.error || `HTTP ${res.status}`;
  return { ok: res.ok, status: res.status, detail };
}
```

In `static/src/notify/actions.js`, make four edits.

**(a)** Imports. Add `import { showToast } from "../overlays/Toast.jsx";` after the `CleanupModal.jsx` import, and `import { postJson } from "../util.js";` after the `../tauri.js` import. The block becomes:

```js
import { accountLabel } from "../accounts.js";
import { pickSpawnAccount } from "../chrome/SpawnAccountPicker.jsx";
import { openUsageDetails } from "../chrome/UsagePill.jsx";
import { openCleanupModal } from "../overlays/CleanupModal.jsx";
import { showToast } from "../overlays/Toast.jsx";
import { markReadySeen, revealPane, selectPane, selectReview } from "../split/alertFeed.js";
import { windows } from "../store.js";
import { openExternal } from "../tauri.js";
import { postJson } from "../util.js";
import { usageCategory } from "./copy.js";
```

**(b)** Replace the `export const OPENERS = Object.freeze({…});` statement with:

```js
export const OPENERS = Object.freeze({
  openExternal, openUsageDetails, pickSpawnAccount, openCleanupModal, markReadySeen, selectReview, selectPane, revealPane,
  post: postJson, toast: showToast,
});

// What a failed agent-acting press says in its toast.
const ACT_LABEL = { allow: "Allow", deny: "Deny", send: "Reply", fix: "Ask agent to fix" };

// The message Ask agent to fix types into the pane: the PR and the names of
// its failing checks (copy.js puts them in data.checks).
export function fixMessage(pr, checks) {
  const what = checks?.length ? `${checks.join(" · ")}.` : "Checks are failing.";
  return `CI failed on #${pr}: ${what} Please investigate and fix.`;
}

// A press that makes the agent act. The server re-checks the pane and
// answers 409 when the banner no longer matches it (another request, the
// dialog gone, a dialog just opened): that only needs the pane shown as it is
// now. Any other failure shows it too, with the error. Success needs
// nothing: the pane's next state shows it working. Never rejects.
async function agentAct(action, path, body, show, o) {
  try {
    if (!body.pid) {
      show();
      return;
    }
    const r = await o.post(path, body);
    if (r?.ok) return;
    show();
    if (r?.status !== 409) o.toast(`${ACT_LABEL[action]} failed: ${r?.detail || "no answer"}`, "bad", 6000);
  } catch (e) {
    console.error("[notify] action failed", action, e);
    try {
      show();
    } catch (e2) {
      console.error("[notify] reveal failed", e2);
    }
  }
}
```

**(c)** Change `runAction`'s comment tail and signature from:

```js
// Never throws: a failed press still shows you something.
export function runAction({ target, action, data } = {}, o = OPENERS) {
```

to:

```js
// Never throws: a failed press still shows you something. The agent-acting
// presses return agentAct's promise, which never rejects either.
export function runAction({ target, action, text, data } = {}, o = OPENERS) {
```

**(d)** In `runAction`'s `switch`, directly before `default:`, add:

```js
      case "allow":
      case "deny":
        return agentAct(action, "/api/pane/permission", { pid: data.pid, request_id: data.request_id, choice: action }, show, o);
      case "send": {
        // An empty reply says nothing; there's nothing to send.
        const reply = String(text || "").trim();
        if (!reply) return;
        return agentAct(action, "/api/pane/reply", { pid: data.pid, text: reply }, show, o);
      }
      case "fix":
        return agentAct(action, "/api/pane/reply", { pid: data.pid, text: fixMessage(data.pr, data.checks) }, show, o);
      case "open":
        show();
        return;
```

`feed.js` needs no change. It already routes every press with `onNotificationAction((p) => runAction(p))`, and the returned promise never rejects.

- [ ] **Step 4: Run the tests and confirm they pass.**

Run:

```bash
npx vitest run static/src/notify static/src/__tests__/postJson.test.js
npx biome check --formatter-enabled=false static/src/notify static/src/util.js static/src/__tests__/postJson.test.js
npm test 2>&1 | grep -E "Tests |Test Files"
```

Expected:
- all pass;
- Biome reports no errors (the repo's three pre-existing warnings elsewhere are unchanged);
- `npm test` reports every file and test passing.

- [ ] **Step 5: Commit.**

```bash
git add static/src/util.js static/src/notify/actions.js static/src/notify/__tests__/actions.test.js static/src/__tests__/postJson.test.js
git commit -m "notify: Allow / Deny / Reply / Ask agent to fix POST to the pane-action routes; a 409 reveals the pane, other failures toast (THI-422)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Docs, bundle, gate

**Files:**
- Modify: `docs/superpowers/specs/2026-10-26-native-notifications-2b-design.md` (a "Revised in planning" block)
- Modify: `docs/channels.md` (a new last section)
- Modify: `docs/tauri-shell.md` ("Notifications across version skew")
- Modify: `CLAUDE.md` (three reference-table rows and the frontend notifications row)
- Modify: `static/dist/*` (rebuilt)

- [ ] **Step 1: The spec.** In `docs/superpowers/specs/2026-10-26-native-notifications-2b-design.md`, directly above `## Errors` (after the PR 2 "What each PR 2 button does" list), insert:

```markdown
### Revised in planning (PR 2)

Checked against real dialogs captured from Claude Code 2.1.280 (`tests/fixtures/permission_dialogs/`).

- **The permission dialog's footer is `Esc to cancel · Tab to amend`.**
  - That's outside `NEEDS_INPUT_FOOTER_RE`'s family (`Enter to select · … · Esc to cancel`).
  - So `panes.permission_dialog` recognises the dialog by its own shape: a `Do you want to …?` question, `❯ 1. Yes` on the next line, and the `Esc to cancel` footer ending the screen.
- **Where the dialog text starts.** `permission_dialog` returns the dialog's text from the full-width rule Claude draws above it to the footer.
  - Not from the question line: Bash's command sits above it.
  - Never further up: the scrollback's `⏺ Bash(…)` header can quote the same command.
- **The screen token.**
  - For Edit / Write / NotebookEdit, it's the file's basename: the dialog shows a path relative to the cwd, and the hook stores it absolute.
  - Otherwise it's the summary's first 40 characters.
  - Both sides are compared with all whitespace removed, since a long line wraps mid-word onto an indented row.
  - A file tool's summary keeps the path's end when it's clipped, so the basename survives.
- **Reply's dialog check** is `panes.dialog_open`: the choice-dialog footer (`_detect_needs_input`) or a permission dialog.
- **Both endpoints refuse a body that isn't `application/json`, with a 415.**
  - FastAPI parses a body sent with no Content-Type as JSON.
  - A typeless POST is a CORS simple request.
- **The keys, pinned:**
  - `1` approves at once, with no Enter.
  - `Escape` shows `Interrupted · What should Claude do instead?` and leaves the pane waiting.
  - "No" is option 4 for Bash and option 3 for Write, so a number is never sent for it.
- **`question`'s reply placeholder is a fixed "Reply…".** macOS categories are static, so it can't name the pane.
- **`ci_failed` with a live pane and no URL** gets `ci_failed_fix`, with Ask agent to fix only.
- **`bin/periscope install-hook` joins only a matcher-less hook group.** A user's matcher-scoped `PermissionRequest` group can't narrow ours.
- **Claude Code 2.1.280's default permission mode is auto.** So permission banners appear only for panes in manual mode, or when auto mode defers to you.
```

- [ ] **Step 2: `docs/channels.md`.** Append at the end of the file:

```markdown

## Permission requests (a banner's Allow / Deny)

**`pane_permission_hook.py`** is the recorder behind a banner's Allow / Deny.
- **Registration.** `bin/periscope install-hook` registers it on Claude's `PermissionRequest` event, beside `pane_session_hook.py`, with no matcher, so it runs for every tool. `uninstall-hook` removes it.
- **Timing.** Claude runs it just before a permission dialog renders.
- **What it writes.** One row in `pane_permissions` in prod's `periscope.db`:
  - the `TMUX_PANE`;
  - the session and agent ids;
  - the tool;
  - a summary of what it asks, at most 80 characters: Bash's first command line, a file tool's path, WebFetch's URL, or else the first string argument.

  It prunes rows older than a day.
- **The request id.** The payload carries no `tool_use_id`, so `request_id` is a hash of the session, tool, input and time.
- **It only observes.** Whatever a `PermissionRequest` hook prints is read as its decision on the dialog. So it prints nothing and always exits 0, and a pane without `TMUX_PANE` writes nothing.

**Publishing.** `window_view.pending_permission_for` sets `w.pending_permission = {request_id, tool, summary}` only when both hold:
- the pane waits on a `permission prompt` (the session file's `waitingFor`);
- exactly one row falls in this wait (`created_at >= needs_since - 2`).

Two or more rows can't be told apart, so the banner offers Open only. They come from parallel tool calls each asking, or from back-to-back prompts inside one poll.

**Answering.** `POST /api/pane/permission` (`routes/pane_actions.py`):
1. recomputes the request from the rows;
2. checks a fresh capture with `panes.permission_dialog` and `dialog_shows`;
3. sends `1` (Yes) or Escape (No, and tell Claude what to do differently).

**Gaps:**
- The hook writes prod's DB only, since it can't know which instance is looking, so a dev server never publishes `pending_permission`.
- A Claude that hasn't loaded the hook, and a pane in auto mode (2.1.280's default, which asks only when it defers to you), get the Open-only banner.
```

- [ ] **Step 3: `docs/tauri-shell.md`.** In "Notifications across version skew", replace:

```markdown
- A press on a banner's button (2b) goes out on `periscope:notification-action` as `{target, kind, action, text, data}`; `notify/actions.js`'s `runAction` dispatches it.
```

with:

```markdown
- A press on a banner's button (2b) goes out on `periscope:notification-action` as `{target, kind, action, text, data}`; `notify/actions.js`'s `runAction` dispatches it. The presses that make an agent act (Allow, Deny, Reply, Ask agent to fix) POST to `routes/pane_actions.py`, which re-checks the pane, so a stale banner's press can only reveal it.
```

- [ ] **Step 4: `CLAUDE.md`.** Make four edits.

1. In the invariants row, change the first cell's ending `` `tracks.py`, `routes/send.py` | `` to `` `tracks.py`, `routes/send.py`, `routes/pane_actions.py` | ``.
2. Replace the channels row with:

```markdown
| `channels.py`, `channel_shim.py`, `turns.py`, `pane_session_hook.py`, `codex_pane_session_hook.py`, `pane_permission_hook.py` | `docs/channels.md` — MCP tools, shim reconnect protocol, pane→session mapping (live sid first, `pane_sessions` fallback), the `PermissionRequest` recorder behind a banner's Allow / Deny (prints nothing, ever) |
```

3. In the notify row, change its ending `categories are data the webview registers, one per variant whose buttons all apply |` to:

```markdown
categories are data the webview registers, one per variant whose buttons all apply; Allow / Deny / Reply / Ask agent to fix POST to `routes/pane_actions.py`, which re-checks the pane when pressed |
```

4. In the frontend table's notifications row, change `` + `notify/feed.js` (the effect, badge, click routing) `` to:

```markdown
+ `notify/actions.js` (each banner category's buttons and what a press does) + `notify/feed.js` (the effect, badge, click routing)
```

- [ ] **Step 5: Bundle and gate.**

```bash
npm run build
bin/check && npm test && uv run pytest -q
```

Expected:
- `npm run build` ends with `✓ built in …`;
- `bin/check` ends with `✓ all checks passed`;
- vitest passes every file;
- pytest passes every test (about 1670).

- [ ] **Step 6: Commit.** The docs and the bundle go in separate commits.

```bash
git add docs/superpowers/specs/2026-10-26-native-notifications-2b-design.md docs/channels.md docs/tauri-shell.md CLAUDE.md
git commit -m "docs: PR 2's refinements in the 2b spec; the PermissionRequest recorder in channels.md; pane_actions in CLAUDE.md and tauri-shell.md (THI-422)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
git add static/dist
git commit -m "build: static/dist

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 9 (controller): PR, merge, deploy, hand check

1. **Open the PR.**
   - Push `feature/notify-permission` to `fork`.
   - Open the PR against `tomplex/periscope:main`, titled `THI-422: banner buttons, part 2 — Allow / Deny, replies, Ask agent to fix`.
   - The body summarises the buttons and the guards (request id + screen, 409 → reveal, JSON only, no reply into a dialog). It says no `.app` rebuild is needed, gives the deploy order, and ends with the attribution line.
2. **Merge.** Wait for CI (`check`, `pytest`) to go green, then merge with `gh pr merge --merge`.
3. **Deploy.** In the main checkout:

   ```bash
   git fetch origin && git merge --ff-only origin/main
   bin/periscope install-hook
   bin/periscope restart
   ```

   - `install-hook` should print `installed periscope hooks in …/settings.json on: PermissionRequest` for each account dir.
   - Check that `/api/healthz` reports the merge commit and that the served `/dist/app.js` matches main's.
   - No `.app` rebuild.
4. **Hand check, for the user**, in a periscope-managed pane taken out of auto mode (shift+tab until the footer no longer says auto mode, or start Claude with `--permission-mode default`):
   1. **Does a running session pick up the hook?** Use a pane started *before* `install-hook`:
      - ask it to run `touch /tmp/probe-allow.txt`;
      - check `sqlite3 ~/.config/periscope/periscope.db "select pane_id, tool, summary from pane_permissions order by created_at desc limit 3"`.

      A row means hooks load live. If there's none, start a fresh pane for the rest, and correct the "Notes" line in `docs/channels.md` / the spec to say which.
   2. **Allow:**
      - ask for `touch /tmp/probe-allow.txt`;
      - the banner reads `Allow Bash: touch /tmp/probe-allow.txt?` with Allow · Deny · Open;
      - Allow runs it without a keystroke in the pane, and asks for Touch ID when the screen is locked.
   3. **Deny:** ask for `touch /tmp/probe-deny.txt`, then press Deny. The pane shows `Interrupted · What should Claude do instead?` and waits, and the file isn't created.
   4. **A stale banner:**
      - trigger a prompt and answer it in the pane, not on the banner;
      - trigger a different one;
      - press the first banner's Allow from Notification Center.

      The pane is revealed and nothing is sent, so the second dialog is still up.
   5. **Reply:**
      - have a pane send a question: ask it to call periscope's `notify` tool with `kind: "need_human"` and a message;
      - on the `{pane} asks` banner, press Reply, type, then Send;
      - the text arrives as the pane's next prompt.

      Then repeat with a dialog open in that pane. The press reveals the pane and nothing is typed.
   6. **Ask agent to fix:** on the next red linked PR (or a throwaway PR linked with `link_pr`, with a failing commit), press Ask agent to fix. The pane receives `CI failed on #N: <checks>. Please investigate and fix.`
5. **Clean up:**
   - `git worktree remove .claude/worktrees/notify-permission`;
   - `git branch -d feature/notify-permission`;
   - `git push fork --delete feature/notify-permission`;
   - file the follow-up ticket for `parse_pane`'s footer gap (Notes) in the personal Linear workspace (THI).
