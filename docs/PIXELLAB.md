# PixelLab — generated art pipeline

**Status:** live, paid, in use. This is now a first-class asset source for the
project alongside the licensed packs, not an experiment.

Written for whoever picks this repo up next, including Claude Code.

**If you are about to generate art, read `API_PIPELINE.md` first.** It carries the
validated settings, what the exports actually look like, and the post-process
that puts them on the game's grid — including `tools/pixellab-cut.ts`, which does
the whole cut with no new dependencies.

---

## Why this exists

The game was built around a handful of purchased packs. Good art, but a fixed
vocabulary: when the design needed a gas mask, a cattle prod or a dog, the
options were "borrow a sprite that means something else" or "cut the idea." The
first roster pass shipped with a carrot standing in for a crop duster and a slice
of cheese standing in for a wet rag, because nothing better existed.

That constraint is gone. Art is now generated on demand, in the game's own style,
for roughly a few cents a piece.

**Design consequence worth stating plainly:** stop designing around the asset
list. Design what the game needs and generate the art. The packs are still the
foundation for the world — terrain, buildings, characters, animals — because they
are hand-made and cohesive. PixelLab fills the gaps.

## The subscription

**Being cancelled.** The account is Tier 2 and the plan is not renewing, so
everything below is a record of what was available, not a menu.

| | |
|---|---|
| Service | PixelLab (pixellab.ai) |
| Tier | **Tier 2 · Pixel Artisan** |
| Budget | **4,710 generations/month** (not 5,000 — the dashboard figure is the one that counts) |
| Concurrency | **10 jobs** |
| Max output | 512×512 |
| Licence | commercial use permitted |
| API | REST at `api.pixellab.ai/v2`, plus an MCP server |

An earlier version of this file said Tier 1, 2,000/month, 8 concurrent and 320px
max. That was true once and had been wrong for several sessions.

### What dies with the account, and what does not

This is the distinction that matters when a subscription is ending, and it is
not the credit balance.

**Yours forever:** every PNG that has been downloaded. Generated art is
commercially licensed and committed to this repo.

**Dies:** the **object, character and tileset ids**. `create_object_state`,
`animate_object` and `create_8_direction_object`-with-a-`style_object_id` all
take an id that lives on PixelLab's servers. Once the account lapses you cannot
derive a new state, rotation or animation from work already generated — you
would have to start the animal again from nothing.

So the last thing to do on a live account is not to generate new subjects. It is
to take every derivation you will ever want off the ids you already have, and to
download everything. `art/pixellab-queue.json` → `_accountLedger` records every
id the account held on 2026-08-28.

### Measured costs

Read the balance either side of a call rather than trusting a table; these were
measured that way.

| Tool | Cost |
|---|---|
| `POST /objects/{id}/animations` (`mode: v3`) | **1 per direction** — 8 for a full ring |
| `create_image_pro` @64px | 20, and it returns **16** candidates |
| `create_8_direction_object` | 20 |
| `POST /create-1-direction-object` @64px | cheap; returns 16 candidate frames |
| `create_character` (`mode: pro`) | 20 |
| Utilities — unzoom, reduce colors, pixel art correction, remove background | free |

`animate_object` at one generation a direction is the best value on the price
list by an order of magnitude, and a static ring that never gets a walk is the
most wasteful thing on the account.

### Enumerating and recovering an account

Not documented by PixelLab and worth keeping:

- `GET /v2/balance` — `subscription.generations` is what remains.
- `GET /v2/objects`, `/v2/characters`, `/v2/tilesets` list everything. `limit`
  is capped at 100. **There is no `/v2/images`**, so loose Pro icon candidates
  are only recoverable from a job id you wrote down.
- `GET /mcp/objects/<id>/download` returns a **zip** for a multi-direction
  object and a **bare PNG** for a 1-direction one. `tools/pixellab-object.ts`
  assumes the zip and dies on the PNG with "not a zip"; 1-direction objects go
  to `assets/pixellab/env/` instead.
- `GET /v2/tilesets/<id>` returns **16 loose base64 tiles and no spritesheet and
  no bounding boxes** — unlike the create response, which carries both. So a set
  generated in an earlier session cannot be recovered by hand.
  `tools/pixellab-tileset.ts` composes the sheet and synthesises the boxes.

## What the tools actually do

Grouped as the app groups them. Cost in generations.

