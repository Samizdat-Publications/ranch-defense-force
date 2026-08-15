# Ranch Defense Force — UI & content design brief

**For: Claude Design. From: the engineering side.**

You have full control over how this game looks. Nothing in the current UI is
precious — it was built to be functional and legible, not beautiful, and every
screen is a candidate for replacement. The one thing we are married to is the
**farm / ranch aesthetic**. Everything else is yours.

Read `NOTES.md` for how the game was built and what has already gone wrong.
Read `design_handoff_ranch_defense_force/GAME_DESIGN.md` for the original spec.
This document is only about what we need from you now.

---

## What the game is

A wave-based bullet-heaven (Vampire Survivors / Brotato / Deep Rock Galactic:
Survivor). You are a farmer on the Whitacre place. Something came off a crop
duster and the livestock and neighbours are wrong now. You work the field until
the light goes.

- **Weapons fire themselves.** You only move. That is the whole input.
- 24 waves, two bosses, ~17 minutes for a full run.
- Between waves you spend **feed** in a shop; on level-up you pick a card.
- Between *runs* you spend **acres** at the Homestead on permanent unlocks.
- TypeScript + Vite + Canvas 2D. No engine, no UI framework. The game field is
  canvas; **every screen and overlay is plain DOM + CSS.**

---

## The four things we are asking you for

### 1. Every upgrade card

There are **22 items** and **12 weapons** today, and the player's complaint is
blunt: *"there is a lack of options for upgrades, it's the same 5 things over
and over."*

We want you to **author the whole upgrade roster from scratch** — name, one-line
description, stats, rarity, and card art direction for each. Assume you can have
40–60 upgrades. Current content is in `src/content/items.json` and
`src/content/weapons.json`; treat it as a starting point to throw away, not a
constraint.

Two structural asks, both already supported in code:

- **Shop-exclusive upgrades.** Items now carry `source: "levelup" | "shop" |
  "both"`. The shop opens after waves 5/10/15/20/24 and is paid for with feed.
  It should be where the *run-defining* cards live — things you cannot get from
  an ordinary level-up. Design the split.
- **Rarity drives everything.** See below.

### 2. Every rarity badge

Five tiers, defined in `src/content/rarity.json`:

| Tier | Weight | Placeholder colour |
|---|---|---|
| Common | 100 | `#9aa4ad` |
| Uncommon | 55 | `#7fb069` |
| Rare | 24 | `#5aa9e6` |
| Epic | 9 | `#b06ee0` |
| Legendary | 3 | `#e0b040` |

Every upgrade is exactly one tier, and higher tiers are rarer. The colours and
badge glyphs in that file are **placeholders you should replace.** We currently
render a tier three ways — border colour, a glow only the top tiers get, and a
badge glyph — because colour alone fails for anyone who cannot separate green
from blue. Keep a redundant non-colour channel; the specific solution is yours.

Design the badge for each tier as real pixel art in the farm idiom rather than
geometric glyphs, if that serves better. A Legendary should be *obviously*
different from across the room.

### 3. Every class

Six exist: **The Hand** (slow, armoured, immovable), **The Kid** (fast, fragile,
momentum), and four newer ones — **The Widow**, **The Veteran**, **The
Agronomist**, **The Drifter**. Two are free, four cost acres.

We want your pass on all of them: names, fiction, visual identity, the card that
sells them on the class-select screen, and how a locked one should look. Right
now a locked class is a dark silhouette with a price, which is functional and
boring.

**You can invent new classes.** Adding one is now genuinely cheap — see
"Character generator" below.

### 4. A UI that is beautiful, animated, and alive

Specifically including a **home screen** that is visually stunning. The current
one is a title, a row of class cards, and a seed box. It is a placeholder.

Screens to design, all in `src/ui/`:

| Screen | File | What it does |
|---|---|---|
| **Home / class select** | `menu.ts` | Title, pick a class, seed entry, Homestead door |
| **HUD** | `hud.ts` | HP, wave, timer, feed, XP bar, weapon ring, ability |
| **Level-up** | `levelup.ts` | 3–4 cards, pick one, game frozen behind |
| **Shop** | `shop.ts` | 4 cards, reroll, per-card lock, character sheet |
| **Pause** | `pause.ts` | Resume, current build, quit |
| **Results** | `results.ts` | Run stats, acres earned, run-it-back |
| **Homestead** | `homestead.ts` | Four buildings, purchase grids |

Animation is explicitly wanted. There is currently almost none.

---

## What you can assume

### The assets we own

All under `assets/`, all licensed and paid for. **32×32 pixel art only** — never
use the 16×16 or 48×48 directories.

