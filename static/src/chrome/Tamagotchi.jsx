// Easter egg in the header's top-right corner: Clawd, the Claude Code banner
// mascot, living its day on the local clock: asleep, coffee, coding, lunch,
// a run, dinner, a book (tamagotchi.js has the schedule). Click it to pet it.
//
// Pure pixel art: a 34×24 scene where each sprite cell is 1×2 (the banner's
// terminal quadrants are twice as tall as wide), drawn with crisp-edged
// rects. All motion is CSS (styles.css, `.tama`) and switches off under
// prefers-reduced-motion.
import { useEffect, useState } from "preact/hooks";
import { activityAt, BODY, EYES, gridCells, hourLabel, LEGS, msUntilNextChange } from "./tamagotchi.js";

const X0 = 8; // the mascot's left edge, in scene units
const Y0 = 9; // its top row; each sprite row is 2 units tall
const SKIN = "#d97757";
const EYE = "#2b1d16";

function Cells({ rows, cls }) {
  return (
    <g class={cls}>
      {gridCells(rows).map(({ x, y }) => (
        <rect key={`${x},${y}`} x={X0 + x} y={Y0 + 2 * y} width="1.02" height="2.02" fill={SKIN} />
      ))}
    </g>
  );
}

function Eyes({ closed }) {
  return (
    <g class={closed ? "tama-eyes-closed" : "tama-eyes"}>
      {EYES.map((x) => (
        <rect key={x} x={X0 + x} y={closed ? Y0 + 3.3 : Y0 + 2} width="1" height={closed ? 0.5 : 2} fill={EYE} />
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
      return (
        <g>
          <rect x="0.8" y="12.4" width="6.2" height="5.6" rx="0.4" fill="#1d2026" stroke="var(--fg-3)" stroke-width="0.3" />
          <rect x="1.8" y="13.8" width="3" height="0.6" fill="var(--accent)" />
          <rect x="1.8" y="15.2" width="2" height="0.6" fill="#7fbf7f" />
          <rect class="tama-cursor" x="4.2" y="15.2" width="0.6" height="0.6" fill="#e6e9ef" />
          <rect x="0" y="18.1" width="8.6" height="0.9" rx="0.3" fill="var(--fg-3)" />
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
  return (
    <g>
      <rect x="10.5" y="13" width="6.5" height="5" fill="#f2ece0" />
      <rect x="17" y="13" width="6.5" height="5" fill="#ebe3d3" />
      <g fill="#c9bfae">
        <rect x="11.4" y="14.3" width="4.6" height="0.4" />
        <rect x="11.4" y="15.5" width="4" height="0.4" />
        <rect x="11.4" y="16.7" width="4.6" height="0.4" />
        <rect x="17.9" y="14.3" width="4.6" height="0.4" />
        <rect x="17.9" y="15.5" width="3.6" height="0.4" />
      </g>
      <rect class="tama-page" x="17" y="13" width="6.5" height="5" fill="#f6f1e6" />
      <rect x="16.8" y="13" width="0.4" height="5" fill="#b9ae9b" />
    </g>
  );
}

export function TamaScene({ activity, petted = false, petKey = 0 }) {
  return (
    <svg viewBox="0 0 34 24" shape-rendering="crispEdges" aria-hidden="true" data-activity={activity}>
      <rect x="0" y="19" width="34" height="0.4" fill="var(--line)" />
      <Behind activity={activity} />
      <g key={petKey} class={`tama-creature${petted ? " tama-hop" : ""}`}>
        <Cells rows={BODY} cls="tama-body" />
        <Eyes closed={activity === "sleep"} />
        <Cells rows={[...BODY.map(() => ""), LEGS[0]]} cls="tama-legs-a" />
        {activity === "run" && <Cells rows={[...BODY.map(() => ""), LEGS[1]]} cls="tama-legs-b" />}
      </g>
      <InFront activity={activity} />
      {petted && (
        <path key={`heart-${petKey}`} class="tama-heart" fill="#e8657a" shape-rendering="geometricPrecision"
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
