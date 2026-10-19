// Page zoom for the shell — View → Zoom In / Zoom Out / Actual Size on
// ⌘= / ⌘- / ⌘0. A browser tab gets these from the browser; a bare WKWebView
// has no zoom of its own, so in the .app the keys did nothing.
//
// set_zoom is WKWebView.pageZoom: it reflows the layout like Safari's zoom
// rather than magnifying a bitmap, so text and the xterm canvas re-render
// crisp at the new size.
//
// The level lives here, not in the page, because a recycle (recycle.rs)
// destroys the webview and a fresh WKWebView starts back at 1.0 — the rebuild
// calls apply(). Persisted to ~/.config/periscope/zoom so a relaunch keeps it.

use std::sync::Mutex;

use tauri::{Runtime, WebviewWindow};

// Chrome's ladder, trimmed at both ends — below 50% nothing is legible and
// above 300% the rail alone fills the window.
const LEVELS: [f64; 13] = [0.5, 0.67, 0.75, 0.8, 0.9, 1.0, 1.1, 1.25, 1.5, 1.75, 2.0, 2.5, 3.0];

static LEVEL: Mutex<f64> = Mutex::new(1.0);

// Next rung strictly above (dir > 0) or below (dir < 0) `current`, pinned at
// the ends. Strict comparison, not an index, so an off-ladder value (a
// hand-edited zoom file) still steps to its neighbour instead of sticking.
fn step(current: f64, dir: i32) -> f64 {
    const EPS: f64 = 1e-6;
    if dir > 0 {
        LEVELS.iter().copied().find(|&l| l > current + EPS).unwrap_or(LEVELS[LEVELS.len() - 1])
    } else {
        LEVELS.iter().rev().copied().find(|&l| l < current - EPS).unwrap_or(LEVELS[0])
    }
}

fn clamp(level: f64) -> f64 {
    if level.is_finite() {
        level.clamp(LEVELS[0], LEVELS[LEVELS.len() - 1])
    } else {
        1.0
    }
}

fn zoom_path() -> std::path::PathBuf {
    let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".into());
    std::path::PathBuf::from(home).join(".config/periscope/zoom")
}

fn load() -> f64 {
    std::fs::read_to_string(zoom_path())
        .ok()
        .and_then(|s| s.trim().parse().ok())
        .map(clamp)
        .unwrap_or(1.0)
}

fn save(level: f64) {
    let path = zoom_path();
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    let _ = std::fs::write(path, format!("{level}\n"));
}

fn current() -> f64 {
    *LEVEL.lock().unwrap_or_else(|e| e.into_inner())
}

fn set<R: Runtime>(window: &WebviewWindow<R>, level: f64) {
    *LEVEL.lock().unwrap_or_else(|e| e.into_inner()) = level;
    save(level);
    apply(window);
}

// Load the persisted level and apply it to the startup window.
pub fn init<R: Runtime>(window: &WebviewWindow<R>) {
    *LEVEL.lock().unwrap_or_else(|e| e.into_inner()) = load();
    apply(window);
}

// Push the current level onto a (possibly freshly built) webview.
pub fn apply<R: Runtime>(window: &WebviewWindow<R>) {
    let _ = window.set_zoom(current());
}

pub fn zoom_in<R: Runtime>(window: &WebviewWindow<R>) {
    set(window, step(current(), 1));
}

pub fn zoom_out<R: Runtime>(window: &WebviewWindow<R>) {
    set(window, step(current(), -1));
}

pub fn reset<R: Runtime>(window: &WebviewWindow<R>) {
    set(window, 1.0);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn steps_along_the_ladder() {
        assert_eq!(step(1.0, 1), 1.1);
        assert_eq!(step(1.0, -1), 0.9);
        assert_eq!(step(0.67, 1), 0.75);
    }

    #[test]
    fn pins_at_the_ends() {
        assert_eq!(step(3.0, 1), 3.0);
        assert_eq!(step(0.5, -1), 0.5);
    }

    #[test]
    fn off_ladder_values_step_to_a_neighbour() {
        assert_eq!(step(1.15, 1), 1.25);
        assert_eq!(step(1.15, -1), 1.1);
    }

    #[test]
    fn clamp_rejects_junk() {
        assert_eq!(clamp(10.0), 3.0);
        assert_eq!(clamp(0.1), 0.5);
        assert_eq!(clamp(f64::NAN), 1.0);
    }
}
