// Render-path tests for the tamagotchi scene: the decisions the drawing
// encodes (which pose shows what), not the inventory of props.

import render from "preact-render-to-string";
import { afterEach, describe, expect, it, vi } from "vitest";
import { accounts, usage } from "../../store.js";
import { SCHEDULE } from "../tamagotchi.js";
import { TamaScene, Tamagotchi } from "../Tamagotchi.jsx";

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
