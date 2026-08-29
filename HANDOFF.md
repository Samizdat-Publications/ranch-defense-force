# Handoff — read this first

You are picking up **Ranch Defense Force**, a wave-based bullet-heaven on a farm.
TypeScript + Vite + Canvas 2D, no engine. The repo is public.

**Read in this order. Nothing else at the root is required reading.**

1. `CLAUDE.md` — the non-negotiables. Fixed timestep, zero allocation in the hot
   loop, seeded RNG, content-not-code for every tunable, 32×32 art only.
2. `NOTES.md` — what was built, session by session, and every bug that cost real
   time. Long, and worth it.
3. `docs/NEXT_SESSION.md` — **what to do next and in what order.** Start here if
   you are picking this up cold; it names the brief, the traps this particular
   work will hit, and what not to redo. It is rewritten every session — if it
   describes work you can see is already done, say so rather than doing it
   again.
4. `docs/ART_STYLE.md` — **the house style, and what every asset is generated
   against.** Camera, scale, palette, and the per-tool recipes that work. The
   art is ours now; the LimeZu packs were a starting point, not a commitment.
5. `docs/DESIGN_STATE.md` — **the current state of the UI.** If a handoff
   document ever disagrees with this file, this file is right.
6. `docs/DESIGN_LANGUAGE.md` — the Paper & Pin spec the UI is built to.

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

