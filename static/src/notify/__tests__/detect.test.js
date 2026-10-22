import { describe, expect, it } from "vitest";
import { detect, prKey } from "../detect.js";

const NOW = 1_000_000;
const win = (over = {}) => ({
  pid: "p1", target: "s:1", session: "s", name: "pane", branch: "b", state: "idle",
  focused_at: 0, acted_at: 0, ...over,
});
const ask = (over = {}) => ({ id: "a1", kind: "need_human", target: "s:1", ts: NOW - 5, message: "which db?", ...over });
const meter = (over = {}) => ({ percent: 40, resets_at: NOW + 3600, hot: false, ...over });
const plan = (meters, over = {}) => ({ default: { available: true, fetched_at: NOW - 60, meters, ...over } });

// Seed with `before`, then return the events `after` announces.
function step(before, after) {
  const seeded = detect(null, before, NOW).state;
  return detect(seeded, after, NOW);
}
const kinds = (r) => r.events.map((e) => e.kind);

describe("detect", () => {
  it("announces nothing on the first snapshot, whatever is already there", () => {
    const r = detect(null, { windows: [win({ state: "needs-input" }), win({ pid: "p2", state: "done" })], alerts: [ask()] }, NOW);
    expect(r.events).toEqual([]);
  });

  it("announces each needs-input episode once", () => {
    const waiting = { windows: [win({ state: "needs-input", needs_since: 100 })] };
    const r = step({ windows: [win()] }, waiting);
    expect(kinds(r)).toEqual(["needs_input"]);
    expect(detect(r.state, waiting, NOW).events).toEqual([]);
    // A new episode of the same pane is new news.
    expect(kinds(detect(r.state, { windows: [win({ state: "needs-input", needs_since: 200 })] }, NOW))).toEqual(["needs_input"]);
  });

  it("announces an agent's question, but not alongside the same pane's dialog", () => {
    expect(kinds(step({ windows: [win()], alerts: [] }, { windows: [win()], alerts: [ask()] }))).toEqual(["question"]);
    const both = { windows: [win({ state: "needs-input" })], alerts: [ask()] };
    expect(kinds(step({ windows: [win()], alerts: [] }, both))).toEqual(["needs_input"]);
  });

  it("skips dismissed and acked questions", () => {
    const before = { windows: [win()], alerts: [] };
    expect(step(before, { windows: [win()], alerts: [ask()], dismissedAlertIds: new Set(["a1"]) }).events).toEqual([]);
    expect(step(before, { windows: [win({ focused_at: NOW })], alerts: [ask()] }).events).toEqual([]);
  });

  it("announces each finished turn once, unless its READY row was dismissed", () => {
    const done = { windows: [win({ state: "done", completed_at: 500 })] };
    expect(kinds(step({ windows: [win()] }, done))).toEqual(["done"]);
    expect(step({ windows: [win()] }, { ...done, dismissedReadyPids: new Set(["p1"]) }).events).toEqual([]);
  });

  it("announces CI turning red on an open PR, once per transition", () => {
    const pr = (ci, over = {}) => ({ windows: [win({ pr: 7, repo_slug: "o/r", ci, ...over })] });
    const r = step(pr("⟳"), pr("✗"));
    expect(kinds(r)).toEqual(["ci_failed"]);
    expect(detect(r.state, pr("✗"), NOW).events).toEqual([]);
    // Re-run, red again: a new failure.
    const green = detect(r.state, pr("⟳"), NOW).state;
    expect(kinds(detect(green, pr("✗"), NOW))).toEqual(["ci_failed"]);
    // A PR first seen red, or a closed one, says nothing.
    expect(step({ windows: [] }, pr("✗")).events).toEqual([]);
    expect(step(pr("⟳", { pr_state: "closed" }), pr("✗", { pr_state: "closed" })).events).toEqual([]);
  });

  it("counts a PR once however many panes show it", () => {
    const panes = (ci) => ({ windows: [win({ pr: 7, repo_slug: "o/r", ci }), win({ pid: "p2", target: "s:2", pr: 7, repo_slug: "o/r", ci })] });
    expect(kinds(step(panes("⟳"), panes("✗")))).toEqual(["ci_failed"]);
  });

  it("announces a linked PR merging, and keeps a PR missing from a poll", () => {
    const linked = (pr_state) => ({ windows: [win({ pr: 7, repo_slug: "o/r", pr_state })] });
    expect(kinds(step(linked("open"), linked("merged")))).toEqual(["pr_merged"]);
    const gone = detect(detect(null, linked("open"), NOW).state, { windows: [] }, NOW).state;
    expect(kinds(detect(gone, linked("merged"), NOW))).toEqual(["pr_merged"]);
    expect(step({ windows: [] }, linked("merged")).events).toEqual([]);
  });

  it("announces a meter getting worse once per mood step per reset window", () => {
    const at = (m) => ({ plan: plan({ week_all: m }) });
    const grumpy = meter({ projected_percent: 120 });
    const r = step(at(meter()), at(grumpy));
    expect(r.events.map((e) => e.mood)).toEqual(["grumpy"]);
    // Flapping back to calm and up again doesn't re-arm.
    const calm = detect(r.state, at(meter()), NOW).state;
    expect(detect(calm, at(grumpy), NOW).events).toEqual([]);
    // Furious is the next step.
    expect(detect(calm, at(meter({ hot: true })), NOW).events.map((e) => e.mood)).toEqual(["furious"]);
    // A new reset window starts over.
    const next = meter({ projected_percent: 120, resets_at: NOW + 99999 });
    expect(detect(calm, at(next), NOW).events.map((e) => e.mood)).toEqual(["grumpy"]);
  });

  it("leaves stale and unavailable accounts out of usage", () => {
    const hot = meter({ hot: true });
    expect(step({ plan: plan({ s: meter() }) }, { plan: plan({ s: hot }, { fetched_at: NOW - 9999 }) }).events).toEqual([]);
    expect(step({ plan: plan({ s: meter() }) }, { plan: plan({ s: hot }, { available: false }) }).events).toEqual([]);
  });

  it("resumes from a saved state: news that arrived meanwhile is announced once", () => {
    const saved = detect(null, { windows: [win()] }, NOW).state;
    const after = { windows: [win({ state: "needs-input", needs_since: 9 })] };
    const r = detect(JSON.parse(JSON.stringify(saved)), after, NOW);
    expect(kinds(r)).toEqual(["needs_input"]);
    expect(detect(r.state, after, NOW).events).toEqual([]);
  });

  it("keeps only live keys, so the state prunes itself", () => {
    const r = step({ windows: [win()] }, { windows: [win({ state: "needs-input", needs_since: 1 })] });
    expect(Object.keys(detect(r.state, { windows: [win()] }, NOW).state.seen)).toEqual([]);
  });

  it("keys a PR by repo and number", () => {
    expect(prKey({ repo_slug: "o/r", pr: 7 })).toBe("o/r#7");
    expect(prKey({ repo_key: "/x", pr: 7 })).toBe("/x#7");
  });
});
