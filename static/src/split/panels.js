// Navigator (rail) and context column (inspector) visibility. UI prefs, so a
// hidden panel stays hidden across reloads; computed so readers re-render only
// when the boolean flips, not on every prefs write.
//
// The navigator hides by CSS and stays mounted (its scroll position and
// attention-freeze state survive). The context column unmounts, which also
// stops its 1.5s /api/pane poll (Detail.jsx).
import { computed } from "@preact/signals";
import { getPanelHidden, setPanelHidden } from "../prefs.js";

export const railHidden = computed(() => getPanelHidden("rail"));
export const sideHidden = computed(() => getPanelHidden("side"));

export function togglePanel(which) {
  const hidden = which === "rail" ? railHidden.value : sideHidden.value;
  return setPanelHidden(which, !hidden);
}
