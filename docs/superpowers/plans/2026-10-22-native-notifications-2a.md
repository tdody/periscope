# Native Notifications 2a (banners) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Native macOS banners from the Periscope app for six kinds of news. Each kind arrives once with its copy, a click opens the right place, each kind can be turned off in Settings, bursts are grouped, and banners stay quiet while the dashboard is focused. The dock badge counts the panes waiting on you, and dedupe survives reloads and webview recycles. No action buttons yet (2b).

The six kinds:
- `needs_input`: a session needs input;
- `question`: an agent asks;
- `done`: a session finishes;
- `ci_failed`: CI fails;
- `pr_merged`: a linked PR merges;
- `usage`: usage is running hot.

**Architecture:** Four pure modules decide and word the banners:
- `notify/detect.js`: what's news, as `detect(prev, snapshot, nowSec)`;
- `notify/copy.js`: each event's text;
- `notify/burst.js`: grouping;
- `notify/persist.js`: resuming from `localStorage`.

`notify/feed.js` is the only effectful module: it watches the store's signals, sends through `tauri.js`, sets the badge and routes clicks. The Rust shell maps payloads onto `UNUserNotificationCenter`. Kinded banners carry what a click opens in `userInfo` and report clicks on a new event, so an older shell and an older webview each keep working. The server adds each PR's base branch and per-check outcomes, and a `notify` prefs block.

**Tech Stack:** Preact + `@preact/signals`, vitest (node env, `preact-render-to-string`); FastAPI + Pydantic, pytest; Rust (Tauri 2, objc2 `UNUserNotificationCenter`), `cargo test`.

**Spec:** `docs/superpowers/specs/2026-10-21-native-notifications-design.md`. Its "Revisions made while planning 2a" section supersedes the body where they disagree. 2b (the action buttons, the permission hook, the guarded endpoints, the scoped cleanup modal) gets its own plan after this lands.

**Prototyped:** every code block below was built and run in a throwaway worktree of local `main` at `a821864`:
- vitest: 699 passed (53 files);
- pytest: 1546 passed;
- `cargo test` (src-tauri): 10 passed, no warnings;
- `bin/check`: clean, apart from the 3 biome warnings already on `main`;
- `vite build`: succeeded.

The banners themselves need the bundled app and macOS notification permission, so they are checked by hand in Task 14.

> **Superseded in places.** The final code and the spec's revision sections
> (`docs/superpowers/specs/2026-10-21-native-notifications-design.md`) win where this
> plan disagrees: the focus rationale, `eprintln!` in the Rust blocks, the
> question and needs-input keys, and grouping.

---

## Before you start

- **Read first:** `docs/invariants.md` (the PR / `window_view` plumbing), `docs/tauri-shell.md` (the shell, webview recycling, building the `.app`), and `docs/testing.md`.
- **Branch from local `main`, not `origin/main`.** Local `main` carries the critter picker and these docs, which aren't upstream yet:
  ```bash
  cd ~/github/tomplex/periscope   # the main checkout
  git worktree add -b feature/notify-banners .claude/worktrees/notify-banners main
  cd .claude/worktrees/notify-banners && uv sync && npm install
  ```
- **Patches.** Modified files are given as unified diffs from the prototype. Apply each with `git apply` from the worktree root. If `main` has moved and a hunk no longer applies, apply that hunk by hand: the `+` lines are the code, and the context lines say where.
- **New files** are given in full. Copy them byte-for-byte.
- **Commits.** Commit after every task with a single-line message. End each with a blank line and your session's `Co-Authored-By:` attribution trailer.
- **CI-shaped check per task:** `npx vitest run <the task's tests>` or `uv run pytest <files> -q`, then lint the touched files (`npx biome check <files>`, or `uv run ruff check <files> && uv run ruff format --check <files>`).

## File map

| File | Status | Responsibility |
|---|---|---|
| `periscope/git_pr.py` | modify | `_ci_checks` (per-check outcome, failing first); `pr_base` + `ci_checks` from both `gh` calls |
| `periscope/window_view.py` | modify | the linked-PR override carries its own `ci_checks` / `pr_base` |
| `periscope/routes/prefs.py` | modify | `NotifyPrefs` model; `UIPatch.notify` |
| `static/src/split/attention.js` | modify | `waitingPanes` (one entry per waiting pane), shared by Clawd and the badge |
| `static/src/chrome/clawdDuty.js` | modify | uses `waitingPanes` |
| `static/src/util.js` | modify | `waitKind(waiting_for)` |
| `static/src/notify/detect.js` | create | pure: snapshots → events, with dedupe state |
| `static/src/notify/copy.js` | create | pure: event → banner payload |
| `static/src/notify/burst.js` | create | pure: leading-edge grouping + summary |
| `static/src/notify/persist.js` | create | resume / save the dedupe state in `localStorage` |
| `static/src/notify/feed.js` | create | effects: detect → toggles → burst → send; badge; click routing |
| `static/src/prefs.js` | modify | `NOTIFY_DEFAULTS`, `getNotifyPrefs`, `setNotifyPref` |
| `static/src/tauri.js` | modify | `notify` passes the whole payload; `onNotificationOpened` |
| `static/src/chrome/UsagePill.jsx` | modify | `usageExpanded` signal + `openUsageDetails()` |
| `static/src/split/alertFeed.js` | modify | drops `maybeNativeNotify` + badge; keeps the legacy click listener |
| `static/src/split/Split.jsx` | modify | starts the notify feed |
| `static/src/overlays/NotifySettings.jsx` | create | Settings → Notifications checkboxes |
| `static/src/overlays/SettingsModal.jsx` | modify | mounts it |
| `static/styles.css` | modify | inline checkboxes in the fieldset |
| `src-tauri/src/notifications.rs` | modify | full payload; userInfo; `notification-opened`; quiet-when-focused |
| `src-tauri/src/main.rs` | modify | keeps window focus for `will_present` |
| tests | create/modify | `tests/test_git_pr.py`, `tests/test_window_view.py`, `tests/routes/test_prefs.py`, `static/src/split/__tests__/attention.test.js`, `static/src/notify/__tests__/{detect,copy,burst,persist,feed}.test.js`, `static/src/__tests__/prefs.test.js`, `static/src/chrome/__tests__/usagePillRender.test.jsx`, `static/src/overlays/__tests__/notifySettingsRender.test.jsx` |

---

### Task 1: Each PR's base branch and per-check outcomes

The `ci_failed` banner names the failing checks, and `pr_merged` names the base. Both `gh` calls already fetch `statusCheckRollup`; this adds `baseRefName` and maps the rollup to `[{name, state}]`. In `window_view`, the linked-PR path overrides `ci` from its own lookup, so it must override these two the same way, or a linked PR would show another PR's checks.

**Files:** Modify `periscope/git_pr.py`, `periscope/window_view.py`. Test: `tests/test_git_pr.py`, `tests/test_window_view.py`.

- [ ] **Step 1: Write the failing tests.** Apply:

```diff
diff --git a/tests/test_git_pr.py b/tests/test_git_pr.py
index db2b2c3..930b581 100644
--- a/tests/test_git_pr.py
+++ b/tests/test_git_pr.py
@@ -6,6 +6,7 @@ import pytest
 
 from periscope.git_pr import (
     _GIT_TTL,
+    _ci_checks,
     _ci_glyph,
     _gh_run_state,
     _git_cache,
@@ -16,6 +17,7 @@ from periscope.git_pr import (
     git_signal_for,
     git_state_for,
     linked_pr_state_for,
+    pr_state_for,
 )
 
 
@@ -175,6 +177,66 @@ def test_ci_glyph_rollup():
     assert _ci_glyph(None) is None
 
 
+def test_ci_checks_names_each_check_failing_first():
+    rollup = [
+        {"name": "lint", "conclusion": "SUCCESS"},
+        {"name": "build", "status": "IN_PROGRESS"},
+        {"context": "ci/legacy", "state": "PENDING"},
+        {"name": "test", "conclusion": "FAILURE"},
+        {"name": "unnamed-skip", "conclusion": ""},
+    ]
+    assert _ci_checks(rollup) == [
+        {"name": "test", "state": "failure"},
+        {"name": "build", "state": "pending"},
+        {"name": "ci/legacy", "state": "pending"},
+        {"name": "lint", "state": "success"},
+    ]
+
+
+def test_ci_checks_caps_the_list():
+    rollup = [{"name": f"c{i}", "conclusion": "SUCCESS"} for i in range(10)]
+    assert len(_ci_checks(rollup)) == 6
+    assert _ci_checks(None) == []
+
+
+def test_linked_pr_state_carries_base_and_checks(tmp_path, mocker):
+    import json as _json
+
+    payload = _json.dumps(
+        {"state": "OPEN", "baseRefName": "main", "statusCheckRollup": [{"name": "test", "conclusion": "FAILURE"}]}
+    )
+    mocker.patch("periscope.git_pr._run", return_value=(0, payload))
+    mocker.patch("periscope.git_pr._GH_AVAILABLE", True)
+    out = linked_pr_state_for(str(tmp_path), 42)
+    assert out["pr_base"] == "main"
+    assert out["ci_checks"] == [{"name": "test", "state": "failure"}]
+
+
+def test_pr_state_for_carries_base_and_checks(tmp_path, mocker):
+    import json as _json
+
+    payload = _json.dumps(
+        [
+            {
+                "number": 7,
+                "title": "t",
+                "isDraft": False,
+                "additions": 1,
+                "deletions": 2,
+                "reviewRequests": [],
+                "baseRefName": "main",
+                "statusCheckRollup": [{"name": "test", "conclusion": "FAILURE"}],
+            }
+        ]
+    )
+    mocker.patch("periscope.git_pr._run", return_value=(0, payload))
+    mocker.patch("periscope.git_pr._GH_AVAILABLE", True)
+    out = pr_state_for(str(tmp_path), "feature")
+    assert out["pr_base"] == "main"
+    assert out["ci"] == "✗"
+    assert out["ci_checks"] == [{"name": "test", "state": "failure"}]
+
+
 def _fake_gh(mocker, *, state, rollup=None):
     """Patch _run so linked_pr_state_for sees `gh pr view` returning one PR."""
     import json as _json
@@ -191,13 +253,13 @@ def _fake_gh(mocker, *, state, rollup=None):
 def test_linked_pr_state_merged(tmp_path, mocker):
     _fake_gh(mocker, state="MERGED")
     out = linked_pr_state_for(str(tmp_path), 1234)
-    assert out == {"pr_state": "merged", "ci": None}
+    assert out == {"pr_state": "merged", "ci": None, "ci_checks": [], "pr_base": None}
 
 
 def test_linked_pr_state_open_with_ci(tmp_path, mocker):
-    _fake_gh(mocker, state="OPEN", rollup=[{"conclusion": "SUCCESS"}])
+    _fake_gh(mocker, state="OPEN", rollup=[{"name": "test", "conclusion": "SUCCESS"}])
     out = linked_pr_state_for(str(tmp_path), 1234)
-    assert out == {"pr_state": "open", "ci": "✓"}
+    assert out == {"pr_state": "open", "ci": "✓", "ci_checks": [{"name": "test", "state": "success"}], "pr_base": None}
 
 
 def test_linked_pr_state_closed(tmp_path, mocker):
```

```diff
diff --git a/tests/test_window_view.py b/tests/test_window_view.py
index eddabfb..da6ccb2 100644
--- a/tests/test_window_view.py
+++ b/tests/test_window_view.py
@@ -462,6 +462,54 @@ def test_view_linked_pr_merged_carries_state(mocker, clean_state):
     assert view["ci"] is None
 
 
+def test_view_linked_pr_carries_its_own_checks_and_base(mocker, clean_state):
+    """The linked PR's checks and base replace the branch PR's, as `ci` does:
+    the CI-failed banner must name this PR's checks, not another query's."""
+    from periscope.window_view import build_window_view
+
+    pid = "abc12345"
+    clean_state["windows"][pid] = {"linked_pr": 1234}
+    mocker.patch(
+        "periscope.window_view.parse_pane",
+        return_value={"agent": "claude", "state": "idle", "spinner": None},
+    )
+    _stub_subsystems(
+        mocker,
+        pane_content="x",
+        pr={"pr": "999", "ci": "✓", "ci_checks": [{"name": "other", "state": "success"}], "pr_base": "dev"},
+        linked_pr={
+            "pr_state": "open",
+            "ci": "✗",
+            "ci_checks": [{"name": "test", "state": "failure"}],
+            "pr_base": "main",
+        },
+    )
+
+    view, _ = build_window_view(_window(pid=pid), now_ts=1000)
+    assert view["ci_checks"] == [{"name": "test", "state": "failure"}]
+    assert view["pr_base"] == "main"
+
+
+def test_view_linked_pr_cold_drops_the_branch_prs_checks(mocker, clean_state):
+    from periscope.window_view import build_window_view
+
+    pid = "abc12345"
+    clean_state["windows"][pid] = {"linked_pr": 1234}
+    mocker.patch(
+        "periscope.window_view.parse_pane",
+        return_value={"agent": "claude", "state": "idle", "spinner": None},
+    )
+    _stub_subsystems(
+        mocker,
+        pane_content="x",
+        pr={"pr": "999", "ci": "✓", "ci_checks": [{"name": "x", "state": "success"}], "pr_base": "dev"},
+    )
+
+    view, _ = build_window_view(_window(pid=pid), now_ts=1000)
+    assert "ci_checks" not in view
+    assert "pr_base" not in view
+
+
 def test_view_surfaces_linked_linear(mocker, clean_state):
     from periscope.window_view import build_window_view
 
```

