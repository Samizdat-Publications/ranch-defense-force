# What to generate next — design priority

Claude Code has its own list and its own reasons. This is the **design** view of
what the game is missing, in the order I would spend credits.

The rule behind the order: generate what the player looks at most, and what the
game currently fakes. Everything on this list is either art the mockups had to
borrow, or art the fiction promises and the game does not deliver.

---

## 1. The infected livestock — hens, rooster, hog

**Why first.** The mockups recolour healthy LimeZu chickens with a `sepia` +
`hue-rotate` filter and call them infected. That is a lie the HUD tells the
player, and it is the most common enemy in the early waves. A recoloured hen
still reads as a hen with a colour problem, not as something wrong.

- Quadruped mode is experimental; these are small enough that **Create Object →
  8 rotations** may serve better than the character tool. Try one hen both ways.
- **Nominate The Hand as the Style Character** so the infection reads the same
  across species — same milky eye, same grey-green tone.
- Needs: idle + walk, 8 directions. A hog is the natural third: bigger, slower,
  a wave-8 pressure enemy that the roster has no answer for yet.

## 2. The two bosses

**Why second.** The boss bar in the HUD names *The Thing in the North Pasture*
and there is no thing. It is the only moment in a run with its own UI element,
and it currently points at a darkened farmer sprite.

- **128px** character size, not 40 — a boss should not be player-sized.
- One attack animation matters more than eight directions. **Custom Animation is
  priced per direction**, so generate the attack for **south only** and let the
  sim mirror it; nobody reads a boss wind-up from behind.
- Second boss: the crop duster itself, as a fly-over rather than a walker. That
  is a prop with an animation, not a character — cheaper, and it closes the
  fiction loop.

## 3. The barn dog

**Why third.** Dog Whistle is a legendary item — `bullMinion`'s sibling — and
the card currently shows a whistle because there is no dog. A minion the player
paid a legendary slot for should be visible on the field.

- Quadruped, 32px, walk + idle, 8 directions.
- This is the cheapest item on the list that unblocks a *card*, not just a
  screen.

## 4. Five field props the roster promises

These are the `NEW ATLAS KEY` entries in `content/items.json` — items whose card
art exists but whose *field* art does not:

| Item | Needs |
|---|---|
| Salt Circle | a ring of salt on the ground, 64×64, top-down |
| Crop Duster | the biplane, side-on, 128×64, with a gas trail |
| Iron Lung | gas cloud, 4-frame loop — the one genuine VFX on the list |
| Whitacre Bull | the bull minion, quadruped, 96px |
| Threshing Floor | a chain-lightning impact, 3 frames |

Gas is the interesting one: `gasImmune`, `trailGas` and `gasGrace` all exist in
code and nothing in the game renders gas.

## 5. Class portraits — only if the generator disappoints

`npm run characters` builds all six classes from `art/characters.json` in the
game's own rig, for free. **Run that first.** If the generated faces are too
similar to tell apart on the class-select cards, then use PixelLab's
**Portrait ↔ Character (Pro)** to make busts from the finished sheets — it reads
a character and returns a portrait in that character's style, which is exactly
the tool for it.

Do not generate classes from scratch. The generator's output is already in the
rig and already animated.

---

## What I would not spend credits on

- **More item icons.** Twenty-four is enough for 56 upgrades; several already
  share art sensibly (the tool tiers, the rounds).
- **UI frames, panels, buttons.** Paper & Pin is CSS. Generated UI would drag a
  second visual language into the game for no gain.
- **Terrain and tiles.** LimeZu's farm pack is complete here and better than a
  generated tileset will be.
- **Anything at 16×16 or 48×48.** The integer-zoom rule is not negotiable.

## Two process notes worth keeping

**Always pass the style reference.** The no-reference and with-reference runs of
the same prompt came back in different palettes entirely — cold blue-grey versus
LimeZu's warm cream. The reference is what makes the output belong to this game.

**Write proportions into the description, not just the reference image.** The
first Hand came back with realistic proportions despite a LimeZu reference image,
because reference images carry style far better than they carry anatomy. The
chibi block in the second prompt is what fixed it.
