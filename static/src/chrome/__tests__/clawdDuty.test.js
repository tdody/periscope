import { describe, expect, it } from "vitest";
import {
  deskScene, DUTY_ORDER, dutyItems, moreCount, nextMergeWatch, nextNeedsSince, PARTY_S, walledUntil, wallLabel,
  wallPhrase,
} from "../clawdDuty.js";

const NOW = 1_800_000_000;
const pane = (pid, extra = {}) => ({ pid, target: `s:${pid}`, name: `pane-${pid}`, agent: "claude", state: "idle", ...extra });
const kinds = (items) => items.map((i) => i.kind);

describe("dutyItems", () => {
  it("is empty when nothing needs anyone", () => {
    expect(dutyItems({ windows: [pane("a"), pane("b", { state: "working" })], nowSec: NOW })).toEqual([]);
  });

  it("orders every kind by DUTY_ORDER", () => {
    const items = dutyItems({
      windows: [
        pane("a", { state: "needs-input", waiting_for: "permission" }),
        pane("b", { api_error: true }),
        pane("c", { ci: "✗", pr: 7, repo_slug: "o/r" }),
        pane("d", { state: "done" }),
        pane("e", { context_pct: 91 }),
        pane("g", { pr: 4, pr_state: "merged", cwd: "/w/g" }),
        pane("h", { pr: 5, pr_state: "closed", cwd: "/w/h" }),
      ],
      parties: [{ key: "f#9", pid: "f", target: "s:f", pr: 9, at: NOW - 5 }],
      update: { behind: 3, running: false }, nowSec: NOW,
    });
    expect(kinds(items)).toEqual(DUTY_ORDER);
    expect(moreCount(items)).toBe(1 + 1 + 1 + 1 + 1 + 2 + 1);
  });

  it("skips the pane you're looking at, but not its merge party", () => {
    const items = dutyItems({
      windows: [pane("a", { state: "needs-input", waiting_for: "permission" }), pane("b", { api_error: true })],
      parties: [{ key: "a#9", pid: "a", target: "s:a", pr: 9, at: NOW }],
      selectedPid: "a", nowSec: NOW,
    });
    expect(kinds(items)).toEqual(["api", "merged"]);
  });

  it("rings for need_human alerts and goes red after ten minutes", () => {
    const windows = [pane("a")];
    const alerts = [{ id: 1, kind: "need_human", target: "s:a", ts: NOW - 700 }];
    const [bell] = dutyItems({ windows, alerts, nowSec: NOW });
    expect(bell).toMatchObject({ kind: "bell", label: "1", urgent: true, target: { action: "pane", target: "s:a" } });
    expect(bell.phrase).toBe("pane-a needs you (11 min)");
    expect(dutyItems({ windows, alerts: [{ ...alerts[0], ts: NOW - 60 }], nowSec: NOW })[0].urgent).toBe(false);
  });

  it("ages a live question from when it was first seen, oldest first", () => {
    const windows = [pane("a", { state: "needs-input", waiting_for: "permission" }),
      pane("b", { state: "needs-input", asked_question: true })];
    const [bell] = dutyItems({ windows, needsSince: { a: NOW - 30, b: NOW - 900 }, nowSec: NOW });
    expect(bell.count).toBe(2);
    expect(bell.urgent).toBe(true);
    // b is a soft question: a click dismisses it, as clicking its rail row does.
    expect(bell.target).toMatchObject({ target: "s:b", dismissNeeds: true });
  });

  it("respects the rail's dismissals", () => {
    const windows = [pane("a", { state: "needs-input", asked_question: true }), pane("b", { state: "done" })];
    expect(dutyItems({ windows, dismissedNeedsPids: new Set(["a"]), dismissedReadyPids: new Set(["b"]), nowSec: NOW })).toEqual([]);
  });

  it("counts a failing PR once however many panes share it, and only while open", () => {
    const windows = [pane("a", { ci: "✗", pr: 9000, repo_slug: "o/r" }), pane("b", { ci: "✗", pr: 9000, repo_slug: "o/r" }),
      pane("c", { ci: "✗", pr: 12, repo_slug: "o/r", pr_state: "merged" }), pane("d", { ci: "✓", pr: 13 })];
    const [ci] = dutyItems({ windows, nowSec: NOW });
    expect(ci).toMatchObject({ kind: "ci", count: 1, phrase: "PR #9000 is failing CI" });
    expect(kinds(dutyItems({ windows, selectedPid: "b", nowSec: NOW }))).not.toContain("ci");
  });

  it("sweats over the panes the rail paints red, labelled with the fullest", () => {
    const windows = [pane("a", { context_pct: 70 }), pane("b", { context_pct: 84 }), pane("c", { ctx_class: "hot", context_pct: 40 })];
    const [ctx] = dutyItems({ windows, nowSec: NOW });
    expect(ctx).toMatchObject({ kind: "ctx", count: 2, label: "84%", pct: 84, target: { target: "s:b" } });
  });

  it("ends a merge party after ten minutes", () => {
    const parties = [{ key: "a#9", pid: "a", target: "s:a", pr: 9, at: NOW - PARTY_S }];
    expect(dutyItems({ parties, nowSec: NOW })).toEqual([]);
    expect(dutyItems({ parties, nowSec: NOW - 1 })[0]).toMatchObject({ kind: "merged", phrase: "PR #9 merged 🎉" });
  });

  it("offers cleanup for each worktree whose linked PR is done, once", () => {
    const windows = [pane("a", { pr: 4, pr_state: "merged", cwd: "/w/a" }), pane("b", { pr: 4, pr_state: "merged", cwd: "/w/a" }),
      pane("c", { pr: 6, pr_state: "open", cwd: "/w/c" })];
    const [clean] = dutyItems({ windows, nowSec: NOW });
    expect(clean).toMatchObject({ kind: "clean", count: 1, phrase: "PR #4 is merged: pane-a's worktree can be cleaned up",
      target: { action: "cleanup" } });
  });

  it("offers the update only when behind and not already running", () => {
    expect(kinds(dutyItems({ update: { behind: 2, running: false }, nowSec: NOW }))).toEqual(["update"]);
    expect(dutyItems({ update: { behind: 2, running: true }, nowSec: NOW })).toEqual([]);
    expect(dutyItems({ update: { behind: 0 }, nowSec: NOW })).toEqual([]);
  });
});

