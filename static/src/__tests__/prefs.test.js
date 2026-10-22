// Clawd's day log (prefs.noteClawdDay): what the evening is booked from, so
// a note mustn't drop the other kind's, rewrite today's, or write state.json
// again on every re-run of the effect that notes it. Mocked at the network
// boundary: fetch for the boot load, apiCall for the PATCH.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../util.js", () => ({ apiCall: vi.fn() }));
const { apiCall } = await import("../util.js");
const prefs = await import("../prefs.js");

let server;
beforeEach(() => {
  prefs.prefsSignal.value = { loaded: false, ui: {}, windows: {}, commands: [] };
  server = { clawd_merged: "2026-10-21T11:00" };
  vi.stubGlobal("localStorage", { getItem: () => null });
  vi.stubGlobal("fetch", async () => ({ ok: true, json: async () => ({ ui: { ...server } }) }));
  // The server's top-level merge (store.update_ui), echoed back.
  apiCall.mockImplementation(async (_label, _path, opts) => {
    Object.assign(server, JSON.parse(opts.body));
    return { ok: true, ui: { ...server } };
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("noteClawdDay", () => {
  it("writes only its own kind, so it can't drop the other kind's note", async () => {
    await prefs.loadPrefs();
    expect(await prefs.noteClawdDay("furious", "2026-10-21T14:30")).toBe(true);
    expect(apiCall).toHaveBeenCalledTimes(1);
    const [, path, opts] = apiCall.mock.calls[0];
    expect([path, opts.method]).toEqual(["/api/prefs/ui", "PATCH"]);
    expect(JSON.parse(opts.body)).toEqual({ clawd_furious: "2026-10-21T14:30" });
    expect(prefs.getClawdDay()).toEqual({ merged: "2026-10-21T11:00", furious: "2026-10-21T14:30" });
  });

  it("notes each kind once a day: a later note neither writes nor moves the first", async () => {
    await prefs.loadPrefs();
    await prefs.noteClawdDay("furious", "2026-10-21T14:30");
    expect(await prefs.noteClawdDay("furious", "2026-10-21T17:40")).toBe(false);
    expect(await prefs.noteClawdDay("merged", "2026-10-21T17:45")).toBe(false);
    expect(apiCall).toHaveBeenCalledTimes(1);
    expect(prefs.getClawdDay()).toEqual({ merged: "2026-10-21T11:00", furious: "2026-10-21T14:30" });
    expect(await prefs.noteClawdDay("merged", "2026-10-22T09:10")).toBe(true);
    expect(prefs.getClawdDay().merged).toBe("2026-10-22T09:10");
  });

  it("adopts the day's first note the server kept, when another window noted it first", async () => {
    await prefs.loadPrefs();
    // Another window notes 17:29 after this one loaded; the server keeps the
    // day's first (routes/prefs.py).
    server.clawd_furious = "2026-10-21T17:29";
    apiCall.mockImplementation(async (_label, _path, opts) => {
      for (const [k, v] of Object.entries(JSON.parse(opts.body))) {
        if (!(server[k]?.slice(0, 10) === v.slice(0, 10) && server[k] <= v)) server[k] = v;
      }
      return { ok: true, ui: { ...server } };
    });
    expect(await prefs.noteClawdDay("furious", "2026-10-21T17:31")).toBe(true);
    expect(prefs.getClawdDay().furious).toBe("2026-10-21T17:29");
  });

  it("loads first, so a note before the boot load can't rewrite today's", async () => {
    expect(await prefs.noteClawdDay("merged", "2026-10-21T17:40")).toBe(false);
    expect(apiCall).not.toHaveBeenCalled();
    expect(prefs.getClawdDay().merged).toBe("2026-10-21T11:00");
  });
});
