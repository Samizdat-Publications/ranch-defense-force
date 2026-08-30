# The house style

**We generate our own art now.** The LimeZu packs were a $5 starting point, not a
commitment, and the owner is explicit that nothing in them is sacred. That
changes three things that used to be constraints and are now just decisions:

- We pick the camera instead of matching one.
- We pick the palette instead of matching one.
- `assets/` stops being a licensing special case as the pack art retires.

This file is what we generate against. **Read it before making any asset.**

---

## The three decisions

### 1. Camera: **low top-down**

Roughly 45°, so you see faces, chests and silhouettes.

Chosen because **horror needs a face.** The premise is a ranch where the crop
dusters turned everyone; a cursed animal's sunken eyes and slack jaw are the
whole payload, and a high top-down view looks at the top of its head. It is also
what Brotato and Vampire Survivors use, and — conveniently — what all sixteen
generated animals already are, so it costs no regeneration there.

The cost is paid on the ground, which was generated `high top-down` and is being
redone. Cheap: about a minute per tileset.

> Every object and tileset call passes `view: "low top-down"`. It is not safe to
> omit: `create_8_direction_object` defaults to low top-down, but
> `create_topdown_tileset` defaults to **high**, so the tileset calls are the
> ones that must say it out loud.

### 2. Scale: **32px grid, character 32×64**

The atlas, the 64px collision hash, the terrain bake and the 2× integer camera
zoom are all built on 32. Nothing about bigger sprites is worth re-tuning all of
that, and a bullet-heaven wants MORE things on screen rather than larger ones.

Animals are deliberately bigger than the grid — 56–68px — and that is correct. A
bull should dwarf you. The grid is the unit, not a cap.

**Integer zoom only.** If something should look smaller, it moves further away.
Scaling pixel art by 1.5 is how it stops being pixel art.

### 3. Palette: **muted daylight, sick green when cursed**

The healthy farm is warm, dusty and desaturated — believable afternoon light.
The cursed version shifts to grey-green rot with sickly yellow eyes.

**The horror works because it is a departure.** If the whole game is already
vivid, or already dark, a ruined animal is just another loud thing. The contrast
is the mechanism, and it is the owner's own framing: *basic Stardew during the
day, the infected version at night.*

    healthy   dusty sage green, pale brown earth, warm straw, weathered timber
    cursed    grey-green rot, ashen soil, raw grey skin, sickly yellow eyes

**`art/palette.json` is that palette, and it is AUTHORED — not extracted.** It
used to be 32 colours k-means'd out of the LimeZu sheets, which was right while
LimeZu was the art and is wrong now.

This matters more than it sounds, because **the generator will not give you a
muted palette by asking.** `create_topdown_tileset` has a hard prior for bright
saturated green; "dry muted sage green, dusty, desaturated" still comes back
arcade. Quantising is the answer, and quantising through the OLD palette made it
worse — conform matches a palette, it cannot shift one, and a palette sampled
from LimeZu is full of saturated green, so the nearest entry to a bright green
was a bright green.

With an authored palette, conform delivers the house look whatever the model
returns. That is the only reliable way to get consistency out of a generator
with its own opinions, and every generated tileset now goes through it.

**Coverage beats taste when editing that file.** A quantiser sends every pixel
to its nearest entry, so a missing region lands somewhere absurd — session 3
lost a day to an explosion turning magenta because nothing in the palette sat
between hue 20 and 40. The cursed greens in particular must stay distinct from
the healthy pasture greens, or a diseased animal quantises back into a healthy
one.

---

## Recipes that work

Everything below was measured, usually by getting it wrong first.

### Ground tilesets — `create_topdown_tileset`

    detail: 'low detail'      shading: 'flat shading'
    outline: 'lineless'       text_guidance_scale: 15
    tile_size: 32             view: 'low top-down'

**Ask for a TEXTURE, not a scene.** "Dry cracked dirt with small stones and tyre
ruts" is a scene, and it comes back as a *pattern* — literally purple paving.
"Bare earth, smooth, matte, almost featureless" comes back as ground.

**Then keep that noun and change ONLY the colour.** Session 13 spent seven
tilesets learning this. The blight ground had to be a dead version of the
pasture, and every way of naming the SUBSTANCE failed:

| asked for | came back as |
|---|---|
| `dead ash, smooth, matte, almost featureless` | grey rock ledge with a cliff edge |
| `cold grey ash, smooth, matte, almost featureless` | rubble |
| `dead grey-green rot, smooth, matte, almost featureless` | rubble with a repeating motif |
| `flat grey-brown dead ground, powdery, ...` | brown with a regular bump pattern |
| `sickly yellow-grey withered dead grass, ...` | warm straw with a rust rim line |
| **`bare pale grey-green earth, smooth, matte, almost featureless`** | **ground** |

