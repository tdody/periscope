// Render-path tests for the tamagotchi scene: the decisions the drawing
// encodes (which pose shows what), not the inventory of props.

import { createHash } from "node:crypto";
import render from "preact-render-to-string";
import { afterEach, describe, expect, it, vi } from "vitest";
import { prefsSignal } from "../../prefs.js";
import { accounts, usage, wallSpans, walls } from "../../store.js";
import { CRITTERS, critterById, hueRotate, spriteBox } from "../critters.js";
import { Tamagotchi, TamaScene } from "../Tamagotchi.jsx";
import { FRIEND_HUE, PASTIME_SCENES } from "../TamaPastimes.jsx";
import { activityAt, activityLabel, BRUNCH, MEALS, PASTIMES, SCHEDULE } from "../tamagotchi.js";

const ids = [...new Set([...SCHEDULE.map((s) => s.id).filter(Boolean), ...PASTIMES.map((p) => p.id)])];

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
    for (const id of ["code", "read", "game", "swim", "sled"]) {
      expect(render(<TamaScene activity={id} />), id).not.toContain("tama-legs-a");
    }
    for (const id of ["sleep", "coffee", "eat", "run", "cycle", "music", "beer", "kids", "garden", "cook", "dog"]) {
      expect(render(<TamaScene activity={id} />), id).toContain("tama-legs-a");
    }
  });

  it("draws every pastime from its own record, the tempo and the stride on the scene for the CSS", () => {
    expect(Object.keys(PASTIME_SCENES).sort()).toEqual(PASTIMES.map((p) => p.id).sort());
    for (const [id, p] of Object.entries(PASTIME_SCENES)) {
      expect(p.tempo, id).toBeGreaterThan(0);
      const svg = render(<TamaScene activity={id} />).match(/^<svg[^>]*>/)[0];
      expect(svg, id).toContain(`data-tempo="${p.tempo}"`);
      expect(svg, id).toContain(`--tama-tempo: ${p.tempo}s`);
      expect(/ data-stride[ >]/.test(svg), id).toBe(!!p.stride);
    }
    expect(render(<TamaScene activity="code" />)).not.toContain("data-tempo");
  });

  it("only dresses the outdoor pastimes in the season", () => {
    for (const id of ["run", "cycle", "garden", "dog", "sled"]) {
      expect(render(<TamaScene activity={id} season="winter" />), id).toContain("tama-scenery");
    }
    for (const id of ["code", "music", "beer", "kids", "game", "cook", "swim"]) {
      expect(render(<TamaScene activity={id} season="winter" />), id).not.toContain("tama-scenery");
    }
  });
});

