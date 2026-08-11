# Ranch Defense Force

A wave-based bullet-heaven (Vampire Survivors / Brotato lineage) set on a farm
outside Canton, Ohio. Something came off the crop duster that went over low on
Tuesday. Work the field until the light goes.

TypeScript + Vite + Canvas 2D. No engine, no physics library, no UI framework.

> **Private repo.** The art in `assets/` is commercially licensed but **may not
> be redistributed**. Do not make this repository public and do not publish the
> raw asset files — only the packed atlas ever ships. See [ASSETS.md](ASSETS.md).

## Status

**M0–M3 complete** — a full 17-minute run plays start to finish, made of
coloured squares. Art (M4) has not been started, deliberately: the design says
if it isn't fun with squares, no amount of pixel art will save it.

Read [NOTES.md](NOTES.md) first — it has the measured performance, the one real
bug found, every deviation from the spec, and the design decisions now open.

| Milestone | State |
|---|---|
| M0 Skeleton | done (except the live URL — see NOTES) |
| M1 Combat core | done |
| M2 Progression | done |
| M3 Wave and shop loop | done |
| M4 Art pipeline → M8 Ship | not started |

## Running it

```bash
npm install
npm run dev
```

WASD / arrows / left stick to move. Space or right trigger for your class
ability. Weapons fire themselves.

`F1` (or backtick) toggles the dev overlay: frame time graph, pool counts, draw
calls, a seed box, and enemy spawn buttons. `N` skips the current wave — without
it, balancing twenty-four waves means playing twenty-four waves.

```bash
npm test          # 56 tests, including a headless full-run acceptance test
npm run build     # typecheck + production build
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
