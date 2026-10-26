// The feed's click routing, toggles and pass rules (runPass). The detection,
// copy and grouping it strings together are covered in their own tests; the
// effect itself only applies runPass's result through the Tauri shell and is
// checked by hand (see the plan's manual checklist).
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../tauri.js", () => ({
  inTauri: () => false, notify: vi.fn(), onNotificationClick: vi.fn(), onNotificationOpened: vi.fn(),
  onNotificationAction: vi.fn(), openExternal: vi.fn(), setBadgeCount: vi.fn(), setNotifyCategories: vi.fn(async () => {}),
}));
const tauri = await import("../../tauri.js");
const { railSelection, windows } = await import("../../store.js");
const { usageExpanded } = await import("../../chrome/UsagePill.jsx");
const { enabled, makeDelivery, openFromBanner, runPass, startNotifyFeed } = await import("../feed.js");
const { payloadFor } = await import("../copy.js");
const { BURST_MS } = await import("../burst.js");

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

  it("reveals the target when the shell sends data as null", () => {
    windows.value = [{ pid: "p2", target: "s:1" }];
    railSelection.value = null;
    openFromBanner({ target: "s:1", data: null });
    expect(railSelection.value).toBe("pane:p2");
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
    expect(tauri.onNotificationAction).not.toHaveBeenCalled();
    expect(tauri.setBadgeCount).not.toHaveBeenCalled();
  });
});

