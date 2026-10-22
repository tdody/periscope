// Settings → Notifications: which native macOS banners fire (notify/feed.js).
// Each toggle saves on change, like the Tamagotchi picker. The banners come
// from the Periscope app only, so a browser tab says so instead of offering
// switches that would do nothing visible there.
import { getNotifyPrefs, setNotifyPref } from "../prefs.js";
import { inTauri } from "../tauri.js";

export const NOTIFY_OPTIONS = [
  ["needs_input", "A session needs input"],
  ["done", "A session finishes"],
  ["ci_failed", "CI fails on a session's PR"],
  ["pr_merged", "A linked PR merges"],
  ["usage", "Usage projected past a limit"],
  ["quiet_when_focused", "Stay quiet while the dashboard is focused"],
  ["group", "Group when more than 2 arrive at once"],
  ["badge", "Dock badge counts sessions waiting on you"],
];

export function NotifySettings() {
  const prefs = getNotifyPrefs();
  return (
    <fieldset class="notify-settings">
      <legend>Notifications</legend>
      {!inTauri() && <p class="settings-overrides-hint">Notifications appear in the Periscope macOS app only.</p>}
      {NOTIFY_OPTIONS.map(([key, label]) => (
        <label key={key} class="notify-option">
          <input type="checkbox" name={`notify-${key}`} checked={prefs[key]}
                 onChange={(e) => setNotifyPref(key, e.currentTarget.checked)} />
          {label}
        </label>
      ))}
    </fieldset>
  );
}
