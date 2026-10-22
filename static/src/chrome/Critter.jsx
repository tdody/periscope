// One critter (critters.js), drawn from its generated sprite tree in its own
// 20×20 units. Motion is the classes in static/critters.css; the caller places
// and scales it (Tamagotchi.jsx in the header, TamaPicker.jsx in Settings).

import { faceGlyphs, startleGlyph } from "./critters.js";

// A mood layer shows only in its mood. Asleep, an eye or a lid is drawn as its
// `shut` frame, held, and the glint riding on a blinking eye goes away. Under a
// face (`hide`), the face's glyph replaces the eye: the eye and its glint go,
// and a lid shuts over the eye it covers.
function Node({ n, mood, asleep, hide }) {
  if (n.mood && n.mood !== mood) return null;
  if ((asleep || hide) && n.role === "glint") return null;
  if (hide && n.role === "eye") return null;
  if (n.r) {
    const [x, y, w, h] = n.r;
    return <rect class={n.cls} x={x} y={y} width={w} height={h} {...n.a} />;
  }
  if (n.p) return <path class={n.cls} d={n.p} {...n.a} />;
  if ((asleep || hide) && n.shut) {
    const [x, y, w, h] = n.shut;
    return <rect data-role="shut" x={x} y={y} width={w} height={h} {...n.g[0].a} />;
  }
  return (
    <g class={n.anim || n.cls} data-mood={n.mood} data-role={n.role} {...n.a}>
      {n.g.map((c, i) => <Node key={i} n={c} mood={mood} asleep={asleep} hide={hide} />)}
    </g>
  );
}

// `face` is one of the duty faces (critters.js faceGlyphs) and `startle` the
// bell's "!": both drawn inside the critter's own group, so they scale and bob
// with it.
export function Critter({ sprite, mood = "calm", asleep = false, face = null, startle = false }) {
  const hide = face === "happy" || face === "x" || face === "down";
  return (
    <g class="critter" data-face={face || undefined}>
      {sprite.root.map((n, i) => <Node key={i} n={n} mood={mood} asleep={asleep} hide={hide} />)}
      {face && faceGlyphs(sprite, face).map((n, i) => <Node key={`face-${i}`} n={n} mood={mood} />)}
      {startle && startleGlyph(sprite).map((n, i) => <Node key={`startle-${i}`} n={n} mood={mood} />)}
    </g>
  );
}
