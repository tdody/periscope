// What a click on Clawd does: each action through the rail's own row
// behaviour, and the double-click rule (clawdClick.js).

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../split/alertFeed.js", () => ({
  openNeedsPane: vi.fn(), openReadyPane: vi.fn(), revealPane: vi.fn(), selectPane: vi.fn(),
}));
vi.mock("../clawdWatch.js", () => ({ endParty: vi.fn() }));
vi.mock("../UpdatePill.jsx", () => ({ openUpdatePopover: vi.fn() }));

const feed = await import("../../split/alertFeed.js");
const { endParty } = await import("../clawdWatch.js");
const { openUpdatePopover } = await import("../UpdatePill.jsx");
const { windows } = await import("../../store.js");
const { actOn, clickHandlers, DBLCLICK_MS } = await import("../clawdClick.js");

const a = { pid: "a", target: "s:4" };

afterEach(() => {
  vi.clearAllMocks();
  windows.value = [];
});

describe("actOn", () => {
  it("opens a live NEEDS YOU / READY row the rail's way, finding the pane by pid now", () => {
    windows.value = [a];
    actOn({ action: "needs", pid: "a" });
    expect(feed.openNeedsPane).toHaveBeenCalledWith(a);
    actOn({ action: "ready", pid: "a" });
    expect(feed.openReadyPane).toHaveBeenCalledWith(a);
  });

  it("reveals an event row's pane by its target, as the rail's event row does", () => {
    actOn({ action: "reveal", target: "s:9" });
    expect(feed.revealPane).toHaveBeenCalledWith("s:9");
  });

  it("selects a pane, or nothing when it has gone", () => {
    windows.value = [a];
    actOn({ action: "select", pid: "a" });
    expect(feed.selectPane).toHaveBeenLastCalledWith(a);
    actOn({ action: "select", pid: "gone" });
    expect(feed.selectPane).toHaveBeenLastCalledWith(null);
  });

  it("ends a party, opening its pane if it's still there", () => {
    windows.value = [a];
    actOn({ action: "party", key: "a#9", pid: "a" });
    expect(endParty).toHaveBeenCalledWith("a#9");
    expect(feed.selectPane).toHaveBeenLastCalledWith(a);
    actOn({ action: "party", key: "b#3", pid: null });
    expect(endParty).toHaveBeenLastCalledWith("b#3");
  });

  it("opens the update pill's own popover, focused", () => {
    actOn({ action: "update" });
    expect(openUpdatePopover).toHaveBeenCalledWith({ focus: true });
  });
});

describe("clickHandlers", () => {
  const setup = (target) => {
    const act = vi.fn();
    const pet = vi.fn();
    const timers = [];
    const h = clickHandlers({
      target: () => target, pet, act,
      schedule: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
      cancel: (id) => { if (id) timers[id - 1].fn = null; },
    });
    return { h, act, pet, timers };
  };

  it("pets when nothing is pending", () => {
    const { h, act, pet } = setup(null);
    h.onClick({ detail: 1 });
    expect(pet).toHaveBeenCalledTimes(1);
    expect(act).not.toHaveBeenCalled();
  });

  it("acts at once on a pane, and never twice for a double-click", () => {
    const t = { action: "select", pid: "a" };
    const { h, act, pet } = setup(t);
    h.onClick({ detail: 1 });
    h.onClick({ detail: 2 });
    h.onDblClick();
    expect(act).toHaveBeenCalledTimes(1);
    expect(act).toHaveBeenCalledWith(t);
    expect(pet).toHaveBeenCalledTimes(1);
  });

  it("waits out a double-click before opening the update popover, and a double-click cancels it", () => {
    const t = { action: "update" };
    const { h, act, timers } = setup(t);
    h.onClick({ detail: 1 });
    expect(act).not.toHaveBeenCalled();
    expect(timers[0].ms).toBe(DBLCLICK_MS);
    h.onDblClick();
    expect(timers[0].fn).toBe(null);
    h.onClick({ detail: 1 });
    timers[1].fn();
    expect(act).toHaveBeenCalledWith(t);
  });
});
