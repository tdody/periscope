// Easter egg in the header's top-right corner: Clawd, the Claude Code banner
// mascot, living its day on the local clock: asleep, coffee, coding, lunch,
// a run, dinner, a book (tamagotchi.js has the schedule). Click it to pet it.
//
// Coding happens at a desk and reading in an armchair by the fireplace; the
// rest are standing poses with a prop.
//
// Pure pixel art: a 34×24 scene where each sprite cell is 1×2 (the banner's
// terminal quadrants are twice as tall as wide), drawn with crisp-edged
// rects. All motion is CSS (styles.css, `.tama`) and switches off under
// prefers-reduced-motion.
import { useEffect, useState } from "preact/hooks";
import { activityAt, BODY, EYES, gridCells, hourLabel, LEGS, msUntilNextChange } from "./tamagotchi.js";

const Y0 = 9; // the mascot's top row; each sprite row is 2 units tall
const SKIN = "#d97757";
const EYE = "#2b1d16";

// Where the mascot stands per activity: centred on its feet by default; the
// two sitting scenes shift it left to make room for the desk / fireplace, and
// tuck its legs out of sight.
const POSES = { code: { x0: 3, sitting: true }, read: { x0: 4, sitting: true } };
const STANDING = { x0: 8, sitting: false };

function Cells({ rows, cls, x0 }) {
  return (
    <g class={cls}>
      {gridCells(rows).map(({ x, y }) => (
        <rect key={`${x},${y}`} x={x0 + x} y={Y0 + 2 * y} width="1.02" height="2.02" fill={SKIN} />
      ))}
    </g>
  );
}

function Eyes({ closed, x0 }) {
  return (
    <g class={closed ? "tama-eyes-closed" : "tama-eyes"}>
      {EYES.map((x) => (
        <rect key={x} x={x0 + x} y={closed ? Y0 + 3.3 : Y0 + 2} width="1" height={closed ? 0.5 : 2} fill={EYE} />
      ))}
    </g>
  );
}

// What sits beside (behind) and in front of the mascot for each activity.
function Behind({ activity }) {
  switch (activity) {
    case "sleep":
      return (
        <g fill="var(--fg-2)" font-family="var(--mono)" font-weight="700">
          <text class="tama-z" x="26" y="10" font-size="4">z</text>
          <text class="tama-z tama-z2" x="29" y="7" font-size="5">Z</text>
        </g>
      );
    case "coffee":
      return (
        <g>
          <g fill="#efe6d8">
            <rect x="25.5" y="12" width="3.4" height="4.6" rx="0.4" />
            <rect x="28.9" y="12.9" width="1.2" height="0.6" />
            <rect x="29.5" y="12.9" width="0.6" height="2.6" />
            <rect x="28.9" y="14.9" width="1.2" height="0.6" />
          </g>
          <rect x="25.5" y="12" width="3.4" height="0.9" fill="#7a4e2d" />
          <rect class="tama-steam" x="26.4" y="8.6" width="0.6" height="2" fill="var(--fg-3)" />
          <rect class="tama-steam tama-steam2" x="27.7" y="7.8" width="0.6" height="2" fill="var(--fg-3)" />
        </g>
      );
    case "code":
      // Office chair under the mascot, a desk with a monitor in front of it.
      return (
        <g>
          <g class="tama-chair" fill="#4c525c">
            <rect x="1.6" y="9.6" width="1.6" height="8.4" rx="0.5" />
            <rect x="3.2" y="16.9" width="15" height="1.3" rx="0.4" />
            <rect x="10" y="18.2" width="1.2" height="0.8" />
            <rect x="7" y="18.6" width="7.2" height="0.5" rx="0.25" />
          </g>
          <g class="tama-desk">
            <rect x="20.2" y="13.2" width="13.6" height="0.9" fill="#8b6a4e" />
            <rect x="21" y="14.1" width="0.9" height="4.9" fill="#6f533c" />
            <rect x="32.2" y="14.1" width="0.9" height="4.9" fill="#6f533c" />
            <rect x="26.9" y="12" width="1.2" height="1.2" fill="var(--fg-3)" />
            <rect x="23" y="5.6" width="9" height="6.4" rx="0.4" fill="#1d2026" stroke="var(--fg-3)" stroke-width="0.3" />
            <rect x="24" y="7" width="4.4" height="0.6" fill="var(--accent)" />
            <rect x="24" y="8.4" width="3" height="0.6" fill="#7fbf7f" />
            <rect x="24.8" y="9.8" width="3.4" height="0.6" fill="#c792ea" />
            <rect class="tama-cursor" x="28.6" y="9.8" width="0.6" height="0.6" fill="#e6e9ef" />
            <rect x="20.4" y="12.6" width="4.2" height="0.6" rx="0.2" fill="#c9ced6" />
          </g>
        </g>
      );
    case "read":
      // Armchair on the left, a fireplace on the right throwing a warm glow.
      return (
        <g>
          <ellipse class="tama-glow" cx="28" cy="19" rx="9" ry="2.4" fill="#f0a24a" opacity="0.18" />
          <g class="tama-fire">
            <rect x="23.4" y="6" width="10.6" height="1.1" fill="#8a7a6a" />
            <rect x="24.2" y="7.1" width="9.8" height="11.9" fill="#7b4a3a" />
            <g fill="#6a3e30">
              <rect x="24.2" y="9.4" width="9.8" height="0.3" />
              <rect x="24.2" y="11.8" width="9.8" height="0.3" />
              <rect x="24.2" y="14.2" width="9.8" height="0.3" />
              <rect x="24.2" y="16.6" width="9.8" height="0.3" />
            </g>
            <rect x="25.8" y="11" width="6.6" height="8" rx="2.4" fill="#1a1110" />
            <path class="tama-flame" d="M27.2 19 q-0.6 -2.6 1 -4.4 q0.2 1.6 1 2.2 q0.4 -1.4 1.4 -2.4 q1 2.6 0.2 4.6z" fill="#f08a3c" />
            <path class="tama-flame tama-flame2" d="M28 19 q-0.2 -1.6 0.9 -2.8 q0.3 1.1 0.9 1.4 q0.5 -0.8 0.6 -1.4 q0.9 1.6 0.2 2.8z" fill="#ffd166" />
            <rect x="26.6" y="18.4" width="5" height="0.6" rx="0.3" fill="#5a3a26" />
          </g>
          <g class="tama-chair" fill="#8e3b3b">
            <rect x="1" y="8.6" width="3.2" height="10.4" rx="1" />
            <rect x="3.6" y="16.8" width="16.8" height="2.2" rx="0.6" />
          </g>
        </g>
      );
    case "eat":
      return (
        <g>
          <line x1="29.2" y1="10.4" x2="28.1" y2="15.6" stroke="#b07a4f" stroke-width="0.45" />
          <line x1="30.4" y1="10.7" x2="29" y2="15.6" stroke="#b07a4f" stroke-width="0.45" />
          <rect x="26.8" y="15.3" width="4.9" height="1.5" rx="0.7" fill="#f8f4ea" />
          <rect x="26" y="16.2" width="6.5" height="2.8" rx="1.2" fill="#e8e2d4" />
          <rect class="tama-steam" x="31.6" y="12.2" width="0.5" height="1.6" fill="var(--fg-3)" />
        </g>
      );
    case "run":
      return (
        <g>
          <g class="tama-motion" fill="var(--fg-3)">
            <rect x="1" y="10.6" width="4" height="0.5" />
            <rect x="2.4" y="13.6" width="3.6" height="0.5" />
            <rect x="0.6" y="16.6" width="4.6" height="0.5" />
          </g>
          <path class="tama-sweat" d="M27 8.4 q1.1 1.7 0 2.5 q-1.1 -0.8 0 -2.5z" fill="#7fb6e6" />
        </g>
      );
    default:
      return null;
  }
}

