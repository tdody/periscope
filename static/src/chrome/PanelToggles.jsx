// Filter-bar toggles for the two side panels, VS Code style: a little window
// icon with the panel's strip filled while it's shown. ⌘B / ⌥⌘B do the same
// (keys.js). State lives in split/panels.js.
import { railHidden, sideHidden, togglePanel } from "../split/panels.js";

function PanelIcon({ side, shown }) {
  return (
    <svg width="16" height="12" viewBox="0 0 16 12" aria-hidden="true">
      <rect x="0.5" y="0.5" width="15" height="11" rx="1.5" fill="none" stroke="currentColor" />
      <rect
        x={side === "left" ? 2 : 10}
        y="2"
        width="4"
        height="8"
        rx="0.5"
        fill={shown ? "currentColor" : "none"}
        stroke="currentColor"
        stroke-width="0.75"
      />
    </svg>
  );
}

export function PanelToggles() {
  const rail = !railHidden.value;
  const side = !sideHidden.value;
  return (
    <span class="panel-toggles">
      <button
        type="button"
        class="filter-btn is-action panel-toggle"
        aria-pressed={rail}
        title={`${rail ? "Hide" : "Show"} the navigator (⌘B)`}
        onClick={() => togglePanel("rail")}
      >
        <PanelIcon side="left" shown={rail} />
      </button>
      <button
        type="button"
        class="filter-btn is-action panel-toggle"
        aria-pressed={side}
        title={`${side ? "Hide" : "Show"} the context column (⌥⌘B)`}
        onClick={() => togglePanel("side")}
      >
        <PanelIcon side="right" shown={side} />
      </button>
    </span>
  );
}
