# Native Mac notifications 2b, the actions: design (THI-422)

**Builds on:**
- `2026-10-21-native-notifications-design.md`. Its 2a shipped all six banner kinds, the dedupe, the grouping, the Settings toggles, the dock badge and click routing.
- That spec's 2b sections were the starting point. **This spec supersedes them wherever the two disagree.**

**Read before touching the area:**
- `docs/invariants.md`: pane identity and `routes/send.py`;
- `docs/channels.md`: the pane→session mapping;
- `docs/tauri-shell.md`: version skew and the webview recycle.

## Shipping: two PRs

| PR | What it adds | Agent acts? |
|---|---|---|
| **1. Shell + plain buttons** | <ul><li>The Rust category and action plumbing.</li><li>The JS dispatcher.</li><li>Mark seen, Open PR, Clean up worktree, Spawn on {B} and Details (Review diff waits on THI-433).</li></ul> | No |
| **2. Agent-acting buttons** | <ul><li>The `PermissionRequest` hook and `pending_permission`.</li><li>`/api/pane/permission` and `/api/pane/reply`.</li><li>Allow, Deny, Open, Send and Ask agent to fix.</li></ul> | Yes |

- **The shell is generic.** It knows categories and actions only as data the webview sends, so PR 1's single `.app` rebuild covers both PRs.
- **PR 2 is JS and server only.**
- **PR 2's endpoints are THI-426's plumbing as well.** That ticket puts Allow / Deny / Reply on the rail's needs-input card, so the endpoints take nothing banner-specific.

## Facts checked against Claude Code 2.1.280

These come from the installed CLI bundle, because the hooks docs don't publish the input payloads.

- **The `PermissionRequest` input carries:**
  - the common fields: `session_id`, `transcript_path`, `cwd`, `permission_mode`, `agent_id`, `agent_type`, `prompt_id`;
  - `agent_id` is set for a subagent's call, and the dialog still shows in the parent's pane;
  - plus `hook_event_name`, `tool_name`, `tool_input`, `permission_suggestions` and, for MCP tools, `mcp_server`.
- **It has no `tool_use_id`.** PreToolUse, PostToolUse and PermissionDenied do carry one, but running a hook process on every tool call just to pair them isn't worth it.
- **A silent hook doesn't change the dialog.** If the hook prints nothing and exits 0, the dialog shows unchanged.
- **The hook runs before the dialog renders.** So its row exists by the time the pane reads as waiting.
- **The default timeout is 600 s,** so the hook must return at once.
- **The dialog's keys** (`1` = Yes, `Escape` = No and tell Claude what to do differently) aren't documented. PR 2 pins them with a fixture captured from a real dialog.

## PR 1: the shell and the plain buttons

### Rust, `src-tauri/src/notifications.rs`

- **A new event, `periscope:notify-categories`.** It's sent webview → Rust with the full set:

  ```
  [{ id, actions: [{ id, title, auth?, foreground?, destructive?, reply?: { button, placeholder } }] }]
  ```

  - Rust maps it onto `UNNotificationCategory` / `UNNotificationAction` / `UNTextInputNotificationAction`, then calls `setNotificationCategories`.
  - Every field is `#[serde(default)]` and tolerates `null`, as `NotifyRequest` does.
  - A pure `category_specs(&str)` parses and validates the set: an action needs an `id` and a `title`; an action that fails is dropped, not the whole category. It's cargo-tested.
- **When the set is registered.** The webview sends it when the feed starts and again whenever it changes. It's never sent from `send()`, because registration is asynchronous and replaces the whole set, so a banner posted straight after it can arrive without buttons.
- **`NotifyRequest` gains `category`.** No fallback to `kind`: 2b's category ids reuse 2a's kind names (`done`, `usage`, `pr_merged`, …), and the registered set outlives the webview, so a kind-only fallback would let an old webview's plain `kind:"done"` banners match a stale category after a JS rollback and grow buttons whose presses nothing listens for. A banner only gets `categoryIdentifier` when it names `category` explicitly, and only when it also has a `kind` — a plain (kindless) banner never gets one.
- **`did_receive` routes by action identifier:**

  | Action | What it emits |
  |---|---|
  | Default (a click) | `periscope:notification-opened`, as today |
  | Dismiss | nothing |
  | Anything else | `periscope:notification-action` with `{ target, kind, action, text, data }` |

  - `text` is `userText` when the response is a `UNTextInputNotificationResponse`, else `""`.
  - Plain (kindless) banners have no category, so they can't reach the third row.
