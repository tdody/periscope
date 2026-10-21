// Render-path smoke test for the tamagotchi scene: every activity in the
// schedule draws, carries its data-activity hook (the CSS animations key off
// it), and keeps the mascot on screen.

import render from "preact-render-to-string";
import { describe, expect, it } from "vitest";
import { SCHEDULE } from "../tamagotchi.js";
import { TamaScene } from "../Tamagotchi.jsx";

const ids = [...new Set(SCHEDULE.map((s) => s.id))];

describe("<TamaScene>", () => {
  it.each(ids)("draws the mascot for %s", (id) => {
    const html = render(<TamaScene activity={id} />);
    expect(html).toContain(`data-activity="${id}"`);
    expect(html).toContain("tama-body");
  });

  it("closes the eyes only while asleep", () => {
    expect(render(<TamaScene activity="sleep" />)).toContain("tama-eyes-closed");
    expect(render(<TamaScene activity="code" />)).not.toContain("tama-eyes-closed");
  });

  it("gives each activity its own prop", () => {
    expect(render(<TamaScene activity="sleep" />)).toContain("tama-z");
    expect(render(<TamaScene activity="coffee" />)).toContain("tama-steam");
    expect(render(<TamaScene activity="code" />)).toContain("tama-cursor");
    expect(render(<TamaScene activity="run" />)).toContain("tama-legs-b");
    expect(render(<TamaScene activity="read" />)).toContain("tama-page");
  });

  it("shows a heart only while petted", () => {
    expect(render(<TamaScene activity="code" />)).not.toContain("tama-heart");
    expect(render(<TamaScene activity="code" petted />)).toContain("tama-heart");
  });
});

describe("sitting scenes", () => {
  it("codes at a desk, seated, legs tucked away", () => {
    const html = render(<TamaScene activity="code" />);
    expect(html).toContain("tama-desk");
    expect(html).toContain("tama-chair");
    expect(html).not.toContain("tama-legs-a");
  });

  it("reads in an armchair by the fireplace", () => {
    const html = render(<TamaScene activity="read" />);
    expect(html).toContain("tama-fire");
    expect(html).toContain("tama-flame");
    expect(html).toContain("tama-chair");
    expect(html).not.toContain("tama-legs-a");
  });

  it("keeps the standing poses on their feet", () => {
    for (const id of ["sleep", "coffee", "eat", "run"]) {
      expect(render(<TamaScene activity={id} />)).toContain("tama-legs-a");
    }
  });
});
