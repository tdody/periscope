// The pastimes (tamagotchi.PASTIMES): the props around Clawd for each, on the
// scene's 34×24 grid with the floor at y 19, and PASTIME_SCENES (at the end),
// the one record per pastime TamaScene draws from. The dishes are
// TamaDishes.jsx's. Behind-the-mascot pieces take fixed positions, set against
// the pose's x0 in the same record; the pieces Clawd holds take x0 and sit
// inside its group, so they bob with it. A critter's held pieces sit at its
// own tip instead, inside its wrapper (CritterHeld); the bass is there too, as
// Critter's child, reached by its limb (Tamagotchi.jsx's `fret`); the
// controller's paws (Paw, below) sit in a critter's own limb colour or
// Clawd's skin. Motion is CSS (styles.css, `.tama`).
import { Critter } from "./Critter.jsx";
import { CLAWD_HEIGHT, CRITTER_HEIGHT, HOLDS, holdTip, placement } from "./critters.js";
import { Steam } from "./TamaDishes.jsx";
import { BODY, EYE, gridCells, LEGS, SKIN, Y0 } from "./tamagotchi.js";

const GEO = "geometricPrecision";
const flip = (row) => [...row].reverse().join("");

// A sprite's grid cells (tamagotchi.gridCells, computed once) at any cell
// size: Clawd and the friend at full size (1×2, a terminal quadrant), the kids
// at half. Here rather than in Tamagotchi.jsx, which imports this file.
export function Sprite({ cells, cls, x0, y0 = Y0, w = 1, h = 2, fill = SKIN }) {
  return (
    <g class={cls}>
      {cells.map(({ x, y }) => (
        <rect key={`${x},${y}`} x={x0 + x * w} y={y0 + y * h} width={w + 0.02} height={h + 0.02} fill={fill} />
      ))}
    </g>
  );
}
const STANCE = [LEGS[0]];
const KID_CELLS = { body: gridCells(BODY), legs: gridCells(STANCE) };
const FRIEND_CELLS = { body: gridCells(BODY.map(flip)), legs: gridCells(STANCE.map(flip)) };

// ---- the run: motion lines streaming off Clawd, sweat unless it's cold -----
// A Halloween round (the ghost run) goes out in a sheet, so no sweat shows.
export function RunTrail({ season, trick }) {
  return (
    <>
      <g class="tama-motion" fill="var(--fg-3)">
        <rect x="1" y="10.6" width="4" height="0.5" />
        <rect x="2.4" y="13.6" width="3.6" height="0.5" />
        <rect x="0.6" y="16.6" width="4.6" height="0.5" />
      </g>
      {season !== "winter" && !trick && <path class="tama-sweat" d="M25 7.6 q1.1 1.7 0 2.5 q-1.1 -0.8 0 -2.5z" fill="#7fb6e6" />}
    </>
  );
}

// ---- cycling: outdoors (Tamagotchi's Scenery), lifted onto the saddle -------
// Wheels at the frame's ends, the bottom bracket under Clawd's middle; the
// legs' two stride frames are the pedalling. Drawn behind Clawd, so the body
// hides the saddle and seat tube.
function Wheel({ cx }) {
  return (
    <g>
      <circle cx={cx} cy="16.7" r="2.2" fill="none" stroke="#2b2f36" stroke-width="0.55" />
      <g class="tama-spokes" stroke="#9aa3ae" stroke-width="0.18">
        <line x1={cx - 2} y1="16.7" x2={cx + 2} y2="16.7" />
        <line x1={cx} y1="14.7" x2={cx} y2="18.7" />
        <line x1={cx - 1.4} y1="15.3" x2={cx + 1.4} y2="18.1" />
        <line x1={cx - 1.4} y1="18.1" x2={cx + 1.4} y2="15.3" />
      </g>
      <circle cx={cx} cy="16.7" r="0.35" fill="#2b2f36" />
    </g>
  );
}

export function Bike() {
  return (
    <g class="tama-bike" shape-rendering={GEO}>
      <g class="tama-motion" fill="var(--fg-3)">
        <rect x="0.6" y="9.2" width="3.4" height="0.5" />
        <rect x="1.4" y="11.6" width="3" height="0.5" />
        <rect x="0.4" y="13.6" width="3.6" height="0.5" />
      </g>
      <Wheel cx={7.2} />
      <Wheel cx={26.8} />
      <g fill="none" stroke="#2a9d8f" stroke-width="0.5" stroke-linecap="round">
        <path d="M7.2 16.7 L15.5 16.9 L24.4 13.2 L26.8 16.7" />
        <path d="M7.2 16.7 L11.6 13.8" />
      </g>
      <path d="M24.4 13.2 L24 11.4 M23.2 11.5 H25.4" fill="none" stroke="#2b2f36" stroke-width="0.45" stroke-linecap="round" />
      <circle cx="15.5" cy="16.9" r="0.8" fill="none" stroke="#5a6472" stroke-width="0.3" />
      <g class="tama-crank" fill="#2b2f36">
        <path d="M14.5 15.9 L16.5 17.9" stroke="#2b2f36" stroke-width="0.3" />
        <rect x="14" y="15.6" width="0.9" height="0.4" />
        <rect x="16.1" y="17.8" width="0.9" height="0.4" />
      </g>
    </g>
  );
}

