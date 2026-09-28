# Periscope on Linux

**Status:** draft — D1–D5 proposed. Nothing here has been run on Linux; every
Linux claim is from documentation or from reading code on macOS. Tier:
**Brief**, worked on the desktop.

**Prerequisite for:** `2026-09-28-remote-machines-design.md`.

**Goal.** Periscope runs on the Linux desktop as it does on the laptop: the
dashboard shows that machine's panes with state, transcript, PR, usage and
status lines, and it keeps running across logout and reboot.

## Decisions

### D1 — One codebase for both platforms

No fork and no Linux branch. Platform differences sit in the few places that
touch the operating system: reading the login credential, listing processes,
reading a process's environment, and installing the background service.

### D2 — On the desktop, periscope is a per-user background service that starts at boot

It starts without anyone logging in and survives logout. The tmux server and
the Claudes in it survive logout too.

Why: the remote-machines goal is Claudes that keep running while the laptop is
away. A service that stops at logout breaks that on the first reboot.

### D3 — The desktop mirrors the laptop's setup

| Thing | Rule |
|---|---|
| Directory layout | Repos under `~/dev`, worktrees under `~/dev/worktrees` |
| Accounts | The same subscriptions, with the same ids and labels as on the laptop |
| Morning poke | Off on the desktop |
| Status lines | The desktop has its own API key |

### D4 — Mac-only actions are hidden on Linux, not ported

Open-in-editor and reveal-in-file-manager do not appear on a Linux instance.

### D5 — The work is done on the desktop, and accepted on the desktop

A Claude running on the desktop does the port. Nothing is called working from
the laptop's test run.

## Acceptance

Observed on the desktop, with the dashboard opened from the laptop through a
hand-made port forward:

| # | Check |
|---|---|
| A1 | The full test suite passes on the desktop |
| A2 | A Claude pane shows working, needs-input and idle correctly |
| A3 | A pane's transcript opens and is that pane's own |
| A4 | The usage display shows both accounts with real numbers |
| A5 | A pane's account chip matches the account it was started on |
| A6 | A status line appears on an active pane |
| A7 | Typing in the dashboard terminal reaches the pane |
| A8 | After a reboot with no login, the dashboard answers and restored panes are present |
| A9 | `bin/periscope update` on the desktop pulls, restarts the service, and the dashboard comes back |

## Checklist

| Item | What changes | Where |
|---|---|---|
| Login credential | Read `$CLAUDE_CONFIG_DIR/.credentials.json` on Linux; Keychain on macOS | `usage.py:161-195` |
| Process detection | Match on arguments or `/proc/<pid>/exe`. The process-name column is a truncated basename on Linux, so a match on it can miss every Claude | `session_status.py:152-157` |
| Process environment | Read `/proc/<pid>/environ` on Linux in place of `ps eww` | `session_status.py:298-376` |
| Process listing | `ps -A -o`, documented on both platforms | `session_status.py:163,196`, `agent_processes.py:70`, `pidfile.py:34` |
| Service install | A systemd user unit beside the launchd plist | `bin/periscope:10-11,54-99,116,174-185` |
| Self-update | Restart through the service manager in use | `updater.py:151-186`, `bin/periscope` |
| Survive logout and reboot | `loginctl enable-linger` for the user | setup step |
| tmux persistence | The resurrect and continuum setup | `tmux_persist.py`, `bin/periscope install-tmux` |
| The `claude` wrapper | Installed in the desktop's shell; carries profile and account | `docs/wrapper-profiles.md` |
| Hooks | Installed into each account's settings | `bin/periscope install-hook` |
| Mac-only actions | Hidden when the server is not macOS | `editors.py:25-58`, `fs.py:213-221` |

## Worry list (unverified)

- **W1** The credential file on Linux has the shape the usage fetch expects
  (`usage.py:180-190`). Its location is from Claude Code's documentation.
- **W2** Process listing columns on Linux: `lstart` depends on locale;
  `etime`, `rss`, `state` are expected to parse the same.
- **W3** What the process name of a running Claude is on Linux. If it is a
  version string, name matching fails and every Claude reads as dead.
- **W4** The desktop's tmux version supports control mode and
  `capture-pane -N` (`tmux_mirror.py:278,431`).
- **W5** The file-descriptor count in the activity worker reads `/dev/fd`
  (`activity.py:970-975`), commented as macOS; expected to work on Linux.
- **W6** The channel shim and the `mcp` pin behave the same on Linux
  (`tests/test_channel_shim.py`).
- **W7** Tests that spawn real tmux pass on the desktop's tmux version
  (`tests/test_tmux_mirror.py`, `tests/test_open_ops.py`).

## Cross-reference files

`periscope/usage.py`, `periscope/session_status.py`,
`periscope/agent_processes.py`, `periscope/pidfile.py`,
`periscope/updater.py`, `periscope/editors.py`, `periscope/fs.py`,
`periscope/tmux_persist.py`, `periscope/activity.py`, `bin/periscope`,
`docs/updating.md`, `docs/tmux-persistence.md`, `docs/wrapper-profiles.md`,
`docs/second-account-setup.md`, `docs/testing.md`.
