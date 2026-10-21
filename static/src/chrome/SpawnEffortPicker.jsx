// Header segmented control pinning the reasoning effort new Claude panes
// launch at — the third spawn pin, under account and model. "default" sets
// nothing: Claude picks per model and settings.json, and /effort keeps working
// in the pane. A level is set as CLAUDE_CODE_EFFORT_LEVEL on every unnamed
// spawn (launcher New Tab, unified open, MCP spawn_claude) through
// usage.choose_launch — and while that var is set Claude refuses /effort for
// the pane's whole session, so the hover says so instead of letting it
// surprise.
//
// A server setting (settings.spawn_effort), not a client pref, for the account
// pin's reason: MCP spawns never see client prefs. Rides /api/state as
// `spawn_effort` (null = unset = default); writes optimistically and lets the
// poll confirm, like SpawnModelPicker. Reuses the account picker's classes —
// same chrome, same table.
import { spawnEffort } from "../store.js";
import { apiCall } from "../util.js";

// "default" + config.EFFORT_LEVELS — the server rejects anything else.
export const PIN_EFFORTS = ["default", "low", "medium", "high", "xhigh", "max"];

async function pick(id) {
  const prev = spawnEffort.value;
  spawnEffort.value = id; // optimistic; the poll carries the persisted value
  const res = await apiCall("spawn effort", "/api/settings", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ spawn_effort: id }),
  });
  if (!res) spawnEffort.value = prev;
}

export function SpawnEffortPicker() {
  const cur = spawnEffort.value || "default";
  return (
    <div
      class="spawn-acct spawn-effort"
      title={
        "reasoning effort new Claude panes launch at\n" +
        "default — Claude's own choice for the model; /effort works in the pane\n" +
        "low … max — pin every spawn (New Tab, + new, spawned workers); those panes ignore /effort for their whole session"
      }
    >
      <span class="spawn-acct-label">effort</span>
      {PIN_EFFORTS.map((id) => (
        <button
          type="button"
          key={id}
          class={`spawn-acct-btn${cur === id ? " is-active" : ""}`}
          onClick={() => pick(id)}
        >
          {id}
        </button>
      ))}
    </div>
  );
}
