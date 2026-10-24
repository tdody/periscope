# Critters hold things, batch 2: the bass and the controller

THI-415 part 2b, batch 2. Batch 1 (`2026-10-23-critter-held-props-batch1-design.md`) taught the critters to hold the pint, mug, spoon, can and leash. This batch does the two props Clawd holds with both hands, the bass and the game controller. The draft was reviewed on the live scenes and approved as drawn.

## The gap

Clawd's `Bass` and `Controller` (`TamaPastimes.jsx`) carry his hands as skin-coloured (`SKIN`) rects:
- **On the bass:** a fretting hand on the neck at `(x0 + 17.5, 11.1)` and a strumming hand (`tama-strum`) on the pickguard.
- **On the controller:** a tapping thumb (`tama-thumb`).

A critter at the bass or the console gets Clawd's orange hands floating on its prop.

## Decisions

**The bass.**
- **Fretting:** the critter's own limb (batch 1's `sprite.limb`) reaches from its root to Clawd's fret spot on the neck, `(x0 + 18, 11.7)` in scene units. Nox and Ember fret with the tail, so the resting tail goes.
- **Strumming:** a hand, paw or tentacle tip on the pickguard, where Clawd strums, keeping `tama-strum`.
- **Drawing order:** the bass sits in front of the critter's body, and the fretting limb in front of the bass.

**The controller.**
- Two hands, paws or tips sit on the grips. The right one taps (`tama-thumb`).
- No limb reaches out, so Nox's and Ember's tails stay resting.

**The hands are Clawd's kind of hands:** small rects on the prop, in the limb's colour.
- A tentacle's are round (`rx` = half its height).
- A limb with an outline (Nox) gets the outline, so a black paw shows on the dark controller.
- No second limb is declared. Batch 1's one-limb schema is enough.

**Kept as drawn** (flagged at review, left for later):
- Scope's blue strumming hand is low-contrast on the blue bass.
- Nox's and Ember's tails run along the floor to reach the neck.
- Octocat's dark tentacle on the dark neck.

**Clawd is untouched,** guarded by the hash pin.

## Side arms on the controller (the user's call, after the draft)

In the video-game scene, Clawd, Ember, Volt and Moss lose the arms on the sides of their bodies, since their hands are on the controller.
- **Clawd:** his game body is drawn armless: `BODY`'s row 2 without its end cells (`PAWS_BODY_CELLS`, selected by `PASTIME_SCENES.game.paws`). His controller gets two hands on the grips in his skin colour (`CLAWD_HANDS`), in place of the lone thumb.
- **The hash pin** changed on purpose, for exactly the 192 game-scene combinations and nothing else. A per-combination diff against main confirmed it.
- **Critters:** their side arms are marked `<g class="hold-arms">` in the SVG and emitted as `arms: true`. `Critter` hides them for a hold in paws (a `holding` with no limb reach).
- **The "!":** `startleGlyph` follows the limb's reach, not `holding`, so paws on the controller leave the "!" on the right.

## Code

**`critters.js`:**
- `limbGlyphs(sprite, prop, tip = holdTip(sprite, prop))` can reach any tip. The default keeps batch 1's calls.
- `sceneToSprite(place, [X, Y])` turns a scene point into the wrapper's sprite units. It's the inverse of `placement`, and is how the fret spot on Clawd's neck becomes a tip.

**`Critter.jsx`:**
- **`tip`:** where its limb reaches, in sprite units. It defaults to `holdTip(sprite, holding)` for a batch-1 prop, and to none for a prop not in `HOLDS` (the controller). The limb is drawn, and the resting tail hidden, only when there's a tip. So the controller draws no limb and keeps the tail.
- **`children`:** drawn over the critter and under its limb. That's the bass, so the limb frets in front of it.

**`TamaPastimes.jsx`:**
- `Paw({ limb, x, y, w, h, cls })` draws one hand, paw or tip.
- `BASS_FRET = { dx: 18, y: 11.7 }` is the fret spot.
- `Bass({ x0, limb })` and `Controller({ x0, limb })`: with a `limb` they draw paws in its colour in place of Clawd's skin hands. Without one, their markup is unchanged.

**`Tamagotchi.jsx`:**
- `HOLDING` gains `music: "bass"` and `game: "controller"`. This drops Clawd's `p.Held` for those critters.
- **The bass** goes inside the critter's wrapper, as `Critter`'s child: a group that maps scene units back to sprite units (`scale(1/s) translate(-tx -ty)`, view-box pivot). The fret tip is `sceneToSprite(place, [x0 + BASS_FRET.dx, BASS_FRET.y])`.
- **The controller** is drawn after the wrapper, in front of the critter, with the critter's `limb`.

## Tests

**`critters.test.js`:**
- `limbGlyphs` reaches an explicit tip.
- `sceneToSprite` inverts `placement`.

**`critterRender.test.jsx`:**
- `tip` overrides the reach.
- A `holding` prop with no tip draws no limb and keeps the resting tail.
- `children` render after the body and before the limb.

**`tamagotchiRender.test.jsx`, for every critter:**
- **Music:**
  - `data-holding="bass"`;
  - no skin-coloured hand inside `tama-bass`;
  - one `tama-strum` paw in the limb colour inside it;
  - the bass inside the critter's wrapper, before the limb;
  - the limb's tip at the drawn placement's fret spot;
  - the resting tail gone for Nox and Ember.
- **Game:**
  - `data-holding="controller"`;
  - no skin thumb;
  - two paws inside `tama-controller`, one `tama-thumb`;
  - the controller after the wrapper;
  - Nox's resting tail kept.
- Clawd's hash pin is unchanged. Music and game are in its matrix.

## Hand check

Re-render the music and game rows, and the full grid, from the branch. They must match the approved draft.
