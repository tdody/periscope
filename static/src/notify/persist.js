// The notify feed's dedupe state across reloads and webview recycles.
// recycle.rs rebuilds the webview once you've been idle a while, which is
// exactly when banners matter; a fresh sentinel would swallow whatever arrived
// across the rebuild. So the state is saved after every pass and resumed when
// young enough. Older than RESUME_MS (a reload after a long absence), it's
// dropped and the feed reseeds, so old news never replays.

export const STORAGE_KEY = "periscope.notify.v1";
export const RESUME_MS = 15 * 60 * 1000;

export function resumeState(storage, nowMs) {
  try {
    const saved = JSON.parse(storage?.getItem(STORAGE_KEY) || "null");
    if (!saved?.state || !(saved.at <= nowMs) || nowMs - saved.at > RESUME_MS) return null;
    return saved.state;
  } catch {
    return null;
  }
}

export function saveState(storage, state, nowMs) {
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify({ at: nowMs, state }));
  } catch {
    // Private mode or a full quota: the next boot just reseeds.
  }
}
