// What each notification says (notify/detect.js finds them, notify/feed.js
// sends them): the pure part. macOS truncates titles around 40 characters, so
// pane names are clipped before they push the verb off the end.

import { meterLabel } from "../chrome/usageRules.js";
import { paneLabel, plural, prUrl, waitKind } from "../util.js";

// Cut by code point, not UTF-16 code unit — a pane name ending in an emoji
// or other surrogate-pair character would otherwise leave a lone surrogate
// (an unpaired high surrogate renders as a replacement glyph in the banner).
const clip = (s, n) => {
  const t = String(s || "").trim();
  const chars = Array.from(t);
  return chars.length > n ? `${chars.slice(0, n - 1).join("")}…` : t;
};
const pane = (w) => clip(paneLabel(w), 26);
const where = (w) => [w?.session, w?.branch].filter(Boolean).join(" · ");

// The first sentence of a pane's last words, for a done banner. A sentence
// ends at `.`/`!`/`?` only when followed by whitespace-then-capital/digit (or
// the end of the text) — plain "e.g."/"i.e." no longer read as sentence
// ends. "Mr. Smith approved." still cuts at "Mr." since "Smith" is
// capitalized; there's no cheap way to special-case every title abbreviation.
export function firstSentence(text) {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  const m = t.match(/^.*?[.!?](?=\s[A-Z0-9]|$)/);
  return clip(m ? m[0] : t, 140);
}

const NEEDS_BODY = {
  permission: "Waiting for your approval.",
  question: "Waiting for your answer.",
  dialog: "Waiting for your input.",
};
const CHECK_MARK = { failure: "✗", pending: "⟳", success: "✓" };

// A usage banner's category when it can offer Spawn on {B}: one per B,
// because a category's buttons, labels included, are fixed (notify/actions.js).
export const usageCategory = (to) => `usage_to_${to}`;

// Each event's banner: { kind, title, subtitle, body, target, thread, category, data }.
// `target` is the pane, so an older shell's plain click can still reveal it;
// `data` says what a click opens. ctx: { accounts, windows, moveTargets }.
// `category` picks the banner's buttons (notify/actions.js); a kind without
// one shows none.
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
        // The linked PR only: an auto-detected one is just the branch's, often
        // days old, and would ride every finished turn.
        subtitle: w.pr && w.pr_linked ? `${w.session} · PR #${w.pr}` : where(w),
        body: firstSentence(w.recap || w.last_line) || "Finished.",
        // Review diff needs a branch to diff; Mark seen always applies.
        category: w.branch ? "done" : "done_seen", data: { open: "pane", pid: w.pid, session: w.session },
      };
    case "ci_failed": {
      const checks = (w.ci_checks || []).map((c) => `${CHECK_MARK[c.state] || "·"} ${c.name}`).join(" · ");
      return {
        ...base, title: `CI failed on #${w.pr}`, subtitle: [w.session, paneLabel(w)].filter(Boolean).join(" · "),
        body: checks || "Checks are failing.",
        // PR 2's Ask agent to fix adds a "ci_failed" category with that button.
        category: "ci_failed_pr", data: { open: "url", url: prUrl(w.repo_slug, w.pr), pid: w.pid },
      };
    }
    case "pr_merged":
      return {
        ...base, title: `PR #${w.pr} merged`,
        subtitle: w.pr_base ? `${w.session} · ${w.branch} → ${w.pr_base}` : where(w),
        body: "The worktree and its session can be cleaned up.",
        category: w.cwd ? "pr_merged" : "pr_merged_pr",
        data: { open: "url", url: prUrl(w.repo_slug, w.pr), pid: w.pid, cwd: w.cwd },
      };
    case "usage": {
      const registry = ctx.accounts || [];
      const name = clip(registry.find((a) => a.id === ev.account)?.label || ev.account, 16);
      const multi = registry.length > 1;
      const proj = Math.max(...[ev.m.projected_percent, ev.m.projected_recent].filter((v) => v != null), -1);
      const working = (ctx.windows || []).filter((x) => x.state === "working" && x.account === ev.account).length;
      // Spawn on the account a pane on A would move to (launch_policy.choose_move,
      // published as move_targets): not launch_default, which can be A itself.
      const to = ctx.moveTargets?.[ev.account];
      const spawn = to && to !== ev.account;
      return {
        ...base, target: "",
        title: multi ? `Account ${name} is running hot` : "Usage is running hot",
        subtitle: `${meterLabel(ev.meter)} usage ${Math.round(ev.m.percent ?? 0)}%`
          + (proj >= 0 ? ` · →${Math.round(proj)}% at reset` : ""),
        body: multi ? `${plural(working, "session")} working on ${name}.` : `${plural(working, "session")} working.`,
        category: spawn ? usageCategory(to) : "usage",
        data: spawn ? { open: "usage", spawn_to: to } : { open: "usage" },
      };
    }
    default:
      return null;
  }
}
