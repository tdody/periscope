// The Notifications fieldset must show each saved toggle, or a reopened
// Settings modal lies about which banners fire.

import render from "preact-render-to-string";
import { afterEach, describe, expect, it } from "vitest";
import { prefsSignal } from "../../prefs.js";
import { NOTIFY_OPTIONS, NotifySettings } from "../NotifySettings.jsx";

const withUI = (ui) => { prefsSignal.value = { ...prefsSignal.value, loaded: true, ui }; };
const checked = (html) => [...html.matchAll(/<input[^>]*name="notify-(\w+)"[^>]*checked/g)].map((m) => m[1]);

describe("<NotifySettings>", () => {
  afterEach(() => withUI({}));

  it("offers one checkbox per toggle, all on by default", () => {
    withUI({});
    const html = render(<NotifySettings />);
    expect(html.match(/type="checkbox"/g)).toHaveLength(NOTIFY_OPTIONS.length);
    expect(checked(html)).toEqual(NOTIFY_OPTIONS.map(([key]) => key));
  });

  it("shows a toggle turned off as unchecked", () => {
    withUI({ notify: { done: false, badge: false } });
    expect(checked(render(<NotifySettings />))).not.toContain("done");
    expect(checked(render(<NotifySettings />))).not.toContain("badge");
  });

  it("says the banners come from the macOS app, in a browser tab", () => {
    expect(render(<NotifySettings />)).toContain("Periscope macOS app only");
  });
});
