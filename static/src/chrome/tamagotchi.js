// The header's Claude tamagotchi (Tamagotchi.jsx): the pure parts, so the
// day schedule and the sprite unit-test without a clock or a DOM.

// What Claude is up to, by local hour. Each window runs [from, to); every
// boundary is on the hour, so the hour alone decides.
export const SCHEDULE = [
  { from: 0, to: 7, id: "sleep", label: "sleeping" },
  { from: 7, to: 9, id: "coffee", label: "having coffee" },
  { from: 9, to: 12, id: "code", label: "coding" },
  { from: 12, to: 13, id: "eat", label: "having lunch" },
  { from: 13, to: 17, id: "code", label: "coding" },
  { from: 17, to: 18, id: "run", label: "out for a run" },
  { from: 18, to: 19, id: "eat", label: "having dinner" },
  { from: 19, to: 21, id: "read", label: "reading" },
  { from: 21, to: 24, id: "sleep", label: "sleeping" },
];

export function activityAt(date) {
  const h = date.getHours();
  return SCHEDULE.find((s) => h >= s.from && h < s.to);
}

// Milliseconds until the current window ends, so the sprite changes on the
// hour rather than up to a minute late. setHours(24) rolls to next midnight.
export function msUntilNextChange(date) {
  const end = new Date(date);
  end.setHours(activityAt(date).to, 0, 0, 0);
  return end - date;
}

export function hourLabel(h) {
  if (h === 0 || h === 24) return "midnight";
  if (h === 12) return "noon";
  return `${h % 12}${h < 12 ? "am" : "pm"}`;
}

// Clawd, the Claude Code banner mascot, transcribed from its quadrant-block
// art: ▐▛███▜▌ / ▝▜█████▛▘ / ▘▘ ▝▝. One cell per terminal quadrant, which is
// twice as tall as it is wide, so the scene draws each cell 1×2. The eyes
// (the two quadrants ▛ and ▜ leave out of row 1) are drawn separately so they
// can blink and close.
export const BODY = [
  "...############..",
  "...############..",
  ".################",
  "...############..",
];
export const EYES = [5, 12]; // columns, in row 1
// Two stride frames: the banner's stance, and every leg one step inward.
export const LEGS = [
  "....#.#....#.#...",
  ".....#.#..#.#....",
];

// [{x, y}] for every "#" in a grid of strings.
export function gridCells(rows) {
  const cells = [];
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) if (row[x] === "#") cells.push({ x, y });
  });
  return cells;
}
