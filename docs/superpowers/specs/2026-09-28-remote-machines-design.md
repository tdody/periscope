# Remote machines: panes on another host as full citizens

**Status:** decisions settled with Tom (2026-09-28): D1–D12, no open
questions. Reviewed once by spec-reviewer; its findings are folded in. Next:
structure proposal. Tier: **Full** (spans sessions).

**Depends on:** `2026-09-28-periscope-on-linux-design.md`. Nothing here can be
demonstrated until periscope runs on the desktop.

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

### D3 — One SSH connection per remote, owned and dialled by the viewer

The viewer starts it, watches it, and restarts it. The remote never dials the
viewer: what a remote sends travels back over a connection the viewer opened.
Nothing listens on the network on either machine.

Why the remote never dials: there is then one place on the viewer where
remote traffic arrives, and D4's list is enforced there.

### D4 — What each side may do to the other

Periscope has no authentication. Today "can reach it" means "is you, on this
machine." The link extends reach across machines, so the rule is explicit.

| Direction | May do |
|---|---|
| viewer → remote | Everything the remote's own dashboard can do |
| remote → viewer | A fixed list only: list the viewer's Claudes, deliver a message to one, read one's transcript |

A remote cannot type into the viewer's terminals, spawn or terminate there,
read its files, or change its settings.

On the remote, only a Claude's own channel tools can send to the viewer. No
web request to the remote's periscope is ever forwarded to the viewer.

**Trust position:** the desktop is trusted exactly as much as the laptop. The
list is the smallest surface that meets the goal. It is not a wall against a
hostile desktop: a message delivered to a Claude is text that Claude acts on,
and spawned Claudes act without asking, so a worker's report is itself a way
to steer the laptop. Removing that path would remove reports.

Every cross-machine message is marked with the machine it came from.

Accepted: whoever controls either machine's account controls both
periscopes.

### D5 — Pane facts live with the pane's machine; layout lives with the viewer

| Thing | Owner |
|---|---|
| Name, state, transcript, linked PR and ticket, alerts, notes, tags, open file tabs, account, who spawned it | The pane's machine |
| Which group a pane belongs to | The pane's machine |
| Which groups from different machines show as one | The viewer |
| Order of groups and tabs, collapsed groups, pins, current selection | The viewer |

Why: pane facts are written by the Claude in the pane, on its machine, and
must be the same for anyone looking. Layout is a preference of whoever is
looking.

**Rule:** the viewer never writes a remote pane's facts into its own stores.

### D6 — Rail groups combine across machines; each pane carries a machine chip

One piece of work is one group, wherever its panes run.

| Group kind | Shown as one group when |
|---|---|
| Repo group | Both checkouts have the same origin remote (host, owner and name, compared without regard to case) |
| Named group | Both machines hold the same group. A group created or extended across machines keeps one identity on all of them |
| Ungrouped | Always |

Rules that follow:

- A repo with no origin remote is never combined; it shows per machine.
- A fork and its upstream have different origins and are different groups.
- Inside a combined group, panes on the same branch name sit together even
  though they are two checkouts, possibly at different commits. The chip and
  each pane's own git state tell them apart.
- A new tab in a combined group asks which machine, defaulting to the machine
  last used in that group.
- Moving a pane into a named group creates that group on the pane's machine
  when it is missing there, with the same identity.
- Group names are unique per machine among live named groups.
- If a named group is renamed on one machine while the other is away, it stays
  one group; the viewer shows its own machine's name.
- Rename, dissolve and tear-down of a named group apply on every machine
  holding part of it, and are refused while any such machine is unreachable.
  They run on the remote first, then locally, report what each machine did,
  and are safe to run again after a partial failure.
- Repo groups and the ungrouped bucket have no such actions.

### D7 — In anything the viewer shows or stores, a remote pane's handle names its machine

Local handles keep their current form.

**Guarantees:**

- A handle stored in layout or given to a Claude identifies exactly one pane
  across all linked machines.
- A request for a remote pane that skips the relay fails. It never lands on a
  local pane that happens to share a number.

### D8 — A dropped link loses nothing and hides nothing

- Remote panes stay in the rail at their last known state, marked unreachable
  with how long ago, actions disabled. This holds across a viewer restart.
- Layout belonging to a machine is never pruned unless that machine is
  connected and its full list of panes has arrived.
- A message to an unreachable machine fails at once, with the reason.
- A worker's report to a spawner it cannot reach becomes an alert on the
  worker's own card, and shows up when the link returns.

### D9 — Spawning onto a remote: the caller names the machine, the machine decides the rest

- Paths in the request are interpreted on the target machine.
- No working directory is inherited across machines; spawning onto another
  machine without one is an error.
