# Handoff — read this first

You are picking up **Ranch Defense Force**, a wave-based bullet-heaven on a farm.
TypeScript + Vite + Canvas 2D, no engine. The repo is public.

**Read in this order. Nothing else at the root is required reading.**

1. `CLAUDE.md` — the non-negotiables. Fixed timestep, zero allocation in the hot
   loop, seeded RNG, content-not-code for every tunable, 32×32 art only.
2. `NOTES.md` — what was built, session by session, and every bug that cost real
   time. Long, and worth it.
3. `docs/ART_STYLE.md` — **the house style, and what every asset is generated
   against.** Camera, scale, palette, and the per-tool recipes that work. The
   art is ours now; the LimeZu packs were a starting point, not a commitment.
4. `docs/DESIGN_STATE.md` — **the current state of the UI.** If a handoff
   document ever disagrees with this file, this file is right.
5. `docs/DESIGN_LANGUAGE.md` — the Paper & Pin spec the UI is built to.

`docs/archive/` is superseded briefs. **It is not the state of anything.**

---

## Where the work stopped

**Every screen is in Paper & Pin.** The shop and the Homestead were the last two
and they are converted. Both backdrops are layer-for-layer ports of Design's own
reference scenes.

| Screen | State |
|---|---|
| Home / class select | Ported from `docs/reference/` and **compared against it on screen.** |
| Level-up | Built. |
| Pause | Built. |
| Results | Built. |
| HUD | Built. |
| Shop | Converted — the same packet priced, plus the kraft counter. |
| Homestead | Converted — the yard, four staked signs, purchase cards. |

### The immediate next task

**Play it.** Every screen is built and both scenes have been compared against
the reference on screen. What has never happened is a person holding the
controls since the art landed, and that is now the only milestone left.

To compare a scene against its reference again: the two `docs/reference/*.html`
files will not load through the Vite dev server — Vite tries to transform them
as HTML entries and throws a parse overlay over the game. Serve them from a
throwaway static server on another port instead. `F1` toggles the dev overlay;
the scene toggle bottom-right flips backdrops without a reload, and you need it —
the two scenes are composed differently and only one is on screen at a time.

### The one thing that has gone wrong twice, in the same way

Both times the scenes were built, they were built from
`docs/mockups/PLACEMENTS.md` — which is an index of the scenes' **sprites**, and
nothing else. No sky, no sun, no ground, no barn, no farmhouse, no porch light,
no walking actors, no vignette: those are CSS layers and the table does not have
them. A build made faithfully from it measures correct against the table and is
missing two thirds of the picture.

**`docs/reference/*.html` are the scenes.** They are self-contained; extract the
`<script type="__bundler/template">` payload and you have the literal source.

---

## The six rules that have cost real time

Every one failed **silently**.

1. **The atlas trims every frame to content bounds.** Right for a sprite drawn
   from a pivot; wrong for anything drawn from a BOX, tiled or stepped. A 192px
   six-frame strip packs to 188px and `steps(6)` slides; a 32px tile packs to
   26px and every repeat gaps; a 96×96 scarecrow packs to 84×78 and stands 12px
   left of where the design put it. Use the `noTrim` group flag.
2. **Strip offsets are pixels, never percentages.** `-600%` on a six-frame strip
   lands frame 0 and then five blanks.
3. **Adding to a namespace someone already owns fails silently.** Six times so
   far — the newest being two `window.rdf` handles that overwrote each other, so
   which one the console gave you depended on whether a run had started.
   **Grep the name before you choose it.**
4. **Screens are built at module load; the atlas resolves later.** Anything that
   draws sprites must rebuild when the art lands, or it renders empty.
5. **Integer zoom only.** If a mockup draws something at half scale, move it
   further away rather than scaling it.
6. **A CSS shorthand followed by a longhand that overwrites its payload is
   invisible.** `background: var(--paper)` puts the gradient in the image slot
   and resets the colour to transparent; the `background-image` on the next line
   replaced the gradient. Every level-up card was 94% see-through for two
   milestones. Paint a flat colour under any layered background.