- **Action options:**

  | Option | Set when the spec has | Effect |
  |---|---|---|
  | `AuthenticationRequired` | `auth` | Touch ID or the password before the action runs from a locked screen |
  | `Foreground` | `foreground` | brings Periscope forward |
  | `Destructive` | `destructive` | macOS draws the button red |

- **Version skew.**

  | Combination | Result |
  |---|---|
  | Old shell, new JS | Nothing listens for the categories event, and `category` is an unknown field, so banners arrive without buttons, as in 2a. |
  | New shell, old JS | Old JS's banners never name a category, so even a set a newer webview left registered shows no buttons. |

  `docs/tauri-shell.md` gains a line for this.
- **Delivery when the webview is down.** An action that arrives while the webview is being rebuilt (a recycle) is lost, as a click is today. Every action is safe to lose: the banner stays in Notification Center, and the pane still shows what's waiting.

### JS

- **`tauri.js`** gains:
  - `setNotifyCategories(set)`, which emits `periscope:notify-categories`;
  - `onNotificationAction(cb)`, which listens on `periscope:notification-action`.
- **`notify/actions.js`, new:**
  - **`categories({ accounts, moveTargets })`.** Pure. It returns the full category set (table below).
  - **`runAction({ target, kind, action, text, data })`.** It dispatches a button. It's exported so a test can drive it with injected openers.
