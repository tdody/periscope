// Render-path tests for the tamagotchi scene: the decisions the drawing
// encodes (which pose shows what), not the inventory of props.

import { createHash } from "node:crypto";
import render from "preact-render-to-string";
import { afterEach, describe, expect, it, vi } from "vitest";
import { prefsSignal } from "../../prefs.js";
import { accounts, usage, wallSpans, walls } from "../../store.js";
import {
  CLAWD_HEIGHT, CRITTER_HEIGHT, CRITTERS, cheerGlyphs, critterById, hatTransform, holdTip, holdTipInScene, hueRotate,
  limbGlyphs, placement, sceneToSprite, spriteBox,
} from "../critters.js";
import { BELL_REACH, KEYS_REACH } from "../TamaDuty.jsx";
import { Tamagotchi, TamaScene } from "../Tamagotchi.jsx";
import { BASS_FRET, Bass, FRIEND_HUE, PASTIME_SCENES } from "../TamaPastimes.jsx";
import { activityAt, activityLabel, BRUNCH, MEALS, PASTIMES, SCHEDULE, SKIN, Y0 } from "../tamagotchi.js";

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
    // Its own typing paws (TamaDuty TypingPaws), in its limb colour, not Clawd's skin.
    expect(html).toContain("tama-hand");
    expect(html).not.toContain(`fill="${SKIN}"`);
  });

  it("rides the furious heat shimmer up onto a seated critter's head", () => {
    const html = scene(critterById("ember"), "code", { mood: "furious" });
    // code's pose is seated at x0 3 (Tamagotchi.jsx POSES); the shimmer rides
    // up by however much higher the critter's own head sits than Clawd's (Y0).
    const headDy = placement(critterById("ember").sprite, { x0: 3, sitting: true }).top - Y0;
    expect(html).toContain(`<g transform="translate(0 ${headDy})"><g class="tama-shimmer"`);
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

  it("drops Clawd's own overlays, drawing its own hands in their place", () => {
    const moss = critterById("moss");
    const done = scene(moss, "code", { duty: { kind: "done", label: "1", more: 0 } });
    expect(done).toContain("tama-sparkle"); // the scene's own overlay, not sprite-gated
    // Its own arms up (critters.js cheerGlyphs), not Clawd's ArmsUp (SKIN).
    expect(done).toContain("tama-cheer");
    expect(done).not.toContain(`fill="${SKIN}"`);
    const bell = scene(moss, "code", { duty: { kind: "bell", label: "1", more: 0 } });
    // Its own slap (TamaDuty SlapPaw), not Clawd's SlapHand (SKIN).
    expect(bell).toContain("tama-slap");
    expect(bell).not.toContain(`fill="${SKIN}"`);
  });

  it("fits Clawd's hats to the critter's head, inside its own group", () => {
    const nox = critterById("nox");
    const seat = `<g class="tama-hat-seat" style="transform-box: view-box" transform="${hatTransform(nox.sprite)}">`;
    for (const activity of ["read", "eat"]) {
      const html = scene(nox, activity, { occasion: "yearend" });
      expect(html, activity).toContain(`${seat}<g class="tama-hat-santa"`);
      expect(html.indexOf("tama-hat-santa"), activity).toBeGreaterThan(html.indexOf('class="tama-critter"'));
      // Once only: Clawd's own santa hat (TamaScene's `!sprite` branch) must
      // not also draw for a critter, leaving two in the markup.
      expect(count(html, "tama-hat-santa"), activity).toBe(1);
    }
    expect(scene(nox, "code", { party: true, duty: { kind: "merged", label: "1", more: 0 } })).toContain(`${seat}<g class="tama-hat-party"`);
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

describe("critter hats and worn props follow Clawd's in every scene", () => {
  // CritterHats' headwear/snowcap rules and Clawd's own (TamaScene's
  // `!sprite` head-prop block) decide the same thing twice from the same
  // scene inputs, same risk as the face chain above: nothing ties them
  // together, so dropping `!hat`/`!ghost` from CritterHats, or the
  // `!sprite &&` guard on Clawd's Headwear <Head>, desyncs a critter from
  // Clawd without any other test noticing.
  const HAT_MARKS = ["tama-hat-santa", "tama-hat-party", "tama-toque", "tama-helmet", "tama-snowcap"];
  const WORN_MARKS = ["tama-goggles", 'class="tama-scarf"']; // exact: not "…-tail"
  const MARKS = [...HAT_MARKS, ...WORN_MARKS];

  // Scoped to the mascot's own group, same reason as faceOf/critterFace
  // above: a beer/kids scene's friend and kids are critters too, drawn ahead
  // of the mascot (`tama-creature`) in Behind's markup.
  const ownMarkup = (html) => html.slice(html.indexOf('class="tama-creature'));
  const marksIn = (body) => new Set(MARKS.filter((m) => body.includes(m)));

  it("draws the same set of hats/worn props for the critter as for Clawd, each inside its own seat", () => {
    const scope = critterById("scope");
    const mismatches = [];
    const seen = new Set();
    let n = 0;
    for (const activity of [...ids, "nap"]) {
      for (const kind of [null, "merged"]) {
        for (const occasion of [null, "halloween", "yearend", "newyear"]) {
          for (const season of ["summer", "winter"]) {
            for (const trick of [false, true]) {
              for (const party of [false, true]) {
                const props = {
                  activity, season, occasion, trick, party, working: 2,
                  duty: kind && { kind, label: "1", more: 0 },
                  walled: activity === "nap" ? { day: null, time: "3pm" } : null,
                };
                const clawd = ownMarkup(render(<TamaScene {...props} />));
                const critter = ownMarkup(render(<TamaScene {...props} critter={scope} />));
                const cSet = marksIn(clawd);
                const sSet = marksIn(critter);
                n += 1;
                for (const m of cSet) seen.add(m);
                for (const m of sSet) seen.add(m);
                const same = cSet.size === sSet.size && [...cSet].every((m) => sSet.has(m));
                if (!same) {
                  mismatches.push({ activity, kind, occasion, season, trick, party, clawd: [...cSet], critter: [...sSet] });
                  continue;
                }
                const seatAt = critter.indexOf('class="tama-hat-seat"');
                const seat = seatAt < 0 ? "" : critter.slice(seatAt);
                for (const m of sSet) {
                  // Present exactly once for the critter: twice would mean
                  // Clawd's own prop leaked in alongside the critter's.
                  if (critter.split(m).length - 1 !== 1) {
                    mismatches.push({ activity, kind, occasion, season, trick, party, dup: m });
                  }
                  // Every hat/snowcap sits inside the critter's own hat seat
                  // (the worn goggles/scarf don't: they sit on the eyes/neck).
                  if (HAT_MARKS.includes(m) && !seat.includes(m)) {
                    mismatches.push({ activity, kind, occasion, season, trick, party, unseated: m });
                  }
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
    // The matrix only proves something if it actually exercises every marker.
    for (const m of MARKS) expect(seen.has(m), m).toBe(true);
  });
});

const count = (html, needle) => html.split(needle).length - 1;
// Every critter, Clawd left out: both "critters at their pastimes" and
// "critters' hands at the desk" walk the same set.
const holders = CRITTERS.filter((c) => c.sprite).map((c) => [c.id, c]);
// Whether `needle` lies inside the <g> that opens at `open`: that group never closes before it.
const inside = (html, open, needle) => {
  const at = html.indexOf(needle, open);
  let depth = 0;
  for (const m of html.slice(open, at).matchAll(/<g[\s>]|<\/g>/g)) {
    depth += m[0] === "</g>" ? -1 : 1;
    if (depth === 0) return false;
  }
  return at > open;
};
// The placement the mascot's wrapper was actually drawn with.
const drawnPlace = (html) => {
  const [, tx, ty, scale] = /<g class="tama-critter"[^>]*transform="translate\(([-\d.e]+) ([-\d.e]+)\) scale\(([-\d.e]+)\)"/
    .exec(html.slice(html.indexOf('class="tama-creature')));
  return { tx: Number(tx), ty: Number(ty), scale: Number(scale) };
};
// The <g …> group opening at `open`, whole.
const groupAt = (html, open) => {
  let depth = 0;
  for (const m of html.slice(open).matchAll(/<g[\s>]|<\/g>/g)) {
    depth += m[0] === "</g>" ? -1 : 1;
    if (depth === 0) return html.slice(open, open + m.index + 4);
  }
  return html.slice(open);
};

describe("critters at their pastimes", () => {
  const scene = (critter, activity, extra = {}) => render(<TamaScene activity={activity} critter={critter} {...extra} />);
  const nox = critterById("nox");

  it("wears the goggles and the scarf on its own eyes and neck, not Clawd's", () => {
    expect(render(<TamaScene activity="swim" />)).toContain("tama-goggles");
    const swim = scene(nox, "swim");
    expect(swim).toContain('data-worn="goggles"');
    expect(swim.split("tama-goggles").length - 1).toBe(1); // the critter's, not Clawd's too
    const sled = scene(nox, "sled", { season: "winter" });
    expect(sled).toContain('data-worn="scarf"');
    expect(sled.split('class="tama-scarf"').length - 1).toBe(1);
    expect(scene(nox, "cycle")).toContain(`transform="${hatTransform(nox.sprite)}"><g class="tama-helmet"`);
  });

  it("seats the head props on the critter's head at a pastime too", () => {
    const seat = `transform="${hatTransform(nox.sprite)}">`;
    expect(scene(nox, "sled", { season: "winter" })).toContain(`${seat}<rect class="tama-snowcap"`);
    expect(scene(nox, "game", { occasion: "yearend" })).toContain(`${seat}<g class="tama-hat-santa"`);
    expect(scene(nox, "cook")).toContain(`${seat}<g class="tama-toque"`);
  });

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
    return { centreX: tx + sx * (box.x + box.w / 2), feetY: ty + sy * (box.y + box.h), scale: sy };
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
    for (const t of transforms) {
      const mapped = mapBoxThrough(t, box);
      expect(mapped.feetY).toBeCloseTo(19, 2);
      expect(mapped.scale * box.h).toBeCloseTo(CRITTER_HEIGHT / 2); // half its own height, not Clawd's
    }
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

  const HELD = [["beer", "pint"], ["coffee", "mug"], ["cook", "spoon"], ["garden", "can"], ["dog", "leash"]];
  const r4 = (v) => Math.round(v * 1e4) / 1e4;

  it.each(holders)("%s's own wrapper stands it CRITTER_HEIGHT tall, however the scene seats it", (_id, c) => {
    for (const activity of ["code", "beer"]) {
      const html = render(<TamaScene activity={activity} critter={c} />);
      const { scale } = drawnPlace(html);
      expect(scale * spriteBox(c.sprite).h).toBeCloseTo(CRITTER_HEIGHT);
    }
  });

  // The Halloween sheet (GhostSheet) is cut for Clawd's body: at CRITTER_HEIGHT
  // a tall critter's ears/horns/antenna poke through its top. Under a sheet a
  // critter goes back to CLAWD_HEIGHT; a plain run (no sheet) is the control.
  it.each(holders)("%s's own wrapper goes back to CLAWD_HEIGHT under a Halloween sheet", (_id, c) => {
    const box = spriteBox(c.sprite);
    const halloween = render(<TamaScene activity="run" trick season="autumn" occasion="halloween" critter={c} />);
    expect(drawnPlace(halloween).scale * box.h).toBeCloseTo(CLAWD_HEIGHT);
    const plain = render(<TamaScene activity="run" critter={c} />);
    expect(drawnPlace(plain).scale * box.h).toBeCloseTo(CRITTER_HEIGHT);
  });

  // Same reasoning as the mascot's own sheet, for the kids' little sheets
  // (KidSheet): both go back to half Clawd's height, not half the critter's.
  it.each(holders)("%s's kids go back to half CLAWD_HEIGHT under their Halloween sheets", (_id, c) => {
    const box = spriteBox(c.sprite);
    const html = render(<TamaScene activity="kids" trick critter={c} />);
    const behind = html.slice(0, html.indexOf('class="tama-creature'));
    const transforms = [...behind.matchAll(/<g class="tama-critter"[^>]*transform="([^"]+)"/g)].map((m) => m[1]);
    expect(transforms).toHaveLength(2);
    for (const t of transforms) expect(mapBoxThrough(t, box).scale * box.h).toBeCloseTo(CLAWD_HEIGHT / 2);
    // Both ghost scenes: the mascot's own wrapper too, same as the Halloween run.
    expect(drawnPlace(html).scale * box.h).toBeCloseTo(CLAWD_HEIGHT);
  });

  it.each(holders)("%s holds the pint, the mug, the spoon, the can and the leash itself", (_id, c) => {
    for (const [activity, kind] of HELD) {
      const html = render(<TamaScene activity={activity} critter={c} season="summer" />);
      expect(html.slice(html.indexOf('class="tama-creature')), activity).toContain(`data-holding="${kind}"`);
    }
  });

  it.each(holders)("%s's pint, mug and can sit inside its own critter wrapper, once, and Clawd's don't float beside it", (_id, c) => {
    const beer = render(<TamaScene activity="beer" critter={c} />);
    const mascotOpen = beer.indexOf('<g class="tama-critter"', beer.indexOf('class="tama-creature'));
    const friendOpen = beer.indexOf('<g class="tama-critter"', beer.indexOf('class="tama-friend"'));
    const pint = 'class="tama-pint tama-clink"';
    expect(count(beer, pint)).toBe(2); // the mascot's and the friend's, no Clawd float beside either
    expect(inside(beer, mascotOpen, pint)).toBe(true);
    expect(inside(beer, friendOpen, pint)).toBe(true);
    // The mirror already turns the friend's clink toward the mascot; tama-clink2 would turn it back.
    expect(beer).not.toContain("tama-clink2");
    // The pint sits at Clawd's size: CritterHeld undoes the wrapper's own scale.
    const [hx, hy] = holdTip(c.sprite, "pint");
    expect(beer).toContain(`translate(${hx} ${hy}) scale(${r4(1 / drawnPlace(beer).scale)}) translate(0 -11.5)`);
    const mugBody = 'x="25.5" y="12" width="3.4" height="4.6"';
    const coffee = render(<TamaScene activity="coffee" critter={c} />);
    const coffeeOpen = coffee.indexOf('<g class="tama-critter"', coffee.indexOf('class="tama-creature'));
    expect(count(coffee, mugBody)).toBe(1);
    expect(inside(coffee, coffeeOpen, mugBody)).toBe(true);
    const garden = render(<TamaScene activity="garden" critter={c} />);
    const gardenOpen = garden.indexOf('<g class="tama-critter"', garden.indexOf('class="tama-creature'));
    expect(count(garden, 'class="tama-can"')).toBe(1);
    expect(inside(garden, gardenOpen, 'class="tama-can"')).toBe(true);
  });

  it.each(holders)("%s's spoon and leash start at its own tip, wherever it was actually drawn", (_id, c) => {
    const cook = render(<TamaScene activity="cook" critter={c} />);
    // Inside .tama-creature, not just anywhere: it bobs with the critter's own group.
    expect(inside(cook, cook.indexOf('<g class="tama-creature'), 'class="tama-spoon"')).toBe(true);
    expect(count(cook, 'class="tama-spoon"')).toBe(1);
    const [sx, sy] = holdTipInScene(c.sprite, "spoon", drawnPlace(cook));
    expect(cook).toContain(`<line class="tama-spoon" x1="${sx}" y1="${sy}"`);
    const dog = render(<TamaScene activity="dog" critter={c} />);
    const [lx, ly] = holdTipInScene(c.sprite, "leash", drawnPlace(dog));
    expect(dog).toContain(`d="M${lx} ${ly} Q23 12.4 28.1 15"`);
  });

  it("curls a tail up to hold, so the resting one goes, the friend's too", () => {
    expect(render(<TamaScene activity="code" critter={nox} />)).toContain("crit-nox-1");
    expect(render(<TamaScene activity="beer" critter={nox} />)).not.toContain("crit-nox-1");
  });

  it("moves a holding critter's startle glyph off its held prop, to the body's left", () => {
    const c = critterById("ember");
    const x = r4(spriteBox(c.sprite).x - 1.4);
    const html = scene(c, "beer", { duty: { kind: "bell", label: "1", urgent: false, more: 0 } });
    expect(html).toContain(`class="tama-startle" fill="#f2c14e"><rect x="${x}"`);
  });

  it("pins BASS_FRET inside the neck's own band, not off its edge", () => {
    const { x0 } = PASTIME_SCENES.music.pose;
    const x = x0 + BASS_FRET.dx;
    // The neck is Bass's first path, a quadrilateral (top edge, then bottom):
    // read off the markup, so a redrawn neck re-checks the fret against itself.
    const d = render(<Bass x0={x0} />).match(/<path d="([^"]+)"/)[1];
    const [a, b, c, e] = [...d.matchAll(/(-?[\d.]+) (-?[\d.]+)/g)].map((m) => [+m[1], +m[2]]);
    const edgeY = ([x1, y1], [x2, y2]) => y1 + ((y2 - y1) * (x - x1)) / (x2 - x1);
    // Along the neck too: past its ends the edge lines run on into the headstock.
    expect(x).toBeGreaterThan(a[0]);
    expect(x).toBeLessThan(b[0]);
    expect(BASS_FRET.y).toBeGreaterThan(edgeY(a, b));
    expect(BASS_FRET.y).toBeLessThan(edgeY(c, e));
  });

  it.each(holders)("%s plays the bass: its limb frets the neck in front, a paw strums, no skin hands", (_id, c) => {
    const html = render(<TamaScene activity="music" critter={c} />);
    const mascot = html.slice(html.indexOf('class="tama-creature'));
    expect(mascot).toContain('data-holding="bass"');
    const wrapAt = mascot.indexOf('<g class="tama-critter"');
    const bassAt = mascot.indexOf('<g class="tama-bass"');
    expect(inside(mascot, wrapAt, 'class="tama-bass"')).toBe(true); // bobs and scales back with the critter
    // The bass's own group undoes the wrapper's placement exactly (not a swapped
    // translate/scale order, and view-box, not fill-box, so scale() pivots at 0,0):
    // off by either, the bass lands ~1.5 units from the fret spot.
    const { tx, ty, scale } = drawnPlace(html);
    expect(mascot).toContain(`<g style="transform-box: view-box" transform="scale(${1 / scale}) translate(${-tx} ${-ty})"><g class="tama-bass"`);
    const bass = groupAt(mascot, bassAt);
    expect(bass).not.toContain(`fill="${SKIN}"`);
    expect(mascot).not.toContain(`fill="${SKIN}"`); // Clawd's skin appears nowhere in a critter's scene
    expect(count(mascot, 'class="tama-bass"')).toBe(1); // no stray copy
    expect(count(bass, 'class="tama-strum"')).toBe(1);
    expect(bass).toContain(`fill="${c.sprite.limb.color}"`);
    const { x0 } = PASTIME_SCENES.music.pose;
    // Pinned the way the spoon line is (holdTipInScene): the strum paw's own spot.
    expect(bass).toContain(`class="tama-strum" x="${x0 + 7.3}" y="14.5"`);
    // The limb reaches the fret spot through the placement actually drawn, after the bass.
    const tip = sceneToSprite(drawnPlace(html), [x0 + BASS_FRET.dx, BASS_FRET.y]);
    const last = limbGlyphs(c.sprite, "bass", tip).at(-1).g.at(-1).r;
    const lastRect = `<rect x="${last[0]}" y="${last[1]}" width="${last[2]}" height="${last[3]}">`;
    expect(mascot.indexOf(lastRect)).toBeGreaterThan(bassAt + bass.length - 1);
  });

  it.each(holders)("%s holds the controller in two paws, the right one tapping, no skin thumb", (_id, c) => {
    const html = render(<TamaScene activity="game" critter={c} />);
    const mascot = html.slice(html.indexOf('class="tama-creature'));
    expect(mascot).toContain('data-holding="controller"');
    const wrapAt = mascot.indexOf('<g class="tama-critter"');
    const ctlAt = mascot.indexOf('<g class="tama-controller"');
    const ctl = groupAt(mascot, ctlAt);
    expect(ctl).not.toContain(`fill="${SKIN}"`);
    expect(mascot).not.toContain(`fill="${SKIN}"`); // Clawd's skin appears nowhere in a critter's scene
    expect(count(mascot, 'class="tama-controller"')).toBe(1); // no stray copy
    expect(count(ctl, `fill="${c.sprite.limb.color}"`)).toBe(2);
    expect(count(ctl, 'class="tama-thumb"')).toBe(1);
    const { x0 } = PASTIME_SCENES.game.pose;
    // The right paw (at x0 + 10) taps; the left (x0 + 6.2) carries no class.
    expect(ctl).toContain(`class="tama-thumb" x="${x0 + 10}" y="14.3"`);
    expect(ctl).toContain(`<rect x="${x0 + 6.2}" y="14.3"`);
    expect(inside(mascot, wrapAt, 'class="tama-controller"')).toBe(false); // in front, in scene units
    expect(ctlAt).toBeGreaterThanOrEqual(wrapAt + groupAt(mascot, wrapAt).length); // after the whole wrapper closes
  });

  const tailCritters = [nox, critterById("ember")];
  it.each(tailCritters.map((c) => [c.id, c]))("%s frets with the tail, so it stops resting, but holds the controller in paws, so it rests", (_id, c) => {
    const tailAnim = `crit-${c.id}-1`;
    expect(render(<TamaScene activity="music" critter={c} />)).not.toContain(tailAnim);
    const game = render(<TamaScene activity="game" critter={c} />);
    expect(game).toContain(tailAnim);
    // Nox's tail (and so its paws) is outlined; Ember's isn't — each follows its own limb.
    const { color, outline } = c.sprite.limb;
    if (outline) {
      expect(game).toContain(`stroke="${outline}" stroke-width="0.25"`); // its black paws outlined on the dark controller
    } else {
      expect(game).toContain(`<rect class="tama-thumb" x="${PASTIME_SCENES.game.pose.x0 + 10}" y="14.3" width="1.6" height="1.3" rx="0.25" fill="${color}"></rect>`);
    }
  });

  it("rounds a tentacle's paw, not a square corner", () => {
    const jelly = critterById("jelly");
    const music = render(<TamaScene activity="music" critter={jelly} />);
    const { x0 } = PASTIME_SCENES.music.pose;
    expect(music).toContain(`class="tama-strum" x="${x0 + 7.3}" y="14.5" width="1.3" height="1" rx="0.5"`); // h/2 of its 1-unit strum paw
  });

  it("draws Clawd armless at the console, two SKIN paws on the grips instead of a lone thumb", () => {
    const game = render(<TamaScene activity="game" />);
    const { x0 } = PASTIME_SCENES.game.pose;
    // Row 2's arm cells (tamagotchi.js BODY): x 1–2 and 15–16, gone from the game body.
    expect(game).not.toContain(`<rect x="${x0 + 1}" y="13"`);
    expect(game).not.toContain(`<rect x="${x0 + 2}" y="13"`);
    expect(game).not.toContain(`<rect x="${x0 + 15}" y="13"`);
    expect(game).not.toContain(`<rect x="${x0 + 16}" y="13"`);
    const ctlAt = game.indexOf('<g class="tama-controller"');
    const ctl = groupAt(game, ctlAt);
    expect(count(ctl, `fill="${SKIN}"`)).toBe(2);
    expect(count(ctl, 'class="tama-thumb"')).toBe(1);
    // The coding pose shares Clawd's x0 with the game one, and keeps its arms.
    const code = render(<TamaScene activity="code" />);
    expect(code).toContain(`<rect x="${x0 + 1}" y="13"`);
    expect(code).toContain(`<rect x="${x0 + 2}" y="13"`);
    expect(code).toContain(`<rect x="${x0 + 15}" y="13"`);
    expect(code).toContain(`<rect x="${x0 + 16}" y="13"`);
  });

  it.each(holders)("%s's side arms (if any) go at the console, and come back everywhere else", (_id, c) => {
    const game = render(<TamaScene activity="game" critter={c} />);
    if (["ember", "volt", "moss"].includes(c.id)) {
      const code = render(<TamaScene activity="code" critter={c} />);
      const armNeedle = c.id === "ember" ? '<rect x="3" y="9"' : c.id === "volt" ? '<rect x="2" y="9"' : '<rect x="4" y="10"';
      expect(code, c.id).toContain(armNeedle);
      expect(game, c.id).not.toContain(armNeedle);
    } else {
      // No hold-arms at all (scope, jelly, nox, octocat): `paws` has nothing
      // to hide, so its own <g class="critter">…</g> group is unheld's,
      // byte for byte, plus the `data-holding` the controller adds — the
      // same equivalence the Nox "!" test uses (critterRender.test.jsx).
      const code = render(<TamaScene activity="code" critter={c} />);
      const critterAt = (html) => html.indexOf('<g class="critter"');
      const gameGroup = groupAt(game, critterAt(game));
      const codeGroup = groupAt(code, critterAt(code));
      expect(gameGroup.replace(' data-holding="controller"', ""), c.id).toBe(codeGroup);
    }
  });
});

describe("critters' hands at the desk", () => {
  const duty = (kind) => ({ duty: { kind, label: "1", urgent: false, more: 0 } });
  // The mascot's own group, whole: what it draws must bob, shake and hop with it.
  const mascotOf = (html) => groupAt(html, html.indexOf('<g class="tama-creature'));
  // The limb's last rect, as Node draws it, for a reach to a scene point through the drawn placement.
  const limbEnd = (c, html, point) => {
    const [x, y, w, h] = limbGlyphs(c.sprite, null, sceneToSprite(drawnPlace(html), point)).at(-1).g.at(-1).r;
    return `<rect x="${x}" y="${y}" width="${w}" height="${h}">`;
  };

  it.each(holders)("%s types when grumpy or furious: its limb at the keys, two paws tapping", (_id, c) => {
    for (const mood of ["grumpy", "furious"]) {
      const html = render(<TamaScene activity="code" mood={mood} working={2} critter={c} />);
      const mascot = mascotOf(html);
      expect(mascot, mood).toContain(limbEnd(c, html, KEYS_REACH));
      const fill = `fill="${c.sprite.limb.color}"`;
      expect(mascot).toMatch(new RegExp(`<rect class="tama-hand" x="20.7" y="11.9"[^>]*${fill}`));
      expect(mascot).toMatch(new RegExp(`<rect class="tama-hand tama-hand2" x="22.7" y="11.9"[^>]*${fill}`));
      expect(mascot).not.toContain(`fill="${SKIN}"`); // not Clawd's hands
      expect(mascot).not.toContain("tama-cheer"); // a reach and a cheer never together
    }
  });

  it("types and slaps with its tail, so the resting one goes", () => {
    for (const id of ["nox", "ember"]) {
      const c = critterById(id);
      expect(render(<TamaScene activity="code" mood="grumpy" working={2} critter={c} />)).not.toContain(`crit-${id}-1`);
      expect(render(<TamaScene activity="code" critter={c} {...duty("bell")} />)).not.toContain(`crit-${id}-1`);
    }
  });

  it("reaches Clawd's own hand spots: the first paw's middle, the slap paw's lower edge", () => {
    expect(KEYS_REACH[0]).toBeCloseTo(20.7 + 1.1 / 2);
    expect(KEYS_REACH[1]).toBeCloseTo(11.9 + 0.8 / 2);
    expect(BELL_REACH[0]).toBeCloseTo(21.6 + 1.2 / 2);
    expect(BELL_REACH[1]).toBeCloseTo(8.7 + 0.9);
  });

  it.each(holders)("%s keeps its desk hands at the desk: no slap, reach or cheer away from it", (_id, c) => {
    for (const activity of ["eat", "sleep"]) {
      const html = render(<TamaScene activity={activity} critter={c} {...duty("bell")} />);
      expect(html, activity).not.toContain("tama-slap");
      expect(mascotOf(html), activity).not.toContain(limbEnd(c, html, BELL_REACH));
    }
    expect(render(<TamaScene activity="eat" critter={c} {...duty("done")} />)).not.toContain("tama-cheer");
  });

  it.each(holders)("%s slaps the service bell, at the desk and when it wakes from the walled nap", (_id, c) => {
    const desk = render(<TamaScene activity="code" critter={c} {...duty("bell")} />);
    const nap = render(<TamaScene activity="nap" walled={{ day: null, time: "3pm" }} critter={c} {...duty("bell")} />);
    for (const html of [desk, nap]) {
      const mascot = mascotOf(html);
      expect(mascot).toContain(limbEnd(c, html, BELL_REACH));
      expect(mascot).toMatch(new RegExp(`<rect class="tama-slap" x="21.6" y="8.7"[^>]*fill="${c.sprite.limb.color}"`));
      expect(mascot).not.toContain(`fill="${SKIN}"`);
    }
  });

  it.each(holders)("%s puts its arms up for a done and a merged PR", (_id, c) => {
    for (const kind of ["done", "merged"]) {
      const html = render(<TamaScene activity="code" critter={c} {...duty(kind)} party={kind === "merged"} />);
      const wrapAt = html.indexOf('<g class="tama-critter"', html.indexOf('class="tama-creature'));
      expect(inside(html, wrapAt, 'class="tama-cheer'), kind).toBe(true);
      expect(count(html, 'class="tama-cheer')).toBe(cheerGlyphs(c.sprite).length);
      expect(mascotOf(html)).not.toContain(`fill="${SKIN}"`); // not Clawd's ArmsUp
    }
  });

  it("keeps the hands for their moments: no paws or cheer while calmly coding", () => {
    for (const [, c] of holders) {
      const html = render(<TamaScene activity="code" working={2} critter={c} />);
      expect(html).not.toContain("tama-hand");
      expect(html).not.toContain("tama-cheer");
      expect(html).not.toContain("tama-slap");
    }
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
    // 2026-10-24: game scenes changed on purpose — Clawd holds the controller
    // in both hands, side arms on it.
    expect(hash.digest("hex")).toBe("c72dc4e395d40aa31c659155dd0be43d5552f196cf46d30bb1db76678857bb06");
  });
});
