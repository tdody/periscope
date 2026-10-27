// What a banner's buttons are (categories) and what pressing one does
// (runAction). The shell side — registering the set, reporting a press — is
// cargo-tested in notifications.rs; the openers are injected here.
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../tauri.js", () => ({
  inTauri: () => false, notify: vi.fn(), onNotificationClick: vi.fn(), onNotificationOpened: vi.fn(),
  onNotificationAction: vi.fn(), openExternal: vi.fn(), setBadgeCount: vi.fn(), setNotifyCategories: vi.fn(async () => {}),
}));
const { windows } = await import("../../store.js");
const { categories, fixMessage, runAction, OPENERS } = await import("../actions.js");

const openers = () => ({
  openExternal: vi.fn(), openUsageDetails: vi.fn(), pickSpawnAccount: vi.fn(), openCleanupModal: vi.fn(),
  markReadySeen: vi.fn(), selectPane: vi.fn(), revealPane: vi.fn(),
  post: vi.fn(async () => ({ ok: true, status: 200, detail: "" })), toast: vi.fn(), notify: vi.fn(),
});

afterEach(() => {
  windows.value = [];
  vi.restoreAllMocks();
});

describe("categories", () => {
  it("gives every banner variant its buttons", () => {
    const byId = Object.fromEntries(categories().map((c) => [c.id, c.actions.map((a) => a.id)]));
    expect(byId).toEqual({
      done_seen: ["mark_seen"], ci_failed_pr: ["open_pr"],
      pr_merged: ["cleanup", "open_pr"], pr_merged_cleanup: ["cleanup"], pr_merged_pr: ["open_pr"], usage: ["details"],
      needs_permission: ["allow", "deny", "open"], needs_dialog: ["open"], question: ["send", "open"],
      ci_failed: ["fix", "open_pr"], ci_failed_fix: ["fix"],
    });
  });

  it("brings the app forward only for buttons that show something in it", () => {
    const fg = categories().flatMap((c) => c.actions).filter((a) => a.foreground).map((a) => a.id);
    expect(new Set(fg)).toEqual(new Set(["cleanup", "details", "open"]));
  });

  it("asks for Touch ID on every button that lets an agent proceed or types into it, and only those", () => {
    const auth = categories().flatMap((c) => c.actions).filter((a) => a.auth).map((a) => a.id);
    expect(new Set(auth)).toEqual(new Set(["allow", "send", "fix"]));
  });

  it("draws Deny red and gives Reply a text field", () => {
    const actions = Object.fromEntries(categories().flatMap((c) => c.actions).map((a) => [a.id, a]));
    expect(actions.deny.destructive).toBe(true);
    expect(actions.send).toMatchObject({ title: "Reply", reply: { button: "Send", placeholder: "Reply…" } });
  });

  it("adds one labelled Spawn on {B} category per move target, sorted", () => {
    const accounts = [{ id: "default", label: "A" }, { id: "b", label: "B" }, { id: "c", label: "C" }];
    const usage = categories({ accounts, moveTargets: { default: "c", b: "c", c: "b" } }).filter((c) => c.id.startsWith("usage_to_"));
    expect(usage.map((c) => c.id)).toEqual(["usage_to_b", "usage_to_c"]);
    expect(usage[1].actions.map((a) => [a.id, a.title])).toEqual([["spawn_on", "Spawn on C"], ["details", "Details"]]);
  });

  it("has no Spawn category without move targets", () => {
    const set = categories({ accounts: [{ id: "default", label: "A" }], moveTargets: {} });
    expect(set.some((c) => c.id.startsWith("usage_to_"))).toBe(false);
  });

  it("uses the raw id as a label when accounts lacks the target", () => {
    const usage = categories({ moveTargets: { default: "ghost" } }).find((c) => c.id === "usage_to_ghost");
    expect(usage.actions[0].title).toBe("Spawn on ghost");
  });

  it("is the same set whatever order move_targets arrive in", () => {
    const a = categories({ moveTargets: { x: "y", y: "x" } });
    const b = categories({ moveTargets: { y: "x", x: "y" } });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe("runAction", () => {
  it("the test double covers every real opener (so a new one can't be missed here)", () => {
    expect(Object.keys(openers()).sort()).toEqual(Object.keys(OPENERS).sort());
  });

  it("Open PR opens the PR in the browser", () => {
    const o = openers();
    runAction({ target: "s:1", action: "open_pr", data: { url: "https://github.com/o/r/pull/7" } }, o);
    expect(o.openExternal).toHaveBeenCalledWith("https://github.com/o/r/pull/7");
  });

  it("Open PR with no url selects the live pane, else reveals the banner's target", () => {
    const o = openers();
    windows.value = [{ pid: "p1", target: "s:4" }];
    runAction({ target: "s:1", action: "open_pr", data: { pid: "p1" } }, o);
    expect(o.selectPane).toHaveBeenCalledWith(windows.value[0]);
    expect(o.openExternal).not.toHaveBeenCalled();
    windows.value = [];
    runAction({ target: "s:1", action: "open_pr", data: {} }, o);
    expect(o.revealPane).toHaveBeenCalledWith("s:1");
  });

  it("Details opens the usage pill", () => {
    const o = openers();
    runAction({ target: "", action: "details", data: { open: "usage" } }, o);
    expect(o.openUsageDetails).toHaveBeenCalled();
  });

  it("Spawn on {B} pins spawns to the banner's B", () => {
    const o = openers();
    runAction({ target: "", action: "spawn_on", data: { open: "usage", spawn_to: "b" } }, o);
    expect(o.pickSpawnAccount).toHaveBeenCalledWith("b");
  });

  it("Spawn on with no destination calls no opener", () => {
    const o = openers();
    runAction({ target: "", action: "spawn_on", data: {} }, o);
    expect(Object.values(o).some((f) => f.mock.calls.length)).toBe(false);
  });

  it("Mark seen finds the pane by pid, and does nothing once it's gone", () => {
    const o = openers();
    windows.value = [{ pid: "p1", target: "s:4" }];
    runAction({ target: "s:1", action: "mark_seen", data: { pid: "p1" } }, o);
    expect(o.markReadySeen).toHaveBeenCalledWith(windows.value[0]);
    windows.value = [];
    runAction({ target: "s:1", action: "mark_seen", data: { pid: "p1" } }, o);
    expect(o.markReadySeen).toHaveBeenCalledTimes(1);
    expect(o.revealPane).not.toHaveBeenCalled();
  });

  it("Clean up names the banner's worktree over the live pane's, which beats a reveal", () => {
    const o = openers();
    // the live window's target deliberately differs from the banner's, so a pass can only come from the pid match.
    windows.value = [{ pid: "p1", target: "s:4", cwd: "/wt/live" }];
    runAction({ target: "s:1", action: "cleanup", data: { pid: "p1", cwd: "/wt/old" } }, o);
    expect(o.openCleanupModal).toHaveBeenLastCalledWith({ paths: ["/wt/old"] });
    runAction({ target: "s:1", action: "cleanup", data: { pid: "p1" } }, o);
    expect(o.openCleanupModal).toHaveBeenLastCalledWith({ paths: ["/wt/live"] });
    windows.value = [];
    runAction({ target: "s:1", action: "cleanup", data: { pid: "p1" } }, o);
    expect(o.revealPane).toHaveBeenCalledWith("s:1");
  });

  it("reveals the pane when an opener throws, and never throws itself", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const o = { ...openers(), openUsageDetails: () => { throw new Error("boom"); } };
    expect(() => runAction({ target: "s:1", action: "details", data: {} }, o)).not.toThrow();
    expect(o.revealPane).toHaveBeenCalledWith("s:1");
  });

  it("after a throw, selects the live pane by pid instead of revealing the banner's target", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    windows.value = [{ pid: "p1", target: "s:4" }];
    const o = { ...openers(), openUsageDetails: () => { throw new Error("boom"); } };
    runAction({ target: "s:1", action: "details", data: { pid: "p1" } }, o);
    expect(o.selectPane).toHaveBeenCalledWith(windows.value[0]);
    expect(o.revealPane).not.toHaveBeenCalled();
  });

  it("after a throw with no live pane and no target, reveals nothing", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const o = { ...openers(), openUsageDetails: () => { throw new Error("boom"); } };
    runAction({ target: "", action: "details", data: {} }, o);
    expect(o.selectPane).not.toHaveBeenCalled();
    expect(o.revealPane).not.toHaveBeenCalled();
  });

  it("never throws even when the catch's own reveal throws", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const o = {
      ...openers(),
      openUsageDetails: () => { throw new Error("boom"); },
      revealPane: () => { throw new Error("also boom"); },
    };
    expect(() => runAction({ target: "s:1", action: "details", data: {} }, o)).not.toThrow();
    expect(err).toHaveBeenCalledWith("[notify] reveal failed", expect.any(Error));
  });

  it("ignores an action it doesn't know, and tolerates null data from the shell", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const o = openers();
    runAction({ target: "s:1", action: "frobnicate", data: null }, o);
    expect(warn).toHaveBeenCalled();
    expect(Object.values(o).some((f) => f.mock.calls.length)).toBe(false);
  });
});

