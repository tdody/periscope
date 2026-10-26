# Native Notifications 2b, PR 1: Shell and Plain Buttons (THI-422) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Native banners gain buttons that don't make an agent act:
- Review diff · Mark seen on `done`;
- Open PR on `ci_failed`;
- Clean up worktree · Open PR on `pr_merged`;
- Spawn on {B} · Details on `usage`.

It also lays down the generic shell plumbing that PR 2 (Allow / Deny / reply) will reuse without another `.app` rebuild.

**Architecture:**
- **The Rust shell is generic.** It registers whatever category set the webview sends on `periscope:notify-categories`, and reports a button press on `periscope:notification-action` as `{ target, kind, action, text, data }`.
- **Each banner names its category.** `copy.js` gives every banner the category whose buttons all apply.
- **`notify/actions.js` defines the set and dispatches presses** to existing openers.
- **`feed.js`'s pure `runPass`** returns the set when it changes, as it already does for the dock badge.
- **The cleanup modal can be scoped** to one worktree via a new `?paths=` on `/api/cleanup/candidates`.

**Tech Stack:**
- Rust: Tauri 2, objc2 0.6, objc2-user-notifications 0.3;
- JS: Preact + `@preact/signals`, vitest;
- Python: FastAPI, pytest.

**Spec:** `docs/superpowers/specs/2026-10-26-native-notifications-2b-design.md` (PR 1 sections).

---

## Conventions

- **Worktree.** Use `.claude/worktrees/notify-actions` on branch `feature/notify-actions`, and run every command from there.
- **Commits.** One per task: a single-line message, a blank line, then `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`. Never commit `package-lock.json`.
- **Gate:**
  - `bin/check` must end with `all checks passed`. **Never run `bin/check --fix`.**
  - `npm test`, `uv run pytest -q`.
  - For Rust: `cd src-tauri && cargo test --lib notifications && cargo fmt --check`. CI doesn't run cargo, so this is the only check.
- **Imports.** Use Biome's organizeImports order (case-insensitive). Check with `npx biome check --formatter-enabled=false <files>`.
- **Comments.** Explain *why*, tersely, as the surrounding code does.
- **Before editing:**
  - `docs/tauri-shell.md`, "Notifications across version skew";
  - `docs/testing.md`, the no-leaked-thread rule. These tests don't touch the activity DB.

---

### Task 0: Worktree

- [ ] **Step 1:** Create it and install.

```bash
cd ~/github/tomplex/periscope
git worktree add .claude/worktrees/notify-actions -b feature/notify-actions main
cd .claude/worktrees/notify-actions && npm install --silent && uv sync -q && git checkout -- package-lock.json
npx vitest run static/src/notify && (cd src-tauri && cargo test --lib notifications 2>&1 | tail -3)
```

Expected: the vitest notify suites pass, and cargo reports `test result: ok`. The first cargo build in a fresh worktree takes several minutes.

---

### Task 1: Rust: categories in, button presses out

**Files:**
- Modify: `src-tauri/src/notifications.rs`

- [ ] **Step 1: Write the failing tests.** Append these inside `mod tests` at the bottom of `notifications.rs`:

```rust
    #[test]
    fn category_specs_keeps_every_usable_action() {
        let specs = category_specs(
            r#"[
            {"id":"done","actions":[{"id":"review","title":"Review diff","foreground":true},
                                    {"id":"mark_seen","title":"Mark seen"}]},
            {"id":"question","actions":[{"id":"send","title":"Reply","auth":true,
                                         "reply":{"button":"Send","placeholder":"Reply…"}}]}
        ]"#,
        )
        .unwrap();
        assert_eq!(specs.len(), 2);
        assert_eq!(specs[0].id, "done");
        let ids: Vec<&str> = specs[0].actions.iter().map(|a| a.id.as_str()).collect();
        assert_eq!(ids, ["review", "mark_seen"]);
        assert_eq!(
            specs[0].actions[0].options().0,
            UNNotificationActionOptions::Foreground.0
        );
        assert_eq!(specs[0].actions[1].options().0, 0);
        assert_eq!(
            specs[1].actions[0].options().0,
            UNNotificationActionOptions::AuthenticationRequired.0
        );
        assert_eq!(
            specs[1].actions[0].reply,
            Some(ReplySpec {
                button: "Send".into(),
                placeholder: "Reply…".into()
            })
        );
    }

    #[test]
    fn category_specs_drops_a_bad_action_not_its_category() {
        // The shell outlives the JS that sends this: an action it can't read
        // costs that one button, never the category's other buttons.
        let specs = category_specs(
            r#"[{"id":"done","actions":[{"id":"","title":"x"},{"title":"no id"},
                                        {"id":"ok","title":"OK"},{"id":"bad","title":5}]},
                {"actions":[]},
                {"id":"empty"}]"#,
        )
        .unwrap();
        assert_eq!(specs.len(), 2);
        assert_eq!(specs[0].actions.len(), 1);
        assert_eq!(specs[0].actions[0].id, "ok");
        assert_eq!(specs[1].id, "empty");
        assert!(specs[1].actions.is_empty());
    }

    #[test]
    fn category_specs_tolerates_nulls() {
        let specs = category_specs(
            r#"[{"id":"d","actions":[{"id":"a","title":"A","auth":null,"foreground":null,
                                      "destructive":null,"reply":null}]}]"#,
        )
        .unwrap();
        assert_eq!(specs[0].actions[0].options().0, 0);
        assert!(specs[0].actions[0].reply.is_none());
    }

    #[test]
    fn category_specs_rejects_a_payload_that_is_not_a_list() {
        assert!(category_specs(r#"{"id":"done"}"#).is_err());
    }

    #[test]
    fn action_options_combine() {
        let specs = category_specs(
            r#"[{"id":"d","actions":[{"id":"a","title":"A","auth":true,"destructive":true}]}]"#,
        )
        .unwrap();
        assert_eq!(
            specs[0].actions[0].options().0,
            UNNotificationActionOptions::AuthenticationRequired.0
                | UNNotificationActionOptions::Destructive.0
        );
    }

    #[test]
    fn a_banner_gets_buttons_only_when_it_names_a_category() {
        // FULL carries a kind but no category — no fallback, so no buttons.
        assert_eq!(category_of(&parse_request(FULL).unwrap()), None);
        let named = parse_request(r#"{"title":"t","body":"b","kind":"done","category":"done_seen"}"#)
            .unwrap();
        assert_eq!(category_of(&named), Some("done_seen"));
        // An explicit null category is still no category — no fallback to kind.
        let null = parse_request(r#"{"title":"t","body":"b","kind":"done","category":null}"#).unwrap();
        assert_eq!(category_of(&null), None);
        // A plain banner (an older webview's) carries no kind, so no buttons
        // even if a category somehow rode along.
        let plain =
            parse_request(r#"{"title":"t","body":"b","target":"s:1","category":"done"}"#).unwrap();
        assert_eq!(category_of(&plain), None);
    }

    #[test]
    fn a_button_press_carries_the_banner_context_and_the_typed_text() {
        let info = Info {
            target: "s:1".into(),
            kind: "question".into(),
            data: serde_json::json!({"pid": "p1"}),
            quiet_when_focused: false,
        };
        assert_eq!(
            action_payload(&info, "send", "yes please"),
            serde_json::json!({"target": "s:1", "kind": "question", "action": "send",
                               "text": "yes please", "data": {"pid": "p1"}})
        );
    }
```

