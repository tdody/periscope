# Tamagotchi critter picker — design

**Source:** `docs/specs/tamagotchi-picker-and-notifications.md` Part 1 (the
handout), art in `docs/specs/assets/critters/`. Ships as PR 1, before the
notification work (`2026-10-21-native-notifications-design.md`).

## Goal

A Settings choice of which creature lives in the header corner: `clawd`
(default, unchanged), `scope`, `jelly`, `nox`, `ember`, `volt`, `moss`. Picking
one swaps it in immediately and survives reload; a default install still shows
Clawd.

## Approach

Critters are **data plus one renderer**, not six hand-written components and
not injected SVG strings:

- one `Critter.jsx` means mood switching, sleeping eyes and placement are
  written once;
- adding a critter is a sprite entry in `CRITTERS` (plus the server id tuple,
  below);
- the source SVGs animate with SMIL, which `prefers-reduced-motion` can't stop,
  and each carries an ~8 KB C2PA metadata block — neither belongs in the bundle.

The SVGs stay in `docs/specs/assets/critters/` as source art; nothing ships
from there.

## Units

### `static/src/chrome/critters.js` — pure, no DOM

```js
export const CRITTERS = [
  { id: "clawd", name: "Clawd" },            // drawn by Tamagotchi.jsx's Cells/Eyes, no sprite
  { id: "scope", name: "Scope", sprite: { layers: [...] } },
  ...
];
export function critterById(id)              // unknown / unset → the clawd entry
export function spriteBox(sprite)            // visible bbox of the always-drawn layers
export function placement(sprite, { x0, sitting })  // → { scale, tx, ty } for the scene
```

A sprite is `{ layers: [{ rects: [[x, y, w, h, fill], …], mood?, role?, anim? }] }`
in the source's 20×20 coordinates:

