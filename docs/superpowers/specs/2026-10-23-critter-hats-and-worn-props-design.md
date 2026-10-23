# Critter hats and worn props: design

THI-415 part 2a. Part 1 gave the critters duty faces (`2026-10-22-critter-duty-faces-design.md`). Part 2b will give them held props, with a tailored holding pose per critter per prop, starting with the pint.

## The gap

Clawd's hats and worn props are drawn at fixed offsets from Clawd's own body:
- **Hats** (`SantaHat`, `PartyHat`, the pastime `Headwear`: `Toque` and `Helmet`) and the winter **snowcap** assume a 12-wide head whose top is at `x0+3…x0+15`, `Y0 = 9`.
- The **goggles** (swim) sit on Clawd's two eyes, and the **scarf** (sled) on his neck row (`Y0+4`).

On a critter:
- the hats keep Clawd's width and position, only lifted by `Head dy`;
- the goggles and the scarf are dropped entirely (`WORN_ON_CLAWD`).

## Decisions

- **Each critter declares two anchors in its SVG**, as Nox and Moss already declare `data-ink`:
  - `data-hat="cx top w"`: where a hat sits, as the centre x, the head's top y and the hat's width;
  - `data-neck="y x0 x1"`: the neck row, from `x0` to `x1`.

  These can't be derived from the drawing. Scope's periscope and Volt's antenna rise above the head; Nox, Ember and Octocat have ears or horns; Jelly is a dome and Moss is spiky.
- **Hats reuse Clawd's drawings.** Inside the critter's own group, in sprite units, a transform maps Clawd's head onto the critter's hat seat. Clawd's head is top-centre `(9, 9)` with `x0 = 0`, 12 wide. The transform is `translate(cx top) scale(w/12) translate(−9 −9)`. The hat therefore sizes to the critter's head and bobs with it. This covers Santa, the party hat, the toque, the helmet and the snowcap, with the same rules for when each shows as for Clawd.
- **The goggles and the scarf come back, generated** like the duty faces:
  - **Goggles:** a tinted lens around each eye box (Moss gets one) and a strap across the eyes.
  - **Scarf:** a striped band along the neck row, with its animated tail (`tama-scarf-tail`).
  - Both use Clawd's colours and classes.
- **Clawd is untouched.** His hat, goggle and scarf code stays as it is. The critter path is a separate branch, and the Clawd hash pin and the face parity test guard that.
- **Not in scope:** held props (pint, bass, controller, watering can, spoon), which are part 2b, and hands and strides, which are part 3.

## Changes

| File | Change |
|---|---|
| `build_critters.py` | Parse `data-hat` (3 numbers, `w > 0`) and `data-neck` (3 numbers, `x0 < x1`) into `anchors.hat = {cx, top, w}` and `anchors.neck = {y, x0, x1}`. A malformed value raises. `render()` raises if any shipped critter lacks either attribute. `convert()` doesn't require them, so the synthetic test SVGs stay minimal. |
| `docs/specs/assets/critters/*.svg` | `data-hat` and `data-neck` on all 7 critters (starting values below, tuned in the hand check). |
| `static/src/chrome/critters.js` | `hatTransform(sprite)`, and `wornGlyphs(sprite, "goggles" \| "scarf")`, which returns sprite-tree nodes like `faceGlyphs`. |
| `static/src/chrome/Critter.jsx` | A `worn` prop (`null`, `"goggles"` or `"scarf"`), drawn after the face, with `data-worn` on the critter's group. |
| `static/src/chrome/Tamagotchi.jsx` | For a critter, the hats and the snowcap are drawn inside the critter's wrapper, under `hatTransform`, and not at scene level. `Critter` gets `worn` from the pastime's held prop (`Goggles` → `"goggles"`, `Scarf` → `"scarf"`). Clawd's branches are guarded with `!sprite`, so his markup is unchanged. |

**Starting anchors** (sprite units), from each critter's drawn rows:

| Critter | `data-hat` (cx top w) | `data-neck` (y x0 x1) |
|---|---|---|
| scope | 10 6 12 | 13 3 17 |
| jelly | 10 3 8 | 10.5 4 16 |
| nox | 10 5 9 | 12 6 14 |
| ember | 10 5 10 | 12.6 4 16 |
| volt | 10 6 10 | 12.4 3 17 |
| moss | 10 4 7 | 12.4 5 15 |
| octocat | 10 4 12 | 11.6 4 16 |

**Worn geometry** (sprite units, eye boxes from `anchors.eyes`):
- **Goggles:**
  - strap: `y = mean eye centre − 0.4`, height 0.8, from `min x − 2` to `max x + w + 2`, fill `#2b2f36`;
  - per eye, a lens `(x − 0.6, y − 0.6, w + 1.2, h + 1.2)`, `rx 1`, fill `#7fd1e6` at opacity 0.45, stroke `#2b2f36` 0.5;
  - group class `tama-goggles`.
- **Scarf:**
  - band `(x0, y, x1 − x0, 1.6)`, fill `#d64541`;
  - white stripes `#f4f4f6`, 0.7 wide, every 3 units from `x0 + 2`;
  - tail `(x0 − 3, y + 0.3, 3.6, 1.1)`, class `tama-scarf-tail`;
  - group class `tama-scarf`.

**The hat wrapper** carries `style="transform-box: view-box"`, like the critter's own wrapper, because styles.css pivots `.tama g` on its fill-box.

## Tests

- **`tests/test_build_critters.py`:**
  - `data-hat` and `data-neck` parse into the anchors;
  - malformed values raise (wrong count, non-numbers, `w ≤ 0`, `x0 ≥ x1`);
  - every shipped critter declares both (`render()` raises otherwise).
- **`critters.test.js`:**
  - `hatTransform` maps Clawd's head top-centre onto the seat at the right width;
  - the goggles' lenses contain each eye box, and the strap spans them;
  - the scarf sits on the neck row and spans it;
  - an unknown kind returns `[]`.
- **`critterRender.test.jsx`:** `worn` draws the goggles or the scarf with `data-worn`. Without it, the exact-markup pin holds.
- **`tamagotchiRender.test.jsx`:**
  - a critter's Santa or party hat, toque, helmet and snowcap are drawn inside its wrapper under `hatTransform`, and not at scene level;
  - swim draws the critter's goggles and sled its scarf, and never Clawd's;
  - Clawd's scenes are unchanged (hash pin, parity test, the existing Clawd tests).

## Hand check

Render every critter with each hat (the yearend Santa, the party hat, cook's toque, the bike helmet, the winter snowcap on the run), plus swim (goggles) and sled (scarf). Check that:
- each hat sits on the head, sized to it, clear of ears and horns where possible (an antenna poking through a hat is fine);
- the goggles sit on the eyes;
- the scarf sits on the neck.

Tune the anchors in the SVGs and regenerate.
