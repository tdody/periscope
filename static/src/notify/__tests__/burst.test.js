import { describe, expect, it } from "vitest";
import { BURST_MS, planBurst, summaryPayload } from "../burst.js";

const ev = (kind, name) => ({ kind, w: { name, waiting_for: kind === "needs_input" ? "permission prompt" : null } });

describe("planBurst", () => {
  it("sends the first two needs-you banners at once and holds the rest", () => {
    const r = planBurst([ev("needs_input", "a"), ev("question", "b"), ev("needs_input", "c"), ev("needs_input", "d")], [], 0);
    expect(r.now.map((e) => e.w.name)).toEqual(["a", "b"]);
    expect(r.held.map((e) => e.w.name)).toEqual(["c", "d"]);
    expect(r.recent).toEqual([0, 0]);
  });

  it("counts what went out earlier in the window", () => {
    expect(planBurst([ev("needs_input", "c")], [0, 100], 1000).held).toHaveLength(1);
    expect(planBurst([ev("needs_input", "c")], [0, 100], BURST_MS + 200).now).toHaveLength(1);
  });

  it("never holds other kinds, nor anything with grouping off", () => {
    expect(planBurst([ev("done", "x"), ev("ci_failed", "y")], [0, 0], 10).now).toHaveLength(2);
    expect(planBurst([ev("needs_input", "x")], [0, 0], 10, false).now).toHaveLength(1);
  });
});

describe("summaryPayload", () => {
  it("lists one line per held pane with why it waits", () => {
    const p = summaryPayload([ev("needs_input", "c"), ev("question", "d")]);
    expect(p).toMatchObject({ kind: "summary", thread: "needs_you", target: "", title: "2 more sessions need you" });
    expect(p.body).toBe("● c · permission\n● d · question");
  });
});
