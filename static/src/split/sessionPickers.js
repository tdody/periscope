// Pure pieces of the pane header's model/effort pickers (SessionPickers.jsx).
// The pickers change a RUNNING Claude session by typing `/model x` or
// `/effort x` into it (POST /api/pane/session-setting) — the per-pane
// counterpart of the header pins, which only shape new panes.

import { MODELS } from "../models.js";

// Why the pickers are disabled for this pane, or null when they can act. A
// pre-check from the 3s poll so the control reads honestly; the server
// re-checks against a fresh capture, because keystrokes into a busy pane land
// mid-turn and into a draft get submitted with it.
export function sessionBlocker(w) {
  if (w?.agent !== "claude") return "not a Claude pane";
  if (w.state !== "idle" && w.state !== "done") return `pane is ${w.state || "busy"}, try again when it's idle`;
  if (w.pending_input) return "the pane has unsent text in its input box";
  return null;
}

// What the effort picker shows. Claude reports effort nowhere periscope can
// read, so this is what periscope last set, else the `--effort` the claude
// was launched with, else Claude's own default.
export function effortShown(w) {
  return w?.session_effort || w?.launch_effort || "default";
}

// What the model picker shows: the status line's model is the truth when it
// parses; otherwise what periscope last set; otherwise a bare prompt.
export function modelShown(w) {
  if (w?.model) return w.model.replace(/\s*\(.*\)/, "");
  if (w?.session_model) return MODELS.find((m) => m.id === w.session_model)?.label || w.session_model;
  return "model";
}
