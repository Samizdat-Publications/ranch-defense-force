# PixelLab — generated art pipeline

**Status:** live, paid, in use. This is now a first-class asset source for the
project alongside the licensed packs, not an experiment.

Written for whoever picks this repo up next, including Claude Code.

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

| | |
|---|---|
| Service | PixelLab (pixellab.ai) |
| Tier | Tier 1 · Pixel Apprentice, $12/month |
| Budget | 2,000 generations/month |
| Max output | 320×320 |
| Licence | commercial use permitted |
| API | yes — REST, plus an MCP server for Claude Code |

Pro tools cost **20 generations** per run, ordinary tools cost **1**. So the real
monthly budget is about **100 Pro images** or 2,000 cheap ones. We have been
spending Pro on everything that matters; at 24 icons a month that is a quarter of
the budget.

The API key lives in the user's PixelLab account page. It is **not** in this repo
and must not be committed.

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
  limezu_style_256.png   the style anchor — 16 LimeZu icons, 4×4 of 32px
  sheets/<name>.png      the full generated sheet, 256×256, 4×4 grid of 64px
  picked/<name>.png      the cell we chose, cropped and trimmed to content
  MANIFEST.md            every sheet: subject, cell picked, item it serves
```

Sheets are kept, not just the picks. The other fifteen cells are free variants —
when a design wants a second bell, or a different lantern, it is already paid for.
Several sheets also contain a better cell than the one we took; a future pass can
change its mind without spending anything.

### Where these should land in the repo

```
assets/pixellab/sheets/     ← handoff/pixellab/sheets/    (source, never deploys)
assets/pixellab/picked/     ← handoff/pixellab/picked/     (what the atlas packs)
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
- **Trim before use.** Generated sprites arrive centred in a 64px box with
  uneven margins. Every pick in `picked/` is already trimmed to content bounds;
  do the same for new ones or they will sit off-centre in the card window.
- **The API key is not in this repo.** If you wire up the MCP server or the REST
  API, read it from the environment.

---

## The character builder — what it changes

Added after the first pass. This is the biggest capability in the subscription
and it was not being used.

The flow is **generate once, animate many**:

| Step | Endpoint | What you get |
|---|---|---|
| Make a character | `POST /create-character-with-4-directions` (or `-8-directions`, `-pro`, `-v3`) | A character in our reference style, plus a **character id** |
| Reuse it | `POST /create-character-state` | Another pose or variation of **the same character**, not a new one |
| Animate it | `POST /animate-with-text` (v2/v3 are Pro) | Any animation described in words — walks, swings, backflips, casts |
| Animate precisely | `POST /animate-with-skeleton` + `POST /estimate-skeleton` | Keyframe control when text is not exact enough |

**The part that matters is the character id.** Every animation is a state of one
character, so a walk, an attack and a death all come back as the same figure
rather than three drawings that happen to resemble each other. That is exactly
what an enemy sheet needs and exactly what generated art usually fails at.

### What this unlocks that we could not do before

1. **Infected livestock, properly.** Priority 2 in the queue. Right now the HUD
   recolours ordinary chickens with a CSS filter and it looks like it. One
   infected hen, generated once, then walk + attack + death as states.
2. **Enemies with real attack animations.** Every enemy currently walks and
   contact-damages. An animation per behaviour is now cheap.
3. **Class abilities that look like something.** `digIn` and `bolt` are stat
   effects with an FX clip over the top. "Plant your feet and brace" and "dash
   with i-frames" are both animatable in words.
4. **Weapon-specific player poses.** A farmer holding a scythe and a farmer
   holding a scattergun are currently the same sprite with a gun drawn beside it.
5. **Bosses.** The Duster and the Prize Bull deserve more than a walk cycle.

### The constraint to solve first

`art/sprites.json` has ONE humanoid rig: a 1792x704 sheet, 32x64 frames in
stacked row pairs, four direction bands in the order `right, up, left, down`,
with clips at fixed row pairs. Every humanoid in the game — player classes and
zombie enemies alike — is sliced by that rig, and the atlas builder asserts the
sheet dimensions and the band order before it will pack anything.

**PixelLab output will not match that rig.** It has its own frame count, its own
direction count and its own layout. So generated characters need a *second* rig
definition in the builder — a `pixellabRig` block naming the sheet geometry the
API actually returns — rather than being forced into the LimeZu one.

That is a contained piece of work, but it is real, and it should be done against
a genuine generated sheet rather than guessed from the docs. **Generate one
character first, look at what comes back, then write the rig.** Do not write the
importer speculatively; the last time this project assumed a sheet's geometry
from a spec instead of measuring it, `down` drew the right-facing pose for seven
milestones.

### Do not use it for

Player class *character sheets*. `npm run characters` composites those from the
licensed generator pieces in the game's own rig, for free, and PixelLab cannot
match that rig. Portraits are a different question and are still worth doing —
`Portrait <-> Character (Pro)` is the recommended path there.