- [ ] **Step 2: Run them to verify they fail.** Run `uv run pytest tests/test_git_pr.py tests/test_window_view.py -q`. Expected: an ImportError for `_ci_checks` and `pr_state_for`'s new fields; the two new window_view tests fail on missing `ci_checks`.

- [ ] **Step 3: Implement.** Apply:

```diff
diff --git a/periscope/git_pr.py b/periscope/git_pr.py
index 4a827ee..828c047 100644
--- a/periscope/git_pr.py
+++ b/periscope/git_pr.py
@@ -54,6 +54,8 @@ _GH_AVAILABLE = shutil.which("gh") is not None
 # failure conclusion is added in one place. The "running" and "success/neutral"
 # buckets intentionally differ between those two callers and are NOT shared.
 _CI_FAILED_CONCLUSIONS = frozenset({"FAILURE", "CANCELLED", "TIMED_OUT", "ACTION_REQUIRED"})
+_CI_PENDING_STATES = frozenset({"PENDING", "QUEUED", "IN_PROGRESS", "WAITING"})
+_CI_PASSED_STATES = frozenset({"SUCCESS", "NEUTRAL", "SKIPPED"})
 
 
 def git_state_for(path: str) -> dict | None:
@@ -185,13 +187,37 @@ def _ci_glyph(rollup: list | None) -> str | None:
     states.discard("")
     if states & _CI_FAILED_CONCLUSIONS:
         return "✗"
-    if states & {"PENDING", "QUEUED", "IN_PROGRESS", "WAITING"}:
+    if states & _CI_PENDING_STATES:
         return "⟳"
-    if states and states <= {"SUCCESS", "NEUTRAL", "SKIPPED"}:
+    if states and states <= _CI_PASSED_STATES:
         return "✓"
     return None
 
 
+def _ci_checks(rollup: list | None, limit: int = 6) -> list[dict]:
+    """Each check's name and outcome ("failure" / "pending" / "success"), failing
+    first, at most `limit`: the CI-failed notification names what broke, which
+    the rolled-up glyph can't. Check runs carry `name` + `conclusion`/`status`;
+    commit statuses carry `context` + `state`."""
+    rank = {"failure": 0, "pending": 1, "success": 2}
+    out = []
+    for c in rollup or []:
+        name = c.get("name") or c.get("context") or ""
+        s = (c.get("conclusion") or c.get("status") or c.get("state") or "").upper()
+        outcome = (
+            "failure"
+            if s in _CI_FAILED_CONCLUSIONS
+            else "pending"
+            if s in _CI_PENDING_STATES
+            else "success"
+            if s in _CI_PASSED_STATES
+            else None
+        )
+        if name and outcome:
+            out.append({"name": name, "state": outcome})
+    return sorted(out, key=lambda c: rank[c["state"]])[:limit]
+
+
 def pr_state_for(path: str, branch: str) -> dict | None:
     """Return PR metadata + CI rollup for the PR open against `branch` in
     repo at `path`. Modal sidebar surfaces title/draft/+/−/reviewers; the
@@ -208,7 +234,7 @@ def pr_state_for(path: str, branch: str) -> dict | None:
             "--state",
             "open",
             "--json",
-            "number,title,isDraft,additions,deletions,reviewRequests,statusCheckRollup",
+            "number,title,isDraft,additions,deletions,reviewRequests,statusCheckRollup,baseRefName",
             "--limit",
             "1",
         ],
@@ -224,7 +250,8 @@ def pr_state_for(path: str, branch: str) -> dict | None:
     if not prs:
         return None
     pr = prs[0]
-    ci = _ci_glyph(pr.get("statusCheckRollup"))
+    rollup = pr.get("statusCheckRollup")
+    ci = _ci_glyph(rollup)
     # gh exposes requested reviewers as either users (with `login`) or teams
     # (with `name`) — take the login for users, name for teams, and trim to
     # the leading letters as the avatar text (2 chars max).
@@ -236,6 +263,8 @@ def pr_state_for(path: str, branch: str) -> dict | None:
     return {
         "pr": pr.get("number"),
         "ci": ci,
+        "ci_checks": _ci_checks(rollup),
+        "pr_base": pr.get("baseRefName") or None,
         "pr_title": pr.get("title") or "",
         "pr_draft": bool(pr.get("isDraft")),
         "pr_additions": int(pr.get("additions") or 0),
@@ -377,7 +406,7 @@ def linked_pr_state_for(path: str, number: int) -> dict | None:
     if not _GH_AVAILABLE or not path or not number:
         return None
     code, out = _run(
-        ["gh", "pr", "view", str(number), "--json", "state,statusCheckRollup"],
+        ["gh", "pr", "view", str(number), "--json", "state,statusCheckRollup,baseRefName"],
         cwd=path,
         timeout=8.0,
     )
@@ -390,6 +419,8 @@ def linked_pr_state_for(path: str, number: int) -> dict | None:
     return {
         "pr_state": (pr.get("state") or "").lower() or None,  # open/merged/closed
         "ci": _ci_glyph(pr.get("statusCheckRollup")),
+        "ci_checks": _ci_checks(pr.get("statusCheckRollup")),
+        "pr_base": pr.get("baseRefName") or None,
     }
 
 
```

```diff
diff --git a/periscope/window_view.py b/periscope/window_view.py
index e6e072a..0e30970 100644
--- a/periscope/window_view.py
+++ b/periscope/window_view.py
@@ -384,8 +384,12 @@ def build_window_view(
         if linked_state:
             pr["pr_state"] = linked_state.get("pr_state")
             pr["ci"] = linked_state.get("ci")
+            pr["ci_checks"] = linked_state.get("ci_checks") or []
+            pr["pr_base"] = linked_state.get("pr_base")
         else:
             pr.pop("ci", None)
+            pr.pop("ci_checks", None)
+            pr.pop("pr_base", None)
 
     # The track is the grouping authority. A repo-default track has id == repo
     # (the anchor / pinned dir); a goal track carries its repo on the row (or
```

- [ ] **Step 4: Run them to verify they pass.** Run `uv run pytest tests/test_git_pr.py tests/test_window_view.py -q` (prototype: 75 passed). Then `uv run ruff check periscope/git_pr.py periscope/window_view.py tests/test_git_pr.py tests/test_window_view.py && uv run ruff format --check` on the same files.

- [ ] **Step 5: Commit:** `git_pr: each PR's base branch and per-check outcomes (failing first), the linked PR's own — for the CI-failed and merged banners`.

---

### Task 2: The `notify` prefs block on the server

Declared, or Pydantic drops it and the client's optimistic toggle reverts on the echo.

**Files:** Modify `periscope/routes/prefs.py`. Test: `tests/routes/test_prefs.py`.

- [ ] **Step 1: Write the failing tests.** Apply:

```diff
diff --git a/tests/routes/test_prefs.py b/tests/routes/test_prefs.py
index 6b74aa5..fa79474 100644
--- a/tests/routes/test_prefs.py
+++ b/tests/routes/test_prefs.py
@@ -111,6 +111,27 @@ def test_tama_critters_match_the_generated_sprites():
     assert ("clawd", *build_critters.CRITTERS) == TAMA_CRITTERS
 
 
+def test_patch_prefs_ui_notify_round_trips(client, clean_state):
+    prefs = {
+        "needs_input": True,
+        "done": False,
+        "ci_failed": True,
+        "pr_merged": True,
+        "usage": False,
+        "quiet_when_focused": True,
+        "group": True,
+        "badge": False,
+    }
+    r = client.patch("/api/prefs/ui", json={"notify": prefs})
+    assert r.status_code == 200
+    assert r.json()["ui"]["notify"] == prefs
+
+
+def test_patch_prefs_ui_notify_rejects_a_non_bool(client, clean_state):
+    r = client.patch("/api/prefs/ui", json={"notify": {"done": "sometimes"}})
+    assert r.status_code == 422
+
+
 def test_put_window_annotation(client, clean_state):
     r = client.put("/api/prefs/windows/abc123", json={"notes": "hi", "tags": ["a", "b", "a"]})
     assert r.status_code == 200
```

- [ ] **Step 2: Run them to verify they fail.** Run `uv run pytest tests/routes/test_prefs.py -q`. Expected: the round-trip test fails (`notify` is dropped) and the 422 test fails.

- [ ] **Step 3: Implement.** Apply:

```diff
diff --git a/periscope/routes/prefs.py b/periscope/routes/prefs.py
index 68f7d88..bad65e4 100644
--- a/periscope/routes/prefs.py
+++ b/periscope/routes/prefs.py
@@ -42,6 +42,21 @@ def get_prefs():
     return snapshot()
 
 
+class NotifyPrefs(BaseModel):
+    """Settings → Notifications: which native macOS banners fire (the Tauri
+    shell only). Every field optional; the client always sends the whole set,
+    because update_ui merges only top-level keys."""
+
+    needs_input: bool | None = None
+    done: bool | None = None
+    ci_failed: bool | None = None
+    pr_merged: bool | None = None
+    usage: bool | None = None
+    quiet_when_focused: bool | None = None
+    group: bool | None = None
+    badge: bool | None = None
+
+
 class UIPatch(BaseModel):
     session_order: list[str] | None = None
     collapsed_sessions: list[str] | None = None
@@ -87,6 +102,8 @@ class UIPatch(BaseModel):
     # Settings → Tamagotchi: one of TAMA_CRITTERS. Declared, or Pydantic drops
     # it and the client's optimistic pick reverts on the echo.
     tama_critter: str | None = None
+    # Settings → Notifications (NotifyPrefs). Declared for the same reason.
+    notify: NotifyPrefs | None = None
     # Diagnostic label for the track_order change log (which client path wrote
     # it, and what it saw); never persisted.
     writer: str | None = None
```

- [ ] **Step 4: Run them to verify they pass.** Run `uv run pytest tests/routes/test_prefs.py -q` (prototype: 35 passed), then ruff on both files.

- [ ] **Step 5: Commit:** `prefs: /api/prefs/ui takes the notify block (one bool per banner kind and behaviour)`.

---

### Task 3: `waitingPanes`, one entry per waiting pane, for Clawd and the badge

Move `dutyItems`' pane-dedup loop into `attention.js`, so Clawd's bell and the dock badge count exactly what the rail counts. This is a pure refactor: the existing `clawdDuty` tests must stay green.

**Files:** Modify `static/src/split/attention.js`, `static/src/chrome/clawdDuty.js`. Test: `static/src/split/__tests__/attention.test.js`.

- [ ] **Step 1: Write the failing tests.** Apply:

```diff
diff --git a/static/src/split/__tests__/attention.test.js b/static/src/split/__tests__/attention.test.js
index 22692d7..d4ebd66 100644
--- a/static/src/split/__tests__/attention.test.js
+++ b/static/src/split/__tests__/attention.test.js
@@ -2,7 +2,7 @@ import { describe, expect, it } from "vitest";
 import { shortestUniqueSuffix } from "../../util.js";
 import {awaitingReplyByPid, buildActivity,
   buildNeedsYou, buildReady, buildRunning, 
-  isSoftQuestion, needsYouCount, prunedStateDismissals,resolvePinned, waitTier,
+  isSoftQuestion, needsYouCount, prunedStateDismissals,resolvePinned, waitingPanes, waitTier,
 } from "../attention.js";
 
 const win = (over = {}) => ({
@@ -252,3 +252,25 @@ describe("waitTier", () => {
     expect(waitTier(1000, 1000 + 3600)).toBe("urgent");
   });
 });
+
+describe("waitingPanes", () => {
+  it("counts a pane once when it has both a live dialog and an unanswered event", () => {
+    const w = win({ state: "needs-input", needs_since: 300 });
+    const m = waitingPanes([w], [evt({ ts: 200 })], new Set(), new Set(), 1000);
+    expect(m.size).toBe(1);
+    expect(m.get("pid:p1").row.kind).toBe("live");
+    expect(m.get("pid:p1").since).toBe(200);
+  });
+
+  it("keys an event for a pane that has gone by its target", () => {
+    const m = waitingPanes([], [evt({ target: "gone:3" })], new Set(), new Set(), 1000);
+    expect([...m.keys()]).toEqual(["target:gone:3"]);
+  });
+
+  it("leaves out the panes `keep` rejects", () => {
+    const a = win({ pid: "a", target: "a:0", state: "needs-input" });
+    const b = win({ pid: "b", target: "b:0", state: "needs-input" });
+    const m = waitingPanes([a, b], [], new Set(), new Set(), 1000, (w) => w?.pid !== "a");
+    expect([...m.keys()]).toEqual(["pid:b"]);
+  });
+});
```

- [ ] **Step 2: Run them to verify they fail.** Run `npx vitest run static/src/split/__tests__/attention.test.js`. Expected: FAIL, `waitingPanes` is not exported.

- [ ] **Step 3: Implement.** Apply:

