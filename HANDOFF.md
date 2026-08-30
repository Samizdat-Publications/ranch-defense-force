# Handoff — read this first

> **STOP: the repo has two heads.** `origin/main` and
> `session-14-16-maps-caves-archive` both moved from the same base and neither
> contains the other — 21 conflicts, 28 hunks. **[`docs/MERGE.md`](docs/MERGE.md)
> maps it file by file and merging them is the first job of the next session.**
> Everything below describes the session-branch side.

You are picking up **Ranch Defense Force**, a wave-based bullet-heaven on a farm.
TypeScript + Vite + Canvas 2D, no engine. The repo is public.

**Read in this order. Nothing else at the root is required reading.**

1. `CLAUDE.md` — the non-negotiables. Fixed timestep, zero allocation in the hot
   loop, seeded RNG, content-not-code for every tunable, 32×32 art only.
2. `NOTES.md` — what was built, session by session, and every bug that cost real
   time. Long, and worth it.
3. `docs/NEXT_SESSION.md` — **what to do next and in what order.** Start here if
   you are picking this up cold; it names the brief, the traps this particular
   work will hit, and what not to redo.
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

**Play it WITH the owner.** Both things they asked for ahead of playing are
done: the yard's cast is generated art (session 14) and there are five maps
instead of one (session 15). The owner asked specifically not to be tuned
around, and feel has never been checked by a person holding the controls.
`docs/NEXT_SESSION.md` is the order and the traps.

Three things are parked FOR that session rather than decided without it: the
mud does not block or slow you, the brawling Kid gained five clears in 24 on the
bigger maps, and enemies still spawn on arena edges so pressure arrives later on
a big map. All three are measured and written down; none should be changed
alone.

**The home screen is DOM and CSS, so `npm run shot` cannot see it at all.** Any
change to `src/ui/scene.ts` or `src/ui/home.css` has to be looked at in a
browser, and **freeze the scene before judging a still** — a layer that is
moving when the screenshot is taken composites as a smear even when it renders
correctly, and that has already cost a false bug report. Pause every `Animation`
under `.home-yard` and set `currentTime`.

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

## The ten rules that have cost real time

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

7. **A CSS `scaleX` flip written a few percent apart is an INTERPOLATION.**
   The middle of `scaleX(1)` to `scaleX(-1)` is `scaleX(0)`: the element
   collapses to zero width and the compositor resamples that sliver back up out
   of whatever was behind it. Measured, not argued — a 64px element written the
   old way is 0.000px wide at 48% of its cycle. Put the two stops **0.01%**
   apart so the flip is a cut. `y-rooster-path` had it from the day it was
   written and nobody saw it.
8. **`rotations/west.png` does not face the same way on every generated
   object.** Dog, pony, donkey, arabian and mule face left; `whitacre_bull`
   faces right. The renderer never mirrors, so the bull charged backwards for a
   whole session and read as a sliding model rather than as an error. The IoU
   check the compass mapping was signed off with proves east mirrors west —
   true of all of them — and says nothing about which way EITHER faces.
   `npm run look` on two rotations settles it in one glance.

9. **Judge a ground tile TILED, never alone.** `npm run look -- <frame>
   --tile 5` repeats it five by five. A 32px tile judged alone looks like
   texture; across a field its mottling becomes a visible grid, and that is what
   the eye reads at play zoom. It has now rejected two grounds that were already
   wired into three maps, and a whole tileset family.
10. **A count in content that ought to scale with the arena is a DENSITY.**
   `nodes.json` quotes against `referenceArea`. When maps landed with the counts
   still absolute, a 1.75x arena had 57% of the crops per screen, the run
   economy collapsed and three acceptance tests failed at once — and it looked
   exactly like a balance regression.

And the meta-rule, which has held nine times: **when a tool reports something
surprising, check the tool before the game.** Its twin, new in session 14:
**a layer that is MOVING when you screenshot it can composite as a smear even
though it renders correctly** — freeze the scene before judging a still, or you
will file a bug against innocent code.

