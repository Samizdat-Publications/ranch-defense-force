# Build order

Nine milestones. Every one ends in something runnable in a browser and
judgeable. Do not proceed past M2 until movement and shooting feel good with
coloured squares — if it isn't fun with squares, no amount of pixel art will
save it, and you'll have made it much harder to tell what's wrong.

---

## M0 — Skeleton

Git repo already exists (private). Add: Vite + TypeScript, canvas with correct
pixel-perfect sizing, fixed-step loop with accumulator, input (keyboard +
gamepad), camera with dead zone, dev overlay, and a Pages deploy on push.

**Acceptance:** a coloured square walks around a flat field at a locked 60fps,
on a live URL. Dev overlay shows frame time and a seed box.

## M1 — Combat core

Object pools, 64px spatial hash grid, one chasing enemy type, one auto-firing
weapon, the damage formula, death and cleanup, hit flash, damage numbers,
screenshake, hitstop on crits.

**Acceptance:** squares kill squares and it already feels good. 500 enemies on
screen holds 60fps. Killing something is satisfying with no art involved. **If
this milestone isn't fun, stop and fix it before continuing.**

## M2 — Progression

XP gems with the accelerating magnet, the level-up card screen, the single-pass
stat resolver, six passive items.

**Acceptance:** a run gets meaningfully stronger. Stat deltas display correctly
on cards. Picking an upgrade visibly changes how the game plays within seconds.

## M3 — Wave and shop loop

Spawn director on the threat budget with the pressure ceiling, all 24 waves
running continuously with no gap, feed economy with interest, shop at 5/10/15/20
with reroll and lock, weapon slots and tier merging, results screen.

**Acceptance:** a complete 17-minute run start to finish, still with squares.
Wave 24 is survivable with a good build and not with a bad one. Run replays
identically from its seed.

## M4 — Art pipeline

`art/sprites.json`, `tools/build-atlas.ts` **with the 1792×704 assertion**,
palette extraction to `art/palette.json`, `tools/conform-fx.ts`, terrain bake,
the draw-time animation transforms (bob, lean, squash, flash, death spin).

Deliberately before content — content is much easier to judge once it looks
right.

**Acceptance:** the same game, now made of pixels, at the same framerate. One
atlas, one draw path. Feeding a wrong-sized sheet fails the build with a
filename.

## M5 — Content

Both classes with passives and abilities, all 12 weapons with tier riders, all
12 passives, all 10 enemies with real behaviours, elites, gas as a hazard.

**Acceptance:** the designed game. Every enemy teaches the thing §8 says it
teaches. Two classes play genuinely differently with the same item pool.

## M6 — Bosses, blood and audio

The Prize Bull, the Duster's two phases with telegraphs and the shrinking
arena, the blood decal system, 16 sounds, three music layers, title and pause
screens.

**Acceptance:** both bosses are beatable without taking unavoidable damage. By
wave 20 the ground shows where you've been fighting.

## M7 — The Homestead

Acres payout, the four meta tracks, the versioned save blob with its migration
function, the locked-pool filter, difficulty tiers and their modifiers.

**Acceptance:** a reason to press "run it back". Locked content is visible and
priced. A fully-bought Feed Store adds roughly +25% and no more.

## M8 — Balance and ship

Seeded playtests, tune **only** the JSON, settings and best run to localStorage,
Tauri wrap if desktop is wanted.

**Acceptance:** a competent player clears Tier 1 in about six runs. No balance
constant lives anywhere but `content/`.

---

## Every milestone

Write or update `NOTES.md`: what was built, what deviated from the spec and
why, what feels wrong in play, and the two or three design decisions now
needed. That file is the handoff back for the next design pass.
