// Settings → Fonts: the faces the dashboard can wear. `stack` is what the
// stylesheet's --sans / --mono resolve to (main.jsx sets them from the pick)
// and what xterm is handed; `face` is the name document.fonts.load() waits on
// before the terminal re-measures its cell. Every webfont here is in
// styles.css's Google Fonts import — a face downloads only once text uses it.
// The UI list is the whole list: mono-everywhere is a pick, not a stylesheet
// edit. routes/prefs.py validates against these ids (a test keeps them in step).
export const FONTS = [
  { id: "hanken", name: "Hanken Grotesk", face: "Hanken Grotesk", stack: "'Hanken Grotesk', -apple-system, system-ui, sans-serif" },
  { id: "inter", name: "Inter", face: "Inter", stack: "'Inter', -apple-system, system-ui, sans-serif" },
  { id: "system-sans", name: "System sans", face: "system-ui", stack: "-apple-system, system-ui, sans-serif" },
  { id: "plex-mono", name: "IBM Plex Mono", face: "IBM Plex Mono", mono: true, stack: "'IBM Plex Mono', ui-monospace, 'JetBrains Mono', Menlo, monospace" },
  { id: "jetbrains-mono", name: "JetBrains Mono", face: "JetBrains Mono", mono: true, stack: "'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, monospace" },
  { id: "sf-mono", name: "SF Mono", face: "SF Mono", mono: true, stack: "'SF Mono', ui-monospace, Menlo, monospace" },
  { id: "menlo", name: "Menlo", face: "Menlo", mono: true, stack: "Menlo, Monaco, monospace" },
];

// What each slot wears until Settings says otherwise: the stylesheet's own defaults.
export const DEFAULT_FONT = { ui: "hanken", code: "plex-mono" };

export function fontById(id, which) {
  return FONTS.find((f) => f.id === id) || FONTS.find((f) => f.id === DEFAULT_FONT[which]);
}