```diff
diff --git a/static/src/split/attention.js b/static/src/split/attention.js
index 6270757..5034669 100644
--- a/static/src/split/attention.js
+++ b/static/src/split/attention.js
@@ -139,6 +139,35 @@ export function awaitingReplyByPid(windows, alertItems, dismissedIds = new Set()
   return out;
 }
 
+// Panes waiting on you, one entry each: a pane can have both a live
+// needs-input row and an unacked need_human event (Claude notifies while its
+// pane sits waiting), and the rail lists both. A pane waits since the earlier
+// of the server's needs-input stamp (needs_since, which survives a reload) and
+// its oldest unanswered event, the rail's own urgency tier
+// (awaitingReplyByPid). Clawd's bell and the dock badge both count these, so
+// neither can disagree with the rail. `keep(w)` filters panes out (Clawd skips
+// the one open in the detail view). Map of key -> { row, since }; a live row
+// wins over an event row for the same pane.
+export function waitingPanes(windows, alertItems, dismissedIds = new Set(), dismissedNeedsPids = new Set(), nowSec = 0,
+  keep = () => true) {
+  const asked = awaitingReplyByPid(windows, alertItems, dismissedIds);
+  const waiting = new Map();
+  for (const r of buildNeedsYou(windows, alertItems, dismissedIds, dismissedNeedsPids)) {
+    if (!keep(r.w)) continue;
+    const key = r.w?.pid != null ? `pid:${r.w.pid}` : `target:${r.target}`;
+    const since = Math.min(
+      r.kind === "event" ? r.ts : (r.w.needs_since || nowSec),
+      ...(r.w?.pid != null && asked.has(r.w.pid) ? [asked.get(r.w.pid)] : []),
+    );
+    const prev = waiting.get(key);
+    waiting.set(key, {
+      row: prev?.row.kind === "live" ? prev.row : r,
+      since: prev ? Math.min(prev.since, since) : since,
+    });
+  }
+  return waiting;
+}
+
 // Live "working" panes, in /api/state order. A pure mirror of pane state —
 // no events, no dismissals: rows appear and disappear with the spinner.
 export function buildRunning(windows) {
```

```diff
diff --git a/static/src/chrome/clawdDuty.js b/static/src/chrome/clawdDuty.js
index cd0a9bc..4b1dcc6 100644
--- a/static/src/chrome/clawdDuty.js
+++ b/static/src/chrome/clawdDuty.js
@@ -6,7 +6,7 @@
 // (split/alertFeed.js openNeedsPane / openReadyPane), and the context band is
 // the rail's ctxClass: Clawd and the rail can never disagree about a pane.
 
-import { awaitingReplyByPid, buildNeedsYou, buildReady, waitTier } from "../split/attention.js";
+import { buildReady, waitingPanes, waitTier } from "../split/attention.js";
 import { ctxClass } from "../split/ctxBand.js";
 import { paneLabel, plural } from "../util.js";
 
@@ -45,29 +45,10 @@ export function dutyItems({
   const live = windows.filter(notSelected);
   const byPid = new Map(windows.map((w) => [String(w.pid), w]));
 
-  // Panes, not rows: a pane can have both a live needs-input row and an
-  // unacked need_human event (Claude notifies while its pane sits waiting), and
-  // the rail lists both. A pane waits since the earlier of the server's
-  // needs-input stamp (needs_since, which survives a reload) and its oldest
-  // unanswered event — that event time is the rail's own urgency tier
-  // (awaitingReplyByPid), so Clawd's red bubble and the rail's wait-urgent agree.
-  const asked = awaitingReplyByPid(windows, alerts, dismissedAlertIds);
-  const waiting = new Map();
-  for (const r of buildNeedsYou(windows, alerts, dismissedAlertIds, dismissedNeedsPids)) {
-    if (!notSelected(r.w)) continue;
-    const key = r.w?.pid != null ? `pid:${r.w.pid}` : `target:${r.target}`;
-    const since = Math.min(
-      r.kind === "event" ? r.ts : (r.w.needs_since || nowSec),
-      ...(r.w?.pid != null && asked.has(r.w.pid) ? [asked.get(r.w.pid)] : []),
-    );
-    const prev = waiting.get(key);
-    waiting.set(key, {
-      // A live row opens the way the rail's NEEDS YOU row does; an event row
-      // reveals its pane, as the rail's event row does.
-      row: prev?.row.kind === "live" ? prev.row : r,
-      since: prev ? Math.min(prev.since, since) : since,
-    });
-  }
+  // Panes, not rows (attention.waitingPanes), so Clawd's red bubble and the
+  // rail's wait-urgent agree. A live row opens the way the rail's NEEDS YOU row
+  // does; an event row reveals its pane, as the rail's event row does.
+  const waiting = waitingPanes(windows, alerts, dismissedAlertIds, dismissedNeedsPids, nowSec, notSelected);
   if (waiting.size) {
     const oldest = [...waiting.values()].reduce((a, b) => (b.since < a.since ? b : a));
     const r = oldest.row;
```

- [ ] **Step 4: Run them to verify they pass.** Run `npx vitest run static/src/split static/src/chrome` (all green, including `clawdDuty.test.js` and `tamagotchiRender.test.jsx` unchanged). Then `npx biome check static/src/split/attention.js static/src/chrome/clawdDuty.js static/src/split/__tests__/attention.test.js`.

- [ ] **Step 5: Commit:** `attention: waitingPanes — one entry per waiting pane, shared by Clawd's bell and (next) the dock badge`.

---

### Task 4: `notify/detect.js`, what's news

**Files:** Create `static/src/notify/detect.js`, `static/src/notify/__tests__/detect.test.js`.

- [ ] **Step 1: Write the failing test** `static/src/notify/__tests__/detect.test.js`:

```js
import { describe, expect, it } from "vitest";
import { detect, prKey } from "../detect.js";

const NOW = 1_000_000;
const win = (over = {}) => ({
  pid: "p1", target: "s:1", session: "s", name: "pane", branch: "b", state: "idle",
  focused_at: 0, acted_at: 0, ...over,
});
const ask = (over = {}) => ({ id: "a1", kind: "need_human", target: "s:1", ts: NOW - 5, message: "which db?", ...over });
const meter = (over = {}) => ({ percent: 40, resets_at: NOW + 3600, hot: false, ...over });
const plan = (meters, over = {}) => ({ default: { available: true, fetched_at: NOW - 60, meters, ...over } });

// Seed with `before`, then return the events `after` announces.
function step(before, after) {
  const seeded = detect(null, before, NOW).state;
  return detect(seeded, after, NOW);
}
const kinds = (r) => r.events.map((e) => e.kind);

describe("detect", () => {
  it("announces nothing on the first snapshot, whatever is already there", () => {
    const r = detect(null, { windows: [win({ state: "needs-input" }), win({ pid: "p2", state: "done" })], alerts: [ask()] }, NOW);
    expect(r.events).toEqual([]);
  });

  it("announces each needs-input episode once", () => {
    const waiting = { windows: [win({ state: "needs-input", needs_since: 100 })] };
    const r = step({ windows: [win()] }, waiting);
    expect(kinds(r)).toEqual(["needs_input"]);
    expect(detect(r.state, waiting, NOW).events).toEqual([]);
    // A new episode of the same pane is new news.
    expect(kinds(detect(r.state, { windows: [win({ state: "needs-input", needs_since: 200 })] }, NOW))).toEqual(["needs_input"]);
  });

  it("announces an agent's question, but not alongside the same pane's dialog", () => {
    expect(kinds(step({ windows: [win()], alerts: [] }, { windows: [win()], alerts: [ask()] }))).toEqual(["question"]);
    const both = { windows: [win({ state: "needs-input" })], alerts: [ask()] };
    expect(kinds(step({ windows: [win()], alerts: [] }, both))).toEqual(["needs_input"]);
  });

  it("skips dismissed and acked questions", () => {
    const before = { windows: [win()], alerts: [] };
    expect(step(before, { windows: [win()], alerts: [ask()], dismissedAlertIds: new Set(["a1"]) }).events).toEqual([]);
    expect(step(before, { windows: [win({ focused_at: NOW })], alerts: [ask()] }).events).toEqual([]);
  });

  it("announces each finished turn once, unless its READY row was dismissed", () => {
    const done = { windows: [win({ state: "done", completed_at: 500 })] };
    expect(kinds(step({ windows: [win()] }, done))).toEqual(["done"]);
    expect(step({ windows: [win()] }, { ...done, dismissedReadyPids: new Set(["p1"]) }).events).toEqual([]);
  });

  it("announces CI turning red on an open PR, once per transition", () => {
    const pr = (ci, over = {}) => ({ windows: [win({ pr: 7, repo_slug: "o/r", ci, ...over })] });
    const r = step(pr("⟳"), pr("✗"));
    expect(kinds(r)).toEqual(["ci_failed"]);
    expect(detect(r.state, pr("✗"), NOW).events).toEqual([]);
    // Re-run, red again: a new failure.
    const green = detect(r.state, pr("⟳"), NOW).state;
    expect(kinds(detect(green, pr("✗"), NOW))).toEqual(["ci_failed"]);
    // A PR first seen red, or a closed one, says nothing.
    expect(step({ windows: [] }, pr("✗")).events).toEqual([]);
    expect(step(pr("⟳", { pr_state: "closed" }), pr("✗", { pr_state: "closed" })).events).toEqual([]);
  });

  it("counts a PR once however many panes show it", () => {
    const panes = (ci) => ({ windows: [win({ pr: 7, repo_slug: "o/r", ci }), win({ pid: "p2", target: "s:2", pr: 7, repo_slug: "o/r", ci })] });
    expect(kinds(step(panes("⟳"), panes("✗")))).toEqual(["ci_failed"]);
  });

  it("announces a linked PR merging, and keeps a PR missing from a poll", () => {
    const linked = (pr_state) => ({ windows: [win({ pr: 7, repo_slug: "o/r", pr_state })] });
    expect(kinds(step(linked("open"), linked("merged")))).toEqual(["pr_merged"]);
    const gone = detect(detect(null, linked("open"), NOW).state, { windows: [] }, NOW).state;
    expect(kinds(detect(gone, linked("merged"), NOW))).toEqual(["pr_merged"]);
    expect(step({ windows: [] }, linked("merged")).events).toEqual([]);
  });

  it("announces a meter getting worse once per mood step per reset window", () => {
    const at = (m) => ({ plan: plan({ week_all: m }) });
    const grumpy = meter({ projected_percent: 120 });
    const r = step(at(meter()), at(grumpy));
    expect(r.events.map((e) => e.mood)).toEqual(["grumpy"]);
    // Flapping back to calm and up again doesn't re-arm.
    const calm = detect(r.state, at(meter()), NOW).state;
    expect(detect(calm, at(grumpy), NOW).events).toEqual([]);
    // Furious is the next step.
    expect(detect(calm, at(meter({ hot: true })), NOW).events.map((e) => e.mood)).toEqual(["furious"]);
    // A new reset window starts over.
    const next = meter({ projected_percent: 120, resets_at: NOW + 99999 });
    expect(detect(calm, at(next), NOW).events.map((e) => e.mood)).toEqual(["grumpy"]);
  });

  it("leaves stale and unavailable accounts out of usage", () => {
    const hot = meter({ hot: true });
    expect(step({ plan: plan({ s: meter() }) }, { plan: plan({ s: hot }, { fetched_at: NOW - 9999 }) }).events).toEqual([]);
    expect(step({ plan: plan({ s: meter() }) }, { plan: plan({ s: hot }, { available: false }) }).events).toEqual([]);
  });

  it("resumes from a saved state: news that arrived meanwhile is announced once", () => {
    const saved = detect(null, { windows: [win()] }, NOW).state;
    const after = { windows: [win({ state: "needs-input", needs_since: 9 })] };
    const r = detect(JSON.parse(JSON.stringify(saved)), after, NOW);
    expect(kinds(r)).toEqual(["needs_input"]);
    expect(detect(r.state, after, NOW).events).toEqual([]);
  });

  it("keeps only live keys, so the state prunes itself", () => {
    const r = step({ windows: [win()] }, { windows: [win({ state: "needs-input", needs_since: 1 })] });
    expect(Object.keys(detect(r.state, { windows: [win()] }, NOW).state.seen)).toEqual([]);
  });

  it("keys a PR by repo and number", () => {
    expect(prKey({ repo_slug: "o/r", pr: 7 })).toBe("o/r#7");
    expect(prKey({ repo_key: "/x", pr: 7 })).toBe("/x#7");
  });
});
```

- [ ] **Step 2: Run it to verify it fails.** Run `npx vitest run static/src/notify/__tests__/detect.test.js`. Expected: FAIL, it can't resolve `../detect.js`.

- [ ] **Step 3: Implement** `static/src/notify/detect.js`:

```js
// What deserves a native notification (notify/feed.js sends them): the pure
// part, so every trigger and its dedupe unit-test without signals or Tauri.
//
// detect(prev, snapshot, nowSec) -> { state, events }. `prev` is the last
// state, or null to seed: the first snapshot records what is already there and
// announces nothing, so a reload never replays old news. Each event fires once
// per key; the state holds only keys still live, so it prunes itself.

import { isStale, projectsPastLimit } from "../chrome/usageRules.js";
import { buildNeedsYou } from "../split/attention.js";

export const KINDS = ["needs_input", "question", "done", "ci_failed", "pr_merged", "usage"];

// One PR, however many panes show it.
export const prKey = (w) => `${w.repo_slug || w.repo_key || ""}#${w.pr}`;

const MOOD_RANK = { calm: 0, grumpy: 1, furious: 2 };
const meterMood = (m) => (m.hot ? "furious" : projectsPastLimit(m) ? "grumpy" : "calm");

