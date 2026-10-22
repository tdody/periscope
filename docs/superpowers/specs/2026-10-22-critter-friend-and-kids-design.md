# A critter's friend and kids: design

A follow-up to the critter duty faces (`2026-10-22-critter-duty-faces-design.md`, THI-415 part 1).

## The gap

Two pastime scenes draw Clawd-shaped figures beside the mascot. When a critter is picked, both stay Clawd-shaped, so Nox has a beer with a blue Clawd and plays with two little orange Clawds:

- **beer** (`PASTIME_SCENES.beer.Behind = Friend`): a friend facing the mascot. It's Clawd mirrored, in blue (`FRIEND = "#6f93d6"`), with happy `^ ^` eyes and its own pint, at `FRIEND_X0 = 18`.
- **kids** (`PASTIME_SCENES.kids.Behind = Kids`): two half-size Clawds, in Clawd's own colour, hopping (`.tama-kid`) at x 17.4 and 25.4. On a Halloween evening they wear little sheets (`KidSheet`).

## Decisions

- **The friend matches the mascot.** It's the picked critter, mirrored to face the mascot, with its colours hue-shifted so it reads as another individual of the same kind. That's what Clawd's blue friend already is. It wears the duty faces' `happy` face, and keeps the pint, the string lights and the "cheers" sparkle.
- **The kids match the mascot.** They're two half-size copies of the critter, in its own colours and with its calm face, at the kids' spots, feet on the floor line, still hopping. On Halloween the sheets still go over them.
- **The hue shift is computed, not filtered.** It's a pure `hueRotate(hex, deg)` applied to every fill and stroke, including the face glyphs' ink, through a `tint` prop on `Critter`. CSS `filter` on SVG child elements is unreliable in WebKit, which is the Periscope app's webview.
- **Clawd's scenes stay byte-identical.** His friend and kids are drawn exactly as before. The Clawd hash pin and the critter-faces parity test prove it.
- **No other pastime changes.** The dog is a dog.

## Changes

| File | Change |
|---|---|
| `static/src/chrome/critters.js` | `hueRotate(color, deg)`: HSL rotation of a `#rrggbb` colour, with anything else (`none`, `var(…)`) passed through and greys unchanged. `placement` gains an optional `height` (default `CLAWD_HEIGHT`). |
| `static/src/chrome/Critter.jsx` | A `tint` prop: every node's `fill` and `stroke` goes through `hueRotate(…, tint)`. Without it, the output is unchanged. |
| `static/src/chrome/TamaPastimes.jsx` | `Friend({ critter })` and `Kids({ trick, critter })` draw the critter versions when `critter.sprite` is set. `FRIEND_HUE` is exported. |
| `static/src/chrome/Tamagotchi.jsx` | `PastimeBehind` passes `critter` through to `p.Behind`. |

**Friend geometry.** `placement(sprite, { x0: FRIEND_X0, sitting: false })` gives a scale `s` and an offset `tx, ty`. To mirror the critter about its centre `cx = FRIEND_X0 + 8.5`, the wrapper's transform is `translate(2·cx − tx, ty) scale(−s, s)`. The wrapper also carries `class="tama-critter"` and `style="transform-box: view-box"`, like the mascot's own wrapper, for the same reason: styles.css pivots `.tama g` on its fill-box. `FRIEND_HUE = 150`, tuned in the hand check.

**Kid geometry.** A kid is 8.5 wide (Clawd's 17 at half scale), so its centre is `x + 4.25`. That gives `placement(sprite, { x0: x − 4.25, sitting: false, height: CLAWD_HEIGHT / 2 })`: 5 tall, feet at 19.

## Tests

- **`critters.test.js`:**
  - `hueRotate`: red → green at 120°; 0° and 360° unchanged; grey unchanged; non-hex passed through; always lower-case `#rrggbb`.
  - `placement` with `height`: the scaled box is that tall, with its feet on the floor.
- **`critterRender.test.jsx`:** with `tint`, fills and strokes are rotated, including a face glyph's ink. Without it, the existing exact-markup pin holds.
- **`tamagotchiRender.test.jsx`:**
  - Beer with a critter: two critters drawn. The friend's is mirrored (`scale(-`), wears `data-face="happy"` and has rotated fills; no blue Clawd body is drawn.
  - Kids with a critter: three critters, the two kids at half the mascot's scale.
  - Halloween kids with a critter: two sheets still drawn.
  - Clawd's beer and kids are unchanged, through the existing tests, the hash pin and the parity test.

## Hand check

Render the beer and kids scenes for every critter (and Clawd), and check:
- the friend faces the mascot, reads as the same kind in other colours, smiles, and holds its pint;
- the kids are small copies standing on the floor and hop;
- Halloween sheets cover them.

Tune `FRIEND_HUE` if a critter's friend reads poorly.
