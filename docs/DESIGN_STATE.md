# Design state

**The one page to read before a design run.** What is built, what is still on
old styling, what is wearing borrowed art, and what is open.

Kept current on every design pass. If it disagrees with a handoff, this is
right — a handoff is a snapshot of what was asked for, this is what exists.

Last updated: after the two reference scenes were ported and the last two
screens converted.

The design mockups are IN THE REPO at `docs/mockups/` and the two reference
scenes at `docs/reference/`. Open them in a browser; they are the target.

---

## The design language is in

`docs/DESIGN_LANGUAGE.md` is the spec and `src/ui/tokens.css` is the
implementation. The old carved-wood panel language is **gone**, `border-image`
and its `fill` bug with it. Fonts are self-hosted (Rye, Silkscreen, IBM Plex
Mono, latin subset, ~100KB).

Rarity is five tiers from `src/content/rarity.json`. Nothing hardcodes a tier
colour — `installRarityTheme` publishes them as CSS custom properties at boot.

## Screens

**Every screen is converted.** There is no old styling left in the UI.

| Screen | File | State |
|---|---|---|
| Home / class select | `menu.ts`, `scene.ts`, `home.css`, `home-ui.css` | Rebuilt to the reference scenes. **Still not signed off by eye.** |
| Level-up | `levelup.ts`, `card.css` | Built. |
| Pause | `pause.ts`, `sheet.css` | Built. |
| Results | `results.ts` | Built. |
| HUD | `hud.ts`, `hud.css` | Built. |
| Shop | `shop.ts`, `shop.css` | **Converted.** The same packet, priced, plus the counter. |
| Homestead | `homestead.ts`, `homestead.css` | **Converted.** The yard, four staked signs, purchase cards. |

## The two backdrops

`src/ui/scene.ts` is a **layer-for-layer port of `docs/reference/`**, in DOM
order, which is paint order. 43 layers in the yard, 38 in the field. Both the
home screen and the Homestead mount it, so there is one yard.

**Do not build a scene from `docs/mockups/PLACEMENTS.md`.** That table lists the
scenes' `<img>` placements and nothing else — no sky, no sun, no ground, no
barn, no farmhouse, no walking actors, no vignette, because those are CSS
layers. A build made faithfully from it measures correct and is missing two
thirds of the picture. That is exactly what happened, and it is why the owner
said "it's not even close". Read the reference documents.

The `scene` sprite group is packed **`noTrim`** and must stay that way. Design's
coordinates are the top-left of each sprite's FULL box, so a trimmed frame draws
at the right place with the wrong offset — silently, on every prop at once.

## The card

`src/ui/card.ts` is the one card object. Level-up, shop, class select and the
Homestead all use it. Anything that needs to differ per screen is a flag on
`CardSpec`, never a second card. The flags that exist: `price` + `priceUnit`,
`affordable`, `dead`, `selected`, `clipped`, `pips`.

`pips` is the Homestead's: a plain steel plate carrying a rank rather than a
rarity, because your third rank of the Feed Store is not rare, it is your third
one.

The class rail uses a **compact variant** — a 96px art window, no min-heights,
blurb clamped to three lines.

## Content

56 upgrades: 40 items, 16 weapons. 11 common / 11 uncommon / 9 rare / 5 epic /
4 legendary. Every epic and legendary is shop-only.

**All thirteen `special` branches are implemented**, and
`tests/specials.test.ts` proves each one changes the world rather than just
setting a flag.

One balance knob a content change will move:
`tuning.offers.weaponOfferWeight`. Growing the item pool from 22 to 40 cut
weapon-merge opportunities by about a third. **If the item count changes again,
that number moves.**

## Art that is still borrowed

Flagged `_standInArt` in the content files, and queued in
`art/pixellab-queue.json`.

| What | Wearing | Note |
|---|---|---|
| Threshing Floor | a shockwave FX frame | the only one left; nothing generated for it |

**One item is still borrowing, down from eight.** The Post Auger and the Combine
Head each have a real four-rung ladder — rusted iron, clean steel, blackened
steel, polished chrome — generated rung-from-rung so they read as one tool at
four qualities rather than four unrelated tools.

Work Boots, Feed Sack, the Straw Hat, the Ditch Light, the Boot Knife and **all
four Homestead building signs** are real art now. So is the yard's rooster, and
so are the oaks — the field's treeline was a band of CSS mounds standing in for
trees that did not exist yet, and it is real trees at 1x now.

