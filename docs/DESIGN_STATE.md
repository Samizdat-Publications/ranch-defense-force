# Design state

**The one page to read before a design run.** What is built, what is still on
old styling, what is wearing borrowed art, and what is open.

Kept current on every design pass. If it disagrees with a handoff, this is
right — a handoff is a snapshot of what was asked for, this is what exists.

Last updated: after the "full resend with new homescreen" package landed.

---

## The design language is in

`docs/DESIGN_LANGUAGE.md` is the spec and `src/ui/tokens.css` is the
implementation. The old carved-wood panel language is **gone**, `border-image`
and its `fill` bug with it. Fonts are self-hosted (Rye, Silkscreen, IBM Plex
Mono, latin subset, ~100KB).

Rarity is five tiers from `src/content/rarity.json`. Nothing hardcodes a tier
colour — `installRarityTheme` publishes them as CSS custom properties at boot.

## Screens

| Screen | File | State |
|---|---|---|
| Home / class select | `menu.ts`, `home.css` | **Built.** Both backdrops, one picked per load. |
| Level-up | `levelup.ts`, `card.css` | **Built.** The card component, dealt with the plate stamp. |
| Pause | `pause.ts`, `sheet.css` | **Built.** Paper sheet, dotted leaders, gauges. |
| Results | `results.ts` | **Built.** Day's sheet, acres stamped at +700ms. |
| HUD | `hud.ts`, `hud.css` | **Built.** Full rail, armour pips added. |
| Shop | `shop.ts` | **NOT CONVERTED.** Still the old styling. |
| Homestead | `homestead.ts` | **NOT CONVERTED.** Still the old styling. |

The two unconverted screens are the next block of work, not a blocker on
anything.

## The card

`src/ui/card.ts` is the one card object. Level-up, shop, class select and the
Homestead all use it or should. Anything that needs to differ per screen belongs
as a flag on `CardSpec`, never as a second card.

The class rail uses a **compact variant** — a 96px art window, no min-heights,
blurb clamped to three lines. Six cards at level-up height wrapped to two rows
and pushed the buttons 260px below the fold at 1400x900. The rail scrolls
horizontally rather than wrapping.

## Content

56 upgrades: 40 items, 16 weapons. 11 common / 11 uncommon / 9 rare / 5 epic /
4 legendary. Every epic and legendary is shop-only.

**All thirteen `special` branches are implemented**, and
`tests/specials.test.ts` proves each one changes the world rather than just
setting a flag.

One balance knob exists that a content change will move:
`tuning.offers.weaponOfferWeight`. Growing the item pool from 22 to 40 cut
weapon-merge opportunities by about a third, because a draw is six weapons
against forty items once slots are full. **If the item count changes again, that
number moves.**

## Art that is still borrowed

Flagged `_standInArt` in the content files, and queued in
`art/pixellab-queue.json`.

| What | Wearing |
|---|---|
| Boot Knife | a cow bell |
| Straw Hat | a folded suit |
| Ditch Light | a lantern |
| Threshing Floor | a shockwave FX frame |
| Crop Duster | a gas FX frame |
| Whitacre Bull | the Prize Bull boss sprite |
| Post Auger | the pickaxe tier ladder |
| Combine Head | the axe tier ladder |

Work Boots and Feed Sack were the two API test generations and are now real.

Infected livestock are still ordinary animals. The infected **farmhand** is
real — generated, and the enemy you see most in a run.

## Rules that have bitten, in this repo, more than once

Worth reading before a change lands.

1. **The atlas trims every frame to content bounds.** Right for a sprite, fatal
   for anything **tiled or stepped**: a 192px six-frame strip packs to 188px and
   `steps(6)` slides instead of stepping; a 32px tile packs to 26px and every
   repeat gaps. Use the `noTrim` group flag.
2. **Strip offsets are pixels, never percentages.** `-600%` on a six-frame strip
   lands frame 0 then five blanks.
3. **Adding to a namespace someone already owns fails silently.** Four times so
   far: `.sheet` already existed when a new `.sheet` was added; `hand` is the
   player class and a handoff said to key an enemy as `hand.*`; `farmhand`
   existed as a LimeZu sheet when the generated one arrived and the later pass
   won; and a new `hud.css` imported above style.css's own `.hud-*` rules lost
   the cascade entirely. **Grep the name first.**
4. **Screens are built at module load; the atlas resolves later.** Anything that
   draws sprites must rebuild when the art lands or it renders empty.
5. **Integer zoom only.** If a mockup draws something at half scale, move it
   rather than scaling it.

## Where things are

```
src/content/     all balance and content JSON, including rarity
src/ui/          tokens.css, card.css, home.css, sheet.css, hud.css + screens
art/sprites.json the ONLY place asset paths appear
art/characters.json  class recipes for npm run characters
art/pixellab-queue.json  what to generate next
docs/            design language, mockup notes, the PixelLab pipeline
docs/archive/    superseded briefs. Not the state of anything.
```

`npm run atlas` regenerates characters and repacks. `npm test` is 131 tests.