export function detect(prev, snap, nowSec) {
  const {
    windows = [], alerts = [], dismissedAlertIds = new Set(), dismissedNeedsPids = new Set(),
    dismissedReadyPids = new Set(), plan = {},
  } = snap;
  const seeding = !prev;
  const prevSeen = prev?.seen || {};
  const seen = {};
  const events = [];
  const note = (key, ev) => {
    seen[key] = true;
    if (!seeding && !prevSeen[key]) events.push({ key, ...ev });
  };

  // Needs-you: a live dialog per needs-input episode (needs_since), a
  // question per agent need_human message. One banner per pane: a pane with a
  // dialog open doesn't also announce its message.
  const rows = buildNeedsYou(windows, alerts, dismissedAlertIds, dismissedNeedsPids);
  const asking = new Set();
  for (const r of rows) {
    if (r.kind !== "live") continue;
    asking.add(r.w.pid);
    note(`needs:${r.w.pid}@${r.w.needs_since || 0}`, { kind: "needs_input", w: r.w });
  }
  for (const r of rows) {
    if (r.kind !== "event") continue;
    const key = `question:${r.id}`;
    if (r.w && asking.has(r.w.pid)) seen[key] = true;
    else note(key, { kind: "question", w: r.w, alert: r });
  }

  // Done: each finished turn (completed_at), the rail's READY rule.
  for (const w of windows) {
    if (w.state === "done" && !dismissedReadyPids.has(w.pid)) note(`done:${w.pid}@${w.completed_at || 0}`, { kind: "done", w });
  }

  // PRs, by transition rather than by key: CI turning red, a linked PR
  // merging. A PR first sighted mid-state (already red, already merged) only
  // records it. PRs missing from a poll keep their last state, so a rolling
  // reload can't erase the "open" a merge needs to follow.
  const ci = { ...(prev?.ci || {}) };
  const prs = { ...(prev?.prs || {}) };
  const byPr = new Map();
  for (const w of windows) {
    if (!w.pr) continue;
    const k = prKey(w);
    // The linked pane (it carries pr_state) speaks for the PR.
    if (!byPr.has(k) || (w.pr_state && !byPr.get(k).pr_state)) byPr.set(k, w);
  }
  for (const [k, w] of byPr) {
    const open = !w.pr_state || w.pr_state === "open";
    const glyph = open ? w.ci || null : null;
    if (!seeding && k in ci && ci[k] !== "✗" && glyph === "✗") events.push({ key: `ci:${k}`, kind: "ci_failed", w });
    ci[k] = glyph;
    if (w.pr_state) {
      if (!seeding && prs[k] === "open" && w.pr_state === "merged") events.push({ key: `merged:${k}`, kind: "pr_merged", w });
      prs[k] = w.pr_state;
    }
  }

  // Usage: a meter's mood getting worse, at most once per mood step per reset
  // window (the key carries resets_at). The highest mood reached is kept, so a
  // meter flapping back to calm doesn't re-arm within the window. Stale or
  // unavailable accounts are left out, as the pill and Clawd's mood do.
  const meters = {};
  for (const [account, entry] of Object.entries(plan || {})) {
    if (!entry?.available || !entry.meters || isStale(entry, nowSec)) continue;
    for (const [meter, m] of Object.entries(entry.meters)) {
      if (!m) continue;
      const mood = meterMood(m);
      const k = `${account}/${meter}/${m.resets_at || 0}`;
      const was = prev?.meters?.[k] ?? (seeding ? MOOD_RANK[mood] : 0);
      meters[k] = Math.max(was, MOOD_RANK[mood]);
      if (!seeding && MOOD_RANK[mood] > was) events.push({ key: `usage:${k}:${mood}`, kind: "usage", account, meter, m, mood });
    }
  }

  return { state: { seen, ci, prs, meters }, events };
}
```

- [ ] **Step 4: Run it to verify it passes.** Run the same command (13 passed), then `npx biome check static/src/notify`.

- [ ] **Step 5: Commit:** `notify: detect — what deserves a banner (needs input, questions, done, red CI, merges, hot usage), once per key, seeded so a reload never replays`.

---

### Task 5: `notify/copy.js`, what each banner says, plus `util.waitKind`

**Files:** Create `static/src/notify/copy.js`, `static/src/notify/__tests__/copy.test.js`. Modify `static/src/util.js`.

- [ ] **Step 1: Write the failing test** `static/src/notify/__tests__/copy.test.js`:

```js
import { describe, expect, it } from "vitest";
import { waitKind } from "../../util.js";
import { firstSentence, payloadFor, prUrl } from "../copy.js";

const w = (over = {}) => ({ pid: "p1", target: "s:1", session: "periscope", name: "dual-moas", branch: "main", ...over });

describe("payloadFor", () => {
  it("words a needs-input banner by what the pane waits on", () => {
    const p = payloadFor({ kind: "needs_input", w: w({ waiting_for: "permission prompt" }) });
    expect(p).toMatchObject({
      kind: "needs_input", thread: "needs_input", target: "s:1", title: "dual-moas needs you",
      subtitle: "periscope · main", body: "Waiting for your approval.", data: { open: "pane", pid: "p1" },
    });
    expect(payloadFor({ kind: "needs_input", w: w({ waiting_for: "approve AskUserQuestion" }) }).body).toBe("Waiting for your answer.");
    expect(payloadFor({ kind: "needs_input", w: w() }).body).toBe("Waiting for your input.");
  });

  it("clips a long pane name so the verb survives macOS's truncation", () => {
    const p = payloadFor({ kind: "needs_input", w: w({ name: "a-really-long-pane-name-that-goes-on-and-on" }) });
    expect(p.title.length).toBeLessThanOrEqual(40);
    expect(p.title.endsWith("… needs you")).toBe(true);
  });

  it("carries the agent's question, even for a pane that has gone", () => {
    const alert = { target: "gone:2", name: "old", session: "s", message: "Which database should I use?" };
    expect(payloadFor({ kind: "question", w: w(), alert })).toMatchObject({ title: "dual-moas asks", body: "Which database should I use?" });
    expect(payloadFor({ kind: "question", w: null, alert })).toMatchObject({ title: "old asks", subtitle: "s", target: "gone:2" });
  });

  it("names the PR a finished pane opened, and its last sentence", () => {
    const p = payloadFor({ kind: "done", w: w({ pr: 29, recap: "Opened the PR. Tests pass." }) });
    expect(p).toMatchObject({ title: "dual-moas is done", subtitle: "periscope · PR #29 opened", body: "Opened the PR." });
    expect(payloadFor({ kind: "done", w: w() }).body).toBe("Finished.");
  });

  it("lists the failing checks first and links the PR", () => {
    const p = payloadFor({
      kind: "ci_failed",
      w: w({ pr: 7, repo_slug: "o/r", ci_checks: [{ name: "test", state: "failure" }, { name: "lint", state: "success" }] }),
    });
    expect(p).toMatchObject({
      title: "CI failed on #7", subtitle: "periscope · dual-moas", body: "✗ test · ✓ lint",
      data: { open: "url", url: "https://github.com/o/r/pull/7" },
    });
    expect(payloadFor({ kind: "ci_failed", w: w({ pr: 7 }) }).body).toBe("Checks are failing.");
  });

  it("shows where a merged PR went", () => {
    const p = payloadFor({ kind: "pr_merged", w: w({ pr: 7, repo_slug: "o/r", branch: "feat", pr_base: "main" }) });
    expect(p).toMatchObject({ title: "PR #7 merged", subtitle: "periscope · feat → main" });
  });

  it("names the account and its working sessions only when there are several accounts", () => {
    const ev = { kind: "usage", account: "b", meter: "week_all", m: { percent: 81.4, projected_percent: 112 }, mood: "grumpy" };
    const windows = [w({ state: "working", account: "b" }), w({ state: "working", account: "default" }), w({ state: "idle", account: "b" })];
    const two = [{ id: "default", label: "A" }, { id: "b", label: "B" }];
    expect(payloadFor(ev, { accounts: two, windows })).toMatchObject({
      title: "Account B is running hot", subtitle: "week usage 81% · →112% at reset", body: "1 session working on B.",
      target: "", data: { open: "usage" },
    });
    expect(payloadFor(ev, { accounts: [{ id: "b", label: "B" }], windows })).toMatchObject({
      title: "Usage is running hot", body: "1 session working.",
    });
    expect(payloadFor({ ...ev, m: { percent: 99, hot: true } }, { accounts: two }).subtitle).toBe("week usage 99%");
  });
});

