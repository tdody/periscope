# Furious critters flush red: design (THI-421)

The one item left over from THI-415. The draft was reviewed on the live furious-at-the-desk scene, and the user chose **option C with teeth**.

## The gap

When the coding mood is furious, Clawd's `MoodFace` (`Tamagotchi.jsx`) adds two things:
- a red flush over his body (`tama-flush`, `#ff3b2f`, pulsing at 0.35–0.6 opacity);
- a zig-zag scowl.

A critter shows only its own `mood-furious` layer: angled brows, an open shouting mouth and sparks. Furious reads weaker on it than on Clawd.

## Decisions

- **The flush.** A furious critter (`Critter` with `mood === "furious"`) gets Clawd's flush over its silhouette:
  - The silhouette is every always-drawn node it's showing, under the same rules as its own drawing, so the legs it hides seated, a resting tail it reaches with, and side arms on a prop don't appear as red ghosts.
  - Mood layers are left out.
  - Animated parts keep their motion: the wash keeps each node's `anim` class.
  - **Outlines are covered too.** A node drawn with a stroke (Nox's and Octocat's outline copies) keeps its stroke width in the wash, recoloured to the flush. Without this, the grey outline stays grey around a red body, which is what the user caught in the first draft.
  - **The limb it reaches with is washed too** (typing at the keys), so the whole critter flushes. The wash is drawn after it.
  - The colour is `#ff3b2f` in a `tama-flush` group, using styles.css's existing pulse.
- **The face over the wash.** The critter's eyes and its own furious layer are drawn again on top, so they stay crisp while the body goes red. That means its top-level `role` nodes (and nodes containing one) plus its top-level furious layer. Nox's pupils sit in a role-less group, so they take the tint, as in the approved draft.
- **The teeth.** Clawd's scowl becomes gritted teeth inside the critter's own furious mouth:
  - the mouth is the widest rect in its furious layer (at least 2.4 wide and 1.2 tall);
  - the teeth are a four-stroke zig-zag across it, `#f3f5f8`, stroke 0.35;
  - a critter with no such mouth gets no teeth (all seven have one today).
- **Clawd is untouched,** guarded by the hash pin. Only the coding scene shows moods, so the flush appears only when furious at the desk.
- **The first draft's defects are fixed.** That draft washed a static list of every rect, so it left Nox's and Octocat's outlines grey, drew the hidden resting tails and seated legs as red ghosts, and drifted off Jelly's swaying tentacles. Drawing the wash through the critter's own visibility rules, with its animation and strokes, fixes all three. The fixed row was re-rendered and checked.

## Code

**`critters.js`:**
- `FLUSH = "#ff3b2f"`.
- `teethGlyph(sprite)` returns `[{ p, a }]` for the zig-zag in the furious mouth, or `[]`.

**`Critter.jsx`:**
- **`Node`'s `flush` mode:** mood layers are skipped; rects and groups are drawn without their own fill (the wrapper's fill applies), with rects 0.02 larger to close seams; a node with a stroke keeps it, recoloured to `FLUSH` at its own width; the `anim` classes are kept; every visibility rule (`rest`, `paws`, `seated`, `hide`) applies as usual.
- **When `mood === "furious"` and the critter is awake,** after everything else (root, limb, cheer), it draws, in order:
  - `<g class="tama-flush" fill={FLUSH}>` with the root and the limb glyphs in flush mode;
  - the face nodes again;
  - `teethGlyph`.

## Tests

**`critters.test.js`:**
- `teethGlyph` lies inside each critter's furious mouth.
- A critter without a furious mouth gets `[]`.

**`critterRender.test.jsx`:**
- **Furious:**
  - the flush group exists;
  - its rects carry no paint of their own;
  - mood layers are absent from it;
  - hidden nodes are absent from it (a synthetic sprite with `rest`/`legs` plus `tip`/`seated`);
  - a stroked node keeps its stroke in it, recoloured: Nox's outline is `stroke="#ff3b2f" stroke-width="1"`;
  - the limb, when it reaches, is inside it;
  - the anim classes are kept;
  - the face nodes are redrawn after it;
  - the teeth come last, before the limb.
- **Calm and grumpy:** no flush and no teeth.
- **The exact-markup pin** holds.

**`tamagotchiRender.test.jsx`, for every critter:**
- **Furious at the desk:** the mascot's critter group contains a `tama-flush` group and a teeth path.
- **Grumpy and calm:** neither.
- **Nox typing while furious:** its resting tail is absent from the flush.
- **Scope seated:** its feet are absent from the flush.
- **Clawd's hash pin** is unchanged.

## Hand check

Re-render the furious row (desk) for all critters from the branch, and compare it with the approved draft's row C with teeth.
