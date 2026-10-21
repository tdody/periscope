// The pane header's model and effort pickers: change THIS running session by
// typing `/model x` or `/effort x` into it. The header pins only shape new
// panes; this is how a pane that's already running gets changed.
//
// Native <select>s whose hidden first option carries the current label: the
// value is always "", so the control shows what the session is on, and picking
// an option fires one request and snaps back. A successful pick shows at once
// until the next poll brings the server's remembered value.
import { useEffect, useState } from "preact/hooks";
import { PIN_EFFORTS } from "../chrome/SpawnEffortPicker.jsx";
import { MODELS } from "../models.js";
import { apiCall } from "../util.js";
import { effortShown, modelShown, sessionBlocker } from "./sessionPickers.js";

export function SessionPickers({ w }) {
  const [picked, setPicked] = useState({});
  // A poll carrying the server's value, or a different pane, supersedes a local pick.
  useEffect(() => { setPicked({}); }, [w.pid, w.session_model, w.session_effort]);
  const blocker = sessionBlocker(w);

  async function apply(setting, e) {
    const value = e.currentTarget.value;
    e.currentTarget.value = ""; // snap back even when the request fails
    if (!value) return;
    const q = `pid=${encodeURIComponent(w.pid)}&setting=${setting}&value=${encodeURIComponent(value)}`;
    const res = await apiCall(`set ${setting}`, `/api/pane/session-setting?${q}`, { method: "POST" });
    if (res) setPicked((p) => ({ ...p, [setting]: value }));
  }

  const modelLabel = picked.model
    ? MODELS.find((m) => m.id === picked.model)?.label || picked.model
    : modelShown(w);
  const effortLabel = picked.effort || effortShown(w);
  return (
    <span class="header-session-picks">
      <select
        class="header-session-pick"
        value=""
        disabled={!!blocker}
        title={blocker || "change this session's model (types /model into the pane)"}
        onChange={(e) => apply("model", e)}
      >
        <option value="" hidden>{modelLabel}</option>
        {MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
      </select>
      <select
        class="header-session-pick"
        value=""
        disabled={!!blocker}
        title={blocker || "change this session's effort (types /effort into the pane)"}
        onChange={(e) => apply("effort", e)}
      >
        <option value="" hidden>{`effort ${effortLabel}`}</option>
        {PIN_EFFORTS.map((id) => <option key={id} value={id}>{id}</option>)}
      </select>
    </span>
  );
}
