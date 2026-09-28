# Remote machines: panes on another host as full citizens

**Status:** draft — D1, D4, D5, D6, D8, D9, D10, D12 settled with Tom
(2026-09-28); D2, D3, D7, D11 proposed, no objection raised; O1 open. Next:
spec-reviewer takes the worry list. Tier: **Full** (five phases, spans
sessions).

**Goal.** From the laptop's dashboard, and from a Claude running on the
laptop, spawn Claudes onto the Linux desktop and have each one show up as a
full card: live terminal, working/idle state, transcript, PR, alerts,
messaging.

**Approach in one sentence.** The desktop runs its own periscope; the laptop's
periscope links to it over SSH, merges its panes into one rail, and relays
every action to it.

## Vocabulary

| Term | Meaning |
|---|---|
| **machine** | A host running periscope, with its own tmux server, Claude logins, repos and stores |
| **viewer** | The machine whose dashboard is open in the browser (the laptop) |
| **remote** | A machine the viewer is linked to (the desktop) |
| **link** | The one SSH connection between a viewer and a remote |
| **pane facts** | What is true of a pane regardless of who looks: name, state, transcript, linked PR and ticket, alerts, notes, account, who spawned it |
| **layout** | How a viewer arranges what it shows: order, collapsed groups, pins, selection |

## Decisions

### D1 — Every machine runs its own periscope; the viewer links to it

Everything periscope knows about a pane beyond its terminal comes from the
pane's own machine: the process table, Claude's session files, transcripts,
git. Reaching for each of those over SSH changes the meaning of nearly every
call in the codebase. Running periscope where the panes live keeps every
existing assumption true.

**Guarantee:** a Claude on the desktop keeps running, keeps its state, and
keeps reporting while the laptop is asleep, closed, or off the network.

Rejected: driving the desktop's tmux directly over SSH. It yields a terminal
with no state, transcript, PR or messaging.

### D2 — The browser talks only to the viewer

The viewer relays to the remote. The browser never learns the remote exists as
a server. This keeps one unauthenticated server in front of the browser
instead of two.

### D3 — One SSH connection per remote, owned by periscope

The viewer starts it, watches it, and restarts it. It carries traffic in both
directions. Nothing listens on the network on either machine; each end of the
link is reachable only by your own OS user on that machine.

### D4 — Trust is asymmetric

Periscope has no authentication. Today "can reach it" means "is you, on this
machine." The link extends reach across machines, so the rule has to be
explicit.

| Direction | May do |
|---|---|
| viewer → remote | Everything the remote's own dashboard can do |
| remote → viewer | A fixed list only: list the viewer's Claudes, deliver a message to one, read one's transcript |

A remote cannot type into the viewer's terminals, spawn or terminate there,
read its files, or change its settings.

Why asymmetric: the laptop holds the SSH keys and the credentials. A
compromised desktop must not become a compromised laptop.

Accepted: whoever controls your laptop account controls the desktop's
periscope. That is already true of anything holding your SSH key.

### D5 — Pane facts live with the pane's machine; layout lives with the viewer

| Thing | Owner |
|---|---|
| Name, state, transcript, linked PR and ticket, alerts, notes, open file tabs, account, who spawned it | The pane's machine |
| Which group a pane belongs to | The pane's machine |
| Which groups from different machines show as one | The viewer |
| Order of groups and tabs, collapsed groups, pins, current selection | The viewer |

Why: pane facts are written by the Claude in the pane, on its machine, and
must be the same for anyone looking. Layout is a preference of whoever is
looking.

### D6 — Rail groups combine across machines; each pane carries a machine chip

One piece of work is one group, wherever its panes run. A worker spawned onto
the desktop lands in its spawner's group.

| Group kind | Shown as one group when |
|---|---|
| Repo group | Both checkouts have the same origin remote (owner and name) |
| Named group | Both machines have a group with the same name |
| Ungrouped | Always |

Rules that follow:

- A repo with no origin remote is never combined; it shows per machine.
- Inside a combined group, panes on the same branch name sit together even
  though they are two checkouts, possibly at different commits. The chip and
  each pane's own git state tell them apart.
- A new tab in a combined group asks which machine, defaulting to the machine
  last used in that group.
- Moving a pane into a named group creates that group on the pane's machine
  when it is missing there.
- Rename, dissolve and tear-down of a named group apply on every machine
  holding part of it, and are refused while any such machine is unreachable.
  Repo groups and the ungrouped bucket have no such actions.

### D7 — Outside its own machine, every handle names its machine