describe("pastimes and meals", () => {
  // Clawd's group, tag-balanced, so "inside Clawd's group" (it bobs with
  // Clawd) is checkable in the seated scenes too.
  const creature = (html) => {
    const open = html.lastIndexOf("<g", html.indexOf('class="tama-creature'));
    let depth = 0;
    for (const m of html.slice(open).matchAll(/<g[\s>]|<\/g>/g)) {
      depth += m[0] === "</g>" ? -1 : 1;
      if (depth === 0) return html.slice(open, open + m.index + 4);
    }
    return "";
  };
  const inCreature = (html, cls) => creature(html).includes(cls);

  it.each([...MEALS, ...BRUNCH].map((m) => m.id).concat(["roast", "icecream", "pie"]))("serves %s", (dish) => {
    expect(render(<TamaScene activity="eat" dish={dish} />)).toContain(`data-dish="${dish}"`);
  });

  it("serves ramen when no dish is named", () => {
    expect(render(<TamaScene activity="eat" />)).toContain('data-dish="ramen"');
  });

  it("games on the couch with the controller in hand", () => {
    const html = render(<TamaScene activity="game" />);
    expect(html).toContain("tama-tv");
    expect(inCreature(html, "tama-controller")).toBe(true);
  });

  it("waters the garden from a can in Clawd's hands", () => {
    const html = render(<TamaScene activity="garden" season="spring" />);
    expect(inCreature(html, "tama-can")).toBe(true);
    expect(html).toContain("tama-drop");
    expect(html).toContain("tama-flowers");
  });

  it("cooks at the stove in a chef's hat, under any other hat instead", () => {
    const html = render(<TamaScene activity="cook" />);
    expect(html).toContain("tama-stove");
    expect(inCreature(html, "tama-toque")).toBe(true);
    expect(render(<TamaScene activity="cook" occasion="yearend" />)).not.toContain("tama-toque");
  });

  it("keeps the oven's and the fire's glow faint with the motion off", () => {
    // Under prefers-reduced-motion the keyframes that fade the glow stop, so
    // the attribute is all that keeps it from a solid bright bar.
    for (const id of ["cook", "read"]) {
      const glows = [...render(<TamaScene activity={id} />).matchAll(/<[^>]*class="tama-glow"[^>]*>/g)];
      expect(glows.length, id).toBeGreaterThan(0);
      for (const [tag] of glows) expect(tag, id).toMatch(/ opacity="0\.\d+"/);
    }
  });

  it("walks the dog on a leash, both of them striding", () => {
    const html = render(<TamaScene activity="dog" />);
    expect(html).toContain("tama-dog");
    expect(html).toContain("tama-leash");
    expect(html).toContain("tama-legs-b");
  });

  it("swims in goggles, the water drawn over Clawd", () => {
    const html = render(<TamaScene activity="swim" season="summer" />);
    expect(inCreature(html, "tama-goggles")).toBe(true);
    const body = creature(html);
    expect(html.indexOf("tama-water")).toBeGreaterThan(html.indexOf(body) + body.length - 1);
  });

  it("sleds in a scarf", () => {
    const html = render(<TamaScene activity="sled" season="winter" />);
    expect(html).toContain("tama-sled");
    expect(inCreature(html, "tama-scarf")).toBe(true);
  });

  it("pedals the bike in a helmet, under any hat instead", () => {
    const html = render(<TamaScene activity="cycle" />);
    expect(html).toContain("tama-bike");
    expect(html).toContain("tama-legs-b");
    expect(inCreature(html, "tama-helmet")).toBe(true);
    expect(render(<TamaScene activity="cycle" occasion="yearend" />)).not.toContain("tama-helmet");
    expect(render(<TamaScene activity="cycle" season="winter" />)).not.toContain("tama-snowcap");
  });

  it("holds the bass in Clawd's group, so it bobs with the groove, plugged into an amp", () => {
    const html = render(<TamaScene activity="music" />);
    expect(inCreature(html, "tama-bass")).toBe(true);
    expect(html).toContain("tama-amp");
  });

  it("clinks a pint with a friend, and the kids come in twos", () => {
    const beer = render(<TamaScene activity="beer" />);
    expect(beer).toContain("tama-friend");
    expect(beer.split("tama-pint").length - 1).toBe(2);
    expect(render(<TamaScene activity="kids" />).split('class="tama-kid').length - 1).toBe(2);
  });

  it("smiles with friends and the kids, unless something on duty takes the face", () => {
    for (const id of ["beer", "kids"]) {
      expect(render(<TamaScene activity={id} />), id).toContain("tama-happy-eyes");
      const bell = render(<TamaScene activity={id} duty={{ kind: "bell", label: "1", more: 0 }} />);
      expect(bell, id).not.toContain("tama-happy-eyes");
      expect(bell, id).toContain("tama-startle");
    }
    expect(render(<TamaScene activity="music" />)).not.toContain("tama-happy-eyes");
  });
});

