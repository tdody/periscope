import { describe, expect, it } from "vitest";
import { matchRefs, parseWalkthrough, sortRows } from "../walkthrough.js";

const DOC = `# Cost gauge

> branch: feat/x · head: 3f2a1c9 · pr: 1234
> repo: fdy

Panes cost more and nothing said so.

## Adds a gauge
> kind: new-subsystem · refs: periscope/cost_pressure.py, static/src/split/ctxBand.js:1-40

Prose one.

## Adds a gauge
> kind: reuse

Prose two.

## No meta here

Prose three.
`;

describe("parseWalkthrough", () => {
  const w = parseWalkthrough(DOC);
  it("reads the header and problem", () => {
    expect(w.title).toBe("Cost gauge");
    expect(w.header).toEqual({ branch: "feat/x", head: "3f2a1c9", pr: 1234, repo: "fdy" });
    expect(w.problem).toBe("Panes cost more and nothing said so.");
  });
  it("splits stops with kind, refs, body, and deduped ids", () => {
    expect(w.stops.map((s) => s.id)).toEqual(["adds-a-gauge", "adds-a-gauge-2", "no-meta-here"]);
    expect(w.stops[0].kind).toBe("new-subsystem");
    expect(w.stops[0].refs.map((r) => r.raw)).toEqual(["periscope/cost_pressure.py", "static/src/split/ctxBand.js:1-40"]);
    expect(w.stops[0].bodyMarkdown.trim()).toBe("Prose one.");
    expect(w.stops[2].kind).toBeNull();
    expect(w.stops[2].refs).toEqual([]);
    expect(w.stops[2].bodyMarkdown.trim()).toBe("Prose three.");
  });
  it("tolerates a missing header", () => {
    expect(parseWalkthrough("# T\n\nhi\n\n## S\n\nb").header).toBeNull();
  });
});

describe("matchRefs", () => {
  const files = [
    { path: "a.py", hunks: [
      { new_start: 1, lines: [{ kind: "ctx" }, { kind: "add" }, { kind: "del" }] },   // new-side 1-2
      { new_start: 40, lines: [{ kind: "add" }, { kind: "add" }] },                   // 40-41
    ] },
    { path: "b.py", hunks: [{ new_start: 5, lines: [{ kind: "ctx" }] }] },
  ];
  it("whole file, intersecting range, no match", () => {
    const out = matchRefs([
      { path: "a.py", start: null, end: null, raw: "a.py" },
      { path: "a.py", start: 41, end: 60, raw: "a.py:41-60" },
      { path: "a.py", start: 3, end: 39, raw: "a.py:3-39" },
      { path: "c.py", start: null, end: null, raw: "c.py" },
    ], files);
    expect(out[0].hunks.length).toBe(2);
    expect(out[1].hunks.map((h) => h.new_start)).toEqual([40]);
    expect(out[2].hunks).toEqual([]);
    expect(out[3].file).toBeNull();
  });
});

describe("sortRows", () => {
  const row = (o) => ({ repo: "r", branch: "b", role: "mine", pr: null, walkthrough: null, unresolved: 0, ...o });
  it("orders unresolved, review-requested, PR-without-walkthrough, rest, local, merged", () => {
    const rows = [
      row({ branch: "local", role: "local" }),
      row({ branch: "mine-walk", pr: { number: 3, state: "open" }, walkthrough: { stops: 1 } }),
      row({ branch: "merged", pr: { number: 9, state: "merged" } }),
      row({ branch: "prnowalk", pr: { number: 5, state: "open" } }),
      row({ branch: "theirs", role: "review-requested", pr: { number: 7, state: "open" } }),
      row({ branch: "unres", unresolved: 2, walkthrough: { stops: 1 } }),
      row({ branch: "prnowalk-hi", pr: { number: 8, state: "open" } }),
    ];
    expect(sortRows(rows).map((r) => r.branch)).toEqual([
      "unres", "theirs", "prnowalk-hi", "prnowalk", "mine-walk", "local", "merged",
    ]);
  });
});
