# Handoff — read this first

You are picking up **Ranch Defense Force**, a wave-based bullet-heaven on a farm.
TypeScript + Vite + Canvas 2D, no engine. The repo is public.

**Read in this order. Nothing else at the root is required reading.**

1. `CLAUDE.md` — the non-negotiables. Fixed timestep, zero allocation in the hot
   loop, seeded RNG, content-not-code for every tunable, 32×32 art only.
2. `NOTES.md` — what was built, milestone by milestone, and every bug that cost
   real time. Long, and worth it.
3. `docs/DESIGN_STATE.md` — **the current state of the UI redesign.** What is
   built, what is still on old styling, what is wearing borrowed art. If a
   handoff document ever disagrees with this file, this file is right.
4. `docs/DESIGN_LANGUAGE.md` — the Paper & Pin spec the UI is built to.

`docs/archive/` is superseded briefs. **It is not the state of anything.**

---

## Where the work stopped

The UI redesign is most of the way in. Two screens are still on the old styling
and one screen is close but not right.

| Screen | State |
|---|---|
| Home / class select | Built to the mockup. **Not visually signed off** — see below. |
| Level-up | Built. |
| Pause | Built. |
| Results | Built. |
| HUD | Built. |
| **Shop** | **NOT CONVERTED.** Old styling. |
| **Homestead** | **NOT CONVERTED.** Old styling. |

### The immediate next task

Convert the **shop** and the **Homestead** to Paper & Pin.

`docs/mockups/Game Screens.dc.html` is the source of truth for both. Every mockup is now IN THE REPO under `docs/mockups/` — open them straight in a browser, they need no build step.
**Read the mockup for the LAYOUT before writing any code.** The single biggest
mistake made on this project was implementing the design's scene placements
correctly and then laying a self-invented layout over them — it measured right
and looked nothing like the design. The mockups are not decoration; they are the
spec.

### The home screen is not signed off

The owner's last word: *"It's not even close."* It has since been rebuilt to
`docs/mockups/Home Screen.dc.html`'s actual layout — title stacked top-left, "YOU ARE
PLAYING" panel, seed as a form line, the Homestead as a call-out against the
barn, class rail along the bottom — but **it has not been confirmed by eye since
that rebuild.**

Two reference files are in `docs/reference/`: `Whitacre Yard at Dusk.html` and
`Whitacre Field at Dusk.html`. These are the design's own runtime-bundled
scenes. Open them in a browser next to `npm run dev` and compare directly. They
are the target.

Known gaps in the current home screen:

- **The oaks are removed.** `scene.treeOak` is a modular LimeZu piece and at
  this scale it read as three identical shrubs, not a treeline. It is priority 0
  in `art/pixellab-queue.json`. A wrong tree is louder than no tree.
- The foreground and ground band may not match the reference. Compare.
- The dev scene toggle (bottom-right, dev builds only) flips backdrops without a
  reload. Use it — the two scenes are composed differently and only one is on
  screen at a time.

---

## The five rules that have cost real time

Every one of these has bitten more than once, and every one failed **silently**.

1. **The atlas trims every frame to content bounds.** Right for a sprite, fatal
   for anything **tiled or stepped**: a 192px six-frame strip packs to 188px and
   `steps(6)` slides instead of stepping; a 32px tile packs to 26px and every
   repeat gaps. Use the `noTrim` group flag in `art/sprites.json`.
2. **Strip offsets are pixels, never percentages.** `-600%` on a six-frame strip
   lands frame 0 and then five blanks.
3. **Adding to a namespace someone already owns fails silently.** Five times so
   far: a second `.sheet`; keying an enemy as `hand.*` when `hand` is the player
   class; `farmhand` existing as both a LimeZu sheet and a generated one, with
   the later pass winning; a new `hud.css` imported above the rules it meant to
   replace and losing the cascade; and a key generator producing
   `chickenPeckstrip` where the table said `chickenPeckStrip`. **Grep the name
   before you choose it.**
4. **Screens are built at module load; the atlas resolves later.** Anything that
   draws sprites must rebuild when the art lands, or it renders empty.
5. **Integer zoom only.** If a mockup draws something at half scale, move it
   further away rather than scaling it.

And the meta-rule, which has held six times: **when a tool reports something
surprising, check the tool before the game.** The instrument has been wrong more
often than the code.

---

## Art pipeline

PixelLab is live, paid, and wired two ways.

- `npm run pixellab -- --list` prices a run for free. Without `--list` it
  generates everything in `art/pixellab-queue.json` that has no sheet yet.
  **Pro tools cost 20 generations each against 2,000/month.** Do not run the
  whole queue in one go.
- The **MCP server** is configured in `.mcp.json` (gitignored; template at
  `.mcp.json.example`). It reaches the tools the batch script does not wrap —
  8-direction sprites, rotations, `animate_with_text`, tilesets,
  Portrait↔Character.

Read `docs/PIXELLAB_API_PIPELINE.md` before generating. Two things it will save
you: background removal leaves an **alpha 1–8 fringe**, so trim at `alpha > 8`
(`contentBounds()` uses `!== 0` — `tools/pixellab-cut.ts` carries its own
threshold); and `create_image_pro` returns each candidate as a **separate file**,
not the web UI's 4×4 sheet, so use `npm run cut -- single <src> <dst>`.

**The style anchor goes in as a URL** pointing at this repo's own
`raw.githubusercontent.com` path — the repo is public, so it is its own asset
host. No base64 argument.

Character generation is `docs/PIXELLAB.md` — Pro mode, character size **40**
set manually, view **low top-down**, and two anchor images doing two different
jobs (`npm run anchor` regenerates them). Generated characters come back as a
directory tree, not a sheet, and **the frame sizes are not uniform** — rotations
at 40×40, animation frames padded to 56×56, and on the one character generated
so far, one direction out of eight came back a different size again.

---

## Commands

```bash
npm run dev        # the game
npm run atlas      # regenerate characters + repack the atlas. Run after any art change.
npm test           # 131 tests, including a headless full-run acceptance test
npm run typecheck  # game and tools have separate tsconfigs
npm run build      # atlas + typecheck + production build
npm run zoom       # render the home scene at several target heights
npm run range      # every weapon firing, on one contact sheet
npm run shot       # headless screenshot of a real run
```

`F1` in game toggles the dev overlay; `N` skips a wave.

**Verify in the browser.** Types and tests pass happily while a screen renders
blank — four of the five silent bugs above were found by looking, not by
running. There is a `window.rdf` handle in dev builds exposing the live world,
renderer, atlas, save and every screen.

---

## Outstanding, roughly in order

1. **Shop and Homestead** to Paper & Pin, from `Game Screens.dc.html`.
2. **Sign off the home screen** against `docs/reference/`.
3. **Generate the oak** (priority 0 in the queue) and put the treeline back.
4. **Ten items and two weapons are wearing borrowed art**, flagged
   `_standInArt` in the content files and queued.
5. **Infected livestock are still ordinary animals** with a CSS filter. The
   infected farmhand is real and generated; the rest of the roster is not.
6. **M7 meta progression is built** — save, acres, four Homestead buildings, six
   classes, County Fair tiers. Untested by real play.

## What the owner has asked for that is not done

- The home screen matching the reference scenes.
- A full generation run once the pipeline was validated. It **has** been
  validated end to end (two icons generated, trimmed, packed, wired), so the
  remaining queue is safe to spend.
