// A banner's buttons: which ones each banner category carries (categories)
// and what pressing one does (runAction). notify/feed.js registers the set
// through tauri.js and routes presses here; notifications.rs maps the set
// onto macOS categories and reports a press on notification-action.
//
// A category is a fixed set of buttons, labels included, so copy.js gives
// each banner the variant whose buttons all apply: no Clean up without a
// worktree, no Open PR without a URL, and Spawn on {B} gets one category per
// B. None of these make an agent act; Allow / Deny / reply
// are PR 2's (docs/superpowers/specs/2026-10-26-native-notifications-2b-design.md).
import { accountLabel } from "../accounts.js";
import { pickSpawnAccount } from "../chrome/SpawnAccountPicker.jsx";
import { openUsageDetails } from "../chrome/UsagePill.jsx";
import { openCleanupModal } from "../overlays/CleanupModal.jsx";
import { markReadySeen, revealPane, selectPane } from "../split/alertFeed.js";
import { windows } from "../store.js";
import { openExternal } from "../tauri.js";
import { usageCategory } from "./copy.js";

const act = (id, title, opts = {}) => Object.freeze({ id, title, ...opts });
// `foreground` brings Periscope forward: only for buttons that show
// something in it. Open PR's browser comes forward on its own.
const OPEN_PR = act("open_pr", "Open PR");
const MARK_SEEN = act("mark_seen", "Mark seen");
const CLEANUP = act("cleanup", "Clean up worktree", { foreground: true });
const DETAILS = act("details", "Details", { foreground: true });

// The whole set: macOS replaces it on each registration. Move targets are
// deduped and sorted so the feed's change check doesn't resend an identical
// set because move_targets came back in another order.
export function categories({ accounts = [], moveTargets = {} } = {}) {
  const set = [
    // No "done" category: every done banner gets done_seen only.
    { id: "done_seen", actions: [MARK_SEEN] },
    { id: "ci_failed_pr", actions: [OPEN_PR] },
    { id: "pr_merged", actions: [CLEANUP, OPEN_PR] },
    { id: "pr_merged_cleanup", actions: [CLEANUP] },
    { id: "pr_merged_pr", actions: [OPEN_PR] },
    { id: "usage", actions: [DETAILS] },
  ];
  for (const to of [...new Set(Object.values(moveTargets || {}))].sort()) {
    // accounts may come back null from a caller that hasn't loaded the registry yet.
    set.push({ id: usageCategory(to), actions: [act("spawn_on", `Spawn on ${accountLabel(to, accounts || [])}`), DETAILS] });
  }
  return set;
}

export const OPENERS = Object.freeze({
  openExternal, openUsageDetails, pickSpawnAccount, openCleanupModal, markReadySeen, selectPane, revealPane,
});

// A pressed button, as the shell reports it. The pane is found by pid first:
// tmux renumbers windows, so target can name a neighbour by now — `show`
// selects the live pane found by pid, falling back to revealPane(target)
// (the banner's own, possibly-stale, pane) only once that pane is gone too.
// Never throws: a failed press still shows you something.
export function runAction({ target, action, data } = {}, o = OPENERS) {
  // A default covers only a missing data; the shell's Info defaults it to null.
  data ||= {};
  let w;
  const show = () => (w ? o.selectPane(w) : target && o.revealPane(target));
  try {
    // "" is an unstamped pane's pid — must not match every unstamped window.
    w = data.pid ? (windows.peek() || []).find((x) => String(x.pid) === String(data.pid)) : null;
    switch (action) {
      case "open_pr":
        if (data.url) o.openExternal(data.url);
        else show();
        return;
      case "details":
        o.openUsageDetails();
        return;
      case "spawn_on":
        // pickSpawnAccount is async but can't reject today (apiCall swallows
        // its errors), so there's nothing here for the catch below to see.
        if (data.spawn_to) o.pickSpawnAccount(data.spawn_to);
        return;
      case "mark_seen":
        // A gone pane has no READY row left to dismiss.
        if (w) o.markReadySeen(w);
        return;
      case "cleanup": {
        // The banner names the worktree whose PR merged; the live pane may
        // since have moved to another one.
        const cwd = data.cwd || w?.cwd;
        if (cwd) o.openCleanupModal({ paths: [cwd] });
        else show();
        return;
      }
      default:
        console.warn("[notify] unknown action", action);
    }
  } catch (e) {
    console.error("[notify] action failed", action, e);
    try {
      show();
    } catch (e2) {
      console.error("[notify] reveal failed", e2);
    }
  }
}