describe("helpers", () => {
  it("firstSentence takes one sentence and clips it", () => {
    expect(firstSentence("Done. Next I'll refactor.")).toBe("Done.");
    expect(firstSentence("no full stop here")).toBe("no full stop here");
    expect(firstSentence("x".repeat(300)).length).toBe(140);
    expect(firstSentence(null)).toBe("");
  });

  it("prUrl needs both the repo and the number", () => {
    expect(prUrl({ repo_slug: "o/r", pr: 3 })).toBe("https://github.com/o/r/pull/3");
    expect(prUrl({ pr: 3 })).toBeNull();
  });

  it("waitKind sorts the raw waiting_for values", () => {
    expect(waitKind("permission prompt")).toBe("permission");
    expect(waitKind("Approve AskUserQuestion")).toBe("question");
    expect(waitKind("dialog open")).toBe("dialog");
    expect(waitKind(null)).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails.** Run `npx vitest run static/src/notify/__tests__/copy.test.js`. Expected: FAIL, `waitKind` and `../copy.js` are missing.

- [ ] **Step 3: Implement.** Apply to `util.js`:

```diff
diff --git a/static/src/util.js b/static/src/util.js
index 49f7387..4104502 100644
--- a/static/src/util.js
+++ b/static/src/util.js
@@ -70,6 +70,17 @@ export function waitLabel(reason) {
   return map[reason.toLowerCase()] || reason.toLowerCase();
 }
 
+// What a pane's needs-input waits on, as a kind, from the same raw values as
+// waitLabel: the native notifications word a permission dialog, a multiple-
+// choice question and any other dialog differently. null when unmapped.
+export function waitKind(reason) {
+  if (!reason) return null;
+  const r = reason.toLowerCase();
+  if (r === "permission prompt") return "permission";
+  if (r === "approve askuserquestion") return "question";
+  return "dialog";
+}
+
 // Shortest trailing-path suffix of `name` that is unique among `allNames`.
 // Branch/session names are slash-paths (tc/model-train/feature-store); we show
 // the fewest trailing segments needed to disambiguate from the other names
```

and create `static/src/notify/copy.js`:

```js
// What each notification says (notify/detect.js finds them, notify/feed.js
// sends them): the pure part. macOS truncates titles around 40 characters, so
// pane names are clipped before they push the verb off the end.

import { meterLabel } from "../chrome/usageRules.js";
import { paneLabel, plural, waitKind } from "../util.js";

const clip = (s, n) => {
  const t = String(s || "").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};
const pane = (w) => clip(paneLabel(w), 26);
const where = (w) => [w?.session, w?.branch].filter(Boolean).join(" · ");

// The first sentence of a pane's last words, for a done banner.
export function firstSentence(text) {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  const m = t.match(/^.*?[.!?](?=\s|$)/);
  return clip(m ? m[0] : t, 140);
}

export function prUrl(w) {
  return w?.repo_slug && w?.pr ? `https://github.com/${w.repo_slug}/pull/${w.pr}` : null;
}

const NEEDS_BODY = {
  permission: "Waiting for your approval.",
  question: "Waiting for your answer.",
  dialog: "Waiting for your input.",
};
const CHECK_MARK = { failure: "✗", pending: "⟳", success: "✓" };

// Each event's banner: { kind, title, subtitle, body, target, thread, data }.
// `target` is the pane, so an older shell's plain click can still reveal it;
// `data` says what a click opens. ctx: { accounts, windows }.
export function payloadFor(ev, ctx = {}) {
  const w = ev.w;
  const base = { kind: ev.kind, thread: ev.kind, target: w?.target || "", data: {} };
  switch (ev.kind) {
    case "needs_input":
      return {
        ...base, title: `${pane(w)} needs you`, subtitle: where(w),
        body: NEEDS_BODY[waitKind(w.waiting_for)] || NEEDS_BODY.dialog, data: { open: "pane", pid: w.pid },
      };
    case "question": {
      const a = ev.alert;
      return {
        ...base, title: `${clip(w ? paneLabel(w) : a.name || a.session || "A session", 26)} asks`,
        subtitle: w ? where(w) : a.session || "", body: clip(a.message, 180), target: a.target || base.target,
        data: { open: "pane", pid: w?.pid ?? null },
      };
    }
    case "done":
      return {
        ...base, title: `${pane(w)} is done`,
        subtitle: w.pr ? `${w.session} · PR #${w.pr} opened` : where(w),
        body: firstSentence(w.recap || w.last_line) || "Finished.", data: { open: "pane", pid: w.pid },
      };
    case "ci_failed": {
      const checks = (w.ci_checks || []).map((c) => `${CHECK_MARK[c.state] || "·"} ${c.name}`).join(" · ");
      return {
        ...base, title: `CI failed on #${w.pr}`, subtitle: [w.session, paneLabel(w)].filter(Boolean).join(" · "),
        body: checks || "Checks are failing.", data: { open: "url", url: prUrl(w), pid: w.pid },
      };
    }
    case "pr_merged":
      return {
        ...base, title: `PR #${w.pr} merged`,
        subtitle: w.pr_base ? `${w.session} · ${w.branch} → ${w.pr_base}` : where(w),
        body: "The worktree and its session can be cleaned up.", data: { open: "url", url: prUrl(w), pid: w.pid },
      };
    case "usage": {
      const registry = ctx.accounts || [];
      const name = registry.find((a) => a.id === ev.account)?.label || ev.account;
      const multi = registry.length > 1;
      const proj = Math.max(...[ev.m.projected_percent, ev.m.projected_recent].filter((v) => v != null), -1);
      const working = (ctx.windows || []).filter((x) => x.state === "working" && x.account === ev.account).length;
      return {
        ...base, target: "",
        title: multi ? `Account ${name} is running hot` : "Usage is running hot",
        subtitle: `${meterLabel(ev.meter)} usage ${Math.round(ev.m.percent ?? 0)}%`
          + (proj >= 0 ? ` · →${Math.round(proj)}% at reset` : ""),
        body: multi ? `${plural(working, "session")} working on ${name}.` : `${plural(working, "session")} working.`,
        data: { open: "usage" },
      };
    }
    default:
      return null;
  }
}
```

- [ ] **Step 4: Run it to verify it passes** (10 passed), then `npx biome check static/src/notify static/src/util.js`.

- [ ] **Step 5: Commit:** `notify: copy — each banner's title, subtitle, body and what a click opens; util.waitKind`.

---

### Task 6: `notify/burst.js`, grouping a burst

**Files:** Create `static/src/notify/burst.js`, `static/src/notify/__tests__/burst.test.js`.

- [ ] **Step 1: Write the failing test** `static/src/notify/__tests__/burst.test.js`:

```js
import { describe, expect, it } from "vitest";
import { BURST_MS, planBurst, summaryPayload } from "../burst.js";

const ev = (kind, name) => ({ kind, w: { name, waiting_for: kind === "needs_input" ? "permission prompt" : null } });

describe("planBurst", () => {
  it("sends the first two needs-you banners at once and holds the rest", () => {
    const r = planBurst([ev("needs_input", "a"), ev("question", "b"), ev("needs_input", "c"), ev("needs_input", "d")], [], 0);
    expect(r.now.map((e) => e.w.name)).toEqual(["a", "b"]);
    expect(r.held.map((e) => e.w.name)).toEqual(["c", "d"]);
    expect(r.recent).toEqual([0, 0]);
  });

  it("counts what went out earlier in the window", () => {
    expect(planBurst([ev("needs_input", "c")], [0, 100], 1000).held).toHaveLength(1);
    expect(planBurst([ev("needs_input", "c")], [0, 100], BURST_MS + 200).now).toHaveLength(1);
  });

  it("never holds other kinds, nor anything with grouping off", () => {
    expect(planBurst([ev("done", "x"), ev("ci_failed", "y")], [0, 0], 10).now).toHaveLength(2);
    expect(planBurst([ev("needs_input", "x")], [0, 0], 10, false).now).toHaveLength(1);
  });
});

describe("summaryPayload", () => {
  it("lists one line per held pane with why it waits", () => {
    const p = summaryPayload([ev("needs_input", "c"), ev("question", "d")]);
    expect(p).toMatchObject({ kind: "summary", thread: "needs_you", target: "", title: "2 more sessions need you" });
    expect(p.body).toBe("● c · permission\n● d · question");
  });
});
```

- [ ] **Step 2: Run it to verify it fails.** Run `npx vitest run static/src/notify/__tests__/burst.test.js`. Expected: FAIL, it can't resolve `../burst.js`.

- [ ] **Step 3: Implement** `static/src/notify/burst.js`:

```js
// Grouping a burst of needs-you banners (notify/feed.js runs it): the pure
// part. Leading edge: the first two inside BURST_MS go out at once, so a lone
// banner never waits; the third and later are held and folded into one summary
// sent when the window closes. Other kinds rarely burst, and macOS stacks them
// by thread.

import { paneLabel, waitKind } from "../util.js";

export const BURST_MS = 3000;
export const LEADING = 2;
const NEEDS_YOU = new Set(["needs_input", "question"]);

// -> { now, held, recent }. `recent` is the send times of needs-you banners
// still inside the window, carried to the next call.
export function planBurst(events, recent, nowMs, group = true) {
  const live = recent.filter((t) => nowMs - t < BURST_MS);
  const now = [];
  const held = [];
  for (const ev of events) {
    if (!group || !NEEDS_YOU.has(ev.kind)) now.push(ev);
    else if (live.length < LEADING) {
      now.push(ev);
      live.push(nowMs);
    } else held.push(ev);
  }
  return { now, held, recent: live };
}

const why = (ev) => (ev.kind === "question" ? "question" : waitKind(ev.w?.waiting_for) === "permission" ? "permission" : "input");

export function summaryPayload(held) {
  return {
    kind: "summary", thread: "needs_you", target: "", data: {},
    title: `${held.length} more sessions need you`, subtitle: "",
    body: held.map((ev) => `● ${ev.w ? paneLabel(ev.w) : ev.alert?.name || "a session"} · ${why(ev)}`).join("\n"),
  };
}
```

- [ ] **Step 4: Run it to verify it passes** (4 passed), then biome on `static/src/notify`.

- [ ] **Step 5: Commit:** `notify: burst — the first two needs-you banners go out at once, the rest fold into one summary`.

---

### Task 7: `notify/persist.js`, dedupe that survives a recycle

**Files:** Create `static/src/notify/persist.js`, `static/src/notify/__tests__/persist.test.js`.

- [ ] **Step 1: Write the failing test** `static/src/notify/__tests__/persist.test.js`:

```js
import { describe, expect, it } from "vitest";
import { RESUME_MS, resumeState, STORAGE_KEY, saveState } from "../persist.js";

const memory = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) };
};

describe("persist", () => {
  it("resumes a state saved within RESUME_MS", () => {
    const s = memory();
    saveState(s, { seen: { a: true } }, 1000);
    expect(resumeState(s, 1000 + RESUME_MS)).toEqual({ seen: { a: true } });
  });

  it("drops a state that's too old, from the future, missing or garbled", () => {
    const s = memory();
    saveState(s, { seen: {} }, 1000);
    expect(resumeState(s, 1001 + RESUME_MS)).toBeNull();
    expect(resumeState(s, 500)).toBeNull();
    expect(resumeState(memory(), 1000)).toBeNull();
    const bad = memory();
    bad.setItem(STORAGE_KEY, "{not json");
    expect(resumeState(bad, 1000)).toBeNull();
  });

  it("survives storage that throws or isn't there", () => {
    const broken = { getItem: () => { throw new Error("denied"); }, setItem: () => { throw new Error("quota"); } };
    expect(() => saveState(broken, {}, 1)).not.toThrow();
    expect(resumeState(broken, 1)).toBeNull();
    expect(resumeState(null, 1)).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails.** Run `npx vitest run static/src/notify/__tests__/persist.test.js`. Expected: FAIL, the module is missing.

- [ ] **Step 3: Implement** `static/src/notify/persist.js`:

```js
// The notify feed's dedupe state across reloads and webview recycles.
// recycle.rs rebuilds the webview once you've been idle a while, which is
// exactly when banners matter; a fresh sentinel would swallow whatever arrived
// across the rebuild. So the state is saved after every pass and resumed when
// young enough. Older than RESUME_MS (a reload after a long absence), it's
// dropped and the feed reseeds, so old news never replays.

export const STORAGE_KEY = "periscope.notify.v1";
export const RESUME_MS = 15 * 60 * 1000;

export function resumeState(storage, nowMs) {
  try {
    const saved = JSON.parse(storage?.getItem(STORAGE_KEY) || "null");
    if (!saved?.state || !(saved.at <= nowMs) || nowMs - saved.at > RESUME_MS) return null;
    return saved.state;
  } catch {
    return null;
  }
}

export function saveState(storage, state, nowMs) {
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify({ at: nowMs, state }));
  } catch {
    // Private mode or a full quota: the next boot just reseeds.
  }
}
```

- [ ] **Step 4: Run it to verify it passes** (3 passed), then biome.

- [ ] **Step 5: Commit:** `notify: persist — the dedupe state is saved each pass and resumed within 15 min, so a webview recycle neither swallows nor replays banners`.

---

### Task 8: The notify prefs on the client

**Files:** Modify `static/src/prefs.js`. Test: `static/src/__tests__/prefs.test.js`.

- [ ] **Step 1: Write the failing tests.** Apply:

```diff
diff --git a/static/src/__tests__/prefs.test.js b/static/src/__tests__/prefs.test.js
index 5df60a5..d757aa4 100644
--- a/static/src/__tests__/prefs.test.js
+++ b/static/src/__tests__/prefs.test.js
@@ -68,3 +68,18 @@ describe("noteClawdDay", () => {
     expect(prefs.getClawdDay().merged).toBe("2026-10-21T11:00");
   });
 });
+
+describe("notify prefs", () => {
+  it("defaults every toggle on", () => {
+    expect(prefs.getNotifyPrefs()).toEqual(prefs.NOTIFY_DEFAULTS);
+    expect(Object.values(prefs.NOTIFY_DEFAULTS).every(Boolean)).toBe(true);
+  });
+
+  it("writes the whole set, so the server's top-level merge keeps the others", async () => {
+    await prefs.setNotifyPref("done", false);
+    const sent = JSON.parse(apiCall.mock.calls.at(-1)[2].body);
+    expect(sent.notify).toEqual({ ...prefs.NOTIFY_DEFAULTS, done: false });
+    await prefs.setNotifyPref("usage", false);
+    expect(prefs.getNotifyPrefs()).toMatchObject({ done: false, usage: false, ci_failed: true });
+  });
+});
```

- [ ] **Step 2: Run them to verify they fail.** Run `npx vitest run static/src/__tests__/prefs.test.js`. Expected: FAIL, `getNotifyPrefs` and `setNotifyPref` don't exist.

- [ ] **Step 3: Implement.** Apply:

```diff
diff --git a/static/src/prefs.js b/static/src/prefs.js
index 18e1714..a1400e3 100644
--- a/static/src/prefs.js
+++ b/static/src/prefs.js
@@ -338,6 +338,23 @@ export function setTamaCritter(id) {
 }
 
 
+// Settings → Notifications: which native banners fire (notify/feed.js). Every
+// toggle defaults on; the whole set is written each time, because update_ui
+// merges only top-level keys.
+export const NOTIFY_DEFAULTS = {
+  needs_input: true, done: true, ci_failed: true, pr_merged: true, usage: true,
+  quiet_when_focused: true, group: true, badge: true,
+};
+
+export function getNotifyPrefs() {
+  return { ...NOTIFY_DEFAULTS, ...(P().ui?.notify || {}) };
+}
+
+export function setNotifyPref(key, on) {
+  return patchUI({ notify: { ...getNotifyPrefs(), [key]: on } });
+}
+
+
 export function getPinnedPids() {
   return [...(P().ui?.pinned_pids || [])];
 }
```

- [ ] **Step 4: Run them to verify they pass** (6 passed), then biome on both files.

- [ ] **Step 5: Commit:** `prefs: getNotifyPrefs / setNotifyPref — every toggle on by default, the whole set written each time`.

---

### Task 9: The usage pill opens from code

A usage banner's click opens the pill to every meter.

**Files:** Modify `static/src/chrome/UsagePill.jsx`. Test: `static/src/chrome/__tests__/usagePillRender.test.jsx`.

- [ ] **Step 1: Write the failing test.** Apply:

```diff
diff --git a/static/src/chrome/__tests__/usagePillRender.test.jsx b/static/src/chrome/__tests__/usagePillRender.test.jsx
index 642a5bd..ec92b59 100644
--- a/static/src/chrome/__tests__/usagePillRender.test.jsx
+++ b/static/src/chrome/__tests__/usagePillRender.test.jsx
@@ -7,7 +7,7 @@
 import render from "preact-render-to-string";
 import { afterEach, beforeEach, describe, expect, it } from "vitest";
 import { accounts, usage } from "../../store.js";
-import { UsagePill } from "../UsagePill.jsx";
+import { openUsageDetails, UsagePill, usageExpanded } from "../UsagePill.jsx";
 
 const NOW = () => Math.floor(Date.now() / 1000);
 
