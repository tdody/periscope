# tmux persistence (`periscope/resurrect.py`)

Session survival across reboots is tmux-resurrect + tmux-continuum, with two
periscope hooks into it.

**Save-file rewrite (`python -m periscope.resurrect <file>`).** Registered as
`@resurrect-hook-post-save-layout` via `bin/periscope resurrect-rewrite`.
Resurrect re-runs each Claude pane's captured command, but that command starts
a *fresh* session — no `--resume <uuid>`. This rewrites each Claude pane's
command in the just-written save file. It must run at SAVE time while panes are
live: the pane→session map is keyed by tmux pane id, and pane ids are reassigned
when the server restarts, so at restore time there is nothing left to map.
Import discipline: stdlib + `periscope.config` only — it runs under plain
`python3`, and `periscope.activity` would drag in the Anthropic SDK.

**One `--resume` per session per save.** After the rewrite, if several pane
lines resume the same session (captured argv included — a restored zombie's
argv already says `--resume`), only one keeps it: the pane whose live claude
touched its session file last, then the active pane, then the first line. The
rest restore as a fresh `claude` with their env prefixes and channel flags.
Two Claudes on one session both write its transcript; this is the backstop
that stops a duplicated layout (see the plugin rule below) from compounding.

**Periscope drives the periodic save (`resurrect.save_now()`).**
tmux-continuum has NO timer: its save fires purely as a side effect of
`status-right` being *expanded*, which only happens when a status line is drawn
for a client. Every client periscope attaches is control-mode (the pane mirror
and the input client) and control-mode clients render no status line — so on a
host driven entirely through the dashboard, continuum silently never saves.
Observed: a 24-day gap between saves, after which a reboot restored a 24-day-old
layout. The activity worker now calls `save_now()` each tick; the script
self-gates on `@continuum-save-interval` and takes its own lock, so calling it
every 30s only writes when an interval has actually elapsed. Prod-only, and it
degrades silently when continuum isn't installed.

**`bin/periscope install` provisions the tmux side too (`install-tmux`,
`periscope/tmux_persist.py`).** It clones TPM if absent, runs TPM's
non-interactive `bin/install_plugins` for resurrect + continuum, writes a
periscope-owned `~/.config/periscope/tmux.conf` (the three `@plugin` lines,
`@continuum-restore on`, `@resurrect-processes '~claude'`, and
`@resurrect-hook-post-save-layout` pointing at THIS checkout), and adds one
`source-file` line to the user conf (`~/.tmux.conf`, or the XDG one TPM
prefers — see below) — inserted directly above an existing
`run ... tpm/tpm` line, or appended together with one, because TPM only
installs plugins declared before it runs. The owned file is regenerated
wholesale on every `install`/`update` (never merged); `uninstall-tmux` removes
the line and the file and leaves the plugins. TPM reports a failed clone only
as text, so the verb checks the three plugin directories itself and fails
loudly — a silently missing plugin is a silently missing save. A running
server is re-sourced so the hook path is live immediately; continuum's
auto-restore is gated on server start time, so that never restores over it.

**Every plugin is declared exactly once across what TPM reads.** TPM does not
dedupe `@plugin` lines: a user who already declares tpm/resurrect/continuum in
`~/.tmux.conf` and also sources the owned file gets each plugin's `*.tmux` run
twice — and continuum, run twice, starts TWO background restores at server
start. They race through the same save file; one that sees "pane missing,
window present" while the other is mid-create splits the window again, leaving
an extra shell pane. Resume a Claude in it and the next save records it, so
the window gains a pane every restart (observed 2026-10: one window at three
panes, all `--resume`-ing one session, two of them zombie Claudes). So
`install` omits from the owned file any plugin declared elsewhere, and healthz
reports `plugin_declarations` (each must be 1). "What TPM reads" is resolved
exactly as TPM resolves it (`scripts/helpers/plugin_functions.sh`), because a
file read differently is a declaration miscounted: the user conf is
`$XDG_CONFIG_HOME/tmux/tmux.conf` when it exists, else `~/.tmux.conf` (TPM
reads one, never both — so that is also where the source line goes); a
`source-file` line's paths are word-split, a leading `~` or `$HOME` expanded,
and each word globbed. A literal-path read missed `source-file $HOME/…` and
`…/*.conf`, so install declared continuum a second time. Check by hand:
`bash -c 'source ~/.tmux/plugins/tpm/scripts/helpers/plugin_functions.sh; tpm_plugins_list_helper' | sort | uniq -c`.

`GET /api/healthz` carries a `resurrect` block built from the LIVE tmux
server's options (not the conf file — the file being right and the server
having sourced it are different facts): plugin dirs, `conf_sourced`,
`restore_on`, `processes_ok`, `hook_current` (live hook == this checkout), and
`last_save_at` / `last_save_stale` (older than 2× the live save interval; a
missing save is not stale, a fresh install hasn't had one yet), and
`plugin_declarations` (see above). `ok` is the conjunction. `python3 -m periscope.tmux_persist status <repo>` prints the same
without a server round-trip.

Diagnosing a stale restore: `ls -lt ~/.local/share/tmux/resurrect/` — gaps in
that timeline are the story. `tmux list-clients -F "#{client_flags}"` tells you
whether anything is drawing a status line.
