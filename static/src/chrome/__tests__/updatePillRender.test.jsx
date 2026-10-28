// Render-path test for <UpdatePill>. Same rationale/technique as
// usagePillRender.test.jsx. It matters more here than for most chrome: the
// pill is invisible in dev by construction (the release check runs only on the
// prod worker), so the browser cannot exercise these states at all.

import render from "preact-render-to-string";
import { afterEach, describe, expect, it } from "vitest";
import { updateInfo } from "../../store.js";
import { ReleaseNotes, UpdatePill } from "../UpdatePill.jsx";

afterEach(() => {
  updateInfo.value = null;
});

describe("<UpdatePill>", () => {
  it("renders nothing when there is no update info", () => {
    expect(render(<UpdatePill />)).toBe("");
  });

  it("renders nothing when the checkout is current", () => {
    // The common case by far — the pill must cost nothing when up to date.
    updateInfo.value = { behind: 0, checked_at: 1, running: false };
    expect(render(<UpdatePill />)).toBe("");
  });

  it("names the release when behind it", () => {
    updateInfo.value = { behind: 12, target: "v0.3.0", checked_at: 1, running: false };
    const html = render(<UpdatePill />);
    expect(html).toContain("↑ v0.3.0");
    expect(html).toContain("v0.3.0 is out — 12 commits newer than this checkout");
    // The popover exists closed; nothing has been fetched yet.
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('role="dialog" hidden>');
  });

  it("singularizes a single commit", () => {
    updateInfo.value = { behind: 1, target: "v0.3.0", checked_at: 1, running: false };
    expect(render(<UpdatePill />)).toContain("1 commit newer");
  });

  it("warns when local commits make the fast-forward impossible", () => {
    // The failure this exists for: the update's fast-forward refuses once the
    // checkout carries local commits AND upstream has moved, so "↑ 10 behind"
    // alone armed a button that could not succeed and said nothing about why.
    updateInfo.value = { behind: 10, ahead: 1, target: "v0.3.0", checked_at: 1, running: false };
    const html = render(<UpdatePill />);
    expect(html).toContain("↑ v0.3.0 ⚠");
    expect(html).toContain("1 local commit not in v0.3.0");
    expect(html).toContain("will refuse");
    // Still armed: the count can be stale (an external rebase already fixed
    // it), and a failed update is harmless — it aborts before touching launchd.
    expect(html).toContain("pull, re-provision and restart");
  });

  it("pluralizes the local-commit warning", () => {
    updateInfo.value = { behind: 3, ahead: 4, target: "v0.3.0", checked_at: 1, running: false };
    expect(render(<UpdatePill />)).toContain("4 local commits");
  });

  it("says nothing about local commits when there are none", () => {
    updateInfo.value = { behind: 10, ahead: 0, target: "v0.3.0", checked_at: 1, running: false };
    const html = render(<UpdatePill />);
    expect(html).not.toContain("will refuse");
    expect(html).toContain("↑ v0.3.0");
    expect(html).not.toContain("⚠");
  });

  it("shows a disabled running state when an update is already in flight", () => {
    // `running` arrives from the server, so a second tab must show the state
    // an update started in the first one — not an armed button.
    updateInfo.value = { behind: 12, target: "v0.3.0", checked_at: 1, running: true };
    const html = render(<UpdatePill />);
    expect(html).toContain("updating…");
    expect(html).toContain("is-running");
    expect(html).toContain("disabled");
  });
});

describe("<ReleaseNotes>", () => {
  it("renders each release's heading and its body as markdown, newest first", () => {
    const releases = [
      { heading: "v0.3.0 — 2026-11-01", body: "Adds **bold** things.\n\n- one\n- two" },
      { heading: "v0.2.0 — 2026-10-28", body: "Second." },
    ];
    const html = render(<ReleaseNotes releases={releases} />);
    expect(html.indexOf("v0.3.0 — 2026-11-01")).toBeLessThan(html.indexOf("v0.2.0 — 2026-10-28"));
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<li");
  });

  it("never renders raw HTML from the changelog", () => {
    const html = render(<ReleaseNotes releases={[{ heading: "v1.0.0", body: "<img src=x onerror=alert(1)>" }]} />);
    expect(html).not.toContain("<img");
  });

  it("distinguishes loading, a failed request and an unreadable changelog", () => {
    expect(render(<ReleaseNotes releases={null} />)).toContain("loading");
    expect(render(<ReleaseNotes releases="error" />)).toContain("couldn't load");
    expect(render(<ReleaseNotes releases={[]} />)).toContain("CHANGELOG.md was unreadable");
  });
});
