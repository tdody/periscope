# Handout: add the Faradaysie critter

**For:** Claude Code, working in this repo.
**Builds on:** `docs/specs/tamagotchi-picker-and-notifications.md`, Part 1 (critter picker). Do this after, or together with, that work.
**Design source:** the *Faradaysie* board on the *Periscope identity* canvas. Art is copied here, so the canvas isn't needed.

## What it is

An eighth picker option: **Faradaysie**, a Faraday-branded critter. It has a round Supertrope-purple body, an Ultrarose belly and cheeks, and the Faraday Zap's two legs as antennae: a pink arrow pointing up and a lilac arrow pointing down. On Faraday's brand page the legs read as the yes/no of a propensity prediction.

- Asset: `docs/specs/assets/critters/faradaysie.svg` (20×20, same format as the other six: `.mood-calm` / `.mood-grumpy` / `.mood-furious` layers, SMIL to be converted to CSS).
- Previews: `docs/specs/assets/critters/faradaysie-preview.png`, and `preview.png` now shows all seven critters.

## Palette (from faraday.ai/brand)

| Use | Name | Hex |
| --- | --- | --- |
| Body | Supertrope 500 | `#b641ff` |
| Arms, feet, base | Supertrope 700 | `#6d1ba0` |
| Sheen, down-arrow antenna | Supertrope 300 | `#e4baff` |
| Eyes, mouth, brows | Supertrope 900 | `#240835` |
| Up-arrow antenna, cheeks, furious sparks | Ultrarose 500 | `#f72f96` |
| Belly | Ultrarose 300 | `#fcb0d7` |

Keep these exact values. Faraday's guidelines ask for Ultrarose and Supertrope on the Zap.

## Changes

1. **Sprite:** add `faradaysie` next to the other critters (same module as Part 1), ported from the SVG.
2. **Animations → CSS** (in the `.tama` block, off under `prefers-reduced-motion`):
   - idle bob: calm 1.2s, grumpy 0.6s, furious 0.2s;
   - blink every ~4.3s;
   - lilac antenna pulses opacity 1 → 0.55 over 1.6s;
   - right arm waves (up 1.5 units, 1.3s, stepped);
   - furious only: four pink sparks flicker around it at 0.3s.
3. **Picker:** add **Faradaysie** as the eighth radio in the Tamagotchi fieldset (after Moss). Clawd stays the default.
4. **Validation:** add `faradaysie` to the allowed `tama_critter` ids in `patch_prefs_ui` (`periscope/routes/prefs.py`).
5. **Labels:** wherever the critter's name is shown, it's "Faradaysie".

## Tests

- vitest: renders each mood layer exclusively; the picker lists eight options.
- pytest: `PATCH /api/prefs/ui` accepts `tama_critter: "faradaysie"`.

## Done when

- [ ] Faradaysie can be picked in Settings, shows in the header corner, and survives reload.
- [ ] Calm, grumpy and furious match the preview; motion stops under reduced motion.
- [ ] Colours match the palette table exactly.