describe("occasions", () => {
  const scene = (activity, occasion, season = "autumn") =>
    render(<TamaScene activity={activity} season={season} occasion={occasion} />);

  it("the Halloween ghost sheet replaces the eyes and the sun", () => {
    const html = render(<TamaScene activity="run" trick season="autumn" occasion="halloween" />);
    expect(html).toContain("tama-ghost");
    expect(html).not.toContain("tama-eyes");
    expect(html).not.toContain("tama-sun");
  });

  it("trick-or-treats with the kids in sheets, at night", () => {
    const html = render(<TamaScene activity="kids" trick season="autumn" occasion="halloween" />);
    expect(html.split('class="tama-kid-sheet').length - 1).toBe(2);
    expect(html).toContain("tama-ghost");
    expect(html).toContain("tama-moon");
  });

  it("keeps a Halloween-week afternoon run an ordinary run: only the evening trick-or-treats", () => {
    const html = scene("run", "halloween");
    expect(html).not.toContain("tama-ghost");
    expect(html).not.toContain("tama-moon");
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
  // Every account walled until `until` (epoch s), as /api/state serves it:
  // the walls, and their stretch dated from `since`.
  const walled = (until, since = 0) => {
    walls.value = { until };
    wallSpans.value = [{ since, until }];
  };
  afterEach(() => {
    vi.useRealTimers();
    usage.value = null;
    accounts.value = [];
    walls.value = null;
    wallSpans.value = [];
  });

  it("codes furiously, naming the account, when one of several burns", () => {
    vi.useFakeTimers();
    vi.setSystemTime(at(14, 30));
    accounts.value = [{ id: "default", label: "A" }, { id: "b", label: "B" }];
    furiousB();
    const html = render(<Tamagotchi />);
    expect(html).toContain('data-mood="furious"');
    const next = activityLabel(activityAt(at(17, 0)));
    expect(html).toContain(`title="Claude is coding furiously (1pm–5pm) · week usage on account B is burning 🔥 · up next at 5pm: ${next}"`);
  });

  it("leaves the account out with a single subscription", () => {
    vi.useFakeTimers();
    vi.setSystemTime(at(14, 30));
    accounts.value = [{ id: "b", label: "B" }];
    furiousB();
    const next = activityLabel(activityAt(at(17, 0)));
    expect(render(<Tamagotchi />)).toContain(`title="Claude is coding furiously (1pm–5pm) · week usage is burning 🔥 · up next at 5pm: ${next}"`);
  });

  it("names the half hour and the dish in the hover line", () => {
    vi.useFakeTimers();
    vi.setSystemTime(at(17, 40));
    expect(render(<Tamagotchi />)).toMatch(/title="Claude is [^"(]+ \(5:30pm–6pm\)/);
    vi.setSystemTime(at(12, 10));
    expect(render(<Tamagotchi />)).toMatch(/title="Claude is having [^"(]+ for lunch \(noon–1pm\) · up next at 1pm: coding"/);
  });

  it("draws the dish the hover names", () => {
    vi.useFakeTimers();
    vi.setSystemTime(at(12, 10));
    const lunch = activityAt(at(12, 10));
    expect(lunch.dish).not.toBe("ramen"); // the fallback: a dish left unpassed would still draw it
    const html = render(<Tamagotchi />);
    expect(html).toContain(`data-dish="${lunch.dish}"`);
    expect(html).toContain(`title="Claude is ${lunch.label} (noon–1pm)`);
  });

  it("sends Clawd out in a sheet on a Halloween evening's round", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 28, 17, 10));
    const html = render(<Tamagotchi />);
    expect(html).toContain("tama-ghost");
    expect(html).toContain('title="Claude is trick-or-treating');
  });

  it("knocks off at 4pm under the walls, the scene and the hover alike", () => {
    vi.useFakeTimers();
    vi.setSystemTime(at(16, 10));
    walled(at(18, 0).getTime() / 1000);
    const html = render(<Tamagotchi />);
    const pastime = activityAt(at(16, 10), { walls: [[-Infinity, at(18, 0).getTime()]] });
    expect(html).toContain(`data-activity="${pastime.id}"`);
    expect(html).toContain(`title="Claude is ${pastime.label} (4pm–4:30pm)`);
    expect(html).not.toContain("napping at the desk");
  });

  it("naps at the desk under the walls, the scene and the hover alike", () => {
    vi.useFakeTimers();
    vi.setSystemTime(at(14, 30));
    walled(at(18, 0).getTime() / 1000);
    const html = render(<Tamagotchi />);
    expect(html).toContain('data-activity="nap"');
    expect(html).toContain(">6pm<");
    expect(html).toContain('title="Claude is napping at the desk (1pm–4pm) · every account is at its limit until 6pm · up next at 4pm: ');
  });

  it("forecasts the plain afternoon when the walls lift before it, and stops naming them past the reset time", () => {
    vi.useFakeTimers();
    vi.setSystemTime(at(12, 10));
    walled(at(12, 30).getTime() / 1000);
    expect(render(<Tamagotchi />)).toMatch(/title="Claude is having [^"(]+ for lunch \(noon–1pm\) · every account is at its limit until 12:30pm · up next at 1pm: coding"/);
    // Past the reset, before the next usage refresh clears the walls: back at
    // the desk since the reset, and the walls not named.
    vi.setSystemTime(at(14, 40));
    walled(at(14, 30).getTime() / 1000);
    const html = render(<Tamagotchi />);
    expect(html).toContain('data-activity="code"');
    expect(html).toContain('title="Claude is coding (2:30pm–5pm) · up next at 5pm: ');
    expect(html).not.toContain("at its limit");
  });

  it("keeps the knock-off half under way once the next usage refresh drops the walls", () => {
    // Walled until 4:10pm, and at 4:13 the refresh clears them: the half
    // Clawd began out runs to 4:30 on the stretch the server dated.
    vi.useFakeTimers();
    vi.setSystemTime(at(16, 14));
    const until = at(16, 10).getTime() / 1000;
    walled(until);
    walls.value = null;
    const pastime = activityAt(at(16, 5), { walls: [[-Infinity, until * 1000]] });
    const html = render(<Tamagotchi />);
    expect(html).toContain(`data-activity="${pastime.id}"`);
    expect(html).toContain(`title="Claude is ${pastime.label} (4pm–4:30pm) · up next at 4:30pm: coding"`);
  });

  it("ends the nap's range at the reset time its up-next names", () => {
    vi.useFakeTimers();
    vi.setSystemTime(at(13, 5));
    walled(at(14, 30).getTime() / 1000);
    expect(render(<Tamagotchi />)).toContain('title="Claude is napping at the desk (1pm–2:30pm) · every account is at its limit until 2:30pm · up next at 2:30pm: coding"');
  });

  it("naps, and knocks off at 4pm, under walls with no reset time reported", () => {
    // launch_policy.walls' {until: null}: no walling meter says when it resets.
    vi.useFakeTimers();
    vi.setSystemTime(at(14, 30));
    walled(null);
    const nap = render(<Tamagotchi />);
    expect(nap).toContain('data-activity="nap"');
    expect(nap).toContain('title="Claude is napping at the desk (1pm–4pm) · every account is at its limit until later · up next at 4pm: ');
    vi.setSystemTime(at(16, 10));
    const pastime = activityAt(at(16, 10), { walls: [[-Infinity, Infinity]] });
    const html = render(<Tamagotchi />);
    expect(html).toContain(`data-activity="${pastime.id}"`);
    expect(html).toContain(`title="Claude is ${pastime.label} (4pm–4:30pm) · every account is at its limit until later`);
  });

  it("announces a walled afternoon as the nap the scene will draw, not coding", () => {
    vi.useFakeTimers();
    vi.setSystemTime(at(12, 10));
    walled(at(18, 0).getTime() / 1000);
    expect(render(<Tamagotchi />)).toMatch(/title="Claude is having [^"(]+ for lunch \(noon–1pm\) · [^"]+ · up next at 1pm: napping at the desk"/);
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
    expect(scene("run", { kind: "api" }, { occasion: "halloween", trick: true })).not.toContain("tama-orbit");
  });

  it("naps at the desk while every account is walled", () => {
    const html = scene("nap", null, { walled: { day: null, time: "3pm" } });
    expect(html).toContain('data-activity="nap"');
    for (const piece of ["back at", ">3pm<", "tama-eyes-closed", "tama-z", "tama-desk"]) expect(html).toContain(piece);
    expect(scene("read", null, { walled: { day: "Thu", time: "3pm" } })).toContain('data-activity="read"');
  });

  it("lights the jack-o'-lantern under the desk through the nap in Halloween week", () => {
    expect(scene("nap", null, { occasion: "halloween", walled: { day: null, time: "3pm" } })).toContain("tama-jack");
  });

  it("wakes from the nap for the bell, as it does at night", () => {
    const html = scene("nap", { kind: "bell" }, { walled: { day: null, time: "3pm" } });
    expect(html).toContain('data-pose="bell"');
    for (const piece of ["tama-slap", "tama-ding", ">3pm<", "tama-bubble"]) expect(html, piece).toContain(piece);
    expect(html).not.toContain("tama-eyes-closed");
    expect(html).not.toContain("tama-z");
    expect(html).not.toContain("tama-alarm");
    // Anything else leaves Clawd asleep under its bubble.
    expect(scene("nap", { kind: "done" }, { walled: { day: null, time: "3pm" } })).toContain("tama-eyes-closed");
  });

  it("lights one split per working agent, up to four", () => {
    const vertical = 'x="27.45"';
    const horizontal = 'y="8.45"';
    const one = scene("code", null, { working: 1 });
    expect(count(one, "tama-type")).toBe(3);
    expect(one).not.toContain(vertical);
    const two = scene("code", null, { working: 2 });
    expect(count(two, "tama-type")).toBe(6);
    expect(two).toContain(vertical);
    expect(two).not.toContain(horizontal);
    // Three: a 2×2 grid, three lit, the fourth (bottom right, x ≥ 28) dark.
    const three = scene("code", null, { working: 3 });
    expect(count(three, "tama-type")).toBe(6);
    expect(three).toContain(horizontal);
    expect(three).not.toMatch(/class="tama-type"[^>]*x="28\.00" y="9\.10"/);
    const busy = scene("code", null, { working: 7 });
    expect(count(busy, "tama-type")).toBe(8);
    expect(busy).toMatch(/class="tama-type"[^>]*x="28\.00" y="9\.10"/); // the fourth cell, lit
    expect(busy).toContain('data-working="4"');
    expect(scene("code", null, { working: 0 })).toContain('data-working="0"');
    expect(scene("code", null)).not.toContain("data-working");
  });

  it("keeps mirroring the agents under the bell and the parcel, not under a screen kind", () => {
    expect(scene("code", { kind: "bell" }, { working: 2 })).toContain('data-working="2"');
    expect(scene("code", { kind: "update" }, { working: 2 })).toContain('data-working="2"');
    const done = scene("code", { kind: "done" }, { working: 2 });
    expect(done).not.toContain("data-working");
    expect(done).not.toContain("tama-type");
  });

  it("draws the duty screens inside the desk, under the 9am mug", () => {
    const html = scene("code", { kind: "ci" }, { coffee: true });
    const at = (needle) => html.indexOf(needle);
    expect(at("tama-errors")).toBeGreaterThan(at('class="tama-desk"'));
    expect(at("tama-errors")).toBeLessThan(at("tama-desk-mug"));
  });

  it("asks for a compact when the context is costly rather than full", () => {
    expect(scene("code", { kind: "ctx", label: "1", cost: true })).toContain(">compact?<");
    expect(scene("code", { kind: "ctx", label: "87%", pct: 87 })).toContain(">87%<");
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

describe("critters", () => {
  const critters = CRITTERS.filter((c) => c.sprite);
  const scenes = [...ids, "nap"];
  const scene = (critter, activity, extra = {}) =>
    render(<TamaScene activity={activity} walled={activity === "nap" ? { day: null, time: "3pm" } : null}
                      critter={critter} {...extra} />);
  const count = (html, needle) => html.split(needle).length - 1;

  it.each(critters.map((c) => [c.id, c]))("%s takes Clawd's place in every scene", (_id, c) => {
    for (const id of scenes) {
      const html = scene(c, id);
      expect(html, id).toContain(`data-critter="${c.id}"`);
      // Scoped to the mascot's own group: a beer/kids scene's friend and kids
      // carry `class="critter"` too now, so a check anywhere in the markup
      // would pass even for a mascot that drew nothing of its own.
      expect(html.slice(html.indexOf('class="tama-creature')), id).toContain('class="critter"');
      expect(html, id).not.toContain("tama-body");
      expect(html, id).not.toContain("tama-legs-a");
    }
  });

  it("keeps drawing Clawd by default", () => {
    const html = render(<TamaScene activity="code" />);
    expect(html).toContain("tama-body");
    expect(html).not.toContain("data-critter");
  });

  it("scales the critter about the view box, not styles.css's fill-box pivot", () => {
    // Node can't measure layout (styles.css's `.tama g { transform-box: fill-box }`
    // would pivot scale() around this group's own, mood-dependent bounding box
    // instead of 0,0) — this pins the inline override instead.
    const html = scene(critterById("jelly"), "code");
    expect(html).toContain('<g class="tama-critter" style="transform-box: view-box"');
  });

  it("keeps the scene's props", () => {
    const jelly = critterById("jelly");
    expect(scene(jelly, "code")).toContain("tama-desk");
    expect(scene(jelly, "read")).toContain("tama-fire");
    expect(scene(jelly, "run", { season: "winter" })).toContain("tama-scenery");
    expect(scene(jelly, "eat", { duty: { kind: "ci", label: "1", more: 0 } })).toContain("tama-bubble");
  });

  it("shows the coding mood in the critter's own layers, not Clawd's face", () => {
    const html = scene(critterById("ember"), "code", { mood: "furious" });
    // data-mood="furious" on the root <svg> and tama-smoke from MoodDesk are
    // both drawn regardless of whether Critter honors mood — assert on the
    // critter's own markup instead, so a mood-blind Critter fails this.
    const own = html.slice(html.indexOf('class="critter"'));
    expect(own).toContain('data-mood="furious"');
    expect(own).not.toContain('data-mood="calm"');
    expect(html).toContain("tama-smoke");
    expect(html).not.toContain("tama-brows");
    expect(html).not.toContain("tama-hand");
  });

  it("rides the furious heat shimmer up onto a seated critter's head", () => {
    const html = scene(critterById("ember"), "code", { mood: "furious" });
    expect(html).toMatch(/<g transform="translate\(0 -2\)"><g class="tama-shimmer"/);
  });

  it("stays calm in the critter while on duty, as Clawd does", () => {
    const html = scene(critterById("ember"), "code", { mood: "furious", duty: { kind: "ci", label: "1", more: 0 } });
    expect(html).toContain('data-mood="calm"');
    expect(html).not.toContain('data-mood="furious"');
  });

  it("shuts the critter's eyes asleep, not while the bell rings", () => {
    const volt = critterById("volt");
    expect(scene(volt, "sleep")).toContain('data-role="shut"');
    expect(scene(volt, "nap")).toContain('data-role="shut"');
    expect(scene(volt, "code")).not.toContain('data-role="shut"');
    expect(scene(volt, "sleep", { duty: { kind: "bell", label: "1", more: 0 } })).not.toContain('data-role="shut"');
  });

  it("drops the overlays drawn for Clawd's body", () => {
    const moss = critterById("moss");
    const done = scene(moss, "code", { duty: { kind: "done", label: "1", more: 0 } });
    expect(done).toContain("tama-sparkle");
    expect(done).not.toContain("tama-cheer");
    expect(scene(moss, "code", { duty: { kind: "bell", label: "1", more: 0 } })).not.toContain("tama-slap");
  });

  it("lifts the hats onto a seated critter's head, and leaves a standing one's alone", () => {
    const nox = critterById("nox");
    expect(scene(nox, "read", { occasion: "yearend" })).toMatch(/<g transform="translate\(0 -2\)"><g class="tama-hat-santa"/);
    expect(scene(nox, "eat", { occasion: "yearend" })).not.toContain('translate(0 -2)');
  });

  // The mascot's own critter, not a beer/kids scene's friend or kids: those
  // carry `class="critter"` too now, nested in Behind, ahead of the mascot's
  // group (`tama-creature`) in the markup.
  const faceOf = (html) => html.slice(html.indexOf('class="tama-creature')).match(/<g class="critter"(?: data-face="(\w+)")?/)[1] ?? null;
  const duty = (kind) => ({ duty: { kind, label: "1", more: 0 } });

  it.each(critters.map((c) => [c.id, c]))("%s makes Clawd's duty faces when he would", (_id, c) => {
    expect(faceOf(scene(c, "code", duty("done")))).toBe("happy");
    expect(faceOf(scene(c, "code", { ...duty("merged"), party: true }))).toBe("happy");
    expect(faceOf(scene(c, "eat", duty("done")))).toBe("happy"); // a face kind, away from the desk
    expect(faceOf(scene(c, "code", duty("api")))).toBe("x");
    expect(faceOf(scene(c, "code", duty("ctx")))).toBe("worried");
    expect(faceOf(scene(c, "code", duty("update")))).toBe("down");
    expect(faceOf(scene(c, "beer"))).toBe("happy"); // a smiling pastime
  });

  it.each(critters.map((c) => [c.id, c]))("%s keeps its own face otherwise", (_id, c) => {
    expect(faceOf(scene(c, "code"))).toBeNull();
    expect(faceOf(scene(c, "code", { mood: "furious" }))).toBeNull(); // the mood stays its own layers
    expect(faceOf(scene(c, "code", duty("ci")))).toBeNull();
    expect(faceOf(scene(c, "eat", duty("update")))).toBeNull(); // update only shows at the desk
    expect(faceOf(scene(c, "sleep"))).toBeNull();
    expect(faceOf(scene(c, "beer", duty("api")))).toBe("x"); // on duty, the smile gives way
  });

  it("puts the bell's \"!\" on the critter's own head, and only away from the desk", () => {
    const nox = critterById("nox");
    const away = scene(nox, "beer", duty("bell"));
    expect(count(away, "tama-startle")).toBe(1);
    // Anchored on the mascot's own group: in a beer scene the first
    // `class="critter"` in the markup belongs to the friend, not the mascot.
    expect(away.slice(away.indexOf('class="tama-creature'))).toContain("tama-startle");
    expect(scene(nox, "code", duty("bell"))).not.toContain("tama-startle");
  });
});

describe("critter faces follow Clawd's in every scene", () => {
  // Clawd's face chain (TamaDuty.jsx: HappyEyes/XEyes/Worried/LookDown/Startle)
  // and critterFace (Tamagotchi.jsx's pose logic, drawn by Critter.jsx's
  // faceGlyphs) decide the same thing twice, from the same scene inputs.
  // Nothing ties them together, so a change to one chain without the other
  // would silently desync a critter from Clawd. This walks the full matrix
  // and checks they agree on every scene, scene by scene.

  // Each marker is unique to its component's markup (TamaDuty.jsx) and
  // doesn't collide with another face or with a critter's own faceGlyphs
  // markup (different units, different shapes).
  const clawdFace = (html) => {
    if (html.includes('class="tama-happy-eyes"')) return "happy";
    if (/l1\.2 1\.5 M/.test(html)) return "x";
    if (/<g fill="none" stroke="[^"]+" stroke-width="0\.4"><path/.test(html)) return "worried";
    if (/<g fill="[^"]+"><rect x="[\d.]+" y="[\d.]+" width="1" height="1\.6"><\/rect><rect x="[\d.]+" y="[\d.]+" width="1" height="1\.6"><\/rect><\/g>/.test(html)) return "down";
    return null;
  };
  // Scoped to the mascot's own group, same reason as faceOf above: a beer or
  // kids scene's friend/kids are critters too, drawn ahead of it in Behind.
  const critterFace = (html) => {
    const from = html.indexOf('class="tama-creature');
    return (html.slice(from).match(/<g class="critter"(?: data-face="(\w+)")?/) || [])[1] ?? null;
  };

  it("matches Clawd's face and startle on every activity × duty × mood × occasion × trick × party", () => {
    const scope = critterById("scope");
    const KINDS = [null, "bell", "done", "merged", "ci", "api", "ctx", "update"];
    const mismatches = [];
    const faceCounts = {};
    let startleCount = 0;
    let n = 0;
    for (const activity of [...ids, "nap"]) {
      for (const kind of KINDS) {
        for (const mood of ["calm", "grumpy", "furious"]) {
          for (const occasion of [null, "halloween", "yearend", "newyear"]) {
            for (const trick of [false, true]) {
              for (const party of [false, true]) {
                const props = {
                  activity, mood, occasion, trick, party, working: 2,
                  duty: kind && { kind, label: "1", more: 0 },
                  walled: activity === "nap" ? { day: null, time: "3pm" } : null,
                };
                const clawd = render(<TamaScene {...props} />);
                const critter = render(<TamaScene {...props} critter={scope} />);
                const cFace = clawdFace(clawd);
                const cStartle = clawd.includes("tama-startle");
                const sFace = critterFace(critter);
                const sStartle = critter.includes("tama-startle");
                n += 1;
                faceCounts[String(cFace)] = (faceCounts[String(cFace)] || 0) + 1;
                if (cStartle) startleCount += 1;
                if (cFace !== sFace || cStartle !== sStartle) {
                  mismatches.push({ activity, kind, mood, occasion, trick, party, clawd: [cFace, cStartle], critter: [sFace, sStartle] });
                }
              }
            }
          }
        }
      }
    }
    if (mismatches.length) {
      throw new Error(
        `${mismatches.length}/${n} scenes disagree (first 5):\n${mismatches.slice(0, 5).map((m) => JSON.stringify(m)).join("\n")}`,
      );
    }
    // The matrix only proves something if it actually exercises every face.
    for (const face of ["happy", "x", "worried", "down"]) {
      expect(faceCounts[face], face).toBeGreaterThan(0);
    }
    expect(startleCount).toBeGreaterThan(0);
  });
});

describe("critters at their pastimes", () => {
  const scene = (critter, activity, extra = {}) => render(<TamaScene activity={activity} critter={critter} {...extra} />);
  const nox = critterById("nox");

  it("keeps a pastime's props but drops what Clawd wears on his face and neck", () => {
    expect(render(<TamaScene activity="swim" />)).toContain("tama-goggles");
    expect(scene(nox, "swim")).not.toContain("tama-goggles");
    expect(render(<TamaScene activity="sled" season="winter" />)).toContain("tama-scarf");
    expect(scene(nox, "sled", { season: "winter" })).not.toContain("tama-scarf");
    expect(scene(nox, "cycle")).toContain("tama-helmet");
  });

  it("lifts the head props onto a seated critter's head at a pastime too", () => {
    expect(scene(nox, "sled", { season: "winter" })).toMatch(/<g transform="translate\(0 -2\)"><rect class="tama-snowcap"/);
    expect(scene(nox, "game", { occasion: "yearend" })).toMatch(/<g transform="translate\(0 -2\)"><g class="tama-hat-santa"/);
  });

  const count = (html, needle) => html.split(needle).length - 1;

  // Parses a wrapper's `translate(a b) scale(sx[ sy])` and maps the sprite's
  // own box (spriteBox) through it: pins the geometry itself, not just the
  // placement() call that produced it, so a wrong x0 or a dropped mirror
  // term in TamaPastimes.jsx fails here even if placement() stays correct.
  function mapBoxThrough(transform, box) {
    const m = /translate\(([-\d.]+) ([-\d.]+)\) scale\(([-\d.]+)(?: ([-\d.]+))?\)/.exec(transform);
    const tx = Number(m[1]);
    const ty = Number(m[2]);
    const sx = Number(m[3]);
    const sy = m[4] !== undefined ? Number(m[4]) : sx;
    return { centreX: tx + sx * (box.x + box.w / 2), feetY: ty + sy * (box.y + box.h) };
  }

  it("has a beer with a friend of its own kind: mirrored, in other colours, smiling", () => {
    const html = scene(nox, "beer");
    expect(count(html, 'class="critter"')).toBe(2);
    const friend = html.slice(html.indexOf('class="tama-friend"'));
    const transform = friend.match(/<g class="tama-critter"[^>]*transform="([^"]+)"/)[1];
    expect(transform).toMatch(/^translate\([^)]*\) scale\(-/); // mirrored: a negative x scale
    const { centreX, feetY } = mapBoxThrough(transform, spriteBox(nox.sprite));
    expect(centreX).toBeCloseTo(26.5, 2); // FRIEND_X0 (18) + 8.5
    expect(feetY).toBeCloseTo(19, 2); // the scene's floor line
    expect(friend).toContain('data-face="happy"');
    expect(friend).toContain(`fill="${hueRotate("#c6e05a", FRIEND_HUE)}"`);
    expect(html).not.toContain('fill="#6f93d6"'); // no blue Clawd
    expect(friend).toContain("tama-pint");
  });

  it("plays with two half-size kids of its own kind", () => {
    const html = scene(nox, "kids");
    expect(count(html, 'class="critter"')).toBe(3);
    const box = spriteBox(nox.sprite);
    // Scoped to Behind's markup, ahead of the mascot's own group: the mascot
    // wraps itself in `tama-critter` too, which would otherwise be a third match.
    const behind = html.slice(0, html.indexOf('class="tama-creature'));
    const transforms = [...behind.matchAll(/<g class="tama-critter"[^>]*transform="([^"]+)"/g)].map((m) => m[1]);
    expect(transforms).toHaveLength(2);
    const centres = transforms.map((t) => mapBoxThrough(t, box).centreX);
    expect(centres[0]).toBeCloseTo(21.65, 2); // kid x 17.4 + 4.25
    expect(centres[1]).toBeCloseTo(29.65, 2); // kid x 25.4 + 4.25
    for (const t of transforms) expect(mapBoxThrough(t, box).feetY).toBeCloseTo(19, 2);
    expect(count(html, 'class="tama-kid')).toBe(2);
  });

  it("still dresses the kids in sheets on a Halloween evening", () => {
    expect(count(scene(nox, "kids", { trick: true }), 'class="tama-kid-sheet"')).toBe(2);
  });

  it("keeps Clawd's own friend and kids for Clawd", () => {
    expect(render(<TamaScene activity="beer" />)).toContain('fill="#6f93d6"');
    expect(render(<TamaScene activity="beer" />)).not.toContain('class="critter"');
    expect(render(<TamaScene activity="kids" />)).not.toContain('class="critter"');
  });
});

describe("<Tamagotchi> with a critter", () => {
  afterEach(() => {
    vi.useRealTimers();
    prefsSignal.value = { ...prefsSignal.value, ui: {} };
  });

  it("draws the picked critter and names it in the hover", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 21, 14, 30));
    prefsSignal.value = { ...prefsSignal.value, loaded: true, ui: { tama_critter: "nox" } };
    const html = render(<Tamagotchi />);
    expect(html).toContain('data-critter="nox"');
    expect(html).toContain('title="Nox is coding (1pm–5pm)');
  });

  it("stays Clawd, called Claude, with nothing picked", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 21, 14, 30));
    const html = render(<Tamagotchi />);
    expect(html).not.toContain("data-critter");
    expect(html).toContain('title="Claude is coding (1pm–5pm)');
  });
});