@@ -24,6 +24,7 @@ beforeEach(() => {
 afterEach(() => {
   usage.value = null;
   accounts.value = [];
+  usageExpanded.value = false;
 });
 
 describe("<UsagePill>", () => {
@@ -169,3 +170,12 @@ describe("<UsagePill>", () => {
     expect(html).toContain("on pace for 18% at reset");
   });
 });
+
+describe("openUsageDetails", () => {
+  it("opens the pill to every meter, as a click does (a usage notification's click)", () => {
+    usage.value = { plan: { default: { available: true, fetched_at: NOW(), meters: meters({ session: 10, week_all: 20 }) } }, fallback: null, poke: {} };
+    expect(render(<UsagePill />)).not.toContain("is-expanded");
+    openUsageDetails();
+    expect(render(<UsagePill />)).toContain("is-expanded");
+  });
+});
```

- [ ] **Step 2: Run it to verify it fails.** Run `npx vitest run static/src/chrome/__tests__/usagePillRender.test.jsx`. Expected: FAIL, `openUsageDetails` and `usageExpanded` aren't exported.

- [ ] **Step 3: Implement.** Apply:

```diff
diff --git a/static/src/chrome/UsagePill.jsx b/static/src/chrome/UsagePill.jsx
index 2e83bf1..a806e82 100644
--- a/static/src/chrome/UsagePill.jsx
+++ b/static/src/chrome/UsagePill.jsx
@@ -16,7 +16,7 @@
 // launcher's picker, showing only that account's BINDING meter (highest
 // percent) with the existing ok/warn/danger tone. A pinned red bar next to a
 // near-empty one reads at a glance. Click expands to every meter per account.
-import { useState } from "preact/hooks";
+import { signal } from "@preact/signals";
 import { multiAccount } from "../accounts.js";
 import { usage } from "../store.js";
 import { relTime } from "../util.js";
@@ -123,6 +123,14 @@ function MeterBar({ label, m, resets, pace }) {
 // Collapsing to the binding meter hides the rest from sight, not from reach.
 // Carried on the row rather than the pill because each MeterBar's own title
 // wins on hover — the row's only reliably-hoverable area is its letter.
+// Every meter shown, or each account's headline only. A module signal so a
+// usage notification's click can open it (notify/feed.js).
+export const usageExpanded = signal(false);
+
+export function openUsageDetails() {
+  usageExpanded.value = true;
+}
+
 function acctTitle(a, expanded, poke, waste) {
   const lines = a.meters.map(({ m }) =>
     [`${m.label}: ${m.percent}% used`, fmtReset(m.resets_at), ...paceLines(m)]
@@ -149,7 +157,7 @@ function acctTitle(a, expanded, poke, waste) {
 export function UsagePill() {
   // Expansion is view-only and deliberately unpersisted: the collapsed answer
   // is the one worth having on every load.
-  const [expanded, setExpanded] = useState(false);
+  const expanded = usageExpanded.value;
   const u = usage.value || {};
   const fallback = u.fallback;
   const nowSec = Math.floor(Date.now() / 1000);
@@ -167,7 +175,7 @@ export function UsagePill() {
       <div
         id="usage"
         class={`usage${expanded ? " is-expanded" : ""}`}
-        onClick={() => setExpanded((v) => !v)}
+        onClick={() => { usageExpanded.value = !expanded; }}
       >
         {accounts.map((a) => (
           <div
```

- [ ] **Step 4: Run it to verify it passes** (11 passed), then biome.

- [ ] **Step 5: Commit:** `usage pill: expanded is a module signal with openUsageDetails(), so a usage banner's click can open it`.

---

### Task 10: The `tauri.js` bridge carries the whole payload and the new click event

`notify` now forwards every field, and an older shell ignores what it doesn't know. `onNotificationOpened` listens for `periscope:notification-opened`, which only a newer shell emits. There's no unit test, because both functions are no-ops outside Tauri and the feed test (Task 11) mocks them. Task 14 checks them by hand.

**Files:** Modify `static/src/tauri.js`.

- [ ] **Step 1: Implement.** Apply:

```diff
diff --git a/static/src/tauri.js b/static/src/tauri.js
index 0faec7c..ec22bd7 100644
--- a/static/src/tauri.js
+++ b/static/src/tauri.js
@@ -42,13 +42,15 @@ export async function setBadgeCount(n) {
 
 // Emit a banner to the Rust side, which owns UNUserNotificationCenter
 // (delegate, authorization, click routing). `target` is the pane the
-// banner is about — Rust stashes it so a click can route back here.
-export async function notify({ title, body, target }) {
+// banner is about — Rust stashes it so a click can route back here. The
+// rest (kind, subtitle, thread, data, quiet_when_focused) is for shells that
+// know it; an older shell reads title/body/target and ignores the rest.
+export async function notify({ title, body, target = "", ...rest }) {
   if (!inTauri()) return;
   try {
     await invoke("plugin:event|emit", {
       event: "periscope:notify",
-      payload: { title, body, target },
+      payload: { title, body, target, ...rest },
     });
   } catch (e) {
     console.warn("[tauri] notify failed:", e);
@@ -75,6 +77,26 @@ export async function onNotificationClick(cb) {
   }
 }
 
+// Register a handler for clicks on banners that carry a kind: a shell that
+// knows kinds sends { target, kind, data } here instead of the plain target
+// onNotificationClick gets, so a click can open a PR or the usage pill, not
+// just a pane.
+export async function onNotificationOpened(cb) {
+  if (!inTauri()) return;
+  try {
+    const handler = window.__TAURI_INTERNALS__.transformCallback((e) => {
+      if (e?.payload) cb(e.payload);
+    });
+    await invoke("plugin:event|listen", {
+      event: "periscope:notification-opened",
+      target: { kind: "Any" },
+      handler,
+    });
+  } catch (e) {
+    console.warn("[tauri] notification-opened listener failed:", e);
+  }
+}
+
 // Open a URL in the user's OS browser, regardless of host.
 //
 // Returns true on a path that should reach the user's browser, false if
```

- [ ] **Step 2: Check.** Run `npx biome check static/src/tauri.js` and `npx vitest run` (no regressions).

- [ ] **Step 3: Commit:** `tauri: notify forwards the whole banner (kind, subtitle, thread, data, quiet); onNotificationOpened for kinded clicks`.

---

### Task 11: `notify/feed.js` wires it up

`alertFeed.js` gives up the banner and the badge, and `Split.jsx` starts the feed.

**Files:** Create `static/src/notify/feed.js`, `static/src/notify/__tests__/feed.test.js`. Modify `static/src/split/alertFeed.js`, `static/src/split/Split.jsx`.

- [ ] **Step 1: Write the failing test** `static/src/notify/__tests__/feed.test.js`:

```js
// The feed's click routing and toggles. The detection, copy and grouping it
// strings together are covered in their own tests; the effect itself needs
// the Tauri shell and is checked by hand (see the plan's manual checklist).
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../tauri.js", () => ({
  inTauri: () => false, notify: vi.fn(), onNotificationClick: vi.fn(), onNotificationOpened: vi.fn(),
  openExternal: vi.fn(), setBadgeCount: vi.fn(),
}));
const tauri = await import("../../tauri.js");
const { railSelection, windows } = await import("../../store.js");
const { usageExpanded } = await import("../../chrome/UsagePill.jsx");
const { enabled, openFromBanner, startNotifyFeed } = await import("../feed.js");

afterEach(() => {
  windows.value = [];
  railSelection.value = null;
  usageExpanded.value = false;
  vi.clearAllMocks();
});

describe("openFromBanner", () => {
  it("opens a PR banner's link in the browser", () => {
    openFromBanner({ target: "s:1", data: { open: "url", url: "https://github.com/o/r/pull/7" } });
    expect(tauri.openExternal).toHaveBeenCalledWith("https://github.com/o/r/pull/7");
  });

  it("opens the usage pill for a usage banner", () => {
    openFromBanner({ target: "", data: { open: "usage" } });
    expect(usageExpanded.value).toBe(true);
  });

  it("selects the pane by pid, even after tmux renumbered it", () => {
    windows.value = [{ pid: "p1", target: "s:4" }];
    openFromBanner({ target: "s:1", data: { open: "pane", pid: "p1" } });
    expect(railSelection.value).toBe("pane:p1");
  });

  it("falls back to the target when the pid is gone, and to nothing when both are", () => {
    windows.value = [{ pid: "p2", target: "s:1" }];
    openFromBanner({ target: "s:1", data: { open: "pane", pid: "gone" } });
    expect(railSelection.value).toBe("pane:p2");
    railSelection.value = null;
    openFromBanner({ target: "x:9", data: {} });
    expect(railSelection.value).toBeNull();
  });
});

describe("enabled", () => {
  it("follows each kind's toggle; a question follows needs-input's", () => {
    const prefs = { needs_input: false, done: true };
    expect(enabled(prefs, "question")).toBe(false);
    expect(enabled(prefs, "needs_input")).toBe(false);
    expect(enabled(prefs, "done")).toBe(true);
  });
});

describe("startNotifyFeed", () => {
  it("does nothing in a plain browser tab", () => {
    startNotifyFeed();
    expect(tauri.onNotificationOpened).not.toHaveBeenCalled();
    expect(tauri.setBadgeCount).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it to verify it fails.** Run `npx vitest run static/src/notify/__tests__/feed.test.js`. Expected: FAIL, the module is missing.

- [ ] **Step 3: Implement.** Create `static/src/notify/feed.js`:

```js
// Native macOS notifications, in the Tauri shell only. The feed watches the
// pushed state, decides what's news (detect.js), words it (copy.js), groups a
// burst (burst.js) and sends it through tauri.js. It also owns the dock badge.
// Non-component, like split/alertFeed.js: it runs whatever is rendered.
// Started once from Split.jsx.

import { effect } from "@preact/signals";
import { openUsageDetails } from "../chrome/UsagePill.jsx";
import { getNotifyPrefs } from "../prefs.js";
import { revealPane, selectPane } from "../split/alertFeed.js";
import { waitingPanes } from "../split/attention.js";
import { accounts, alerts, dismissedAlertIds, dismissedNeedsPids, dismissedReadyPids, usage, windows } from "../store.js";
import { inTauri, notify, onNotificationOpened, openExternal, setBadgeCount } from "../tauri.js";
import { BURST_MS, planBurst, summaryPayload } from "./burst.js";
import { payloadFor } from "./copy.js";
import { detect } from "./detect.js";
import { resumeState, saveState } from "./persist.js";

// A kind's toggle in Settings → Notifications; a question rides on needs-input's.
const TOGGLE = { question: "needs_input" };
export const enabled = (prefs, kind) => prefs[TOGGLE[kind] || kind] !== false;

// A click on a banner that carries a kind (notifications.rs emits
// periscope:notification-opened). An older shell sends only the pane target,
// to alertFeed's onNotificationClick listener, which reveals it.
export function openFromBanner({ target, data = {} } = {}) {
  if (data.open === "url" && data.url) {
    openExternal(data.url);
    return;
  }
  if (data.open === "usage") {
    openUsageDetails();
    return;
  }
  // By pid first: tmux renumbers windows, so a target can name a neighbour by now.
  const w = data.pid != null && (windows.value || []).find((x) => String(x.pid) === String(data.pid));
  if (w) selectPane(w);
  else revealPane(target);
}

let started = false;

export function startNotifyFeed() {
  if (started || !inTauri()) return;
  started = true;
  const storage = typeof localStorage === "undefined" ? null : localStorage;
  let state = resumeState(storage, Date.now());
  let recent = [];
  let held = [];
  let timer = null;

  const send = (payload) => notify({ ...payload, quiet_when_focused: getNotifyPrefs().quiet_when_focused });
  const flush = () => {
    timer = null;
    const batch = held;
    held = [];
    if (batch.length) send(summaryPayload(batch));
  };

  onNotificationOpened(openFromBanner);
  effect(() => {
    const list = alerts.value;
    // null until the first /api/state: unknown, not empty. Seeding from it would
    // announce every waiting pane as new on the first real poll.
    if (list === null) return;
    const prefs = getNotifyPrefs();
    const snap = {
      windows: windows.value || [], alerts: list, dismissedAlertIds: dismissedAlertIds.value,
      dismissedNeedsPids: dismissedNeedsPids.value, dismissedReadyPids: dismissedReadyPids.value,
      plan: usage.value?.plan || {},
    };
    const nowMs = Date.now();
    const r = detect(state, snap, nowMs / 1000);
    state = r.state;
    saveState(storage, state, nowMs);
    // Toggles apply at send time: an event skipped while its kind was off is
    // still recorded, so turning the kind back on doesn't replay it.
    const plan = planBurst(r.events.filter((e) => enabled(prefs, e.kind)), recent, nowMs, prefs.group);
    recent = plan.recent;
    const ctx = { accounts: accounts.value, windows: snap.windows };
    for (const ev of plan.now) {
      const p = payloadFor(ev, ctx);
      if (p) send(p);
    }
    if (plan.held.length) {
      held.push(...plan.held);
      if (!timer) timer = setTimeout(flush, BURST_MS);
    }
    // Panes waiting on you, as the rail counts them, not alert rows.
    const waiting = waitingPanes(snap.windows, list, snap.dismissedAlertIds, snap.dismissedNeedsPids, nowMs / 1000);
    setBadgeCount(prefs.badge ? waiting.size : 0);
  });
}
```

Apply to `alertFeed.js` and `Split.jsx`. The `Split.jsx` hunk also re-sorts two existing imports into Biome's order, which clears that file's pre-existing `organizeImports` note:

```diff
diff --git a/static/src/split/alertFeed.js b/static/src/split/alertFeed.js
index 70f113e..f08e01f 100644
--- a/static/src/split/alertFeed.js
+++ b/static/src/split/alertFeed.js
@@ -1,21 +1,18 @@
-// The cross-pane alert feed: owns the native-notify/dock-badge side effects
-// and exposes `alertItems` as the read model. The list itself arrives on the
+// The cross-pane alert feed: exposes `alertItems` as the read model and the
+// row behaviours the rail and Clawd share. The list itself arrives on the
 // pushed /api/state blob (store.alerts) rather than a poll of its own, so it
 // shares the state hub's transport and its notify()-driven kick — an alert
-// lands as soon as the tool call that raised it returns. Non-component
-// (mirrors poll.js → windows) so the badge stays fresh and native-notify
-// fires regardless of what's rendered. Started once from Split.jsx.
-import { effect } from "@preact/signals";
+// lands as soon as the tool call that raised it returns. Native banners and
+// the dock badge are notify/feed.js's. Started once from Split.jsx.
 import * as prefs from "../prefs.js";
 import { alerts, dismissedNeedsPids, dismissedReadyPids, railSelection, windows } from "../store.js";
-import { inTauri, notify, onNotificationClick, setBadgeCount } from "../tauri.js";
+import { onNotificationClick } from "../tauri.js";
 import { isSoftQuestion } from "./attention.js";
 
 // The pushed feed IS the read model — re-exported so consumers keep importing
 // alerts from the module that owns their semantics.
 export const alertItems = alerts;
 
-let seenAlertKeys = null;       // first-load sentinel — see maybeNativeNotify
 let started = false;
 
 // Reveal a pane from an alert/native-notification click via inline rail
@@ -48,35 +45,10 @@ export function openReadyPane(w) {
   selectPane(w);
 }
 
-function maybeNativeNotify(list) {
-  if (!inTauri()) return;
-  const needHuman = list.filter((r) => r.kind === "need_human");
-  if (seenAlertKeys === null) {
-    seenAlertKeys = new Set(needHuman.map((r) => r.id));
-    return;
-  }
-  for (const r of needHuman) {
-    if (seenAlertKeys.has(r.id)) continue;
-    seenAlertKeys.add(r.id);
-    const paneLabel = `${r.session} · ${r.name || `:${r.index}`}`;
-    notify({ title: `⚠ ${paneLabel}`, body: r.message || "", target: r.target });
-  }
-  const current = new Set(needHuman.map((r) => r.id));
-  for (const k of seenAlertKeys) if (!current.has(k)) seenAlertKeys.delete(k);
-}
-
 export function startAlertFeed() {
   if (started) return;
   started = true;
+  // An older shell's banner click carries only the pane target (a newer one
+  // sends kinds to notify/feed.js instead).
   onNotificationClick((target) => revealPane(target));
-  // Side effects only — the list is written by poll.js. `null` is the
-  // not-yet-loaded value: skipping it keeps the sentinel below honest, and
-  // transport failure is already surfaced by poll.js's connection banner, so
-  // the stale list simply stays on screen.
-  effect(() => {
-    const list = alerts.value;
-    if (list === null) return;
-    maybeNativeNotify(list);
-    setBadgeCount(list.filter((r) => r.kind === "need_human").length);
-  });
 }
```

```diff
diff --git a/static/src/split/Split.jsx b/static/src/split/Split.jsx
index a121a53..9d9e851 100644
--- a/static/src/split/Split.jsx
+++ b/static/src/split/Split.jsx
@@ -2,19 +2,21 @@
 // <Detail> (right). This is the only view (grid retired).
 import { computed, effect } from "@preact/signals";
 import { useEffect, useRef } from "preact/hooks";
-import { getPaneWidth } from "../prefs.js";
+import { startNotifyFeed } from "../notify/feed.js";
 import { startPolling } from "../poll.js";
+import { getPaneWidth } from "../prefs.js";
 import { startAlertFeed } from "./alertFeed.js";
 import { Detail } from "./Detail.jsx";
-import { PANE_WIDTHS, storedWidth } from "./paneResize.js";
 import { railHidden, sideHidden } from "./panels.js";
+import { PANE_WIDTHS, storedWidth } from "./paneResize.js";
 import { Rail } from "./Rail.jsx";
 import { ResizeHandle } from "./ResizeHandle.jsx";
 
 export function Split() {
   // Own the single /api/state poll loop that feeds the `windows` signal — the
-  // Rail + Detail render off it. startAlertFeed similarly owns the alert poll.
-  useEffect(() => { startPolling(); startAlertFeed(); }, []);
+  // Rail + Detail render off it. startNotifyFeed turns it into native banners
+  // and the dock badge; startAlertFeed takes an older shell's banner clicks.
+  useEffect(() => { startPolling(); startAlertFeed(); startNotifyFeed(); }, []);
 
   useEffect(() => {
     // Mirror the view onto the body attribute (legacy CSS still keys some
```

- [ ] **Step 4: Run it to verify it passes.** Run `npx vitest run static/src/notify static/src/split` (all green), then `npx biome check static/src/notify static/src/split/alertFeed.js static/src/split/Split.jsx`.

- [ ] **Step 5: Commit:** `notify: the feed — banners from the pushed state (toggles, grouping, quiet-when-focused), the dock badge from waitingPanes, clicks routed by kind; alertFeed keeps only the legacy click`.

---

### Task 12: Settings → Notifications

**Files:** Create `static/src/overlays/NotifySettings.jsx`, `static/src/overlays/__tests__/notifySettingsRender.test.jsx`. Modify `static/src/overlays/SettingsModal.jsx`, `static/styles.css`.

- [ ] **Step 1: Write the failing test** `static/src/overlays/__tests__/notifySettingsRender.test.jsx`:

```jsx
// The Notifications fieldset must show each saved toggle, or a reopened
// Settings modal lies about which banners fire.

import render from "preact-render-to-string";
import { afterEach, describe, expect, it } from "vitest";
import { prefsSignal } from "../../prefs.js";
import { NOTIFY_OPTIONS, NotifySettings } from "../NotifySettings.jsx";

const withUI = (ui) => { prefsSignal.value = { ...prefsSignal.value, loaded: true, ui }; };
const checked = (html) => [...html.matchAll(/<input[^>]*name="notify-(\w+)"[^>]*checked/g)].map((m) => m[1]);

describe("<NotifySettings>", () => {
  afterEach(() => withUI({}));

  it("offers one checkbox per toggle, all on by default", () => {
    withUI({});
    const html = render(<NotifySettings />);
    expect(html.match(/type="checkbox"/g)).toHaveLength(NOTIFY_OPTIONS.length);
    expect(checked(html)).toEqual(NOTIFY_OPTIONS.map(([key]) => key));
  });

  it("shows a toggle turned off as unchecked", () => {
    withUI({ notify: { done: false, badge: false } });
    expect(checked(render(<NotifySettings />))).not.toContain("done");
    expect(checked(render(<NotifySettings />))).not.toContain("badge");
  });

  it("says the banners come from the macOS app, in a browser tab", () => {
    expect(render(<NotifySettings />)).toContain("Periscope macOS app only");
  });
});
```

- [ ] **Step 2: Run it to verify it fails.** Run `npx vitest run static/src/overlays/__tests__/notifySettingsRender.test.jsx`. Expected: FAIL, the module is missing.

- [ ] **Step 3: Implement.** Create `static/src/overlays/NotifySettings.jsx`:

```jsx
// Settings → Notifications: which native macOS banners fire (notify/feed.js).
// Each toggle saves on change, like the Tamagotchi picker. The banners come
// from the Periscope app only, so a browser tab says so instead of offering
// switches that would do nothing visible there.
import { getNotifyPrefs, setNotifyPref } from "../prefs.js";
import { inTauri } from "../tauri.js";

export const NOTIFY_OPTIONS = [
  ["needs_input", "A session needs input"],
  ["done", "A session finishes"],
  ["ci_failed", "CI fails on a session's PR"],
  ["pr_merged", "A linked PR merges"],
  ["usage", "Usage projected past a limit"],
  ["quiet_when_focused", "Stay quiet while the dashboard is focused"],
  ["group", "Group when more than 2 arrive at once"],
  ["badge", "Dock badge counts sessions waiting on you"],
];

export function NotifySettings() {
  const prefs = getNotifyPrefs();
  return (
    <fieldset class="notify-settings">
      <legend>Notifications</legend>
      {!inTauri() && <p class="settings-overrides-hint">Notifications appear in the Periscope macOS app only.</p>}
      {NOTIFY_OPTIONS.map(([key, label]) => (
        <label key={key} class="notify-option">
          <input type="checkbox" name={`notify-${key}`} checked={prefs[key]}
                 onChange={(e) => setNotifyPref(key, e.currentTarget.checked)} />
          {label}
        </label>
      ))}
    </fieldset>
  );
}
```

and apply:

```diff
diff --git a/static/src/overlays/SettingsModal.jsx b/static/src/overlays/SettingsModal.jsx
index c5445e7..617838d 100644
--- a/static/src/overlays/SettingsModal.jsx
+++ b/static/src/overlays/SettingsModal.jsx
@@ -12,6 +12,7 @@ import { useEffect, useState } from "preact/hooks";
 import { useEscape } from "../hooks/useEscape.js";
 import { track } from "../track.js";
 import { modalRequest } from "./modalRequest.js";
+import { NotifySettings } from "./NotifySettings.jsx";
 import { TamaPicker } from "./TamaPicker.jsx";
 
 const open = signal(false);
@@ -106,6 +107,7 @@ export function SettingsModal() {
         </header>
         <form id="settings-form" onSubmit={handleSubmit}>
           <TamaPicker />
+          <NotifySettings />
           <label>
             Cleanup idle threshold (days)
             <input
```

```diff
diff --git a/static/styles.css b/static/styles.css
index 4cc556c..4b258c8 100644
--- a/static/styles.css
+++ b/static/styles.css
@@ -2054,6 +2054,11 @@ body.modal-open { overflow: hidden; }
 .critter-preview { display: block; }
 /* Clawd's blink in the preview needs the fill-box that `.tama g` gives it in the header. */
 .critter-preview g, .critter-preview rect { transform-box: fill-box; }
+/* Settings → Notifications (overlays/NotifySettings.jsx): a checkbox per
+   banner, inline with its label. ID-qualified to outrank #settings-form
+   label / input, which would make every checkbox a full-width block. */
+#settings-form .notify-option { display: flex; align-items: center; gap: 6px; margin-bottom: 0.35em; }
+#settings-form .notify-option input { display: inline-block; width: auto; margin: 0; }
 
 .settings-overrides-empty {
   font-size: 0.85em;
```

- [ ] **Step 4: Run it to verify it passes** (3 passed; the overlays suite 37), then biome on the new and modified JSX.

- [ ] **Step 5: Commit:** `settings: Notifications — a checkbox per banner kind and behaviour, saved on change; outside the app it says the banners are the app's`.

---

### Task 13: The Rust shell

The shell gains:
- subtitle, thread and userInfo on each banner;
- the `notification-opened` click event for kinded banners;
- quiet-while-focused presentation.

**Files:** Modify `src-tauri/src/notifications.rs`, `src-tauri/src/main.rs`.

- [ ] **Step 1: Write the failing tests.** The `#[cfg(test)] mod tests` block at the end of the new `notifications.rs` below. Because the tests exercise the new functions, write the whole file and treat the first `cargo test` as the check.

- [ ] **Step 2: Implement.** Replace `src-tauri/src/notifications.rs` with:

```rust
// Native macOS notifications via UNUserNotificationCenter (objc2).
//
// tauri-plugin-notification can't do this job: its desktop backend
// (notify-rust) is fire-and-forget — no click callback on macOS.
// UNUserNotificationCenter is event-driven: a delegate's
// didReceiveNotificationResponse fires when the user clicks a banner.
//
// The pane target rides in the notification's identifier
// ("periscope-route|{seq}|{target}") and is recovered there. The webview
// is a remote origin (localhost:17374) and can't invoke Rust commands, so
// both directions cross the Tauri event bus — the IPC surface core:default
// already grants it: "periscope:notify" carries a banner in,
// "periscope:notification-clicked" carries a click back out.
//
// The webview's JS comes from the server and this shell from an installed
// .app, so either can be the older one. Everything past title/body/target
// is optional: an older webview's banner parses, and its click still goes
// out as the plain target on "periscope:notification-clicked". A banner that
// carries a `kind` keeps it (and what a click opens) in userInfo, and its
// click goes out as { target, kind, data } on
// "periscope:notification-opened", which an older webview never listens to.

use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};

use block2::{DynBlock, RcBlock};
use objc2::rc::{autoreleasepool, Retained};
use objc2::runtime::{Bool, ProtocolObject};
use objc2::{define_class, msg_send, AnyThread, DefinedClass};
use objc2_foundation::{NSDictionary, NSError, NSObject, NSObjectProtocol, NSString};
use objc2_user_notifications::{
    UNAuthorizationOptions, UNMutableNotificationContent, UNNotification, UNNotificationContent,
    UNNotificationDefaultActionIdentifier, UNNotificationPresentationOptions,
    UNNotificationRequest, UNNotificationResponse, UNUserNotificationCenter,
    UNUserNotificationCenterDelegate,
};
use tauri::{AppHandle, Emitter, Listener};

/// Webview → Rust: post this banner.
const NOTIFY_EVENT: &str = "periscope:notify";
/// Rust → webview: the pane behind this banner was clicked (a banner without a kind).
const CLICK_EVENT: &str = "periscope:notification-clicked";
/// Rust → webview: a banner with a kind was clicked: { target, kind, data }.
const OPENED_EVENT: &str = "periscope:notification-opened";
/// Notification identifier shape. The seq keeps ids unique (a reused id
/// silently replaces the prior banner); the pane target is the tail,
/// recovered verbatim on click — `split_once` keeps any '|' inside it.
const ID_PREFIX: &str = "periscope-route|";
/// The userInfo key holding a kinded banner's `Info`, as JSON.
const INFO_KEY: &str = "periscope";

static SEQ: AtomicUsize = AtomicUsize::new(0);

/// Whether the dashboard window has focus, kept by main.rs's window events.
/// will_present reads this rather than asking the window: it runs on the main
/// thread, where a synchronous window query can deadlock.
static FOCUSED: AtomicBool = AtomicBool::new(false);

pub fn set_focused(focused: bool) {
    FOCUSED.store(focused, Ordering::Relaxed);
}

#[derive(serde::Deserialize, Debug)]
struct NotifyRequest {
    title: String,
    body: String,
    #[serde(default)]
    target: String,
    #[serde(default)]
    kind: String,
    #[serde(default)]
    subtitle: String,
    #[serde(default)]
    thread: String,
    #[serde(default)]
    data: serde_json::Value,
    #[serde(default)]
    quiet_when_focused: bool,
}

/// What a kinded banner keeps in userInfo, for its click and its presentation.
#[derive(serde::Serialize, serde::Deserialize, Debug, PartialEq)]
struct Info {
    target: String,
    kind: String,
    #[serde(default)]
    data: serde_json::Value,
    #[serde(default)]
    quiet_when_focused: bool,
}

fn parse_request(payload: &str) -> Result<NotifyRequest, serde_json::Error> {
    serde_json::from_str(payload)
}

fn info_json(req: &NotifyRequest) -> String {
    serde_json::to_string(&Info {
        target: req.target.clone(),
        kind: req.kind.clone(),
        data: req.data.clone(),
        quiet_when_focused: req.quiet_when_focused,
    })
    .unwrap_or_default()
}

fn parse_info(json: &str) -> Option<Info> {
    serde_json::from_str::<Info>(json).ok().filter(|i| !i.kind.is_empty())
}

/// Banner and sound, unless the banner asked to stay quiet while the dashboard
/// is focused and it is. A quieted banner still lands in Notification Center.
fn should_present(quiet_when_focused: bool, focused: bool) -> bool {
    !(quiet_when_focused && focused)
}

fn info_of(content: &UNNotificationContent) -> Option<Info> {
    let value = content.userInfo().objectForKey(&NSString::from_str(INFO_KEY))?;
    parse_info(&value.downcast::<NSString>().ok()?.to_string())
}

struct Ivars {
    app: AppHandle,
}

define_class!(
    #[unsafe(super(NSObject))]
    #[name = "PeriscopeUNDelegate"]
    #[ivars = Ivars]
    struct Delegate;

    unsafe impl NSObjectProtocol for Delegate {}

    unsafe impl UNUserNotificationCenterDelegate for Delegate {
        // Fired when the user clicks (or actions) a delivered notification.
        #[unsafe(method(userNotificationCenter:didReceiveNotificationResponse:withCompletionHandler:))]
        fn did_receive(
            &self,
            _center: &UNUserNotificationCenter,
            response: &UNNotificationResponse,
            completion_handler: &DynBlock<dyn Fn()>,
        ) {
            let request = response.notification().request();
            if let Some(info) = info_of(&request.content()) {
                let default = unsafe { UNNotificationDefaultActionIdentifier };
                if response.actionIdentifier().isEqualToString(default) {
                    let _ = self.ivars().app.emit(
                        OPENED_EVENT,
                        serde_json::json!({ "target": info.target, "kind": info.kind, "data": info.data }),
                    );
                }
            } else {
                let id = request.identifier().to_string();
                if let Some(target) = id
                    .strip_prefix(ID_PREFIX)
                    .and_then(|rest| rest.split_once('|'))
                    .map(|(_seq, target)| target)
                {
                    let _ = self.ivars().app.emit(CLICK_EVENT, target);
                }
            }
            completion_handler.call(());
        }

        // Fired when a notification arrives while Periscope is frontmost.
        // Present it explicitly, else macOS swallows the banner.
        #[unsafe(method(userNotificationCenter:willPresentNotification:withCompletionHandler:))]
        fn will_present(
            &self,
            _center: &UNUserNotificationCenter,
            notification: &UNNotification,
            completion_handler: &DynBlock<dyn Fn(UNNotificationPresentationOptions)>,
        ) {
            let quiet = info_of(&notification.request().content()).is_some_and(|i| i.quiet_when_focused);
            let options = if should_present(quiet, FOCUSED.load(Ordering::Relaxed)) {
                UNNotificationPresentationOptions::Banner | UNNotificationPresentationOptions::Sound
            } else {
                UNNotificationPresentationOptions::empty()
            };
            completion_handler.call((options,));
        }
    }
);

impl Delegate {
    fn new(app: AppHandle) -> Retained<Self> {
        let this = Self::alloc().set_ivars(Ivars { app });
        unsafe { msg_send![super(this), init] }
    }
}

/// Install the notification delegate, request authorization, and start
/// listening for banner requests from the webview. Call once, from the
/// Tauri `setup` hook of the bundled app — UNUserNotificationCenter throws
/// if used from a non-bundled binary.
pub fn init(app: &AppHandle) {
    let center = UNUserNotificationCenter::currentNotificationCenter();

    let delegate = Delegate::new(app.clone());
    center.setDelegate(Some(ProtocolObject::from_ref(&*delegate)));
    // setDelegate keeps only a weak reference — leak our single delegate
    // so it lives for the app's lifetime and keeps receiving clicks.
    std::mem::forget(delegate);

    let auth = RcBlock::new(|granted: Bool, _err: *mut NSError| {
        if !granted.as_bool() {
            eprintln!("periscope: notification permission not granted");
        }
    });
    center.requestAuthorizationWithOptions_completionHandler(
        UNAuthorizationOptions::Alert | UNAuthorizationOptions::Sound,
        &auth,
    );

    app.listen(NOTIFY_EVENT, |event| match parse_request(event.payload()) {
        Ok(req) => send(&req),
        Err(e) => eprintln!("periscope: bad notify payload: {e}"),
    });
}

fn send(req: &NotifyRequest) {
    autoreleasepool(|_| {
        let center = UNUserNotificationCenter::currentNotificationCenter();

        let content = UNMutableNotificationContent::new();
        content.setTitle(&NSString::from_str(&req.title));
        if !req.subtitle.is_empty() {
            content.setSubtitle(&NSString::from_str(&req.subtitle));
        }
        content.setBody(&NSString::from_str(&req.body));
        // macOS stacks banners that share a thread.
        if !req.thread.is_empty() {
            content.setThreadIdentifier(&NSString::from_str(&req.thread));
        }
        if !req.kind.is_empty() {
            let key = NSString::from_str(INFO_KEY);
            let value = NSString::from_str(&info_json(req));
            let info = NSDictionary::from_slices(&[&*key], &[&*value]);
            // userInfo is an untyped NSDictionary; ours holds one string under one string key.
            unsafe { content.setUserInfo(&Retained::cast_unchecked::<NSDictionary>(info)) };
        }

        let seq = SEQ.fetch_add(1, Ordering::Relaxed);
        let ident = NSString::from_str(&format!("{ID_PREFIX}{seq}|{}", req.target));
        let request =
            UNNotificationRequest::requestWithIdentifier_content_trigger(&ident, &content, None);

        let done = RcBlock::new(|err: *mut NSError| {
            if !err.is_null() {
                eprintln!("periscope: notification delivery failed");
            }
        });
        center.addNotificationRequest_withCompletionHandler(&request, Some(&done));
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    const FULL: &str = r#"{"title":"CI failed on #7","body":"✗ test","target":"s:1","kind":"ci_failed",
        "subtitle":"periscope · pane","thread":"ci_failed","data":{"open":"url","url":"https://github.com/o/r/pull/7"},
        "quiet_when_focused":true}"#;

    #[test]
    fn parses_an_older_webviews_banner() {
        let req = parse_request(r#"{"title":"t","body":"b","target":"s:1"}"#).unwrap();
        assert_eq!(req.target, "s:1");
        assert_eq!(req.kind, "");
        assert!(req.subtitle.is_empty() && req.thread.is_empty());
        assert!(req.data.is_null());
        assert!(!req.quiet_when_focused);
    }

    #[test]
    fn parses_a_full_banner() {
        let req = parse_request(FULL).unwrap();
        assert_eq!(req.kind, "ci_failed");
        assert_eq!(req.subtitle, "periscope · pane");
        assert_eq!(req.thread, "ci_failed");
        assert_eq!(req.data["url"], "https://github.com/o/r/pull/7");
        assert!(req.quiet_when_focused);
    }

    #[test]
    fn rejects_a_banner_without_a_title() {
        assert!(parse_request(r#"{"body":"b","target":"s:1"}"#).is_err());
    }

    #[test]
    fn keeps_what_a_click_needs_in_user_info() {
        let req = parse_request(FULL).unwrap();
        let info = parse_info(&info_json(&req)).unwrap();
        assert_eq!(
            info,
            Info {
                target: "s:1".into(),
                kind: "ci_failed".into(),
                data: serde_json::json!({"open": "url", "url": "https://github.com/o/r/pull/7"}),
                quiet_when_focused: true,
            }
        );
    }

    #[test]
    fn treats_user_info_without_a_kind_as_a_plain_banner() {
        assert!(parse_info(r#"{"target":"s:1","kind":""}"#).is_none());
        assert!(parse_info("not json").is_none());
    }

    #[test]
    fn stays_quiet_only_when_asked_and_focused() {
        assert!(should_present(false, false));
        assert!(should_present(false, true));
        assert!(should_present(true, false));
        assert!(!should_present(true, true));
    }
}
```

and apply to `main.rs`:

```diff
diff --git a/src-tauri/src/main.rs b/src-tauri/src/main.rs
index 5cd35fc..7bfe84b 100644
--- a/src-tauri/src/main.rs
+++ b/src-tauri/src/main.rs
@@ -131,6 +131,15 @@ fn main() {
                 _ => {}
             }
         })
+        // will_present can't ask the window whether it's focused from the
+        // main thread, so the focus is kept here for it.
+        .on_window_event(|window, event| {
+            if let tauri::WindowEvent::Focused(focused) = event {
+                if window.label() == "main" {
+                    notifications::set_focused(*focused);
+                }
+            }
+        })
         .build(tauri::generate_context!())
         .expect("error while building tauri application")
         .run(|_app, event| {
```

- [ ] **Step 3: Build and test.** Run `cd src-tauri && cargo test`. The first build is cold and takes a few minutes. Expected: `10 passed`. The six new tests are `parses_an_older_webviews_banner`, `parses_a_full_banner`, `rejects_a_banner_without_a_title`, `keeps_what_a_click_needs_in_user_info`, `treats_user_info_without_a_kind_as_a_plain_banner` and `stays_quiet_only_when_asked_and_focused`. Then run `cargo build` (expect no warnings) and `rustfmt --check --edition 2021 src/notifications.rs`. `main.rs` has existing `rustfmt` diffs; leave them.

- [ ] **Step 4: Commit:** `shell: banners carry subtitle, thread and what a click opens (userInfo); kinded clicks go out on notification-opened, plain ones as before; quiet while the dashboard is focused`.

---

### Task 14: Build, gate, check by hand, merge

- [ ] **Step 1: The whole suite and the gate.**
  - `npx vitest run`: prototype 699 passed;
  - `uv run pytest -q`: prototype 1546;
  - `bin/check`: clean apart from the 3 pre-existing biome warnings;
  - `cd src-tauri && cargo test`: 10.

- [ ] **Step 2: Build and commit the bundle.** Run `npm run build`, then commit `static/dist/` as `build: static/dist for native notifications 2a`.

- [ ] **Step 3: Dev server.** Run `PERISCOPE_PORT=17375 PERISCOPE_DEV=1 uv run server.py` and open http://127.0.0.1:17375/ in a browser. Check:
  - Settings shows the Notifications fieldset with eight checked boxes and the "macOS app only" note.
  - Unticking "A session finishes" survives a reload, and `/api/prefs` shows `ui.notify.done: false`.
  - Nothing errors in the console, and no banner code runs in the browser.
  - Tick the box back on before moving on.

- [ ] **Step 4: The app, by hand.** Build the dev app as `docs/tauri-shell.md` describes (build the `.app`, don't use `cargo tauri dev`), point it at the dev server, and allow notifications when macOS asks. Then check:
  1. **needs_input:** start a Claude pane and make it ask a permission question. One banner arrives, "{pane} needs you · Waiting for your approval.", and clicking it selects that pane.
  2. **question:** have an agent call `notify(need_human)`. The banner reads "{pane} asks" with the message. The same pane with a dialog open gets only the needs-input banner.
  3. **done:** let a pane finish a turn. The banner reads "{pane} is done" with its last sentence.
  4. **ci_failed:** push a failing commit to a session's open PR. The banner reads "CI failed on #N" with the checks, and a click opens the PR in the browser.
  5. **pr_merged:** merge a linked PR (one set with `link_pr`). The banner reads "PR #N merged · {branch} → {base}" and a click opens it.
  6. **usage** (if a meter can be pushed grumpy, or use an account already projecting past its limit after a reset): the banner reads "Account X is running hot", and a click opens the usage pill.
  7. **Grouping:** trigger permission prompts in 4 panes at once. Two banners arrive, then about 3 s later one "2 more sessions need you" summary.
  8. **Quiet-when-focused:** with the dashboard focused, trigger a banner. It isn't shown, but it's in Notification Center. Untick the setting, and the next one shows.
  9. **Recycle:** with a pane about to ask, use View → Recycle Webview. The banner still arrives once, and a reload afterwards doesn't replay it.
  10. **Dock badge:** it equals the number of panes waiting on you, and unticking the badge setting clears it.
  11. **Toggles:** each kind can be turned off, and changes apply without a restart.
  12. **Version skew:** with the *old* installed app against the new server, banners still arrive and a click reveals the pane.

  Note anything that fails before merging.

- [ ] **Step 5: Merge and deploy** (CLAUDE.md dev loop, steps 4–6). Leave the worktree, `git merge --ff-only feature/notify-banners` on `main` (if `main` moved, rebase the branch onto it first), then `bin/periscope restart`. Remove the worktree and the branch. The new shell code reaches users only once the `.app` is rebuilt and reinstalled; the server and JS changes are live after the restart.

