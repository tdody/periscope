// Clawd on duty (clawdDuty.js decides what): the bubble, and the poses and
// props for each kind. The desk props use the coding scene's fixed desk and
// monitor (screen x 23.4–31.6, y 6–11.6); the face pieces take the pose's x0
// so they sit on Clawd in any scene. Motion is CSS (styles.css, `.tama`).
import { EYE, SKIN, Y0 } from "./tamagotchi.js";

const GEO = "geometricPrecision";

function Screen({ fill = "#1d2026" }) {
  return <rect x="23.4" y="6" width="8.2" height="5.6" fill={fill} />;
}

function Label({ x, y, size, fill, weight = 700, anchor = "start", children }) {
  return (
    <text x={x} y={y} font-size={size} font-weight={weight} font-family="var(--mono)" text-anchor={anchor} fill={fill}>
      {children}
    </text>
  );
}

// ---- the bubble: the one glanceable element, in every scene ---------------
const ICONS = {
  bell: (
    <g>
      <rect x="2.9" y="1.35" width="0.6" height="0.55" fill="#b8862a" />
      <path d="M1.9 4.3 Q1.9 1.8 3.2 1.8 Q4.5 1.8 4.5 4.3 Z" fill="#e8a92e" />
      <rect x="1.55" y="4.1" width="3.3" height="0.55" rx="0.2" fill="#e8a92e" />
      <circle cx="3.2" cy="4.95" r="0.38" fill="#8a5a1a" />
    </g>
  ),
  done: <path d="M1.7 3.4 l1.1 1.1 l2.1 -2.4" fill="none" stroke="#2f9a57" stroke-width="0.8" stroke-linecap="square" />,
  ci: <path d="M1.9 1.9 l2.6 2.6 M4.5 1.9 l-2.6 2.6" fill="none" stroke="#d64541" stroke-width="0.8" stroke-linecap="square" />,
  api: <path d="M3.8 1.3 L1.9 3.5 H3.1 L2.6 5.3 L4.6 2.9 H3.4 Z" fill="#e8a92e" />,
  ctx: (
    <g>
      <rect x="2" y="1.5" width="2.4" height="3.7" rx="0.3" fill="none" stroke="#5a6472" stroke-width="0.35" />
      <rect x="2.35" y="2.05" width="1.7" height="2.8" fill="#e8892e" />
    </g>
  ),
  clean: (
    <g>
      <path d="M4.4 1.4 L3 3.7" stroke="#8b6a4e" stroke-width="0.45" />
      <path d="M2.2 3.4 L3.9 4.2 L3.2 5.3 L1.4 4.5 Z" fill="#d9a83a" />
    </g>
  ),
  update: (
    <g>
      <rect x="1.6" y="2.3" width="3.2" height="2.8" fill="#c49a6c" />
      <rect x="1.6" y="2.3" width="3.2" height="0.65" fill="#d8b384" />
      <rect x="2.95" y="2.3" width="0.5" height="2.8" fill="#a57c4f" />
    </g>
  ),
  merged: (
    <g>
      <path d="M2.2 2 V4.6 M2.2 2.4 Q2.2 3.3 4.3 3.3" fill="none" stroke="#8957e5" stroke-width="0.4" />
      <circle cx="2.2" cy="1.9" r="0.55" fill="#8957e5" />
      <circle cx="2.2" cy="4.7" r="0.55" fill="#8957e5" />
      <circle cx="4.4" cy="3.3" r="0.55" fill="#8957e5" />
    </g>
  ),
};

// Mono digits are ~0.6em wide; the bubble grows with its label. The tail
// points at the head: above it when Clawd sits left (x0 3–4), at its left
// edge when standing (x0 8).
export function Bubble({ kind, label, urgent, more, x0 }) {
  const w = 4.6 + label.length * 2.16 + 0.9;
  const [fill, ink] = urgent ? ["#e05252", "#ffffff"] : ["#f4f4f6", "#1b2028"];
  const tip = Math.max(x0 + 3.6, 9.4);
  const px = 0.8 + w + 0.7;
  return (
    <g class={`tama-bubble${urgent ? " tama-bubble-urgent" : ""}`} shape-rendering={GEO}>
      <path d={`M6.4 5.6 L${tip} 8.3 L8.4 5.6 Z`} fill={fill} />
      <rect x="0.8" y="0.8" width={w} height="5" rx="1.3" fill={fill} />
      {ICONS[kind]}
      <Label x="5.3" y="4.75" size="3.6" fill={ink}>{label}</Label>
      {more > 0 && (
        <g class="tama-more">
          <rect x={px} y="1.9" width="4.4" height="2.8" rx="1.4" fill="#3b404a" />
          <Label x={px + 2.2} y="3.95" size="2.1" fill="#e6e9ef" weight={600} anchor="middle">{`+${more}`}</Label>
        </g>
      )}
    </g>
  );
}