- **`copy.js`'s `payloadFor`** sets `category` on each banner, choosing the variant whose buttons apply:

  | Banner | Category | Buttons |
  |---|---|---|
  | `done` | `done_seen` | Mark seen (Review diff is deferred to THI-433: every pane shares one tmux session, so a session-keyed review row would open the wrong pane's) |
  | `ci_failed`, a URL | `ci_failed_pr` | Open PR (PR 2 adds the `ci_failed` category, with **Ask agent to fix**) |
  | `ci_failed`, no URL | none | the click still opens the pane |
  | `pr_merged`, a `cwd` and a URL | `pr_merged` | **Clean up worktree** · Open PR |
  | `pr_merged`, a `cwd`, no URL | `pr_merged_cleanup` | **Clean up worktree** |
  | `pr_merged`, a URL, no `cwd` | `pr_merged_pr` | Open PR |
  | `pr_merged`, neither | none | the click still opens the pane |
  | `usage`, `moveTargets[A]` is another account B | `usage_to_{B}` | **Spawn on {B label}** · Details |
  | `usage`, no B | `usage` | Details |
  | `needs_input`, `question` | none in PR 1 | the click still opens the pane |

  - **{B}.** B is `move_targets[A]`, the server's `choose_move` pick for escaping A (`docs/account-routing.md`). It is not `launch_default`, which can be A itself while A runs hot.
  - **One category per B.** `categories()` registers a `usage_to_{id}` for every account that appears as a move target. The set changes, and is re-sent, when `accounts` or `moveTargets` change.
- **`feed.js` wiring:**
  - **At start:** it registers `onNotificationAction(runAction)` beside `onNotificationOpened`.
  - **Each pass:** it compares the category set against the last one sent and calls `setNotifyCategories` only on a change. Comparing JSON is enough, because the set is a few hundred bytes.
  - **Inside `runPass`'s try,** so a bad set can't throw into the transport.

### What each PR 1 button does

| action | Foreground | Does |
|---|---|---|
| `review` | yes | Deferred to THI-433: no category offers this button yet, since every pane shares one tmux session (`config.MANAGED_SESSION`) and a session-keyed review row would open the wrong pane's. `selectReview(session)` and `runAction`'s `review` case stay, ready for the follow-up: `selectReview(session)` (the live pane's, else the banner's `data.session`) sets `railSelection` to `review:{session}` and saves it as `lastSelected`, as Rail's `selectKey` does. Detail shows the live LGTM review, or "Start review →" when there's none. |
| `mark_seen` | no | `markReadySeen(w)`: adds the pid to `dismissedReadyPids`, without selecting. Split out of `openReadyPane`, which keeps calling it. Client-side only, like a rail dismissal: after a webview reload or recycle the READY row is back (the done banner itself never repeats — its dedupe key is kept). A server-side ack is a possible follow-up. |
| `open_pr` | no | `openExternal(data.url)`: the browser comes forward on its own. |
| `cleanup` | yes | `openCleanupModal({ paths: [data.cwd || w.cwd] })`: the banner names the worktree whose PR merged, and the pane may have moved since. Never deletes: the modal's own Archive button does, after you look. |
| `spawn_on` | no | `pickSpawnAccount(B)`: the header picker's `pick`, exported. It pins every new spawn to B until set back to auto; the header pin shows it. |
| `details` | yes | `openUsageDetails()` |

- **A missing pane.** A fallback or a failed opener selects the live pane found by `data.pid`, and reveals `target` only when that pane is gone, as a click does. Mark seen does nothing, since a gone pane has no READY row left to dismiss. `open_pr`, `spawn_on` and `details` don't need the pane.
- **`data` gains** `session` (for `review`) and `cwd` (for `cleanup`) on the banners that need them. `data.pid` is still the lookup key. The banner's own data is the fallback, since tmux renumbers windows.

### Server: `?paths=` on `/api/cleanup/candidates`

- **`?paths=a&paths=b`** (a repeated query param) has `compute_candidates` evaluate only the worktrees containing those paths, inside its usual walk of the known repos. A pane's `cwd` can be a subdirectory, so each path is resolved to its worktree root (`gitutil.worktree_root`: `git rev-parse --show-toplevel`, then realpath), and a repo holding none of them is skipped before its default branch is looked up. The modal stays fast this way, rather than taking minutes.
- **A listed path that isn't a candidate** (still busy, or already archived) is simply absent.
- **`CleanupModal`:**
  - `openCleanupModal({ paths })` fetches with `paths` and preselects what comes back;
  - **with nothing back,** it says "Nothing to clean up here. Cleanup only offers a worktree (never a main checkout) whose PR is merged or closed, whose remote branch is gone, or that sits idle.";
  - **without `paths`,** it behaves as today.

## PR 2: the buttons that make an agent act

### The hook, `pane_permission_hook.py`

- **Registered** as a `PermissionRequest` hook (no matcher, so every tool) by `bin/periscope install-hook`, beside the existing entries. `uninstall-hook` removes it.
- **Modelled on `pane_session_hook.py`.** It:
  1. reads stdin and `TMUX_PANE`;
  2. opens its own short-lived connection to the prod `periscope.db`;
  3. writes one row.

  It swallows every failure, **prints nothing and exits 0**. Any output would be read as a permission decision; this hook only observes. A pane without `TMUX_PANE` writes nothing.
- **The table:**

  ```sql
  pane_permissions(pane_id TEXT, session_id TEXT, agent_id TEXT, request_id TEXT PRIMARY KEY,
                   tool TEXT, summary TEXT, created_at REAL)
  ```

  Rows older than a day are pruned on insert.
- **`request_id`** is `sha1(session_id, tool_name, json.dumps(tool_input, sort_keys=True), created_at)`, hex, first 16 characters.
- **`summary`** depends on the tool:

  | Tool | Summary |
  |---|---|
  | Bash | the command's first line |
  | Edit / Write / NotebookEdit | the file path |
  | WebFetch | the URL |
  | anything else | the first string value in `tool_input` |

  It's capped at 80 characters, with whitespace collapsed.

### Publishing, `window_view.py`

`w.pending_permission = { request_id, tool, summary }` when all of these hold:

1. the pane is in `needs-input` with `waitKind(waiting_for) == "permission"`;
2. **exactly one** `pane_permissions` row for the pane's tmux pane id has `created_at >= needs_since - 2`. The 2 s covers clock skew: the hook stamps before the dialog renders, and `needs_since` is when periscope saw it.

Otherwise it's `null`.

- **Two or more rows means we can't tell which request the dialog shows:**
  - parallel tool calls, each asking;
  - back-to-back prompts inside one poll, so `needs_since` never moved.

  Then there's no `pending_permission`, and the banner is the dialog variant with Open only. That's conservative: the cost is a button, never a wrong approval.
- **The row is read on each state build,** with one indexed query per waiting pane (rarely more than a few).

### The banner

- **With a `pending_permission`,** `needs_input` reads:
  - title: `{pane} needs you`;
  - subtitle: `{session} · {branch}`;
  - body: `Allow {tool}: {summary}?`;
  - category: `needs_permission`, with **Allow** (auth) · Deny (destructive) · Open (foreground).
- **Without one,** the body is 2a's ("Waiting for your approval / answer / input.") and the category is `needs_dialog`, with Open (foreground).
- **The dedupe key stays `needs:{pid}@{needs_since}`.** A pane already announced isn't re-announced when this deploys, or when its row appears a poll late. `data.request_id` carries the request.
- **`question`** gets the category `question`, with **Send** (a text-input action: auth, button "Send", placeholder "Reply to {pane}…") · Open.
- **`ci_failed`.** With a live pane (`data.pid`), its category becomes `ci_failed`: **Ask agent to fix** (auth) · Open PR. Without one it stays `ci_failed_pr`.

### The endpoints, `routes/pane_actions.py`

Both take a **JSON body**: a body-less POST with query params is a CORS simple request that any website could fire at `localhost:17374`, whereas a JSON body needs a preflight the server never answers. Both find the pane by `pid`, never by a target that tmux may have renumbered. They use `channels._resolve_window_by_pid`, which moves to `pids.py` as `window_by_pid` so a route doesn't import from the MCP module; `channels.py` keeps calling it.

**`POST /api/pane/permission`** `{ pid, request_id, choice: "allow" | "deny" }`

1. **400** for any other `choice`.
2. **404** for an unknown pid.
3. **409** unless all of these hold:
   - the pane is in `needs-input`, waiting on a permission;
   - its `pending_permission.request_id == request_id`;
   - a fresh `capture-pane` shows a permission dialog **whose text contains the request's summary**. That's checked by a new `panes.permission_dialog(text)`: the `_detect_needs_input` footer plus the dialog's question line, returning the dialog's text or `None`. A long summary is matched on its first 40 characters, after collapsing whitespace on both sides.

   The screen check is what stops a stale row from approving a different dialog that happens to be up.
4. Then `_send_to_target(target, None, ["1"])` for allow, `["Escape"]` for deny.
5. Returns `{ ok: true }`.

- **Deny's `Escape`** is "No, and tell Claude what to do differently", so the pane is then waiting for you.
- **A pinned fixture in `tests/test_panes.py`**, captured from a real dialog during the plan, covers both keys: `permission_dialog` recognises it, and the option the key selects is the one asserted.

**`POST /api/pane/reply`** `{ pid, text }`

1. **400** for empty `text`.
2. **404** for an unknown pid.
3. **409** if any dialog is open, by either signal:
   - the pane is in `needs-input` with a `waiting_for`;
   - a fresh capture shows a dialog footer (`panes._detect_needs_input`, the "Enter to select · Esc to cancel" family, which covers AskUserQuestion and permission dialogs alike).

   Pasting `1 sounds good` + Enter into a numbered dialog would pick an option.
4. Otherwise `_send_to_target(target, text, ["Enter"])`, a bracketed paste then Enter, as the composer does.
5. Returns `{ ok: true }`.

**Neither endpoint** is a general "send keys" route: `/api/send` already is one. These carry the guards a remote button needs.

### What each PR 2 button does

| action | auth | Does |
|---|---|---|
| `allow` / `deny` | Allow only | `POST /api/pane/permission` with `data.pid`, `data.request_id` |
| `send` | yes | `POST /api/pane/reply` with the typed `text`; an empty reply does nothing |
| `fix` | yes | `POST /api/pane/reply` with `CI failed on #{pr}: {failing checks}. Please investigate and fix.`, where the checks are the `✗` names from `data.checks`, which `payloadFor` adds |
| `open` | no (foreground) | reveals the pane |

- **409:** reveal the pane, so you see what changed.
- **Any other failure:** reveal the pane and toast the error (`apiCall` toasts already).
- **Success:** nothing more. The pane's next state shows it working.

## Errors

- **The shell.** A bad categories payload is logged to `shell.log` and dropped. A bad action payload can't happen: Rust builds it.
- **JS.** `runAction` catches everything. A throw logs with `console.error("[notify] action failed", …)` and reveals the pane when there is one.
- **The hook** swallows everything and always exits 0, so a broken hook can never block a prompt.

## Tests

**vitest:**
- `actions.test.js`:
  - `categories()` for one, two and three accounts;
  - each category's buttons and options;
  - `runAction` calls the right opener or endpoint per action;
  - a 409 reveals the pane, and a missing pane falls back to `revealPane`;
  - `send` with empty text does nothing.
- `copy.test.js`:
  - the category per banner and variant;
  - `needs_permission`'s body;
  - `data` carries `request_id` / `session` / `cwd` / `checks`.
- `feed.test.js`: the category set is re-sent only on a change.

**pytest:**
- `tests/test_pane_permission_hook.py`:
  - the summary per tool;
  - the `request_id` shape;
  - the hook prints nothing and exits 0 on garbage input and on an unwritable DB;
  - a row lands with `TMUX_PANE` set.
- `tests/test_window_view.py`: `pending_permission` is published with exactly one row in the episode, and is null with zero rows, with two rows, or outside a permission wait.
- `tests/routes/test_pane_actions.py`:
  - permission: 400 / 404;
  - 409 on a different `request_id`, on a pane that left needs-input, and on a screen without the summary;
  - allow sends `1`, deny sends `Escape`;
  - reply: 409 on `waiting_for`, 409 on a dialog footer on screen; a paste + Enter otherwise.
- `tests/test_panes.py`: the captured dialog fixture for `permission_dialog`.
- `tests/routes/test_cleanup.py`: `?paths=` evaluates only those worktrees.

**cargo:**
- `category_specs`: a full set; a bad action dropped and the rest kept; nulls tolerated.
- `parse_request` with `category`.

**By hand on macOS:**
- **After rebuilding the `.app`:**
  - every button does what its row says;
  - Allow and Send ask for Touch ID on a locked screen.
- **After PR 2:**
  - Allow and Deny on a real Bash prompt;
  - Allow on a banner whose dialog has since changed reveals the pane and sends nothing;
  - Send on a question;
  - Ask agent to fix on a red PR.

## Deploying

- **PR 1:** rebuild/relaunch the shell and deploy the JS (merge + `bin/periscope restart`) in either order — each half without the other just means no buttons yet (old shell: never registers the new categories; old JS: never names one), same as any other version-skew gap (`docs/tauri-shell.md`).
  - Run `cargo tauri build` in `src-tauri/`; the running app is `target/release/bundle/macos/Periscope.app`.
- **PR 2:**
  - Merge, then `bin/periscope install-hook`, which registers `PermissionRequest`, then `bin/periscope restart`.
  - Claude reads hooks at session start, so the hook covers only sessions started after the install. Older panes get the dialog variant (Open only) until they restart.

## Done when

- **Every button does what its row says.**
- **Allow and Deny can only ever answer the request their banner was shown for.** It's checked against the request id and against the screen.
- **No action that makes an agent act works from a locked screen** without authenticating.
- **No reply lands in a dialog.**
- **Clean up never deletes without the modal's confirmation.**
- **Nothing changes in a browser tab, or for an older shell or webview.**
