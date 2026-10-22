# Native Mac notifications — design

**Source:** `docs/specs/tamagotchi-picker-and-notifications.md` Part 2 (the
handout). Lands after the critter picker
(`2026-10-21-tamagotchi-critter-picker-design.md`), as **two PRs**:

- **2a — banners.** All six kinds with their copy, the click opens the right
  place, the Settings toggles, grouping, quiet-when-focused, the pane-counting
  dock badge, and dedupe state that survives a webview recycle. Banners carry
  no buttons yet.
- **2b — actions.** Allow / Deny, reply, Mark seen, Ask agent to fix, Clean up
  worktree, Spawn on {B}, plus the server pieces they need: the permission hook
  and the guarded endpoints.

Out of scope here: the critter image in notifications (handout phase 2; its
`notify.critter` toggle arrives with it) and the menu bar extra (phase 3).

Read before touching the area: `docs/invariants.md` (pane identity,
`routes/send.py`), `docs/channels.md` (pane→session mapping, `need_human`),
`docs/tauri-shell.md` (webview recycling).

## What the code does today, and where the handout's assumptions don't hold

- A `need_human` **alert** is an agent's own `notify(need_human)` MCP call
  (`channels.py`) with free text. It is **not** a permission dialog.
- A **permission dialog** shows up as a pane with `state: "needs-input"` and
  `waiting_for: "permission prompt"` (`session_status.py`, from Claude's
  session file). Nothing records which tool or command is waiting.
- **Soft questions never fire for mapped Claude sessions**: `window_view.py`
  forces `asked_question = False` once a pane maps to a live session.
- `/api/state` carries a CI **glyph** per PR (`w.ci`) but no check names, and
  no PR base branch.
- `/api/cleanup/candidates` is slow (minutes) because it evaluates every
  worktree.
- The webview is **destroyed and rebuilt** by `recycle.rs` once you've been
  idle 300 s with a large renderer. That's exactly when notifications matter,
  and the current first-load sentinel swallows whatever arrives across the
  rebuild.

## Architecture

```
/api/state (windows, alerts, usage, launch_default) ─┐
prefs ui.notify ─────────────────────────────────────┤
                                                     ▼
        notifyFeed.js (effects)  ── nextNotifications(prev, snapshot, prefs, now) ──  notifyRules.js (pure)
           │   ▲   state persisted to localStorage                 └─ copy builders, grouping, badge count
           │   └── onNotificationClick / onNotificationAction ──► notifyActions.js (2b)
           ▼
        tauri.js notify(payload) ──"periscope:notify"──► notifications.rs ──► UNUserNotificationCenter
                                  ◄─"periscope:notification-clicked" / "-action"──┘
```

The rules are pure (in the style of `clawdDuty.js`) so every trigger, dedupe
and throttle unit-tests without signals. Rust only maps payloads onto macOS.
The copy lives in JS alone.

## Notification kinds

Titles stay under ~40 characters (macOS truncates).

