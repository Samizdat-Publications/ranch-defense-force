# NOTES — M0 through M3

Handoff back to the next design pass, per `CLAUDE.md`. Written 2026-08-10.

Stopped at the end of M3 as instructed. M4 (art pipeline) has not been started.

---

## What was built

**M0 — Skeleton.** Vite + TypeScript, pixel-perfect canvas sizing at device DPR,
fixed 1/60s loop with accumulator and render interpolation, keyboard + gamepad
input, follow camera with dead zone and lead, dev overlay, Pages workflow.

**M1 — Combat core.** Fixed-capacity pools with swap-pop, 64px spatial hash
(counting-sort layout, zero per-query allocation), enemy steering with
separation, auto-firing weapons, the §5 damage pipeline, deaths and drops, hit
flash, damage numbers, trauma screenshake, hitstop on crits only.

**M2 — Progression.** XP gems with the accelerating magnet, level-up card screen
with written-out stat deltas, the single-pass stat resolver, all 12 passives.

**M3 — Wave and shop loop.** Spawn director on the threat budget with the
pressure ceiling, 24 continuous waves, feed economy with interest, shop at
5/10/15/20/24 with escalating reroll and per-card lock, six weapon slots with
tier merging, results screen.

56 tests pass (`npm test`), including a headless full-run acceptance test.

---

## Verified, with numbers

**Performance.** Measured in Chrome at 1920×1080, driving the sim and renderer
directly (the browser pane was not compositing, so these exclude presentation —
rAF frame time was not measurable in this environment and should be confirmed by
eye).

| Load | Sim/step | Draw/frame | Total | Budget |
|---|---|---|---|---|
| ~450 enemies | 0.12ms | 0.19ms | **0.31ms** | 16.6ms |
| 800 enemies (pool cap), 6 weapons, 1482 draw calls | 0.32ms avg | 0.39ms avg | **0.71ms avg** | 16.6ms |
| same, worst single frame | 5.6ms | 2.7ms | **8.3ms** | 16.6ms |

M1's "500 enemies holds 60fps" passes with roughly 20× headroom on average. The
8.3ms worst frame is a lone outlier, almost certainly a GC pause.

**Determinism.** A full 24-wave run replays byte-identically from its seed —
same kills, damage, positions, level, feed. Tested for both classes.

**M3's balance criterion.** "Wave 24 is survivable with a good build and not with
a bad one" holds under four scripted pilots on seed 20260810:

| Build | Movement | Result |
|---|---|---|
| takes whatever came up | circles the centre | **died, wave 24** (t=929s) |
| takes whatever came up | kites the crowd | cleared |
| merges + favours defence | circles the centre | cleared |
| merges + favours defence | kites the crowd | cleared |

A build that takes nothing never gets past the mid-teens. That is the shape the
design asked for — but these bots are crude and are **not** a substitute for
playing it. See "What still needs a human" below.

---

## One real bug, found by the acceptance test

Feral dogs bark to summon a second pack (§8). Every summoned dog also barked, so
each pack summoned a pack: **4ⁿ growth that saturated the 800-enemy pool inside
18 seconds of wave 4** and ended every run there. Barks also bypassed the
pressure ceiling entirely, because the ceiling was enforced inside the spawner
and the bark path did not go through it.

Fixed both ways: bark-summoned dogs are marked as having already barked, and
barks now check the ceiling and a 6-second global interval. The interval
(`BARK_INTERVAL` in `world.ts`) is the one number that ended up in code rather
than JSON — it is a recursion guard, not balance, but say the word and it moves.

