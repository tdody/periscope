// One critter (critters.js), drawn from its generated sprite tree in its own
// 20×20 units. Motion is the classes in static/critters.css; the caller places
// and scales it (Tamagotchi.jsx in the header, TamaPicker.jsx in Settings).

import { cheerGlyphs, cheersWithLimb, EYE_FACES, faceGlyphs, HOLDS, holdTip, hueRotate, limbGlyphs, startleGlyph, strideRoot, wornGlyphs } from "./critters.js";

// A friend's colours (TamaPastimes.jsx): every fill and stroke turned by
// `tint` degrees. No tint draws the critter's own paint, untouched.
function painted(a, tint) {
  if (!tint || !a) return a;
  const out = { ...a };
  if (a.fill) out.fill = hueRotate(a.fill, tint);
  if (a.stroke) out.stroke = hueRotate(a.stroke, tint);
  return out;
}

// A mood layer shows only in its mood. Asleep, an eye or a lid is drawn as its
// `shut` frame, held, and the glint riding on a blinking eye goes away. Under a
// face (`hide`), the face's glyph replaces the eye: the eye and its glint go,
// and a lid shuts over the eye it covers. `p`/`cls` are the face glyphs'
// fields (faceGlyphs/startleGlyph/wornGlyphs/cheerGlyphs): an SVG path's `d`
// and a CSS class. `cls` alone also marks strideRoot's two frame wrappers
// (tama-legs-a/-b): styles.css swaps them, so neither is ever animated either.
function Node({ n, mood, asleep, hide, tint, rest, paws, seated }) {
  if (n.mood && n.mood !== mood) return null;
  if (rest && n.rest) return null;
  if (paws && n.arms) return null;
  if (seated && n.legs && !n.keepSeated) return null;
  if ((asleep || hide) && n.role === "glint") return null;
  if (hide && n.role === "eye") return null;
  if (n.r) {
    const [x, y, w, h] = n.r;
    return <rect class={n.cls} x={x} y={y} width={w} height={h} {...painted(n.a, tint)} />;
  }
  if (n.p) return <path class={n.cls} d={n.p} {...painted(n.a, tint)} />;
  if ((asleep || hide) && n.shut) {
    const [x, y, w, h] = n.shut;
    return <rect data-role="shut" x={x} y={y} width={w} height={h} {...painted(n.g[0].a, tint)} />;
  }
  // n.anim and n.cls never both land here: `cls` marks a face glyph (static
  // art, critters.js) or one of strideRoot's frame wrappers — neither is
  // ever animated.
  return (
    <g class={n.anim || n.cls} data-mood={n.mood} data-role={n.role} {...painted(n.a, tint)}>
      {n.g.map((c, i) => <Node key={i} n={c} mood={mood} asleep={asleep} hide={hide} tint={tint} rest={rest} paws={paws} seated={seated} />)}
    </g>
  );
}

// `face` is one of the duty faces (critters.js faceGlyphs) and `startle` the
// bell's "!": both drawn inside the critter's own group, so they scale and bob
// with it. An eye-replacing face wins over `asleep` if both were ever set
// (TamaScene never sets both). `tint` turns its colours (a critter's friend).
// `worn` is what it wears for a pastime (critters.js wornGlyphs), drawn over its face.
// `holding` is the prop it holds. Its limb (critters.js limbGlyphs) reaches
// `tip`, by default the prop's own (holdTip); a prop it holds without the limb
// (the controller's paws: not in HOLDS, no tip given) draws none. A `tip` with
// nothing held is a bare reach: the desk's keys or bell (TamaScene). Only a
// limb that's drawn (reaching, or cheering, below) takes a resting tail
// (`rest`) with it. `paws`, held in both paws: the side arms are on the prop,
// so they go with it (`arms`) — the scene says so explicitly (TamaScene's
// `p?.paws`), not inferred from `holding`/`reach`, so a `HOLDING` value never
// in `HOLDS` can't silently hide them. `children`, the bass, sit over the
// critter and under its limb, which frets in front of it. `cheer`: its arms
// up when it celebrates at the desk (critters.js cheerGlyphs); a resting tail
// it waves goes. `cheer` and a reach (`tip`/`holding`) never land together: a
// desk reach needs a mood (which a duty outranks) or the bell pose, and
// `cheer` needs a done or a merged duty, and nothing's held at the desk
// (HOLDING has no `code`) — if they ever did, a limb-cheerer would draw two
// limbs. `seated`: the legs it hides sitting go (critters.js placement
// lowers it onto the seat); `stride`: its legs step (critters.js strideRoot).
export function Critter({ sprite, mood = "calm", asleep = false, face = null, startle = false, tint = 0, worn = null, holding = null, tip = null, paws = false, cheer = false, seated = false, stride = false, children }) {
  const hide = EYE_FACES.has(face);
  const reach = tip ?? (holding && HOLDS[holding] ? holdTip(sprite, holding) : null);
  const rest = !!reach || (cheer && cheersWithLimb(sprite));
  return (
    <g class="critter" data-face={face || undefined} data-worn={worn || undefined} data-holding={holding || undefined}>
      {(stride ? strideRoot(sprite) : sprite.root).map((n, i) => <Node key={i} n={n} mood={mood} asleep={asleep} hide={hide} tint={tint} rest={rest} paws={paws} seated={seated} />)}
      {face && faceGlyphs(sprite, face).map((n, i) => <Node key={`face-${i}`} n={n} mood={mood} tint={tint} />)}
      {worn && wornGlyphs(sprite, worn).map((n, i) => <Node key={`worn-${i}`} n={n} mood={mood} tint={tint} />)}
      {startle && startleGlyph(sprite, !!reach).map((n, i) => <Node key={`startle-${i}`} n={n} mood={mood} tint={tint} />)}
      {children}
      {reach && limbGlyphs(sprite, holding, reach).map((n, i) => <Node key={`hold-${i}`} n={n} mood={mood} tint={tint} />)}
      {cheer && cheerGlyphs(sprite).map((n, i) => <Node key={`cheer-${i}`} n={n} mood={mood} tint={tint} />)}
    </g>
  );
}
