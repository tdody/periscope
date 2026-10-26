// What clicking a live NEEDS YOU / READY row does — shared by the rail and the
// header's Clawd (split/alertFeed.js), so the two can't drift on dismissals.

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../prefs.js", () => ({ setLastSelected: vi.fn() }));

const { dismissedNeedsPids, dismissedReadyPids, railSelection } = await import("../../store.js");
const { markReadySeen, openNeedsPane, openReadyPane, selectReview } = await import("../alertFeed.js");
const prefs = await import("../../prefs.js");

afterEach(() => {
  dismissedNeedsPids.value = new Set();
  dismissedReadyPids.value = new Set();
  railSelection.value = null;
});

describe("row clicks shared by the rail and Clawd", () => {
  it("dismisses a soft question for this episode and selects its pane", () => {
    openNeedsPane({ pid: "a", asked_question: true, waiting_for: null });
    expect([...dismissedNeedsPids.value]).toEqual(["a"]);
    expect(railSelection.value).toBe("pane:a");
  });

  it("keeps a real dialog sticky", () => {
    openNeedsPane({ pid: "b", asked_question: false, waiting_for: "permission" });
    expect(dismissedNeedsPids.value.size).toBe(0);
    expect(railSelection.value).toBe("pane:b");
  });

  it("always dismisses a done row", () => {
    openReadyPane({ pid: "c" });
    expect([...dismissedReadyPids.value]).toEqual(["c"]);
    expect(railSelection.value).toBe("pane:c");
  });

  it("does nothing for a pane that has gone", () => {
    openNeedsPane(null);
    openReadyPane(null);
    expect(dismissedReadyPids.value.size).toBe(0);
    expect(railSelection.value).toBe(null);
  });
});

describe("what a done banner's buttons do", () => {
  it("Mark seen dismisses the READY row without opening the pane", () => {
    markReadySeen({ pid: "c" });
    expect([...dismissedReadyPids.value]).toEqual(["c"]);
    expect(railSelection.value).toBe(null);
    markReadySeen(null);
    expect(dismissedReadyPids.value.size).toBe(1);
  });

  it("Review diff selects the session's review row and remembers it", () => {
    selectReview("periscope");
    expect(railSelection.value).toBe("review:periscope");
    expect(prefs.setLastSelected).toHaveBeenCalledWith({ kind: "review", worktree: "periscope" });
    railSelection.value = null;
    selectReview("");
    expect(railSelection.value).toBe(null);
  });
});
