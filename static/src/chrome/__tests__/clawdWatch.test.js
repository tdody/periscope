// The merge watch's side effect (clawdWatch.js): a PR seen going open →
// merged books the evening's pint, noted once, with the minute it was seen.
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../prefs.js", () => ({ noteClawdDay: vi.fn() }));
const { noteClawdDay } = await import("../../prefs.js");
const { windows } = await import("../../store.js");
const { mergeParties, startClawdWatch } = await import("../clawdWatch.js");
const { noteKey } = await import("../tamagotchi.js");

afterEach(() => {
  vi.useRealTimers();
});

describe("startClawdWatch", () => {
  it("notes a merge once, when its party starts, not on the first sighting or the polls after", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 21, 14, 7));
    const pane = (pr_state) => ({ pid: "a", target: "s:1", pr: 9, pr_state });
    windows.value = [pane("open")];
    startClawdWatch();
    expect(noteClawdDay).not.toHaveBeenCalled();
    windows.value = [pane("merged")];
    expect(mergeParties.value).toHaveLength(1);
    expect(noteClawdDay).toHaveBeenCalledTimes(1);
    expect(noteClawdDay).toHaveBeenCalledWith("merged", noteKey(new Date(2026, 9, 21, 14, 7)));
    windows.value = [pane("merged")]; // the next poll: same party
    expect(noteClawdDay).toHaveBeenCalledTimes(1);
  });
});