describe("runAction: the buttons that make an agent act", () => {
  const PERMISSION = { pid: "p1", request_id: "a1b2c3d4e5f60718" };

  it("Allow and Deny answer the banner's request on its pane", async () => {
    const o = openers();
    await runAction({ target: "s:1", action: "allow", data: PERMISSION }, o);
    expect(o.post).toHaveBeenLastCalledWith("/api/pane/permission", { ...PERMISSION, choice: "allow" });
    await runAction({ target: "s:1", action: "deny", data: PERMISSION }, o);
    expect(o.post).toHaveBeenLastCalledWith("/api/pane/permission", { ...PERMISSION, choice: "deny" });
    // Success shows nothing more: the pane's next state shows it working.
    // (selectPane alone would pass trivially here — no window matches PERMISSION's
    // pid — so revealPane is the assertion that actually catches a regression.)
    expect(o.selectPane).not.toHaveBeenCalled();
    expect(o.revealPane).not.toHaveBeenCalled();
    expect(o.toast).not.toHaveBeenCalled();
    expect(o.notify).not.toHaveBeenCalled();
  });

  it("a 409 (the banner went stale) shows the pane as it is now, without a toast", async () => {
    const o = { ...openers(), post: vi.fn(async () => ({ ok: false, status: 409, detail: "stale" })) };
    windows.value = [{ pid: "p1", target: "s:4" }];
    await runAction({ target: "s:1", action: "allow", data: PERMISSION }, o);
    expect(o.selectPane).toHaveBeenCalledWith(windows.value[0]);
    expect(o.toast).not.toHaveBeenCalled();
  });

  it("any other failure shows the pane and toasts the error", async () => {
    const o = { ...openers(), post: vi.fn(async () => ({ ok: false, status: 500, detail: "tmux died" })) };
    windows.value = [];
    await runAction({ target: "s:1", action: "deny", data: PERMISSION }, o);
    expect(o.revealPane).toHaveBeenCalledWith("s:1");
    expect(o.toast).toHaveBeenCalledWith("Deny failed: tmux died", "bad", 6000);
  });

  it("never rejects, even when the request itself throws; every failure still posts a notice", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const o = { ...openers(), post: vi.fn(async () => { throw new Error("boom"); }) };
    await expect(runAction({ target: "s:1", action: "allow", data: PERMISSION }, o)).resolves.toBeUndefined();
    expect(o.revealPane).toHaveBeenCalledWith("s:1");
    expect(o.notify).toHaveBeenCalled();
  });

  it("a banner without a pane has nothing to answer: it reveals instead, and still tells the user", async () => {
    const o = openers();
    await runAction({ target: "s:1", action: "allow", data: { request_id: "a1b2c3d4e5f60718" } }, o);
    expect(o.post).not.toHaveBeenCalled();
    expect(o.revealPane).toHaveBeenCalledWith("s:1");
    // A background press never fails silently, even one that never reaches the server.
    expect(o.notify).toHaveBeenCalledWith(expect.objectContaining({
      title: "Couldn't allow", body: "Open the pane to answer it.", target: "s:1",
    }));
  });

  it("a banner naming no request has nothing to answer either, like a missing pid: it reveals instead, and still tells the user", async () => {
    const o = openers();
    await runAction({ target: "s:1", action: "deny", data: { pid: "p1" } }, o);
    expect(o.post).not.toHaveBeenCalled();
    expect(o.revealPane).toHaveBeenCalledWith("s:1");
    expect(o.notify).toHaveBeenCalledWith(expect.objectContaining({
      title: "Couldn't deny", body: "Open the pane to answer it.", target: "s:1",
      data: { open: "pane", pid: "p1" },
    }));
  });

  it("Reply sends the typed text, trimmed; an empty reply does nothing", async () => {
    const o = openers();
    await runAction({ target: "s:1", action: "send", text: "  Postgres, please ", data: { pid: "p1" } }, o);
    expect(o.post).toHaveBeenCalledWith("/api/pane/reply", { pid: "p1", text: "Postgres, please" });
    o.post.mockClear();
    await runAction({ target: "s:1", action: "send", text: "   ", data: { pid: "p1" } }, o);
    await runAction({ target: "s:1", action: "send", data: { pid: "p1" } }, o);
    expect(Object.values(o).some((f) => f.mock.calls.length)).toBe(false);
  });

  it("Ask agent to fix tells the pane which checks failed on which PR", async () => {
    const o = openers();
    await runAction({ target: "s:1", action: "fix", data: { pid: "p1", pr: 7, checks: ["test", "lint"] } }, o);
    expect(o.post).toHaveBeenCalledWith("/api/pane/reply", {
      pid: "p1", text: "CI failed on #7: test · lint. Please investigate and fix.",
    });
    expect(fixMessage(7, [])).toBe("CI failed on #7: Checks are failing. Please investigate and fix.");
  });

  it("Ask agent to fix drops control characters from check names", () => {
    // An ESC[201~ would end the reply's bracketed paste and type the rest as keys.
    const msg = fixMessage(7, ["te\x1b[201~\r!rm -rf x", "\x1b\x07\x9b", "lint\x00"]);
    expect(msg).toBe("CI failed on #7: te[201~!rm -rf x · lint. Please investigate and fix.");
    expect(msg.includes("\x1b") || msg.includes("\r")).toBe(false);
  });

  it("Open shows the live pane, else reveals the banner's target", () => {
    const o = openers();
    windows.value = [{ pid: "p1", target: "s:4" }];
    runAction({ target: "s:1", action: "open", data: { pid: "p1" } }, o);
    expect(o.selectPane).toHaveBeenCalledWith(windows.value[0]);
    windows.value = [];
    runAction({ target: "s:1", action: "open", data: { pid: "p1" } }, o);
    expect(o.revealPane).toHaveBeenCalledWith("s:1");
  });
});