### Create
| Tool | Cost | What it is good for |
|---|---|---|
| **Create from style reference (Pro)** | 20 | **The workhorse.** Takes up to 4 style images + a per-image instruction, returns a 4×4 grid of 16 variations. Every icon in this project came from here. |
| Create S-XL image (Pro) | 20 | Single high-quality image, optional reference + style slots. Use when you want one thing, not sixteen. |
| Create S-XL image (new) | 1 | Newer model with explicit outline and detail controls. Untested here. |
| Create M-XL image | 1 | Cheap. Fine at 64px+, noticeably weaker silhouettes. Good for throwaway exploration. |
| Create S-M image | 1 | 16–64px range. |
| Create 8-directional sprite (Pro) | 20 | Eight directional views of one character/object — the shape the game's rig wants. |
| Create tiles (Pro) | 20 | Tile variations. Relevant if we ever extend terrain. |
| Create UI elements (Pro) | 20 | Game UI components. We do **not** need this: the UI is HTML/CSS paper, deliberately. |
| UI Template (Pro) | 20 | Shape a template, get matching UI pieces. Same answer. |
| **Portrait ↔ Character (Pro)** | 20 | Portrait→character or character→portrait. **This solves the class-portrait gap** — see below. |
| Create pixel font (Pro) | 20 | Pixel font atlas + .ttf. Not needed; Silkscreen and Rye are doing the job. |
| Image to pixel art (+ Pro) | 1 / 20 | Convert any image to pixel art. |

### Transform
| Tool | What it is good for |
|---|---|
| **Edit image / Edit image (Pro)** | Inpainting. Fix one wrong detail instead of re-rolling and losing the parts that were right. This is the cheapest quality lever we have. |
| Image to image | Depth-guided transform. |

### Animate
| Tool | What it is good for |
|---|---|
| **Generate 8 rotations** | 8 directional views from one reference. The path from a static generated prop to a real field object. |
| **Animate with text (Pro)** | Add an animation to an existing image. Walk cycles for new creatures. |
| Create animated object/character (Pro) | Animation from text, from scratch. |
| Interpolate | Tween between two frames. |
| Edit animation (Pro) | Modify frames of an existing animation. |
| Transfer outfit to animation (Pro) | Apply an outfit to another animation. |

### Utility (free, and you should use them)
| Tool | What it is good for |
|---|---|
| **Pixel art correction** | Cleans up soft edges and off-grid pixels. Run it on anything that looks blurry. |
| **Unzoom** | Detects the real pixel scale and downscales. Run it when a "64px" image is secretly a 32px image at 2×. |
| **Reduce colors** | Quantise to fewer colours — the tool for forcing generated art onto the LimeZu palette. |
| Remove background | Background removal, if you forgot the checkbox. |

## The recipe that works

This produced all 24 icons, and it is worth following exactly.

1. Tool: **Create from style reference (Pro)**.
2. Style image: `handoff/pixellab/limezu_style_256.png` — a 4×4 sheet of 16 real
   LimeZu 32×32 icons, assembled specifically as a style anchor. Reuse it. Do not
   rebuild it casually; the cohesion of everything generated so far depends on it.
3. In that image's own instruction box:
   `use this art style, palette, outline weight, shading and colour count`
4. Description: **the subject only**, in plain words.
   `a brass cow bell with a worn leather strap`
   Nothing about palette, outline, "no text", or view angle — the style image
   already carries all of it, and a long style suffix actively fights it.
5. Remove background: on. Output 64×64 → 4×4 grid of 16 variations.
6. Pick one cell. Reject anything you cannot identify at thumbnail size — that is
   the entire job of an item icon.

**Evidence this matters:** the same cow bell prompt without the style image came
back cold blue-grey; with it, warm brass in the pack's palette. One control, most
of the quality.

## What is in this folder

```
handoff/pixellab/
  API_PIPELINE.md        generation settings + the post-process. Read this first.
  tools/pixellab-cut.ts  the post-process, runs on tools/png.ts, no new deps
  limezu_style_256.png   the style anchor — 16 LimeZu icons, 4×4 of 32px
  limezu_character_ref.png, limezu_style_char_128.png   character anchors
  sheets/<name>.png      the full generated sheet, 256×256, 4×4 grid of 64px
  picked/<name>.png      the cell we chose, cropped and trimmed to content
  character/farmhand/    The Hand — 8 idles + 8 walk strips, already on 32×64 cells
  MANIFEST.md            every sheet: subject, cell picked, item it serves
  NEXT_ASSETS.md         what to generate next, in priority order
```

Sheets are kept, not just the picks. The other fifteen cells are free variants —
when a design wants a second bell, or a different lantern, it is already paid for.
Several sheets also contain a better cell than the one we took; a future pass can
change its mind without spending anything.

