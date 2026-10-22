# Critter duty faces: design

Linear: THI-415, sub-project 1 of 3. This spec covers the faces only. Props and hats (sub-project 2) and hands and strides (sub-project 3) get their own specs later, and both build on the `anchors` this one adds.

## The gap

When a critter stands in for Clawd (`docs/superpowers/specs/2026-10-21-tamagotchi-critter-picker-design.md`), it keeps its own mood layers and shut eyes. Every duty face Clawd acts out is lost. In `TamaScene`, the `face` chain short-circuits on `sprite ? null`, and the overlays are guarded with `!sprite &&`. So on a critter:

| Situation | Clawd | Critter today |
|---|---|---|
| Done or merged, at the desk or celebrating; smiling pastimes (`smile: true`: beer, kids, dog, sled) | `HappyEyes` | calm eyes |
| API error (`pose === "api"`) | `XEyes` + `Stars` | calm eyes + `Stars` |
| Context pressure (`pose === "ctx"`) | `Worried` brows + sweat drops | calm eyes |
| Update arriving at the desk (`pose === "update"`) | `LookDown` | calm eyes |
| Bell away from the desk (`pose === "bell" && !deskBell`) | `Startle` "!" beside the head | the "!" at Clawd's right edge (`x0 + 16.6`), not the critter's |

The critter × pose grid rendered from `main` shows the gap. That render was used during design and is described under "Hand check".

## Decisions

- **Faces are generated, with optional overrides.** Each face is a glyph laid over the eye boxes the sprite already has, so every critter (and any future one) gets every face with no new art. A critter's SVG can carry its own face layer where the generated glyph doesn't fit.
- **Clawd's rules, unchanged.** Critters show a face exactly when Clawd would. Nothing new is decided about *when*; only *how* changes. Anything on duty still outranks moods. Moody coding, sleep and the Halloween ghost sheet behave as today.
- **The "!" moves to the critter's own head edge.** Today it's drawn at Clawd's right edge, which is wrong for every critter.
- **`Stars` stay as they are.** They're positioned around the head centre, which already matches the critter, because `placement` centres it on Clawd's centre and lifts the head via `Head dy`.
- **Clawd's rendering stays byte-identical.** His branches in `TamaScene` are not touched.

## Data: `build_critters.py` → `critterSprites.js`

Each sprite in `SPRITES` gains three things:

- **`anchors`**, in sprite units:
  - `eyes`: `[{x, y, w, h, role}]`, one per node `build_critters.py` already classifies as `role: "eye"` (a blink that shrinks) or `role: "lid"` (a blink that grows), using the node's first rect. Moss has one eye; the others have two.
  - `head`: `{top, right}`, from `spriteBox`'s top edge and right edge (mood layers excluded, as there).

  The block is called `anchors` so sub-projects 2 and 3 can add hand points and hat boxes to it.
- **`ink`**: the colour the generated glyphs are drawn in.
  - It defaults to the fill of the first `eye` node.
  - A critter whose eyes are **lids** must declare it with `data-ink="#rrggbb"` on its root `<svg>`, because the generator can't know the colour under the lid. Without it, the generator raises, as it already does for unsupported markup. `data-ink` on a critter with eyes overrides the default.
- **`faces`** (optional): `{happy|x|worried|down: [nodes]}`. These come from top-level `<g class="face-happy">`, `face-x`, `face-worried` and `face-down` layers in the critter's SVG, parsed like the mood layers into the same node format. Any other `face-*` class raises. A face layer is hidden in the sprite's normal tree; only the face renderer draws it.

**Art changes:**
- `nox.svg`: `data-ink="#c6e05a"` (its sclera), plus a `face-worried` layer with light-grey brows (`#8f9397`), because dark brows vanish on the black cat.
- `moss.svg`: `data-ink="#0f2e1b"` (its pupil).

No other SVG changes.

## Geometry: `faceGlyphs(sprite, face)` in `critters.js`

`faceGlyphs` is pure, with no DOM, and works in sprite units. It returns a list of shapes for one face (`{d}` paths or `{x, y, w, h}` rects, each with a `cls`) drawn in `sprite.ink`. If `sprite.faces[face]` exists, those nodes are returned instead of the generated eye shapes. The worried face's sweat drop is still generated, because it belongs to the head, not the eyes. Override layers are rects only, like the rest of the generated art.