// Over the head's top row, narrower than it so it reads as a helmet, not a
// cap; any hat takes its place (Tamagotchi decides).
export function Helmet({ x0 }) {
  return (
    <g class="tama-helmet" shape-rendering={GEO}>
      <path d={`M${x0 + 3.6} ${Y0 + 0.5} Q${x0 + 3.6} ${Y0 - 1.6} ${x0 + 9} ${Y0 - 1.6} Q${x0 + 14.4} ${Y0 - 1.6} ${x0 + 14.4} ${Y0 + 0.5} Z`}
            fill="#e05252" />
      <g fill="#8f2a2a">
        {[6.4, 8.5, 10.6].map((dx) => <rect key={dx} x={x0 + dx} y={Y0 - 0.9} width="0.9" height="0.45" rx="0.2" />)}
      </g>
      <rect x={x0 + 13.2} y={Y0 + 0.1} width="2.4" height="0.5" rx="0.25" fill="#8f2a2a" />
    </g>
  );
}

// Where Clawd's fretting hand holds the bass neck (x0 + 17.5, 11.1, 1×0.9),
// centred on the neck line: a critter's limb reaches here (TamaScene).
export const BASS_FRET = { dx: 18, y: 11.7 };

// One of a critter's hands on a prop it holds the way Clawd does, or at the
// desk (TamaDuty's TypingPaws / SlapPaw), in scene units: a small rect in its
// limb's colour, round for a tentacle, outlined where its limb is (Nox's
// black paws on the dark controller).
export function Paw({ limb, x, y, w, h, cls }) {
  const round = limb.style === "tentacle";
  return (
    <rect class={cls} x={x} y={y} width={w} height={h} rx={round ? h / 2 : 0.25} fill={limb.color}
          stroke={limb.outline || undefined} stroke-width={limb.outline ? 0.25 : undefined} />
  );
}

// ---- bass practice: a bass across the body, plugged into a combo amp -------
// Lake Placid blue, so it doesn't melt into Clawd's orange. The neck rises
// gently: steeper, it crosses the eye. The headstock clears the amp's top.
export function Bass({ x0, limb }) {
  return (
    <g class="tama-bass" shape-rendering={GEO}>
      <path d={`M${x0 + 9.6} 13.7 L${x0 + 23} 9.6 L${x0 + 23.3} 10.5 L${x0 + 9.9} 14.6 Z`} fill="#4a2c1a" />
      <g fill="#efe6d8">
        {[13.5, 16.5, 19.5].map((dx) => <circle key={dx} cx={x0 + dx} cy={14.15 - 0.306 * (dx - 9.75)} r="0.13" />)}
      </g>
      <path d={`M${x0 + 23} 9.4 L${x0 + 26.4} 8.2 L${x0 + 26.7} 9.1 L${x0 + 23.3} 10.7 Z`} fill="#e3c48a" />
      <g fill="#c9ced6">
        {[23.9, 24.7, 25.5, 26.2].map((dx, i) => <circle key={dx} cx={x0 + dx} cy={9.1 - i * 0.3} r="0.25" />)}
      </g>
      <ellipse cx={x0 + 5} cy="15.3" rx="3" ry="2.1" fill="#3f6fb5" />
      <ellipse cx={x0 + 8.1} cy="14.4" rx="1.9" ry="1.5" fill="#3f6fb5" />
      <ellipse cx={x0 + 9.4} cy="13.4" rx="1.1" ry="0.6" fill="#3f6fb5" />
      <ellipse cx={x0 + 6.6} cy="14.7" rx="2" ry="1.1" fill="#f4f1ea" />
      <rect x={x0 + 5.6} y="14.1" width="1.4" height="0.9" rx="0.2" fill="#1d1f24" />
      <rect x={x0 + 2.6} y="14.9" width="1.6" height="0.7" fill="#c9ced6" />
      <g stroke="#e6e9ef" stroke-width="0.1">
        <line x1={x0 + 3.4} y1="15.1" x2={x0 + 23.1} y2="9.9" />
        <line x1={x0 + 3.4} y1="15.4" x2={x0 + 23.2} y2="10.2" />
      </g>
      {/* `limb`: a critter's (TamaScene): its paw strums, its limb frets (Critter), in place of Clawd's hands. */}
      {limb ? <Paw limb={limb} x={x0 + 7.3} y={14.5} w={1.3} h={1} cls="tama-strum" /> : (
        <>
          <rect x={x0 + 17.5} y="11.1" width="1" height="0.9" fill={SKIN} />
          <rect class="tama-strum" x={x0 + 7.4} y="14.6" width="1.1" height="0.8" fill={SKIN} />
        </>
      )}
    </g>
  );
}

