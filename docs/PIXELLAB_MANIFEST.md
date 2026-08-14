# Generated sprite manifest

24 sheets, generated with **Create from style reference (Pro)** against `limezu_style_256.png`.
See `PIXELLAB.md` for the recipe and the tool notes.

Every sheet is **256×256 — a 4×4 grid of 64px cells**. `cell` is the one wired
into the mockups (`r1c1` = top-left, row then column). The other fifteen cells in
each sheet are usable variants, already paid for.

`picked/<name>.png` is that cell, cropped and trimmed to content bounds. That is
the file the atlas should pack.

| name | subject | cell | serves | suggested sprites.json key |
|---|---|---|---|---|
| `barbed_wire` | a loose coil of rusted barbed wire | r1c1 | `barbedWire` | `item.barbedWire` |
| `weather_vane` | an iron rooster weather vane | r1c1 | `weatherVane` | `item.weatherVane` |
| `cow_bell` | a brass cow bell with a worn leather strap | r2c1 | `crowBell (weapon)` | `weapon.crowBell` |
| `cattle_prod` | an electric cattle prod | r1c1 | `cattleProd` | `item.cattleProd` |
| `salt_lick` | a white block of salt lick, chipped | r1c1 | `saltLick` | `item.saltLick` |
| `salt_ring` | a ring of scattered white salt | r2c2 | `saltCircle` | `item.saltCircle` |
| `wet_rag` | a wet grey rag, wrung out and folded | r1c1 | `wetRag` | `item.wetRag` |
| `chalk_line` | a chalk line reel with blue chalk | r1c2 | `chalkLine` | `item.chalkLine` |
| `twine` | a spool of rough baling twine | r1c1 | `balingTwine` | `item.balingTwine` |
| `staples` | a small handful of U-shaped fence staples | r2c1 | `fenceStaples` | `item.fenceStaples` |
| `whetstone` | an oiled whetstone on a wooden block | r1c1 | `whetstone` | `item.whetstone` |
| `thermos` | a dented steel thermos flask | r1c1 | `coffeeThermos` | `item.coffeeThermos` |
| `kerosene` | a red jerrycan of kerosene | r2c2 | `keroseneCan` | `item.keroseneCan` |
| `lantern` | a lit hurricane lantern | r1c1 | `lampOil` | `item.lampOil` |
| `four_leaf` | a fresh green four-leaf clover | r1c1 | `fourLeaf` | `item.fourLeaf` |
| `dog_whistle` | a brass dog whistle on a cord | r1c1 | `dogWhistle` | `item.dogWhistle` |
| `grain_scoop` | a metal grain scoop | r1c1 | `grainScoop` | `item.grainScoop` |
| `post_driver` | a heavy steel fence post driver | r1c1 | `postDriver` | `item.postDriver` |
| `culvert_pipe` | a short concrete culvert pipe | r1c2 | `culvertPipe` | `item.culvertPipe` |
| `split_rail` | a weathered split fence rail | r4c1 | `splitRail` | `item.splitRail` |
| `tractor_plate` | a bolted steel tractor armour plate | r1c1 | `tractorPlate` | `item.tractorPlate` |
| `sunday_best` | a folded dark Sunday suit with a tie | r1c1 | `sundayBest` | `item.sundayBest` |
| `sling_bands` | a pair of thick rubber sling bands | r1c1 | `slingBands` | `item.slingBands` |
| `seed_drill` | a rusted iron seed drill hopper | r1c2 | `seedDrill (weapon)` | `weapon.seedDrill` |

## Picked sprite sizes

Trimmed, so these are content bounds, not canvas size.

| name | size |
|---|---|
| `barbed_wire` | 60×54 |
| `weather_vane` | 50×61 |
| `cow_bell` | 44×60 |
| `cattle_prod` | 54×58 |
| `salt_lick` | 56×60 |
| `salt_ring` | 44×44 |
| `wet_rag` | 60×50 |
| `chalk_line` | 51×58 |
| `twine` | 44×60 |
| `staples` | 55×50 |
| `whetstone` | 60×46 |
| `thermos` | 28×60 |
| `kerosene` | 48×60 |
| `lantern` | 36×62 |
| `four_leaf` | 56×60 |
| `dog_whistle` | 61×58 |
| `grain_scoop` | 32×60 |
| `post_driver` | 44×60 |
| `culvert_pipe` | 60×48 |
| `split_rail` | 59×23 |
| `tractor_plate` | 56×59 |
| `sunday_best` | 60×56 |
| `sling_bands` | 58×56 |
| `seed_drill` | 59×55 |

## Wiring

1. Copy `sheets/` and `picked/` to `assets/pixellab/`.
2. Add one `art/sprites.json` entry per picked sprite, using the keys above.
3. `npm run atlas`.
4. In `content/items.json`, the 24 entries already carry `_mockArt` pointing at
   these files and `_art: "generated (PixelLab, LimeZu style-referenced)"`. Swap
   `_mockArt` for the real sprite key when the atlas is rebuilt, and drop the
   `_mock*` and `_atlas` fields — they are mockup metadata, not game data.

## Still standing in

These five item entries still borrow art that means something else, and are
marked `_atlas: "NEW ATLAS KEY"`. They need *field* art at 32×32 with directional
frames, not card icons — see "What to generate next" in `PIXELLAB.md`.

- `dogWhistle` summons a barn dog — the dog itself does not exist
- `whitacreBull` — the bull does not exist
- `cropDuster` — the biplane does not exist
- `ironLung` / `cropDuster` gas — no gas cloud sprite
- `saltCircle` — the card icon exists now; the ground decal does not
