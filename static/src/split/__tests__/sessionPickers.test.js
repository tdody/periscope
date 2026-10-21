import { describe, expect, it } from "vitest";
import { effortShown, modelShown, sessionBlocker } from "../sessionPickers.js";

const idle = { agent: "claude", state: "idle", pending_input: null };

describe("sessionBlocker", () => {
  it("lets an idle or done Claude pane through", () => {
    expect(sessionBlocker(idle)).toBe(null);
    expect(sessionBlocker({ ...idle, state: "done" })).toBe(null);
  });
  it("blocks a pane mid-turn or waiting on a prompt", () => {
    expect(sessionBlocker({ ...idle, state: "working" })).toMatch(/working/);
    expect(sessionBlocker({ ...idle, state: "needs-input" })).toMatch(/needs-input/);
  });
  it("blocks a pane with a draft in its input box", () => {
    // The slash command would be appended to the draft and submitted with it.
    expect(sessionBlocker({ ...idle, pending_input: "half a thought" })).toMatch(/unsent/);
  });
  it("blocks anything that isn't Claude", () => {
    expect(sessionBlocker({ ...idle, agent: "codex" })).toMatch(/not a Claude/);
    expect(sessionBlocker({ agent: null, state: "shell" })).toMatch(/not a Claude/);
    expect(sessionBlocker(null)).toMatch(/not a Claude/);
  });
});

describe("effortShown", () => {
  it("prefers what periscope set, then the launch flag, then default", () => {
    expect(effortShown({ session_effort: "low", launch_effort: "high" })).toBe("low");
    expect(effortShown({ launch_effort: "high" })).toBe("high");
    expect(effortShown({})).toBe("default");
  });
});

describe("modelShown", () => {
  it("trusts the status line when it parses", () => {
    expect(modelShown({ model: "Opus 4.8 (1M context)", session_model: "sonnet" })).toBe("Opus 4.8");
  });
  it("falls back to the label of what periscope set", () => {
    expect(modelShown({ session_model: "opus[1m]" })).toBe("opus 1m");
    expect(modelShown({ session_model: "claude-fable-5" })).toBe("claude-fable-5");
  });
  it("shows a bare prompt when nothing is known", () => {
    expect(modelShown({})).toBe("model");
  });
});