- [ ] **Step 2: Run them and confirm they fail.**

Run: `cd src-tauri && cargo test --lib notifications 2>&1 | tail -20`

Expected: a compile failure: `cannot find function category_specs` / `category_of` / `action_payload`, and `ReplySpec` not found.

- [ ] **Step 3: Implement.** Make these edits in `notifications.rs`.

**(a)** Extend the header comment's last paragraph, after `…which an older webview never listens to.`:

```rust
//
// Buttons (2b): the webview registers the whole category set on
// "periscope:notify-categories" (when the feed starts and whenever the set
// changes, never per banner: registration is asynchronous and replaces the
// set, so a banner posted right behind one can show no buttons). A banner
// only gets buttons when it names a `category` explicitly — never falling
// back to its `kind`, because 2b's category ids reuse 2a's kind names (done,
// usage, pr_merged, …) and the registered set outlives the webview: after a
// JS rollback, an old webview's kind:"done" banners would otherwise match a
// stale category and grow buttons whose presses nothing listens for (a typed
// reply silently lost). A press goes out on "periscope:notification-action"
// as { target, kind, action, text, data }. This shell knows no kinds or
// buttons: they're data, so a new button needs new JS, not a new .app. An
// older shell drops the categories event and its banners carry no buttons;
// an older webview registers none.
```

**(b)** Change the imports to:

```rust
use objc2::rc::{autoreleasepool, Retained};
use objc2::runtime::{AnyObject, Bool, ProtocolObject};
use objc2::{define_class, msg_send, AnyThread, DefinedClass};
use objc2_foundation::{NSArray, NSDictionary, NSError, NSObject, NSObjectProtocol, NSSet, NSString};
use objc2_user_notifications::{
    UNAuthorizationOptions, UNMutableNotificationContent, UNNotification, UNNotificationAction,
    UNNotificationActionOptions, UNNotificationCategory, UNNotificationCategoryOptions,
    UNNotificationContent, UNNotificationDefaultActionIdentifier,
    UNNotificationDismissActionIdentifier, UNNotificationPresentationOptions,
    UNNotificationRequest, UNNotificationResponse, UNTextInputNotificationAction,
    UNTextInputNotificationResponse, UNUserNotificationCenter, UNUserNotificationCenterDelegate,
};
```

**(c)** Below `const OPENED_EVENT …`, add:

```rust
/// Webview → Rust: the whole category set (each kind's buttons), replacing the last.
const CATEGORIES_EVENT: &str = "periscope:notify-categories";
/// Rust → webview: a button on a kinded banner: { target, kind, action, text, data }.
const ACTION_EVENT: &str = "periscope:notification-action";
```

**(d)** Add `category` to `NotifyRequest`, after `thread`:

```rust
    #[serde(default, deserialize_with = "null_to_default")]
    category: String,
```

**(e)** After `fn user_info_json…`, add the pure helpers:

```rust
/// The category a banner's buttons come from: its own, explicitly named.
/// Never falls back to `kind` — 2b's category ids reuse 2a's kind names
/// (done, usage, pr_merged, …), and the registered set outlives the webview,
/// so a kind-only fallback would let an old webview's plain-kind banner
/// (after a JS rollback) match a stale category and grow buttons whose
/// presses nothing listens for.
fn category_of(req: &NotifyRequest) -> Option<&str> {
    (!req.kind.is_empty() && !req.category.is_empty()).then_some(req.category.as_str())
}

/// A text-input button's labels (UNTextInputNotificationAction).
#[derive(serde::Deserialize, Debug, PartialEq)]
struct ReplySpec {
    #[serde(default, deserialize_with = "null_to_default")]
    button: String,
    #[serde(default, deserialize_with = "null_to_default")]
    placeholder: String,
}

/// One button, as the webview describes it. The flags are `Option` so a null
/// from a newer or older webview reads as unset rather than failing the button.
#[derive(serde::Deserialize, Debug, PartialEq)]
struct ActionSpec {
    #[serde(default, deserialize_with = "null_to_default")]
    id: String,
    #[serde(default, deserialize_with = "null_to_default")]
    title: String,
    #[serde(default)]
    auth: Option<bool>,
    #[serde(default)]
    foreground: Option<bool>,
    #[serde(default)]
    destructive: Option<bool>,
    #[serde(default)]
    reply: Option<ReplySpec>,
}

impl ActionSpec {
    /// `auth`: Touch ID / password before it runs from a locked screen.
    /// `foreground`: bring Periscope forward. `destructive`: drawn red.
    fn options(&self) -> UNNotificationActionOptions {
        let mut bits = 0;
        if self.auth == Some(true) {
            bits |= UNNotificationActionOptions::AuthenticationRequired.0;
        }
        if self.foreground == Some(true) {
            bits |= UNNotificationActionOptions::Foreground.0;
        }
        if self.destructive == Some(true) {
            bits |= UNNotificationActionOptions::Destructive.0;
        }
        UNNotificationActionOptions(bits)
    }
}

#[derive(Debug, PartialEq)]
struct CategorySpec {
    id: String,
    actions: Vec<ActionSpec>,
}

/// The categories the webview asked for, keeping what's usable: a category
/// needs an id, a button an id and a title. A bad button is dropped, not its
/// category, so a field this shell can't read costs as little as possible.
/// `Err` only when the payload isn't a JSON list at all.
fn category_specs(payload: &str) -> Result<Vec<CategorySpec>, serde_json::Error> {
    let raw: Vec<serde_json::Value> = serde_json::from_str(payload)?;
    Ok(raw
        .into_iter()
        .filter_map(|c| {
            let id = c.get("id")?.as_str()?.to_string();
            if id.is_empty() {
                return None;
            }
            let actions = c
                .get("actions")
                .and_then(|a| a.as_array())
                .map(|list| {
                    list.iter()
                        .filter_map(|v| serde_json::from_value::<ActionSpec>(v.clone()).ok())
                        .filter(|a| !a.id.is_empty() && !a.title.is_empty())
                        .collect()
                })
                .unwrap_or_default();
            Some(CategorySpec { id, actions })
        })
        .collect())
}

/// What a button press tells the webview: the banner's context plus which
/// button, and the text typed into a reply button ("" for any other).
fn action_payload(info: &Info, action: &str, text: &str) -> serde_json::Value {
    serde_json::json!({
        "target": info.target, "kind": info.kind, "action": action, "text": text, "data": info.data
    })
}
```

**(f)** In `did_receive`, replace the `if let Some(info) = info_of(&request.content()) { … }` block's body with:

```rust
            if let Some(info) = info_of(&request.content()) {
                let action = response.actionIdentifier();
                let default = unsafe { UNNotificationDefaultActionIdentifier };
                let dismiss = unsafe { UNNotificationDismissActionIdentifier };
                if action.isEqualToString(default) {
                    let _ = self.ivars().app.emit(
                        OPENED_EVENT,
                        serde_json::json!({
                            "target": info.target, "kind": info.kind, "data": info.data
                        }),
                    );
                } else if !action.isEqualToString(dismiss) {
                    // A reply button's response is the text-input subclass.
                    let text = response
                        .downcast_ref::<UNTextInputNotificationResponse>()
                        .map(|r| r.userText().to_string())
                        .unwrap_or_default();
                    let _ = self.ivars().app.emit(
                        ACTION_EVENT,
                        action_payload(&info, &action.to_string(), &text),
                    );
                }
            }
```