describe("walledUntil", () => {
  const acct = (session, week, extra = {}) => ({
    available: true, fetched_at: NOW - 30,
    meters: { session: { percent: session, resets_at: NOW + 3600 }, week_all: { percent: week, resets_at: NOW + 86400 * 3 } },
    ...extra,
  });

  it("naps only when every account is walled, until the soonest is back", () => {
    expect(walledUntil({ a: acct(100, 40), b: acct(30, 100) }, NOW)).toEqual({ until: NOW + 3600 });
    expect(walledUntil({ a: acct(100, 40), b: acct(30, 60) }, NOW)).toBe(null);
  });

  it("waits for every wall on an account to reset", () => {
    expect(walledUntil({ a: acct(100, 100) }, NOW)).toEqual({ until: NOW + 86400 * 3 });
  });

  it("stays awake when an account is stale, unavailable, or the plan is empty", () => {
    expect(walledUntil({ a: acct(100, 100), b: { available: false } }, NOW)).toBe(null);
    expect(walledUntil({ a: acct(100, 100, { fetched_at: NOW - 3600 }) }, NOW)).toBe(null);
    expect(walledUntil({}, NOW)).toBe(null);
  });

  it("formats the reset, naming the day only for a far-off one", () => {
    const at = new Date(2026, 9, 21, 15, 0).getTime() / 1000;
    expect(wallLabel(at, at - 3600)).toEqual({ day: null, time: "3pm" });
    expect(wallLabel(at + 40 * 60, at)).toEqual({ day: null, time: "3:40pm" });
    expect(wallLabel(at + 2 * 86400, at)).toEqual({ day: "Fri", time: "3pm" });
    expect(wallPhrase({ day: "Fri", time: "3pm" })).toBe("every account is at its limit until Fri 3pm");
  });
});

describe("deskScene", () => {
  it("naps or sweeps only at the desk", () => {
    expect(deskScene("code", "bell", true)).toBe("nap");
    expect(deskScene("code", "clean", false)).toBe("sweep");
    expect(deskScene("code", "bell", false)).toBe("code");
    expect(deskScene("read", "clean", true)).toBe("read");
  });
});

describe("watcher transitions", () => {
  it("keeps the first time a pane was seen waiting", () => {
    const ws = [pane("a", { state: "needs-input" }), pane("b")];
    expect(nextNeedsSince({ a: NOW - 50, b: NOW - 10 }, ws, NOW)).toEqual({ a: NOW - 50 });
    expect(nextNeedsSince({}, ws, NOW)).toEqual({ a: NOW });
  });

  it("throws a party only on open → merged for the same PR", () => {
    const open = [pane("a", { pr: 9, pr_state: "open" })];
    const merged = [pane("a", { pr: 9, pr_state: "merged", pr_title: "Clawd" })];
    let m = nextMergeWatch({ states: {}, parties: [] }, open, NOW);
    expect(m.parties).toEqual([]);
    m = nextMergeWatch(m, [pane("a", { pr: 9 })], NOW + 3); // a cold cache drops pr_state for a poll
    m = nextMergeWatch(m, merged, NOW + 6);
    expect(m.parties).toEqual([{ key: "a#9", pid: "a", target: "s:a", pr: 9, title: "Clawd", at: NOW + 6 }]);
    expect(nextMergeWatch(m, merged, NOW + 9).parties).toHaveLength(1);
  });

  it("never parties on a first sighting, a close, or a different PR", () => {
    expect(nextMergeWatch({ states: {}, parties: [] }, [pane("a", { pr: 9, pr_state: "merged" })], NOW).parties).toEqual([]);
    const states = { a: { pr: 9, state: "open" } };
    expect(nextMergeWatch({ states, parties: [] }, [pane("a", { pr: 9, pr_state: "closed" })], NOW).parties).toEqual([]);
    expect(nextMergeWatch({ states, parties: [] }, [pane("a", { pr: 10, pr_state: "merged" })], NOW).parties).toEqual([]);
  });
});
