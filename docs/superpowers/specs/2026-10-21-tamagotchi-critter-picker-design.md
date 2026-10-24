# Tamagotchi critter picker — design

**Source:** `docs/specs/tamagotchi-picker-and-notifications.md` Part 1 (the
handout), art in `docs/specs/assets/critters/`. Ships as PR 1, before the
notification work (`2026-10-21-native-notifications-design.md`).

## Goal

A Settings choice of which creature lives in the header corner: `clawd`
(default, unchanged), `scope`, `jelly`, `nox`, `ember`, `volt`, `moss`, `octocat`
(added after the first six: an original pixel take on GitHub's mascot, its SVG
drawn to the same conventions). Picking
one swaps it in immediately and survives reload; a default install still shows
Clawd.

## Approach

Critters are **data plus one renderer**, not six hand-written components and
not injected SVG strings:

- one `Critter.jsx` means mood switching, sleeping eyes and placement are
  written once;
- the source SVGs animate with SMIL, which `prefers-reduced-motion` can't stop,
  and each carries an ~8 KB C2PA metadata block — neither belongs in the bundle.

**The sprite data and its CSS are generated** (decided while planning): a
stdlib-only `build_critters.py` at the repo root (beside `build_icons.py`)
reads the SVGs and writes `static/src/chrome/critterSprites.js` (the trees) and
`static/critters.css` (one class + `@keyframes` per SMIL animation). Both are
committed. Hand-transcribing ~300 rects and 32 animations would be slow and
error-prone. The script raises on anything outside the conventions the six SVGs
follow, so a new SVG fails loudly instead of drawing wrong. **Adding a critter**
= drop its SVG in `docs/specs/assets/critters/`, add its id to the script's
`CRITTERS` list and to the server's `TAMA_CRITTERS` tuple, re-run. A pytest
checks the committed output is fresh and that the two id lists agree.

The SVGs stay in `docs/specs/assets/critters/` as source art; nothing ships
from there.

## Units

### `static/src/chrome/critters.js` — pure, no DOM

```js
export const CRITTERS = [
  { id: "clawd", name: "Clawd", sprite: null },  // drawn by Tamagotchi.jsx's Sprite/Eyes
  { id: "scope", name: "Scope", sprite: { name, root } },  // from critterSprites.js
  ...
];
export const CLAWD_HEIGHT = 10;
export function critterById(id)              // unknown / unset → the clawd entry
export function spriteBox(sprite)            // visible bbox of the always-drawn layers
export function placement(sprite, { x0, sitting })  // → { scale, tx, ty, top } for the scene
```

