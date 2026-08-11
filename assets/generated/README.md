# Generated sprites

Custom sprites exported from the LimeZu generator apps that ship with the packs.
Source of truth for the raw exports is
`%USERPROFILE%\AppData\LocalLow\Gray Matter Studios\` — the generators save
there, not to Downloads.

Filenames here are normalized (lowercase, hyphens, no spaces) so they're safe in
asset paths and loaders. Original export names are in the table below.

## `characters/` — 12 sheets, 1792 x 704 each

Exported at the generator's 32x32 scale, so each sheet is a 56 x 22 frame grid.
Layout matches the pack's own character sheets — cross-check frame offsets
against `assets/modern-farm/16x16/Characters_16x16/00_ANIMATIONS_GUIDE.png`
before slicing. Each sheet carries the full action set: idle, walk, dig, water,
harvest, chop, and fishing, in four facing directions.

| File | Original name | Intended role |
|---|---|---|
| `farmer-01.png` | `farmer.png` | player / skin |
| `farmer-02.png` | `farmer2.png` | player / skin |
| `farmer-03.png` | `farmer3.png` | player / skin |
| `farmer-04.png` | `farmer4.png` | player / skin |
| `farmer-female-01.png` | `Female Farmer.png` | player / skin |
| `character-01.png` | `1.png` | unlabeled variant |
| `character-02.png` | `2.png` | unlabeled variant |
| `zombie-01.png` | `Zombie.png` | enemy |
| `zombie-02.png` | `zombie2.png` | enemy |
| `zombie-acid-01.png` | `Acid Zombie.png` | enemy — green/acid palette |
| `gas-enemy-01.png` | `gas enemy.png` | enemy — gas mask |
| `gas-enemy-02.png` | `gas enemy2.png` | enemy — gas mask |

The five farmers plus the two unlabeled variants are intended as the player
character and its cosmetic skins. The zombies and gas-mask units are intended as
enemies.

## `portraits/` — 1 sheet

| File | Original name | Notes |
|---|---|---|
| `portrait-main.png` | `Main.png` | 640 x 192, from the Portrait Generator |

## Adding more

Export from the generator, then copy out of the `Gray Matter Studios` folder
into the matching subfolder here. Keep the scale at 32x32 to stay consistent
with what's already committed.
