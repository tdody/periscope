import { describe, expect, it } from "vitest";
import { waitKind } from "../../util.js";
import { firstSentence, payloadFor, prUrl } from "../copy.js";

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
});

describe("helpers", () => {
  it("firstSentence takes one sentence and clips it", () => {
    expect(firstSentence("Done. Next I'll refactor.")).toBe("Done.");
    expect(firstSentence("no full stop here")).toBe("no full stop here");
    expect(firstSentence("x".repeat(300)).length).toBe(140);
    expect(firstSentence(null)).toBe("");
  });

  it("prUrl needs both the repo and the number", () => {
    expect(prUrl({ repo_slug: "o/r", pr: 3 })).toBe("https://github.com/o/r/pull/3");
    expect(prUrl({ pr: 3 })).toBeNull();
  });

  it("waitKind sorts the raw waiting_for values", () => {
    expect(waitKind("permission prompt")).toBe("permission");
    expect(waitKind("Approve AskUserQuestion")).toBe("question");
    expect(waitKind("dialog open")).toBe("dialog");
    expect(waitKind(null)).toBeNull();
  });
});