// ---- faces (inside Clawd's group, so they move with it) -------------------
export function HappyEyes({ x0 }) {
  return (
    <g fill="none" stroke={EYE} stroke-width="0.45" stroke-linecap="square">
      <path d={`M${x0 + 4.8} ${Y0 + 3.5} l0.7 -0.9 l0.7 0.9`} />
      <path d={`M${x0 + 11.8} ${Y0 + 3.5} l0.7 -0.9 l0.7 0.9`} />
    </g>
  );
}

export function XEyes({ x0 }) {
  return (
    <g fill="none" stroke={EYE} stroke-width="0.45" stroke-linecap="square">
      <path d={`M${x0 + 4.9} ${Y0 + 2.3} l1.2 1.5 M${x0 + 6.1} ${Y0 + 2.3} l-1.2 1.5`} />
      <path d={`M${x0 + 11.9} ${Y0 + 2.3} l1.2 1.5 M${x0 + 13.1} ${Y0 + 2.3} l-1.2 1.5`} />
    </g>
  );
}

export function Worried({ x0 }) {
  return (
    <g>
      <g fill="none" stroke={EYE} stroke-width="0.4">
        <path d={`M${x0 + 4.4} ${Y0 + 1.5} l1.8 -0.6`} />
        <path d={`M${x0 + 11.8} ${Y0 + 0.9} l1.8 0.6`} />
      </g>
      <path class="tama-sweat" fill="#7fb6e6" d={`M${x0 + 2.2} ${Y0 + 0.4} q0.8 1.2 0 1.8 q-0.8 -0.6 0 -1.8z`} />
      <path class="tama-sweat" style={{ animationDelay: "-0.6s" }} fill="#7fb6e6"
            d={`M${x0 + 15.9} ${Y0 + 0.8} q0.8 1.2 0 1.8 q-0.8 -0.6 0 -1.8z`} />
    </g>
  );
}

function Sparkle({ x, y, cls = "tama-sparkle", delay = 0 }) {
  const pts = [[0, -0.9], [0.25, -0.25], [0.9, 0], [0.25, 0.25], [0, 0.9], [-0.25, 0.25], [-0.9, 0], [-0.25, -0.25]];
  return (
    <path class={cls || undefined} style={delay ? { animationDelay: `${delay}s` } : undefined} fill="#ffd166" shape-rendering={GEO}
          d={`M${pts.map(([dx, dy]) => `${(x + dx).toFixed(2)} ${(y + dy).toFixed(2)}`).join(" L")} Z`} />
  );
}

// Knocked out: stars circling the head.
export function Stars({ x0 }) {
  return (
    <g>
      {[[6, 7.4, 0], [9, 6.6, -0.6], [12, 7.4, -1.2]].map(([dx, y, d]) => (
        <g key={dx} class="tama-orbit" style={{ animationDelay: `${d}s` }}><Sparkle x={x0 + dx} y={y} cls="" /></g>
      ))}
    </g>
  );
}

// "!" beside the head: a bell away from the desk.
export function Startle({ x0 }) {
  return (
    <g class="tama-startle" fill="#f2c14e">
      <rect x={x0 + 16.6} y="5.8" width="0.6" height="1.8" />
      <rect x={x0 + 16.6} y="8" width="0.6" height="0.6" />
    </g>
  );
}

export function ArmsUp({ x0 }) {
  return (
    <g fill={SKIN}>
      <rect class="tama-cheer" x={x0} y="9.8" width="1.02" height="3.4" />
      <rect class="tama-cheer tama-cheer2" x={x0 + 16} y="9.8" width="1.02" height="3.4" />
    </g>
  );
}

// ---- 1. the bell ----------------------------------------------------------
const Ding = ({ d }) => (
  <g class="tama-ding" fill="none" stroke="#f2c14e" stroke-width="0.3" shape-rendering={GEO}><path d={d} /></g>
);

export function SlapHand() {
  return <rect class="tama-slap" x="21.6" y="8.7" width="1.2" height="0.9" fill={SKIN} />;
}

