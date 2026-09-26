# Ranch Defense Force — project conventions

Wave-based pixel-art bullet-heaven. TypeScript + Vite, a hand-written WebGL2
renderer, no engine. A run is one day on a cursed farm, dawn to full dark.

**Read [NOTES.md](NOTES.md) first, then [docs/V2.md](docs/V2.md)** (the plan,
the pitch and the decisions log). v1's long history is archived in
`docs/archive/v1/`; its NOTES are still the best record of why the sim and the
content are shaped as they are.

## Branches

`v2` is the working branch. `main` is v1 and **pushing `main` deploys to
GitHub Pages**, so v2 reaches `main` only when the owner says so. `v1-final`
tags the last v1 commit. Run `git fetch && git status` before reading anything
else; other sessions have pushed to this repo while one was working.

**Never `git add -A` or `git add .`**: an agent once swept another plugin's
database into a public commit that way. Add named files only.

## Running it

```bash
npm install
npm run atlas    # REQUIRED once: builds public/atlas-*.png + atlas.json from assets/
npm run dev
```

The atlas is gitignored (generated from licensed art). A fresh clone renders
coloured squares until `npm run atlas` runs.

| Command | What |
|---|---|
| `npm run tour -- --url http://localhost:5180` | the photo tour: 14 deterministic scenarios, real renderer, `screenshots/tour/` |
| `npm test` | vitest. `tests/run.test.ts` plays whole runs with bots and takes ~20 minutes; run single files while iterating |
| `npm run typecheck` | game and tools have separate tsconfigs |
| `npm run build` | atlas + typecheck + production build |
| `npm run probe` / `balance` | bot difficulty measurements (see docs/archive/v1/NOTES-v1.md before touching a number) |
| `npm run inventory` | refresh `docs/PIXELLAB_INVENTORY.md`; **grep it before generating any art** |

Dev URL flags: `?dev` (overlay, or F1), `?tod=0..1` (pin the time of day),
`?map=<id>`, `?r=2d` (the old Canvas renderer, for comparison), `?tour`.

## The self-test loop

After any visible change: run the tour, look at the shots yourself, and after
a milestone hand them to a fresh critic subagent with `tools/critic-brief.md`
and nothing else. Log the score in docs/V2.md. Verify in the browser: types
and tests pass happily while a screen renders wrong.

## Non-negotiables (sim)

- **Fixed 1/60 s simulation step** with an accumulator; the renderer
  interpolates.
- **Zero allocation in the hot loop.** Pools, reverse-iterate and swap-pop,
  no `.filter()`/`.map()` per frame. This applies to the renderer too.
- **Circle-vs-circle collision** against a 64 px hash grid.
- **All randomness through the seeded RNG** (mulberry32). No bare
  `Math.random()` anywhere, render side included. The map is the first draw
  off a run's RNG and costs exactly one; see `maps.json` `_rngNote`.
- **Stat resolution is one pass**: sum flats, sum percentages, apply once.
- **Sim and render never import each other's internals.** The renderer reads
  public world state; nothing in `src/sim` imports `src/render`.
- **Every tunable number lives in `src/content/*.json`.** The day curve, the
  view height and every place layout are content too.

## Non-negotiables (picture)

- **One pixel density.** The world draws at art resolution (1 art px = 1
  texel) and is scaled once, at the end. Never draw a sprite at a fractional
  scale to "fix" its size: fix the art (`fieldScale` in `art/sprites.json`).
- **Readability beats atmosphere.** Night may be dark; what is attacking you
  may not be invisible. Eyes glow, projectiles glow, the player is outlined
  over crowds.
- **Nothing in the bottom centre of the HUD.** The HUD hugs the edges.

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

## Art

`docs/PIXELLAB_INVENTORY.md` lists everything the PixelLab account already
holds. **Grep it before generating**; this project has paid twice for the
same barn. Whatever you generate, you wire in the same session, or retire
with a written reason. The PixelLab account closes around mid-October 2026:
what dies is the ids (derivations), not the downloaded art.

## Dependencies

`vite`, `typescript`, `vitest`, plus `@types/node` and `playwright` (dev only,
for the tools). Adding anything else needs a reason written in NOTES.md.

## Licensing

**The repo is public** by specific permission from LimeZu, which does not
extend to other projects: never copy `assets/` elsewhere. `assets/` never
deploys; only the packed atlas ships. Credit LimeZu on the title screen and in
the README.
