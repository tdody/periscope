// The evening pastimes and the meals (tamagotchi.PASTIMES / MEALS): the props
// around Clawd for each, on the scene's 34×24 grid with the floor at y 19.
// Behind-the-mascot pieces take fixed positions, set against the pose's x0 in
// Tamagotchi.POSES; the pieces Clawd holds take x0 and sit inside its group,
// so they bob with it. Motion is CSS (styles.css, `.tama`).
import { BODY, EYE, gridCells, LEGS, SKIN, Y0 } from "./tamagotchi.js";

const GEO = "geometricPrecision";
const flip = (row) => [...row].reverse().join("");

// A sprite grid at any cell size: the friend at full size, the kids at half.
function Sprite({ rows, x0, y0, w = 1, h = 2, fill }) {
  return (
    <g>
      {gridCells(rows).map(({ x, y }) => (
        <rect key={`${x},${y}`} x={x0 + x * w} y={y0 + y * h} width={w + 0.02} height={h + 0.02} fill={fill} />
      ))}
    </g>
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

// ---- music practice: a guitar across the body, a stand with the score -------
export function Guitar({ x0 }) {
  const neck = `M${x0 + 10.2} ${14} L${x0 + 19} 11.3 L${x0 + 19.3} 12.2 L${x0 + 10.5} ${14.9} Z`;
  return (
    <g class="tama-guitar" shape-rendering={GEO}>
      <path d={neck} fill="#6b4a33" />
      <path d={`M${x0 + 19} 11.1 L${x0 + 21.2} 10.3 L${x0 + 21.5} 11.4 L${x0 + 19.3} 12.4 Z`} fill="#3a2a1a" />
      {/* Sunburst: a dark rim, so the guitar doesn't melt into Clawd's orange. */}
      <ellipse cx={x0 + 5.6} cy="15.2" rx="2.7" ry="2.2" fill="#5a2612" />
      <ellipse cx={x0 + 9} cy="14.6" rx="2" ry="1.7" fill="#5a2612" />
      <ellipse cx={x0 + 5.7} cy="15.2" rx="2" ry="1.55" fill="#e8b84a" />
      <ellipse cx={x0 + 8.9} cy="14.6" rx="1.35" ry="1.1" fill="#e8b84a" />
      <circle cx={x0 + 8.3} cy="14.7" r="0.75" fill="#3a2414" />
      <rect x={x0 + 4.5} y="14.9" width="1.5" height="0.5" fill="#5a3a26" />
      <line x1={x0 + 5.3} y1="15.1" x2={x0 + 19.2} y2="11.75" stroke="#efe6d8" stroke-width="0.12" />
      <rect x={x0 + 16.2} y="11.9" width="1" height="0.9" fill={SKIN} />
      <rect class="tama-strum" x={x0 + 6.6} y="13.9" width="1.1" height="0.9" fill={SKIN} />
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

export function MusicStand() {
  return (
    <g shape-rendering={GEO}>
      <Note x={24.6} y={6} cls="tama-note" />
      <Note x={26.4} y={4} cls="tama-note tama-note2" />
      <rect x="27.8" y="8.8" width="5.6" height="4" fill="#f4f1ea" />
      <g fill="#b9b2a4">
        <rect x="28.3" y="9.6" width="4.6" height="0.15" />
        <rect x="28.3" y="10.6" width="4.6" height="0.15" />
        <rect x="28.3" y="11.6" width="4.6" height="0.15" />
      </g>
      <g fill="#3b404a">
        <circle cx="29" cy="9.7" r="0.3" />
        <circle cx="30.4" cy="10.5" r="0.3" />
        <circle cx="31.8" cy="11.5" r="0.3" />
        <rect x="27.6" y="12.8" width="6" height="0.5" />
        <rect x="30.35" y="13.3" width="0.5" height="5.2" />
      </g>
      <path d="M30.6 18.3 L28.4 19 M30.6 18.3 L32.8 19" stroke="#3b404a" stroke-width="0.4" />
    </g>
  );
}

// ---- a beer with friends: a friend facing Clawd, string lights overhead -----
// The friend is Clawd mirrored, in another colour, arm to arm at x 18.
const FRIEND_X0 = 18;
const FRIEND = "#6f93d6";

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

export function Friend() {
  return (
    <g>
      <path d="M13.4 1.2 Q23.6 3.6 34 1.2" fill="none" stroke="var(--fg-3)" stroke-width="0.2" shape-rendering={GEO} />
      {BULBS.map(([color, x], i) => (
        <rect key={x} class={`tama-twinkle${i % 2 ? " tama-twinkle2" : ""}`} x={x - 0.35} y={1.9 + Math.sin((x - 13.4) / 6.5) * 0.9}
              width="0.7" height="0.9" rx="0.3" fill={color} />
      ))}
      <g class="tama-friend">
        <Sprite rows={BODY.map(flip)} x0={FRIEND_X0} y0={Y0} fill={FRIEND} />
        <Sprite rows={[flip(LEGS[0])]} x0={FRIEND_X0} y0={Y0 + 2 * BODY.length} fill={FRIEND} />
        <g fill="none" stroke={EYE} stroke-width="0.45" stroke-linecap="square">
          <path d={`M${FRIEND_X0 + 3.8} ${Y0 + 3.5} l0.7 -0.9 l0.7 0.9`} />
          <path d={`M${FRIEND_X0 + 10.8} ${Y0 + 3.5} l0.7 -0.9 l0.7 0.9`} />
        </g>
        <Pint x={FRIEND_X0 + 1.2} cls="tama-pint tama-clink tama-clink2" />
      </g>
      <g class="tama-cheers" fill="#ffd166">
        <rect x="18.1" y="7.6" width="0.4" height="1.2" />
        <rect x="16.6" y="8.3" width="0.9" height="0.4" />
        <rect x="19.1" y="8.3" width="0.9" height="0.4" />
      </g>
    </g>
  );
}

// ---- time with the kids: two half-size Clawds, hand in hand, hopping --------
function Kid({ x, cls }) {
  return (
    <g class={cls}>
      <Sprite rows={BODY} x0={x} y0={14} w={0.5} h={1} fill={SKIN} />
      <Sprite rows={[LEGS[0]]} x0={x} y0={18} w={0.5} h={1} fill={SKIN} />
      <rect x={x + 2.5} y="15" width="0.5" height="1" fill={EYE} />
      <rect x={x + 6} y="15" width="0.5" height="1" fill={EYE} />
    </g>
  );
}

export function Kids() {
  return (
    <g>
      <Kid x={17.4} cls="tama-kid" />
      <Kid x={25.4} cls="tama-kid tama-kid2" />
    </g>
  );
}

// ---- meals: one dish beside Clawd (standing at x0 8), on the floor ---------
function Steam({ x, y }) {
  return (
    <g fill="var(--fg-3)">
      <rect class="tama-steam" x={x} y={y} width="0.5" height="1.6" />
      <rect class="tama-steam tama-steam2" x={x + 1.2} y={y - 0.6} width="0.5" height="1.6" />
    </g>
  );
}

function Plate({ y = 18.2 }) {
  return <rect x="25.8" y={y} width="7.6" height="0.8" rx="0.4" fill="#e8e2d4" />;
}

const DISHES = {
  ramen: () => (
    <g>
      <line x1="29.2" y1="10.4" x2="28.1" y2="15.6" stroke="#b07a4f" stroke-width="0.45" />
      <line x1="30.4" y1="10.7" x2="29" y2="15.6" stroke="#b07a4f" stroke-width="0.45" />
      <rect x="26.8" y="15.3" width="4.9" height="1.5" rx="0.7" fill="#f8f4ea" />
      <rect x="26" y="16.2" width="6.5" height="2.8" rx="1.2" fill="#e8e2d4" />
      <rect class="tama-steam" x="31.6" y="12.2" width="0.5" height="1.6" fill="var(--fg-3)" />
    </g>
  ),
  pizza: () => (
    <g>
      <rect x="26" y="12" width="7.4" height="5.4" fill="#d8b384" />
      <rect x="26.5" y="12.5" width="6.4" height="4.4" fill="#c9a06b" />
      <rect x="25.6" y="17.2" width="8.2" height="1.8" fill="#c49a6c" />
      <ellipse cx="29.7" cy="17.3" rx="3.6" ry="1.1" fill="#e0a94a" />
      <ellipse cx="29.7" cy="17.3" rx="3" ry="0.8" fill="#f2c94c" />
      <path d="M29.7 17.3 L33.4 17.1 L32.6 18.2 Z" fill="#c49a6c" />
      <g fill="#c0392b">
        <circle cx="28" cy="17.2" r="0.35" />
        <circle cx="29.6" cy="16.9" r="0.35" />
        <circle cx="29.2" cy="17.7" r="0.35" />
        <circle cx="31" cy="16.9" r="0.3" />
      </g>
      <Steam x={28.6} y={13.6} />
    </g>
  ),
  burger: () => (
    <g>
      <Plate />
      <rect x="27" y="17.2" width="5" height="1" rx="0.4" fill="#d9913f" />
      <rect x="26.8" y="16.2" width="5.4" height="1.1" rx="0.5" fill="#6b3a22" />
      <path d="M26.9 15.8 H32.1 V16.3 H29.2 L28.6 17 L28 16.3 H26.9 Z" fill="#f2c94c" />
      <rect x="27.1" y="15.3" width="4.8" height="0.5" fill="#e05252" />
      <rect x="26.7" y="14.9" width="5.6" height="0.5" rx="0.25" fill="#6fae5a" />
      <path d="M26.9 15 Q26.9 12.4 29.5 12.4 Q32.1 12.4 32.1 15 Z" fill="#e0a04a" />
      <g fill="#f8f0d8">
        <rect x="28.2" y="13.4" width="0.4" height="0.25" />
        <rect x="29.6" y="13" width="0.4" height="0.25" />
        <rect x="30.8" y="13.6" width="0.4" height="0.25" />
      </g>
    </g>
  ),
  sushi: () => (
    <g>
      <rect x="25.4" y="17.4" width="8.4" height="0.9" fill="#c8955c" />
      <g fill="#a5743f">
        <rect x="26.2" y="18.3" width="0.8" height="0.7" />
        <rect x="32.2" y="18.3" width="0.8" height="0.7" />
      </g>
      {[[26, "#f28c6b"], [28.7, "#d64550"]].map(([x, fish]) => (
        <g key={x}>
          <rect x={x} y="16.2" width="2.4" height="1.2" rx="0.5" fill="#f6f3ec" />
          <rect x={x - 0.2} y="15.5" width="2.8" height="0.9" rx="0.45" fill={fish} />
          <rect x={x + 0.7} y="15.6" width="0.15" height="0.7" fill="#fbd0c0" opacity="0.8" />
          <rect x={x + 1.5} y="15.6" width="0.15" height="0.7" fill="#fbd0c0" opacity="0.8" />
        </g>
      ))}
      <rect x="31.4" y="15.6" width="1.9" height="1.8" rx="0.3" fill="#1f2a1f" />
      <rect x="31.7" y="15.9" width="1.3" height="1.2" fill="#f6f3ec" />
      <rect x="32.1" y="16.25" width="0.5" height="0.5" fill="#f28c6b" />
    </g>
  ),
  tacos: () => (
    <g>
      <Plate />
      {[26, 29.8].map((x) => (
        <g key={x}>
          <rect x={x + 0.2} y="14.6" width="3.2" height="0.9" rx="0.4" fill="#6fae5a" />
          <rect x={x + 0.3} y="15.2" width="3" height="0.5" fill="#8a4b2a" />
          <rect x={x + 0.7} y="14.4" width="0.6" height="0.6" fill="#e05252" />
          <rect x={x + 2.3} y="14.3" width="0.6" height="0.6" fill="#e05252" />
          <path d={`M${x} 15.4 h3.6 a1.8 2.6 0 0 1 -3.6 0 z`} fill="#e8b84a" />
        </g>
      ))}
    </g>
  ),
  pasta: () => (
    <g>
      <line x1="31.4" y1="15.6" x2="33" y2="11.8" stroke="#c9ced6" stroke-width="0.35" />
      <rect x="25.8" y="17.6" width="7.6" height="1.2" rx="0.6" fill="#f8f4ea" />
      <rect x="26.6" y="18.4" width="6" height="0.6" fill="#e8e2d4" />
      <path d="M26.6 17.8 Q27 14.6 29.6 14.6 Q32.2 14.6 32.6 17.8 Z" fill="#f2d27a" />
      <g fill="none" stroke="#d9b45a" stroke-width="0.25">
        <path d="M27.4 17.1 q0.6 -0.7 1.2 0 t1.2 0 t1.2 0 t1.2 0" />
        <path d="M27.9 16.2 q0.6 -0.7 1.2 0 t1.2 0 t1.2 0" />
      </g>
      <path d="M28 15.4 Q29.6 14 31.2 15.4 Q29.6 16.2 28 15.4 Z" fill="#c0392b" />
      <circle cx="28.9" cy="15" r="0.55" fill="#6b3a22" />
      <circle cx="30.3" cy="14.9" r="0.55" fill="#6b3a22" />
      <Steam x={27.6} y={11.6} />
    </g>
  ),
  salad: () => (
    <g>
      <line x1="31.8" y1="15.8" x2="33.2" y2="11.8" stroke="#c9ced6" stroke-width="0.35" />
      <ellipse cx="27.8" cy="15.6" rx="1.4" ry="1" fill="#4f9a46" />
      <ellipse cx="29.6" cy="15.1" rx="1.5" ry="1.1" fill="#6fae5a" />
      <ellipse cx="31.4" cy="15.6" rx="1.3" ry="0.9" fill="#9be38f" />
      <circle cx="28.6" cy="15.2" r="0.45" fill="#e05252" />
      <circle cx="30.9" cy="15.4" r="0.45" fill="#e05252" />
      <rect x="29.4" y="14.3" width="0.4" height="1.2" fill="#ef8a2c" />
      <path d="M26 16 h7.2 q-0.4 3 -3.6 3 q-3.2 0 -3.6 -3 z" fill="#b07a4f" />
      <rect x="25.8" y="15.8" width="7.6" height="0.5" rx="0.25" fill="#9a6a43" />
    </g>
  ),
};

export function Dish({ dish }) {
  const id = DISHES[dish] ? dish : "ramen";
  return <g data-dish={id} shape-rendering={GEO}>{DISHES[id]()}</g>;
}