- `mood` — `"calm" | "grumpy" | "furious"`; absent means always drawn
  (the SVGs' `.mood-*` classes).
- `role` — `"eyes"` (the eye rects and anything riding on them, e.g. calm-mood
  highlights) or `"lid"` (Nox's and Moss's blink, a rect that grows over the
  eye). Sleep needs to find both.
- `anim` — a class name from the `.critter` CSS block (below).

**`spriteBox` measures only layers without a `mood`.** Mood-only rects sit
outside the body (Jelly's furious sparks at x=2 and x=17); counting them would
move the critter sideways every time its mood changes.

**`placement`** scales the critter so its visible height matches Clawd's
standing height (body 4 rows × 2 + legs = **10 units**), centred on Clawd's
centre (`x0 + 8.5`):

- standing: bottom on the feet line, **y = 19**;
- sitting (`code`, `nap`, `read`): bottom at **y = 17**, where sitting Clawd's
  body ends. Bottom-aligning to 19 would sink the critter through the desk
  chair's seat (y 16.9) and the armchair's (16.8).

Scales come out at 0.59–0.67 (measured from the rects: Ember and Scope 17 units
tall, Volt 16, the rest 15). **Known trade-off, accepted:** the widget renders
at exactly 4× or 5× for crisp edges (`styles.css` `.tama`), so a critter pixel
lands on 2.4–3.3 CSS px and `crispEdges` rounds unevenly — some pixel columns
come out a device pixel wider than others. A fixed 0.5 scale would keep them
uniform on Retina, at the cost of smaller critters (7.5–8.5 units); matching
Clawd's height was chosen instead.

### `static/src/chrome/Critter.jsx`

`<Critter sprite mood="calm" asleep={false} />` draws the layers, in sprite
coordinates:

- layers with no `mood`, plus the layers whose `mood` matches — nothing else;
- `asleep`: every `eyes` and `lid` layer is skipped and each eye rect is
  replaced by a closed line (`height 0.5` at the eye's bottom edge, the
  `Eyes closed` treatment Clawd gets).

Used in two places: inside the header scene, and on its own in a
`<svg viewBox="0 0 20 20">` as the Settings preview.

### `Tamagotchi.jsx`

`TamaScene` gains `critter` (an entry from `CRITTERS`). For `clawd`, nothing
changes. For any other critter, inside the existing `.tama-creature` group:

```jsx
<g transform={`translate(${tx} ${ty}) scale(${scale})`}>   {/* placement: SVG attribute */}
  <Critter sprite={critter.sprite} mood={shownMood} asleep={asleep} />
</g>
```

- **The placement transform is an SVG attribute on a wrapper that no CSS
  animation targets.** A CSS `transform` (the creature's bob, shake, hop)
  overrides a `transform` attribute on the same element — the trap the heart's
  comment at `Tamagotchi.jsx:640` records. The creature group animates; the
  wrapper inside it doesn't.
- **Replaced for critters:** Clawd's body and leg `Cells`, and the overlays drawn
  for Clawd's body only — `Eyes`, `MoodFace` (brows, flush, scowl,
  skin-coloured typing hands and key clacks), `HappyEyes`, `XEyes`, `LookDown`,
  `Worried`, `ArmsUp`, `SlapHand`.
- **Kept, unchanged:** every scene prop — `Behind` / `InFront` (desk, chair,
  armchair, fireplace, scenery, seasons), occasions (jack-o'-lantern, tree,
  stockings, fireworks, confetti), duty screens, `DeskProps`, `DeskZs`,
  `AlarmClock`, `Sparkles`, `Extinguisher`, `MoodDesk` (flying keys, smoke,
  shimmer, spill), the bubble, the heart, `GhostSheet` + `Pail` (the sheet
  covers the creature whatever it is).
- **Head-anchored props** — `SantaHat`, `PartyHat`, `Stars`, `Startle`, the
  winter snowcap — are drawn at Clawd's head (top at `Y0 = 9`). For a critter
  they get an extra `translate(0, critterTop − Y0)` so they sit on its actual
  top (a sitting critter's top is ~2 units higher than Clawd's).
- **Mood:** `shownMood = moody ? mood : "calm"`, with `moody` exactly as today
  (`view.moodShown && MOODS[mood].rank > 0`) — a critter shows grumpy / furious
  in the same moments Clawd does. Celebrating, API-error and other duty poses
  show calm; the scene's own props carry them.
- **Asleep:** the existing `asleep` flag (night sleep or the walled nap, not
  ringing) closes the critter's eyes.

`Tamagotchi()` reads `getTamaCritter()` (reactive via `prefsSignal`) and passes
`critterById(...)` down. The hover label is `Claude is …` for Clawd, unchanged,
and `${critter.name} is …` for the others. Prefs load before the first render
(`main.jsx:31`), so a reload doesn't flash Clawd first.

### Motion — `styles.css`

A `.critter` block beside `.tama`, one class + `@keyframes` per SMIL animation
in the sources, in the style of `tama-blink` / `tama-bob`:

| SMIL in the source | CSS |
|---|---|
| `height`/`y` blink (eyes shrink toward their centre) | `transform: scaleY()`, origin centre |
| `height 0→3` lid (Nox, Moss) | `scaleY(0→1)`, origin top |
| `x` shift (pupils glancing) | `translateX()` |
| `translate` sway (tentacles, tail) | `translate()` |
| `y` rise (Scope's bubbles) | `translateY()` + opacity |
| `opacity` (lens glow, sparks, flicker) | `opacity` |
| `calcMode="discrete"` | `steps(n)` |
| `keyTimes` | keyframe percentages |

Lengths are in sprite units (CSS px inside SVG = user units), applied inside
the scaled wrapper, so they scale with the critter. `transform-box: fill-box`
already applies to `.tama` descendants; the preview needs it too, so the
selector covers `.critter` as well.

**Each source's outer idle bob (`data-bob`) is dropped.** The scene already
moves `.tama-creature` per activity (breathe asleep, bob while coding and
eating, stride on the run) and per mood (grumpy: 0.3 s bob; furious:
`tama-shake`), so the critter inherits Clawd's tempo; keeping both would stack
two bobs. In `coffee` and `read`, where Clawd stands still apart from blinking,
the critter does too.

Reduced motion: `.critter *` joins `.tama *` in the existing
`@media (prefers-reduced-motion: reduce)` rule, so the Settings previews stop
as well.

### Settings — `SettingsModal.jsx`

A **Tamagotchi** fieldset above the existing fields:

- a `role="radiogroup"` row of seven `<label>`s, each wrapping a real
  `<input type="radio" name="tama-critter">`, a 40 px preview (Clawd drawn by an
  exported `ClawdSprite` built from the same `Cells`/`Eyes`, the others by
  `Critter`, calm, awake) and the name;
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
  `TAMA_CRITTERS = ("clawd", "scope", "jelly", "nox", "ember", "volt", "moss")`
  → 400 otherwise, like `view`. A comment on each list points at the other.

## Tests

vitest (`static/src/chrome/__tests__/`):

- `critters.test.js` — ids unique; `critterById` falls back for unset and
  unknown ids; every sprite has `eyes` layers and calm, grumpy and furious
  layers; `spriteBox` ignores mood layers (a mood-only rect outside the body
  doesn't move it); `placement` gives height 10, bottom 19 standing and 17
  sitting, centred on `x0 + 8.5`.
- `critterRender.test.jsx` — each mood draws its own layers and none of the
  others; `asleep` drops `eyes` and `lid` layers and draws closed lines.
- `tamagotchiRender.test.jsx` — each critter renders in every activity
  (including the nap) with no Clawd body cells; the default still renders
  Clawd; hover copy uses the critter's name.
- prefs getter: default, unknown-id fallback.

pytest (`tests/routes/test_prefs.py`): `PATCH /api/prefs/ui` accepts each of
the seven ids and rejects junk with 400.

## Done when

- Picking a critter swaps it in the header immediately and survives reload.
- All seven show calm / grumpy / furious correctly, sleep with their eyes
  closed, and stop moving under reduced motion.
- A default install still shows Clawd.
- `npm run build` + `static/dist/` committed; `bin/check` clean.