describe("Clawd's drawing, pinned", () => {
  // Every activity × duty kind × mood × occasion × season, hashed. Critter work
  // must never move a pixel of Clawd: a failure here means a change reached his
  // drawing. Update the hash only for a change to Clawd that's meant.
  it("renders every combination exactly as before", () => {
    const KINDS = [null, "bell", "done", "merged", "ci", "api", "ctx", "update"];
    const hash = createHash("sha256");
    let n = 0;
    for (const activity of [...ids, "nap"]) {
      for (const kind of KINDS) {
        for (const mood of ["calm", "grumpy", "furious"]) {
          for (const occasion of [null, "halloween", "yearend", "newyear"]) {
            for (const season of ["summer", "winter"]) {
              hash.update(render(
                <TamaScene activity={activity} season={season} occasion={occasion} mood={mood} working={2}
                           duty={kind && { kind, label: "1", more: 0 }} party={kind === "merged"}
                           walled={activity === "nap" ? { day: null, time: "3pm" } : null} />,
              ));
              hash.update("\n");
              n += 1;
            }
          }
        }
      }
    }
    expect(n).toBe(3264);
    expect(hash.digest("hex")).toBe("355da01dc9d061fcadcececf89882f0b92f8aa96e78944ec91680969f22be094");
  });
});