`downcast_ref` comes from `AnyObject`, reached by auto-deref. If it doesn't resolve, use `let any: &AnyObject = response.as_ref(); any.downcast_ref::<UNTextInputNotificationResponse>()`.

**(g)** In `init`, after the `app.listen(NOTIFY_EVENT, …)` call, add:

```rust
    app.listen(CATEGORIES_EVENT, |event| match category_specs(event.payload()) {
        Ok(specs) => register_categories(&specs),
        Err(e) => crate::recycle::shell_log(&format!("periscope: bad categories payload: {e}")),
    });
```

**(h)** Add `register_categories` after `init`:

```rust
/// Replace the whole category set. macOS keeps only the last set, and a
/// banner naming a category that isn't in it shows no buttons.
fn register_categories(specs: &[CategorySpec]) {
    autoreleasepool(|_| {
        let categories: Vec<Retained<UNNotificationCategory>> = specs
            .iter()
            .map(|c| {
                let actions: Vec<Retained<UNNotificationAction>> = c
                    .actions
                    .iter()
                    .map(|a| {
                        let id = NSString::from_str(&a.id);
                        let title = NSString::from_str(&a.title);
                        match &a.reply {
                            Some(r) => {
                                let button = if r.button.is_empty() { "Send" } else { &r.button };
                                Retained::into_super(UNTextInputNotificationAction::actionWithIdentifier_title_options_textInputButtonTitle_textInputPlaceholder(
                                    &id,
                                    &title,
                                    a.options(),
                                    &NSString::from_str(button),
                                    &NSString::from_str(&r.placeholder),
                                ))
                            }
                            None => UNNotificationAction::actionWithIdentifier_title_options(
                                &id,
                                &title,
                                a.options(),
                            ),
                        }
                    })
                    .collect();
                UNNotificationCategory::categoryWithIdentifier_actions_intentIdentifiers_options(
                    &NSString::from_str(&c.id),
                    &NSArray::from_retained_slice(&actions),
                    &NSArray::new(),
                    UNNotificationCategoryOptions(0),
                )
            })
            .collect();
        UNUserNotificationCenter::currentNotificationCenter()
            .setNotificationCategories(&NSSet::from_retained_slice(&categories));
    });
}
```

**(i)** In `send()`, after the `setThreadIdentifier` block, add:

```rust
        // The category's buttons (registered separately, see register_categories).
        if let Some(category) = category_of(req) {
            content.setCategoryIdentifier(&NSString::from_str(category));
        }
```

- [ ] **Step 4: Run the tests and confirm they pass.**

Run: `cd src-tauri && cargo test --lib notifications 2>&1 | tail -5 && cargo fmt && cargo fmt --check && cargo build 2>&1 | tail -2`

Expected: `test result: ok`, with every earlier notifications test still passing; `fmt --check` is silent and the build finishes.
- If `NSArray::new()` doesn't infer, write `NSArray::<NSString>::new()`.
- If `Retained::into_super` is ambiguous, bind the text action to a variable first.

- [ ] **Step 5: Commit.**

```bash
git add src-tauri/src/notifications.rs
git commit -m "shell: banners carry buttons — the webview registers categories, a press goes out on notification-action with any typed reply (THI-422)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Server: `?paths=` scopes cleanup candidates to a worktree

**Files:**
- Modify: `periscope/gitutil.py`
- Modify: `periscope/cleanup.py` (`compute_candidates`, around lines 276–330)
- Modify: `periscope/routes/cleanup.py:22-30`
- Test: `tests/test_cleanup.py`, `tests/routes/test_cleanup.py`

- [ ] **Step 1: Write the failing tests.**

Append to `tests/test_cleanup.py`:

```python
def test_compute_candidates_paths_evaluates_only_those_worktrees(mocker):
    # A notification's "Clean up worktree" asks about one worktree; walking
    # every worktree (gh + git per worktree) is what makes the full list slow.
    mocker.patch.object(
        cleanup, "all_projects", return_value={"/r/a": _project("a", "s", "/r"), "/q/b": _project("b", "s", "/q")}
    )
    mocker.patch.object(
        cleanup.worktrees,
        "_cached_worktrees",
        side_effect=lambda repo: {"/r": [("/r", "main"), ("/r/a", "fa"), ("/r/c", "fc")], "/q": [("/q/b", "fb")]}[repo],
    )
    default = mocker.patch.object(cleanup, "_detect_default_branch", return_value="main")
    seen = []
    mocker.patch.object(cleanup, "_evaluate_worktree", side_effect=lambda wt, *a, **k: seen.append(wt))
    mocker.patch("periscope.panes.list_windows", return_value=[])
    mocker.patch("periscope.store.all_windows", return_value={})
    mocker.patch.object(cleanup, "get_settings", return_value={})
    # A pane's cwd can be a subdirectory: it resolves to its worktree root.
    mocker.patch.object(cleanup, "worktree_root", side_effect=lambda p: "/r/a" if p.startswith("/r/a") else p)

    cleanup.compute_candidates(paths=["/r/a/src"])

    assert seen == ["/r/a"]
    # A repo holding none of the paths is skipped before its default branch is looked up.
    default.assert_called_once_with("/r")


def test_compute_candidates_without_paths_walks_every_worktree(mocker):
    mocker.patch.object(cleanup, "all_projects", return_value={"/r/a": _project("a", "s", "/r")})
    mocker.patch.object(cleanup.worktrees, "_cached_worktrees", return_value=[("/r/a", "fa"), ("/r/c", "fc")])
    mocker.patch.object(cleanup, "_detect_default_branch", return_value="main")
    seen = []
    mocker.patch.object(cleanup, "_evaluate_worktree", side_effect=lambda wt, *a, **k: seen.append(wt))
    mocker.patch("periscope.panes.list_windows", return_value=[])
    mocker.patch("periscope.store.all_windows", return_value={})
    mocker.patch.object(cleanup, "get_settings", return_value={})

    cleanup.compute_candidates()

    assert seen == ["/r/a", "/r/c"]
```

Append to `tests/routes/test_cleanup.py`:

```python
def test_candidates_paths_filter(client, mocker):
    spy = mocker.patch("periscope.routes.cleanup.compute_candidates", return_value=[])
    r = client.get("/api/cleanup/candidates?paths=/wt/a&paths=/wt/b")
    assert r.status_code == 200
    assert spy.call_args.kwargs["paths"] == ["/wt/a", "/wt/b"]


def test_candidates_without_paths_passes_none(client, mocker):
    spy = mocker.patch("periscope.routes.cleanup.compute_candidates", return_value=[])
    client.get("/api/cleanup/candidates")
    assert spy.call_args.kwargs["paths"] is None
