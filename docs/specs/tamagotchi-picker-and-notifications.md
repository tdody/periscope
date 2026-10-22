# Handout: tamagotchi critter picker + native notifications

**For:** Claude Code, working in this repo.
**Design source:** the *Periscope identity* canvas (Thibault's claude.ai design artifact). Boards: *Tamagotchi cast*, *Mac notifications*. The critter art is copied here as SVG under `docs/specs/assets/critters/` so you don't need the canvas.

Two independent pieces of work. Ship them as two PRs, picker first.

---

## Part 1 — Critter picker in Settings

### Goal

A **Tamagotchi** setting that chooses which creature lives in the header corner. Options:

| id | Name | Look | Asset |
| --- | --- | --- | --- |
| `clawd` | Clawd | today's mascot, **default**, unchanged | (existing sprite in `tamagotchi.js`) |
| `scope` | Scope | sky-blue submarine with a periscope and glowing lens | `critters/scope.svg` |
| `jelly` | Jelly | purple jellyfish, three swaying tentacles | `critters/jelly.svg` |
| `nox` | Nox | sitting black cat, lime eyes, curled tail | `critters/nox.svg` |
| `ember` | Ember | red horned imp with a spade tail | `critters/ember.svg` |
| `volt` | Volt | yellow block with a lightning antenna | `critters/volt.svg` |
| `moss` | Moss | green one-eyed creature with mossy tufts | `critters/moss.svg` |

`critters/preview.png` shows all six at calm.

Keep `clawd` as the default so nothing changes for anyone who doesn't open Settings.

### The assets

Each SVG is a 20×20 pixel sprite (`viewBox="0 0 20 20"`, `shape-rendering="crispEdges"`, rects only). Moods are layers:

- `.mood-calm`, `.mood-grumpy`, `.mood-furious` — show the one matching the current mood, hide the others.
- Layers without a mood class are always drawn.
- The outer `<animateTransform>` is the idle bob; `data-bob` gives the period per mood (calm 1.2s, grumpy 0.6s, furious 0.2s).

The SVGs use SMIL (`<animate>`, `<animateTransform>`) for blink, bob, tentacle sway, etc. **Periscope's rule is that all tamagotchi motion is CSS and switches off under `prefers-reduced-motion`** (see the header of `Tamagotchi.jsx` and `.tama` in `styles.css`). When porting, convert each SMIL animation to a class + keyframes in the `.tama` block, mirroring existing ones (`tama-blink`, `tama-bob`, `tama-shake`). Discrete steps (`calcMode="discrete"`) map to `steps()`.

### Where it goes

- **Sprite data:** add the six critters next to Clawd's sprite in `static/src/chrome/tamagotchi.js` (or a new `critters.js` beside it), as JSX components or rect lists — whatever keeps `tamagotchi.js` testable without a DOM, as it is today.
- **Rendering:** `static/src/chrome/Tamagotchi.jsx`. Clawd is drawn by `Cells` + `Eyes` at `x0` from `POSES` / `STANDING`, inside a 34×24 scene. Draw the chosen critter in the same spot instead of Clawd: scale the 20×20 sprite to Clawd's height (body 4 rows × 2 units + legs ≈ 10 units), bottom-aligned to Clawd's feet line, and keep every scene prop (desk, armchair, seasons, occasions, duty bubble, screens) exactly as is. Sitting poses (`code`, `nap`, `read`) currently hide Clawd's legs; for critters, just bottom-align the whole sprite.
- **Mood:** reuse `codingMood()` — the critter shows the same calm / grumpy / furious Clawd does. Sleep (`nap`/`sleep`) should close the critter's eyes the way `Eyes closed` does for Clawd: hide the eye rects and draw a short line, or show the blink frame held.
- **Hover/labels:** wherever copy says "Clawd" (e.g. `activityLabel`, hover lines, `Tamagotchi.jsx` titles), use the chosen critter's name.

### Settings UI

`static/src/overlays/SettingsModal.jsx` — add a **Tamagotchi** fieldset:

- Seven choices as a row of radio buttons, each showing a 40 px preview of the critter (calm) above its name. Real `<input type="radio">` + `<label>`, keyboard reachable.
- Saves on change (no need to wait for the form's Save button), like a toggle.

### Persistence

- Store as `ui.tama_critter` via `prefs.patchUI({ tama_critter })` (`static/src/prefs.js`), with a getter `getTamaCritter()` that returns `"clawd"` when unset or unknown.
- **Server:** add `tama_critter: str | None = None` to `UIPatch` in `periscope/routes/prefs.py`, and validate it against the seven ids in `patch_prefs_ui` (400 otherwise), like `view` is. Without the field declaration Pydantic silently drops it and the client's optimistic update reverts on the echo.

### Tests

- vitest: getter default + fallback for an unknown id; the critter component renders each mood layer exclusively; `Tamagotchi` renders the chosen critter in each activity.
- pytest: `PATCH /api/prefs/ui` accepts each id and rejects junk.

### Done when

- Picking a critter swaps it in the header immediately and survives reload.
- All seven show calm / grumpy / furious correctly and stop moving under reduced motion.
- Default install still shows Clawd.

---

## Part 2 — Native Mac notifications

### What exists

- `static/src/tauri.js` → `notify({ title, body, target })` emits `periscope:notify`; `setBadgeCount(n)`; `onNotificationClick(cb)`.
- `src-tauri/src/notifications.rs` owns `UNUserNotificationCenter`: `send()` sets title + body; the identifier is `ID_PREFIX + seq + "|" + target`; `did_receive` routes a click back as `periscope:notification-clicked`; `will_present` always shows Banner + Sound.
- `static/src/split/alertFeed.js` → `maybeNativeNotify()` notifies only `need_human` alerts (`⚠ session · name`), deduped by alert id with a first-load sentinel; the dock badge is the `need_human` count.

Notifications only fire inside the Tauri shell; the browser path stays a no-op.

### Extend the bridge

1. **Payload.** Grow the event payload to `{ kind, title, subtitle, body, target, actions, thread, reply }`. `kind` is one of the ids below; `actions` is a list of `{ id, title, primary? }`; `reply` asks for a text-input action.
2. **Rust.** In `notifications.rs`:
   - Register one `UNNotificationCategory` per `kind` at `init()` with its `UNNotificationAction`s (and a `UNTextInputNotificationAction` for `question`). Set `content.categoryIdentifier = kind`, `content.subtitle`, and `content.threadIdentifier = thread` (drives macOS grouping).
   - In `did_receive`, read `actionIdentifier` (and `userText` for text input) and emit `periscope:notification-action` with `{ target, kind, action, text }`. The default click keeps emitting `periscope:notification-clicked` as now.
   - In `will_present`, return no presentation options when the dashboard window is focused and "Stay quiet while the dashboard is focused" is on (the JS side can send that flag with each request).
3. **JS.** `tauri.js` gains `onNotificationAction(cb)`. A new `static/src/notifyFeed.js` (or grow `alertFeed.js`) owns *all* kinds: watches the signals below, dedupes, checks the settings, calls `notify`, and handles actions.

### The notifications

Copy is from the design; `{…}` are fields. Titles stay short; macOS truncates around 40 characters.

| kind | Trigger (source) | Title | Subtitle | Body | Actions | Click |
| --- | --- | --- | --- | --- | --- | --- |
| `needs_input` | new `need_human` alert that is a permission dialog (`alertFeed.js`, `attention.js`) | `{pane} needs you` | `{session} · {branch}` | `Allow {tool}: {command}?` | **Allow** · Deny · Open | reveal pane |
| `question` | new `need_human` alert that is a soft question (`isSoftQuestion`) | `{pane} asks` | `{session} · {branch}` | the question text | text reply **Send** | reveal pane |
| `done` | a pane enters READY (unacked done; same signal as the rail's READY section) | `{pane} is done` | `{session} · PR #{n} opened` when a PR is linked, else branch | last assistant line, one sentence | **Review diff** · Mark seen | reveal pane |
| `ci_failed` | linked open PR whose `w.ci` turns `✗` (see `clawdDuty.js` ~L97) | `CI failed on #{pr}` | `{session} · {pane}` | `✗ check · ✗ check · ✓ check` | **Ask agent to fix** · Open PR | open PR |
| `pr_merged` | `pr_state` open → merged (`nextMergeWatch` / `clawdWatch.js` `mergeParties`) | `PR #{pr} merged` | `{session} · {branch} → {base}` | `The worktree and its session can be cleaned up.` | **Clean up worktree** · Open PR | open PR |
| `usage` | worst meter turns grumpy or furious (`codingMood`, `projectsPastLimit`, `m.hot`) | `Account {A} is running hot` | `{Meter} usage {pct}% · →{proj}% at reset` | `{n} sessions are spawning on {A}.` | **Spawn on {B}** (multi-account only) · Details | open usage pill |

Action behaviour:

- **Allow / Deny** — send the keystroke the pending dialog expects to that pane, through the same path the dashboard uses for sending keys; then clear the alert. If the dialog has already changed, do nothing and open the pane.
- **Send** (question) — send the typed text + Enter to the pane.
- **Mark seen** — the same dismissal as clicking a READY row (`openReadyPane` without selecting).
- **Ask agent to fix** — send a short prompt to the pane: `CI failed on #{pr}: {failing checks}. Please investigate and fix.`
- **Clean up worktree** — open the Cleanup modal preselected on that worktree; never delete without the modal's confirmation.
- **Spawn on {B}** — set the spawn account pin to B (same as clicking it in the header).
- **Open PR / Review diff / Details / Open** — foreground the app and navigate there.

Dedupe and throttling:

- One notification per event: alert id, pane+READY episode, PR+state transition, meter+mood transition. Keep the first-load sentinel so a reload never replays old events.
- `usage`: at most once per meter per reset window per mood step (calm → grumpy, grumpy → furious).
- **Grouping:** `thread` = `kind`. When more than 2 notifications would fire within ~3 s, send one summary instead: title `{n} sessions need you`, body one line per pane (`● {pane} · permission`), and let macOS stack the rest (`+{k} more from Periscope`).

### Critter in notifications (optional, phase 2)

The design shows the chosen critter (40 px) on `done`, `pr_merged` and `usage`. macOS needs a file: render the critter's current mood to a PNG in the app's cache dir and attach it with `UNNotificationAttachment`. Skip if it complicates the first PR; gate it behind the setting below.

### Dock badge

Keep the existing badge but count **panes** waiting on you (needs input), deduped per pane, so it matches the rail and the Clawd bubble (`dutyItems` already counts panes, not rows).

### Menu bar extra (phase 3, separate PR)

A tray icon (Tauri `tray-icon`) with the F1 mark and the waiting count, and a menu listing NEEDS YOU / WORKING / DONE panes (click reveals the pane), the usage line, **Open dashboard ⇧⌘P** and **Pause notifications for 1 hour**. Only after Parts 1–2 land.

### Settings UI

In `SettingsModal.jsx`, a **Notifications** fieldset of checkboxes, saved under `ui.notify` (declare the fields in `UIPatch` the same way as `tama_critter`):

| Setting | key | default |
| --- | --- | --- |
| A session needs input (with actions) | `notify.needs_input` | on |
| A session finishes | `notify.done` | on |
| CI fails on a linked PR | `notify.ci_failed` | on |
| A linked PR merges | `notify.pr_merged` | on |
| Usage projected past a limit | `notify.usage` | on |
| Stay quiet while the dashboard is focused | `notify.quiet_when_focused` | on |
| Group when more than 2 arrive at once | `notify.group` | on |
| Show the critter in notifications | `notify.critter` | on |
| Dock badge counts sessions waiting on you | `notify.badge` | on |

`question` follows the `needs_input` toggle.

### Tests

- vitest for the feed: each trigger fires exactly once, respects its toggle, survives a reload without replaying, groups at >2, and usage throttles per window and mood step. Pure functions in the style of `clawdDuty.js` make this easy.
- Rust: keep `send()` free of logic beyond mapping the payload; unit-test the payload parsing.
- Manual on macOS: allow notifications for the dev build; trigger each kind; check action buttons, reply, grouping and the focused-quiet rule.

### Done when

- All six kinds arrive with the copy and actions above, and each action does what it says.
- Each kind can be turned off in Settings; changes apply without restart.
- Nothing fires in a plain browser tab; nothing replays on reload.

---

## Out of scope

- New critters beyond the six listed (the canvas has alternates: Cinder, Brick, Puff, Glim, Bao, Sunny, Sprig, Goo, Spike, Loaf, Peek, Bell). Leave a clean way to add one: a sprite plus an entry in one list.
- Changing the F1 app icon (`build_icons.py`) — separate task.
- Any change to Clawd's art or schedule.
