// Pins the store side of the "once per applied state" contract (Task 11's
// deviation): poll.js's applyState bumps this once, after every signal it
// writes, so the notify feed can track just it. A full poll is hard to
// drive from a test, so this only pins the store export; the once-per-state
// behaviour itself is verified by hand (see the plan's manual checklist).
import { describe, expect, it } from "vitest";
import { stateSeq } from "../store.js";

describe("stateSeq", () => {
  it("starts at 0", () => {
    expect(stateSeq.value).toBe(0);
  });
});
