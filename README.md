# Ranch Defense Force

A wave-based bullet-heaven (Vampire Survivors / Brotato lineage) set on a farm
outside Canton, Ohio. Something came off the crop duster that went over low on
Tuesday. Work the field until the light goes.

TypeScript + Vite + Canvas 2D. No engine, no physics library, no UI framework.

> **Art licence.** The art in `assets/` is commercially licensed from
> [LimeZu](https://limezu.itch.io). This repository is public by specific
> permission from LimeZu; the packs' own licence otherwise forbids
> redistribution, so **that permission does not travel** — please don't lift
> `assets/` into your own project or republish the packs. The game itself only
> ever ships the packed atlas. See [ASSETS.md](ASSETS.md).

## Status

**M0–M4 complete.** A full 17-minute run plays start to finish, and it is made
of pixels: both classes, all ten enemy types, and harvestable crops all render
from a packed atlas at 2× zoom.

Read [NOTES.md](NOTES.md) first — measured performance, the bugs found and what
caused them, every deviation from the spec, and the design decisions now open.

| Milestone | State |
|---|---|
| M0 Skeleton | done (except the live URL — see NOTES) |
| M1 Combat core | done |
| M2 Progression | done |
| M3 Wave and shop loop | done |
| M4 Art pipeline | done, except FX conforming and boss art |
| M5 Content → M8 Ship | not started |

## Running it

```bash
npm install
npm run atlas
npm run dev
```

`npm run atlas` builds `public/atlas.png` from `assets/`. It is gitignored — the
licensed art is never in a build output, only in `assets/`.

WASD / arrows / left stick to move. Space or right trigger for your class
ability. Weapons fire themselves.

`F1` (or backtick) toggles the dev overlay: frame time graph, pool counts, draw
calls, a seed box, and enemy spawn buttons. `N` skips the current wave — without
it, balancing twenty-four waves means playing twenty-four waves.

```bash
npm test          # 66 tests, including a headless full-run acceptance test
npm run build     # atlas + typecheck + production build
npm run shot      # headless screenshot: runs the sim, draws it, writes a PNG
npm run inspect -- <sheet.png>   # report a sprite sheet's frame grid
```

## Layout

```
src/
  core/         loop · input · seeded rng · pool · spatial hash
  sim/          world · player · spawner · stats · formulas · offers
  behaviours/   weapons.ts · enemies.ts     (string key -> function)
  render/       renderer · camera
  ui/           hud · levelup · shop · results · menu · dev   (DOM)
  content/      the design's JSON, plus tuning.json for engine constants
tests/          core · sim · world · run
assets/         source art — never read at runtime, never deployed
design_handoff_ranch_defense_force/   the spec this was built from
```

The design specification is
[`design_handoff_ranch_defense_force/GAME_DESIGN.md`](design_handoff_ranch_defense_force/GAME_DESIGN.md);
build order is `MILESTONES.md` beside it. Project conventions and the
non-negotiables (fixed timestep, zero hot-loop allocation, single-pass stat
resolution, seeded RNG, tick order) are in [CLAUDE.md](CLAUDE.md).

## Credits

Art by [LimeZu](https://limezu.itch.io/).