function Note({ x, y, cls }) {
  return (
    <g class={cls} fill="var(--fg-2)">
      <ellipse cx={x} cy={y + 2.4} rx="0.6" ry="0.45" />
      <rect x={x + 0.35} y={y} width="0.3" height="2.4" />
      <path d={`M${x + 0.65} ${y} q1 0.5 0.6 1.6 q-0.1 -0.9 -0.6 -1`} />
    </g>
  );
}

// The cable runs from the bass (Clawd at x0 6) along the floor, behind the legs.
export function BassAmp() {
  return (
    <g class="tama-amp" shape-rendering={GEO}>
      <Note x={24.4} y={6} cls="tama-note" />
      <Note x={26.6} y={4.4} cls="tama-note tama-note2" />
      <path d="M9 17.2 C8.6 19, 12 18.9, 16 18.9 S26.4 18.9, 27.6 17.6" fill="none" stroke="#1d1f24" stroke-width="0.3" />
      <rect x="27.6" y="12.6" width="6" height="6.4" rx="0.3" fill="#2b2f36" />
      <rect x="27.6" y="12.6" width="6" height="1.2" fill="#3b404a" />
      <g fill="#c9ced6">
        {[28.4, 29.3, 30.2, 31.1].map((x) => <circle key={x} cx={x} cy="13.2" r="0.25" />)}
      </g>
      <circle cx="32.8" cy="13.2" r="0.2" fill="#e05252" />
      <rect x="28" y="14.2" width="5.2" height="4.4" fill="#4a4f58" />
      <g class="tama-speaker">
        <circle cx="30.6" cy="16.4" r="1.8" fill="#3b404a" />
        <circle cx="30.6" cy="16.4" r="0.7" fill="#2b2f36" />
      </g>
    </g>
  );
}

// ---- a beer with friends: a friend facing Clawd, string lights overhead -----
// The friend is Clawd mirrored, in another colour, arm to arm at x 18; a
// critter's is that critter (CritterFriend).
const FRIEND_X0 = 18;
const FRIEND = "#6f93d6";

// A critter's friend is that critter, mirrored, its colours turned this far:
// another individual of the same kind, as Clawd's is Clawd in blue.
export const FRIEND_HUE = 150;
const r4 = (v) => Math.round(v * 1e4) / 1e4;

// Placed like the mascot on the friend's spot, then mirrored about its own
// centre so it faces the mascot. The wrapper carries the view-box pivot for
// the same reason as the mascot's (Tamagotchi.jsx): `.tama g` pivots on its
// fill-box.
function CritterFriend({ sprite }) {
  const { scale, tx, ty } = placement(sprite, { x0: FRIEND_X0, sitting: false });
  const cx = FRIEND_X0 + 8.5;
  return (
    <g class="tama-critter" style="transform-box: view-box"
       transform={`translate(${r4(2 * cx - tx)} ${r4(ty)}) scale(${r4(-scale)} ${r4(scale)})`}>
      <Critter sprite={sprite} face="happy" tint={FRIEND_HUE} holding="pint" />
      <CritterHeld sprite={sprite} kind="pint" scale={scale} />
    </g>
  );
}

// What a critter holds at its appendage's tip (critters.js holdTip): Clawd's
// own prop at Clawd's size (`scale`, its wrapper's, undone), drawn inside the
// critter's wrapper so it bobs with it. The view-box pivot for the same reason
// as the wrapper's: `.tama g` pivots on its fill-box. The pint's clink is
// Clawd's (toward the friend); the friend's mirror turns its own toward the
// mascot, so it needs no tama-clink2. The bass and the controller aren't in
// HOLDS (TamaScene draws them itself, at the fret and in scene units), so
// they draw nothing here.
export function CritterHeld({ sprite, kind, scale }) {
  if (!HOLDS[kind]) return null;
  const [x, y] = holdTip(sprite, kind);
  const k = r4(1 / scale);
  const at = (fit, inner) => (
    <g style="transform-box: view-box" transform={`translate(${x} ${y}) scale(${k}) ${fit}`}>{inner}</g>
  );
  // Each fit puts the prop's grip on the tip: the pint's left side at its mid-height (11.5).
  if (kind === "pint") return at("translate(0 -11.5)", <Pint x={0} cls="tama-pint tama-clink" />);
  // Mirrored so the handle (on the mug's far side from Clawd) faces the
  // critter; its grip is the handle's outer edge (30.1, 14.2).
  if (kind === "mug") return at("scale(-1 1) translate(-30.1 -14.2)", <CoffeeMug />);
  // The can's grip is the apex of its own handle (17.8, 11.7).
  if (kind === "can") return at("translate(-17.8 -11.7)", <WateringCan x0={0} />);
  return null;
}