The model hears "ash" or "rot" and draws stones. It hears "bare earth" and draws
a floor. The winning prompt is the known-good one with one word swapped.

**Negative prompts make it WORSE, which is the opposite of the instinct.** An
eighth attempt asked for `perfectly flat, uniform colour, no texture, no
speckles, no marks, no detail` and came back MORE mottled than the plain request
it was trying to improve on, with stray red pixels. Do not enumerate what you do
not want in a tileset prompt.

**Judge the terrain EDGE, not only the fill.** Two otherwise-good sets were
rejected for a hard bright rim line along the boundary tiles — invisible in the
16-tile sheet thumbnail and a drawn-on outline once it is on the field. Extract
`wang.<set>.1100` and `.1000` and look at them.

`lineless` is the single most important setting: `selective outline` draws a hard
dark rule around every terrain edge, which is exactly the blockiness the tiles
exist to remove. `highly detailed` at 32px does not mean more texture, it means
more STRUCTURE, and structure on a floor tile is a repeating motif you can count.

**The ground should be boring.** It is what two hundred enemies and their bullets
are read against. Interest belongs in props and decals on top of it.

**Chain sets** by passing a finished set's `upper` base tile id as the next set's
`lower_base_tile_id`; the two then share that terrain exactly. Every ground set
should chain off one canonical grass.

### 8-direction objects — `create_8_direction_object`

`view: 'low top-down'`, and pass `style_object_id` pointing at an existing
finished object to keep the family consistent. Note that a style object
**overrides the view** — if you are testing a camera angle, pass no style
reference or you will measure nothing. That mistake cost one inconclusive test.

`reference_image_base64` is intermittently truncated in transit, and 3898 bytes
is a payload size that has now failed twice. Prefer `style_object_id`; if a real
reference image is needed, expect to retry.

### Characters — `create_character`

    mode: 'pro'          size: 64
    view: 'low top-down' style_character_id: <the anchor>

**`size` IS THE CANVAS, NOT THE CHARACTER, and getting that wrong is what made
the infected farmhand too small.** PixelLab leaves motion room around the
figure, so the sprite occupies roughly **76% of the canvas height**:

    size 46  ->  19x35 content   (what the old farmhand was: visibly a child
                                  next to a 32x46 LimeZu character)
    size 64  ->  30x52 content   (the house setting)

At 64 the figure is 30x52 against LimeZu's 32x46 — near-identical width, a
little taller, and it still fits the 32x64 cell with feet on the y=52 baseline
that `pixellab-cut.ts` places to. **Every character is generated at 64.**

**One anchor, then `style_character_id` for everyone else.** `pro` is the only
mode that accepts it, and it is what keeps six classes and the enemies looking
like one artist drew them. Generate the anchor first, look at it, and only then
batch the rest — a bad anchor is six bad characters.

`create_character` also exposes a large library of TEMPLATE animations (`walk`,
`walking-6-frames`, `breathing-idle`, `scary-walk`, `falling-back-death`…), so a
walk cycle is a named template rather than a described motion.

### Portraits — `create_portrait_character`

`direction: 'character_to_portrait'` turns a finished character sprite into a
bust portrait. The class cards get portraits that match their sprite **by
construction** rather than by prompting twice and hoping.

### Scenery — `create_map_object`, NOT `create_1_direction_object`

**The reason is the camera and it is not negotiable.**
`create_1_direction_object` only accepts `view: 'top-down'` or `'sidescroller'`;
`create_map_object` accepts `'low top-down'`, which is what this file commits
every asset to. A prop generated at the wrong camera is invisible on its own and
obvious the moment it stands next to the cast.

    detail: 'medium detail'   shading: 'basic shading'
    outline: 'single color outline'   view: 'low top-down'

**Map objects auto-delete after eight hours.** They are not a library to come
back to. `npm run mapobj -- <id> <name> ...` pulls them into
`assets/pixellab/env/`, and it takes many pairs, so a whole batch is one call.

**Check the BASE of every prop.** About a third arrive standing on a disc of
soil or grass the prompt never asked for. That is invisible on pasture and
obviously wrong on ash. `isolated on nothing, no grass, no ground, no soil, no
shadow` fixes it but not reliably — the same wording worked for an oak at canvas
192, failed for a broken tree at 128, and worked for it at 96.

### Animations on an object — `animate_object`

**`mode: 'v3'` is the default and you want it.** `pro` costs 20–40 generations
PER DIRECTION — 160–320 for a full eight — where four cardinals of v3 across
five animals cost about two generations in total. It is also the better output.

- **It keeps its input as frame 0**, so `frame_count: 8` stores NINE frames.
  `clipLengths` in the atlas is per-sheet for exactly this reason.
- **Generate four directions, not eight.** The renderer buckets facing into
  four; `directions: ['south','north','east','west']` halves the cost and
  `animation_group_id` extends it later if that ever changes.
