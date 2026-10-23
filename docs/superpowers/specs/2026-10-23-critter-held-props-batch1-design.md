# Critters hold things, batch 1: design

THI-415 part 2b, batch 1: the pint, the coffee mug, the spoon, the watering can and the leash. Batch 2 will cover the bass and the controller, which need two-appendage poses. Part 3 is hands and strides.

The batch-1 draft was reviewed on a rendered grid of the live scenes and approved as drawn. This spec turns that draft into code with the same numbers.

## The gap

Clawd's held props are drawn for his own arm:
- the pint at `x0 + 15.2` (`ClawdPint`);
- the spoon from `(x0 + 16.8, 13.6)` into the pot;
- the watering can at `x0 + 16.2…21.7`;
- the coffee mug standing against his arm at x 25.5;
- the dog's leash starting at `(18.2, 14.2)`.

A critter is narrower and has no arm, so all five float beside it.

## Decisions

- **Each critter reaches with its own appendage**, the style you chose:

  | Critter | Appendage |
  |---|---|
  | Scope, Volt, Moss | an L-shaped arm |
  | Jelly, Octocat | a stair-step tentacle with a curl |
  | Nox, Ember | the tail curled up over the prop; Nox's has its grey outline, Ember's a spade tip |

  While a critter holds with its tail, the resting tail is hidden.
- **The poses are generated, not drawn per prop.** A critter declares its limb once (style, root point, colour, width). Each prop declares where the tip goes: a `reach` right of the root and an `at` height down the body. These are the reviewed draft's numbers.
- **The props are Clawd's own drawings at Clawd's size**, placed at the tip and drawn inside the critter's wrapper so they bob with it:
  - the **pint** hangs from the tip; the friend holds its own, mirrored, and they clink;
  - the **mug** is held by its handle, mirrored so the handle faces the critter, still steaming;
  - the **can** hangs from the tip by its handle.
- **The spoon and the leash keep their far end.** The spoon runs from the tip into the pot. The leash runs from the tip to the dog's collar.
- **The friend's appendage is tinted with the friend; the props never are.**
- **Clawd is untouched.** His held props and the coffee mug are drawn as before; the critter path is a separate branch. The Clawd hash pin and the parity tests guard that.

## Data: the critter SVGs and `build_critters.py`

- **The limb.** Each critter's `<svg>` declares it:
  - `data-limb="style rootX rootY [width]"`: the style is `arm`, `tentacle` or `tail`, and the width defaults to 1;
  - `data-limb-color="#rrggbb"`;
  - optionally `data-limb-outline="#rrggbb"` (Nox) and `data-limb-tip="spade"` (Ember).

  The generator emits `limb: {style, root: [x, y], width, color, outline?, spade?}`. It validates the style, the numbers (finite) and the colours, and `render()` requires a limb for every shipped critter.
- **The resting tail.** A `<g class="hold-rest">` marks the part a holding pose hides. That's Nox's tail group and Ember's spiky tail group. The generator emits `rest: true` on that node.

Values, taken from the draft:

| Critter | `data-limb` | colour | extras |
|---|---|---|---|
| scope | `arm 17 10.6 1.2` | `#2a86b3` | |
| jelly | `tentacle 16 10.2` | `#7d62c9` | |
| nox | `tail 15.2 16 1` | `#1a1c20` | outline `#4a4f57`, `hold-rest` on the tail |
| ember | `tail 16 13.4 1` | `#b8403a` | tip `spade`, `hold-rest` on the tail |
| volt | `arm 17.4 9.4 1.2` | `#d1a92b` | |
| moss | `arm 15.6 10.6 1.1` | `#2e9a56` | |
| octocat | `tentacle 16.6 12.4` | `#24292f` | |

## Code

**`critters.js`:**
- `HOLDS = { pint: {reach 2.6, at .42}, mug: {2.2, .55}, spoon: {2.4, .55}, can: {2.6, .45}, leash: {2.4, .65} }`.
- `holdTip(sprite, prop)`: `[root.x + reach, box.y + at·box.h]`, in sprite units.
- `holdTipInScene(sprite, prop, pose)`: that tip mapped through `placement`, in scene units.
- `limbGlyphs(sprite, prop)`: the limb's nodes, in the draft's exact geometry:
  - **arm:** a horizontal bar from the root, a vertical bar to the tip, and a hand nub;
  - **tentacle:** 0.95 cells stepped every ≤ 0.75 units from root to tip, plus a 0.8 curl;
  - **tail:** a base along the floor, a riser to the tip, and a hook; plus the outline copy and the spade when declared.

**`Critter.jsx`:** a `holding` prop (`data-holding`). It hides `rest` nodes and draws `limbGlyphs`, tinted with the rest of the critter.

**`TamaPastimes.jsx`:**
- `CoffeeMug` is extracted from `Behind`'s coffee case, with byte-identical markup.
- `CritterHeld({ sprite, kind })` draws the pint, the mug or the can at the tip, scaled back to Clawd's size.
- `Spoon` takes an optional `from`.
- `Dog({ critter })` starts the leash at the critter's tip.
- `CritterFriend` holds its own pint (`holding="pint"` plus `CritterHeld`). It keeps plain `tama-clink`: its mirror already turns the clink toward the mascot. `Friend` draws Clawd's pint only for Clawd.

**`Tamagotchi.jsx`:**
- `holding` maps the activity to a prop: beer → pint, coffee → mug, cook → spoon, garden → can, dog → leash. It applies to critters only.
- `Critter` gets `holding`, and `CritterHeld` is drawn inside the wrapper.
- Clawd's `p.Held` is skipped for a holding critter; a holding cook draws `Spoon from={holdTipInScene(…)}`.
- `Behind` gets `mugHeld`, so the standing mug isn't drawn.

## Tests

- **Generator:**
  - `data-limb*` parsing and validation;
  - `hold-rest` sets `rest`;
  - every shipped critter declares a limb.
- **`critters.test.js`:**
  - `holdTip` and `holdTipInScene` agree with `placement`;
  - each limb style's nodes reach the tip in the limb colour;
  - the tail draws an outline copy and a spade when declared.
- **`critterRender.test.jsx`:**
  - `holding` hides rest nodes and draws the limb (`data-holding`);
  - the exact-markup pin holds without `holding`.
- **`tamagotchiRender.test.jsx`:** for each critter in the 5 scenes:
  - the critter holds;
  - Clawd's floating prop is absent;
  - the pint, mug and can are drawn exactly once, inside the critter's wrapper (in the beer scene, the friend has its own);
  - the spoon and leash start at `holdTipInScene`.

  Clawd stays unchanged, guarded by the hash pin and the parity tests.

## Hand check

Re-render the batch-1 grid from the branch. It must match the approved draft.
