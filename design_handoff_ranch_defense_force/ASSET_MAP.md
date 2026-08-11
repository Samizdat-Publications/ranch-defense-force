# Asset map

> **⚠ Correction, added after the fact.** The `assets/generated/` paths below are
> **stale**. The sheets were normalised to lowercase-hyphen names in subfolders
> before this handoff arrived: `assets/generated/farmer.png` is now
> `assets/generated/characters/farmer-01.png`. Full mapping in
> `assets/generated/README.md`.
>
> **`art/sprites.json` is the live manifest** and carries the real paths — it is
> the only place a file path appears, per §10. Treat this file as design intent,
> not as a path reference.
>
> Also: `Gas zombie.png`, listed below as an excluded 16×16 export, **does not
> exist** in the repo. All 12 committed sheets are 1792×704.

Every game entity mapped to a real path in `Samizdat-Publications/ranch-defense-force`.
**Only 32×32 directories are ever read.** This file is the source for
`art/sprites.json`.

## Characters — generator exports

All 1792×704, 56 columns × 22 rows, 32px per cell. Identical rig, identical
frame order, identical pivot.

| Game entity | File | Role |
|---|---|---|
| The Hand (class) | `assets/generated/farmer.png` | Player |
| The Kid (class) | `assets/generated/Female Farmer.png` | Player |
| Farmhand | `assets/generated/Zombie.png` | Enemy |
| Acid Zombie | `assets/generated/Acid Zombie.png` | Enemy |
| Bloated Farmhand | `assets/generated/zombie2.png` | Enemy |
| Masked Sprayer | `assets/generated/gas enemy.png` | Enemy |
| Masked Hauler | `assets/generated/gas enemy2.png` | Enemy |
| *(unassigned)* | `farmer2.png` `farmer3.png` `farmer4.png` `1.png` `2.png` | Future classes |
| **EXCLUDED** | `Gas zombie.png` | Accidental 16×16 export (896×352). Do not use. |

> If `assets/generated/` is empty apart from its README, the sheets have not
> been pushed yet. Confirm before M4.

## Animals — Modern Farm

Base path: `assets/modern-farm/32x32/Animals_32x32/`

| Game entity | Folder | Notes |
|---|---|---|
| Rooster | `Chickens_and_Roosters_32x32/` | Also the ambient chickens |
| Feral Dog | `Dogs_32x32/` | Has **run** and **bark** animations — the bark is the pack tell |
| Duck Flight | `Ducks_32x32/` | |
| Blown Sheep | `Sheeps_32x32/` | |
| Sick Hog | `Pigs_32x32/` | |
| The Prize Bull (boss) | `Cows_32x32/` | Drawn at **×2**, palette shifted near-black |
| *(unused)* | `Goats_32x32/` `Rabbits_32x32/` `Donkeys_32x32/` | Available for Tier 2+ |

Each species ships multiple colour variants and babies — use them for elite and
tier variants rather than exporting anything new.

## Vehicles

| Game entity | Path |
|---|---|
| The Duster (final boss) | `assets/modern-farm/32x32/Vehicles_32x32/` — tractor, drawn at **×3** |

## Weapons

Tools: `assets/modern-farm/Farmer_Generator_Pieces/Tools/32x32/`

| Weapon | File |
|---|---|
| Shovel | `Tool_Shovel.png` |
| Axe | `Tool_Axe.png` |
| Watering Can | `Tool_Watering_Can.png` |
| Fishing Rod | `Tool_Fishing_Rod.png` |

Produce: `assets/modern-farm/Icons/Icons_32x32/Icons_32x32.png` (or the
16x16 singles for names — the 24 and 32 icon sets are hand-made, not upscaled)

| Weapon | Icon |
|---|---|
| Seed Spitter | `Crops_Corn` |
| Melon Lob | `Crops_Watermelon` |
| Chili Shot | `Crops_Chili_Pepper` |
| Egg Toss | `Food_Egg` |
| Grain Lure | `Food_Grain_Bag` |

Props: `assets/modern-farm/32x32/Single_Files_32x32/Props_and_Buildings_32x32/`

| Weapon | File |
|---|---|
| Slop Bucket | `Bucket_1_Single_32x32.png` |
| Framing Hammer | `Hammer_1_Woodwork_Crafting_Table_32x32.png` |

Minion: Barn Dog reuses `Animals_32x32/Dogs_32x32/` with its own run animation.

## Terrain and props

| Use | Path |
|---|---|
| Ground base, corn rows, gravel | `assets/modern-farm/32x32/1_Terrains_32x32.png` + `Autotiles_32x32/` |
| Fences | `assets/modern-farm/32x32/2_Fences_32x32.png` |
| Barn, silo, trough, well, hay, tyre | `3_Props_and_Buildings_32x32.png` or the singles folder |
| Corn growth stages (for the burning rows in Duster phase 2) | `Crops_Growth_32x32/` |
| XP gems, feed coins | `7_Pickup_Items_32x32.png` |
| Upgrade card icons | `Icons/Icons_32x32/` — 64+ named singles |

## UI

Base path: `assets/modern-ui/32x32/`

| Use | File |
|---|---|
| All panels, frames, buttons | `Modern_UI_Style_1.png` — **pick one style, never mix** |
| Controller prompts | `Modern_UI_Gamepad.png` |
| Class portraits | `Portrait_Generator/` — 9 skins, 7 eyes, 200 hairstyles, 85 accessories |

Slice frames as CSS `border-image` so they stretch to any size.

## Effects

Base path: `assets/effects-fx/Free/Part 1/` … `Part 15/`

Filenames are meaningless numbers. **The preview GIFs are the index** — open
`Free/Free Preview All.gif`, pick the 8–10 you need, rename them semantically in
`sprites.json`, ignore the other ~186.

Needed: hit spark (small), hit spark (heavy), muzzle flash, explosion (small),
explosion (large, for the Duster), smoke puff, dust cloud (for Bolt and the
bull's paw tell), gas cloud loop, acid pool loop.

**All FX must go through `tools/conform-fx.ts` before use.**

## Not available anywhere

- **Audio.** No sounds or music in any pack. Needs a separate decision.
