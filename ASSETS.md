# Asset inventory

Two commercially licensed pixel-art packs by [LimeZu](https://limezu.itch.io/),
purchased 2026-08-10. Both live under `assets/` and are committed to this
**private** repo so design/build agents can read them directly.

## License — read before doing anything public

From `assets/modern-farm/LICENSE.txt`:

- **Allowed:** edit and use the art in any commercial or non-commercial project.
- **Not allowed:** resell or distribute the art to others; edit and resell it.
- Credit to `limezu.itch.io` appreciated.

Practical consequences for this project:

- The repo stays **private**. Making it public would be redistribution.
- Ship the art *composited into the game build*, not as a downloadable pack.
- Don't paste raw sheets into public issues, gists, or artifact pages.

## `assets/modern-farm/` — Modern Farm v1.2

8,096 files, ~47 MB. Source: <https://limezu.itch.io/modernfarm>

Available at `16x16/`, `32x32/`, and `48x48/`. Structure is identical at each
scale; paths below use the 16x16 names.

| Path | Contents |
|---|---|
| `0_Complete_Tileset_16x16.png` | Everything on one sheet |
| `1_Terrains` … `7_Pickup_Items` | Themed sheets: terrain, fences, props/buildings, crops, fruit trees, trees, pickups |
| `Animals_16x16/` | 84 files — chickens & roosters, cows, dogs, donkeys, ducks, goats, pigs, rabbits, sheep (multiple color variants + babies each) |
| `Characters_16x16/` | 18 files — farmer sprites plus per-action animation sheets (chopping 40f, digging 36f, fishing 128f, harvesting 36f, watering 56f). Start at `00_ANIMATIONS_GUIDE.png` for frame layout. |
| `Animated_16x16/` | 161 files — animated GIFs and matching sprite sheets |
| `Autotiles_16x16/` | Autotile-format terrain |
| `Crops_Growth_16x16/` | Per-crop growth stage sheets |
| `Single_Files_16x16/` | 2,203 files — every tile sliced out individually (crops, fences, fruit trees, pickups, props/buildings, trees). Easiest source when you want one specific object. |
| `Vehicles_16x16/` | Tractor |
| `Farmer_Generator_Pieces/` | 260 files — layered character parts: bodies, eyes, hairstyles, outfits, accessories, tools (all three scales). Composite these to build custom characters. |
| `Icons/` | 214 icon files |
| `RPG_Maker_MV/` | 117 files — RPG Maker MV formatted exports (ignore unless targeting MV) |

## `assets/modern-ui/` — Modern User Interface

982 files, ~5 MB. Source: <https://limezu.itch.io/modernuserinterface>

| Path | Contents |
|---|---|
| `16x16/Modern_UI_Style_1.png`, `_Style_2.png` | Two full HUD/panel/button sheets |
| `16x16/Modern_UI_Gamepad.png` | Controller prompt glyphs |
| `16x16/Animated/` | Animated UI GIFs (trash-can button, etc.) |
| `16x16/Portrait_Generator/` | 301 files — layered portrait parts: 9 skins, 7 eyes, 200 hairstyles, 85 accessories |
| `Portrait_Generator_ase/` | Aseprite source files for the portrait layers |

Also present at `32x32/` and `48x48/`.

## `assets/effects-fx/` — Effect and FX Pixel (free tier)

196 files, ~28 MB. Added 2026-08-10 for hit sparks, muzzle flashes, explosions,
and impact FX.

Organized as `Free/Part 1/` … `Free/Part 15/`, each holding 12 numbered PNG
spritesheets (`03.png`, `14.png`, `465.png`, …) plus a `Free Preview N.gif`.
**The filenames carry no meaning — open the per-part preview GIF to see what a
part contains,** and `Free/Free Preview All.gif` for everything at once. Worth
renaming to semantic names (`fx_hit_spark.png`, `fx_explosion_small.png`) once
you've picked the ones you're actually using.

No license file ships with this pack. It's the free tier, so use is expected to
be permitted, but confirm terms on the itch.io page before shipping anything
public.

## Not in this repo

Two Windows GUI tools shipped with the packs are **deliberately excluded** (see
`.gitignore`):

- `Farmer Generator Setup.exe`
- `Portrait_Generator_Setup.exe`

They are desktop sprite-composer apps — no agent can run them, and the layered
art they compose is already here as `Farmer_Generator_Pieces/` and
`Portrait_Generator/`. The installers remain in `~/Downloads` if you want to
install them locally.

## Working notes

- **Pick one scale and stay on it.** 32x32 is the usual sweet spot for a
  survivors-style game — readable at a distance, still detailed. Mixing scales
  in one scene breaks the pixel grid.
- Prefer `Single_Files_*/` when you need one object; prefer the numbered sheets
  when you want an atlas.
- Character animation frame counts are encoded in the filenames
  (`..._40_frames_...`), so slicing is mechanical.