Local handles keep their current form. A remote pane's handle carries the
machine's name.

**Guarantee:** a handle stored in layout or given to a Claude identifies
exactly one pane across all linked machines.

### D8 — A dropped link loses nothing and hides nothing

- Remote panes stay in the rail at their last known state, marked unreachable
  with how long ago, actions disabled.
- Layout belonging to an unreachable machine is never pruned.
- A message to an unreachable machine fails at once, with the reason.
- A worker's report to a spawner it cannot reach becomes an alert on the
  worker's own card, and shows up when the link returns.

### D9 — Spawning onto a remote: the caller names the machine, the machine decides the rest

- Paths in the request are interpreted on the target machine.
- No working directory is inherited across machines; spawning onto another
  machine without one is an error.
- The target machine picks account and model by its own routing rules.
- The new pane joins its spawner's group (D6).

### D10 — Each machine has its own logins and routes on its own

Both machines are logged into the same subscriptions. Usage meters come from
Anthropic, so each machine already sees the combined burn of both. No
coordination between machines is needed for routing.

Setup rules:

- The same subscription gets the same id and label on every machine, so an
  account chip means the same thing on every card.
- The morning poke runs on the laptop only; it is switched off on the desktop
  with the existing setting.

The viewer's usage display shows the viewer's accounts.

### D11 — Versions must match

A remote running a different version is shown read-only: state visible,
actions disabled, mismatch named. The viewer can trigger the remote's update.

### D12 — Between Claudes, spawn and terminate run one way

| Verb | Laptop Claude → desktop | Desktop Claude → laptop |
|---|---|---|
| List, message, report, read transcript | Yes | Yes |
| Spawn, terminate | Yes | No |

### Out of scope

Review tab for remote panes; open-in-editor and reveal-in-file-manager for
remote panes; history search across machines; any authentication scheme.

The desktop as a viewer is out of scope here and must stay possible: nothing
in the link, the ownership rules or the handles may assume a machine is only
ever a viewer or only ever a remote.

## Open questions

**O1 — Resuming a session that ran on the desktop.** History search is per
machine. Recommendation: search stays laptop-only; resuming a desktop session
is done from a desktop pane's card.

## Phases

Each phase ends in something you can use.

| Phase | Delivers | Demo |
|---|---|---|
| **P0** | Periscope runs on the Linux desktop by itself | Forward a port by hand, open the desktop's dashboard in a browser tab |
| **P1** | Link and merged read-only rail | Desktop panes appear in the laptop's rail with live state; pull the network cable and they go grey |
| **P2** | Terminal and pane actions | Type into a desktop pane, read its transcript, rename it, close it |
| **P3** | Create on a remote from the dashboard | Open a repo or new tab on the desktop from ⌘K |
| **P4** | Claude to Claude across machines | A laptop Claude spawns a worker on the desktop, messages it, and receives its report |

The goal is met at P3 from the dashboard and at P4 from a Claude.

## Surfaces worth a line-by-line read

1. **D4's list** of what a remote may do to the viewer. It is the whole trust
   boundary.
2. **D5's ownership table.** Every merge and relay rule follows from it.

## Measured facts

| Fact | Evidence |
|---|---|
| State payload is 70,999 bytes for 13 panes, pushed once a second while watched | `curl /api/state` on the live instance, 2026-09-28; `state_hub._TICK_INTERVAL_S` |
| Roughly half of that payload is the project list, which rarely changes | same measurement: `projects` 34,361 bytes, `windows` 29,341 |
| The server binds loopback only, with no auth, origin check, or token | `server.py:87`; grep of `app.py` and `routes/` |
| The channel socket trusts the pane a caller claims to be; protection is the file mode | `channels.py:1039-1048`, `:1001-1007` |
| Pane ids are 8 random hex characters with no machine component | `pids.py:44-50` |
| Pane actions use three handles: pane id, periscope id, session plus index | `routes/ws.py:56`, `routes/pane.py`, `routes/send.py` |
| The frontend has no base URL; about 55 root-relative paths | `static/src/util.js:139`, `overlays/modalRequest.js`, `store.js:87` |
| HTTP and websocket client libraries are already dependencies | `server.py` PEP-723 header: `httpx`, `websockets` |
| Usage reads its token from the macOS Keychain | `usage.py:161-195` |
| Image paste sends bytes in the request body and writes them on the server | `routes/paste_image.py:49-72` |

## Surface (sketch — settled in structure)

- **Registry:** this machine's name, and a list of remotes (name, label, SSH
  host), in `state.json`.
