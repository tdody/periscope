# Critters' hands at the desk: design

THI-415 part 3, hands. The strides and the legs hidden when sitting come later. The draft was reviewed on the live scenes and approved as drawn: two hands for typing, the raised side arms at the drafted height, and Octocat's dark tentacle kept.

## The gap

Three things Clawd does with his hands at the desk are drawn only for Clawd (`!sprite` in `TamaScene`):
- **Typing** when grumpy or furious: `MoodFace`'s two `SKIN` hands, `tama-hand` and `tama-hand2`, on the keyboard at (20.7, 11.9) and (22.7, 11.9).
- **Arms up** when celebrating at the desk (done, merged): `ArmsUp`, a raised bar on each side.
- **Slapping the service bell** when the bell is on duty at the desk or wakes him from the walled nap: `SlapHand`, a hand over the bell's button at (21.6, 8.7) that slaps down (`tama-slap`).

A critter does none of these. It only shows its own mood layer, its happy face, or nothing.

## Decisions

The desk is fixed in the scene, so these reaches go to fixed scene points, mapped into the critter's sprite units through the placement its wrapper is drawn with (`sceneToSprite`), as with the bass's fret.

- **Typing** (moody at the desk):
  - The critter's limb reaches the keyboard at Clawd's first hand, `KEYS_REACH = [21.25, 12.3]`.
  - Two paws in scene units sit on Clawd's two hand spots, tapping in turn (`tama-hand`, `tama-hand2`; faster when furious, through the existing CSS).
  - Nox and Ember type with the tail, so their resting tail goes.
- **The bell** (the bell on duty at the desk, or in the walled nap):
  - The limb reaches over the button, `BELL_REACH = [22.2, 9.6]`.
  - A paw on Clawd's slap-hand spot slaps (`tama-slap`).
- **Arms up** (celebrating at the desk):
  - **With side arms (`hold-arms`, so Ember, Volt and Moss):** each arm rect gets a raised bar above it, 4 sprite units tall, in the arm's colour, bouncing like Clawd's (`tama-cheer`, `tama-cheer2`).
  - **Without (Scope, Jelly, Nox, Octocat):** the limb waves up beside the head, to `[root.x + 1.6, box.y + 0.12·box.h]`, inside a `tama-cheer` group. Nox's resting tail goes.
- **The paws are batch 2's `Paw`**: the limb's colour, round for a tentacle, outlined where the limb is.
- **Clawd is untouched**, guarded by the hash pin.

## Code

**`critters.js`:**
- **`cheerGlyphs(sprite)`:** the raised bars for a sprite's `arms` rects, nested ones included and each in its own fill. With no `arms`, it's the raised limb in a `tama-cheer` group.
- **`cheersWithLimb(sprite)`:** true when there are no `arms`, so the limb is used and a resting tail goes.

**`Critter.jsx`:**
- A `cheer` prop draws `cheerGlyphs`.
- A resting tail goes when the limb reaches (`tip` or a hold) or cheers with the limb.

**`TamaPastimes.jsx`:** export `Paw`.

**`TamaDuty.jsx`:**
- **`KEYS_REACH`, `BELL_REACH`:** the scene points above.
- **`TypingPaws({ limb })`:** the two tapping paws.
- **`SlapPaw({ limb })`:** the slapping paw.
- `SlapHand` and `MoodFace` stay Clawd's, unchanged.

**`Tamagotchi.jsx` (`TamaScene`):**
- `deskTip` is `KEYS_REACH` when moody and `BELL_REACH` when `deskBell`. The critter's `tip` is `fret ?? (deskTip && sceneToSprite(place, deskTip))`.
- `<Critter cheer={atDesk && celebrating}>`.
- In front of the wrapper, inside `.tama-creature`, the critter gets `<TypingPaws>` when moody and `<SlapPaw>` when `deskBell`.
- The comment that lists Clawd-only hands is updated: only Clawd's own drawings of them stay his.

## Tests

**`critters.test.js`:**
- `cheerGlyphs` gives one bar per `arms` rect, 4 tall, above it, in its fill, for ember, volt and moss.
- For the rest it gives a `tama-cheer` limb reaching above the head.
- `cheersWithLimb` matches.

**`critterRender.test.jsx`:**
- `cheer` draws the glyphs.
- Nox's resting tail goes when it cheers; Ember's stays.

**`tamagotchiRender.test.jsx`, for every critter:**
- **Grumpy and furious at the desk:** the limb's tip is at `KEYS_REACH` through the drawn placement, and there are two paws in the limb's colour with `tama-hand` and `tama-hand tama-hand2`, inside `.tama-creature`.
- **The bell at the desk and in the nap:** the limb's tip is at `BELL_REACH`, with one `tama-slap` paw.
- **Done and merged:** `cheer` glyphs are drawn.
- Clawd's `MoodFace` hands, `ArmsUp` and `SlapHand` never appear for a critter.
- Clawd's hash pin is unchanged.

## Hand check

Re-render the desk rows (grumpy, furious, done, merged, the bell, the nap bell) and the full grid from the branch. They must match the approved draft.