function Pint({ x, cls }) {
  return (
    <g class={cls}>
      <rect x={x} y="10.4" width="2" height="2.8" fill="#e8a92e" />
      <rect x={x + 0.3} y="10.9" width="0.3" height="1.8" fill="#ffd98a" />
      <rect x={x - 0.1} y="9.8" width="2.2" height="0.9" rx="0.4" fill="#fbf6ea" />
    </g>
  );
}

// Clawd's pint: inside its group, raised off the right arm.
export function ClawdPint({ x0 }) {
  return <Pint x={x0 + 15.2} cls="tama-pint tama-clink" />;
}

const BULBS = [["#ffd166", 15.4], ["#f28ab2", 19.6], ["#7fb6e6", 23.8], ["#9be38f", 28], ["#ffd166", 32.2]];

export function Friend({ critter }) {
  return (
    <g>
      <path d="M13.4 1.2 Q23.6 3.6 34 1.2" fill="none" stroke="var(--fg-3)" stroke-width="0.2" shape-rendering={GEO} />
      {BULBS.map(([color, x], i) => (
        <rect key={x} class={`tama-twinkle${i % 2 ? " tama-twinkle2" : ""}`} x={x - 0.35} y={1.9 + Math.sin((x - 13.4) / 6.5) * 0.9}
              width="0.7" height="0.9" rx="0.3" fill={color} />
      ))}
      <g class="tama-friend">
        {critter?.sprite ? <CritterFriend sprite={critter.sprite} /> : (
          <>
            <Sprite cells={FRIEND_CELLS.body} x0={FRIEND_X0} fill={FRIEND} />
            <Sprite cells={FRIEND_CELLS.legs} x0={FRIEND_X0} y0={Y0 + 2 * BODY.length} fill={FRIEND} />
            <g fill="none" stroke={EYE} stroke-width="0.45" stroke-linecap="square">
              <path d={`M${FRIEND_X0 + 3.8} ${Y0 + 3.5} l0.7 -0.9 l0.7 0.9`} />
              <path d={`M${FRIEND_X0 + 10.8} ${Y0 + 3.5} l0.7 -0.9 l0.7 0.9`} />
            </g>
            <Pint x={FRIEND_X0 + 1.2} cls="tama-pint tama-clink tama-clink2" />
          </>
        )}
      </g>
      <g class="tama-cheers" fill="#ffd166">
        <rect x="18.1" y="7.6" width="0.4" height="1.2" />
        <rect x="16.6" y="8.3" width="0.9" height="0.4" />
        <rect x="19.1" y="8.3" width="0.9" height="0.4" />
      </g>
    </g>
  );
}

// ---- time with the kids: two half-size Clawds (or critters), hopping ----
// On a Halloween evening they trick-or-treat in little sheets, pails in hand.
function KidSheet({ x }) {
  const L = x + 1.1;
  const R = x + 7.4;
  const hem = `q-${(R - L) / 16} 0.55 -${(R - L) / 8} 0 `.repeat(8);
  return (
    <g class="tama-kid-sheet" shape-rendering={GEO}>
      <path fill="#f5f5f7" d={`M${L} 18.8 V15.6 Q${L} 13.6 ${(L + R) / 2} 13.6 Q${R} 13.6 ${R} 15.6 V18.8 ${hem}Z`} />
      <ellipse cx={x + 3.1} cy="15.6" rx="0.35" ry="0.5" fill={EYE} />
      <ellipse cx={x + 5.4} cy="15.6" rx="0.35" ry="0.5" fill={EYE} />
      <path d={`M${x + 6.5} 17.2 q0.8 -1.2 1.6 0`} fill="none" stroke="#3a2a1a" stroke-width="0.2" />
      <rect x={x + 6.4} y="17" width="1.8" height="1.5" rx="0.5" fill="#ef8a2c" />
    </g>
  );
}

// A critter's kid: the critter at half its height on a kid's spot (8.5 wide,
// so centred at x + 4.25), feet on the floor. In a sheet it's half Clawd's
// instead: the sheet is cut for Clawd, and at CRITTER_HEIGHT ears, horns and
// antennas poke through it.
function CritterKid({ x, sprite, costume }) {
  const { scale, tx, ty } = placement(sprite, { x0: x - 4.25, sitting: false, height: (costume ? CLAWD_HEIGHT : CRITTER_HEIGHT) / 2 });
  return (
    <g class="tama-critter" style="transform-box: view-box" transform={`translate(${r4(tx)} ${r4(ty)}) scale(${r4(scale)})`}>
      <Critter sprite={sprite} />
    </g>
  );
}

