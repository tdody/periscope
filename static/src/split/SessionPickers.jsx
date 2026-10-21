// The pane header's model and effort pickers: change THIS running session by
// typing `/model x` or `/effort x` into it. The header pins only shape new
// panes; this is how a pane that's already running gets changed.
//
// Native <select>s whose hidden first option carries the current label: the
// value is always "", so the control shows what the session is on, and picking
// an option fires one request and snaps back. A pick shows at once only when
// Claude confirmed it applied; a model switch Claude wants confirmed in the
// pane (history gets re-read at the new model's cost) is left to the user.
import { useEffect, useState } from "preact/hooks";
import { PIN_EFFORTS } from "../chrome/SpawnEffortPicker.jsx";
import { MODELS } from "../models.js";
import { showToast } from "../overlays/Toast.jsx";
import { apiCall } from "../util.js";
import { effortShown, modelShown, sessionBlocker } from "./sessionPickers.js";

export function SessionPickers({ w }) {
  const [picked, setPicked] = useState({});
  // The poll's idle state would re-enable the selects while a request is still
  // reading the pane back (up to 3s), and a second pick would type into a pane
  // mid-way through the first command.
  const [inflight, setInflight] = useState(false);
  // A poll carrying the server's value, or a different pane, supersedes a local pick.
  useEffect(() => { setPicked({}); }, [w.pid, w.session_model, w.session_effort]);
  const blocker = inflight ? "waiting for the pane to confirm the last change" : sessionBlocker(w);

  async function apply(setting, e) {
    const value = e.currentTarget.value;
    e.currentTarget.value = ""; // snap back even when the request fails
    if (!value || inflight) return;
    const q = `pid=${encodeURIComponent(w.pid)}&setting=${setting}&value=${encodeURIComponent(value)}`;
    setInflight(true);
    let res;
    try {
      res = await apiCall(`set ${setting}`, `/api/pane/session-setting?${q}`, { method: "POST" });
    } finally {
      setInflight(false);
    }
    if (!res) return; // busy pane, draft, or Claude refused: apiCall toasted the reason
    if (res.result === "applied") setPicked((p) => ({ ...p, [setting]: value }));
    else if (res.result === "confirm") {
      showToast("Claude is asking to confirm the model switch in the pane — answer it there", "info", 7000);
    } else showToast(`Sent ${res.sent}, but Claude didn't confirm it took`, "info", 5000);
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