export function ServiceBell() {
  return (
    <g>
      <g shape-rendering={GEO}>
        <rect x="20.7" y="12.6" width="3" height="0.6" rx="0.2" fill="#8b93a1" />
        <path d="M20.95 12.65 Q20.95 10.9 22.2 10.9 Q23.45 10.9 23.45 12.65 Z" fill="#f2c14e" />
        <rect x="21.4" y="11.4" width="0.4" height="0.5" fill="#fff3c4" />
        <rect x="21.95" y="10.4" width="0.5" height="0.55" fill="#c9a03a" />
      </g>
      <Ding d="M20.3 10.4 l-1 -0.5 M20.6 9.5 l-0.6 -0.9 M24.1 10.4 l1 -0.5 M23.8 9.5 l0.6 -0.9" />
    </g>
  );
}

// Asleep, only the bell wakes Clawd: an alarm clock on the floor.
export function AlarmClock() {
  return (
    <g>
      <g class="tama-alarm" shape-rendering={GEO}>
        <rect x="27.4" y="18.2" width="0.5" height="0.8" fill="#8b93a1" />
        <rect x="30.1" y="18.2" width="0.5" height="0.8" fill="#8b93a1" />
        <circle cx="27.4" cy="14.3" r="0.9" fill="#e8a92e" />
        <circle cx="30.6" cy="14.3" r="0.9" fill="#e8a92e" />
        <rect x="28.8" y="13.4" width="0.4" height="1" fill="#3b404a" />
        <circle cx="29" cy="16.4" r="2.1" fill="#e6e9ef" stroke="#d03a3a" stroke-width="0.45" />
        <path d="M29 16.4 v-1.3 M29 16.4 h0.9" stroke={EYE} stroke-width="0.3" fill="none" />
      </g>
      <Ding d="M26 14 l-0.9 -0.6 M25.8 15.3 l-1 0 M32 14 l0.9 -0.6 M32.2 15.3 l1 0" />
    </g>
  );
}

// ---- 2. finished / 10. merged: the monitor celebrates ----------------------
export function Sparkles() {
  return (
    <g>
      <Sparkle x={22.2} y={4.4} />
      <Sparkle x={32.6} y={4.8} delay={-0.5} />
      <Sparkle x={20.6} y={7.2} delay={-1} />
    </g>
  );
}

export function DoneScreen() {
  return (
    <g>
      <Screen />
      <path d="M25.3 8.8 l1.7 1.7 l3.4 -3.6" fill="none" stroke="#6fcf8f" stroke-width="0.9" stroke-linecap="square" shape-rendering={GEO} />
    </g>
  );
}

export function MergeScreen() {
  return (
    <g>
      <Screen fill="#1d1a26" />
      <g shape-rendering={GEO}>
        <path d="M26.3 6.9 V9.4 M26.3 7.3 Q26.3 8.1 28.9 8.1" fill="none" stroke="#a371f7" stroke-width="0.45" />
        <circle cx="26.3" cy="6.9" r="0.6" fill="#a371f7" />
        <circle cx="26.3" cy="9.5" r="0.6" fill="#a371f7" />
        <circle cx="29" cy="8.1" r="0.6" fill="#a371f7" />
      </g>
      <Label x="27.5" y="11.15" size="1.35" fill="#a371f7" weight={600} anchor="middle">merged</Label>
    </g>
  );
}

// ---- 3. CI red: the monitor's on fire --------------------------------------
const Flame = ({ x }) => (
  <g>
    <path class="tama-flame" fill="#f08a3c" d={`M${x} 5.6 q-0.5 -1.8 0.7 -3 q0.2 1.1 0.7 1.5 q0.3 -1 1 -1.6 q0.8 1.8 0.1 3.1z`} />
    <path class="tama-flame tama-flame2" fill="#ffd166"
          d={`M${x + 0.5} 5.6 q-0.2 -1 0.6 -1.8 q0.2 0.7 0.6 0.9 q0.3 -0.5 0.4 -0.9 q0.6 1 0.1 1.8z`} />
  </g>
);

export function CiScreen() {
  return (
    <g>
      <Screen fill="#2a1416" />
      <g class="tama-errors">
        <path d="M25.4 7.1 l3.2 3.2 M28.6 7.1 l-3.2 3.2" fill="none" stroke="#e05252" stroke-width="0.8" stroke-linecap="square" />
        <Label x="29.4" y="10.7" size="1.8" fill="#e05252">CI</Label>
      </g>
      <Flame x={24.6} />
      <Flame x={28.4} />
      <g fill="#f4f4f6" shape-rendering={GEO}>
        <circle class="tama-spray" cx="23" cy="6" r="0.5" />
        <circle class="tama-spray tama-spray2" cx="23" cy="6" r="0.6" />
        <circle class="tama-spray tama-spray3" cx="23" cy="6" r="0.45" />
      </g>
    </g>
  );
}