**The soundtrack is three CC-0 tracks by Abstraction** (Music Loop Bundle),
replacing the Lyria clips. OGG rather than MP3 because MP3 will not loop
seamlessly, and every layer loops for as long as a wave lasts. Credit is on the
title screen and in the README.

**The animal roster is wired.** feralDog, rooster, sickHog, blownSheep and
prizeBull draw from generated eight-direction sheets with walk, attack and death
(`pixellabObjects` in `art/sprites.json`, built by `npm run objman`). The LimeZu
entries for those keys were deleted, not left alongside. duckFlight is still
LimeZu — no duck was generated.

**The harvest nodes are ours.** All eleven rock, ore and tree sprites come from
the environment objects recovered off the PixelLab account. The two huge oaks
and two larger trees are deliberately unpacked, for scenery.

**The ground degrades with the wave** — `tuning.terrain.blight`, pasture through
withered grass and rot to cold ash. Re-bakes on a band change, never per frame.

**The pickups are real art** at 16px. `pickup.heal` is still LimeZu's apple.

**`_standInArt` is now ZERO across the whole content set** — Threshing Floor,
the last one, has the generated chain lightning arc.

**Walk, attack and death all play** for the generated roster. The fence is real
art, flat decals are baked into the terrain, and eighteen props are scattered as
y-sorted scenery in a band near the arena edges.

**The FX are generated and animated** — muzzle, gas, dust, explosion and slash,
one generation each via `animate-with-text-v3`. Not conformed: the authored
palette has no coverage for an electric arc. hitSpark, critStar and shock are
still pack art.

**The rarity plate is generated steel**, one 192x32 banner blended over the
existing tier gradient so all five rarities and the rank variant work off
`--tier-colour` with no per-tier art. Emitted to `public/ui/plate.png`, because
the UI is DOM and CSS needs a real URL.

**Use `/map-objects`, not `create-1-direction-object`, for anything flat.** One
generation instead of twenty, and it takes any aspect ratio rather than a square
size only.

## Rules that have bitten, in this repo, more than once

Worth reading before a change lands.

1. **The atlas trims every frame to content bounds.** Right for a sprite drawn
   from a pivot, fatal for anything drawn from a BOX or anything tiled or
   stepped. A 192px six-frame strip packs to 188px and `steps(6)` slides; a 32px
   tile packs to 26px and every repeat gaps; a 96x96 scarecrow packs to 84x78
   and stands 12px left of where the design put it. Use `noTrim`.
2. **Strip offsets are pixels, never percentages.** `-600%` on a six-frame strip
   lands frame 0 then five blanks.
3. **Adding to a namespace someone already owns fails silently.** Six times now:
   a second `.sheet`; keying an enemy as `hand.*` when `hand` is a class;
   `farmhand` as both a LimeZu and a generated sheet; a new `hud.css` imported
   above the rules it meant to replace; `chickenPeckstrip` against
   `chickenPeckStrip`; and two `window.rdf` handles that overwrote each other so
   what the console gave you depended on whether a run had started.
   **Grep the name first.**
4. **Screens are built at module load; the atlas resolves later.** Anything that
   draws sprites must rebuild when the art lands or it renders empty. Four
   screens have needed this. `menu.setUnlocked` and `homestead.refreshScene`
   are the hooks.
5. **Integer zoom only.** If a mockup draws something at half scale, move it
   rather than scaling it.
6. **A CSS shorthand followed by a longhand that overwrites its payload is
   invisible.** `background: var(--paper)` puts the gradient in the image slot
   and resets the colour to transparent; the `background-image` on the next line
   then replaced the gradient. Every level-up card was 94% see-through for two
   milestones and no type, test or review caught it. Paint a flat colour under
   any layered background.

## Where things are

```
src/content/     all balance and content JSON, including rarity
src/ui/          tokens.css, card.css, home.css, scene.ts, shop.css,
                 homestead.css, sheet.css, hud.css + screens
art/sprites.json the ONLY place asset paths appear
art/characters.json  class recipes for npm run characters
art/pixellab-queue.json  what to generate next, plus the ranch roster,
                 the horror plan and the maps backlog
docs/reference/  Design's own runtime scenes. THE TARGET.
docs/mockups/    the eight design mockups, openable in a browser
docs/archive/    superseded briefs. Not the state of anything.
```

`npm run atlas` regenerates characters and repacks. `npm test` is 131 tests.
