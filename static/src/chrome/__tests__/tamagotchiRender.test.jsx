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

describe("seasonal run", () => {
  it.each(["spring", "summer", "autumn", "winter"])("runs through a %s backdrop", (season) => {
    const html = render(<TamaScene activity="run" season={season} />);
    expect(html).toContain(`data-season="${season}"`);
    expect(html).toContain("tama-scenery");
  });

  it("only dresses the run in the season", () => {
    expect(render(<TamaScene activity="code" season="winter" />)).not.toContain("tama-scenery");
  });

  it("drops snow, leaves or petals, but not in summer", () => {
    expect(render(<TamaScene activity="run" season="winter" />)).toContain("tama-fall");
    expect(render(<TamaScene activity="run" season="autumn" />)).toContain("tama-fall");
    expect(render(<TamaScene activity="run" season="spring" />)).toContain("tama-fall");
    expect(render(<TamaScene activity="run" season="summer" />)).toContain("tama-sun");
  });
});

describe("reading chair", () => {
  it("stands on legs", () => {
    expect(render(<TamaScene activity="read" />)).toContain("tama-chair-legs");
  });
});

describe("occasions", () => {
  const scene = (activity, occasion, season = "autumn") =>
    render(<TamaScene activity={activity} season={season} occasion={occasion} />);

  it("sends Clawd trick-or-treating as a little ghost in Halloween week", () => {
    const html = scene("run", "halloween");
    expect(html).toContain("tama-ghost");
    expect(html).toContain("tama-pail");
    expect(html).toContain("tama-moon");
    expect(html).not.toContain("tama-sun");
  });

  it("puts a jack-o'-lantern in every other Halloween scene", () => {
    for (const id of ["sleep", "coffee", "code", "eat", "read"]) {
      expect(scene(id, "halloween"), id).toContain("tama-jack");
    }
  });

  it("gives the year-end wind-down a Christmas tree, stockings and a Santa hat", () => {
    const html = scene("read", "yearend", "winter");
    expect(html).toContain("tama-xmas-tree");
    expect(html).toContain("tama-stocking");
    expect(html).toContain("tama-hat-santa");
    expect(scene("code", "yearend", "winter")).toContain("tama-hat-santa");
  });

  it("throws a party for the new year", () => {
    const html = scene("sleep", "newyear", "winter");
    expect(html).toContain("tama-hat-party");
    expect(html).toContain("tama-firework");
    expect(html).toContain("tama-confetti");
  });

  it("stays plain outside an occasion", () => {
    for (const id of ["run", "read", "code"]) {
      const html = scene(id, null);
      for (const cls of ["tama-ghost", "tama-jack", "tama-xmas-tree", "tama-hat-", "tama-firework"]) {
        expect(html, `${id} ${cls}`).not.toContain(cls);
      }
    }
  });
});

describe("things that follow Clawd", () => {
  it("offsets the pet heart with a wrapper, not on the animated path", () => {
    // The heart's float animation sets `transform` in CSS, which overrides a
    // transform *attribute* on the same element: the seated-pose offset has
    // to live on a parent, or the heart lands beside Clawd's head.
    const html = render(<TamaScene activity="code" petted />);
    expect(html).toMatch(/<g transform="translate\(-5 0\)"><path[^>]*class="tama-heart"/);
    expect(html).not.toMatch(/<path[^>]*transform=[^>]*class="tama-heart"/);
  });

  it("draws the winter snow cap inside Clawd's group, so it bobs with it", () => {
    const html = render(<TamaScene activity="run" season="winter" />);
    const creature = html.indexOf("tama-creature");
    expect(creature).toBeGreaterThan(-1);
    expect(html.indexOf("tama-snowcap")).toBeGreaterThan(creature);
    expect(html.indexOf("tama-snowcap")).toBeGreaterThan(html.indexOf("tama-body"));
  });
});
