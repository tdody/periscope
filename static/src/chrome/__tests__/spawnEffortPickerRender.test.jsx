// Render-path smoke test for <SpawnEffortPicker> — same rationale as the
// model picker's: catches wiring errors (signal not read, active class on the
// wrong chip) that a build alone can't. Click → PATCH is browser-verified.

import render from "preact-render-to-string";
import { afterEach, describe, expect, it } from "vitest";
import { spawnEffort } from "../../store.js";
import { PIN_EFFORTS, SpawnEffortPicker } from "../SpawnEffortPicker.jsx";

afterEach(() => {
  spawnEffort.value = null;
});

function activeLabel(html) {
  const m = html.match(/class="spawn-acct-btn is-active"[^>]*>([^<]+)</);
  return m?.[1] ?? null;
}

describe("<SpawnEffortPicker>", () => {
  it("reads default when no pin is set", () => {
    expect(activeLabel(render(<SpawnEffortPicker />))).toBe("default");
  });

  it("marks the pinned level active, and only it", () => {
    spawnEffort.value = "xhigh";
    const html = render(<SpawnEffortPicker />);
    expect(activeLabel(html)).toBe("xhigh");
    expect(html.match(/is-active/g)).toHaveLength(1);
  });

  it("renders one chip per level, default first", () => {
    const html = render(<SpawnEffortPicker />);
    expect(html.match(/class="spawn-acct-btn/g)).toHaveLength(PIN_EFFORTS.length);
    expect(PIN_EFFORTS[0]).toBe("default");
  });
});
