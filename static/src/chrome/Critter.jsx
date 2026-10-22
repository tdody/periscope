// One critter (critters.js), drawn from its generated sprite tree in its own
// 20×20 units. Motion is the classes in static/critters.css; the caller places
// and scales it (Tamagotchi.jsx in the header, TamaPicker.jsx in Settings).

// A mood layer shows only in its mood. Asleep, an eye or a lid is drawn as its
// `shut` frame, held, and the glint riding on a blinking eye goes away.
function Node({ n, mood, asleep }) {
  if (n.mood && n.mood !== mood) return null;
  if (asleep && n.role === "glint") return null;
  if (n.r) {
    const [x, y, w, h] = n.r;
    return <rect x={x} y={y} width={w} height={h} {...n.a} />;
  }
  if (asleep && n.shut) {
    const [x, y, w, h] = n.shut;
    return <rect data-role="shut" x={x} y={y} width={w} height={h} {...n.g[0].a} />;
  }
  return (
    <g class={n.anim} data-mood={n.mood} data-role={n.role} {...n.a}>
      {n.g.map((c, i) => <Node key={i} n={c} mood={mood} asleep={asleep} />)}
    </g>
  );
}

export function Critter({ sprite, mood = "calm", asleep = false }) {
  return (
    <g class="critter">
      {sprite.root.map((n, i) => <Node key={i} n={n} mood={mood} asleep={asleep} />)}
    </g>
  );
}
