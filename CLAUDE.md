# Ranch Defense Force — project conventions

Wave-based bullet-heaven, TypeScript + Vite + Canvas 2D, no engine.
Full spec in `design_handoff_ranch_defense_force/GAME_DESIGN.md`.

**M0–M4 are done. Read [NOTES.md](NOTES.md) before doing anything** — it has what
was built, what deviated from the spec and why, the bugs found and their causes,
and the design decisions currently open. It is the handoff, and it is kept
current.

## Which branch is the project

**`main`.** It was not, for a long time, and the repo carries scars from it:
`origin/main` and a session branch both moved a long way from one base, neither
contained the other, and a later session wrote a "THE REPO HAS TWO HEADS" banner
into this file that was still being obeyed after somebody had quietly done the
merge on a third branch.

That is finished. On 2026-09-02 `main` was fast-forwarded to the head of
`claude/rdf-merge-session-l7ta2j`, so the two are the same commit and there is
one head again. `session-14-16-maps-caves-archive` is an archive; its content
was absorbed long ago (verified by content, not by branch name — the ground
banding it added lives inside `renderer.ts` now, driven by each map's own
`terrain` block).

**Session 22 (2026-09-02/03) merged everything back to `main`** — the integration
branch, four agent worktrees and the batch branches all landed; `main` is the
only head again. Agents work on short-lived branches in the main checkout (or a
worktree under `.claude/worktrees/`, which vite and vitest now ignore) and merge
to `main` when green. **Never `git add -A` or `git add .` in this repo** — one
agent swept another plugin's database from `.claude/data/` into a public branch
that way; add named files only.

**Still run `git fetch && git status` before reading anything else.** Not because
of the old split, but because it is how the old split was found — and while this
session worked, another session pushed a commit to the same branch.

## Getting running## Getting running

```bash
npm install
npm run atlas    # REQUIRED: builds public/atlas-0..6.png (seven pages of <=2048px) from assets/
npm run dev
```

`public/atlas-*.png` and `atlas.json` are **gitignored** — they are generated, and
keeping them out is what stops licensed art landing in a build output. A fresh
clone renders coloured squares until `npm run atlas` runs, by design: a missing
atlas costs the art, not the game.

| Command | What |
|---|---|
| `npm test` | 216 tests, including headless full-run acceptance tests for all six classes |
| `npm run typecheck` | game and tools (they have separate tsconfigs) |
| `npm run atlas` | slice + pack `art/sprites.json` → `public/atlas-*.png` + `atlas.json` (a frame carries its `page`) |
| `npm run cards` / `ledger` / `tag` / `facings` / `carrysheet` / `blight` / `offer-stream` | session-22 instruments: photograph every card; the PixelLab ledger; write verdicts to the account; a class in four facings with a full kit; carried-art contact sheet; assert the home-screen blight mapping; measure the offer stream |
| `npm run shot -- [ticks] [out] [seed] [class]` | headless screenshot: runs the sim, draws it, writes a PNG. No browser. |
| `npm run inspect -- <sheet.png>` | report a sprite sheet's frame grid |
| `npm run inventory` | refresh `docs/PIXELLAB_INVENTORY.md` — **grep that before generating art** |
| `npm run build` | atlas + typecheck + production build |
| `npm run scene -- <kind> <out.png> [ms]` | **photograph the live title screen** — real dev server, real app in Chromium, reports console errors |
| `npm run placements -- <artboard.dc.html> ...` | a Design artboard → `docs/mockups/PLACEMENTS.md` coordinate table. Never hand-type those numbers |
| `npm run scale` / `pens` / `strips` / `catalog` | measured art metadata; run in that order after `atlas` |
| `npm run decard` | strip PixelLab's opaque card **offline and free** (`rmbg` costs a generation) |
| `npm run clips` | assert every enemy a map can roll has packed art |

`F1` in game toggles the dev overlay; `N` skips a wave.

## Facts about the art that the spec gets wrong

Both were derived with `npm run inspect`, not guessed. Do not re-derive them from
the design doc.

- **Character sheets are 32×64 spanning a stacked row pair**, not 32×32. The
  even row holds the upper half, the odd row the lower. All thirteen generator
  exports do share this rig, as the spec says — but not the geometry it implies.
- **The animal sheets do NOT share a rig.** Each species differs, and the
  front/back clips on the two-row sheets are drawn at proportions that do not
  match the side views. Only the side clips are packed; see NOTES.

## Content lives in two places

`src/content/*.json` is the design's delivered data. `src/content/tuning.json` is
engine-level constants the design never specified (base move speed, camera lerp,
pool sizes, crop density). Both are content — the no-balance-constants-in-code
rule covers both.

