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