function Kid({ x, cls, costume, sprite }) {
  return (
    <g class={cls}>
      {sprite ? <CritterKid x={x} sprite={sprite} costume={costume} /> : (
        <>
          <Sprite cells={KID_CELLS.body} x0={x} y0={14} w={0.5} h={1} />
          <Sprite cells={KID_CELLS.legs} x0={x} y0={18} w={0.5} h={1} />
        </>
      )}
      {costume ? <KidSheet x={x} /> : !sprite && (
        <g fill={EYE}>
          <rect x={x + 2.5} y="15" width="0.5" height="1" />
          <rect x={x + 6} y="15" width="0.5" height="1" />
        </g>
      )}
    </g>
  );
}

export function Kids({ trick = false, critter }) {
  return (
    <g>
      <Kid x={17.4} cls="tama-kid" costume={trick} sprite={critter?.sprite} />
      <Kid x={25.4} cls="tama-kid tama-kid2" costume={trick} sprite={critter?.sprite} />
    </g>
  );
}

// ---- video games: on the couch (Clawd seated at x0 3), a platformer on TV ---
export function Couch() {
  return (
    <g>
      <g fill="#4d5f95">
        <rect x="0.6" y="8.4" width="20.4" height="9" rx="1" />
        <rect x="0.2" y="13.4" width="2.6" height="5" rx="0.8" />
      </g>
      <rect x="1" y="16.6" width="21" height="1.6" rx="0.6" fill="#5f75b0" />
      <g fill="#3a2a1a">
        <rect x="1.6" y="18.2" width="0.9" height="0.8" />
        <rect x="20.2" y="18.2" width="0.9" height="0.8" />
      </g>
      <g class="tama-tv">
        <rect x="22.4" y="15.6" width="11.2" height="3.4" fill="#6f533c" />
        <rect x="22.4" y="17.1" width="11.2" height="0.3" fill="#5a4230" />
        <rect x="27.4" y="14.6" width="1.6" height="1" fill="#1d1f24" />
        <rect x="23" y="7.4" width="10.4" height="7.2" rx="0.4" fill="#1d1f24" />
        <rect x="23.6" y="8" width="9.2" height="6" fill="#20304a" />
        <rect x="23.6" y="13" width="9.2" height="1" fill="#4f9a46" />
        <rect x="29.6" y="10.8" width="2.4" height="0.5" fill="#b5733a" />
        <circle class="tama-twinkle" cx="30.8" cy="9.9" r="0.35" fill="#ffd166" />
        <rect class="tama-hero" x="25.2" y="11.9" width="0.8" height="1.1" fill="#e05252" />
      </g>
    </g>
  );
}

// Clawd's own hands, two on the grips like a critter's: his side arms are on
// the controller (TamaScene), so a bare `arm` style draws a plain SKIN paw.
const CLAWD_HANDS = { style: "arm", color: SKIN };

// `limb`: a critter's two paws on the grips, the right one tapping. Defaults
// to Clawd's own two hands.
export function Controller({ x0, limb = CLAWD_HANDS }) {
  return (
    <g class="tama-controller" shape-rendering={GEO}>
      <rect x={x0 + 6.6} y="14.2" width="4.8" height="1.4" rx="0.6" fill="#3b404a" />
      <rect x={x0 + 6.4} y="14.6" width="1.4" height="1.6" rx="0.6" fill="#3b404a" />
      <rect x={x0 + 10.2} y="14.6" width="1.4" height="1.6" rx="0.6" fill="#3b404a" />
      <path d={`M${x0 + 7.4} 14.9 h0.9 M${x0 + 7.85} 14.45 v0.9`} stroke="#c9ced6" stroke-width="0.25" />
      <circle cx={x0 + 10.2} cy="14.7" r="0.22" fill="#e05252" />
      <circle cx={x0 + 10.7} cy="15.1" r="0.22" fill="#5aa9e6" />
      <Paw limb={limb} x={x0 + 6.2} y={14.3} w={1.6} h={1.3} />
      <Paw limb={limb} x={x0 + 10} y={14.3} w={1.6} h={1.3} cls="tama-thumb" />
    </g>
  );
}

// ---- gardening: outdoors (spring and summer), a can over the flower bed ----
export function GardenBed() {
  return (
    <g shape-rendering={GEO}>
      <rect x="21.4" y="18.2" width="12.4" height="1" fill="#6b4a33" />
      <g class="tama-flowers">
        <g fill="#3f8238">
          <rect x="23" y="13.4" width="0.4" height="4.8" />
          <rect x="23.4" y="15.6" width="1" height="0.4" />
          <rect x="26" y="15.2" width="0.4" height="3" />
          <rect x="29" y="15.4" width="0.4" height="2.8" />
          <rect x="31.6" y="17" width="0.4" height="1.2" />
          <rect x="31.9" y="16.6" width="0.8" height="0.4" />
        </g>
        <circle cx="23.2" cy="13" r="1.2" fill="#ffd166" />
        <circle cx="23.2" cy="13" r="0.5" fill="#7a4e2d" />
        <path d="M25.4 15.4 V14.2 L25.9 14.7 L26.2 14 L26.5 14.7 L27 14.2 V15.4 Z" fill="#e05252" />
        <circle cx="29.2" cy="15" r="0.8" fill="#f28ab2" />
        <circle cx="29.2" cy="15" r="0.3" fill="#ffd166" />
      </g>
      <g fill="#7fb6e6">
        {[[23.4, 0], [23.9, -0.3], [24.4, -0.6]].map(([x, d]) => (
          <rect key={x} class="tama-drop" x={x} y="12.2" width="0.3" height="0.5" style={{ animationDelay: `${d}s` }} />
        ))}
      </g>
    </g>
  );
}