### Where these should land in the repo

```
assets/pixellab/sheets/     ← handoff/pixellab/sheets/     (source, never deploys)
assets/pixellab/picked/     ← handoff/pixellab/picked/     (what the atlas packs)
assets/pixellab/character/  ← handoff/pixellab/character/  (8-direction sheets)
tools/pixellab-cut.ts       ← handoff/pixellab/tools/      (the post-process)
```

That matches how the licensed packs are stored: source under `assets/`, and
`art/sprites.json` as the only place file paths appear. Add one `sprites.json`
entry per picked sprite, then `npm run atlas`. The atlas already packs 1,180
frames; 24 more is a build step, not a decision.

Generated art is ours and commercially licensed, so unlike `assets/`, there is no
reason it cannot be committed.

## Naming

`snake_case`, the object's plain name, no prompt text, no timestamps, no model
name. `cow_bell.png`, not `pixellab-a-brass-cow-bell-with-a-worn-l-1786742769126.png`.
Sheet and pick share the name. The item key in `items.json` stays camelCase —
`weatherVane` → `weather_vane.png` — because that is the existing convention on
both sides.

## What to generate next

In priority order. Costs assume Pro at 20 generations.

**1. The five borrowed field families — 100 generations.** These are marked
`_atlas: "NEW ATLAS KEY"` in the roster JSON and are currently standing in with
sprites that mean something else. They are *field* art, so they need the 32×32
rule and directional frames:

- the barn dog (companion) — generate one side view, then **Generate 8 rotations**, then **Animate with text** for the walk
- the Whitacre Bull (legendary minion) — same pipeline, bigger
- a gas cloud (Crop Duster's trail, Iron Lung, the gas grace period)
- the crop duster biplane (needed as a card hero and possibly a flyover)
- a salt ring on dirt — done as a card icon, still wanted as a ground decal

**2. Infected livestock — 60 generations.** The HUD mockup recolours ordinary
chickens with a CSS filter, which is a placeholder and looks like one. Three
proper enemy sheets — infected hen, infected rooster, infected hand — would fix
the single weakest thing in pass 4. Use **Create 8-directional sprite (Pro)**.

**3. Class portraits — 120 generations.** The brief wanted the Portrait Generator
used; it only ships at 16×16, so it was unusable. **Portrait ↔ Character (Pro)**
does the same job from the other direction: feed it the generated character sheet
frame for each of the six classes and get a portrait in that character's own
style. This is the single biggest visual upgrade available to the class-select
screen.

**4. The two Homestead signs — 40 generations.** The Seed Catalog and the County
Fair are still borrowing icons (a grain sack and a star). A seed catalogue and a
prize rosette would finish that screen.

**5. Two legendary card heroes on S-XL at 320px — 40 generations.** Sunday Best
and The Reaper's Own carry the biggest moments in a run and deserve art that is
not a reused tool sprite.

Total: about 360 of 2,000, leaving room for re-rolls and whatever the next design
pass turns up.

**Do not spend on:** UI components (the UI is deliberately HTML/CSS), pixel fonts,
terrain tiles (LimeZu's are better and already integrated), or class *character
sheets* — `npm run characters` composites those from licensed pieces in the game's
own rig, for free, and PixelLab cannot match that rig.

## Cautions

- **Keep the style anchor.** Everything generated so far is cohesive because it
  came through one style image. A new anchor means a new look.
- **Card icons are exempt from the 32×32 rule; field art is not.** Item icons
  only ever appear on cards, which draw at any integer zoom, so 64px is fine and
  better. Anything that appears on the game field must be 32×32 — generate larger
  and use **Unzoom**, or generate at 32 directly.
- **Trim before use.** Generated sprites arrive centred in a box with uneven
  margins, and background removal leaves an alpha 1–8 fringe — trim at **alpha
  above 8**, not above 0, or every sprite keeps a one-pixel halo and lands off
  centre. Character frames additionally need placing on a 32×64 cell with the
  feet on y=52, or they bob through the walk cycle. `tools/pixellab-cut.ts`
  does both.
- **Strips are driven by `background-position` in pixels, never percentages.**
  A percentage offset on a 6-frame strip renders frame 0 and then five blanks.
- **Stand a new character next to the player before accepting it.** The first
  farmhand was better pixel art than LimeZu's farmer and unusable, because the
  proportions belonged to a different game.
- **The API key is not in this repo.** If you wire up the MCP server or the REST
  API, read it from the environment.
