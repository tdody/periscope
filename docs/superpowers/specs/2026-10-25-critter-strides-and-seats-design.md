# Critters' strides and legs when sitting: design

THI-415 part 3, the motion half; the hands shipped in `2026-10-24-critter-hands-design.md`. The draft was reviewed on the live scenes and approved as drawn:
- the stride step is two units;
- Jelly's and Octocat's tentacles step too;
- legs-when-sitting is folded into the same batch.

## The gap

- **Strides.** On the run, the bike and the dog walk (`stride: true` in `PASTIME_SCENES`), Clawd's legs alternate between two frames on the scene's tempo:
  - `tama-legs-a` is his stance;
  - `tama-legs-b` is every leg one step inward (`tamagotchi.js` `LEGS`);
  - CSS swaps them under `[data-stride]`.

  A critter only bobs.
- **Legs when sitting.** Clawd's legs aren't drawn when he sits: at the desk, in the reading chair, on the couch, on the sled, in the pool, in the nap (`!sprite && !sitting`). His body ends on the seat. A critter is placed with its feet on the seat, so it keeps its legs.

## Decisions

- **Strides.** In a striding scene, a critter's legs draw twice:
  - as they are, in `tama-legs-a`;
  - every leg rect two sprite units toward the body's middle (the sprite box's centre x), in `tama-legs-b`.

  The existing CSS swaps them on Clawd's beat. This covers all seven critters: Scope, Nox, Ember, Volt and Moss step their feet; Jelly and Octocat step their tentacles, which keep their own sway. The rule is every rect, not every leg: Jelly's middle tentacle has three of its own, and frame B steps it onto its left tentacle.
- **Legs when sitting.**
  - **Hidden:** Scope's, Ember's, Volt's and Moss's feet, and Octocat's tentacle-legs.
  - **Kept:** Nox's toes (drawn on its body, a sitting cat's front paws) and Jelly's tentacles (not legs: without them it's a dome).
  - **Placement:** a seated critter is lowered so its body without the hidden legs sits on the seat (`SEAT`, 17), at the same scale as standing. Its body ends on the seat, as Clawd's does. Everything that follows `placement()` follows: the hats, the "!", the desk reaches and the held props — except the controller (`game`), which Clawd draws at his own fixed spot regardless of `placement()`. A seated critter with hidden legs sits lower than Clawd there too, so the controller is lowered with the body (`placement()`'s `drop`) instead, capped at the seat (0.8) so it never follows the body past it.
- **Clawd is untouched,** guarded by the hash pin.

## Data: the SVGs and `build_critters.py`

- **`<g class="legs">`:** legs that stride, and that hide when the critter sits. Emitted as `legs: true`.
- **`<g class="legs-kept">`:** legs that stride but stay when it sits. Emitted as `legs: true, keepSeated: true`.
- Both are handled like `hold-arms`:
  - the mood skip;
  - rejected on a `<rect>`;
  - rejected inside a face layer.
- **Markers per critter:**
  - **scope:** its two foot rects at (5,16) and (13,16), wrapped in `<g class="legs">`;
  - **jelly:** its swaying tentacle group (`animateTransform` `0 0;0.6 0;0 0;-0.6 0`, 1.4s) gets `legs-kept`;
  - **nox:** its toes group `<g fill="#3a3f46">` gets `legs-kept`;
  - **ember:** its feet group (`<g fill="#b8403a">` with (6,16) and (12,16)) gets `legs`;
  - **volt:** its feet group (`<g fill="#d1a92b">` with (5,15) and (12,15)) gets `legs`;
  - **moss:** its feet group (`<g fill="#2e9a56">` with (6,16) and (12,16)) gets `legs`;
  - **octocat:** its swaying legs group (`animateTransform` `0 0;0.4 0;0 0;-0.4 0`, 1.6s) gets `legs`.
- **`critters.css` must not change.**

## Code

**`critters.js`:**
- **`spriteBox(sprite, { seated })`:** with `seated`, it leaves out the legs a seated critter hides.
- **`placement`:** when sitting, its bottom is the seated box's bottom on `SEAT`, at the full box's scale; `top` is `ty + scale·box.y`.
- **`strideRoot(sprite)`:** the root with each `legs` node replaced by its two frames, `{ g: [n], cls: "tama-legs-a" }` and `{ g: [stepIn(n)], cls: "tama-legs-b" }`, two units toward the middle.

**`Critter.jsx`:**
- **`seated`:** hides `legs` nodes that aren't `keepSeated`. It's threaded through `Node` like `rest` and `paws`.
- **`stride`:** draws `strideRoot(sprite)` in place of `sprite.root`.

**`Tamagotchi.jsx`:** the mascot's `Critter` gets `seated={sitting}` and `stride={!!p?.stride}`. Its own controller (`game`) is wrapped in a `translate(0 min(place.drop, 0.8))`, so it lowers with a seated critter's body instead of covering its face.

## Tests

- **Generator:**
  - the new classes, their rejections, and their flags;
  - every shipped critter has exactly one `legs` group, with `keepSeated` for Jelly and Nox only.
- **`critters.test.js`:**
  - `strideRoot`'s frame B shifts every leg rect two units toward the middle, and frame A is the node unchanged;
  - seated placement puts the seated box's bottom at 17, at standing's scale. For Nox and Jelly that's the feet, unchanged.
- **`critterRender.test.jsx`:**
  - `seated` hides `legs` but not `legs-kept`, nested included;
  - `stride` draws `tama-legs-a` and `tama-legs-b`;
  - the exact-markup pin holds.
- **`tamagotchiRender.test.jsx`, for every critter:**
  - the run, the bike and the dog walk draw both frames inside the wrapper, and calm scenes draw no `tama-legs-b`;
  - in the seated scenes, Scope's, Ember's, Volt's, Moss's and Octocat's legs are gone, while Nox's toes and Jelly's tentacles stay;
  - the wrapper is lowered: the seated box's bottom lands on 17;
  - in `game`, the controller's drawn box never overlaps a calm-mood or eye rect, mapped to scene units through the placement actually drawn; the controller's own lowering is asserted as `min(drop, 0.8)`.
- **Clawd's hash pin is unchanged.**

## Hand check

Re-render the stride and seated rows, and the full grid, from the branch. They must match the approved draft.