- The target machine picks account and model by its own routing rules.
- Group of the new pane:

  | Spawner is in | Worker lands in |
  |---|---|
  | A named group | The same named group, created on the target machine if missing |
  | A repo group | The repo group of the worker's own working directory. That is the spawner's group when both are the same repo, and a different group otherwise |

- A group the target machine cannot resolve is an error, never a silent
  fallback.

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

### D11 — A version mismatch warns; it does not lock

Version means the commit each machine is running. A mismatch shows a chip
naming both versions, with a one-click "update desktop". Everything stays
usable.

Accepted: after a change to the API, an action on a desktop pane can fail
until the desktop is updated. The failure names the mismatch.

Rejected: making a mismatched desktop view-only. The laptop commits to main
many times a day, so the desktop would be view-only most of the time.

The desktop can only update to commits that have been pushed.

### D12 — Between Claudes, spawn and terminate run one way

| Verb | Laptop Claude → desktop | Desktop Claude → laptop |
|---|---|---|
| List, message, report, read transcript | Yes | Yes |
| Spawn, terminate | Yes | No |

### Out of scope

| Item | Where it goes |
|---|---|
| Running periscope on Linux | Its own spec, `2026-09-28-periscope-on-linux-design.md`; a prerequisite |
| Previewed HTML files run scripts with control of the dashboard | A separate change covering local and remote previews together. True of local files today; the link extends it to desktop files |
| History search across machines | Not planned. Search covers the laptop; a desktop session is resumed from a desktop pane's card |
| Review tab, open-in-editor and reveal-in-file-manager for remote panes | Not planned |
| Any authentication scheme | Not planned |

The desktop as a viewer is out of scope here and must stay possible: nothing
in the link, the ownership rules or the handles may assume a machine is only
ever a viewer or only ever a remote.

## Open questions

None.

## Phases

Each phase ends in something you can use.

| Phase | Delivers | Demo |
|---|---|---|
| **P1** | Link and merged read-only rail | Desktop panes appear in the laptop's rail with live state; pull the network cable and they go grey |
| **P2** | Terminal and pane actions | Type into a desktop pane, read its transcript, rename it, close it |
| **P3** | Create on a remote from the dashboard | Open a repo or new tab on the desktop from ⌘K |
| **P4** | Claude to Claude across machines | A laptop Claude spawns a worker on the desktop, messages it, and receives its report |

The goal is met at P3 from the dashboard and at P4 from a Claude.

## Surfaces worth a line-by-line read

1. **D4.** The list and the trust position are the whole trust boundary.
2. **D5's ownership table.** Every merge and relay rule follows from it.

## Mechanics

Rules below implement the decisions. They are for the plan and its reviewer.

### Handles in merged state

| Field on a remote pane | In merged state | Used for |
|---|---|---|
| `pid` | Qualified with the machine | Rail identity, selection, layout values |
| `target`, `pane_id`, `session`, `index` | Qualified with the machine | Calls to that machine only |
| `track_id` | The layout key (below) | Rail grouping |
| `track_kind` | Carried explicitly | Telling repo, named and ungrouped apart; never inferred from the id |
| `spawned_by` | Qualified when it names a pane on another machine | Provenance, `report` routing |
| `machine` | Added | Chip, relay prefix |
| Alert `target`, `pane_id` | Qualified, plus `machine` | Reveal-pane from the alert feed |

One helper builds every relayed call: it takes a pane, group or project,
strips the qualifier, and adds the relay prefix. It throws when given a remote
handle and no prefix. The channel tools accept qualified handles only for
other machines; a bare `%N` is always local.

### Layout keys for combined groups

| Group | Layout key at the viewer |
|---|---|
| Repo group the viewer has a checkout of | The viewer's own group id (its repo path), unchanged from today |
| Repo group only a remote has | The remote's group id, qualified with the machine |
| Named group | Its identity, the same on every machine |
| Ungrouped | Today's key |

When the viewer gains a checkout of a repo it knew only through a remote, the
merge re-keys that group's layout entries to the viewer's own id in the same
step. Existing layout needs no migration.

### Where the merge happens

- In the function that builds state, so the push path and the REST fallback
  both serve merged state (`routes/state.py:196`, `poll.js:97`).
- The last payload per remote is written to disk with a timestamp and loaded
  at boot.
- The remote's project list is not merged. The open palette fetches a remote's
  catalog on demand.
- Per-machine values (`accounts`, `move_targets`, `launch_default`,
  `spawn_account`, `spawn_model`, `poke`, `update`) are kept per machine in
  the payload; a remote pane reads its machine's.

### Layout sync in the browser

The rail's periodic sync and its drag seed (`Rail.jsx:97-157`,
`railTree.js:102,117`) keep every layout entry whose machine is not connected
with its full pane list loaded.

