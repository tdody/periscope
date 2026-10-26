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