// The coffee break's mug (`coffee`, not the desk mug): standing by Clawd's arm at x 25.5 (Tamagotchi.jsx Behind),
// or held by its handle in a critter's appendage (CritterHeld). Here, not in
// Tamagotchi.jsx: CritterHeld draws it, and Tamagotchi.jsx imports this file.
export function CoffeeMug() {
  return (
    <>
      <g fill="#efe6d8">
        <rect x="25.5" y="12" width="3.4" height="4.6" rx="0.4" />
        <rect x="28.9" y="12.9" width="1.2" height="0.6" />
        <rect x="29.5" y="12.9" width="0.6" height="2.6" />
        <rect x="28.9" y="14.9" width="1.2" height="0.6" />
      </g>
      <rect x="25.5" y="12" width="3.4" height="0.9" fill="#7a4e2d" />
      <rect class="tama-steam" x="26.4" y="8.6" width="0.6" height="2" fill="var(--fg-3)" />
      <rect class="tama-steam tama-steam2" x="27.7" y="7.8" width="0.6" height="2" fill="var(--fg-3)" />
    </>
  );
}

export function WateringCan({ x0 }) {
  return (
    <g class="tama-can" shape-rendering={GEO}>
      <path d={`M${x0 + 16.6} 12.6 Q${x0 + 17.8} 10.8 ${x0 + 19} 12.6`} fill="none" stroke="#3f7fb5" stroke-width="0.4" />
      <line x1={x0 + 19.2} y1="13.6" x2={x0 + 21.3} y2="11.9" stroke="#5aa9e6" stroke-width="0.45" />
      <rect x={x0 + 21.1} y="11.5" width="0.6" height="0.7" fill="#3f7fb5" />
      <rect x={x0 + 16.2} y="12.6" width="3.2" height="2.4" rx="0.4" fill="#5aa9e6" />
    </g>
  );
}

// ---- cooking: a pot to stir and a pan sizzling, in a chef's hat ------------
export function Stove() {
  return (
    <g class="tama-stove" shape-rendering={GEO}>
      <rect x="21" y="12.8" width="12.8" height="6.2" fill="#d9dde3" />
      <rect x="20.8" y="12.2" width="13.2" height="0.6" fill="#3b404a" />
      <g fill="#3b404a">
        {[23, 25, 29.8, 31.8].map((x) => <circle key={x} cx={x} cy="13.6" r="0.35" />)}
      </g>
      <rect x="22.4" y="14.8" width="10" height="2.8" rx="0.3" fill="#2b2f36" />
      {/* The opacity is the glow with the motion off; the keyframes override it. */}
      <rect class="tama-glow" x="23" y="15.4" width="8.8" height="1.6" fill="#ef8a2c" opacity="0.18" />
      <rect x="21.6" y="9.4" width="4.8" height="2.8" rx="0.3" fill="#8a93a1" />
      <rect x="21" y="9.8" width="0.6" height="0.4" fill="#5a6472" />
      <rect x="26.4" y="9.8" width="0.6" height="0.4" fill="#5a6472" />
      <rect x="21.6" y="9.4" width="4.8" height="0.5" fill="#6b7480" />
      <Steam x={22.8} y={6.6} />
      <rect x="27.6" y="11.6" width="4" height="0.6" rx="0.2" fill="#2b2f36" />
      <line x1="31.6" y1="11.8" x2="33.8" y2="11.2" stroke="#2b2f36" stroke-width="0.4" />
      <g fill="#e8a92e">
        <rect class="tama-steam" x="28.4" y="10.8" width="0.5" height="0.5" />
        <rect class="tama-steam tama-steam2" x="30.2" y="10.6" width="0.5" height="0.5" />
      </g>
    </g>
  );
}

// `from`: a critter's tip (TamaScene), in place of Clawd's hand.
export function Spoon({ x0, from }) {
  return (
    <line class="tama-spoon" x1={from ? from[0] : x0 + 16.8} y1={from ? from[1] : "13.6"} x2={x0 + 21.6} y2="9.6"
          stroke="#b07a4f" stroke-width="0.45" />
  );
}