### Relayed responses

- A layout blob in a remote's response is never applied to the viewer's
  preferences (`OpenOmnibox.jsx:139`). A pane created on a remote is placed by
  the normal live merge.
- Notes, tags and pinned files of a remote pane are read from and written to
  the remote through the relay (`prefs.js:34-44,133-140`).

### The link

- One `ssh` child per remote with a single forward, viewer to remote.
- `ExitOnForwardFailure=yes` and keep-alives, so a dead link is seen as dead.
- The local end is a socket in a directory only the user can enter.
- The viewer holds one long-lived connection to the remote over that forward;
  remote-to-viewer requests (D4's list) arrive on it.
- Every relayed request has a timeout.

### Testing

- A second instance on one host needs its own home directory, config
  directory, tmux socket and channel socket. The channel socket path is fixed
  in the server today (`config.py:19`) and becomes configurable.
- The link, merge and relay are tested against a second real process, not
  in-process.
- A dev instance binds no channel socket, so P4 is tested between two
  prod-mode instances in isolated homes.

## Measured facts

| Fact | Evidence |
|---|---|
| State payload is 70,999 bytes for 13 panes, pushed once a second while watched | `curl /api/state` on the live instance, 2026-09-28; `state_hub._TICK_INTERVAL_S` |
| Roughly half of that payload is the project list | same measurement: `projects` 34,361 bytes, `windows` 29,341 |
| The server binds loopback only, with no auth, origin check, or token | `server.py:84-87` |
| The channel socket trusts the pane a caller claims to be; protection is the file mode | `channels.py:1001-1048` |
| Pane ids are 8 random hex characters with no machine component | `pids.py:44-50` |
| Pane actions use three handles: pane id, periscope id, session plus index | `routes/ws.py:55-65`, `routes/pane.py`, `routes/send.py` |
| The frontend has no base URL; 55 root-relative paths across 17 files | grep of `static/src` |
| HTTP and websocket client libraries are already dependencies | `server.py` PEP-723 header |
| Usage reads its token from the macOS Keychain | `usage.py:161-195` |
| Image paste writes the file on the machine that serves the request | `routes/paste_image.py:49-72` |
| The browser's layout sync drops entries for panes absent from live state | `Rail.jsx:97-126`, `railTree.js:102,117` |
| The HTML preview frame runs scripts on the dashboard's origin | `PreviewTabInner.jsx:584-587`, `routes/fs.py:140-164` |
| Repo identity is derived for `github.com` URLs only, case-sensitively | `gitutil.py:75-89` |
| A named group's id gets a numeric suffix on a clash; names are not checked for uniqueness | `tracks.py:98-114` |
| Server-side prunes touch only the instance's own stores | `app.py:68-85`, `pids.py:385-421,482-490`, `routes/state.py:115-117` |
| The activity worker runs whether or not anyone is watching | `activity.py:978-1020` |

## Worry list (unverified)

- **W1** Whether macOS honours the file mode on a unix socket. The socket sits
  in a user-only directory so the answer does not matter.
- **W2** Keystroke latency through the relay on the home network.
- **W3** Connecting a terminal resizes the real tmux window and never restores
  it (`ws.py:73-87`). Two viewers of one pane contend, locally today and
  across machines here.
- **W4** Repo identity (D6) needs a matcher that handles hosts other than
  GitHub and SSH host aliases such as `git@github-work:owner/name`. An alias
  hides the real host, so two machines with different aliases for one repo
  need a rule.
- **W5** Moving a pane into a repo group whose repo is not checked out on that
  pane's machine has no defined result.

## Cross-reference files

`periscope/state_hub.py`, `periscope/routes/state.py`, `periscope/routes/ws.py`,
`periscope/routes/fs.py`, `periscope/routes/tracks.py`,
`periscope/channels.py`, `channel_shim.py`, `periscope/pids.py`,
`periscope/store.py`, `periscope/tracks.py`, `periscope/gitutil.py`,
`periscope/open_ops.py`, `periscope/usage.py`, `periscope/session_status.py`,
`periscope/agent_processes.py`, `periscope/poke.py`, `periscope/config.py`,
`server.py`, `bin/periscope`, `static/src/util.js`, `static/src/poll.js`,
`static/src/prefs.js`, `static/src/split/Rail.jsx`,
`static/src/split/railTree.js`, `static/src/split/alertFeed.js`,
`static/src/overlays/OpenOmnibox.jsx`,
`static/src/preview/PreviewTabInner.jsx`,
`static/src/terminal/terminalCore.js`, `docs/invariants.md`,
`docs/channels.md`, `docs/account-routing.md`, `docs/unified-open.md`,
`docs/wrapper-profiles.md`, `docs/tmux-persistence.md`.
