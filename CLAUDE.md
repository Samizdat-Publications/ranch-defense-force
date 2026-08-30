# Ranch Defense Force — project conventions

Wave-based bullet-heaven, TypeScript + Vite + Canvas 2D, no engine.
Full spec in `design_handoff_ranch_defense_force/GAME_DESIGN.md`.

> ## THE REPO HAS TWO HEADS. READ `docs/MERGE.md` FIRST.
>
> `origin/main` and `session-14-16-maps-caves-archive` both moved a long way
> from the same base and neither contains the other. 21 conflicts, 28 hunks,
> mapped file by file in that document. **Merging them is the first job.**
>
> **And run `git fetch && git status` before reading anything else.** This
> happened because a session started from a tree that was 28 commits behind
> without noticing — the tree was also full of uncommitted work, so being stale
> looked exactly like being mid-task.

**M0–M4 are done. Read [NOTES.md](NOTES.md) before doing anything** — it has what
was built, what deviated from the spec and why, the bugs found and their causes,
and the design decisions currently open. It is the handoff, and it is kept
current.

## Getting running

```bash
npm install
npm run atlas    # REQUIRED: builds public/atlas.png from assets/
npm run dev
```

`public/atlas.png` and `atlas.json` are **gitignored** — they are generated, and
keeping them out is what stops licensed art landing in a build output. A fresh
clone renders coloured squares until `npm run atlas` runs, by design: a missing
atlas costs the art, not the game.

| Command | What |
|---|---|
| `npm test` | 135 tests, including a headless full-run acceptance test |
| `npm run typecheck` | game and tools (they have separate tsconfigs) |
| `npm run atlas` | slice + pack `art/sprites.json` → `public/atlas.*` |
| `npm run shot -- [ticks] [out] [seed] [class]` | headless screenshot: runs the sim, draws it, writes a PNG. No browser. |
| `npm run inspect -- <sheet.png>` | report a sprite sheet's frame grid |
| `npm run object -- <id> <name>` | pull an 8-direction PixelLab object: rotations + animation frames |
| `npm run mapobj -- <id> <name> ...` | pull PixelLab map objects (scenery). **They auto-delete after 8h** |
| `npm run tileset -- <id> <name>` | pull a finished Wang tileset into `assets/tilesets/` |
| `npm run objstrip -- <obj> <compass> <name>` | a downloaded object's walk → a scene strip. **Offline** |
| `npm run tsaudit -- [--pull] <id>[=<name>]` | what is on the PixelLab account vs on disk; pulls it. Costs no generations |
| `npm run snap -- <slug> "<caption>"` | capture the screenshot archive in `docs/progress/` |
| `npm run snaphist -- <ref>=<slug>` | reconstruct an old commit's screenshot in a throwaway worktree |
| `npm run look -- <a.png\|atlas:frame> ... [--conform] [--tile 5]` | sprites side by side on grey. `--tile` repeats one — the only honest ground test |
| `npm run maps -- [wave] [dir] [seed] [scale]` | bake every map's whole ground; prints per-layer coverage |
| `npm run build` | atlas + typecheck + production build |

**PixelLab is ACTIVE. What runs out is the monthly generation allowance**, and
this cycle's refills on 2026-09-14. Two sessions were told the account was
cancelled and wrote it into four documents; it was not. Generating is a wait.

**Downloading has always been free**, whatever the allowance says. `npm run
tsaudit` lists what is finished on the account and pulls it down — it found
fourteen unfetched tilesets, nine usable, while the docs said no new ground
could be had. `npm run objstrip` and `npm run look` need no account at all.

`F1` in game toggles the dev overlay; `N` skips a wave.

## Facts about the art that the spec gets wrong

These were derived with `npm run inspect` and by measuring the packed atlas,
not guessed. Do not re-derive them from the design doc.

- **Character sheets are 32×64 spanning a stacked row pair**, not 32×32. The
  even row holds the upper half, the odd row the lower. All thirteen generator
  exports do share this rig, as the spec says — but not the geometry it implies.
- **The animal sheets do NOT share a rig.** Each species differs, and the
  front/back clips on the two-row sheets are drawn at proportions that do not
  match the side views. Mostly moot now: every field animal except `duckFlight`
  is a generated PixelLab object and the LimeZu entries were deleted.
- **There are FOUR sprite layouts, not one.** Humanoids are 32x64 on stacked row
  pairs; LimeZu animals are four direction clips in one band at a 64 or 96px
  pitch; the tractor is 192px frames stacked by direction; a PixelLab object is
  one PNG per rotation plus one PNG per walk frame in named compass folders.
  Every one was measured and none could have been assumed from the others.

## Content lives in two places

`src/content/*.json` is the design's delivered data. `src/content/tuning.json` is
engine-level constants the design never specified (base move speed, camera lerp,
pool sizes, crop density). Both are content — the no-balance-constants-in-code
rule covers both.

**`src/content/maps.json` is the arenas**, and a map is a real gameplay object
rather than a skin: its width and height become `world.arenaW/arenaH`, so
enemies spawn on ITS edges and nodes scatter across ITS field. The seed picks
one by DERIVING a stream from itself, never by drawing from `world.rng` — that
is what lets maps exist without every old seed changing what it replays.

## Check the source, not the document about the source

Three times in one session a document was confidently wrong about something one
command could settle:

- a brief said PixelLab was **cancelled**; the subscription was active and the
  allowance refills monthly (`get_balance`);
- a handoff said no new ground art existed; **fourteen finished tilesets** were
  sitting unfetched on the account (`npm run tsaudit`);
- three sessions concluded there was **no generated building art**; a barn, a
  farmhouse and a silo were on an unmerged branch (`git branch -a`).

Session 13 hit the same shape with the cursed animals. **A document about the
world is evidence, not the world.**

## Non-negotiables

- **Fixed 1/60s simulation step** with an accumulator; the renderer
  interpolates. Never tie simulation to frame time.
- **Zero allocation in the hot loop.** Pool projectiles, enemies, particles,
  damage numbers. Reverse-iterate and swap-pop; never `.filter()`/`.map()`
  per frame.
- **Collision is circle-vs-circle** against a 64px uniform hash grid. No AABB
  trees, no physics library.
- **All randomness goes through the seeded RNG** (mulberry32) so any run
  replays from its seed. No bare `Math.random()` anywhere.
- **Stat resolution is one pass:** sum flat bonuses, sum percentage bonuses
  additively, apply once. No multiplicative stacking anywhere, ever.
- **Sim and render never import each other's internals.**
- **Every tunable number lives in `src/content/*.json`.** No balance constants
  in code.
- **A count that should scale with the arena is a DENSITY, not a headcount.**
  `nodes.json` quotes against `referenceArea` and everything is multiplied by
  `arenaArea / referenceArea`. Anything else that scales with map size owes the
  same treatment — including the pool that has to hold it.
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

`assets/` still never deploys. Only the packed `public/atlas.png` ships, which
is the "edit and use the asset in a project" the licence explicitly allows.
Credit LimeZu (limezu.itch.io) in the title screen and README; the UI pack's
licence requires it.

## Per-milestone

End every milestone by writing/updating `NOTES.md`: what was built, what
deviated from the spec and why, what feels wrong in play, and the design
decisions now needed.