// The pleated band sits on the head's top row; any hat takes its place.
export function Toque({ x0 }) {
  return (
    <g class="tama-toque" shape-rendering={GEO}>
      <g fill="#f4f4f6">
        <circle cx={x0 + 6.4} cy={Y0 - 2.4} r="1.5" />
        <circle cx={x0 + 9} cy={Y0 - 3} r="1.8" />
        <circle cx={x0 + 11.6} cy={Y0 - 2.4} r="1.5" />
        <rect x={x0 + 5} y={Y0 - 1.6} width="8" height="1.9" />
      </g>
      <g fill="#d8dce2">
        <rect x={x0 + 7} y={Y0 - 1.4} width="0.25" height="1.6" />
        <rect x={x0 + 9} y={Y0 - 1.4} width="0.25" height="1.6" />
        <rect x={x0 + 11} y={Y0 - 1.4} width="0.25" height="1.6" />
      </g>
    </g>
  );
}

// ---- walking the dog: outdoors, a leash from Clawd's arm (x0 1) -----------
export function Dog({ from }) {
  // The leash runs from the holder to the collar: Clawd's arm, or a critter's tip.
  const [lx, ly] = from ?? [18.2, 14.2];
  return (
    <g shape-rendering={GEO}>
      <path class="tama-leash" d={`M${lx} ${ly} Q23 12.4 28.1 15`} fill="none" stroke="#e05252" stroke-width="0.25" />
      <g class="tama-dog">
        <path class="tama-tail" d="M23 15.4 L21.8 13.4" stroke="#b07a4f" stroke-width="0.55" stroke-linecap="round" />
        <g fill="#b07a4f">
          <rect class="tama-dog-a" x="23.4" y="16.6" width="0.6" height="2.4" />
          <rect class="tama-dog-a" x="27.6" y="16.6" width="0.6" height="2.4" />
          <rect class="tama-dog-b" x="24" y="16.6" width="0.6" height="2.4" />
          <rect class="tama-dog-b" x="27" y="16.6" width="0.6" height="2.4" />
          <rect x="22.8" y="14.8" width="5.8" height="2.2" rx="0.6" />
          <rect x="27.8" y="13" width="2.8" height="2.8" rx="0.6" />
        </g>
        <rect x="30.2" y="14.4" width="1.4" height="1.2" rx="0.3" fill="#c8915e" />
        <rect x="31.3" y="14.4" width="0.5" height="0.5" fill={EYE} />
        <rect x="28.2" y="12.8" width="1" height="2.2" rx="0.3" fill="#7a4e2d" />
        <rect x="29.6" y="13.8" width="0.45" height="0.5" fill={EYE} />
        <rect x="27.8" y="14.6" width="0.6" height="1.2" fill="#e05252" />
      </g>
    </g>
  );
}

// ---- swimming: summer only; sky and a beach ball behind, the water in front
export function Pool() {
  return (
    <g shape-rendering={GEO}>
      <rect x="0" y="0" width="34" height="24" fill="#6fb4ea" opacity="0.13" />
      <circle class="tama-sun" cx="4.5" cy="4" r="2.1" fill="#ffd166" />
      <g class="tama-ball">
        <circle cx="29.5" cy="13.8" r="1.8" fill="#f4f4f6" />
        <path d="M29.5 12 A1.8 1.8 0 0 1 31.3 13.8 H29.5 Z" fill="#e05252" />
        <path d="M29.5 15.6 A1.8 1.8 0 0 1 27.7 13.8 H29.5 Z" fill="#5aa9e6" />
      </g>
    </g>
  );
}

// Over Clawd (x0 6), so only the head and the paddling arms break the surface.
export function Water() {
  const crest = "q0.85 -0.6 1.7 0 ".repeat(21);
  return (
    <g shape-rendering={GEO}>
      <g class="tama-water">
        <path d={`M-1 14.6 ${crest} V24 H-1 Z`} fill="#3b8fd0" opacity="0.9" />
        <g fill="#cfe9fa">
          <rect x="4" y="17.4" width="1.6" height="0.3" />
          <rect x="15" y="19.6" width="2" height="0.3" />
          <rect x="26" y="18" width="1.4" height="0.3" />
        </g>
      </g>
      <g fill="#cfe9fa">
        <rect class="tama-splash" x="6.4" y="13" width="0.5" height="0.5" />
        <rect class="tama-splash tama-splash2" x="23.4" y="13" width="0.5" height="0.5" />
      </g>
    </g>
  );
}

export function Goggles({ x0 }) {
  return (
    <g class="tama-goggles" shape-rendering={GEO}>
      <rect x={x0 + 3} y={Y0 + 2.6} width="12" height="0.5" fill="#2b2f36" />
      {[4.3, 11.3].map((dx) => (
        <rect key={dx} x={x0 + dx} y={Y0 + 1.5} width="2.4" height="2.8" rx="0.8" fill="#7fd1e6" fill-opacity="0.45"
              stroke="#2b2f36" stroke-width="0.35" />
      ))}
    </g>
  );
}