And the meta-rule, which has held seven times: **when a tool reports something
surprising, check the tool before the game.**

---

## Art pipeline

PixelLab is live, paid, and wired two ways.

- `npm run pixellab -- --list` prices a run for free; without `--list` it
  generates everything in `art/pixellab-queue.json` that has no sheet yet. Needs
  `PIXELLAB_API_KEY` in the environment.
- The **MCP server** is configured in `.mcp.json` (gitignored; template at
  `.mcp.json.example`) and needs no key in the shell. It reaches the tools the
  batch script does not wrap — 8-direction sprites, rotations, tilesets,
  animation, Portrait↔Character.
- `npm run fetch -- <job-id> <name>` pulls a finished job's candidates down plus
  a 4-across contact sheet, then `npm run cut -- single <src> <dst>` trims one.

Three things the queue now records that will save you real generations:

- **The concurrency limit is 8 jobs, not a time window.** A ninth is refused.
  There is no cooldown — the batch lands in about nine minutes and the slots
  free.
- **The style anchor is a sheet of farm produce.** `style_copy` defaults to
  including `detail`, which drags the anchor's SUBJECT across: the first oak came
  back as four pumpkins and an onion. For anything larger than a hand-held
  object, pass `style_copy` without `detail`.
- **64×64 is the sweet spot.** Pro returns 16 candidates at that size, 4 at
  128px and 1 above 170px, all for the same 20 generations.

Read `docs/PIXELLAB_API_PIPELINE.md` before generating; character work is
`docs/PIXELLAB.md`.

---

## Commands

```bash
npm run dev        # the game
npm run atlas      # regenerate characters + repack the atlas. Run after any art change.
npm test           # 131 tests, including a headless full-run acceptance test
npm run typecheck  # game and tools have separate tsconfigs
npm run build      # atlas + typecheck + production build
npm run fetch      # pull a PixelLab job's candidates + a contact sheet
npm run cut        # trim one candidate onto the game's grid
npm run zoom       # render the home scene at several target heights
npm run range      # every weapon firing, on one contact sheet
npm run shot       # headless screenshot of a real run
```

`F1` in game toggles the dev overlay; `N` skips a wave.

**Verify in the browser.** Types and tests pass happily while a screen renders
blank or see-through — five of the six silent bugs above were found by looking,
not by running. `window.rdf` in dev builds exposes the live world, renderer,
atlas, save, and every screen object, so a UI change can be driven directly
without grinding to it.

---

## Outstanding, roughly in order

1. **A human playtest.** Still nobody has held the controls since the art
   landed, and the last time one did they found a blocking bug no test caught.
   This is also M8's acceptance criterion — "a competent player clears Tier 1 in
   about six runs" — and it is the only milestone left.
2. **Two staged sprites want a renderer change, not a card slot.** The gas cloud
   and the salt-ring decal are trimmed in `assets/pixellab/picked/` and wired to
   nothing, because the FX they would replace are animated clips rather than
   static frames. Threshing Floor is the one item still on borrowed art and has
   nothing generated for it at all.
3. **Ten animals are finished as art and not packed.** Eight rotations and a
   nine-frame walk in each of eight directions, in
   `assets/pixellab/object/<name>/`: the fjord pony, arabian, draft mule and
   donkey; the Barn Dog and the Whitacre Bull; and the four infected livestock.
   Nothing references any of it. **This is the single biggest ready-to-go item
   on the list**, and what remains is engineering rather than generation.

   **Three of the four blocking decisions are now measured** — run
   `npm run animal` to reproduce, and see `_howToWireIt` in the queue:
   - *Direction mapping:* `south→down, north→up, west→left, east→right`. Not a
     new order at all; it is what `compassToDirection` already ships.
   - *Frames:* 8 directions × 9 frames, against LimeZu's 6. A manifest entry,
     not a renderer change.
   - *Size:* the widths already agree within ~13%. The heights do not, because
     **LimeZu draws its animals from a high top-down and these are nearly
     side-on.** That is a camera mismatch and a scale factor will not fix it.

   **Start with `barn_dog`** — +7% wide and +5% tall against the `feralDog`
   already on the field, and a weapon minion rather than an enemy, so a wrong
   call is cheap. One dog in a real run decides whether the other nine want
   re-generating at LimeZu's camera height.

   *Still open, and it is a judgement rather than a measurement:* four
   directions or eight. The renderer buckets velocity into four; eight is a
   change there, not in the art.