```

- [ ] **Step 2: Run them and confirm they fail.**

Run: `uv run pytest tests/test_cleanup.py tests/routes/test_cleanup.py -q`

Expected: FAIL, because `compute_candidates()` gets an unexpected keyword `paths`, `worktree_root` doesn't exist, and `call_args.kwargs` has no `paths`.

- [ ] **Step 3: Implement.**

In `periscope/gitutil.py`, after `resolve_repo_and_branch`:

```python
def worktree_root(path: str) -> str:
    """The checkout or worktree root containing `path`, realpath'd — a pane's
    cwd can sit in a subdirectory. Falls back to `path` itself (realpath'd)
    when git can't answer."""
    code, top = _run(["git", "-C", path, "rev-parse", "--show-toplevel"])
    return os.path.realpath(top if code == 0 and top else path)
```

In `periscope/cleanup.py`:
- change the import to `from periscope.gitutil import detect_default_branch, worktree_root`;
- change the signature to `def compute_candidates(repo_filter: str | None = None, paths: list[str] | None = None) -> list[Candidate]:`;
- add to its docstring: ``"`paths` (optional): only the worktrees containing these directories — a notification's "Clean up worktree" asks about one, and evaluating every worktree takes minutes."``;
- replace the final loop with:

```python
    wanted = {worktree_root(p) for p in paths} if paths else None
    candidates: list[Candidate] = []
    for repo in sorted(repos):
        # `_cached_worktrees` returns [(realpath, branch_or_none), ...]
        wts = [(p, b) for p, b in worktrees._cached_worktrees(repo) if wanted is None or p in wanted]
        if not wts:
            continue
        default = _detect_default_branch(repo)
        for wt_path, branch in wts:
            cand = _evaluate_worktree(
                wt_path,
                branch,
                repo,
                default,
                project_by_pinned,
                windows_snapshot,
                alive_worktree_cwds,
                idle_threshold,
            )
            if cand is not None:
                candidates.append(cand)

    return candidates
```

In `periscope/routes/cleanup.py`:
- add `from typing import Annotated`;
- change `from fastapi import APIRouter` to `from fastapi import APIRouter, Query`;
- replace the route with:

```python
@router.get("/api/cleanup/candidates")
def cleanup_candidates(repo: str | None = None, paths: Annotated[list[str] | None, Query()] = None):
    """List cleanup candidates. Optional `repo` query param scopes to one
    repo's worktrees (for a future per-project view; phase 6 ships the
    global view as the primary UI). Repeated `paths` scope to the worktrees
    containing those directories: a notification's "Clean up worktree"
    asks about one, and walking every worktree takes minutes."""
    repo_filter = os.path.realpath(repo) if repo else None
    cands = compute_candidates(repo_filter, paths=paths or None)
    return {"candidates": cands}
```

The existing `test_candidates_repo_filter` reads `spy.call_args.args[0]`, and the repo stays positional, so it keeps passing.

- [ ] **Step 4: Run the tests and confirm they pass.**

Run: `uv run pytest tests/test_cleanup.py tests/routes/test_cleanup.py -q`

Expected: all pass.

- [ ] **Step 5: Commit.**

```bash
git add periscope/gitutil.py periscope/cleanup.py periscope/routes/cleanup.py tests/test_cleanup.py tests/routes/test_cleanup.py
git commit -m "cleanup: ?paths= evaluates only the worktrees holding those dirs, so a scoped modal opens in seconds (THI-422)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: The openers the buttons call

**Files:**
- Modify: `static/src/split/alertFeed.js` (add `markReadySeen` and `selectReview`; `openReadyPane` uses `markReadySeen`)
- Modify: `static/src/chrome/SpawnAccountPicker.jsx` (export `pick` as `pickSpawnAccount`)
- Modify: `static/src/overlays/CleanupModal.jsx` (export `openCleanupModal({ paths })` and `candidatesUrl`)
- Test: `static/src/split/__tests__/alertFeed.test.js`
- Create: `static/src/overlays/__tests__/cleanupModal.test.js`

- [ ] **Step 1: Write the failing tests.**

In `static/src/split/__tests__/alertFeed.test.js`:
- change the import line to `const { markReadySeen, openNeedsPane, openReadyPane, selectReview } = await import("../alertFeed.js");`;
- add `const prefs = await import("../../prefs.js");` below it;
- append:

```js
describe("what a done banner's buttons do", () => {
  it("Mark seen dismisses the READY row without opening the pane", () => {
    markReadySeen({ pid: "c" });
    expect([...dismissedReadyPids.value]).toEqual(["c"]);
    expect(railSelection.value).toBe(null);
    markReadySeen(null);
    expect(dismissedReadyPids.value.size).toBe(1);
  });

  it("Review diff selects the session's review row and remembers it", () => {
    selectReview("periscope");
    expect(railSelection.value).toBe("review:periscope");
    expect(prefs.setLastSelected).toHaveBeenCalledWith({ kind: "review", worktree: "periscope" });
    railSelection.value = null;
    selectReview("");
    expect(railSelection.value).toBe(null);
  });
});
```

Create `static/src/overlays/__tests__/cleanupModal.test.js`:

```js
// The cleanup modal's scoped load: a notification's "Clean up worktree" asks
// /api/cleanup/candidates about its worktree only (?paths=), so the modal
// opens in seconds instead of walking every worktree.
import { describe, expect, it } from "vitest";
import { candidatesUrl } from "../CleanupModal.jsx";

describe("candidatesUrl", () => {
  it("asks for every candidate without a scope", () => {
    expect(candidatesUrl(null)).toBe("/api/cleanup/candidates");
    expect(candidatesUrl([])).toBe("/api/cleanup/candidates");
  });

  it("repeats paths=, encoded, for a scope", () => {
    expect(candidatesUrl(["/wt/a b", "/wt/c"])).toBe("/api/cleanup/candidates?paths=%2Fwt%2Fa%20b&paths=%2Fwt%2Fc");
  });
});
```

- [ ] **Step 2: Run them and confirm they fail.**

Run: `npx vitest run static/src/split/__tests__/alertFeed.test.js static/src/overlays/__tests__/cleanupModal.test.js`

Expected: FAIL, because `markReadySeen` / `selectReview` / `candidatesUrl` aren't exported.

- [ ] **Step 3: Implement.**

In `static/src/split/alertFeed.js`, replace `openReadyPane` with the following, and add `selectReview` after `selectPane`:

```js
// Dismiss a READY row without opening its pane: a done banner's Mark seen.
export function markReadySeen(w) {
  if (w?.pid) dismissedReadyPids.value = new Set([...dismissedReadyPids.value, w.pid]);
}

export function openReadyPane(w) {
  markReadySeen(w);
  selectPane(w);
}
```

```js
// Select a session's Review row (the live LGTM review, or its "Start
// review →"), as clicking it in the rail does: rows are keyed by session.
export function selectReview(session) {
  if (!session) return;
  railSelection.value = `review:${session}`;
  prefs.setLastSelected({ kind: "review", worktree: session });
}
```

In `static/src/chrome/SpawnAccountPicker.jsx`, rename `async function pick(id)` to:

```js
// Exported for a usage banner's "Spawn on {B}" (notify/actions.js), which pins
// every new spawn to B exactly as clicking B here does.
export async function pickSpawnAccount(id) {
```