---

## Art pipeline

**PIXELLAB IS NOT CANCELLED. The subscription is ACTIVE (Tier 2); what is spent is this cycle's allowance, 4710 of 4710, and it REFILLS on 2026-09-14. Sessions 14 and 15 were told the account was dead and wrote it into four documents without checking. Downloading costs nothing at any time, and fourteen finished tilesets were sitting on the account unfetched while those documents said no art could be had.**

So: generating is a WAIT, not a wall. Everything in this section describes how
it works and will work again. Two things work today regardless — **`npm run
tsaudit`** lists what is finished on the account and pulls it down, and
**`npm run objstrip`** reshapes what is already on disk.

The one thing here that still works is offline: **`npm run objstrip`** turns
an already-downloaded 8-direction object's walk into a scene strip with no API
call, and **`npm run look`** puts sprites side by side on grey so they can be
judged before wiring. Both are in the command table below.

PixelLab WAS live, paid, and wired two ways.

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
npm test           # 135 tests, including a headless full-run acceptance test
npm run typecheck  # game and tools have separate tsconfigs
npm run build      # atlas + typecheck + production build
npm run fetch      # pull a PixelLab job's candidates + a contact sheet
npm run cut        # trim one candidate onto the game's grid
npm run zoom       # render the home scene at several target heights
npm run range      # every weapon firing, on one contact sheet
npm run shot       # headless screenshot of a real run — CANNOT see the home screen
npm run objstrip   # a downloaded PixelLab object's walk -> a scene strip, offline
npm run look       # sprites side by side on grey. atlas:<frame> checks what SHIPPED
                   # --tile 5 repeats one, which is the only honest ground test