4. **Listen to the new music in a real run.** The three CC-0 tracks were chosen
   from the pack's metadata — tags, energy, duration, the author's own score —
   which means they were chosen by reading, not by ear.
5. **M7 meta progression is built and untested by real play** — save, acres,
   four Homestead buildings, six classes, County Fair tiers.

**If a generation comes back refused, check WHICH layer refused it.** One did,
once, and it was the Claude Code permission classifier rather than PixelLab —
the prompt never reached the API. Retrying the identical request went straight
through. Rewriting the wording would have been solving the wrong problem.

## The next phase, from the first real playtest

Four things the owner asked for after playing. None is started; all four are
described here so the work can begin without re-deriving the problem.

### 1. The weapon ring does not feel like Brotato, and the reason is presentation

The owner: *"I don't like the weapons just attached to a circle surrounding him."*

**The mechanism is already right and does not need rewriting.** The sim owns
`ringAngle`, `aimAngle` and `recoil` per slot; weapons already track their target
and kick when they fire. What is wrong is how it reads, and it is five specific
things rather than one:

1. **Even spacing at a constant radius reads as an ORBIT, not as carried gear.**
   This is the big one. Brotato clusters weapons close to the body, biased to the
   sides, overlapping the sprite — the axe in this game literally orbits, and
   everything else currently looks like it does too. Weapons should sit at a
   *held* distance, unevenly, not at equal arc on a circle.
2. **They float at head height.** Anchor them near the torso. The screenshot the
   owner sent has a pitchfork hovering above the hat.
3. **No z-ordering against the body.** Aiming up should put the weapon BEHIND the
   character, aiming down in front. This single change does more for "held" than
   anything else on this list and is a draw-order decision, not new art.
4. **The rotation origin is probably the sprite centre.** A weapon must pivot
   about its GRIP or it pinwheels. The atlas records a bottom-centre pivot; a
   weapon wants a different one, and it likely belongs in `weapons.json`
   alongside `projectileScale`.
5. **Firing is not visually distinct from aiming.** A kickback is too subtle.
   Melee wants a real swept arc (the renderer already draws swings as volumes —
   see session 3), ranged wants a muzzle flash on the weapon itself.

Do 1 and 3 first and judge before touching the rest; they are cheap and they are
most of the feel. `npm run range -- --mode stack` renders 1–6 weapons at once and
is the rig built for exactly this question.

### 2. Every character needs a full animation set

The owner likes the rooster and its placement, and wants it to walk, peck and
crow rather than stand. Generalised: **every character wants idle / walk / and at
least one behaviour clip**, not a single frame.

PixelLab does this — `animate_object(mode="v3")` is one generation per direction,
and `create_character` + the animation presets cover humanoids. See
`_eightDirNotes` in the queue for what a walk actually costs and the 8-job
concurrency limit. Note this compounds with the ten animals already generated and
not packed (item 3 above): decide **four directions or eight** before generating
more, because it doubles or halves everything that follows.

### 3. The home screen should flash to the cursed version

The owner's idea, and it is a good one: occasionally the home scene cuts — a
lightning strike, a switch to night with real emphasis on the stars — to the
**infected** version of the same cast standing in the same places, for a second
or two, then back.

This is worth doing well rather than quickly. The scene is already a stack of
CSS layers in `src/ui/scene.ts` with a night-to-dusk sky gradient, so a second
palette and a swapped sprite set is genuinely tractable. The infected farmhand
already exists; `_horrorPlan` in the queue is about generating the rest of the
cast FROM their healthy counterparts, which is exactly what makes a
before-and-after read as the same animal. **Do `_horrorPlan` first** — the flash
is only frightening if the cursed cast is recognisably the same cast.