and change `onClick={() => pick(c.id)}` to `onClick={() => pickSpawnAccount(c.id)}`.

In `static/src/overlays/CleanupModal.jsx`:

1. Replace `const open = signal(false);` and `function openCleanupModal() {…}` with:

```js
const open = signal(false);
// The worktree dirs a notification's "Clean up worktree" scoped this opening
// to, or null for the full list.
const scope = signal(null);

// `paths` scopes the list (and its preselection) to those worktrees.
export function openCleanupModal({ paths } = {}) {
  scope.value = paths?.length ? paths : null;
  open.value = true;
  track("overlay.open", { which: "cleanup" });
}

export function candidatesUrl(paths) {
  if (!paths?.length) return "/api/cleanup/candidates";
  return `/api/cleanup/candidates?${paths.map((p) => `paths=${encodeURIComponent(p)}`).join("&")}`;
}
```

2. In `close()`, add `scope.value = null;` after `open.value = false;`.
3. In the header-button effect, the click handler must not pass the event as `{ paths }`:

```js
  useEffect(() => {
    const btn = document.getElementById("cleanup-btn");
    const onClick = () => openCleanupModal();
    if (btn) btn.addEventListener("click", onClick);
    return () => { if (btn) btn.removeEventListener("click", onClick); };
  }, []);
```

4. In `refresh()`, change the fetch to `await modalRequest("load candidates", candidatesUrl(scope.value));`.
5. The open effect also reloads when a banner rescopes an already open modal. Change its dependency list from `[open.value]` to `[open.value, scope.value]`.
6. Replace the empty-state line with:

```jsx
            <div class="cleanup-empty">
              {scope.value
                ? "This worktree isn't ready to clean up: it needs a merged or closed PR, a deleted remote branch, or to sit idle."
                : "No cleanup candidates. 🎉"}
            </div>
```

- [ ] **Step 4: Run the tests and confirm they pass.**

Run: `npx vitest run static/src/split static/src/overlays static/src/chrome`

Expected: all pass.

- [ ] **Step 5: Commit.**

```bash
git add static/src/split/alertFeed.js static/src/split/__tests__/alertFeed.test.js static/src/chrome/SpawnAccountPicker.jsx static/src/overlays/CleanupModal.jsx static/src/overlays/__tests__/cleanupModal.test.js
git commit -m "openers for banner buttons: markReadySeen, selectReview, pickSpawnAccount, and a cleanup modal scoped to one worktree (THI-422)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: `notify/actions.js` and the bridge in `tauri.js`

**Files:**
- Create: `static/src/notify/actions.js`
- Modify: `static/src/tauri.js` (add `setNotifyCategories` and `onNotificationAction`)
- Modify: `static/src/notify/copy.js` (export `usageCategory` only; Task 5 uses it)
- Create: `static/src/notify/__tests__/actions.test.js`

- [ ] **Step 1: Write the failing test.** Create `static/src/notify/__tests__/actions.test.js`:

```js
// What a banner's buttons are (categories) and what pressing one does
// (runAction). The shell side — registering the set, reporting a press — is
// cargo-tested in notifications.rs; the openers are injected here.
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../tauri.js", () => ({
  inTauri: () => false, notify: vi.fn(), onNotificationClick: vi.fn(), onNotificationOpened: vi.fn(),
  onNotificationAction: vi.fn(), openExternal: vi.fn(), setBadgeCount: vi.fn(), setNotifyCategories: vi.fn(),
}));
const { windows } = await import("../../store.js");
const { categories, runAction } = await import("../actions.js");

const openers = () => ({
  openExternal: vi.fn(), openUsageDetails: vi.fn(), pickSpawnAccount: vi.fn(), openCleanupModal: vi.fn(),
  markReadySeen: vi.fn(), selectReview: vi.fn(), revealPane: vi.fn(),
});

afterEach(() => {
  windows.value = [];
});

