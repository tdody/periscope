// Stylesheet-wide checks biome can't make (it lints only JS and JSX).

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const keyframeNames = (css) =>
  [...css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/@keyframes\s+([\w-]+)/g)].map((m) => m[1]);

// @keyframes are global: a second definition silently restyles every user of
// the first (the tamagotchi's mood flush once took over the fireplace's glow).
describe("styles.css", () => {
  it("defines each keyframes name once", () => {
    const names = keyframeNames(readFileSync(new URL("../../styles.css", import.meta.url), "utf8"));
    expect(names.length).toBeGreaterThan(0);
    expect(names.filter((n, i) => names.indexOf(n) !== i)).toEqual([]);
  });

  it("shares no keyframes name with the generated critters.css", () => {
    // Both sheets load on one page, so a clash would restyle across them.
    const read = (f) => keyframeNames(readFileSync(new URL(`../../${f}`, import.meta.url), "utf8"));
    const critters = read("critters.css");
    expect(critters.length).toBeGreaterThan(0);
    expect(critters.filter((n) => read("styles.css").includes(n))).toEqual([]);
    expect(critters.filter((n, i) => critters.indexOf(n) !== i)).toEqual([]);
  });

  it("doesn't count a commented-out block", () => {
    expect(keyframeNames("/* @keyframes spin { } */ @keyframes spin { }")).toEqual(["spin"]);
  });
});