### 4. Saves do not survive clearing browser data, and cannot be made to

Asked directly, so answered plainly. The Homestead save is one versioned JSON blob
in `localStorage` under `rdf.save` (`src/sim/save.ts`), storing purchases rather
than derived values, with migration and clamping on every read. It is well built
and it survives closing the tab, restarting the browser and updating the game.

**It does not survive "clear cookies and other site data", and no browser storage
does.** localStorage, IndexedDB and the Origin Private File System are all cleared
by that setting. There is no API that persists through it.

The real answer is **export/import**, and it is small: the save is already a
compact JSON blob, so a "copy your homestead" button and a paste box on the
Homestead screen is perhaps thirty lines, needs no backend, no accounts and no
privacy surface, and survives anything including moving to a different machine.
A file download/upload is the same feature with a nicer skin. Cloud sync is the
only thing that beats it and it costs a server, auth and a privacy policy.

Recommend export/import, and recommend it before the game is shared with anyone,
because the first person to lose a Homestead to a browser clean-up will not
report it as a bug — they will just stop playing.

## The owner's standing creative direction

**"A ranch where crop dusters have turned everyone zombies/cursed."** That is the
premise, and the note it keeps getting is that the game does not lean far enough
into it. Weigh every generation against it.

The one piece of horror that landed is the infected farmhand, and it landed
because of HOW it was made — see `_horrorPlan` in the queue. The four infected
animals came back "only mildly diseased: the hog reads as a spotted pig and the
sheep as an ordinary sheep in grey." Prompt horror is not enough on its own; the
reference image dominates. `create_object_state` on the healthy animal, with the
disease in the EDIT rather than the prompt, is the lever that actually works.

### Tiles before maps — the floors are the biggest single visual win

The owner, in as many words: *"Before we create more maps, let's generate a bunch
of tiles so the floor can be more detailed and not so blocky."* Right, and it is
the highest-leverage art left, because the ground is the largest surface on
screen and it is currently one flat grass tile scattered with dirt and soil.

**`create_topdown_tileset` is the tool and it changes the renderer, not just the
art.** It returns a 16-tile Wang set with corner-based autotiling — the thing
that makes ground stop looking blocky is the TRANSITIONS, and those only exist
if the terrain bake picks a tile from its four corner values instead of dropping
one sprite per cell. That is a real change in `renderer.ts`'s bake and it is the
work; the tiles themselves are cheap.

Three sets are generated and waiting (dirt→pasture, blighted ash→dying grass,
furrows→crop rows). Tilesets also chain: pass a completed set's base tile id as
`lower_base_tile_id` and the next set connects to it seamlessly, which is how a
map gets several grounds that all belong together.

**This lands before `_mapsAndTilesets`, not after.** A map descriptor with one
flat tile per biome buys nothing; the same descriptor over Wang sets is the
feature the owner is actually asking for. The RNG-ordering trap in that entry
still applies.

### Cards and rarity in real art

Agreed with the owner and scoped by the PixelLab UI test (see NOTES session 11):
**generate the small fixed-size chrome — rarity/rank plates, buttons, the punch
and clip — and leave the paper surfaces as CSS.** Paper is a gradient plus a
0.12 dot layer that scales to any card or sheet for free; a raster panel at one
size fights both the layout and the pixel grid. The stamped tin plate is the
opposite: fixed size, never scales, and CSS cannot make it look struck.

## Logged, not started

- **`_horrorPlan`** in the queue: make the whole cast scary the way the farmhand
  already is, generating each horror version FROM its healthy counterpart so the
  two read as the same animal before and after.
- **`_mapsAndTilesets`** in the queue: more maps. Note that **the seed does not
  currently pick a map** — there is one arena and one tileset. Making it pick one
  means the map choice has to be the FIRST draw off the RNG, or every existing
  seed stops replaying.