`src/content/maps.json` is where a run happens: ground and blight chain, node
and enemy mix, arena size and shape, hazards. **The map is the first draw off
the run's seeded RNG** and must stay first and stay one draw — see the
`_rngNote` at the top of that file. Ground lives there and nowhere else;
`tuning.json` used to carry a `terrain` block and now carries only a pointer.

## Before you generate any art, read the inventory

`docs/PIXELLAB_INVENTORY.md` is a committed list of everything the PixelLab
account already holds — 797 objects, 41 tilesets, 23 characters at the last
count, across every session this project has had.

**Grep it before generating. Every time.**

```bash
grep -i barn docs/PIXELLAB_INVENTORY.md
npm run inventory          # refresh it (needs PIXELLAB_API_KEY)
```

This is not bookkeeping hygiene, it is the single most expensive mistake this
project repeats. Session 18 generated a farm roster and then found the barn,
farmhouse, silo, chicken coop, windmill and well — the exact assets
`DESIGN_BRIEF_HOMESCREEN.md` names as blocking the homescreen rebuild — already
generated and paid for, sitting unclaimed. Every session before it made the same
discovery about something else.

Two things follow from that:

- **A document saying art is missing is not evidence that it is.** The briefs in
  this repo describe gaps that were filled sessions ago. Check the inventory,
  not the prose.
- **`status: review` means bought but never picked up.** A generation that
  returned 4, 16 or 64 candidates parks them until someone selects. Claiming
  costs nothing — measured, balance identical either side — so an unclaimed pack
  is finished work, not pending work.

**And the other half of that rule (owner, 2026-09-03): whatever you generate,
you wire.** Generation is allowed and encouraged when the game needs the art —
but the same task claims it, packs it into `art/sprites.json`, and draws it
somewhere real, or retires it with a written reason. An unclaimed candidate is
a debt. A report that lists a generation must say where it is used.

## Non-negotiables

- **Fixed 1/60s simulation step** with an accumulator; the renderer
  interpolates. Never tie simulation to frame time.
- **Zero allocation in the hot loop.** Pool projectiles, enemies, particles,
  damage numbers. Reverse-iterate and swap-pop; never `.filter()`/`.map()`
  per frame.
- **Collision is circle-vs-circle** against a 64px uniform hash grid. No AABB
  trees, no physics library.
- **All randomness goes through the seeded RNG** (mulberry32) so any run
  replays from its seed. No bare `Math.random()` anywhere. The map choice is
  the first draw and costs exactly one; anything inserted before it invalidates
  every seed.
- **Stat resolution is one pass:** sum flat bonuses, sum percentage bonuses
  additively, apply once. No multiplicative stacking anywhere, ever.
- **Sim and render never import each other's internals.**
- **Every tunable number lives in `src/content/*.json`.** No balance constants
  in code.
- **32×32 art only.** Never read the 16x16 or 48x48 pack directories.

## Tick order — do not reorder

1. input sample
2. player move + clamp to arena
3. spawner: wave timer, threat budget
4. enemy steering + separation
5. rebuild spatial grid
6. weapon cooldowns → fire
7. projectile integrate
8. collisions: proj→enemy, enemy→player
9. damage resolve, deaths, drops
10. pickups magnet + collect
11. vfx, decals, camera
12. despawn offscreen, return to pools

## Dependencies

`vite`, `typescript`, `vitest`. Adding anything else needs a reason written
down in NOTES.md.

Added since: `@types/node` — dev-only, types-only, zero runtime bytes, so the
build tools typecheck. Reason recorded in NOTES.md. PNG decode/encode is hand-
written in `tools/png.ts` on Node's zlib rather than pulling in `sharp` or
`pngjs`; keep it that way unless there is a reason not to.

## Licensing

**The repo is public.** It was private for M0–M5 because the bundled
`assets/modern-farm/LICENSE.txt` says in as many words: "YOU CAN'T: Resell or
distribute the asset to others." The owner obtained permission from LimeZu to
publish this repository, packs included, and made that call with the licence
text in front of them. That permission is specific to this repo — it is not a
general grant, so do not copy `assets/` into another project or republish the
packs elsewhere.

`assets/` still never deploys. Only the packed `public/atlas-*.png` ships, which
is the "edit and use the asset in a project" the licence explicitly allows.
Credit LimeZu (limezu.itch.io) in the title screen and README; the UI pack's
licence requires it.

## Per-milestone

End every milestone by writing/updating `NOTES.md`: what was built, what
deviated from the spec and why, what feels wrong in play, and the design
decisions now needed.
