// One critter (critters.js), drawn from its generated sprite tree in its own
// 20×20 units. Motion is the classes in static/critters.css; the caller places
// and scales it (Tamagotchi.jsx in the header, TamaPicker.jsx in Settings).

import { EYE_FACES, HOLDS, faceGlyphs, holdTip, hueRotate, limbGlyphs, startleGlyph, wornGlyphs } from "./critters.js";

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
// fields (faceGlyphs/startleGlyph): an SVG path's `d` and a CSS class.
function Node({ n, mood, asleep, hide, tint, rest }) {
  if (n.mood && n.mood !== mood) return null;
  if (rest && n.rest) return null;
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
  // n.anim and n.cls never both land here: `cls` is a face glyph's own field,
  // and a face glyph is static art (critters.js), never animated.
  return (
    <g class={n.anim || n.cls} data-mood={n.mood} data-role={n.role} {...painted(n.a, tint)}>
      {n.g.map((c, i) => <Node key={i} n={c} mood={mood} asleep={asleep} hide={hide} tint={tint} rest={rest} />)}
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
// (the controller's paws: not in HOLDS, no tip given) draws none. Only a limb
// that reaches takes a resting tail (`rest`) with it. `children`, the bass, sit
// over the critter and under its limb, which frets in front of it.
export function Critter({ sprite, mood = "calm", asleep = false, face = null, startle = false, tint = 0, worn = null, holding = null, tip = null, children }) {
  const hide = EYE_FACES.has(face);
  const reach = tip ?? (holding && HOLDS[holding] ? holdTip(sprite, holding) : null);
  return (
    <g class="critter" data-face={face || undefined} data-worn={worn || undefined} data-holding={holding || undefined}>
      {sprite.root.map((n, i) => <Node key={i} n={n} mood={mood} asleep={asleep} hide={hide} tint={tint} rest={!!reach} />)}
      {face && faceGlyphs(sprite, face).map((n, i) => <Node key={`face-${i}`} n={n} mood={mood} tint={tint} />)}
      {worn && wornGlyphs(sprite, worn).map((n, i) => <Node key={`worn-${i}`} n={n} mood={mood} tint={tint} />)}
      {startle && startleGlyph(sprite, !!holding).map((n, i) => <Node key={`startle-${i}`} n={n} mood={mood} tint={tint} />)}
      {children}
      {reach && limbGlyphs(sprite, holding, reach).map((n, i) => <Node key={`hold-${i}`} n={n} mood={mood} tint={tint} />)}
    </g>
  );
}