This is the argument for M1's "if it isn't fun with squares, stop" rule working
in the other direction too: the bug was invisible while playing (dogs arrive,
that's the point) and obvious the moment a bot ran the whole 17 minutes.

---

## Deviations from the spec, and why

**1. Added `src/content/tuning.json`.** The design fixes every balance number but
not the engine-level ones a build needs — base move speed in px/s, base pickup
radius, camera lerp, knockback decay, pool sizes, i-frame duration. Rather than
edit the delivered JSON or hardcode them (CLAUDE.md forbids the latter), they
live in a separate file. The design's own five JSON files are byte-identical to
what was handed over.

Base move speed was set to **160 px/s**, which is the single most consequential
number invented here: it puts The Hand at 128 (above a farmhand's 65, below a
rooster's 145) and The Kid at 216 (above a duck's 170). Everything about how the
classes feel keys off it. Worth a look early.

**2. Built all 12 weapons and all 6 enemy behaviours — M5 scope — at base
fidelity.** M3's shop draws from the full pool, so a shop offering a weapon that
does nothing would have made the milestone untestable. What exists is each
weapon's base behaviour plus the §7 per-tier ×1.6 damage scaling. What does
**not** exist is the named tier riders (T3 shovel hitting twice, chili burn
spreading on death, and so on) — those are still M5, and the cards currently
describe riders that do not fire yet.

**3. Enemy on-death specials are half-wired.** Acid pools and gas clouds spawn
as hazards and render, but only damage enemies, not the player. Player-facing
hazard damage, the gas readability treatment, and Wet Rag's grace window are M5.

**4. `assets/generated/` paths in `ASSET_MAP.md` are stale.** The sheets were
normalised to lowercase-hyphen names in subfolders before this handoff arrived,
so `assets/generated/farmer.png` is now
`assets/generated/characters/farmer-01.png`. Full mapping in
`assets/generated/README.md`. **This must be reconciled before M4** — the atlas
builder reads those paths.

Related: the map lists `Gas zombie.png` as an excluded 16×16 export. No such file
exists in the repo. All 12 committed sheets are 1792×704, so the assertion the
design asks the atlas builder to make will pass on everything present. The
assertion is still worth writing.

**5. GitHub Pages will not deploy from a private repo on a free plan.** The
workflow builds, typechecks and tests correctly, but the deploy step needs a paid
plan. The repo must stay private (the LimeZu licence forbids redistribution), so
M0's "on a live URL" is unmet unless the plan changes or the build is hosted
privately elsewhere. Everything else in M0 is done.

---

## What still needs a human

Nothing here has been played. The whole point of M1's rule — if it isn't fun with
squares, stop — is a judgement no test makes, and these are the specific things a
bot cannot tell you:

- **Does killing something feel good?** Flash, knockback, damage number jitter
  and crit hitstop are all in and tuned to the numbers in §11, but "satisfying"
  is not a measurable quantity.
- **Do the two classes actually play differently,** or does The Hand just feel
  slow? Momentum and Braced are implemented; whether the movement axis carries a
  whole class identity is a play question.
- **Is 40 seconds × 24 waves too long?** §14 already flags this and says cut run
  length before touching any other number. A bot cannot get bored.
- **Does the shop's lock get used?** It is the mechanism meant to turn the shop
  into a hunt. If nobody locks anything it is dead UI.

The fastest way to answer all four: `npm run dev`, press `N` to skip waves, and
use the dev overlay's spawn buttons to stack a screen.

---

## Design decisions now needed

**1. Base move speed (160 px/s) and the enemy speeds are now coupled.** Every
speed in `enemies.json` was written against an unstated player speed. If 160 is
wrong, roosters (145) and ducks (170) are the two that break first — a duck
slightly faster than The Hand is a very different enemy from one slightly slower.

**2. There is no damage-percentage item in the pool.** All 12 passives are
defensive, utility or attack-speed; the only source of raw damage scaling is
weapon tier merging. That is a coherent choice — it makes merging the whole
offensive game — but it means an unlucky player who never sees a duplicate has no
way to scale damage at all. Intended, or a gap?

**3. The shop can offer a weapon when all six slots are full and every weapon is
maxed.** Currently those offers are filtered out, so late shops thin toward items
only. With the Seed Catalog unlocks (M7) the pool widens and this eases, but at
M3 the wave-24 shop is noticeably thinner than the wave-5 one.

**4. Elites are spawn-time only.** §8 says every fifth wave, one in ten spawns as
an elite. Implemented as written, which means an elite can spawn into a wave the
player then skips past. Should elites instead be guaranteed a minimum count per
elite wave?

**5. Hitstop is global.** 40ms on a crit freezes the whole sim, including other
enemies' attacks. At high attack speed with several crit sources this is
noticeable. §11 says crits only, which is done — but at +200% attack speed the
frequency may need a floor.

---

## Next

M4, art pipeline. Before starting it: reconcile `ASSET_MAP.md` against the real
`assets/generated/` paths, and confirm the 12 character sheets are pushed (they
are — 1792×704 each, verified).
