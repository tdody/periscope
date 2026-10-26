// One critter (critters.js), drawn from its generated sprite tree in its own
// 20×20 units. Motion is the classes in static/critters.css; the caller places
// and scales it (Tamagotchi.jsx in the header, TamaPicker.jsx in Settings).

import { cheerGlyphs, cheersWithLimb, EYE_FACES, FLUSH, faceGlyphs, HOLDS, holdTip, hueRotate, limbGlyphs, r4, startleGlyph, strideRoot, teethGlyph, wornGlyphs } from "./critters.js";

// A friend's colours (TamaPastimes.jsx): every fill and stroke turned by
// `tint` degrees. No tint draws the critter's own paint, untouched.
function painted(a, tint) {
  if (!tint || !a) return a;
  const out = { ...a };
  if (a.fill) out.fill = hueRotate(a.fill, tint);
  if (a.stroke) out.stroke = hueRotate(a.stroke, tint);
  return out;
}

// A stroked node's own paint, recoloured to the flush at its own width: Nox's
// and Octocat's grey outline copies, left out, would leave a grey ring around
// a red body (the first draft's defect).
const flushStroke = (a) => (a?.stroke ? { stroke: FLUSH, "stroke-width": a["stroke-width"] } : undefined);

// A mood layer shows only in its mood. Asleep, an eye or a lid is drawn as its
// `shut` frame, held, and the glint riding on a blinking eye goes away. Under a
// face (`hide`), the face's glyph replaces the eye: the eye and its glint go,
// and a lid shuts over the eye it covers. `p`/`cls` are the face glyphs'
// fields (faceGlyphs/startleGlyph/wornGlyphs/cheerGlyphs): an SVG path's `d`
// and a CSS class. `cls` alone also marks strideRoot's two frame wrappers
// (tama-legs-a/-b): styles.css swaps them, so neither is ever animated either.
// In flush mode (`flush`, Critter's furious wash): mood layers and paths are
// left out; rects and groups carry no fill of their own (the wrapper's
// `tama-flush` fill applies) but keep a stroke, recoloured via `flushStroke`
// above; every other visibility rule (`rest`, `paws`, `seated`, `hide`,
// `asleep`) still applies and still threads through the recursion.
function Node({ n, mood, asleep, hide, tint, rest, paws, seated, flush }) {
  if (flush && n.mood) return null; // mood layers aren't body: the furious layer is redrawn separately, crisp
  if (n.mood && n.mood !== mood) return null;
  if (rest && n.rest) return null;
  if (paws && n.arms) return null;
  if (seated && n.legs && !n.keepSeated) return null;
  if ((asleep || hide) && n.role === "glint") return null;
  if (hide && n.role === "eye") return null;
  if (n.r) {
    const [x, y, w, h] = n.r;
    // The wrapper's own fill applies in the wash; 0.02 larger closes seams
    // between adjoining rects, as Clawd's Sprite does.
    if (flush) return <rect class={n.cls} x={x} y={y} width={r4(w + 0.02)} height={r4(h + 0.02)} {...flushStroke(n.a)} />;
    return <rect class={n.cls} x={x} y={y} width={w} height={h} {...painted(n.a, tint)} />;
  }
  if (n.p) return flush ? null : <path class={n.cls} d={n.p} {...painted(n.a, tint)} />;
  if (flush) {
    // A shut frame in the wash: unpainted too, 0.02 larger like any flush rect.
    if ((asleep || hide) && n.shut) {
      const [x, y, w, h] = n.shut;
      return <rect data-role="shut" x={x} y={y} width={r4(w + 0.02)} height={r4(h + 0.02)} />;
    }
    return (
      <g class={n.anim || n.cls} {...flushStroke(n.a)}>
        {n.g.map((c, i) => <Node key={i} n={c} mood={mood} asleep={asleep} hide={hide} rest={rest} paws={paws} seated={seated} flush />)}
      </g>
    );
  }
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
// Furious, its silhouette washes red like Clawd's flush (`tama-flush`), with
// its role-tagged eyes/lids and own furious face drawn once, crisp, on top of
// the wash (Nox's and Moss's role-less eyes have no role to redraw, so they
// just take the tint, like the approved draft), and gritted teeth in its
// shouting mouth (critters.js teethGlyph).
export function Critter({ sprite, mood = "calm", asleep = false, face = null, startle = false, tint = 0, worn = null, holding = null, tip = null, paws = false, cheer = false, seated = false, stride = false, children }) {
  const hide = EYE_FACES.has(face);
  const reach = tip ?? (holding && HOLDS[holding] ? holdTip(sprite, holding) : null);
  const rest = !!reach || (cheer && cheersWithLimb(sprite));
  const furious = mood === "furious" && !asleep;
  const hasRole = (n) => n.role !== undefined || (n.g || []).some(hasRole);
  const rootNodes = stride ? strideRoot(sprite) : sprite.root;
  const faceNodes = furious ? sprite.root.filter((n) => n.mood === "furious" || hasRole(n)) : [];
  // Furious, the face nodes are left out of the main pass below and drawn
  // once, after the wash: drawn in both, two animated copies stack (one
  // inside the wash's reduced opacity), which never fades to full and never
  // reaches full opacity either — Nox's sparks topped out at ~0.51 — and the
  // mismatch free-ran as a ghost-blink independently of the remount below.
  const bodyNodes = furious ? rootNodes.filter((n) => !faceNodes.includes(n)) : rootNodes;
  return (
    // Furious, remount everything together (key): a CSS animation starts
    // when its element mounts, and the flush/face copies otherwise mount
    // later than the body (whenever the mood turns furious), free-running
    // out of phase with it — measured 0.869 against the body's 0.774 on
    // Jelly's tentacles, drifting the wash off them and Volt's arms, and
    // ghost-blinking the eyes. Entering or leaving furious now remounts the
    // whole critter, so every copy starts together.
    <g key={furious ? "furious" : "calm"} class="critter" data-face={face || undefined} data-worn={worn || undefined} data-holding={holding || undefined}>
      {bodyNodes.map((n, i) => <Node key={i} n={n} mood={mood} asleep={asleep} hide={hide} tint={tint} rest={rest} paws={paws} seated={seated} />)}
      {face && faceGlyphs(sprite, face).map((n, i) => <Node key={`face-${i}`} n={n} mood={mood} tint={tint} />)}
      {worn && wornGlyphs(sprite, worn).map((n, i) => <Node key={`worn-${i}`} n={n} mood={mood} tint={tint} />)}
      {startle && startleGlyph(sprite, !!reach).map((n, i) => <Node key={`startle-${i}`} n={n} mood={mood} tint={tint} />)}
      {children}
      {reach && limbGlyphs(sprite, holding, reach).map((n, i) => <Node key={`hold-${i}`} n={n} mood={mood} tint={tint} />)}
      {cheer && cheerGlyphs(sprite).map((n, i) => <Node key={`cheer-${i}`} n={n} mood={mood} tint={tint} />)}
      {furious && (
        <g class="tama-flush" fill={FLUSH} opacity="0.5">
          {rootNodes.map((n, i) => <Node key={i} n={n} mood={mood} hide={hide} rest={rest} paws={paws} seated={seated} flush />)}
          {reach && limbGlyphs(sprite, holding, reach).map((n, i) => <Node key={`hold-${i}`} n={n} mood={mood} flush />)}
        </g>
      )}
      {furious && faceNodes.map((n, i) => <Node key={`fu-${i}`} n={n} mood={mood} asleep={asleep} hide={hide} tint={tint} rest={rest} paws={paws} seated={seated} />)}
      {furious && teethGlyph(sprite).map((n, i) => <Node key={`teeth-${i}`} n={n} mood={mood} tint={tint} />)}
    </g>
  );
}