function InFront({ activity }) {
  if (activity !== "read") return null;
  // The armchair's arm, then the open book held up toward the fire.
  return (
    <g>
      <rect class="tama-chair" x="17.4" y="13.6" width="3.6" height="5.4" rx="0.8" fill="#7a3030" />
      <g class="tama-book">
        <rect x="17.4" y="10.6" width="2.9" height="3.4" fill="#f2ece0" />
        <rect x="20.3" y="10.6" width="2.9" height="3.4" fill="#ebe3d3" />
        <g fill="#c9bfae">
          <rect x="17.9" y="11.4" width="1.9" height="0.3" />
          <rect x="17.9" y="12.3" width="1.6" height="0.3" />
          <rect x="20.8" y="11.4" width="1.9" height="0.3" />
          <rect x="20.8" y="12.3" width="1.5" height="0.3" />
        </g>
        <rect class="tama-page" x="20.3" y="10.6" width="2.9" height="3.4" fill="#f6f1e6" />
        <rect x="20.15" y="10.6" width="0.3" height="3.4" fill="#b9ae9b" />
      </g>
    </g>
  );
}

export function TamaScene({ activity, petted = false, petKey = 0 }) {
  const { x0, sitting } = POSES[activity] || STANDING;
  const legRows = (frame) => [...BODY.map(() => ""), frame];
  return (
    <svg viewBox="0 0 34 24" shape-rendering="crispEdges" aria-hidden="true" data-activity={activity}>
      <rect x="0" y="19" width="34" height="0.4" fill="var(--line)" />
      <Behind activity={activity} />
      <g key={petKey} class={`tama-creature${petted ? " tama-hop" : ""}`}>
        <Cells rows={BODY} cls="tama-body" x0={x0} />
        <Eyes closed={activity === "sleep"} x0={x0} />
        {!sitting && <Cells rows={legRows(LEGS[0])} cls="tama-legs-a" x0={x0} />}
        {activity === "run" && <Cells rows={legRows(LEGS[1])} cls="tama-legs-b" x0={x0} />}
      </g>
      <InFront activity={activity} />
      {petted && (
        <path key={`heart-${petKey}`} class="tama-heart" fill="#e8657a" shape-rendering="geometricPrecision"
              transform={`translate(${x0 - 8} 0)`}
              d="M17 7.2 l-2.3 -2.3 a1.25 1.25 0 0 1 2.3 -1.7 a1.25 1.25 0 0 1 2.3 1.7z" />
      )}
    </svg>
  );
}

export function Tamagotchi() {
  const [now, setNow] = useState(() => new Date());
  const [pets, setPets] = useState(0);
  const [petted, setPetted] = useState(false);

  // Wake when the current window ends, plus a minute tick as a backstop for a
  // laptop that slept through the boundary.
  useEffect(() => {
    const tick = () => setNow(new Date());
    const t = setTimeout(tick, msUntilNextChange(now) + 50);
    const i = setInterval(tick, 60_000);
    return () => { clearTimeout(t); clearInterval(i); };
  }, [now]);

  useEffect(() => {
    if (!petted) return;
    const t = setTimeout(() => setPetted(false), 900);
    return () => clearTimeout(t);
  }, [petted, pets]);

  const a = activityAt(now);
  const label = `Claude is ${a.label} (${hourLabel(a.from)}–${hourLabel(a.to)})`;
  return (
    <button
      type="button"
      class="tama"
      title={label}
      aria-label={label}
      onClick={() => { setPets((n) => n + 1); setPetted(true); }}
    >
      <TamaScene activity={a.id} petted={petted} petKey={pets} />
    </button>
  );
}