| Face | Generated shapes, per eye box `(x, y, w, h)` |
|---|---|
| `happy` | a `^` stroke: from `(x, y + 0.75h)` up to `(x + w/2, y + 0.25h)`, down to `(x + w, y + 0.75h)`. Class `tama-happy-eyes`. |
| `x` | two strokes corner to corner, inset 0.1 |
| `down` | a rect `(x, y + 0.45h, w, 0.55h)`: the eye looking down |
| `worried` | a brow 1.1 above the box, inner end raised (the left eye rises towards the centre, the right falls away from it). Plus one sweat drop at `(head.right, head.top + 1)`, class `tama-sweat`. The eyes stay. |
| `startle` | the "!": a 1×3 bar and a 1×1 dot at `(head.right + 0.4, head.top + 0.5)`, class `tama-startle`, fill `#f2c14e`. Not a face; it's drawn alongside one. |

Stroke widths are tuned during implementation against the hand-check grid. The design mock used 0.75 sprite units, about Clawd's 0.45 at the critter's scale.

## Rendering

**`Critter.jsx`** gains two props, `face` (`null | "happy" | "x" | "down" | "worried"`) and `startle` (bool):
- **`happy`, `x` and `down`:** eye nodes and glints are skipped, and lids are drawn as their `shut` frame. That's the asleep mechanism, so the lid covers the sclera and pupil beneath it. The face shapes are then drawn on top.
- **`worried`:** the eyes stay, and the brows and sweat drop are drawn on top.
- **`startle`:** the "!" is drawn.

Everything is drawn inside the critter's own group, so it scales with `placement` and bobs with `.tama-creature` without new transform maths. Mood layers render as today; with a face, the mood is calm, so the critter's calm mouth stays.

**`TamaScene`** computes `critterFace` from the same inputs as Clawd's `face` chain:
- `null` when the scene is `ghost` or `moody`, or the critter is `asleep`;
- `"happy"` when `celebrating`, or when there's no pose and `p?.smile`;
- `"x"` when `pose === "api"`;
- `"down"` when `pose === "update"`;
- `"worried"` when `pose === "ctx"`;
- otherwise `null`.

It passes `critterFace` and `startle = pose === "bell" && !deskBell` to `<Critter>`, and drops the critter path of the scene-level `<Startle>`. `Startle` and `Worried` remain scene-level for Clawd only.

**`TamaPicker`** passes no face, so the Settings previews stay calm.

## Tests

- **`tests/test_build_critters.py`:**
  - `anchors.eyes` matches the detected eye and lid nodes for a two-eyed critter and for Moss's single lid;
  - `anchors.head` matches the sprite box;
  - `ink` defaults to the eye fill, is taken from `data-ink`, and a lid critter without `data-ink` raises;
  - `face-*` layers are parsed into `faces` and kept out of the normal tree;
  - an unknown `face-` class raises.
- **vitest `critters`:**
  - `faceGlyphs` returns shapes inside each eye box for every face on a two-eyed critter;
  - one glyph for Moss;
  - an override replaces the generated shapes;
  - `startle` sits at `head.right`.
- **vitest `critterRender`:**
  - with `happy`, `x` or `down`, no eye or glint node renders and lids render shut;
  - `worried` keeps the eyes;
  - the glyph classes are present;
  - no face renders the sprite exactly as today.
- **vitest `tamagotchiRender`:**
  - each critter × {done at the desk, merged, api, ctx, update, bell away, a smiling pastime, moody, asleep} gets the right `critterFace` and `startle`;
  - **Clawd's 6,528-combination render matrix stays byte-identical.**

## Hand check

Re-render the critter × pose grid (`TamaScene` from source via `vite-node`, as during design). Every critter must differ from calm in the done, merged, API-error and context columns. The bell-away "!" must sit at each critter's head. Check Nox's worried brows in particular.

## Out of scope (THI-415, sub-projects 2 and 3)

- **Sub-project 2:** hats sized and placed per critter, the dropped worn props (goggles, scarf), and held props at the critter's side.
- **Sub-project 3:** the typing hands, `ArmsUp` and `SlapHand`, the stride legs, and Clawd's furious flush and scowl over a critter's furious layer.
