import { describe, expect, it } from "vitest";
import { filterRows, matchRefs, parseWalkthrough, sortRows, unresolvedTotal } from "../walkthrough.js";

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
  it("parses dunder and backticked refs from raw source", () => {
    const x = parseWalkthrough("# T\n\n## S\n> kind: reuse · refs: periscope/__init__.py:1-5, `a/b.py:3`\n\nbody\n");
    expect(x.stops[0].kind).toBe("reuse");
    expect(x.stops[0].refs.map((r) => r.raw)).toEqual(["periscope/__init__.py:1-5", "a/b.py:3"]);
    expect(x.stops[0].bodyMarkdown.trim()).toBe("body");
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
    expect(out.map((m) => m.generated)).toEqual([false, false, false, false]);
  });
  it("a generated file keeps its entry with no hunks and says so", () => {
    const gen = [...files, { path: "static/dist/app.js", hunks: [], generated: true }];
    const [m] = matchRefs([{ path: "static/dist/app.js", start: null, end: null, raw: "static/dist/app.js" }], gen);
    expect(m.file).toBe("static/dist/app.js");
    expect(m.hunks).toEqual([]);
    expect(m.generated).toBe(true);
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
  it("a live pane outranks a checkout outranks nothing local, whatever the D6 order says", () => {
    const rows = [
      row({ branch: "theirs-nowhere", role: "review-requested", pr: { number: 7, state: "open" } }),
      row({ branch: "unres-nowhere", unresolved: 2, walkthrough: { stops: 1 } }),
      row({ branch: "mine-wt", pr: { number: 3, state: "open" }, walkthrough: { stops: 1 }, worktree: "/wt" }),
      row({ branch: "local-pane", role: "local", owner: { name: "p" }, worktree: "/wt2" }),
      row({ branch: "merged-pane", pr: { number: 9, state: "merged" }, owner: { name: "p" } }),
      row({ branch: "unres-wt", unresolved: 1, walkthrough: { stops: 1 }, worktree: "/wt3" }),
    ];
    expect(sortRows(rows).map((r) => r.branch)).toEqual([
      "local-pane", "unres-wt", "mine-wt", "unres-nowhere", "theirs-nowhere", "merged-pane",
    ]);
  });
  it("a merged PR with unresolved comments still sorts last and is not counted", () => {
    const rows = [
      row({ branch: "m", pr: { number: 9, state: "merged" }, unresolved: 4 }),
      row({ branch: "o", pr: { number: 1, state: "open" }, walkthrough: { stops: 1 } }),
    ];
    expect(sortRows(rows).map((r) => r.branch)).toEqual(["o", "m"]);
    expect(unresolvedTotal(rows)).toBe(0);
  });
});

describe("unresolvedTotal", () => {
  it("sums open rows only", () => {
    const row = (o) => ({ pr: { state: "open" }, unresolved: 0, ...o });
    expect(unresolvedTotal([row({ unresolved: 2 }), row({ unresolved: 3 }), row({ pr: { state: "merged" }, unresolved: 9 })])).toBe(5);
    expect(unresolvedTotal(null)).toBe(0);
  });
});

describe("filterRows", () => {
  const rows = [
    { repo: "fdy", branch: "feat/restack", pr: { number: 8818, title: "Outcome restack", author: "sam" },
      owner: { name: "gauge-pane" }, linear_ticket: "FDY-8562" },
    { repo: "periscope", branch: "feat/queue", pr: { number: 45, title: "Queue search", author: "tdody" },
      owner: null, linked_linear: "THI-442", linked_linear_title: "Reviews tab improvements" },
    { repo: "periscope", branch: "feat/local", pr: null, owner: null },
  ];
  const branches = (q) => filterRows(rows, q).map((r) => r.branch);

  it("keeps every row, in order, for an empty or blank query", () => {
    expect(filterRows(rows, "")).toEqual(rows);
    expect(filterRows(rows, "   ")).toEqual(rows);
    expect(filterRows(null, "x")).toEqual([]);
  });
  it("matches each field the row shows", () => {
    expect(branches("feat/local")).toEqual(["feat/local"]);              // branch
    expect(branches("periscope")).toEqual(["feat/queue", "feat/local"]); // repo
    expect(branches("#8818")).toEqual(["feat/restack"]);                 // PR number
    expect(branches("search")).toEqual(["feat/queue"]);                  // PR title
    expect(branches("sam")).toEqual(["feat/restack"]);                   // PR author
    expect(branches("gauge")).toEqual(["feat/restack"]);                 // owner pane name
    expect(branches("fdy-8562")).toEqual(["feat/restack"]);              // derived ticket id
    expect(branches("thi-442")).toEqual(["feat/queue"]);                 // linked ticket id
    expect(branches("improvements")).toEqual(["feat/queue"]);            // linked ticket title
  });
  it("gives a row with no PR, owner or ticket nothing beyond its branch and repo", () => {
    expect(branches("#")).toEqual(["feat/restack", "feat/queue"]);
    expect(branches("undefined")).toEqual([]);
    expect(branches("null")).toEqual([]);
  });
  it("ignores case and needs every term", () => {
    expect(branches("QUEUE")).toEqual(["feat/queue"]);
    expect(branches("periscope local")).toEqual(["feat/local"]);
    expect(branches("periscope xyz")).toEqual([]);
  });
});