- **Link supervisor:** owns the `ssh` child per remote; health on
  `/api/healthz` and in the state payload.
- **State merge:** the state hub subscribes to each remote's `/ws/state` while
  it has subscribers of its own; tags and qualifies panes, groups, projects
  and alerts; keeps the last payload per remote for D8.
- **Relay:** one passthrough for HTTP and websocket under a per-remote prefix.
  The remote's API is used as-is, with the remote's own unqualified handles, so
  the three-handle split needs no consolidation.
- **Remote-facing surface:** the D4 list, served separately from the main API.
- **Frontend:** one helper that picks the prefix from a pane, group or project;
  a machine chip on cards and groups; link status in the header; a machine
  picker in the open palette and launcher.
- **Channels:** qualified handles in `list_claudes`, `send_to`, `report`,
  `peek`, `terminate`; a machine argument on `spawn_claude`.
- **Portability (P0):** credential read for usage, a systemd user unit
  alongside the launchd plist, process-table parsing, hiding macOS-only
  actions.

## Worry list (unverified — hand to spec-reviewer)

- **W1** The `ps` invocations parse the same on Linux procps
  (`session_status.py:163,196,309`, `agent_processes.py:70`, `pidfile.py:34`).
  `ps eww` for reading a process's environment is the riskiest.
- **W2** Where Claude Code keeps its OAuth credential on Linux, and whether the
  usage fetch works with it.
- **W3** OpenSSH forwards to owner-only unix sockets in both directions over
  one connection, and a reconnect replaces a stale socket file.
- **W4** Keystroke latency through the relay is acceptable on the home network.
- **W5** Connecting a terminal resizes the real tmux window. A desktop pane
  viewed from the laptop and attached locally on the desktop will contend.
- **W6** The open flow returns a layout blob the client writes into its
  preferences (`docs/unified-open.md`). A remote's blob must never be applied
  to the viewer's layout.
- **W7** Building state has side effects (identity minting, garbage
  collection) and runs only while someone is subscribed. With the laptop
  asleep nobody is. Same as a local instance with no browser open, but a remote
  may sit that way for days.
- **W8** Per-machine values at the top of the state payload (`move_targets`,
  `accounts`, `launch_default`) are read by the frontend for any pane. For a
  remote pane they must come from its machine.
- **W9** Image paste through the relay lands the file on the remote, where the
  remote Claude can read it. Inferred from the code, not run.
- **W10** The desktop's directory layout matches the assumptions in repo
  discovery and worktree placement (`open_ops.py:223`,
  `worktree_spawn.py:36`).
- **W11** The desktop's tmux version supports what the mirror relies on
  (control mode, `capture-pane -N`).
- **W12** Status lines for desktop panes need an API key on the desktop.
- **W13** Pruning of layout and of `%N`-keyed rows at boot and per poll
  (`app.py:65-85`, `pids.py:385-421`) never runs against a partial roster that
  omits an unreachable remote.
- **W14** Repo identity for D6 comes from the origin remote
  (`gitutil.github_slug`, `gitutil.py:75-86`). The function name suggests
  GitHub URL forms only; a repo hosted elsewhere may yield no identity and
  silently stay uncombined.
- **W15** A named group's id is derived from its name with a numeric suffix on
  a local clash (`tracks.create_track`, `tracks.py:98-107`), so the same name
  can carry different ids on two machines. D6 matches on name; layout is keyed
  by id (`ui.track_order`, `ui.tabs_by_track`).
- **W16** The rail groups panes by the group id on each pane
  (`railTree.mergeLiveAndPrefs`). A combined group needs one id at the viewer,
  including when the laptop has no checkout of a repo the desktop has.
- **W17** Group tear-down resolves its targets from the local pane list
  (`routes/tracks.py:84-90`). Across machines it is two calls; a failure
  between them leaves half a group.

## Cross-reference files

`periscope/state_hub.py`, `periscope/routes/state.py`, `periscope/routes/ws.py`,
`periscope/channels.py`, `channel_shim.py`, `periscope/pids.py`,
`periscope/store.py`, `periscope/tracks.py`, `periscope/open_ops.py`,
`periscope/usage.py`, `periscope/session_status.py`, `periscope/poke.py`,
`periscope/config.py`, `server.py`, `bin/periscope`, `static/src/util.js`,
`static/src/poll.js`, `static/src/terminal/terminalCore.js`,
`static/src/split/railTree.js`, `docs/invariants.md`, `docs/channels.md`,
`docs/account-routing.md`, `docs/unified-open.md`.