**It has been played.** The owner played the built game in session 15 and it
held up: *"I plaed it and it was great."* Two findings came out of it and both
are live work — the waves want more enemies each, and the class dropdown has
never been played through. `docs/NEXT_SESSION.md` carries the brief.

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
npm run contact    # pull frames OUT of the packed atlas — proves the whole chain
npm run contactdir # tile a directory of raw candidates onto one sheet, at a zoom
npm run animal     # the animal comparison table, at the game's zoom on real grass
npm run scale      # what a sheet actually measures, drawScale included
```

Three PixelLab drivers are committed and **all three need a live API key, which
this project no longer has**: `npm run mapobject` (batch `/map-objects`, the
cheap endpoint), `npm run rmbg` (strip an opaque card), `npm run object`. They
are kept as the record of what works and what it costs — see `docs/PIXELLAB.md`.

`F1` in game toggles the dev overlay; `N` skips a wave.

**Verify in the browser.** Types and tests pass happily while a screen renders
blank or see-through — five of the six silent bugs above were found by looking,
not by running. `window.rdf` in dev builds exposes the live world, renderer,
atlas, save, and every screen object, so a UI change can be driven directly
without grinding to it.

---

## Outstanding, roughly in order

**Everything below is current as of session 15. `NOTES.md` session 15 is the
detail; `docs/ART_STYLE.md` is what to generate against.**

**PixelLab is gone.** The subscription was cancelled at the end of session 15
with the balance spent to exactly 0, and the API key is dead. No new art can be
generated. Everything outstanding below is a *picking and wiring* job against
candidates already on disk — see `assets/pixellab/SESSION15.md`.

1. **The balance session.** This is the owner's own top note from playing it:
   *"Needs more enemies per wave to balance."* Performance is NOT the limit — the
   owner ran 200+ enemies alive several times and *"it all worked great"*, so
   `pressureCeiling: 380` in `waves.json` is a design choice to revisit, not a
   frame-rate one.

   **Start by moving the curve into content.** `threatBudget` is hardcoded in
   `src/sim/formulas.ts` as `30 + 22*wave + 1.4*wave*wave`, while
   `waves.json` carries `threatBudget.formula` as a string that **nothing
   reads**. The content file describes the curve; the code is the truth. Read
   those three coefficients from `waves.json` first and the whole session
   becomes editing content instead of editing code, which is what CLAUDE.md
   requires anyway. `waveScalar` has the identical split.

   The known trap, from session 12: raising the budget OR the spawn rate both
   fail `run.test.ts` on the identical budget, because density and player power
   are coupled. The fix is more enemies that are individually weaker across
   `enemies.json`, not a bigger number in one place.

   Also parked for that session: base move speed 160, crop density and feed
   value, damage-% items vs "merging IS the offensive game", late shops thinning
   to items only, elites being spawn-time only, and global hitstop.

2. **Play the six classes.** The owner: *"I didnt ge tto test all the models
   fromthe dropdown yet."* Six classes ship and only some have been played. A
   class that is unplayable or trivially dominant is invisible to every test in
   the suite.

3. **Finish retiring LimeZu.** Nearly done, and the remaining art is generated
   and waiting. The exact inventory and the picking notes are in
   `assets/pixellab/SESSION15.md`; the wiring order is in
   `docs/NEXT_SESSION.md`. Nothing forces a big-bang swap: atlas keys are
   stable, art swaps one manifest line at a time, and a missing sprite already
   degrades to a coloured square.

4. **Maps.** 29 Wang tilesets are packed and `tuning.json`'s `terrain` block
   already treats the ground set as content with per-blight-band sets. The owner
   wants a map to change **ground and tileset, node and enemy mix, arena size
   and shape, and hazards** — all four. Hazard and biome-node art was generated
   in session 15 for exactly this. The blocker is ordering: a map choice **must
   be the first draw off the RNG** or every seed stops replaying, and
   `run.test.ts`'s "replays a whole run identically from its seed" must keep
   passing.

5. **Save export/import.** Saves die when browser data is cleared and no browser
   storage survives that. ~30 lines, no backend. Do it before anyone else plays.

6. **Listen to the music in a real run.** Chosen from pack metadata, never by
   ear.

### What is generated vs what is still LimeZu — the exact table

Audited from `art/sprites.json`, not from memory. **The characters and the
animals are all ours now**, on an eight-direction rig with walk, attack and
death clips:

| | source |
|---|---|
| all 6 player classes | **GENERATED** |
| farmhand, acidZombie, bloatedFarmhand, maskedSprayer, maskedHauler | **GENERATED** |
| rooster, feralDog, sickHog, blownSheep, prizeBull | **GENERATED**, 8 directions |
| `duckFlight` (enemy), `duster` (wave-25 boss) | LimeZu — **art generated in session 15, not yet wired** |

Everything else still sourced from the LimeZu pack, with generated replacements
now sitting in `assets/pixellab/` unwired:

| manifest group | count | replacement |
|---|---|---|
| `scene` + `sceneStrips` | 25 stills | `assets/pixellab/yard/`, `yard_picked/`, and the five livestock in `field/scene_*` |
| `singles` (field crops) | 10 | `field/crop_*` — plus blighted variants that did not exist before |
| `weapons` | 8 | `field/weapon_*` |
| `vehicles` (`duster`) | 1 | `duster/` — 22 candidates across four facings |
| `animals` (`duckFlight`) | 1 | `field/duck_*` |
| `singlesExtra` (`pickup.heal`) | 1 | `field/pickup_heal_*` |
| `gasMaskIcon` | 1 | `field/icon_gasmask_*` |
| `terrainSource` | sheet | **no generation needed** — 29 Wang sets are already packed |
| `public/ui/panel.png` | 1 | `field2/ui_panel_1.png` (the only candidate with a real frame) |

`art/palette.json` is also k-means-extracted from the LimeZu sheets. That is a
derived palette, not distributed art, and it stays — it is authored now and
must not be regenerated.

Third-party packs that are **not** LimeZu and are out of scope for this:
`projectiles` (unTied Games), `icons-farm`, `icons-tools`, `icons-guns`,
`effects-fx`.

### Already wired, so you do not redo it

Sessions 12–15, cumulative. If something here looks undone, look again before
building it:

- **The ground autotiles** from Wang sets, chained off one grass, with **blight
  bands** that swap the ground set as the waves progress.
- **The palette is authored** and every generated group conforms to it — except
  the FX, deliberately, because the palette has no coverage for an electric blue
  arc.
- **The whole cast is generated** — 6 classes, the infected farmhand and 4
  enemies — at size 64, cut to a 32x64 cell with feet on **y58**.
- **The animals are generated and packed on an eight-direction rig**, with walk,
  attack and death clips. `directionIndex` is rig-aware: sheets absent from
  `dirSets` keep the humanoids' four, so that path did not regress.
- **Attack and death clips are bound to the sim** through `attackT` and `dying`.
  `attackT` is deliberately render-facing because behaviours own `t0`/`s0`
  privately.
- **Class plates are portraits**, derived from each class's own sprite.
- **Rarity plates are struck metal**, blended over the tier gradient with CSS
  **longhands, never the `background` shorthand** — a shorthand followed by a
  longhand that overwrites its payload is invisible, and that cost two
  milestones of 94%-transparent cards.
- **Fence, decals and scenery** are painted from their own seeded RNG streams,
  y-sorted, with scenery allocated before the pools so `cap` includes it.
- **The gas cloud and salt ring are wired.**
- **Eighteen scene actors animate** instead of bobbing.
- **The weapon ring** fans across an arc and sorts its depth separately from its
  lift.
- **The atlas is 2048 wide, not 1024.** At 1024 the animals forced a
  `1024×16384` page — the area was fine, the dimension was past many GPUs' max
  texture size and near iOS Safari's canvas-area cap.

### The rollback point

`git reset --hard pre-cast-swap` returns to the last commit where the game ran
entirely on LimeZu characters. Everything since is the art swap.

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
