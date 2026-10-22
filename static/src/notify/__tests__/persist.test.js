import { describe, expect, it } from "vitest";
import { RESUME_MS, resumeState, STORAGE_KEY, saveState } from "../persist.js";

const memory = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) };
};

describe("persist", () => {
  it("resumes a state saved within RESUME_MS", () => {
    const s = memory();
    saveState(s, { seen: { a: true } }, 1000);
    expect(resumeState(s, 1000 + RESUME_MS)).toEqual({ state: { seen: { a: true } }, held: [], heldSince: null });
  });

  it("resumes a held burst with it, so a recycle doesn't drop its summary", () => {
    const s = memory();
    const held = [{ kind: "question", key: "k", w: { pid: "p1", name: "a" } }];
    saveState(s, { seen: {} }, 1000, held, 900);
    expect(resumeState(s, 2000)).toEqual({ state: { seen: {} }, held, heldSince: 900 });
  });

  it("drops a state that's too old, from the future, missing or garbled", () => {
    const s = memory();
    saveState(s, { seen: {} }, 1000);
    expect(resumeState(s, 1001 + RESUME_MS)).toBeNull();
    expect(resumeState(s, 500)).toBeNull();
    expect(resumeState(memory(), 1000)).toBeNull();
    const bad = memory();
    bad.setItem(STORAGE_KEY, "{not json");
    expect(resumeState(bad, 1000)).toBeNull();
  });

  it("survives storage that throws or isn't there", () => {
    const broken = { getItem: () => { throw new Error("denied"); }, setItem: () => { throw new Error("quota"); } };
    expect(() => saveState(broken, {}, 1)).not.toThrow();
    expect(resumeState(broken, 1)).toBeNull();
    expect(resumeState(null, 1)).toBeNull();
  });
});
