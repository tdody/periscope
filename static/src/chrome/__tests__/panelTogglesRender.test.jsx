// Render-path smoke test for <PanelToggles>: the pressed state and the hover
// title must follow the prefs, or the buttons lie about what a click does.

import render from "preact-render-to-string";
import { afterEach, describe, expect, it } from "vitest";
import { prefsSignal } from "../../prefs.js";
import { PanelToggles } from "../PanelToggles.jsx";

const withUI = (ui) => { prefsSignal.value = { ...prefsSignal.value, loaded: true, ui }; };

afterEach(() => withUI({}));

describe("<PanelToggles>", () => {
  it("shows both panels pressed by default", () => {
    const html = render(<PanelToggles />);
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(2);
    expect(html).toContain("Hide the navigator (⌘B)");
    expect(html).toContain("Hide the context column (⌥⌘B)");
  });

  it("flips each button independently", () => {
    withUI({ rail_hidden: true });
    const html = render(<PanelToggles />);
    expect(html).toContain("Show the navigator (⌘B)");
    expect(html).toContain("Hide the context column (⌥⌘B)");
    expect(html.match(/aria-pressed="false"/g)).toHaveLength(1);
  });
});
