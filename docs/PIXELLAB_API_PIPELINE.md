# Generating the rest of the art — the pipeline that works

Everything learned generating 24 item icons and one full character. Read this
before spending a generation, and read `PIXELLAB.md` for what the tools are and
what they cost.

The short version: **PixelLab never returns art on the game's grid.** Generation
is half the job; the other half is a deterministic post-process, and it is
already written — `tools/pixellab-cut.ts`, zero new dependencies, built on the
same `tools/png.ts` the atlas builder uses.

---

## 1. Generation settings that are already validated

Do not re-derive these. Each one cost real generations to find.

### Item icons (card art)

| Setting | Value |
|---|---|
| Tool | Create from style reference (Pro) — 20 generations |
| Style image | `assets/pixellab/limezu_style_256.png` |
| Style image instruction | `use this art style, palette, outline weight, shading and colour count` |
| Description | **the subject only**, plain words, one line |
| Remove background | on |
| Output | 64×64 → a 4×4 grid of 16 variations on a 256×256 sheet |

The description must stay short. With a style image attached, a long style
suffix (palette, outline, "no text", view angle) *fights* the reference and the
output drifts cold and grey. `a brass cow bell with a worn leather strap` is the
correct level of detail.

Item icons are exempt from the 32×32 rule — they only ever appear on cards,
which draw at any integer zoom. Field art is not exempt.

### Characters

| Setting | Value |
|---|---|
| Tool | Characters → Create from Text, Humanoid, **Pro** |
| Character Size | **40px custom** — not the 32px preset |
| Camera View | Low Top-Down |
| Reference images | `limezu_character_ref.png` (walk sheet) + `limezu_style_char_128.png` |
| Style Character | **the farmhand**, for anything infected that follows |

**The 32px preset produced a 30px body, which read as a child** next to the
player's 37px. 40px lands the body at 38px. The size field is the *figure*
height; the canvas comes back roughly 40% larger.

**The description must state chibi proportions explicitly.** Without them the
model returns near-realistic proportions — better pixel art, wrong game, and no
style image fixes it because proportion is not style. The block that works:

> very large head taking up about one third of the total height, an oversized
> wide-brimmed hat nearly as wide as the shoulders, no visible neck, short
> stubby legs, small feet, simple hands

### Animation

| Setting | Value |
|---|---|
| Preset | Walking → **Scary Walk** (8 frames) for infected things |
| Directions | all 8 if budget allows, else S/E/N/W and mirror in code |
| Canvas | leave at the default — bigger canvas means more frames means more cost |

**Custom Animation (Pro) is priced per direction.** 20–40 generations × 8
directions is 160–320 for one walk cycle. Use the presets. Only reach for Custom
on something singular, like a boss attack, and then generate south only.

### Never resize the canvas in PixelLab before exporting

It crops hats and squashes figures. Export at whatever native size it offers —
the post-process handles placement, and it is better at it.

---

## 2. What the exports actually look like

Measured across all 72 frames of the farmhand:

| Export | Canvas | Content | Position |
|---|---|---|---|
| 8 rotations | 40×40 | 24–27 × 38 | centred, padding uneven per direction |
| Animation frames | 56×56 | 24–27 × 38 | centred, **feet at a different y in every frame** |
| Icon sheet | 256×256 | varies per cell | 4×4 grid, each cell loosely centred |

Two consequences:

- **Feet are not on a baseline.** Blit a raw frame into a cell and the character
  bobs randomly through the walk cycle. Every frame must be trimmed and
  re-placed against a fixed baseline.
- **Background removal leaves an alpha 1–8 fringe.** Trimming at `alpha !== 0`
  keeps a one-pixel halo, so every sprite lands a pixel or two off centre.
  Trim at **alpha > 8**. Note that `contentBounds()` in `tools/png.ts` uses
  `!== 0`; `pixellab-cut.ts` carries its own threshold for this reason.

---

## 3. The post-process

`tools/pixellab-cut.ts`. Copy it to `tools/` and run with `npx tsx`.