- **The folder name comes from the DESCRIPTION, not `display_name`.** Passing
  `display_name: 'walk'` still lands the frames in
  `animations/walking_with_a_stiff_lurching_limp/`. Record the real slug.
- **Prompt the gait.** "a stiff lurching limp", "a laboured stagger", "a slow
  bloated waddle" cost the same as "walking" and read differently in motion.

### Cursed variants — `create_object_state`

Takes a finished object, applies an edit, and returns a new object **with all
eight rotations intact**.

**It does NOT carry the base object's ANIMATIONS across.** A cursed variant of a
walking animal arrives static, and that is what turned "wire the sixteen animals
that already exist" into a ten-walk-cycle job. Animate the variant separately. That satisfies the pairing rule by construction: the
cursed animal is derived from the healthy one, so the two read as the same
animal before and after.

**NAME THE COLOUR, NOT THE SYMPTOMS.** This is the lesson that explains why the
first batch of infected livestock "came back only mildly diseased".

- ✗ `matted patchy coat, ribs showing, green staining`
  → the white pony stayed white, the brown dog stayed brown.
- ✓ `the whole white coat turned filthy grey-green and diseased, fur sloughing
  away in bald patches showing raw grey skin beneath`
  → both came back properly sick.

An edit that only ADDS detail is resisted by the base image; an edit that
RESTATES the base colour replaces it. Dark animals curse easily because the
disease palette already sits near their coat. Pale ones have to be told.

### Animations — `animate_image`

Works on any loose sprite, needs no object id, and **a 64×64 8-frame animation
is one generation.** Sixteen animations across every frozen actor in both scenes
cost sixteen.

- **It keeps your input as frame 0**, so `frame_count: 8` returns NINE frames.
- **Feed it a URL, not base64.** The repo is public, so it is its own asset host:
  `raw.githubusercontent.com/<owner>/<repo>/<sha>/<path>`.
- `npm run anim -- <job-id> <name> [frames]` assembles the strip, compositing
  every frame **bottom-centred on a uniform cell** so feet do not travel.
- **Judge the contact sheet, never a single frame.** The failure mode is one
  frame belonging to a different animal — invisible alone, obvious in a row.

### UI — narrow, on purpose

Generate the **small fixed-size chrome**: rarity and rank plates, buttons, the
punch, the clip. Those are stamped metal at a fixed size, and CSS cannot make
them look struck.

Do NOT generate the large paper surfaces. CSS paper scales to any card for free
and cannot break — with one caveat learned the hard way: **stock is authored for
a shape.** The seed-packet gradient is a gentle wash down a tall card and a
visible band across a short wide one, and a 4px dot grid that reads as fibre at
210px reads as halftone at 300×130. A surface of a different shape needs its own
stock, not the same one stretched.

Two failures worth not repeating: the `elements` scaffold auto-positions badly
and silently drops pieces, and `no_background: true` **keys out light interiors**
— kraft fill gets eaten, leaving an outline with stains floating in nothing.

---

## Practicalities

- **Tier 2: 5,000 generations a month, 10 concurrent jobs, up to 512×512.**
- A tileset is ~100s; an 8-direction object 2–4 min; an `animate_image` 30–180s.
- **If a generation comes back refused, check WHICH layer refused it.** One did,
  once, and it was the Claude Code permission classifier rather than PixelLab —
  the prompt never reached the API, and retrying it unchanged went straight
  through. Rewriting the wording would have solved the wrong problem.

## Migration status

| Area | State |
|---|---|
| Ground tilesets | **Ours.** Low top-down, muted, chained off one grass. |
| Blight ground | **Ours.** `grass_to_blight`; spreads with the wave. |
| Field animals | **Ours**, except `duckFlight`. Cursed objects, 4 directions, 9-frame walks. |
| Characters | **Ours.** Six classes and five humanoid enemies. |
| Trees, rocks, ore | **Ours.** Blighted; `assets/pixellab/env/`. |
| Scene animations | **Ours.** Generated from the sprites already in the scene. |
| Crops | LimeZu — but the pack's own `_Rotten_` variants, which are right. |
| Buildings, fences, weapons, FX, boss vehicles | LimeZu. Not yet replaced. |
| UI | CSS, plus LimeZu's `panel.png` — which is dead and unreferenced. |

**One known palette gap.** `art/palette.json` has no light blue — its only blues
are three dusk-sky slates at value 24–38 — so anything pale and cold quantises
to cream. That is how an ore tier briefly went missing. Aim dark, or add a
mid-value cold blue and re-check every conformed group.

**Nothing here forces a big-bang replacement.** The atlas keys are stable, so art
swaps one manifest line at a time, and a missing sprite already degrades to a
coloured square rather than a crash.
