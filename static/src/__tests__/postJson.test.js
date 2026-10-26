// postJson: the status-aware POST behind the banner buttons that make an
// agent act (notify/actions.js), where a 409 is an answer, not an error to toast.
import { afterEach, describe, expect, it, vi } from "vitest";
import { postJson } from "../util.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("postJson", () => {
  it("sends a JSON body and reports the status", async () => {
    const spy = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) }));
    vi.stubGlobal("fetch", spy);
    expect(await postJson("/api/pane/reply", { pid: "p1", text: "hi" })).toEqual({ ok: true, status: 200, detail: "HTTP 200" });
    expect(spy).toHaveBeenCalledWith("/api/pane/reply", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pid: "p1", text: "hi" }),
    });
  });

  it("hands back a refusal's status and detail instead of toasting", async () => {
    vi.stubGlobal("fetch", async () => ({ ok: false, status: 409, json: async () => ({ detail: "stale" }) }));
    expect(await postJson("/x", {})).toEqual({ ok: false, status: 409, detail: "stale" });
  });

  it("says the status for a validation error's list detail", async () => {
    vi.stubGlobal("fetch", async () => ({ ok: false, status: 422, json: async () => ({ detail: [{ msg: "x" }] }) }));
    expect((await postJson("/x", {})).detail).toBe("HTTP 422");
  });

  it("tolerates a body that isn't JSON", async () => {
    vi.stubGlobal("fetch", async () => ({ ok: false, status: 500, json: async () => { throw new Error("html"); } }));
    expect(await postJson("/x", {})).toEqual({ ok: false, status: 500, detail: "HTTP 500" });
  });

  it("never throws: a network failure is status 0", async () => {
    vi.stubGlobal("fetch", async () => { throw new Error("offline"); });
    expect(await postJson("/x", {})).toEqual({ ok: false, status: 0, detail: "offline" });
  });
});