```
npx tsx tools/pixellab-cut.ts grid  sheets/cow_bell.png
    → prints the content size of all 16 cells so you can pick one

npx tsx tools/pixellab-cut.ts icon  sheets/cow_bell.png 0 0 picked/cow_bell.png
    → crops cell r0c0, trims to content, auto-downscales if it is secretly 2x

npx tsx tools/pixellab-cut.ts cell  raw/walk_south_3.png cells/walk_south_3.png
    → trims and places on a 32x64 cell, centred, feet on y=52

npx tsx tools/pixellab-cut.ts strip cells/walk_south_*.png strips/walk_south.png
    → assembles frames left to right into one strip

npx tsx tools/pixellab-cut.ts scale raw/anything.png
    → reports canvas, content and true pixel scale
```

The two numbers that define character placement, both from LimeZu's sheets:
**cell 32×64, feet on y=52.** They are constants at the top of the file. Nothing
else in the pipeline should know them.

`scale` exists because PixelLab occasionally returns a coarser pixel grid than
its canvas — a "64px" image that is really 32px at 2×. Packing that puts
half-pixels in the atlas. `icon` runs the check automatically; run `scale` by
hand on anything that looks soft.

---

## 4. Wiring the result in

1. Land files under `assets/pixellab/` — `sheets/` (source, keep all 16 cells),
   `picked/` (what the atlas packs), `character/<name>/`.
2. One `art/sprites.json` entry per sprite. That is still the only place file
   paths appear.
3. `npm run atlas`.
4. Reference by key. An 8-frame walk needs no special handling; the atlas packs
   strips the same as any other sheet.

### One game-side trap, already paid for once

Strips are driven by `background-position` **in pixels**, with an explicit
`background-size` in pixels:

```css
/* right */
background-size: 192px 32px;            /* the real sheet size */
animation: walk 0.6s steps(6) infinite;
@keyframes walk { to { background-position: -192px 0; } }
```

Percentage offsets look equivalent and are not: with a 6-frame strip,
`-600%` lands frame 0 and then five blank offsets, so a character shows one
frame and then flickers. This shipped into a mockup and took a second pair of
eyes to spot.

---

## 5. Using the REST API

The account includes API access and an MCP server, so the whole loop can run
from Claude Code without the web UI. Two things to get right:

**Confirm parameter names against the live docs** (`pixellab.ai` → Docs / API).
The settings in §1 are the ones that matter and they map across, but the exact
field names are not reproduced here rather than guess at them and send you
debugging a 400.

**The key is not in this repo and must not be committed.** Read it from the
environment — `PIXELLAB_API_KEY`.

The loop worth building, in this order:

1. `POST` the generation with the §1 settings, style image included as base64.
2. Write the raw response to `assets/pixellab/sheets/<name>.png`. **Always keep
   the full sheet** — the other 15 cells are already paid for, and several
   sheets contain a better cell than the one first picked.
3. Run `pixellab-cut.ts grid` and pick a cell, or pick programmatically by
   largest content box, then `icon` to produce the trimmed sprite.
4. Add the `sprites.json` entry and run `npm run atlas`.

Budget check before any batch: Pro tools cost 20 generations, ordinary tools 1,
and custom animation is **per direction**. 2,000/month is about 100 Pro images.

---

## 6. Naming

`snake_case`, the object's plain name, nothing else. `cow_bell.png`, never
`pixellab-a-brass-cow-bell-with-a-worn-l-1786742769126.png`. Sheet and pick
share a name. Character frames are `idle_<dir>.png` and `walk_<dir>_strip.png`
with directions spelled `south`, `south-east`, `east`, … The item key in
`items.json` stays camelCase; `weatherVane` → `weather_vane.png`.

---

## 7. The rejection bar

Reject anything you cannot identify at thumbnail size. That is the entire job of
an item icon, and it is the only quality gate that matters — palette drift and
soft edges are fixable in post, an unreadable silhouette is not.

For characters, the gate is different: **stand it next to the player before
accepting it.** The first farmhand was better pixel art than LimeZu's farmer and
still wrong, because the proportions were from another game. `_scale.png`
comparisons are cheap; a coherent cast is not.
