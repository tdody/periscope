import { describe, expect, it } from "vitest";
import { waitKind } from "../../util.js";
import { firstSentence, payloadFor } from "../copy.js";

const LONE_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])/;

const w = (over = {}) => ({ pid: "p1", target: "s:1", session: "periscope", name: "dual-moas", branch: "main", ...over });

describe("payloadFor", () => {
  it("words a needs-input banner by what the pane waits on", () => {
    const p = payloadFor({ kind: "needs_input", w: w({ waiting_for: "permission prompt" }) });
    expect(p).toMatchObject({
      kind: "needs_input", thread: "needs_input", target: "s:1", title: "dual-moas needs you",
      subtitle: "periscope · main", body: "Waiting for your approval.", data: { open: "pane", pid: "p1" },
    });
    expect(payloadFor({ kind: "needs_input", w: w({ waiting_for: "approve AskUserQuestion" }) }).body).toBe("Waiting for your answer.");
    expect(payloadFor({ kind: "needs_input", w: w() }).body).toBe("Waiting for your input.");
  });

  it("clips a long pane name so the verb survives macOS's truncation", () => {
    const p = payloadFor({ kind: "needs_input", w: w({ name: "a-really-long-pane-name-that-goes-on-and-on" }) });
    expect(p.title.length).toBeLessThanOrEqual(40);
    expect(p.title.endsWith("… needs you")).toBe(true);
  });

  it("clips a pane name by code point, never splitting a surrogate pair", () => {
    // 26-char clip cuts after the 24 a's, right where the emoji (a surrogate
    // pair) starts: a code-unit slice would take the a's plus the emoji's
    // lone high surrogate, which is exactly the bug this guards against.
    const p = payloadFor({ kind: "needs_input", w: w({ name: `${"a".repeat(24)}😀bbbb` }) });
    expect(LONE_SURROGATE.test(p.title)).toBe(false);
  });

  it("carries the agent's question, even for a pane that has gone", () => {
    const alert = { target: "gone:2", name: "old", session: "s", message: "Which database should I use?" };
    expect(payloadFor({ kind: "question", w: w(), alert })).toMatchObject({ title: "dual-moas asks", body: "Which database should I use?" });
    expect(payloadFor({ kind: "question", w: null, alert })).toMatchObject({ title: "old asks", subtitle: "s", target: "gone:2" });
  });

  it("names the PR a finished pane opened, and its last sentence", () => {
    const p = payloadFor({ kind: "done", w: w({ pr: 29, recap: "Opened the PR. Tests pass." }) });
    expect(p).toMatchObject({ title: "dual-moas is done", subtitle: "periscope · PR #29 opened", body: "Opened the PR." });
    expect(payloadFor({ kind: "done", w: w() }).body).toBe("Finished.");
  });

  it("lists the failing checks first and links the PR", () => {
    const p = payloadFor({
      kind: "ci_failed",
      w: w({ pr: 7, repo_slug: "o/r", ci_checks: [{ name: "test", state: "failure" }, { name: "lint", state: "success" }] }),
    });
    expect(p).toMatchObject({
      title: "CI failed on #7", subtitle: "periscope · dual-moas", body: "✗ test · ✓ lint",
      data: { open: "url", url: "https://github.com/o/r/pull/7" },
    });
    expect(payloadFor({ kind: "ci_failed", w: w({ pr: 7 }) }).body).toBe("Checks are failing.");
  });

  it("links the PR through util's prUrl, null without a repo_slug", () => {
    expect(payloadFor({ kind: "ci_failed", w: w({ pr: 7 }) }).data.url).toBeNull();
    expect(payloadFor({ kind: "ci_failed", w: w({ pr: 7, repo_slug: "o/r" }) }).data.url).toBe("https://github.com/o/r/pull/7");
  });

  it("shows where a merged PR went", () => {
    const p = payloadFor({ kind: "pr_merged", w: w({ pr: 7, repo_slug: "o/r", branch: "feat", pr_base: "main" }) });
    expect(p).toMatchObject({ title: "PR #7 merged", subtitle: "periscope · feat → main" });
  });

  it("names the account and its working sessions only when there are several accounts", () => {
    const ev = { kind: "usage", account: "b", meter: "week_all", m: { percent: 81.4, projected_percent: 112 }, mood: "grumpy" };
    const windows = [w({ state: "working", account: "b" }), w({ state: "working", account: "default" }), w({ state: "idle", account: "b" })];
    const two = [{ id: "default", label: "A" }, { id: "b", label: "B" }];
    expect(payloadFor(ev, { accounts: two, windows })).toMatchObject({
      title: "Account B is running hot", subtitle: "week usage 81% · →112% at reset", body: "1 session working on B.",
      target: "", data: { open: "usage" },
    });
    expect(payloadFor(ev, { accounts: [{ id: "b", label: "B" }], windows })).toMatchObject({
      title: "Usage is running hot", body: "1 session working.",
    });
    expect(payloadFor({ ...ev, m: { percent: 99, hot: true } }, { accounts: two }).subtitle).toBe("week usage 99%");
  });

  it("clips a long account label in the usage title", () => {
    const ev = { kind: "usage", account: "b", meter: "week_all", m: { percent: 10 } };
    const accounts = [{ id: "b", label: "A Really Long Account Label" }, { id: "default", label: "A" }];
    const p = payloadFor(ev, { accounts, windows: [] });
    expect(p.title).toBe("Account A Really Long A… is running hot");
  });

  it("renders 0% when the meter's percent is undefined", () => {
    const ev = { kind: "usage", account: "default", meter: "week_all", m: {} };
    expect(payloadFor(ev, { accounts: [{ id: "default", label: "A" }] }).subtitle).toBe("week usage 0%");
  });

  it("says 0 sessions working when a multi-account setup has no working sessions", () => {
    const ev = { kind: "usage", account: "b", meter: "week_all", m: { percent: 50 } };
    const two = [{ id: "default", label: "A" }, { id: "b", label: "B" }];
    expect(payloadFor(ev, { accounts: two, windows: [] }).body).toBe("0 sessions working on B.");
  });

  it("falls back to the raw account id when it's missing from ctx.accounts", () => {
    const ev = { kind: "usage", account: "ghost", meter: "week_all", m: { percent: 50 } };
    const two = [{ id: "default", label: "A" }, { id: "b", label: "B" }];
    expect(payloadFor(ev, { accounts: two, windows: [] }).title).toBe("Account ghost is running hot");
  });
});

describe("helpers", () => {
  it("firstSentence takes one sentence and clips it", () => {
    expect(firstSentence("Done. Next I'll refactor.")).toBe("Done.");
    expect(firstSentence("no full stop here")).toBe("no full stop here");
    expect(firstSentence("x".repeat(300)).length).toBe(140);
    expect(firstSentence(null)).toBe("");
  });

  it("firstSentence doesn't cut at an abbreviation's period", () => {
    expect(firstSentence("Fixed the bug in e.g. the parser module. Tests now pass.")).toBe(
      "Fixed the bug in e.g. the parser module.",
    );
  });

  it("firstSentence also cuts at a sentence-ending !", () => {
    expect(firstSentence("Shipped it! Tests pass.")).toBe("Shipped it!");
  });

  it("waitKind sorts the raw waiting_for values", () => {
    expect(waitKind("permission prompt")).toBe("permission");
    expect(waitKind("Approve AskUserQuestion")).toBe("question");
    expect(waitKind("dialog open")).toBe("dialog");
    expect(waitKind(null)).toBeNull();
  });
});
