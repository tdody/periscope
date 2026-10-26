// A banner's buttons: which ones each banner category carries (categories)
// and what pressing one does (runAction). notify/feed.js registers the set
// through tauri.js and routes presses here; notifications.rs maps the set
// onto macOS categories and reports a press on notification-action.
//
// A category is a fixed set of buttons, labels included, so copy.js gives
// each banner the variant whose buttons all apply: no Clean up without a
// worktree, no Open PR without a URL, no Allow / Deny without a request the
// server could name, and Spawn on {B} gets one category per B. Review diff
// isn't offered yet — it waits on review rows keyed by worktree (THI-433).
// Allow / Deny / Reply / Ask agent to fix make an agent act: they POST to
// routes/pane_actions.py, which re-checks the pane when pressed
// (docs/superpowers/specs/2026-10-26-native-notifications-2b-design.md).
import { accountLabel } from "../accounts.js";
import { pickSpawnAccount } from "../chrome/SpawnAccountPicker.jsx";
import { openUsageDetails } from "../chrome/UsagePill.jsx";
import { openCleanupModal } from "../overlays/CleanupModal.jsx";
import { showToast } from "../overlays/Toast.jsx";
import { markReadySeen, revealPane, selectPane, selectReview } from "../split/alertFeed.js";
import { windows } from "../store.js";
import { notify, openExternal } from "../tauri.js";
import { postJson } from "../util.js";
import { usageCategory } from "./copy.js";

const act = (id, title, opts = {}) => Object.freeze({ id, title, ...opts });
// `foreground` brings Periscope forward: only for buttons that show
// something in it. Open PR's browser comes forward on its own.
const OPEN_PR = act("open_pr", "Open PR");
const MARK_SEEN = act("mark_seen", "Mark seen");
const CLEANUP = act("cleanup", "Clean up worktree", { foreground: true });
const DETAILS = act("details", "Details", { foreground: true });
const OPEN = act("open", "Open", { foreground: true });
// `auth`: Touch ID or the password first when the screen is locked — every
// button that lets an agent proceed or types into it; Deny only stops one.
const FIX = act("fix", "Ask agent to fix", { auth: true });

// The whole set: macOS replaces it on each registration. Move targets are
// deduped and sorted so the feed's change check doesn't resend an identical
// set because move_targets came back in another order.
export function categories({ accounts = [], moveTargets = {} } = {}) {
  const set = [
    // No "done" category yet: Review diff waits on review rows keyed by
    // worktree (THI-433), so every done banner gets done_seen only.
    { id: "done_seen", actions: [MARK_SEEN] },
    { id: "ci_failed_pr", actions: [OPEN_PR] },
    { id: "pr_merged", actions: [CLEANUP, OPEN_PR] },
    { id: "pr_merged_cleanup", actions: [CLEANUP] },
    { id: "pr_merged_pr", actions: [OPEN_PR] },
    { id: "usage", actions: [DETAILS] },
    // Deny is Escape ("No, and tell Claude what to do differently"), so it
    // needs no auth; macOS draws it red.
    {
      id: "needs_permission",
      actions: [act("allow", "Allow", { auth: true }), act("deny", "Deny", { destructive: true }), OPEN],
    },
    { id: "needs_dialog", actions: [OPEN] },
    // A category's buttons are static, so the placeholder can't name the pane.
    { id: "question", actions: [act("send", "Reply", { auth: true, reply: { button: "Send", placeholder: "Reply…" } }), OPEN] },
    { id: "ci_failed", actions: [FIX, OPEN_PR] },
    { id: "ci_failed_fix", actions: [FIX] },
  ];
  for (const to of [...new Set(Object.values(moveTargets || {}))].sort()) {
    // accounts may come back null from a caller that hasn't loaded the registry yet.
    set.push({ id: usageCategory(to), actions: [act("spawn_on", `Spawn on ${accountLabel(to, accounts || [])}`), DETAILS] });
  }
  return set;
}