export function Extinguisher() {
  return (
    <g shape-rendering={GEO}>
      <path d="M20.4 9.2 q0.8 -1.6 2.3 -2.6" fill="none" stroke="#2b2f36" stroke-width="0.35" />
      <rect x="19.3" y="9.3" width="1.5" height="3.8" rx="0.55" fill="#d03a3a" />
      <rect x="19.6" y="8.7" width="0.9" height="0.7" fill="#3b404a" />
      <rect x="19.5" y="10.4" width="1.1" height="0.9" fill="#f4f4f6" />
    </g>
  );
}

// ---- 4. API errors: static and the status code -----------------------------
const NOISE_A = Array.from({ length: 18 }, (_, i) => [23.6 + ((i * 1.7) % 7.4), 6.2 + ((i * 1.3) % 4.8)]);
const NOISE_B = Array.from({ length: 18 }, (_, i) => [24.1 + ((i * 2.3) % 7.2), 6.5 + ((i * 0.9) % 4.8)]);

export function ApiScreen() {
  const dots = (pts) => pts.map(([x, y]) => <rect key={`${x},${y}`} x={x.toFixed(1)} y={y.toFixed(1)} width="0.6" height="0.6" />);
  return (
    <g>
      <Screen fill="#22252b" />
      <g class="tama-static" fill="#8b93a1">{dots(NOISE_A)}</g>
      <g class="tama-static tama-static2" fill="#5d6470">{dots(NOISE_B)}</g>
      <rect x="25.2" y="7.8" width="4.6" height="2.4" fill="#22252b" />
      <Label x="27.5" y="9.7" size="2" fill="#ffd166" anchor="middle">529</Label>
    </g>
  );
}

// ---- 5. context nearly full ------------------------------------------------
export function PaperStack() {
  return (
    <g class="tama-stack">
      {Array.from({ length: 12 }, (_, i) => (
        <rect key={i} x={20.5 + (i % 2 ? 0.35 : 0)} y={(12.65 - i * 0.68).toFixed(2)} width="2.6" height="0.55"
              fill={i % 2 ? "#f2ece0" : "#e2dccf"} />
      ))}
    </g>
  );
}

// A window nearly full shows its context bar; a context that's merely
// expensive to keep carrying (the server's cost band) asks for a compact.
export function CtxScreen({ pct, cost }) {
  if (cost) {
    return (
      <g>
        <Screen />
        <Label x="27.5" y="9.6" size="1.7" fill="#f2a33a" anchor="middle">compact?</Label>
      </g>
    );
  }
  const p = Math.min(100, Math.max(0, pct ?? 90));
  return (
    <g>
      <Screen />
      <Label x="24.2" y="7.9" size="1.4" fill="#a4acb9" weight={500}>context</Label>
      <rect x="24.2" y="8.6" width="6.6" height="1.5" fill="none" stroke="#707884" stroke-width="0.25" />
      <rect class="tama-fill" x="24.4" y="8.8" width={(6.2 * p) / 100} height="1.1" fill="#f2a33a" />
      {pct != null && <Label x="30.8" y="11.3" size="1.5" fill="#f2a33a" anchor="end">{`${pct}%`}</Label>}
    </g>
  );
}

// ---- 6. the monitor mirrors tmux: a lit split per working agent -------------
const LINE_COLORS = ["#52b4ea", "#7fbf7f", "#c792ea", "#e6e9ef"];
const FRACS = [0.85, 0.55, 0.7, 0.4, 0.9, 0.6];
const CELLS = {
  1: [[23.4, 6, 8.2, 5]],
  2: [[23.4, 6, 4.1, 5], [27.5, 6, 4.1, 5]],
  4: [[23.4, 6, 4.1, 2.5], [27.5, 6, 4.1, 2.5], [23.4, 8.5, 4.1, 2.5], [27.5, 8.5, 4.1, 2.5]],
};

export function PanesScreen({ n }) {
  const cells = n === 0 ? [] : CELLS[n === 1 ? 1 : n === 2 ? 2 : 4];
  let k = 0;
  return (
    <g>
      <Screen />
      <rect x="23.4" y="11" width="8.2" height="0.6" fill={n ? "#3d8f5a" : "#2c4234"} />
      {n === 0 && <rect class="tama-cursor" x="24" y="6.6" width="0.6" height="0.6" fill="#707884" />}
      {cells.length >= 2 && <rect x="27.45" y="6" width="0.12" height="5" fill="#4b515c" />}
      {cells.length === 4 && <rect x="23.4" y="8.45" width="8.2" height="0.12" fill="#4b515c" />}
      {/* Past four agents every split is lit; at three, the fourth stays dark. */}
      {cells.slice(0, Math.min(n, 4)).flatMap(([px, py, pw, ph]) =>
        Array.from({ length: ph >= 5 ? 3 : 2 }, (_, r) => {
          const i = k++;
          return (
            <rect key={i} class="tama-type" style={{ animationDelay: `${(-0.37 * i).toFixed(2)}s` }}
                  x={(px + 0.5).toFixed(2)} y={(py + 0.6 + r * 1.1).toFixed(2)} width={((pw - 1) * FRACS[i % 6]).toFixed(2)}
                  height="0.45" fill={LINE_COLORS[i % 4]} />
          );
        }),
      )}
    </g>
  );
}