describe("runPass", () => {
  const PREFS = { needs_input: true, done: true, quiet_when_focused: true, group: true, badge: true };
  const win = (over = {}) => ({ pid: "p1", target: "s:1", session: "s", name: "pane", state: "idle", ...over });
  const asks = (pid, since = 100) => win({ pid, target: `s:${pid}`, name: pid, state: "needs-input", needs_since: since });
  const snapOf = (windows, over = {}) => ({ windows, alerts: [], plan: {}, accounts: [], ...over });
  const fresh = (over = {}) => ({ state: null, recent: [], held: [], heldSince: null, lastBadge: undefined, editing: false, ...over });
  // Seed on `before`; returns the ctx the next pass starts from.
  const seeded = (before, over = {}) => {
    const r = runPass(fresh(), snapOf(before), PREFS, 0);
    return fresh({ state: r.state, lastBadge: r.lastBadge, ...over });
  };

  it("seeds silently, then announces what's new with the focus pref attached", () => {
    const ctx = seeded([win()]);
    expect(ctx.state).not.toBeNull();
    const r = runPass(ctx, snapOf([asks("p1")]), PREFS, 1000);
    expect(r.sends).toHaveLength(1);
    expect(r.sends[0]).toMatchObject({ kind: "needs_input", quiet_when_focused: true, data: { pid: "p1" } });
  });

  it("drops only the event whose banner throws; the rest still go out and the badge is still counted", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const ctx = seeded([win(), win({ pid: "p2" }), win({ pid: "p3" })]);
    const after = [asks("p1"), win({ pid: "p2", state: "done", completed_at: 5 }), win({ pid: "p3", state: "done", completed_at: 5 })];
    const build = (ev, c) => {
      if (ev.w?.pid === "p2") throw new Error("boom");
      return payloadFor(ev, c);
    };
    const r = runPass(ctx, snapOf(after), PREFS, 1000, build);
    expect(r.sends.map((p) => p.data.pid)).toEqual(["p1", "p3"]);
    expect(r.badge).toBe(1);
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });

  it("doesn't seed from an empty snapshot, nor mid-rename/drag; a full one later seeds silently", () => {
    const empty = runPass(fresh(), snapOf([]), PREFS, 0);
    expect(empty.state).toBeNull();
    expect(empty.sends).toEqual([]);
    const editing = runPass(fresh({ editing: true }), snapOf([asks("p1")]), PREFS, 0);
    expect(editing.state).toBeNull();
    expect(editing.sends).toEqual([]);
    const full = runPass(fresh(), snapOf([asks("p1")]), PREFS, 0);
    expect(full.state).not.toBeNull();
    expect(full.sends).toEqual([]);
  });

  it("detects nothing mid-rename/drag, but still counts the badge", () => {
    const ctx = seeded([win()], { editing: true });
    const r = runPass(ctx, snapOf([asks("p1")]), PREFS, 1000);
    expect(r.state).toBe(ctx.state);
    expect(r.sends).toEqual([]);
    expect(r.badge).toBe(1);
    // Once the drag ends, the same news still announces.
    expect(runPass({ ...ctx, editing: false }, snapOf([asks("p1")]), PREFS, 2000).sends).toHaveLength(1);
  });

  it("holds a burst's third banner, keeping when the hold began", () => {
    const ctx = seeded([win()]);
    const r = runPass(ctx, snapOf([asks("a"), asks("b"), asks("c")]), PREFS, 1000);
    expect(r.sends).toHaveLength(2);
    expect(r.held).toHaveLength(1);
    expect(r.heldSince).toBe(1000);
    const r2 = runPass({ ...ctx, ...r }, snapOf([asks("a"), asks("b"), asks("c"), asks("d")]), PREFS, 1500);
    expect(r2.held).toHaveLength(2);
    expect(r2.heldSince).toBe(1000);
  });

  it("flushes an overdue summary on the next pass, once", () => {
    const held = [{ kind: "needs_input", w: asks("c") }, { kind: "needs_input", w: asks("d") }];
    const ctx = seeded([win()], { held, heldSince: 1000 });
    expect(runPass(ctx, snapOf([win()]), PREFS, 1000 + BURST_MS - 1).flush).toEqual([]);
    const r = runPass(ctx, snapOf([win()]), PREFS, 1000 + BURST_MS);
    expect(r.flush).toHaveLength(1);
    expect(r.flush[0]).toMatchObject({ kind: "summary", title: "2 more sessions need you", quiet_when_focused: true });
    expect(r.held).toEqual([]);
    expect(r.heldSince).toBeNull();
    expect(runPass({ ...ctx, ...r }, snapOf([win()]), PREFS, 1000 + 2 * BURST_MS).flush).toEqual([]);
  });

  it("flushes a lone held event as its own banner", () => {
    const ctx = seeded([win()], { held: [{ kind: "needs_input", key: "k", w: asks("c") }], heldSince: 1000 });
    const r = runPass(ctx, snapOf([win()]), PREFS, 1000 + BURST_MS);
    expect(r.flush).toHaveLength(1);
    expect(r.flush[0]).toMatchObject({ kind: "needs_input", quiet_when_focused: true });
  });

  it("sends the badge on the first pass and then only when it changes", () => {
    const ctx = seeded([asks("p1")]);
    expect(ctx.lastBadge).toBe(1);
    expect(runPass(ctx, snapOf([asks("p1")]), PREFS, 1000).badge).toBeNull();
    const r = runPass(ctx, snapOf([win()]), PREFS, 1000);
    expect(r.badge).toBe(0);
    expect(r.lastBadge).toBe(0);
    expect(runPass(ctx, snapOf([asks("p1")]), { ...PREFS, badge: false }, 1000).badge).toBe(0);
  });

  it("does nothing before the first /api/state", () => {
    const r = runPass(fresh(), snapOf([asks("p1")], { alerts: null }), PREFS, 0);
    expect(r).toMatchObject({ state: null, sends: [], flush: [], badge: null });
  });

  it("computes the badge before the seeding/editing skip, even when it can't seed yet", () => {
    const r1 = runPass(fresh(), snapOf([]), PREFS, 0);
    expect(r1.state).toBeNull();
    expect(r1.badge).toBe(0);
    const r2 = runPass(fresh({ editing: true }), snapOf([asks("p1")]), PREFS, 0);
    expect(r2.state).toBeNull();
    expect(r2.badge).toBe(1);
  });

  it("reschedules the burst timer for a new batch flushed and held in the same pass", () => {
    const oldHeld = [{ kind: "needs_input", w: asks("x") }, { kind: "needs_input", w: asks("y") }];
    const ctx = seeded([win()], { held: oldHeld, heldSince: 1000 });
    const r = runPass(ctx, snapOf([asks("a"), asks("b"), asks("c"), asks("d")]), PREFS, 1000 + BURST_MS);
    expect(r.flush).toHaveLength(1);
    expect(r.held).toHaveLength(2);
    expect(r.heldSince).toBe(1000 + BURST_MS);
    expect(r.timerAt).toBe(1000 + 2 * BURST_MS);
  });

  it("sends the category set on the first pass, then only when it changes", () => {
    const accounts = [{ id: "default", label: "A" }, { id: "b", label: "B" }];
    const first = runPass(fresh(), snapOf([win()], { accounts, moveTargets: { default: "b" } }), PREFS, 0);
    expect(first.categories.map((c) => c.id)).toContain("usage_to_b");
    const ctx = fresh({ state: first.state, lastBadge: first.lastBadge, lastCategories: first.lastCategories });
    expect(runPass(ctx, snapOf([win()], { accounts, moveTargets: { default: "b" } }), PREFS, 1000).categories).toBeNull();
    const moved = runPass(ctx, snapOf([win()], { accounts, moveTargets: { default: "b", b: "default" } }), PREFS, 1000);
    expect(moved.categories.map((c) => c.id)).toContain("usage_to_default");
  });

  it("a thrown category-set build can't cost the pass", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    // accounts as a non-array reaches accountLabel's registry.find and
    // throws — the category build must not take the badge or sends with it.
    const r = runPass(fresh(), snapOf([asks("p1")], { accounts: {}, moveTargets: { default: "b" } }), PREFS, 0);
    expect(r.badge).toBe(1);
    expect(r.categories).toBeNull();
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });

  it("sends no categories before the first /api/state, but registers them on the first real pass", () => {
    const r = runPass(fresh(), snapOf([], { alerts: null }), PREFS, 0);
    expect(r.categories).toBeNull();
    expect(r.lastCategories).toBeUndefined();
    expect(runPass(fresh({ lastCategories: r.lastCategories }), snapOf([win()]), PREFS, 0).categories).not.toBeNull();
  });

  it("registers the category set even on a seeding-skipped first pass (empty windows, or mid-edit)", () => {
    expect(runPass(fresh(), snapOf([]), PREFS, 0).categories).not.toBeNull();
    expect(runPass(fresh({ editing: true }), snapOf([asks("p1")]), PREFS, 0).categories).not.toBeNull();
  });
});