// ---- sledding: winter's ride, seated (x0 5) on a sled over the snow --------
export function Sled() {
  return (
    <g shape-rendering={GEO}>
      <g class="tama-motion" fill="var(--fg-3)">
        <rect x="0.6" y="9.6" width="3" height="0.5" />
        <rect x="1.2" y="12" width="2.6" height="0.5" />
        <rect x="0.4" y="14.4" width="3.2" height="0.5" />
      </g>
      <g fill="#f4f8fb">
        {[[3.6, 0], [4.4, -0.2], [3.2, -0.4]].map(([x, d]) => (
          <rect key={d} class="tama-kick" x={x} y="17.8" width="0.6" height="0.6" style={{ animationDelay: `${d}s` }} />
        ))}
      </g>
      <g class="tama-sled">
        <path d="M5.4 19 H23.4 Q25.8 19 25.4 16.8" fill="none" stroke="#8a93a1" stroke-width="0.4" />
        <g fill="#8a93a1">
          {[7.6, 14, 20.4].map((x) => <rect key={x} x={x} y="17.8" width="0.4" height="1.2" />)}
        </g>
        <rect x="5" y="16.8" width="18.8" height="1.1" rx="0.3" fill="#b5452a" />
        <path d="M25.2 17 Q24.4 15.4 22.6 14.6" fill="none" stroke="#e8b84a" stroke-width="0.25" />
      </g>
    </g>
  );
}

// Round the neck, on the arms' row below the eyes; the end streams behind.
export function Scarf({ x0 }) {
  return (
    <g class="tama-scarf">
      <rect x={x0 + 3} y={Y0 + 4} width="12" height="1.1" fill="#d64541" />
      <g fill="#f4f4f6">
        {[5, 8, 11, 14].map((dx) => <rect key={dx} x={x0 + dx} y={Y0 + 4} width="0.5" height="1.1" />)}
      </g>
      <rect class="tama-scarf-tail" x={x0 - 1.4} y={Y0 + 4.2} width="2.8" height="0.8" fill="#d64541" />
    </g>
  );
}

// ---- one record per pastime -----------------------------------------------
// Everything TamaScene needs to draw a pastime, so adding one is one entry
// here (plus its drawing above and its line in tamagotchi.PASTIMES):
//   pose      where Clawd is: x0, `sitting` tucks the legs away, `lift` raises
//             it (onto the saddle); standing centred (x0 8) when absent
//   tempo     the bob, in seconds (styles.css: --tama-tempo)
//   stride    the legs alternate their two frames, at the tempo
//   smile     happy eyes, while nothing on duty takes the face
//   outdoors  set in the season's Scenery (at night on a Halloween round)
//   snowcap   snow on Clawd's head in winter, under no hat
//   jack      the Halloween week's jack-o'-lantern spot; none if no floor for one
//   Behind    behind Clawd, given { season, trick, critter, from }
//   Held      held or worn, in Clawd's group so it bobs along, given { x0 }
//             (the bass and the controller also take a critter's `limb`)
//   paws      held in both hands: the side arms are on the prop (Clawd's body
//             drawn armless, a critter's `hold-arms` hidden)
//   Headwear  on Clawd's head unless any hat outranks it, given { x0 }
//   Front     drawn over Clawd
//   trick     what changes on a Halloween round (tamagotchi.activityAt's
//             `trick`): Clawd goes as a ghost; `pail` hands it a pail
export const PASTIME_SCENES = {
  run: { tempo: 0.3, stride: true, outdoors: true, snowcap: true, Behind: RunTrail, trick: { pail: true } },
  cycle: {
    pose: { x0: 7, lift: 2 }, tempo: 0.4, stride: true, outdoors: true, jack: { x: 0.6, y: 16.4 },
    Behind: Bike, Headwear: Helmet,
  },
  music: { pose: { x0: 6 }, tempo: 0.5, jack: { x: 1.5, y: 16.4 }, Behind: BassAmp, Held: Bass },
  beer: { pose: { x0: 1 }, tempo: 0.9, smile: true, Behind: Friend, Held: ClawdPint },
  kids: { pose: { x0: 1 }, tempo: 0.7, smile: true, Behind: Kids, trick: { outdoors: true } },
  game: { pose: { x0: 3, sitting: true }, tempo: 1.2, Behind: Couch, Held: Controller, paws: true },
  garden: { pose: { x0: 2 }, tempo: 0.8, outdoors: true, Behind: GardenBed, Held: WateringCan },
  cook: { pose: { x0: 2 }, tempo: 0.6, Behind: Stove, Held: Spoon, Headwear: Toque },
  dog: { pose: { x0: 1 }, tempo: 0.5, stride: true, smile: true, outdoors: true, Behind: Dog },
  swim: { pose: { x0: 6, sitting: true }, tempo: 1, Behind: Pool, Held: Goggles, Front: Water },
  sled: {
    pose: { x0: 5, sitting: true }, tempo: 0.35, smile: true, outdoors: true, snowcap: true, Behind: Sled, Held: Scarf,
  },
};
