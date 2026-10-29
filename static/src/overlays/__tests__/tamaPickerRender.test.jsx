// The Settings picker must show the saved critter as the checked radio, or a
// reopened modal lies about what's in the header.

import render from "preact-render-to-string";
import { afterEach, describe, expect, it } from "vitest";
import { prefsSignal } from "../../prefs.js";
import { TamaPicker } from "../TamaPicker.jsx";

const withUI = (ui) => { prefsSignal.value = { ...prefsSignal.value, loaded: true, ui }; };
const checked = (html) => [...html.matchAll(/<input[^>]*value="(\w+)"[^>]*checked/g)].map((m) => m[1]);

describe("<TamaPicker>", () => {
  afterEach(() => withUI({}));

  it("offers Clawd and the eight as real radios, each with a preview and its name", () => {
    const html = render(<TamaPicker />);
    expect(html.match(/<input type="radio" name="tama-critter"/g)).toHaveLength(9);
    expect(html.match(/class="critter-preview"/g)).toHaveLength(9);
    for (const name of ["Clawd", "Scope", "Jelly", "Nox", "Ember", "Volt", "Moss", "Octocat", "Faradaysie"]) expect(html).toContain(`<span>${name}</span>`);
  });

  it("checks Clawd when nothing is picked", () => {
    withUI({});
    expect(checked(render(<TamaPicker />))).toEqual(["clawd"]);
  });

  it("checks the saved critter", () => {
    withUI({ tama_critter: "volt" });
    expect(checked(render(<TamaPicker />))).toEqual(["volt"]);
  });
});