// ---- 7. every account walled: asleep at the desk until the reset ----------
export function WallScreen({ day, time }) {
  const size = Math.min(3, 7.6 / (0.6 * time.length));
  return (
    <g>
      <Screen fill="#16181d" />
      <Label x="24.1" y="7.9" size="1.3" fill="#a4acb9" weight={500}>{day ? `back ${day}` : "back at"}</Label>
      <Label x="27.5" y="10.9" size={size.toFixed(2)} fill="#f2c14e" anchor="middle">{time}</Label>
      <circle cx="30.85" cy="6.95" r="0.5" fill="#f3e9c6" />
      <circle cx="31.1" cy="6.8" r="0.42" fill="#16181d" />
    </g>
  );
}

export function DeskZs() {
  return (
    <g fill="var(--fg-2)" font-family="var(--mono)" font-weight="700">
      <text class="tama-z" x="17.5" y="8.4" font-size="3">z</text>
      <text class="tama-z tama-z2" x="19.6" y="6" font-size="3.8">Z</text>
    </g>
  );
}

// ---- 8. cleanup: away from the desk, sweeping up merged branches -----------
const Twig = ({ x }) => (
  <path d={`M${x} 19 v-0.9 l-0.6 -0.6 M${x} 18.1 l0.5 -0.7 M${x} 18.6 l0.5 -0.3`} fill="none" stroke="#8b6a4e" stroke-width="0.3" />
);

export function SweepHand() {
  return (
    <g>
      <rect x="25" y="13.3" width="1.5" height="0.9" fill={SKIN} />
      <text class="tama-note" x="25.6" y="8.2" font-size="2.6" font-family="var(--mono)" fill="var(--fg-2)">♪</text>
    </g>
  );
}

export function Broom() {
  return (
    <g>
      <g class="tama-broom" shape-rendering={GEO}>
        <path d="M27.6 8.4 L25.4 17.4" stroke="#b07a4f" stroke-width="0.5" />
        <rect x="24.8" y="16.8" width="1.6" height="0.6" fill="#8b6a4e" />
        <path d="M24.3 17.4 L26.8 17.4 L27.9 19 L23.4 19 Z" fill="#d9b44a" />
        <path d="M24.6 18 L24.3 19 M25.5 18 L25.5 19 M26.4 18 L26.8 19" stroke="#b08a2e" stroke-width="0.2" />
      </g>
      <g fill="#b8a58a" shape-rendering={GEO}>
        <circle class="tama-smoke" cx="28.6" cy="18.4" r="0.5" />
        <circle class="tama-smoke tama-smoke2" cx="29.3" cy="18.2" r="0.45" />
      </g>
      <g shape-rendering={GEO}><Twig x={30.4} /><Twig x={31.6} /><Twig x={32.9} /></g>
    </g>
  );
}

// ---- 9. an update has arrived ---------------------------------------------
export function LookDown({ x0 }) {
  return (
    <g fill={EYE}>
      <rect x={x0 + 5.5} y={Y0 + 2.6} width="1" height="1.6" />
      <rect x={x0 + 12.5} y={Y0 + 2.6} width="1" height="1.6" />
    </g>
  );
}

export function Parcel() {
  return (
    <g class="tama-parcel" shape-rendering={GEO}>
      <rect x="24.6" y="15.6" width="4.8" height="3.4" fill="#c49a6c" />
      <rect x="24.6" y="15.6" width="4.8" height="0.7" fill="#d8b384" />
      <rect x="26.75" y="15.6" width="0.5" height="3.4" fill="#a57c4f" />
      <rect x="28.3" y="14.4" width="2.2" height="1.8" rx="0.25" fill="#52b4ea" />
      <path d="M29.4 14.75 v1 M28.95 15.3 l0.45 0.5 l0.45 -0.5" fill="none" stroke="#ffffff" stroke-width="0.28" />
    </g>
  );
}