| kind | Trigger | Dedupe key | Title / Subtitle / Body | Buttons (2b) | Click |
|---|---|---|---|---|---|
| `needs_input` | a pane is in needs-input. With a `pending_permission`: the permission variant. An AskUserQuestion or other dialog: the dialog variant | 2a: `pid@needs_since`. 2b: the permission's `request_id` when present | `{pane} needs you` / `{session} · {branch}` / `Allow {tool}: {summary}?`; dialog variant: the `waitLabel` text | permission: **Allow** · Deny · Open. Dialog: Open | reveal pane |
| `question` | an unacked, undismissed `need_human` alert | alert id | `{pane} asks` / `{session} · {branch}` / the message | text reply **Send** | reveal pane |
| `done` | a pane enters READY (`state: "done"`, the rail's READY rule) | `pid@completed_at` | `{pane} is done` / `{session} · PR #{n} opened` when a PR is linked, else branch / `w.recap` or `w.last_line`, first sentence | **Review diff** · Mark seen | reveal pane |
| `ci_failed` | a linked open PR's `w.ci` changes to `✗` from anything else | `repo#pr` + the transition (fires again after a re-run fails again) | `CI failed on #{pr}` / `{session} · {pane}` / `✗ a · ✗ b · ✓ c` from `w.ci_checks` | **Ask agent to fix** · Open PR | open PR |
| `pr_merged` | a PR goes from `open` to `merged`, the `nextMergeWatch` rule, keyed per PR, not per pane | `repo#pr` | `PR #{pr} merged` / `{session} · {branch} → {pr_base}` / `The worktree and its session can be cleaned up.` | **Clean up worktree** · Open PR | open PR |
| `usage` | the worst meter's mood (`codingMood`) gets worse | `account/meter/resets_at/mood` | `Account {A} is running hot` / `{Meter} usage {pct}% · →{proj}% at reset` / `{n} sessions are working on {A}.` | **Spawn on {B}** · Details | open the usage pill |

The trigger and copy details:

- **`question` covers agent messages only.** An AskUserQuestion dialog is
  multiple choice, so typing free text into it would be wrong; it's a
  `needs_input` dialog variant with Open only.
- **`usage` fields.** `{n}` = panes in `working` with `w.account == A`. `{B}` =
  `launch_default.account` when it differs from A; otherwise there's no Spawn
  button (and there's never one on a single-account setup). It fires at most
  once per meter per reset window per mood step (calm → grumpy, grumpy →
  furious); a meter flapping back to calm doesn't re-arm it within the window.
  The body says "working on" where the handout says "spawning on": what's
  known is which panes run on A, not what's being spawned.
- **One banner per pane.** A pane that has both a permission dialog and an
  unanswered `need_human` message gets only the `needs_input` banner, like
  `dutyItems` collapsing rows to panes.
- **`done` noise is an open problem.** `completed_at` is stamped on every
  working→idle change (`panes.py`), i.e. every turn, including 5-second replies.
  2a ships the handout's rule. The follow-up is a minimum working duration,
  which needs a "working since" stamp the server doesn't publish yet. Decide
  after living with 2a.
- **`waiting_for` is normalised before matching.** The raw values vary by
  Claude version (`util.js` `waitLabel`), so a small `waitKind(raw)` →
  `"permission" | "question" | "dialog"` map is shared with `waitLabel` and
  tested.

### Grouping

`thread` = `kind` (macOS stacks by it). For the **needs-you kinds**
(`needs_input`, `question`): the first two in a burst go out immediately, and
the third and later ones within 3 s are folded into a single summary sent at
the end of the window:

- title `{n} sessions need you`;
- body: one `● {pane} · permission|question` line each.

Leading edge, so a lone banner never waits 3 s. The other kinds rarely burst,
and macOS stacks them by thread. Behind `notify.group`.

### Dock badge

The badge counts **panes** waiting on you, not alert rows. The pane-collapsing
loop in `dutyItems` (needs-input rows + unacked `need_human` events, deduped per
pane, selected pane excluded) moves into an `attention.js` helper,
`waitingPanes(...)`, used by both Clawd's bell and the badge. With
`notify.badge` off, the badge is cleared.

## Dedupe that survives reloads and recycles

`nextNotifications` takes the previous state `{ seen, at, prs, meters }` and
returns `{ state, events }`. `notifyFeed.js` saves that state to
`localStorage` (wrapped in try/catch) after every pass. On boot:

- saved state **younger than 15 minutes** → resume from it. Events that arrived
  while the webview was gone (a recycle, a ⌘R) are reported once;
- older or missing → seed from the first snapshot and report nothing. That's
  today's sentinel, so a reload after a long absence never replays history.

This replaces `maybeNativeNotify` in `alertFeed.js`, which has the same
recycle gap today.

## Rust — `src-tauri/src/notifications.rs`

**Payload** (serde, every new field `#[serde(default)]`, so the 2a payload and
the old `{title, body, target}` both parse):

```
{ kind, title, subtitle, body, target, thread, reply, actions: [{ id, title, primary?, auth?, foreground? }],
  data: { … }, quiet_when_focused }
```

`data` is opaque to Rust. It carries everything an action needs (pid, PR URL,
request id, account, worktree path) and goes into the notification's
`userInfo`, so a click on a banner posted by a webview that has since been
recycled still has its context.

**`send()`** maps the payload: title, subtitle, body, `categoryIdentifier =
kind`, `threadIdentifier = thread`, `userInfo = { target, kind, data,
quiet_when_focused }`. The identifier stays `ID_PREFIX + seq + "|" + target`.

**Categories (2b).** JS sends a separate `periscope:notify-categories` event
with the full set — one category per kind with its actions, and a
`UNTextInputNotificationAction` (button "Send") for `question`:

- when the feed starts;
- whenever the action set changes (e.g. the Spawn-on account).

Rust calls `setNotificationCategories` there and never from `send()`.
Registration is asynchronous and replaces the whole set, so registering just
before posting can produce a banner with no buttons.

Action options:

- **`AuthenticationRequired`** on **Allow**, **Send** and **Ask agent to fix**:
  each one makes an agent act, so none of them may work from a locked screen.
- **`Foreground`** on the Open / Review diff / Details / Open PR / Clean up
  buttons.

**`did_receive`:**

- `UNNotificationDefaultActionIdentifier` → emit
  `periscope:notification-clicked` with the target, as today;
- `UNNotificationDismissActionIdentifier` → ignore;
- anything else → emit `periscope:notification-action` with `{ target, kind,
  action, text, data }`, where `text` is `userText` from a
  `UNTextInputNotificationResponse`.

**`will_present`:** no presentation options when `quiet_when_focused` is set in
the notification's `userInfo` **and** the main webview window is focused at
that moment (Rust checks `is_focused()` itself, which is more accurate than a
flag captured when the banner was sent). Otherwise Banner + Sound. A quieted
notification still lands in Notification Center.

Keep the logic small: `parse_request(&str)` and
`category_specs(&CategoriesRequest)` are pure and unit-tested.

## JS

- **`tauri.js`:** `notify(payload)` passes the whole payload through;
  `setNotifyCategories(set)` (2b); `onNotificationAction(cb)`, alongside
  `onNotificationClick`.
- **`notifyRules.js` (pure):** `nextNotifications`, one copy builder per kind,
  `groupBurst`, `waitKind`.
- **`notifyFeed.js`:** started from `Split.jsx` next to `startAlertFeed`. A
  single `effect` over `windows`, `alerts`, `usage`, `launchDefault` and the
  `ui.notify` prefs runs the rules, applies the toggles, runs the 3 s grouping
  timer, calls `notify`, sets the badge and saves state. Nothing fires outside
  Tauri (`inTauri()`), so a browser tab is unaffected. `alertFeed.js` keeps the
  reveal helpers and gives up `maybeNativeNotify` and the badge.
- **`notifyActions.js` (2b):** dispatch on `action`:

| action | Does |
|---|---|
| `allow` / `deny` | `POST /api/pane/permission` (below). On 409, reveal the pane |
| `send` | `POST /api/pane/reply` with the typed text. On 409, reveal the pane |
| `mark_seen` | `markReadySeen(w)`, split out of `openReadyPane` (dismiss without selecting) |
| `fix` | `POST /api/pane/reply` with `CI failed on #{pr}: {failing checks}. Please investigate and fix.` |
| `cleanup` | `openCleanupModal({ paths: [worktree] })`. Never deletes without the modal's confirmation |
| `spawn_on` | the account picker's `pick(id)`, exported from `SpawnAccountPicker.jsx` |
| `open_pr` / `review` | `openExternal(prUrl)`; Review diff opens the pane's Review tab |
| `details` | `openUsagePopover()`, a module-signal opener like `openUpdatePopover` |
| `open` | reveal the pane |

## Server

### 2a

- **`w.pr_base`, `w.ci_checks`.** Add `baseRefName` to the `gh pr view` /
  `gh pr list` `--json` fields in `git_pr.py`, and keep the per-check names and
  states that `_ci_glyph` already reads: `[{ name, state }]`, failing first, at
  most 6. Same cached call, no new `gh` traffic.
- **`?paths=` on `/api/cleanup/candidates`.** It evaluates only the listed
  worktrees, so the scoped modal opens fast. `CleanupModal` gains an exported
  `openCleanupModal({ paths })`; with `paths` set it fetches the filtered list
  and preselects it.
- **`ui.notify` prefs.** `NotifyPrefs(BaseModel)`, all `bool | None`, with
  `notify: NotifyPrefs | None` on `UIPatch`. `update_ui` merges only top-level
  keys, so the client always sends the whole `notify` object (merged over the
  defaults).

### 2b — the permission hook

A Claude **`PermissionRequest`** hook, `pane_permission_hook.py`, installed by
`bin/periscope install-hook` beside the existing `SessionStart` /
`UserPromptSubmit` entries. It follows `pane_session_hook.py`'s pattern: read
the payload and `TMUX_PANE`, write one row to a `pane_permissions` table in
`periscope.db` (`pane_id, session_id, request_id, tool_name, summary,
created_at`), swallow every failure, **print nothing and exit 0**. Output
would be read as a permission decision; this hook only observes.

- `request_id` is the payload's `tool_use_id` if it carries one; otherwise
  `sha1(session_id, tool_name, canonical tool_input, created_at)`. Check the
  payload shape against the current Claude Code docs before building on it.
- `summary`: the command's first line for Bash, the file path for Edit and
  Write, the URL for WebFetch, otherwise the first string input; capped at 80
  characters.
- `window_view.py` publishes `w.pending_permission = { request_id, tool,
  summary }` only while `waitKind(waiting_for) == "permission"` and the row is
  newer than the pane's `needs_since`. The row is dropped when the episode
  ends.
- **Why a hook and not the transcript.** "The last `tool_use` without a result"
  in the session JSONL picks the wrong tool in three cases:
  - a parallel, auto-approved tool still running;
  - a subagent's prompt, whose transcript is separate (the main transcript
    shows the subagent's Task call);
  - back-to-back prompts inside one poll.

  The transcript remains a fallback only when the main transcript has exactly
  one pending `tool_use`, the pane has no running subagent, and no hook row
  exists. Otherwise the banner is the dialog variant (Open only).
- The hook only writes to the **prod** `periscope.db`; a dev server sees no
  rows unless pointed at one.

### 2b — guarded endpoints

Both take a **JSON body**. A body-less POST with query parameters is a CORS
"simple request" that any website can fire at `localhost:17374` without a
preflight, and `app.py` has no Origin check.

- **`POST /api/pane/permission`** `{ pid, request_id, choice: "allow" | "deny" }`:
  - **400** for an invalid `choice`;
  - **409** unless the pane is still in needs-input with
    `pending_permission.request_id == request_id`;
  - otherwise it sends the dialog's key through `_send_to_target`: **`1`**
    (Yes) for allow, **`Escape`** for deny. Escape means "No, and tell Claude
    what to do differently", so the pane is then waiting for you. Pin both keys
    with a `tests/test_panes.py` fixture of the current dialog.

  Keying on the request, not on `needs_since`, is what stops a banner for
  command A from approving command B.
- **`POST /api/pane/reply`** `{ pid, text }`:
  - **409** while the pane has any dialog open (`needs-input` with
    `waiting_for` set, or the dialog footer detected). Pasting `1 sounds good`
    + Enter into a numbered dialog selects an option;
  - otherwise paste + Enter via `_send_to_target`.

  Used by Send and Ask agent to fix.

## Settings — `SettingsModal.jsx`

A **Notifications** fieldset of checkboxes, each saving on change (like the
critter picker) through `setNotifyPref(key, on)` →
`patchUI({ notify: { ...getNotifyPrefs(), [key]: on } })`. Outside the Tauri app
the fieldset shows "Notifications appear in the Periscope macOS app only."

| Setting | key | default |
|---|---|---|
| A session needs input (with actions) | `needs_input` | on |
| A session finishes | `done` | on |
| CI fails on a linked PR | `ci_failed` | on |
| A linked PR merges | `pr_merged` | on |
| Usage projected past a limit | `usage` | on |
| Stay quiet while the dashboard is focused | `quiet_when_focused` | on |
| Group when more than 2 arrive at once | `group` | on |
| Dock badge counts sessions waiting on you | `badge` | on |

`question` follows `needs_input`. Changes apply immediately: the feed reads the
prefs signal. The feed honours a toggle at **send** time, so turning a kind
back on doesn't replay events it skipped.

## Errors

- A failed `notify` or category registration: `console.warn`, as today. The
  feed never throws out of its effect.
- An action endpoint returning 409: reveal the pane. Any other failure: reveal
  the pane and toast the error (`apiCall` already toasts).
- A bad payload in Rust: `eprintln!` and drop, as today.

## Tests

vitest:

- `notifyRules.test.js` — each kind fires exactly once per key; respects its
  toggle; a resume from saved state reports gap events once; a stale or absent
  state seeds without replay; one banner per pane; the third needs-you event in
  3 s is grouped and the first two aren't; usage throttles per window and mood
  step and doesn't re-arm on a flap; the badge counts panes.
- `notifyActions.test.js` (2b) — each action hits the right endpoint or
  opener, and 409 reveals the pane.
- `waitKind` — the known `waiting_for` values.

pytest:

- `w.pr_base` / `w.ci_checks` mapping from a canned `gh` payload;
- `?paths=` filtering;
- `ui.notify` accepted and rejected shapes;
- 2b: hook row parsing and summaries per tool;
- 2b: `pending_permission` published only during its episode;
- 2b: the permission endpoint — 409 on a different `request_id`, on a pane
  that left needs-input, and 400 on a bad choice;
- 2b: the reply endpoint — 409 with a dialog open;
- 2b: the dialog keys against the panes fixture.

cargo: `parse_request` (old and new payloads), `category_specs`.

Manual, on macOS, with notifications allowed for the dev build:

- each kind arrives with its copy;
- buttons and the reply work, and Allow asks for authentication when the screen
  is locked;
- grouping;
- quiet-when-focused;
- **View → Recycle Webview** with a pane waiting → the banner still arrives
  once, and a reload doesn't replay it.

## Done when

- 2a: all six kinds arrive with the copy above, and clicks open the right
  place. Each kind can be turned off in Settings without a restart. Nothing
  fires in a browser tab, nothing replays on reload, and nothing is lost to a
  recycle. The badge counts panes.
- 2b: every button does what its row says. Allow and Deny can only ever answer
  the request they were shown for. No action that makes an agent act works from a locked screen. No
  reply lands in a dialog.
