# Handoff — read this first

You are picking up **Ranch Defense Force**, a wave-based bullet-heaven on a farm.
TypeScript + Vite + Canvas 2D, no engine. The repo is public.

**Read in this order. Nothing else at the root is required reading.**

1. `CLAUDE.md` — the non-negotiables. Fixed timestep, zero allocation in the hot
   loop, seeded RNG, content-not-code for every tunable, 32×32 art only.
2. `NOTES.md` — what was built, session by session, and every bug that cost real
   time. Long, and worth it.
3. `docs/DESIGN_STATE.md` — **the current state of the UI.** If a handoff
   document ever disagrees with this file, this file is right.
4. `docs/DESIGN_LANGUAGE.md` — the Paper & Pin spec the UI is built to.

`docs/archive/` is superseded briefs. **It is not the state of anything.**

---

## Where the work stopped

**Every screen is in Paper & Pin.** The shop and the Homestead were the last two
and they are converted. Both backdrops are layer-for-layer ports of Design's own
reference scenes.

| Screen | State |
|---|---|
| Home / class select | Ported from `docs/reference/`. **Not signed off by eye.** |
| Level-up | Built. |
| Pause | Built. |
| Results | Built. |
| HUD | Built. |
| Shop | Converted — the same packet priced, plus the kraft counter. |
| Homestead | Converted — the yard, four staked signs, purchase cards. |

### The immediate next task

**Look at it.** Nothing in this project has been signed off by eye since the
scenes landed, because the browser pane was not displayed for the session that
built them. Everything is verified structurally — layer counts, computed styles,
measured sprite geometry, 131 passing tests — and none of that is the same as
looking.

Open `npm run dev` next to `docs/reference/Whitacre Yard at Dusk.html` and
`Whitacre Field at Dusk.html` and compare directly. `F1` toggles the dev
overlay; the scene toggle bottom-right flips backdrops without a reload, and you
need it — the two scenes are composed differently and only one is on screen at a
time.

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

1. **Sign off both scenes** against `docs/reference/`. Nothing else is blocked
   on this, but nothing else should be trusted before it.
2. **A human playtest.** Still nobody has held the controls since the art
   landed, and the last time one did they found a blocking bug no test caught.
3. **Cut in the art that is generated and staged** — the oak, the Whitacre bull,
   the barn dog, the gas cloud, the crop duster, the salt ring. All sitting in
   `assets/pixellab/picked/`, none wired.
4. **The Post Auger and the Combine Head want a ladder of four**, not the one
   icon each that exists. Deciding what a tier means for a farm tool is a design
   call, not a generation.
5. **Infected livestock are still ordinary animals** with a CSS filter. Side
   views are generated; they need the 8-direction and walk passes.
6. **The owner's own animals** — a fjord pony, an arabian, a draft mule, a
   donkey — are generated as side views and wired to nothing. See
   `_ranchRoster` in the queue.
7. **Boot Knife cannot be generated.** The safety classifier refuses the prompt
   outright. Ask the owner how they want it handled rather than working the
   wording.
8. **M7 meta progression is built and untested by real play** — save, acres,
   four Homestead buildings, six classes, County Fair tiers.

## Logged, not started

- **`_horrorPlan`** in the queue: make the whole cast scary the way the farmhand
  already is, generating each horror version FROM its healthy counterpart so the
  two read as the same animal before and after.
- **`_mapsAndTilesets`** in the queue: more maps. Note that **the seed does not
  currently pick a map** — there is one arena and one tileset. Making it pick one
  means the map choice has to be the FIRST draw off the RNG, or every existing
  seed stops replaying.
