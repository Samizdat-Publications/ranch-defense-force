# Ranch Defense Force — project conventions

Wave-based bullet-heaven, TypeScript + Vite + Canvas 2D, no engine.
Full spec in `design_handoff_ranch_defense_force/GAME_DESIGN.md`.

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

## Licensing

The repo is private and stays private. `assets/` is never deployed — only the
packed `public/atlas.png` ships. Credit LimeZu (limezu.itch.io) in the title
screen and README; the UI pack's licence requires it.

## Per-milestone

End every milestone by writing/updating `NOTES.md`: what was built, what
deviated from the spec and why, what feels wrong in play, and the design
decisions now needed.
