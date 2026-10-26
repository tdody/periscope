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
