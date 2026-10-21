// Render-path tests for the tamagotchi scene: the decisions the drawing
// encodes (which pose shows what), not the inventory of props.

import render from "preact-render-to-string";
import { afterEach, describe, expect, it, vi } from "vitest";
import { accounts, usage } from "../../store.js";
import { Tamagotchi, TamaScene } from "../Tamagotchi.jsx";
import { SCHEDULE } from "../tamagotchi.js";

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

  it("shows a heart only while petted", () => {
    expect(render(<TamaScene activity="code" />)).not.toContain("tama-heart");
    expect(render(<TamaScene activity="code" petted />)).toContain("tama-heart");
  });

  it("tucks the legs away in the seated scenes and keeps the standing poses on their feet", () => {
    for (const id of ["code", "read"]) expect(render(<TamaScene activity={id} />), id).not.toContain("tama-legs-a");
    for (const id of ["sleep", "coffee", "eat", "run"]) expect(render(<TamaScene activity={id} />), id).toContain("tama-legs-a");
  });

  it("only dresses the run in the season", () => {
    expect(render(<TamaScene activity="run" season="winter" />)).toContain("tama-scenery");
    expect(render(<TamaScene activity="code" season="winter" />)).not.toContain("tama-scenery");
  });
});

describe("occasions", () => {
  const scene = (activity, occasion, season = "autumn") =>
    render(<TamaScene activity={activity} season={season} occasion={occasion} />);

  it("the Halloween ghost sheet replaces the eyes and the sun", () => {
    const html = scene("run", "halloween");
    expect(html).toContain("tama-ghost");
    expect(html).not.toContain("tama-eyes");
    expect(html).not.toContain("tama-sun");
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

describe("coffee at the desk", () => {
  it("puts a steaming mug on the desk for the first coding hour", () => {
    const html = render(<TamaScene activity="code" coffee />);
    expect(html).toContain("tama-desk-mug");
    expect(html).toContain("tama-steam");
  });
  it("leaves the desk bare the rest of the day", () => {
    expect(render(<TamaScene activity="code" />)).not.toContain("tama-desk-mug");
  });
});

describe("coding moods", () => {
  const code = (mood, o = {}) => render(<TamaScene activity="code" mood={mood} {...o} />);

  it("stays calm by default: the usual eyes, no mood", () => {
    const html = render(<TamaScene activity="code" />);
    expect(html).toContain("tama-eyes");
    expect(html).not.toContain("data-mood");
    expect(html).not.toContain("tama-brows");
  });

  it("draws grumpy brows instead of the eyes, typing hands and one red line", () => {
    const html = code("grumpy");
    expect(html).toContain('data-mood="grumpy"');
    expect(html).toContain("tama-brows");
    expect(html).toContain("tama-hand");
    expect(html).not.toContain("tama-eyes");
    expect(html).toContain("tama-red-line");
    // Nothing from the furious desk.
    for (const cls of ["tama-flush", "tama-scowl", "tama-errors", "tama-smoke", "tama-flying-key", "tama-shimmer"]) {
      expect(html, cls).not.toContain(cls);
    }
  });

  it("goes red-hot when furious: flush, scowl, smoke, heat shimmer, errors, flying keys", () => {
    const html = code("furious");
    for (const cls of ["tama-flush", "tama-scowl", "tama-smoke", "tama-shimmer", "tama-errors", "tama-flying-key"]) {
      expect(html, cls).toContain(cls);
    }
  });

  it("keeps the heat shimmer off a hat", () => {
    expect(code("furious", { occasion: "yearend" })).not.toContain("tama-shimmer");
  });

  it("slops the 9am coffee only when furious", () => {
    expect(code("furious", { coffee: true })).toContain("tama-spill");
    expect(code("grumpy", { coffee: true })).not.toContain("tama-spill");
    expect(code("furious")).not.toContain("tama-spill");
  });

  it("draws the error screen inside the desk, under the mug", () => {
    const html = code("furious", { coffee: true });
    const at = (needle) => html.indexOf(needle);
    expect(at("tama-errors")).toBeGreaterThan(at('class="tama-desk"'));
    expect(at("tama-errors")).toBeLessThan(at("tama-desk-mug"));
  });

  it("changes only the coding scene", () => {
    for (const id of ["sleep", "coffee", "eat", "run", "read"]) {
      const html = render(<TamaScene activity={id} mood="furious" />);
      expect(html, id).not.toContain("data-mood");
      expect(html, id).not.toContain("tama-brows");
    }
  });
});

// The widget's own wiring: the usage signal to the mood, the hover's reason
// only while coding, the account named only when there are several.
describe("<Tamagotchi>", () => {
  const at = (h, m) => new Date(2026, 9, 21, h, m);
  const furiousB = () => {
    const now = at(14, 30).getTime() / 1000;
    usage.value = { plan: { b: { available: true, fetched_at: now - 60, meters: { week_all: { percent: 50, hot: true } } } } };
  };
  afterEach(() => {
    vi.useRealTimers();
    usage.value = null;
    accounts.value = [];
  });

  it("codes furiously, naming the account, when one of several burns", () => {
    vi.useFakeTimers();
    vi.setSystemTime(at(14, 30));
    accounts.value = [{ id: "default", label: "A" }, { id: "b", label: "B" }];
    furiousB();
    const html = render(<Tamagotchi />);
    expect(html).toContain('data-mood="furious"');
    expect(html).toContain('title="Claude is coding furiously (1pm–5pm) · week usage on account B is burning 🔥"');
  });

  it("leaves the account out with a single subscription", () => {
    vi.useFakeTimers();
    vi.setSystemTime(at(14, 30));
    accounts.value = [{ id: "b", label: "B" }];
    furiousB();
    expect(render(<Tamagotchi />)).toContain('title="Claude is coding furiously (1pm–5pm) · week usage is burning 🔥"');
  });

  it("drops the mood and its reason outside the coding hours", () => {
    vi.useFakeTimers();
    vi.setSystemTime(at(18, 30));
    accounts.value = [{ id: "b", label: "B" }];
    furiousB();
    const html = render(<Tamagotchi />);
    expect(html).not.toContain("data-mood");
    expect(html).not.toContain("burning");
  });
});

describe("Clawd on duty", () => {
  const scene = (activity, duty, extra = {}) =>
    render(<TamaScene activity={activity} duty={duty && { label: "2", more: 0, ...duty }} {...extra} />);
  const count = (html, needle) => html.split(needle).length - 1;

  it("draws the bubble, with its +N, only while something is on duty", () => {
    expect(scene("code", null)).not.toContain("tama-bubble");
    const html = scene("eat", { kind: "ci", label: "3", more: 4 });
    expect(html).toContain("tama-bubble");
    expect(html).toContain(">3<");
    expect(html).toContain(">+4<");
    expect(scene("code", { kind: "bell", urgent: true })).toContain("tama-bubble-urgent");
  });

  it("acts each kind out at the desk", () => {
    const bell = scene("code", { kind: "bell" });
    expect(bell).toContain("tama-slap");
    expect(bell).not.toContain('x="20.4"'); // the service bell takes the keyboard's spot
    expect(scene("code", { kind: "ci" })).toContain("tama-spray");
    expect(scene("code", { kind: "api" })).toContain("tama-orbit");
    expect(scene("code", { kind: "api" })).not.toContain("tama-eyes");
    expect(scene("code", { kind: "done" })).toContain("tama-cheer");
    expect(scene("code", { kind: "ctx", label: "87%", pct: 87 })).toContain("tama-stack");
    expect(scene("code", { kind: "update" })).toContain("tama-parcel");
    const merged = scene("code", { kind: "merged" }, { party: true });
    for (const piece of ["tama-hat-party", "tama-firework", "tama-confetti", ">merged<"]) expect(merged).toContain(piece);
  });

  it("asleep, only the bell wakes Clawd", () => {
    const bell = scene("sleep", { kind: "bell" });
    expect(bell).toContain("tama-alarm");
    expect(bell).not.toContain("tama-eyes-closed");
    expect(bell).not.toContain("tama-z");
    const done = scene("sleep", { kind: "done" });
    expect(done).toContain("tama-eyes-closed");
    expect(done).not.toContain("tama-sparkle");
    expect(done).toContain("tama-bubble");
  });

  it("away from the desk, only the face kinds change Clawd", () => {
    expect(scene("eat", { kind: "ci" })).not.toContain("tama-spray");
    expect(scene("eat", { kind: "api" })).toContain("tama-orbit");
    expect(scene("read", { kind: "bell" })).toContain("tama-startle");
    expect(scene("run", { kind: "api" }, { occasion: "halloween" })).not.toContain("tama-orbit");
  });

  it("naps at the desk while every account is walled, under the bubble", () => {
    const html = scene("code", { kind: "bell" }, { walled: { day: null, time: "3pm" } });
    expect(html).toContain('data-activity="nap"');
    for (const piece of ["back at", ">3pm<", "tama-eyes-closed", "tama-bubble"]) expect(html).toContain(piece);
    expect(html).not.toContain("tama-slap");
    expect(scene("read", null, { walled: { day: "Thu", time: "3pm" } })).toContain('data-activity="read"');
  });

  it("leaves the desk to sweep when cleanup is on top", () => {
    const html = scene("code", { kind: "clean" });
    expect(html).toContain('data-activity="sweep"');
    expect(html).toContain("tama-broom");
    expect(html).not.toContain("tama-desk");
  });

  it("lights one split per working agent, up to four", () => {
    expect(count(scene("code", null, { working: 2 }), "tama-type")).toBe(6);
    expect(count(scene("code", null, { working: 3 }), "tama-type")).toBe(6);
    const busy = scene("code", null, { working: 7 });
    expect(count(busy, "tama-type")).toBe(8);
    expect(busy).toContain('data-working="4"');
    expect(scene("code", null, { working: 0 })).toContain('data-working="0"');
    expect(scene("code", null)).not.toContain("data-working");
  });

  it("keeps the party hat on through a higher item, without the fireworks", () => {
    const html = scene("code", { kind: "bell" }, { party: true });
    expect(html).toContain("tama-hat-party");
    expect(html).not.toContain("tama-firework");
  });

  it("puts the moods away while on duty", () => {
    expect(scene("code", { kind: "bell" }, { mood: "furious" })).not.toContain("data-mood");
  });

  it("moves the new-year fireworks clear of the bubble", () => {
    expect(count(render(<TamaScene activity="eat" occasion="newyear" />), "tama-firework")).toBe(2);
    expect(count(scene("eat", { kind: "update" }, { occasion: "newyear" }), "tama-firework")).toBe(3);
  });
});