describe("runAction: every category's action is handled", () => {
  // The controller's cross-check: a new button added to categories() without
  // a runAction case would fall to "default" and warn, silently doing
  // nothing on a real press. Walk every action id any category can carry
  // (including a usage_to_* one, so spawn_on is in the set) and assert none
  // of them hit that default.
  it("every action id that categories() can register has a case (no unknown-action warning, no caught error)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const accounts = [{ id: "default", label: "A" }, { id: "b", label: "B" }];
    const ids = new Set(categories({ accounts, moveTargets: { default: "b" } }).flatMap((c) => c.actions.map((a) => a.id)));
    const data = {
      pid: "p1", request_id: "a1b2c3d4e5f60718", url: "https://github.com/o/r/pull/7",
      pr: 7, checks: ["test"], spawn_to: "b", cwd: "/wt", session: "s",
    };
    for (const action of ids) {
      await runAction({ target: "s:1", action, text: "hi", data }, openers());
    }
    expect(warn).not.toHaveBeenCalled();
    expect(err).not.toHaveBeenCalled();
  });
});

describe("runAction: the follow-up notice on a failed background press", () => {
  // show() and the toast land in a hidden window on these presses (the app
  // isn't foregrounded for them), so the notice is what the shell can
  // actually show: it needs body (the shell's NotifyRequest has no serde
  // default for it — a notice with none never parses) and target (so a click
  // still reveals a gone pane, the same fallback every copy.js banner has).
  const PERMISSION = { pid: "p1", request_id: "a1b2c3d4e5f60718" };
  const PERMISSION_409 = "The dialog changed — open the pane to answer it.";
  const REPLY_409 = "The pane has a dialog open, or isn't running an agent — open it to see why.";
  const CASES = [
    { action: "allow", evt: { target: "s:1", action: "allow", data: PERMISSION }, title: "Couldn't allow", route409: PERMISSION_409 },
    { action: "deny", evt: { target: "s:1", action: "deny", data: PERMISSION }, title: "Couldn't deny", route409: PERMISSION_409 },
    { action: "send", evt: { target: "s:1", action: "send", text: "hi", data: { pid: "p1" } }, title: "Couldn't send your reply", route409: REPLY_409 },
    { action: "fix", evt: { target: "s:1", action: "fix", data: { pid: "p1", pr: 7, checks: ["test"] } }, title: "Couldn't ask the agent to fix", route409: REPLY_409 },
  ];

  for (const { action, evt, title, route409 } of CASES) {
    it(`${action}: a 409 with no server reason gets the route's canned one, target set for a click on a gone pane`, async () => {
      const o = { ...openers(), post: vi.fn(async () => ({ ok: false, status: 409, detail: "HTTP 409" })) };
      await runAction(evt, o);
      expect(o.notify).toHaveBeenCalledWith({
        kind: "notice", thread: "notice", title, body: route409, target: "s:1",
        data: { open: "pane", pid: "p1" }, quiet_when_focused: true,
      });
    });

    it(`${action}: a 409 with the server's own reason uses that instead of the canned one`, async () => {
      const o = { ...openers(), post: vi.fn(async () => ({ ok: false, status: 409, detail: "another request already answered it" })) };
      await runAction(evt, o);
      expect(o.notify).toHaveBeenCalledWith(expect.objectContaining({ title, body: "another request already answered it" }));
    });

    it(`${action}: a 404 says the pane is gone, whatever the server's detail says`, async () => {
      const o = { ...openers(), post: vi.fn(async () => ({ ok: false, status: 404, detail: "HTTP 404" })) };
      await runAction(evt, o);
      expect(o.notify).toHaveBeenCalledWith(expect.objectContaining({ title, body: "The pane is gone." }));
    });

    it(`${action}: status 0 says Periscope isn't answering`, async () => {
      const o = { ...openers(), post: vi.fn(async () => ({ ok: false, status: 0, detail: "offline" })) };
      await runAction(evt, o);
      expect(o.notify).toHaveBeenCalledWith(expect.objectContaining({ title, body: "Periscope isn't answering." }));
    });

    it(`${action}: any other failure names the server's own reason, and still toasts it`, async () => {
      const o = { ...openers(), post: vi.fn(async () => ({ ok: false, status: 500, detail: "tmux died" })) };
      await runAction(evt, o);
      expect(o.notify).toHaveBeenCalledWith(expect.objectContaining({ title, body: "tmux died" }));
      expect(o.toast).toHaveBeenCalled();
    });
  }

  it("a success posts no notice", async () => {
    const o = openers();
    await runAction({ target: "s:1", action: "allow", data: PERMISSION }, o);
    expect(o.notify).not.toHaveBeenCalled();
  });

  it("a throwing toast still posts exactly one notice, with the route's reason intact (not the toast's own crash)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const o = {
      ...openers(),
      post: vi.fn(async () => ({ ok: false, status: 500, detail: "tmux died" })),
      toast: vi.fn(() => { throw new Error("toast crashed"); }),
    };
    await runAction({ target: "s:1", action: "deny", data: PERMISSION }, o);
    expect(o.notify).toHaveBeenCalledTimes(1);
    expect(o.notify).toHaveBeenCalledWith(expect.objectContaining({ title: "Couldn't deny", body: "tmux died" }));
  });

  it("a throwing show() still posts exactly one notice, with the route's reason intact (not the show()'s own crash)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const o = {
      ...openers(),
      post: vi.fn(async () => ({ ok: false, status: 409, detail: "HTTP 409" })),
      selectPane: vi.fn(() => { throw new Error("selectPane crashed"); }),
    };
    windows.value = [{ pid: "p1", target: "s:4" }];
    await runAction({ target: "s:1", action: "allow", data: PERMISSION }, o);
    expect(o.notify).toHaveBeenCalledTimes(1);
    expect(o.notify).toHaveBeenCalledWith(expect.objectContaining({
      title: "Couldn't allow", body: "The dialog changed — open the pane to answer it.",
    }));
  });

  it("every notice payload has a string title and a string body (the shell's NotifyRequest requires both)", async () => {
    const statuses = [
      { status: 409, detail: "stale" }, { status: 409, detail: "HTTP 409" },
      { status: 404, detail: "HTTP 404" }, { status: 0, detail: "offline" }, { status: 500, detail: "tmux died" },
    ];
    for (const { evt } of CASES) {
      for (const s of statuses) {
        const o = { ...openers(), post: vi.fn(async () => ({ ok: false, ...s })) };
        await runAction(evt, o);
        expect(o.notify).toHaveBeenCalledTimes(1);
        const payload = o.notify.mock.calls[0][0];
        expect(typeof payload.title).toBe("string");
        expect(typeof payload.body).toBe("string");
      }
    }
  });

  // The notice's click routing (data.open: "pane", target as its fallback) is
  // the same shape copy.js's needs_input banner already uses; feed.test.js's
  // openFromBanner suite covers selecting the pane by pid or revealing the
  // target from it.
});