export const OPENERS = Object.freeze({
  openExternal, openUsageDetails, pickSpawnAccount, openCleanupModal, markReadySeen, selectReview, selectPane, revealPane,
  post: postJson, toast: showToast, notify,
});

// What a failed agent-acting press says in its toast.
const ACT_LABEL = { allow: "Allow", deny: "Deny", send: "Reply", fix: "Ask agent to fix" };

// The short verb a failed agent-acting press names itself in its follow-up
// native banner ("Couldn't allow — …") — distinct from ACT_LABEL, which names
// the button for the toast.
const NOTICE_VERB = { allow: "allow", deny: "deny", send: "send", fix: "fix" };

// The message Ask agent to fix types into the pane: the PR and the names of
// its failing checks (copy.js puts them in data.checks).
export function fixMessage(pr, checks) {
  const what = checks?.length ? `${checks.join(" · ")}.` : "Checks are failing.";
  return `CI failed on #${pr}: ${what} Please investigate and fix.`;
}

// A press that makes the agent act. The server re-checks the pane and
// answers 409 when the banner no longer matches it (another request, the
// dialog gone, a dialog just opened): that only needs the pane shown as it is
// now. Any other failure shows it too, with the error. Allow / Deny / Send /
// Fix are background presses — the app isn't brought forward for them — so
// show() and the toast land in a hidden window where nobody sees them; a
// plain follow-up banner (kind "notice", no category, data.open: "pane" —
// openFromBanner already opens that by pid) is what actually reaches the
// user, on every failure. Success needs nothing: the pane's next state shows
// it working. Never rejects.
async function agentAct(action, path, body, show, o) {
  const notice = (reason) => {
    try {
      o.notify({ kind: "notice", title: `Couldn't ${NOTICE_VERB[action]} — ${reason}`, data: { open: "pane", pid: body.pid } });
    } catch (e) {
      console.error("[notify] follow-up failed", e);
    }
  };
  try {
    if (!body.pid) {
      show();
      return;
    }
    const r = await o.post(path, body);
    if (r?.ok) return;
    show();
    if (r?.status === 409) {
      notice("the dialog changed");
    } else {
      o.toast(`${ACT_LABEL[action]} failed: ${r?.detail || "no answer"}`, "bad", 6000);
      notice(r?.detail || "no answer");
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

// A pressed button, as the shell reports it. The pane is found by pid first:
// tmux renumbers windows, so target can name a neighbour by now — `show`
// selects the live pane found by pid, falling back to revealPane(target)
// (the banner's own, possibly-stale, pane) only once that pane is gone too.
// Never throws: a failed press still shows you something. The agent-acting
// presses return agentAct's promise, which never rejects either.
export function runAction({ target, action, text, data } = {}, o = OPENERS) {
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
      case "review": {
        // No category offers this button until THI-433 re-adds one; kept so
        // the follow-up only touches categories() and copy.js.
        const session = w?.session || data.session;
        if (session) o.selectReview(session);
        else show();
        return;
      }
      case "cleanup": {
        // The banner names the worktree whose PR merged; the live pane may
        // since have moved to another one. (review keeps preferring the live
        // w.session: a tmux session can be renamed, and the rail keys review
        // rows by its current name.)
        const cwd = data.cwd || w?.cwd;
        if (cwd) o.openCleanupModal({ paths: [cwd] });
        else show();
        return;
      }
      case "allow":
      case "deny":
        return agentAct(action, "/api/pane/permission", { pid: data.pid, request_id: data.request_id, choice: action }, show, o);
      case "send": {
        // An empty reply says nothing; there's nothing to send.
        const reply = String(text || "").trim();
        if (!reply) return;
        return agentAct(action, "/api/pane/reply", { pid: data.pid, text: reply }, show, o);
      }
      case "fix":
        return agentAct(action, "/api/pane/reply", { pid: data.pid, text: fixMessage(data.pr, data.checks) }, show, o);
      case "open":
        show();
        return;
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