| Pack | What is in it |
|---|---|
| **LimeZu Modern Farm** | The whole game world: terrain, crops, props, buildings, animals, characters. 70 item icons in `Icons/Icons_32x32/`. |
| **LimeZu Modern UI** | `Modern_UI_Style_1/2_32x32.png` — panels, frames, buttons, bars. Gamepad glyphs. **Animated GIF button states.** A **Portrait Generator** (layered skins / eyes / hairstyles / accessories). |
| **Farmer Generator Pieces** | 9 bodies, 13 outfits, 45 hairstyles, 5 eyes, 8 accessories — as full character sheets. |
| **unTied Super Pixel Projectiles 2 & 3** | 22 projectile types × 6–8 colours × 2 sizes. Fireballs, meteors, acid, ice, kunai, beams, waves, impacts. |
| **Effects FX pack** | Explosions, smoke, slashes, shockwaves, muzzle flashes. |
| **Icon packs** | 60 farm tool icons, 95 RPG-Maker farm icons (seeds, weather, seasons), a pixel gun sheet. |

The atlas currently packs **1,180 frames**. Adding more is cheap — it is a build
step, not a manual process.

**The Portrait Generator is unused and you should probably use it.** It layers
the same way the character generator does, which means class portraits could be
generated rather than drawn.

### Character generator — new classes are cheap now

Every piece under `Farmer_Generator_Pieces/` is a full character sheet in the
game's rig. `npm run characters` reads `art/characters.json` and composites
them. **A new class is five strings:**

```json
"farmer-preacher-01": {
  "body": "3", "eyes": "Gray", "outfit": "Vest_Brown",
  "hair": "Balding_Gray", "accessory": "Straw_Hat_Black"
}
```

So do not ration classes on the assumption that art is expensive. It is not.

### The existing visual language (replaceable)

Documented in `src/ui/style.css` under "THE PANEL LANGUAGE". Currently: LimeZu's
carved wood frame as a CSS `border-image` 9-slice, wood used as chrome only,
text always on a dark field, and gold = affordable. It is coherent but plain.

**You may replace all of it.** If you do, say so explicitly so we do not try to
preserve it.

One hard-won rule worth keeping whatever you do: **never use the `fill` keyword
on that border-image.** It paints the frame's centre slice across the element
and puts cream text on a tan background. It shipped once and looked broken.

---

## Constraints that are real

These are not stylistic preferences — breaking them breaks the game.

1. **32×32 pixel art, integer zoom only.** A 32px sprite at 2.5× is a blurry
   32px sprite. `image-rendering: pixelated` everywhere.
2. **No new runtime dependencies** without a reason written into `NOTES.md`.
   Deps today: `vite`, `typescript`, `vitest`. No React, no Tailwind, no
   animation library. CSS animations and Web Animations API are free.
3. **The canvas is the game field.** The renderer is a tuned single-pass batched
   blitter with a fixed 1/60s sim step and zero allocation in the hot loop. UI
   work should stay in DOM and not add per-frame canvas work.
4. **Every tunable number lives in `src/content/*.json`.** No balance constants
   in code. That includes rarity weights and colours.
5. **The centre ~70% of the screen stays clear** during play. Things are trying
   to kill you there.
6. **Credit LimeZu** (limezu.itch.io) on the title screen and in the README. The
   UI pack's licence requires it.

---

## What we most want from you

Honestly: **taste and ambition.** The engineering is in decent shape — 119
tests, clean build, the systems work. What the game does not have is a *look*.
It reads as a competent prototype, and it should read as a game somebody made on
purpose.

Concretely, in priority order:

1. **The home screen.** It is the first thing anyone sees and it is currently a
   list. Make it a place.
2. **The card system.** Upgrade cards are the main interaction outside of
   moving — the player sees dozens per run. They should feel good to get and
   the rarity should land emotionally.
3. **The upgrade roster.** 40–60 upgrades, tiered, with the shop-exclusive
   split. This is content design as much as visual design.
4. **Motion.** Nothing currently moves in the UI. Cards should arrive, rarity
   should announce itself, the Homestead should feel like a farmyard at dusk.

Deliver whatever form suits you — a spec, annotated mockups, HTML/CSS we can
lift, JSON we can drop into `src/content/`. We will build it. If you hand us
content JSON, match the existing shapes in `src/content/` and we will wire it.

---

## Where things are

```
src/
  content/     all balance and content JSON — items, weapons, classes, rarity
  sim/         simulation; never imports from render/ or ui/
  render/      the canvas renderer
  ui/          every DOM screen + style.css
  behaviours/  weapon and enemy behaviour functions
art/
  sprites.json     the ONLY place asset file paths appear
  characters.json  class recipes for the generator
tools/           atlas builder, headless screenshot, weapon range, balance harness
assets/          licensed source art — never deploys
```

`npm run atlas` regenerates characters and repacks the atlas. `npm run dev`
runs the game. `npm test` is 119 tests including a headless full-run acceptance
test.

Repo: https://github.com/Samizdat-Publications/ranch-defense-force
Live: https://samizdat-publications.github.io/ranch-defense-force/
