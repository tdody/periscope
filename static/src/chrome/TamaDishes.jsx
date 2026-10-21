// The meals (tamagotchi.MEALS / BRUNCH, and the occasion and season
// specials): one dish beside Clawd, standing at x0 8, on the floor at y 19 —
// every dish keeps to x 25.4–34 so it clears Clawd's arms.

const GEO = "geometricPrecision";

export function Steam({ x, y }) {
  return (
    <g fill="var(--fg-3)">
      <rect class="tama-steam" x={x} y={y} width="0.5" height="1.6" />
      <rect class="tama-steam tama-steam2" x={x + 1.2} y={y - 0.6} width="0.5" height="1.6" />
    </g>
  );
}

function Plate({ y = 18.2 }) {
  return <rect x="25.8" y={y} width="7.6" height="0.8" rx="0.4" fill="#e8e2d4" />;
}

const DISHES = {
  ramen: () => (
    <g>
      <line x1="29.2" y1="10.4" x2="28.1" y2="15.6" stroke="#b07a4f" stroke-width="0.45" />
      <line x1="30.4" y1="10.7" x2="29" y2="15.6" stroke="#b07a4f" stroke-width="0.45" />
      <rect x="26.8" y="15.3" width="4.9" height="1.5" rx="0.7" fill="#f8f4ea" />
      <rect x="26" y="16.2" width="6.5" height="2.8" rx="1.2" fill="#e8e2d4" />
      <rect class="tama-steam" x="31.6" y="12.2" width="0.5" height="1.6" fill="var(--fg-3)" />
    </g>
  ),
  pizza: () => (
    <g>
      <rect x="26" y="12" width="7.4" height="5.4" fill="#d8b384" />
      <rect x="26.5" y="12.5" width="6.4" height="4.4" fill="#c9a06b" />
      <rect x="25.6" y="17.2" width="8.2" height="1.8" fill="#c49a6c" />
      <ellipse cx="29.7" cy="17.3" rx="3.6" ry="1.1" fill="#e0a94a" />
      <ellipse cx="29.7" cy="17.3" rx="3" ry="0.8" fill="#f2c94c" />
      <path d="M29.7 17.3 L33.4 17.1 L32.6 18.2 Z" fill="#c49a6c" />
      <g fill="#c0392b">
        <circle cx="28" cy="17.2" r="0.35" />
        <circle cx="29.6" cy="16.9" r="0.35" />
        <circle cx="29.2" cy="17.7" r="0.35" />
        <circle cx="31" cy="16.9" r="0.3" />
      </g>
      <Steam x={28.6} y={13.6} />
    </g>
  ),
  burger: () => (
    <g>
      <Plate />
      <rect x="27" y="17.2" width="5" height="1" rx="0.4" fill="#d9913f" />
      <rect x="26.8" y="16.2" width="5.4" height="1.1" rx="0.5" fill="#6b3a22" />
      <path d="M26.9 15.8 H32.1 V16.3 H29.2 L28.6 17 L28 16.3 H26.9 Z" fill="#f2c94c" />
      <rect x="27.1" y="15.3" width="4.8" height="0.5" fill="#e05252" />
      <rect x="26.7" y="14.9" width="5.6" height="0.5" rx="0.25" fill="#6fae5a" />
      <path d="M26.9 15 Q26.9 12.4 29.5 12.4 Q32.1 12.4 32.1 15 Z" fill="#e0a04a" />
      <g fill="#f8f0d8">
        <rect x="28.2" y="13.4" width="0.4" height="0.25" />
        <rect x="29.6" y="13" width="0.4" height="0.25" />
        <rect x="30.8" y="13.6" width="0.4" height="0.25" />
      </g>
    </g>
  ),
  sushi: () => (
    <g>
      <rect x="25.4" y="17.4" width="8.4" height="0.9" fill="#c8955c" />
      <g fill="#a5743f">
        <rect x="26.2" y="18.3" width="0.8" height="0.7" />
        <rect x="32.2" y="18.3" width="0.8" height="0.7" />
      </g>
      {[[26, "#f28c6b"], [28.7, "#d64550"]].map(([x, fish]) => (
        <g key={x}>
          <rect x={x} y="16.2" width="2.4" height="1.2" rx="0.5" fill="#f6f3ec" />
          <rect x={x - 0.2} y="15.5" width="2.8" height="0.9" rx="0.45" fill={fish} />
          <rect x={x + 0.7} y="15.6" width="0.15" height="0.7" fill="#fbd0c0" opacity="0.8" />
          <rect x={x + 1.5} y="15.6" width="0.15" height="0.7" fill="#fbd0c0" opacity="0.8" />
        </g>
      ))}
      <rect x="31.4" y="15.6" width="1.9" height="1.8" rx="0.3" fill="#1f2a1f" />
      <rect x="31.7" y="15.9" width="1.3" height="1.2" fill="#f6f3ec" />
      <rect x="32.1" y="16.25" width="0.5" height="0.5" fill="#f28c6b" />
    </g>
  ),
  tacos: () => (
    <g>
      <Plate />
      {[26, 29.8].map((x) => (
        <g key={x}>
          <rect x={x + 0.2} y="14.6" width="3.2" height="0.9" rx="0.4" fill="#6fae5a" />
          <rect x={x + 0.3} y="15.2" width="3" height="0.5" fill="#8a4b2a" />
          <rect x={x + 0.7} y="14.4" width="0.6" height="0.6" fill="#e05252" />
          <rect x={x + 2.3} y="14.3" width="0.6" height="0.6" fill="#e05252" />
          <path d={`M${x} 15.4 h3.6 a1.8 2.6 0 0 1 -3.6 0 z`} fill="#e8b84a" />
        </g>
      ))}
    </g>
  ),
  pasta: () => (
    <g>
      <line x1="31.4" y1="15.6" x2="33" y2="11.8" stroke="#c9ced6" stroke-width="0.35" />
      <rect x="25.8" y="17.6" width="7.6" height="1.2" rx="0.6" fill="#f8f4ea" />
      <rect x="26.6" y="18.4" width="6" height="0.6" fill="#e8e2d4" />
      <path d="M26.6 17.8 Q27 14.6 29.6 14.6 Q32.2 14.6 32.6 17.8 Z" fill="#f2d27a" />
      <g fill="none" stroke="#d9b45a" stroke-width="0.25">
        <path d="M27.4 17.1 q0.6 -0.7 1.2 0 t1.2 0 t1.2 0 t1.2 0" />
        <path d="M27.9 16.2 q0.6 -0.7 1.2 0 t1.2 0 t1.2 0" />
      </g>
      <path d="M28 15.4 Q29.6 14 31.2 15.4 Q29.6 16.2 28 15.4 Z" fill="#c0392b" />
      <circle cx="28.9" cy="15" r="0.55" fill="#6b3a22" />
      <circle cx="30.3" cy="14.9" r="0.55" fill="#6b3a22" />
      <Steam x={27.6} y={11.6} />
    </g>
  ),
  salad: () => (
    <g>
      <line x1="31.8" y1="15.8" x2="33.2" y2="11.8" stroke="#c9ced6" stroke-width="0.35" />
      <ellipse cx="27.8" cy="15.6" rx="1.4" ry="1" fill="#4f9a46" />
      <ellipse cx="29.6" cy="15.1" rx="1.5" ry="1.1" fill="#6fae5a" />
      <ellipse cx="31.4" cy="15.6" rx="1.3" ry="0.9" fill="#9be38f" />
      <circle cx="28.6" cy="15.2" r="0.45" fill="#e05252" />
      <circle cx="30.9" cy="15.4" r="0.45" fill="#e05252" />
      <rect x="29.4" y="14.3" width="0.4" height="1.2" fill="#ef8a2c" />
      <path d="M26 16 h7.2 q-0.4 3 -3.6 3 q-3.2 0 -3.6 -3 z" fill="#b07a4f" />
      <rect x="25.8" y="15.8" width="7.6" height="0.5" rx="0.25" fill="#9a6a43" />
    </g>
  ),
  // Winter only.
  soup: () => (
    <g>
      <line x1="31.4" y1="15.8" x2="33.4" y2="12.4" stroke="#c9ced6" stroke-width="0.35" />
      <path d="M26 15.6 h7 q-0.4 3.4 -3.5 3.4 q-3.1 0 -3.5 -3.4 z" fill="#e8e2d4" />
      <ellipse cx="29.5" cy="15.7" rx="3.4" ry="0.55" fill="#d9622b" />
      <g fill="#e8b84a">
        <rect x="28" y="15.4" width="0.6" height="0.4" />
        <rect x="30.2" y="15.6" width="0.6" height="0.4" />
      </g>
      <rect x="25.6" y="18.4" width="7.8" height="0.6" rx="0.3" fill="#d4ccbd" />
      <Steam x={28.2} y={12.4} />
    </g>
  ),
  // The year-end dinner.
  roast: () => (
    <g>
      <ellipse cx="29.6" cy="18.4" rx="4.1" ry="0.7" fill="#e8e2d4" />
      <g fill="#4f9a46">
        <circle cx="26" cy="18.1" r="0.4" />
        <circle cx="33.2" cy="18.1" r="0.4" />
      </g>
      <path d="M26.6 18.2 Q26.4 14.6 29.6 14.4 Q32.8 14.6 32.6 18.2 Z" fill="#b5733a" />
      <ellipse cx="29" cy="15.6" rx="1.6" ry="0.7" fill="#d9913f" />
      {[[26.9, 25.9], [32.3, 33.3]].map(([x, tip]) => (
        <g key={x}>
          <ellipse cx={x} cy="16.8" rx="1" ry="0.7" fill="#a5642e" />
          <circle cx={tip} cy="16.3" r="0.4" fill="#f4efe6" />
        </g>
      ))}
      <Steam x={28.4} y={11.4} />
    </g>
  ),
  // Summer's dessert: a sundae.
  icecream: () => (
    <g>
      <rect x="27.8" y="18.4" width="3.4" height="0.6" rx="0.3" fill="#cfe3ef" />
      <rect x="29.2" y="16.6" width="0.6" height="1.8" fill="#cfe3ef" />
      <circle cx="28.3" cy="13.8" r="1.2" fill="#f28ab2" />
      <circle cx="30.7" cy="13.8" r="1.2" fill="#9be38f" />
      <circle cx="29.5" cy="12.5" r="1.2" fill="#7a4e2d" />
      <path d="M26.8 14.4 h5.4 q-0.4 2.4 -2.7 2.4 q-2.3 0 -2.7 -2.4z" fill="#cfe3ef" opacity="0.85" />
      <rect x="31.4" y="10.6" width="0.7" height="2.8" fill="#e8b84a" />
      <path d="M29.5 11 q0.3 -0.9 1 -1.2" fill="none" stroke="#4f7a2c" stroke-width="0.2" />
      <circle cx="29.5" cy="11.1" r="0.45" fill="#e05252" />
    </g>
  ),
  // Halloween week's dessert.
  pie: () => (
    <g>
      <ellipse cx="29.6" cy="18.4" rx="4.1" ry="0.7" fill="#e8e2d4" />
      <rect x="26.2" y="17.3" width="6.8" height="0.9" fill="#a5642e" />
      <ellipse cx="29.6" cy="18.2" rx="3.4" ry="0.5" fill="#a5642e" />
      <ellipse cx="29.6" cy="17.3" rx="3.4" ry="1.1" fill="#c8813a" />
      <ellipse cx="29.6" cy="17.3" rx="2.8" ry="0.8" fill="#e07b39" />
      <path d="M29.6 17.3 L33.1 17.2 L32.4 18.2 Z" fill="#e8e2d4" />
      <g fill="#fbf6ea">
        <circle cx="28.2" cy="17" r="0.45" />
        <circle cx="29.8" cy="16.8" r="0.45" />
        <circle cx="28.9" cy="17.6" r="0.45" />
      </g>
    </g>
  ),
  // Brunch, weekends only.
  pancakes: () => (
    <g>
      <Plate />
      {[17.3, 16.4, 15.5, 14.6].map((y, i) => (
        <rect key={y} x="26.6" y={y} width="6" height="0.95" rx="0.45" fill={i % 2 ? "#c8913a" : "#d9a441"} />
      ))}
      <g fill="#8a4b1a">
        <rect x="26.9" y="14.5" width="5.4" height="0.45" rx="0.2" />
        <rect x="27.4" y="14.9" width="0.45" height="1.4" rx="0.2" />
        <rect x="31.5" y="14.9" width="0.45" height="0.8" rx="0.2" />
      </g>
      <rect x="28.9" y="13.9" width="1.4" height="0.65" fill="#fbe7a1" />
      <Steam x={28.6} y={11} />
    </g>
  ),
  waffles: () => (
    <g>
      <Plate />
      <rect x="26.6" y="15.8" width="6" height="2.4" rx="0.3" fill="#e0a94a" />
      <g fill="#c8913a">
        {[27.8, 29, 30.2, 31.4].map((x) => <rect key={x} x={x} y="15.8" width="0.2" height="2.4" />)}
        <rect x="26.6" y="16.6" width="6" height="0.2" />
        <rect x="26.6" y="17.4" width="6" height="0.2" />
      </g>
      <circle cx="28.4" cy="15.6" r="0.5" fill="#3f5fb5" />
      <circle cx="29.3" cy="15.4" r="0.5" fill="#e05252" />
      <circle cx="30.6" cy="15.5" r="0.6" fill="#fbf6ea" />
    </g>
  ),
  eggs: () => (
    <g>
      <rect x="31.6" y="13.8" width="2" height="3.4" rx="0.5" fill="#d9a441" stroke="#a5743f" stroke-width="0.25" />
      <ellipse cx="29.6" cy="17.7" rx="4.1" ry="1.2" fill="#f4f1ea" />
      <ellipse cx="27.9" cy="17.4" rx="1.3" ry="0.65" fill="#ffffff" />
      <circle cx="27.9" cy="17.3" r="0.42" fill="#f2b52a" />
      <ellipse cx="30.4" cy="17.2" rx="1.3" ry="0.65" fill="#ffffff" />
      <circle cx="30.4" cy="17.1" r="0.42" fill="#f2b52a" />
      <g fill="none" stroke="#b5452a" stroke-width="0.45">
        <path d="M26.6 18.2 q0.6 -0.4 1.2 0 t1.2 0 t1.2 0" />
        <path d="M29.6 18.5 q0.6 -0.4 1.2 0 t1.2 0" />
      </g>
    </g>
  ),
};

export function Dish({ dish }) {
  const id = DISHES[dish] ? dish : "ramen";
  return <g data-dish={id} shape-rendering={GEO}>{DISHES[id]()}</g>;
}