describe("categories", () => {
  it("gives every banner variant its buttons", () => {
    const byId = Object.fromEntries(categories().map((c) => [c.id, c.actions.map((a) => a.id)]));
    expect(byId).toEqual({
      done: ["review", "mark_seen"], done_seen: ["mark_seen"], ci_failed_pr: ["open_pr"],
      pr_merged: ["cleanup", "open_pr"], pr_merged_pr: ["open_pr"], usage: ["details"],
    });
  });

  it("brings the app forward only for buttons that show something in it", () => {
    const fg = categories().flatMap((c) => c.actions).filter((a) => a.foreground).map((a) => a.id);
    expect(new Set(fg)).toEqual(new Set(["review", "cleanup", "details"]));
  });

  it("adds one labelled Spawn on {B} category per move target, sorted", () => {
    const accounts = [{ id: "default", label: "A" }, { id: "b", label: "B" }, { id: "c", label: "C" }];
    const usage = categories({ accounts, moveTargets: { default: "c", b: "c", c: "b" } }).filter((c) => c.id.startsWith("usage_to_"));
    expect(usage.map((c) => c.id)).toEqual(["usage_to_b", "usage_to_c"]);
    expect(usage[1].actions.map((a) => [a.id, a.title])).toEqual([["spawn_on", "Spawn on C"], ["details", "Details"]]);
  });

  it("has no Spawn category with one account", () => {
    const set = categories({ accounts: [{ id: "default", label: "A" }], moveTargets: {} });
    expect(set.some((c) => c.id.startsWith("usage_to_"))).toBe(false);
  });

  it("is the same set whatever order move_targets arrive in", () => {
    const a = categories({ moveTargets: { x: "y", y: "x" } });
    const b = categories({ moveTargets: { y: "x", x: "y" } });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe("runAction", () => {
  it("Open PR opens the PR in the browser", () => {
    const o = openers();
    runAction({ target: "s:1", action: "open_pr", data: { url: "https://github.com/o/r/pull/7" } }, o);
    expect(o.openExternal).toHaveBeenCalledWith("https://github.com/o/r/pull/7");
  });

  it("Details opens the usage pill", () => {
    const o = openers();
    runAction({ target: "", action: "details", data: { open: "usage" } }, o);
    expect(o.openUsageDetails).toHaveBeenCalled();
  });

  it("Spawn on {B} pins spawns to the banner's B", () => {
    const o = openers();
    runAction({ target: "", action: "spawn_on", data: { open: "usage", spawn_to: "b" } }, o);
    expect(o.pickSpawnAccount).toHaveBeenCalledWith("b");
  });

  it("Mark seen finds the pane by pid, and does nothing once it's gone", () => {
    const o = openers();
    windows.value = [{ pid: "p1", target: "s:4" }];
    runAction({ target: "s:1", action: "mark_seen", data: { pid: "p1" } }, o);
    expect(o.markReadySeen).toHaveBeenCalledWith(windows.value[0]);
    windows.value = [];
    runAction({ target: "s:1", action: "mark_seen", data: { pid: "p1" } }, o);
    expect(o.markReadySeen).toHaveBeenCalledTimes(1);
    expect(o.revealPane).not.toHaveBeenCalled();
  });

  it("Review diff selects the live pane's session, else the banner's, else reveals", () => {
    const o = openers();
    windows.value = [{ pid: "p1", target: "s:1", session: "live" }];
    runAction({ target: "s:1", action: "review", data: { pid: "p1", session: "old" } }, o);
    expect(o.selectReview).toHaveBeenLastCalledWith("live");
    windows.value = [];
    runAction({ target: "s:1", action: "review", data: { pid: "p1", session: "old" } }, o);
    expect(o.selectReview).toHaveBeenLastCalledWith("old");
    runAction({ target: "s:1", action: "review", data: { pid: "p1" } }, o);
    expect(o.revealPane).toHaveBeenCalledWith("s:1");
  });

  it("Clean up scopes the modal to the live pane's cwd, else the banner's, else reveals", () => {
    const o = openers();
    windows.value = [{ pid: "p1", target: "s:1", cwd: "/wt/live" }];
    runAction({ target: "s:1", action: "cleanup", data: { pid: "p1", cwd: "/wt/old" } }, o);
    expect(o.openCleanupModal).toHaveBeenLastCalledWith({ paths: ["/wt/live"] });
    windows.value = [];
    runAction({ target: "s:1", action: "cleanup", data: { pid: "p1", cwd: "/wt/old" } }, o);
    expect(o.openCleanupModal).toHaveBeenLastCalledWith({ paths: ["/wt/old"] });
    runAction({ target: "s:1", action: "cleanup", data: { pid: "p1" } }, o);
    expect(o.revealPane).toHaveBeenCalledWith("s:1");
  });

  it("reveals the pane when an opener throws, and never throws itself", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const o = { ...openers(), openUsageDetails: () => { throw new Error("boom"); } };
    expect(() => runAction({ target: "s:1", action: "details", data: {} }, o)).not.toThrow();
    expect(o.revealPane).toHaveBeenCalledWith("s:1");
    err.mockRestore();
  });

  it("ignores an action it doesn't know, and tolerates null data from the shell", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const o = openers();
    runAction({ target: "s:1", action: "allow", data: null }, o);
    expect(warn).toHaveBeenCalled();
    expect(Object.values(o).some((f) => f.mock.calls.length)).toBe(false);
    warn.mockRestore();
  });
});
```

- [ ] **Step 2: Run it and confirm it fails.**

Run: `npx vitest run static/src/notify/__tests__/actions.test.js`

Expected: FAIL, because `../actions.js` doesn't exist.

- [ ] **Step 3: Implement.**

In `static/src/notify/copy.js`, add below the `CHECK_MARK` line:

```js
// A usage banner's category when it can offer Spawn on {B}: one per B,
// because a category's buttons, labels included, are fixed (notify/actions.js).
export const usageCategory = (to) => `usage_to_${to}`;
```

In `static/src/tauri.js`:

1. Add a private helper after `invoke`:

```js
// Subscribe to a Tauri event from the shell. transformCallback is the raw-JS
// way to receive one without the @tauri-apps/api event module.
async function listen(event, cb) {
  const handler = window.__TAURI_INTERNALS__.transformCallback((e) => {
    if (e?.payload) cb(e.payload);
  });
  await invoke("plugin:event|listen", { event, target: { kind: "Any" }, handler });
}
```

2. Rewrite the bodies of `onNotificationClick` and `onNotificationOpened` to use it, keeping their comments and their `console.warn` labels:

```js
export async function onNotificationClick(cb) {
  if (!inTauri()) return;
  try {
    await listen("periscope:notification-clicked", cb);
  } catch (e) {
    console.warn("[tauri] notification-click listener failed:", e);
  }
}
```

`onNotificationOpened` follows the same shape with `"periscope:notification-opened"` and its own warn label.

3. Add after `onNotificationOpened`:

```js
// Register a handler for a banner's buttons: the shell sends { target, kind,
// action, text, data }, `text` being what was typed into a reply button.
export async function onNotificationAction(cb) {
  if (!inTauri()) return;
  try {
    await listen("periscope:notification-action", cb);
  } catch (e) {
    console.warn("[tauri] notification-action listener failed:", e);
  }
}

// Register every banner category's buttons (notify/actions.js builds the
// set). macOS replaces the whole set on each call and registers it
// asynchronously, so the feed sends it when the set changes, never just
// before posting: a banner posted right behind a registration can show no
// buttons. An older shell has no listener; its banners carry no buttons.
export async function setNotifyCategories(set) {
  if (!inTauri()) return;
  try {
    await invoke("plugin:event|emit", { event: "periscope:notify-categories", payload: set });
  } catch (e) {
    console.warn("[tauri] setNotifyCategories failed:", e);
  }
}
```

Create `static/src/notify/actions.js`:

```js
// A banner's buttons: which ones each banner category carries (categories)
// and what pressing one does (runAction). notify/feed.js registers the set
// through tauri.js and routes presses here; notifications.rs maps the set
// onto macOS categories and reports a press on notification-action.
//
// A category is a fixed set of buttons, labels included, so copy.js gives
// each banner the variant whose buttons all apply: no Review diff without a
// branch, no Clean up without a worktree, and Spawn on {B} gets one category
// per B. None of these make an agent act; Allow / Deny / reply are PR 2's
// (docs/superpowers/specs/2026-10-26-native-notifications-2b-design.md).
import { accountLabel } from "../accounts.js";
import { pickSpawnAccount } from "../chrome/SpawnAccountPicker.jsx";
import { openUsageDetails } from "../chrome/UsagePill.jsx";
import { openCleanupModal } from "../overlays/CleanupModal.jsx";
import { markReadySeen, revealPane, selectReview } from "../split/alertFeed.js";
import { windows } from "../store.js";
import { openExternal } from "../tauri.js";
import { usageCategory } from "./copy.js";

const act = (id, title, opts = {}) => ({ id, title, ...opts });
// `foreground` brings Periscope forward: only for buttons that show
// something in it. Open PR's browser comes forward on its own.
const OPEN_PR = act("open_pr", "Open PR");
const MARK_SEEN = act("mark_seen", "Mark seen");
const DETAILS = act("details", "Details", { foreground: true });

// The whole set: macOS replaces it on each registration. Move targets are
// deduped and sorted so the feed's change check doesn't resend an identical
// set because move_targets came back in another order.
export function categories({ accounts = [], moveTargets = {} } = {}) {
  const set = [
    { id: "done", actions: [act("review", "Review diff", { foreground: true }), MARK_SEEN] },
    { id: "done_seen", actions: [MARK_SEEN] },
    { id: "ci_failed_pr", actions: [OPEN_PR] },
    { id: "pr_merged", actions: [act("cleanup", "Clean up worktree", { foreground: true }), OPEN_PR] },
    { id: "pr_merged_pr", actions: [OPEN_PR] },
    { id: "usage", actions: [DETAILS] },
  ];
  for (const to of [...new Set(Object.values(moveTargets || {}))].sort()) {
    set.push({ id: usageCategory(to), actions: [act("spawn_on", `Spawn on ${accountLabel(to, accounts)}`), DETAILS] });
  }
  return set;
}

export const OPENERS = {
  openExternal, openUsageDetails, pickSpawnAccount, openCleanupModal, markReadySeen, selectReview, revealPane,
};

// A pressed button, as the shell reports it. The pane is found by pid first:
// tmux renumbers windows, so the target can name a neighbour by now. The
// banner's own data is the fallback for a pane that has gone. Never throws:
// a failed press still shows you the pane.
export function runAction({ target, action, data } = {}, o = OPENERS) {
  // A default covers only a missing data; the shell's Info defaults it to null.
  data ||= {};
  const w = data.pid != null ? (windows.peek() || []).find((x) => String(x.pid) === String(data.pid)) : null;
  try {
    switch (action) {
      case "open_pr":
        if (data.url) o.openExternal(data.url);
        return;
      case "details":
        o.openUsageDetails();
        return;
      case "spawn_on":
        if (data.spawn_to) o.pickSpawnAccount(data.spawn_to);
        return;
      case "mark_seen":
        // A gone pane has no READY row left to dismiss.
        if (w) o.markReadySeen(w);
        return;
      case "review": {
        const session = w?.session || data.session;
        if (session) o.selectReview(session);
        else o.revealPane(target);
        return;
      }
      case "cleanup": {
        const cwd = w?.cwd || data.cwd;
        if (cwd) o.openCleanupModal({ paths: [cwd] });
        else o.revealPane(target);
        return;
      }
      default:
        console.warn("[notify] unknown action", action);
    }
  } catch (e) {
    console.error("[notify] action failed", action, e);
    if (target) o.revealPane(target);
  }
}
```

- [ ] **Step 4: Run the tests and confirm they pass.**

Run: `npx vitest run static/src/notify && npx biome check --formatter-enabled=false static/src/notify static/src/tauri.js`

Expected: all pass, and Biome is clean. Fix the import order if Biome complains.

- [ ] **Step 5: Commit.**

```bash
git add static/src/notify/actions.js static/src/notify/__tests__/actions.test.js static/src/notify/copy.js static/src/tauri.js
git commit -m "notify: actions — the banner categories and what each button does; tauri.js registers the set and hears presses (THI-422)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

**Revised in review:** the cleanup case shipped as `const cwd = data.cwd || w?.cwd;` (the banner's own data wins over a moved live pane); the fallbacks and the catch call `show()` (`selectPane` on the live pane found by `data.pid`, else `revealPane(target)`) rather than `revealPane(target)` directly; and "has no Spawn category with one account" was renamed to "has no Spawn category without move targets".

---

### Task 5: Banners name their category; the feed registers the set and routes presses

**Files:**
- Modify: `static/src/notify/copy.js` (`payloadFor`)
- Modify: `static/src/notify/feed.js` (`runPass`, `startNotifyFeed`)
- Test: `static/src/notify/__tests__/copy.test.js`, `static/src/notify/__tests__/feed.test.js`

- [ ] **Step 1: Write the failing tests.**

Append inside `describe("payloadFor", …)` in `copy.test.js`:

```js
  it("gives each banner the category whose buttons all apply", () => {
    expect(payloadFor({ kind: "done", w: w() })).toMatchObject({ category: "done", data: { pid: "p1", session: "periscope" } });
    expect(payloadFor({ kind: "done", w: w({ branch: "" }) }).category).toBe("done_seen");
    expect(payloadFor({ kind: "ci_failed", w: w({ pr: 7 }) }).category).toBe("ci_failed_pr");
    expect(payloadFor({ kind: "pr_merged", w: w({ pr: 7, cwd: "/wt/a" }) })).toMatchObject({ category: "pr_merged", data: { cwd: "/wt/a" } });
    expect(payloadFor({ kind: "pr_merged", w: w({ pr: 7 }) }).category).toBe("pr_merged_pr");
    // Their buttons are PR 2's: no category yet, so the shell shows none.
    expect(payloadFor({ kind: "needs_input", w: w() }).category).toBeUndefined();
  });

  it("offers Spawn on the account a pane on A would move to, and only then", () => {
    const ev = { kind: "usage", account: "default", meter: "week_all", m: { percent: 90 } };
    const accounts = [{ id: "default", label: "A" }, { id: "b", label: "B" }];
    expect(payloadFor(ev, { accounts, moveTargets: { default: "b" } })).toMatchObject({
      category: "usage_to_b", data: { open: "usage", spawn_to: "b" },
    });
    expect(payloadFor(ev, { accounts, moveTargets: {} })).toMatchObject({ category: "usage", data: { open: "usage" } });
    expect(payloadFor(ev, { accounts }).data.spawn_to).toBeUndefined();
    expect(payloadFor(ev, { accounts, moveTargets: { default: "default" } }).category).toBe("usage");
  });
```

In `feed.test.js`:
- add `onNotificationAction: vi.fn(), setNotifyCategories: vi.fn(),` to the `vi.mock("../../tauri.js", …)` factory;
- add `expect(tauri.onNotificationAction).not.toHaveBeenCalled();` to the "does nothing in a plain browser tab" test;
- append inside `describe("runPass", …)`:

```js
  it("sends the category set on the first pass, then only when it changes", () => {
    const accounts = [{ id: "default", label: "A" }, { id: "b", label: "B" }];
    const first = runPass(fresh(), snapOf([win()], { accounts, moveTargets: { default: "b" } }), PREFS, 0);
    expect(first.categories.map((c) => c.id)).toContain("usage_to_b");
    const ctx = fresh({ state: first.state, lastBadge: first.lastBadge, lastCategories: first.lastCategories });
    expect(runPass(ctx, snapOf([win()], { accounts, moveTargets: { default: "b" } }), PREFS, 1000).categories).toBeNull();
    const moved = runPass(ctx, snapOf([win()], { accounts, moveTargets: { default: "b", b: "default" } }), PREFS, 1000);
    expect(moved.categories.map((c) => c.id)).toContain("usage_to_default");
  });

  it("sends no categories before the first /api/state", () => {
    expect(runPass(fresh(), snapOf([], { alerts: null }), PREFS, 0).categories).toBeNull();
  });
```

- [ ] **Step 2: Run them and confirm they fail.**

Run: `npx vitest run static/src/notify`

Expected: FAIL. `category` is undefined in the copy tests, and `categories` is undefined in the runPass results.

- [ ] **Step 3: Implement.**

In `copy.js`'s `payloadFor`:

- **`done`:** add `category: w.branch ? "done" : "done_seen",` and change its data to `data: { open: "pane", pid: w.pid, session: w.session },`. Put a comment above the category: `// Review diff needs a branch to diff; Mark seen always applies.`
- **`ci_failed`:** add `category: "ci_failed_pr",` with the comment `// PR 2's Ask agent to fix adds a "ci_failed" category with that button.`
- **`pr_merged`:** add `category: w.cwd ? "pr_merged" : "pr_merged_pr",` and change its data to `data: { open: "url", url: prUrl(w.repo_slug, w.pr), pid: w.pid, cwd: w.cwd },`.
- **`usage`:** before the `return`, add:

```js
      // Spawn on the account a pane on A would move to (launch_policy.choose_move,
      // published as move_targets): not launch_default, which can be A itself.
      const to = ctx.moveTargets?.[ev.account];
      const spawn = to && to !== ev.account;
```

and in the returned object add `category: spawn ? usageCategory(to) : "usage",`, replacing `data: { open: "usage" },` with `data: spawn ? { open: "usage", spawn_to: to } : { open: "usage" },`.

Also update the `payloadFor` header comment: replace `// Each event's banner: { kind, title, subtitle, body, target, thread, data }.` with `// Each event's banner: { kind, title, subtitle, body, target, thread, category, data }.`, and `ctx: { accounts, windows }.` with `ctx: { accounts, windows, moveTargets }. \`category\` picks the banner's buttons (notify/actions.js); a kind without one shows none.`

In `feed.js`:

1. Imports:
   - add `import { categories, runAction } from "./actions.js";`;
   - add `moveTargets` to the `../store.js` import list, in alphabetical order;
   - add `onNotificationAction` and `setNotifyCategories` to the `../tauri.js` import, in alphabetical order.
2. Change the `NO_NEWS` line to `const NO_NEWS = { sends: [], flush: [], badge: null, categories: null };`.
3. In `runPass`:
   - change the destructure to `let { state, recent, held, heldSince, lastBadge, lastCategories } = ctx;`;
   - change `const bctx = { accounts: snap.accounts, windows: snap.windows };` to `const bctx = { accounts: snap.accounts, windows: snap.windows, moveTargets: snap.moveTargets };`;
   - in `out`, change `state, recent, held, heldSince, lastBadge, ...NO_NEWS, flush,` to `state, recent, held, heldSince, lastBadge, lastCategories, ...NO_NEWS, flush,`;
   - directly after `if (snap.alerts === null) return out();`, add:

```js
  // The buttons each banner category carries, sent whole when the set
  // changes (accounts or move targets moved) and on a JS context's first pass
  // (lastCategories starts undefined), which covers a reload and a recycle.
  // Never at post time: registration is asynchronous (tauri.js).
  const set = categories({ accounts: snap.accounts, moveTargets: snap.moveTargets });
  const setKey = JSON.stringify(set);
  const cats = setKey === lastCategories ? null : set;
  lastCategories = setKey;
```

   - every later `return out(...)` must carry it: change `return out({ badge });` to `return out({ badge, categories: cats });` and the final `return out({ sends, badge });` to `return out({ sends, badge, categories: cats });`.
4. Update `runPass`'s doc comment so the carried keys read `{ state, recent, held, heldSince, lastBadge, lastCategories }`, and add `` `categories` the set to register (null: unchanged)``.
5. In `startNotifyFeed`:
   - `let ctx = { …, lastBadge: undefined };` becomes `lastBadge: undefined, lastCategories: undefined };`;
   - in `flushHeld`, `const bctx = { accounts: accounts.peek(), windows: windows.peek() || [] };` becomes `const bctx = { accounts: accounts.peek(), windows: windows.peek() || [], moveTargets: moveTargets.peek() };`;
   - after `onNotificationOpened(openFromBanner);`, add `onNotificationAction(runAction);`;
   - in the effect's `snap`, add `moveTargets: moveTargets.peek(),` after `accounts: accounts.peek(),`;
   - change the destructure to `const { sends, flush, badge, categories: cats, timerAt, ...next } = runPass(...)`;
   - immediately before `for (const p of [...flush, ...sends]) notify(p);`, add `if (cats) setNotifyCategories(cats);`.

- [ ] **Step 4: Run the tests and confirm they pass.**

Run: `npx vitest run static/src/notify && npm test 2>&1 | grep -E "Tests |Test Files"`

Expected: all pass. If another suite mocks `../../tauri.js` and now imports `feed.js` / `actions.js` transitively, add `onNotificationAction` and `setNotifyCategories` to that mock too. Run `grep -rln 'vi.mock("../../tauri.js"' static/src` to find them.

- [ ] **Step 5: Commit.**

```bash
git add static/src/notify/copy.js static/src/notify/feed.js static/src/notify/__tests__/copy.test.js static/src/notify/__tests__/feed.test.js
git commit -m "notify: each banner names the category whose buttons apply; the feed registers the set when it changes and routes presses to actions (THI-422)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Docs, bundle, gate

**Files:**
- Modify: `docs/tauri-shell.md` ("Notifications across version skew")
- Modify: `CLAUDE.md` (the reference-docs table row for `static/src/notify/`)
- Modify: `static/dist/*` (rebuilt)

- [ ] **Step 1: Docs.**

In `docs/tauri-shell.md`, after the "**An old shell with new JS** loses:" list (before "So **install a rebuilt `.app`…"), add:

```markdown
- the buttons (2b): it never registers the categories the webview sends, so banners arrive without them. A **new shell with old JS** shows none either: old JS's banners never name a category, and the shell never falls back to a banner's kind (2b's category ids reuse 2a kind names), so even a set a newer webview left registered shows no buttons. The shell treats buttons as data, so a new button needs new JS only, never a new `.app`.
```

In `CLAUDE.md`'s reference table, the row starting ``| `static/src/notify/`, `notifications.rs`…`` becomes:

```markdown
| `static/src/notify/`, `notifications.rs`, `tauri.js` `notify` / `onNotificationOpened` / `onNotificationAction`, `NotifySettings` | `docs/superpowers/specs/2026-10-21-native-notifications-design.md` (its revision sections first) — one pass per applied state (`stateSeq`), grace counted in passes, keys that survive a restart, webview/shell version skew; buttons: `2026-10-26-native-notifications-2b-design.md` — categories are data the webview registers, one per variant whose buttons all apply |
```

- [ ] **Step 2: Bundle and gate.**

```bash
npm run build
bin/check && npm test && uv run pytest -q
(cd src-tauri && cargo test notifications 2>&1 | tail -2 && rustfmt --check --edition 2021 src/notifications.rs)
```

Expected:
- `all checks passed`;
- vitest all green;
- pytest all green;
- cargo `test result: ok`.

- [ ] **Step 3: Commit.** The docs and the bundle go in separate commits.

```bash
git add docs/tauri-shell.md CLAUDE.md
git commit -m "docs: banner buttons across version skew; CLAUDE.md points the notify area at the 2b spec (THI-422)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
git add static/dist
git commit -m "build: static/dist

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7 (controller): PR, merge, deploy

1. Push `feature/notify-actions` to `fork`. Open the PR against `tomplex/periscope:main` titled `THI-422: banner buttons, part 1 — the shell's categories and the plain buttons`. Its body summarises the buttons, the version-skew story and the deploy order, and ends with the attribution line.
2. Wait for CI (`check`, `pytest`) to go green, then merge with `gh pr merge --merge`.
3. Deploy:
   - in the main checkout, `git fetch origin && git merge --ff-only origin/main`, then `bin/periscope restart`;
   - check that `/api/healthz` reports the merge commit and the served `/dist/app.js` matches main's.
4. Shell:
   - in the main checkout, run `cd src-tauri && cargo tauri build`, which rebuilds `target/release/bundle/macos/Periscope.app`, the copy the user runs;
   - relaunch it: `pkill -x periscope-app; open src-tauri/target/release/bundle/macos/Periscope.app`.

   Either order with step 3 is safe: each half without the other means no buttons.
5. Hand check, for the user: the next done / merged / usage banner shows its buttons, and each one does what its row in the spec says.
6. Clean up: `git worktree remove .claude/worktrees/notify-actions`, `git branch -d feature/notify-actions`, `git push fork --delete feature/notify-actions`.