A sprite (`critterSprites.js`) is `{ name, root: [node…] }` in the source's
20×20 coordinates. It keeps the SVG's nesting, because paint is inherited
(Nox's outline is a stroked group under a fill-only copy):

- rect: `{ r: [x, y, w, h], a?: { fill, stroke, "stroke-width", opacity } }`;
- group: `{ g: [node…], a?, mood?, role?, shut?, anim? }`.

The group fields:

- `mood` — `"calm" | "grumpy" | "furious"`; absent means always drawn
  (the SVGs' `.mood-*` classes).
- `anim` — a class from `static/critters.css`. An animated rect is wrapped in a
  group that carries the class.
- `role` — what sleep does to it:
  - `"eye"` — a blinking eye (Scope, Jelly, Ember, Volt, Octocat);
  - `"lid"` — the rect that grows over the eye to blink (Nox, Moss);
  - `"glint"` — the calm highlight on a blinking eye.
- `shut: [x, y, w, h]` — the closed frame, on eyes and lids. For an eye it's
  the blink's lowest frame, held; for a lid, the lid at full height.

**`spriteBox` measures only layers without a `mood`.** Mood-only rects sit
outside the body (Jelly's furious sparks at x=2 and x=17); counting them would
move the critter sideways every time its mood changes.

**`placement`** scales the critter so its visible height matches Clawd's
standing height (body 4 rows × 2 + legs = **10 units**), centred on Clawd's
centre (`x0 + 8.5`):

- standing: bottom on the feet line, **y = 19**;
- sitting (`code`, `nap`, `read`, and the seated pastimes `game`, `swim`,
  `sled`): bottom at **y = 17**, where sitting Clawd's body ends. Bottom-aligning
  to 19 would sink the critter through the desk chair's seat (y 16.9), the
  armchair's (16.8) and the couch cushion (16.6).

Scales come out at 0.59–0.67 (measured from the rects: Ember and Scope 17 units
tall, Volt 16, the rest 15). **Known trade-off, accepted:** the widget renders
at an exact integer zoom (4× or 6×, `styles.css` `.tama`) for crisp edges, so a
critter pixel lands on a fractional number of CSS px (about 2.4–4) and `crispEdges` rounds unevenly — some pixel columns
come out a device pixel wider than others. A fixed 0.5 scale would keep them
uniform on Retina, at the cost of smaller critters (7.5–8.5 units); matching
Clawd's height was chosen instead.

**Superseded 2026-10-23:** critters now stand `CRITTER_HEIGHT` = 12 (scales
0.71–0.80), Clawd's height only under a Halloween sheet; see the Size section of
`2026-10-23-critter-held-props-batch1-design.md`. The uneven-columns trade-off
above still applies at those scales, and is still accepted.

### `static/src/chrome/Critter.jsx`

`<Critter sprite mood="calm" asleep={false} />` draws the layers, in sprite
coordinates:

- layers with no `mood`, plus the layers whose `mood` matches — nothing else;
- `asleep`: each `eye` and `lid` group is drawn as its static `shut` rect
  (the held blink frame: a thin line for an eye, a closed lid for Nox and
  Moss), and `glint` groups are skipped.

Used in two places: inside the header scene, and on its own in a
`<svg viewBox="0 0 20 20">` as the Settings preview.

### `Tamagotchi.jsx`

`TamaScene` gains `critter` (an entry from `CRITTERS`). For `clawd`, nothing
changes. For any other critter, inside the existing `.tama-creature` group:

```jsx
<g class="tama-critter" style="transform-box: view-box" transform={`translate(${tx} ${ty}) scale(${scale})`}>
  <Critter sprite={critter.sprite} mood={moody ? mood : "calm"} asleep={asleep} />
</g>
```

- **The placement transform is an SVG attribute on a wrapper that no CSS
  animation targets.** A CSS `transform` (the creature's bob, shake, hop)
  overrides a `transform` attribute on the same element — the trap the heart's
  comment in `Tamagotchi.jsx` records. The creature group animates; the
  wrapper inside it doesn't. The wrapper also sets `transform-box: view-box`,
  because `styles.css`'s `.tama g { transform-box: fill-box }` would otherwise
  pivot the `scale()` around the group's own bounding box, which shifts with
  its mood and animated children.
- **Replaced for critters:** Clawd's body and leg `Sprite`s, and the overlays
  drawn for Clawd's body only — `Eyes`, `MoodFace` (brows, flush, scowl,
  skin-coloured typing hands and key clacks), `HappyEyes`, `XEyes`, `LookDown`,
  `Worried`, `ArmsUp`, `SlapHand`, and the two pastime props worn on Clawd's own
  face and neck, `Goggles` (swim) and `Scarf` (sled), which would float across a
  critter's body.
- **Kept, unchanged:** every scene prop — `Behind` / `InFront` (desk, chair,
  armchair, fireplace, scenery, seasons), occasions (jack-o'-lantern, tree,
  stockings, fireworks, confetti), duty screens, `DeskProps`, `DeskZs`,
  `AlarmClock`, `Sparkles`, `Extinguisher`, `MoodDesk` (flying keys, smoke,
  shimmer, spill), the bubble, the heart, `GhostSheet` + `Pail` (the sheet
  covers the creature whatever it is), and the pastimes' scenes and held props
  (`Behind`, `Front`, the bass, pint, controller, watering can, spoon). The bike's
  `lift` wrapper sits outside the creature group, so it raises a critter too.
- **Head-anchored props** — `SantaHat`, `PartyHat`, `Stars`, the winter
  snowcap, a pastime's `Headwear` (helmet, toque), and `MoodDesk`'s furious
  heat shimmer — are drawn at Clawd's
  head (top at `Y0 = 9`; `Startle` isn't among them — a critter draws its own
  "!" inside its own group, THI-415 part 1). For a critter they get an extra
  `translate(0, critterTop − Y0)` so they sit on its actual top (a sitting
  critter's top is ~2 units higher than Clawd's).
- **Mood:** the critter gets `moody ? mood : "calm"`, with `moody` exactly as today
  (`view.moodShown && MOODS[mood].rank > 0`) — a critter shows grumpy / furious
  in the same moments Clawd does. Celebrating, API-error and other duty poses
  show calm; the scene's own props carry them.
- **Asleep:** the existing `asleep` flag (night sleep or the walled nap, not
  ringing) closes the critter's eyes.

`Tamagotchi()` reads a module-level `pickedCritter = computed(() =>
critterById(getTamaCritter()))` and passes it down. It's its own computed
because `prefsSignal` is one blob of every ui pref: reading it in render would
rebuild the scene on any pin, reorder or splitter drag, and `critterById` returns
the same object for the same id, so the computed only notifies on a new pick. The hover label is `Claude is …` for Clawd, unchanged,
and `${critter.name} is …` for the others. Prefs load before the first render
(`main.jsx:31`), so a reload doesn't flash Clawd first.

### Motion — `static/critters.css` (generated)

One class + `@keyframes` per SMIL animation in the sources, in the style of
`tama-blink` / `tama-bob`, linked from `index.html` after `styles.css`:

Rect animations (`x` / `y` / `height`: blinks, lids, glances, Scope's bubbles,
Ember's flame) and group `translate` animations (tentacles, tails) become
`transform` keyframes; `opacity` stays `opacity`. `keyTimes` become keyframe
percentages, and `calcMode="discrete"` becomes `steps(1, end)` with the last
frame held to 100%. Each rect frame is `translate(dx, dy) scaleY(s)` about the top of the element's
fill-box, with `s = h / H` and the rect drawn at its full height `H`; that one
rule covers blinks, lids and Ember's flickering flame. Lengths are in sprite
units (CSS px inside SVG = user units), applied inside the scaled wrapper, so
they scale with the critter. The generated file opens with
`.critter g { transform-box: fill-box; transform-origin: 0 0; }`, so the
Settings previews outside `.tama` get it too.

**Each source's outer idle bob (`data-bob`) is dropped.** The scene already
moves `.tama-creature` per activity (breathe asleep, bob while coding and
eating, stride on the run) and per mood (grumpy: 0.3 s bob; furious:
`tama-shake`), so the critter inherits Clawd's tempo; keeping both would stack
two bobs. In `coffee` and `read`, where Clawd stands still apart from blinking,
the critter does too.

Reduced motion: `.critter-preview *` (the Settings previews, Clawd's blink
included) joins `.tama *` in the existing
`@media (prefers-reduced-motion: reduce)` rule. The header critter is already
inside `.tama`.

### Settings — `overlays/TamaPicker.jsx`, mounted by `SettingsModal.jsx`

A **Tamagotchi** fieldset above the existing fields:

- a row of seven `<label>`s, each wrapping a real
  `<input type="radio" name="tama-critter">`, a 40 px preview (Clawd drawn by an
  exported `ClawdSprite` built from the same `Sprite`/`Eyes`, the others by
  `Critter`, calm, awake) and the name; the fieldset and its `<legend>` group
  the radios — no extra `role`, which would double the announced name;
- keyboard: native radio-group behaviour (arrow keys move and select);
- **saves on change** through `setTamaCritter(id)`, independently of the form's
  Save button. The other fields still save on Save; the modal's **Cancel does
  not undo a critter change** — it was already saved, like a toggle.

### Persistence

- `prefs.js`: `getTamaCritter()` returns `ui.tama_critter` when it names a
  known critter, else `"clawd"`; `setTamaCritter(id)` is
  `patchUI({ tama_critter: id })`.
- `periscope/routes/prefs.py`: `tama_critter: str | None = None` on `UIPatch`
  (without it Pydantic drops the field and the optimistic update reverts on the
  echo), validated in `patch_prefs_ui` against
  `TAMA_CRITTERS = ("clawd", "scope", "jelly", "nox", "ember", "volt", "moss", "octocat")`
  → 400 otherwise, like `view`. A comment on each list points at the other, and
  a test pins them equal.

## Tests

vitest (`static/src/chrome/__tests__/`):

- `critters.test.js` — ids in order; `critterById` falls back for unset and
  unknown ids; every sprite has `eye` or `lid` groups with a `shut` frame and
  calm, grumpy and furious layers; `spriteBox` ignores mood layers (a mood-only rect outside the body
  doesn't move it); `placement` gives height 10, bottom 19 standing and 17
  sitting, centred on `x0 + 8.5`.
- `critterRender.test.jsx` — each mood draws its own layers and none of the
  others; `asleep` draws each `eye`/`lid` as its held `shut` frame and drops
  glints.
- `tamagotchiRender.test.jsx` — each critter renders in every activity and
  pastime (including the nap) with no Clawd body; the default still renders
  Clawd; the wrapper's `transform-box: view-box`; mood in the critter's own
  layers; head props (hats, snowcap, shimmer) lifted on a seated critter;
  goggles and scarf dropped, helmet kept; hover copy uses the critter's name.
- prefs getter: default, unknown-id fallback.
- `overlays/__tests__/tamaPickerRender.test.jsx` — seven radios with previews,
  the checked one follows the saved pick.
- `__tests__/styles.test.js` — `critters.css` shares no keyframes name with
  `styles.css`.

pytest: `tests/routes/test_prefs.py` — `PATCH /api/prefs/ui` accepts each of
the seven ids, rejects junk with 400, and `TAMA_CRITTERS` matches the
generator's list; `tests/test_build_critters.py` — the committed output is
fresh, known conversions are exact, and every unsupported input raises with the
SVG's name.

## Done when

- Picking a critter swaps it in the header immediately and survives reload.
- All seven show calm / grumpy / furious correctly, sleep with their eyes
  closed, and stop moving under reduced motion.
- A default install still shows Clawd.
- `npm run build` + `static/dist/` committed; `bin/check` clean.

## Follow-ups

### Critters as expressive as Clawd

**Status:** duty poses are done as THI-415 part 1 (`docs/superpowers/specs/2026-10-22-critter-duty-faces-design.md`): faces generated from each critter's eye boxes, with optional per-critter face layers, and the bell's "!" on the critter's own head. The beer friend and the kids now match the mascot too (`docs/superpowers/specs/2026-10-22-critter-friend-and-kids-design.md`). Hats now fit each critter's head, and the goggles and scarf are back (part 2a, `docs/superpowers/specs/2026-10-23-critter-hats-and-worn-props-design.md`). Critters now hold the pint, the mug, the spoon, the watering can and the leash with their own arm, tentacle or tail, and stand 12 tall instead of Clawd's 10 (part 2b batch 1, `docs/superpowers/specs/2026-10-23-critter-held-props-batch1-design.md`). Critters also play the bass (their limb frets the neck, a paw strums) and hold the game controller in two paws, with Clawd's, Ember's, Volt's and Moss's side arms on the controller (part 2b batch 2, `docs/superpowers/specs/2026-10-24-critter-held-props-batch2-design.md`). At the desk they also type when grumpy or furious, put their arms up for a done or merged PR and slap the service bell, with their own appendages (part 3 hands, `docs/superpowers/specs/2026-10-24-critter-hands-design.md`). What remains: strides (run, bike, the dog walk) and legs hidden when sitting (part 3).

Today a critter stands in Clawd's spot with its own three mood layers and shut
eyes, and every *scene* prop stays. But everything drawn on Clawd's *body* is
either dropped or still positioned for Clawd. Clawd has far more range than a
critter. To match it:

- **Duty poses.** Clawd acts out what it's on duty for. A critter shows calm for
  all of them. Each pose needs a critter equivalent:
  - `HappyEyes` for done, merged, and the smiling pastimes;
  - `XEyes` for API errors;
  - `Worried` brows for context;
  - `LookDown` for an update;
  - `Startle` for the bell (currently drawn at Clawd's right edge, not the
    critter's).
- **Arms and hands.** The desk scenes animate Clawd's skin-coloured hands:
  - typing and key clacks while coding (`MoodFace`);
  - `ArmsUp` when celebrating;
  - `SlapHand` on the service bell.

  None of these exist for critters.
- **Activity and motion.** Clawd's legs stride on the run and the bike (`legs-a`
  / `legs-b`). A critter only bobs with the creature group. Furious Clawd adds a
  flush and a scowl on top of the mood; a critter has only its furious layer.
- **Worn pastime props.** `Goggles` (swim) and `Scarf` (sled) are dropped for
  critters, because they sit on Clawd's eyes and neck.
- **Held pastime props** (bass, pint, controller, watering can, spoon) are drawn
  at Clawd's hand position, so on a narrower critter they float beside it.
- **Hats** (Santa, party, helmet, toque, the snowcap) are lifted to the critter's
  head height but keep Clawd's 12-unit width and x position, so they don't fit
  narrow or off-centre heads.

**Likely approach:** give each critter *anchors* in its sprite data (head top and
width, eye boxes, hand points). Author the face kinds as extra SVG layers, e.g.
`class="face-happy"`, `face-x`, `face-worried`, the same way the mood layers are
done today. Teach `build_critters.py` to read both. Then:
- the anatomy overlays read the anchors instead of Clawd's `x0` constants;
- `Critter` renders the face layer for the current pose;
- hats and held props are positioned from the anchors.

**Constraints:**
- Clawd's rendering must stay byte-identical. Keep the 6,528-combination
  render-matrix check.
- A new critter still needs only its SVG, a line in each id list, and now its
  anchors.