npm run maps       # bake every map's whole ground + per-layer coverage
npm run balance    # 24 runs per configuration; takes a map id to hold the arena still
```

`F1` in game toggles the dev overlay; `N` skips a wave.

**Verify in the browser.** Types and tests pass happily while a screen renders
blank or see-through — five of the six silent bugs above were found by looking,
not by running. `window.rdf` in dev builds exposes the live world, renderer,
atlas, save, and every screen object, so a UI change can be driven directly
without grinding to it.

---

## Outstanding, roughly in order

**Current as of session 14. `NOTES.md` session 14 is the detail;
`docs/NEXT_SESSION.md` is what to do next and in what order.**

**Generations refill on 2026-09-14.** PixelLab is ACTIVE, not cancelled — see
the art pipeline section. Until then, downloading finished work still costs
nothing. The
items are kept because they are still the right work if the account ever comes
back, and because several of them can be done with art that is already on disk.

0. **Order the chained cave family on 2026-09-14**, when generations refill.
   It is the one thing the caves actually need — a second ground per level,
   chained off that level's own floor rather than off grass. Base tile ids are
   recorded per cave in `src/content/maps.json`.

1. **Play it. Function is verified; feel is not.** Session 13 drove the game
   through `window.rdf` and confirmed what a headless shot cannot reach — the
   renderer's own blight pass and its re-bake-on-wave-change both work, ash
   measured 9% to 99% across waves 1-25 on the renderer's terrain canvas, and
   wave 12 with every cursed animal in frame ran at 236fps. What nobody has done
   is hold the controls. The blight is bone-PALE, so the screen gets lighter as
   the run gets worse; that is deliberate and it is the most likely thing to
   want reversing after ten minutes of play.
2. **More maps — DONE in session 15.** Five, sized 2400x1600 to 3200x2100,
   with layered Wang grounds and seeded fill. The RNG trap this entry warned
   about for two sessions was avoidable: `mapForSeed` DERIVES a stream from the
   seed rather than drawing from `world.rng`, so it consumes nothing and every
   existing seed still replays. Adding another map is a descriptor in
   `src/content/maps.json` — but there is no new GROUND to add without
   generating one, so a new map is a new layout and a new size.

3. **The balance session.** Unchanged from session 12 and still the largest
   un-started thing. Waves far too slow, 19 enemies alive at the average death,
   and raising the budget or the spawn rate BOTH fail `run.test.ts` on the
   identical budget — density and player power are coupled. The fix is more
   enemies that are individually weaker across `enemies.json`. Numbers are in
   `formulas.ts` above `threatBudget`. Also parked for it: base move speed 160,
   crop density and feed value, damage-% items vs "merging IS the offensive
   game", late shops thinning to items only, elites being spawn-time only, and
   global hitstop.
4. **The art that is still LimeZu, and the ceiling on changing it.** Every
   character, every field animal, the trees, rocks, ore and ground are ours, and
   since session 14 so is everything alive in the yard except the hens. Left:
   `duckFlight`, buildings, fences, troughs, feed sacks, weapons, FX, the boss
   vehicles, and the home screen's hens. **None of them has a generated
   replacement on disk and none can be made** — this is now a budget item, not a
   work item. Atlas keys are stable and art still swaps one manifest line at a
   time, so it is ready the moment there is anything to swap in.
5. **Four cursed equines with nowhere to go.** `arabian_cursed`,
   `donkey_cursed`, `draft_mule_cursed` and `fjord_pony_cursed2` are generated
   and good, and no enemy uses them. They are static rotations and **they cannot
   be given a walk any more** — `animate_object` needs the account. So this is
   now: use them standing, or not at all. Their HEALTHY counterparts did find a
   home in session 14 — the pony, the donkey and the arabian are the yard's
   stock — so the question is only what a cursed horse IS, which was always the
   content-design half of it.
6. **Save export/import.** Saves die when browser data is cleared and no browser
   storage survives that. ~30 lines, no backend. Do it before anyone else plays.
7. **Two staged sprites want a renderer change.** The gas cloud and salt-ring
   decal are trimmed in `assets/pixellab/picked/` and wired to nothing, because
   the FX they would replace are animated clips rather than static frames.
8. **Listen to the music in a real run.** Chosen from pack metadata, never by
   ear.
9. **The palette has no light blue AND no saturated red.** Its only blues are
   three dusk-sky slates at value 24-38, so anything pale and cold quantises to
   cream — that is how an ore tier briefly went missing. Session 14 found the
   red half of the same hole: the conform pass deletes the LimeZu hen's comb and
   wattle into the body brown, so the bird has no face. `npm run look -- <file>
   --conform` shows either in one glance. Adding a colour re-quantises every
   conformed group, so it wants a session that looks at all of them.

### What is generated vs what is still LimeZu — the exact table

Audited from the packed atlas, not from memory:

| | source | notes |
|---|---|---|
| all 6 player classes | **GENERATED** | 26-32 x 51-55, 8-frame walk |
| farmhand, acidZombie, bloatedFarmhand, maskedSprayer, maskedHauler | **GENERATED** | 28-32 x 51-58, 8-frame walk |
| feralDog, rooster, sickHog, blownSheep, prizeBull | **GENERATED** | cursed PixelLab objects, 9-frame walk, 4 directions |
| trees, rocks, ore | **GENERATED** | blighted; `assets/pixellab/env/` |
| ground, blight | **GENERATED** | Wang sets; `grass_to_blight` is the ash |
| **home screen: the dog, the pen stock, the loose horse, both people** | **GENERATED** | session 14; `barn_dog`, `whitacre_bull`, `fjord_pony`, `donkey`, `arabian_horse`, and The Hand and The Widow |
| home screen: the rooster, the oaks, the treeline | **GENERATED** | session 12-13 |
| crops | LimeZu | but the pack's own `_Rotten_` variants |
| duckFlight | LimeZu | the last un-replaced enemy |
| home screen: hens and chick | LimeZu | no healthy generated bird but the rooster |
| **buildings, fences, weapons, FX, boss vehicles** | LimeZu | **and they cannot change — see below** |

### The ceiling on retiring LimeZu, and it is hard

**There is no generated building, fence or structure art anywhere on disk.**
`assets/pixellab/` was audited folder by folder in session 14. The barn, the
farmhouse, the silo, the coop, the nest, the doghouse, the well, the hay, the
trough, the milk cans, the picket band, the whole stock pen, the cow sign, the
scarecrow, the weapons, the FX and the boss vehicles are LimeZu and stay LimeZu
until the generation allowance refills on 2026-09-14.

Those buildings are the largest objects on the home screen. **Do not claim the
yard is ours.** What is true: everything alive in it except the hens is.

### The rooster enemy WAS drawing a hen — fixed

`rooster.idle.down.0` came off `Rooster_Brown_32x32.png` at `walkRow: 3`, and
row 3 is a hen row. Fixed by replacing the bird with `rooster_rotten` rather
than re-deriving a LimeZu row that has now been deleted.

### Wired and done in session 16, so you do not redo it

- **THE PIXELLAB ACCOUNT IS ACTIVE.** Sessions 14 and 15 were told it was
  cancelled and wrote that into four documents. The allowance refills
  2026-09-14, and DOWNLOADING was always free — `npm run tsaudit` found
  fourteen unfetched tilesets on it, nine of them usable.
- **The descent.** A way down opens at the wave-10 boundary; `[E]` on it takes
  you to The Root Cellar, The Washout, The Seam — 1800x1200 down to 1400x1000,
  progressively darker, one way, and `acres.perDepth` pays for going.
- **The caves are hard for free.** Enemies spawn on arena edges and the caves
  are small, so the crowd is on you immediately. Nothing in `enemies.json`
  changed.
- **`npm run snap` / `npm run snaphist`** — the screenshot archive in
  `docs/progress/`, with the history reconstructed back to 2026-08-11.
- **The headless painter clamps its camera** and draws the cave darkness, so
  what it shows is what the game shows.

### Wired and done in session 15, so you do not redo it

- **Five maps**, 2400x1600 to 3200x2100, in `src/content/maps.json`. A map is a
  size plus an ordered list of Wang ground LAYERS, each with a shape; the fields
  are built once in `src/render/terrain.ts` and both renderers only blit them.
- **`mapForSeed` derives, it does not draw**, so every old seed still replays.
- **Node counts are a density now** (`nodes.field.referenceArea`), and the props
  pool grew to hold the biggest map.
- **`run.test.ts` pins the arena**; `tests/maps.test.ts` is the map coverage.
- **The wave-change re-bake is incremental** — 57ms to 2-4ms, and smaller than
  it was before maps existed.
- **`npm run maps`, `npm run look --tile`, `npm run balance <mapId>`**, and the
  dev overlay names the map.

### Wired and done in session 14, so you do not redo it

- **The yard's livestock and its two people are generated art.** `barn_dog`
  patrolling the near ground, `whitacre_bull` / `fjord_pony` / `donkey` in the
  pen, `arabian_horse` loose on the grass, and The Hand and The Widow walking.
  Ten LimeZu entries left the manifest with them.
- **`npm run objstrip`** — a downloaded object's walk into a scene strip, with
  no API call. This is how any remaining generated object reaches the DOM
  scenes now that `npm run anim` cannot download anything.
- **`npm run look`** — sprites side by side on grey, optionally conformed.
- **`prizeBull` no longer charges backwards.** Its `west` rotations face the
  opposite way to every other object's, and `pixellabObjects` entries can now
  override the group's compass mapping.
- **The `scaleX` flips are cuts**, in `y-amble` and in `y-rooster-path`.

### Wired and done in session 13, so you do not redo it

- **Every field animal is a cursed generated one**, packed by a new
  `pixellabObjects` group — a FOURTH sprite layout in this project.
- **Eleven blighted props** — three trees, three rocks, five ore.
- **The crops are rotten**, using the pack's own variants. Free.
- **The ground turns to ash across a run**, `src/render/blight.ts`, shared by
  the renderer and `draw-world` and covered by four tests.

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