describe("makeDelivery", () => {
  const io = () => ({ setNotifyCategories: vi.fn(async () => {}), notify: vi.fn() });

  it("doesn't notify before a queued registration resolves", async () => {
    let resolveReg;
    const d = io();
    d.setNotifyCategories.mockImplementation(() => new Promise((res) => { resolveReg = res; }));
    const deliver = makeDelivery(d);
    deliver([{ id: "done" }], [{ kind: "done" }]);
    await Promise.resolve();
    expect(d.notify).not.toHaveBeenCalled();
    resolveReg();
    await new Promise((r) => setTimeout(r));
    expect(d.notify).toHaveBeenCalledWith({ kind: "done" });
  });

  it("a second call's posts wait behind the first's registration", async () => {
    let resolveReg;
    const d = io();
    d.setNotifyCategories.mockImplementation(() => new Promise((res) => { resolveReg = res; }));
    const deliver = makeDelivery(d);
    deliver([{ id: "done" }], []);
    deliver(null, [{ kind: "later" }]);
    await Promise.resolve();
    expect(d.notify).not.toHaveBeenCalled();
    resolveReg();
    await new Promise((r) => setTimeout(r));
    expect(d.notify).toHaveBeenCalledWith({ kind: "later" });
  });

  it("posts go out, in order, when there's no set to register", async () => {
    const d = io();
    const deliver = makeDelivery(d);
    deliver(null, [{ kind: "a" }, { kind: "b" }]);
    await new Promise((r) => setTimeout(r));
    expect(d.notify.mock.calls.map((c) => c[0])).toEqual([{ kind: "a" }, { kind: "b" }]);
  });

  it("a rejecting registration doesn't stop later posts", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const d = io();
    d.setNotifyCategories.mockRejectedValueOnce(new Error("boom"));
    const deliver = makeDelivery(d);
    deliver([{ id: "done" }], []);
    deliver(null, [{ kind: "after" }]);
    await new Promise((r) => setTimeout(r));
    await new Promise((r) => setTimeout(r));
    expect(d.notify).toHaveBeenCalledWith({ kind: "after" });
    err.mockRestore();
  });
});
