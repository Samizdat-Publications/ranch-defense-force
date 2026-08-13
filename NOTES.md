# NOTES

Handoff back to the next design pass, per `CLAUDE.md`. Latest session first.

---

## Start here

**State:** M0–M5 done, and **M0's "on a live URL" is finally met** — the repo
is public and Pages deploys on push:

**https://samizdat-publications.github.io/ranch-defense-force/**

A full 24-wave run plays start to finish in real pixel art, with conformed FX,
every advertised weapon tier rider firing, and animals that turn to face you.
85 tests pass.

Verified on the live build, not just locally: the atlas serves (438 frames,
122KB), the animal facings are in it, and every `assets/` path 404s — only the
packed atlas ships.

**First thing:** `npm install && npm run atlas && npm run dev`. The atlas is
gitignored and generated; without it you get coloured squares.

**Still not played by a human since the art landed.** Session 3 drove the sim
and the UI directly and verified the shop → level-up → resume cycle by
hit-testing, but nobody has held the controls. The last time a human did, they
found a blocking bug no test caught. Combat changed a lot in M5 — play it.

### What is outstanding

1. **Art direction** — boss art, the animals' unused front/back clips, fences
   and props, palette-index enemy recolours. In progress.
2. **A human playtest.** A first balance pass is done (`npm run balance`) and
   found three bugs, but nobody has held the controls since the art landed.
3. **M6 — bosses.** Prize Bull (wave 12) and Duster (wave 25) have entries in
   `waves.json` and no behaviour and no art.
4. **Elites are spawn-time only** — an enemy cannot become one later. Now that
   the per-group roll is fixed this is a design question rather than a bug.

### The repo is public now, and M0's live URL is unblocked

Pages will not deploy from a private repo on a free plan, and the repo was
private because the LimeZu licence forbids redistributing the packs. The owner
obtained permission from LimeZu to publish this repository and chose to do so
with the licence text in front of them, so both halves of that deadlock are
gone. Pages is enabled and building from the workflow:

**https://samizdat-publications.github.io/ranch-defense-force/**

The permission is specific to this repository. `assets/` still never deploys —
only the packed atlas ships — and the packs should not be copied into other
projects.

The deploy workflow ran `vite build` without `npm run atlas` for as long as it
was never actually deploying, which would have published a game rendering every
sprite as a coloured square. It builds the atlas now.

---

# Session 5 — roster, elements, and the first boss

## Start-here delta

M6 is **half done**: the Prize Bull fights, the Duster does not exist. See
"What M6 still owes" below before picking it up.

## The roster

Twelve weapons rebuilt around the bought art, ranged-heavy. The twelve
behaviours are untouched — they work, they are tested, they are distinct — so
this was a reskin and a retheme, not a rewrite. Three melee were kept on
purpose: they are the only weapons that reward standing still, which is The
Hand's identity and now also how you mine, and an all-ranged roster would have
quietly deleted a class.

Tier art: merging changes the weapon. Guns step up their category, melee steps
up its material. The Pixcuit pack is **not complete per tool** — no Iron
Pitchfork, no Golden Sickle — so the four materials differ by weapon.

Renaming the weapon ids meant first removing the hardcoded id literals
(`findAttached('axe')`, `WEAPONS.eggToss`). Those resolve from the projectile's
own `weaponId` or the owning slot now, which is more correct anyway: renaming a
weapon in JSON can no longer silently break code.

## Elements

Fire, acid or frost, one at a time, converting every ranged weapon. The element
**swaps the whole bullet** rather than tinting one, which cost no new art
because the packs already ship a fireball, an acid glob and an ice spike as
separate animations. Fire ignites slop slicks — two things the player already
chose doing something neither does alone.

It needed no new damage plumbing at all: the lasting damage rides on the
`burnDps`/`bleedDps`/`slowOnHit` payload fields the tier riders already used.

## Harvesting was rewarding the wrong playstyle

Flat-rate proximity harvesting **paid the kiter more than the stander**.
Sweeping past twenty nodes at base rate beat working one, so the mechanic built
to give a stationary player something to do inverted its own intent, and The
Hand's advantage had narrowed from 13 points to 4 before the harness caught it.
Nodes now ramp to 3x over two seconds of dwell and bleed off faster than they
build.

## The boss that spawned itself

`ENEMY_IDS` was `Object.keys(ENEMIES)`, so adding the Prize Bull put it in the
wave director's roster. A boss carries `threatCost: 0` precisely so the budget
cannot refuse it — which meant the director could pick it for free, without
limit. **Every bot run died on wave one.** Bosses are excluded from the roster
now and placed explicitly by `spawnBoss`; there is a test.

Related and long-standing: `bossWaves` put the Duster on wave 25 while
`waveCount` was 24, so the run called `finishRun` the instant wave 24 completed
and wave 25 never began. **The final boss was unreachable in every build that
has ever existed.** waveCount is 25.

## What M6 still owes

1. **The Duster.** Nothing exists — no art, no behaviour. §9 wants two phases:
   a fixed agricultural back-and-forth laying gas that never chases, then below
   50% it comes for you directly while the rows burn inward and shrink the
   arena to a third. The tractor sheet is at
   `assets/modern-farm/32x32/Vehicles_32x32/Tractor_32x32.png` (1152x960) and
   its grid has NOT been measured — run `npm run pitch` on it first; the cow
   sheet turned out to be 96px pitch at row 6 while every other animal is 64 at
   row 2-4.
2. **The Bull's charge is the generic `charge` behaviour.** It winds up and
   staggers, and Stampede fires below 50%, but it does not yet damage its own
   trash in the lane or slam the fence.
3. **Audio.** Still nothing, and still no source material in `assets/` — this
   is the one milestone item blocked on something outside the repo.
4. **Pause screen.** No Escape handling anywhere.

---

# Session 4 — mining, and the assets to draw it

## Harvesting rebuilt on the Deep Rock Galactic: Survivor model

The old model was crops that broke when a stray bullet clipped them. That is
invisible chip damage the player never chooses, and it made the field scenery
rather than a place. The new one is DRG:S's: **nodes you stand next to, worked
continuously by tools that are not weapons.**

- **Three node kinds** in `src/content/nodes.json` — rock, tree, crop — with
  per-variant HP, feed and XP. The LimeZu pack ships rocks with ore already in
  them (bronze, silver, gold, blue, red), so the payout tier is legible before
  you commit to standing there, which is exactly DRG's "minerals embedded in
  the rock".
- **Proximity harvesting.** Stand in range and the tool works on its own,
  every node in reach at once. No weapon slot, no button, no stopping shooting.
- **Two tool ladders**, wood → stone → iron → steel → diamond, bought with
  `pickaxeHead` / `axeHead` upgrades through the normal offer pool.
- **Nodes pay XP as gems**, not just feed. In DRG:S mining is the primary
  early-game XP source and this is what makes that true here rather than
  decorative — ten seconds standing on one bronze seam took a level-1 player to
  level 2.
- **Mobs drop seed packs** (5%), a feed trickle that is not tied to standing
  still, so a player kited all wave still earns.

### Weapons no longer damage nodes, and that was the whole ballgame

The first build kept the old "projectiles break crops" path alongside the new
tools. It silently defeated the entire design: a shovel swing carries more
damage than a wooden pickaxe does in five seconds, so every node was broken
incidentally by whatever was shooting past it.

Measured: **0.28s to break a rock on every tool tier, wood through diamond** —
identical, because the tool was never the thing breaking it, and the upgrades
bought nothing at all. With weapons removed from nodes it reads properly:

| Pickaxe | Time to break a bronze seam |
|---|---|
| Wooden | 5.63s |
| Iron | 1.93s |
| Diamond | 0.90s |

Worth keeping as a shape: a new system layered beside an old one that does the
same job will lose to it silently, and the symptom is "the upgrade does
nothing" rather than an error.

### What the harness says, and why to read it carefully

Clear rates held (Hand 94% holding ground, Kid 100%) and median level rose from
26 to 30, so mining is contributing XP. But **the bots barely mine** — median 0
to 8 nodes in a seventeen-minute run — because they kite constantly and never
choose to stand anywhere. The brawler pilot mines four times what the kiter
does, which is the design working: standing still now pays, and that is The
Hand's identity.

Do not tune harvest rates against these numbers. They measure a bot with no
mining behaviour at all; a human who deliberately parks on a gold seam is a
different economy entirely. This needs a human playtest before any balancing.

---

# Session 3 — M4 finished, M5 content, balance, weapon visibility

## Weapons you can actually see

Playtest finding, and the correct diagnosis was the player's: *"when I get a new
weapon I don't think I'm actually getting a new weapon."* He was right, and it
was one root cause with three symptoms.

**Not one of the twelve weapon sprites was ever packed.** Every entry in
`weapons.json` carries a `sprite` field — `tool_shovel`, `crop_corn`,
`prop_bucket` — and `art/sprites.json` had never heard of any of them. So:

- Projectiles never got a frame and fell through to the coloured-square
  fallback, which is why **every ranged weapon looked identical**: same pale
  green square, sized by radius. Six weapons firing was indistinguishable from
  one.
- Melee arcs took the same path at `radius * 2`, so a shovel swing drew as a
  **~100px white box** — the loudest thing on screen, and the reason melee felt
  like the only weapon that "worked".

Fixed in three parts:

1. **Weapon sprites are packed** as `weapon.<id>`, keyed to the weapon ids.
2. **Projectiles draw their weapon's sprite**, rotated — thrown things tumble,
   fired things point where they are going, orbits spin. A projectile that never
   rotates reads as a decal sliding over grass.
3. **Melee arcs and auras stopped being objects.** They are volumes, so they
   draw as a swept wedge and a soft ring instead of a sprite or a square.

### The weapon ring

Weapons now sit spaced around the player and turn to point at what they are
shooting, Brotato-style, kicking back when they fire. The angles live on the
weapon slot in the sim (`ringAngle`, `aimAngle`, `recoil`) and the renderer only
draws them — targeting is a simulation decision and the render layer does not
get to have an opinion about it. The ring is what makes ownership, aim and rate
of fire legible at a glance, and it is the direct answer to "did I actually get
a new weapon".

### Two things worth keeping

**The pack is an environment set, not an item-icon set.** There is no axe,
watering can or fishing rod anywhere in it at 32x32. Stand-ins are used and
named honestly in `art/sprites.json` — a hacksaw blade for the axe, a milk can
for the watering can, a fishing branch for the rod. Swapping them later is a
one-block change.

**Several files named `*_Load_*` or `*_Stack_*` are multi-tile piles.**
`Bucket_Load` is 58x64 of stacked buckets and went into the ring as an
unreadable brown slab twice the player's size; nothing about it looked wrong in
the manifest, it was just a bucket that was actually nine buckets. The atlas
builder now asserts weapon icons fit one tile and fails naming the file, in the
same spirit as the 1792x704 humanoid check.

---

# Session 3 — M4 finished, M5 content, first balance pass

## The balance pass, and `npm run balance`

`tools/balance.ts` runs the whole game many times headlessly and reports what
happened: clear rate, which wave runs die on, what was on the field when they
did, where the damage came from, and which weapons the offer pool actually hands
out. `tests/run.test.ts` asks yes/no questions; this asks how and why, which is
what a balance change needs before and after.

    npm run balance -- 24 both

Read it as *relative*. The pilots are crude bots and the absolute clear rate is
not a prediction of how a person will do — but the same tool across a change
is a real measurement.

It immediately found three things, two of them bugs rather than balance.

### Standing in acid made you invulnerable

`damagePlayer` grants 0.5s of mercy invulnerability so a crowd cannot chain-hit
you to death in three frames. Wiring hazards into it in M5 meant an acid pool
ticking eight times a second handed out i-frames eight times a second. Standing
in the pool made you immune to everything else on the field, and the pool itself
landed about a quarter of the damage its JSON claimed, because most of its ticks
fell inside the mercy window it had just granted itself.

Environmental damage now neither grants i-frames nor is blocked by them, and
skips the dodge roll — you cannot sidestep a cloud you are standing in.

### The gas cloud was wider than the screen

`cloudRadius 90` + `cloudGrowth 30` over `cloudDuration 6` is a final radius of
**270**, against a camera view 520px wide. Fine while the cloud was decoration;
once it damaged you it was not a hazard you could play around, it was a tax with
no visible edge, and hazards were 44–60% of all damage taken. Growth is now 10,
landing at 150 — half the screen, still frightening, walkable-out-of.

### One elite roll was spawning a whole squad of elites

The worst of the three. The spawner rolled `chance(0.1)` **once per group** and
handed the result to every member, so one success turned a group of three to six
into three to six elites at 4x health, arriving shoulder to shoulder. §8's "one
in ten" means one in ten *enemies*. The roll moved into the per-enemy loop.

The harness had found 2.6 elites alive at the average death and wave 5 — the
first elite wave — killing more runs than any other. Afterwards: 1.2 elites at
death, and the wave 5 spike is gone.

| | before | after |
|---|---|---|
| The Hand, kiting | 71% | 79% |
| The Kid, kiting | 83% | 100% |
| hazard share of damage taken | 44–60% | 31–35% |

### The class gap was the instrument, not the game

Those numbers left The Hand at 79% and The Kid at 100%, and the parity test
started failing. The temptation was to buff The Hand. That would have been
wrong: **the bot only kites**, which is precisely The Kid's kit — fast, damage
scaling with velocity — and precisely the opposite of The Hand's, which buys
damage reduction by standing still and has an ability that roots it. A
kiting-only harness reports The Hand as weaker no matter what the game does.

Adding a `brawler` pilot that holds ground while healthy settled it:

| | kiting | holding ground |
|---|---|---|
| The Hand | 79% | **92%** |
| The Kid | **100%** | 83% |

Each class is strong at its own game and weak at the other's, which is the
design working. The Hand's wave-5 deaths vanish entirely when it is allowed to
stand still. Nothing was tuned; `run.test.ts` now flies each class the way it is
built to be played, and a new test asserts the cross-over above, so if the two
classes ever stop being different the parity numbers stop lying about it.

**The lesson worth keeping:** twice in this session a measurement was wrong
before the game was — the tier probe that rewarded not killing, and the parity
test that measured The Kid twice. Check what the instrument is actually asking
before tuning anything to satisfy it.

### Still open

- The Kid clears 100% of 24 seeds kiting. The bot kites perfectly and a human
  will not, but that is the number to watch if the game feels soft.
- Deaths that remain cluster on waves 10 and 15 — elite waves, now with a
  sensible number of elites on them.
- Crop yield differs a lot by stance: a kiting Kid harvests ~38 a run against a
  standing Hand's ~19, because it covers more ground. Feed income therefore
  favours the runner. Probably fine, possibly worth a look.


## Conforming the FX pack

`tools/conform-fx.ts` extracts 32 colours from the LimeZu sheets by seeded
k-means in Oklab and writes `art/palette.json`; `build-atlas.ts` imports the
quantiser and conforms every FX frame as it packs. There is deliberately no
directory of conformed PNGs on disk — one generated artefact is enough to keep
track of.

**The pack's real geometry, since the spec does not give it and the inspect tool
mis-reports it:** each sheet is **64×64 cells**, columns are animation frames,
and the nine **rows are colour variants of the same animation** (0 orange,
1 magenta, 2 cyan, 3 green, 4 tan, 5 white, 6 mauve, 7 red, 8 blue).
`tools/inspect-sheet.ts` assumes 32px cells and will tell you a sheet is 26×18.
Eight clips are packed, named semantically in `art/sprites.json`; the other 172
files are never looked at again.

### The conform looked wrong, and it was the palette, not the metric

First attempt sampled terrain, crops and animals. The resulting 32 had **no
saturated red between hue 20° and 40° and no light green at all**, so the
explosion's `#d64f5a` body landed on the strawberry crimson `#cf2266` — the only
saturated thing anywhere near that hue — and the gas cloud's bright `#cbf17a`
highlight, which is most of its area, landed on cream. Two effects came out
magenta and olive.

The instinct was to blame nearest-in-Oklab and weight the distance. That was
worth doing and is still in (matching runs in Oklch with hue and chroma charged
above lightness, because a muted palette forces every saturated pixel to lose
chroma somewhere and unweighted matching pays that bill by rotating hue). But it
barely moved these two, and the diagnostic — dumping each clip's dominant
colours with their nearest three palette entries — showed why: **there was
nowhere right to send them.** Sampling `0_Complete_Tileset_32x32.png`, the whole
pack on one sheet, fixed both outright.

Worth remembering as a shape: when a quantiser picks badly, check the palette
covers the region before tuning how you measure distance.

### Effects never touch the sim's RNG

`playFx` takes no RNG and the rate limits are fractional accumulators, not rolls.
A cosmetic decision that consumed `world.rng` would mean the number of sparks
drawn moved every later enemy spawn, and the seed-replay guarantee would be
hostage to the art. There is a test for it.

## M5 — the riders, and four bugs behind them

Every rider named in `weapons.json` now fires, and the magnitudes are all JSON.
Getting there needed infrastructure that did not exist: burn, bleed,
vulnerability marks and slows on enemies, a rider payload on the projectile
applied by `applyHit`, plus `shrinkHazards`, the melon rind, ranked target
search, lure detonation and shard bounces.

**Four things were not missing features but broken code:**

1. **The axe dealt zero damage in every run ever played.** Orbiting blades
   stamped their hits with a constant `-1`, and `spawnEnemy` initialises `e.t1`
   to `-1`, so the "this stamp already hit this enemy" guard was true before the
   blade touched anything. It is sold in the shop. Stamps now come from the tick
   and re-arm on an interval.
2. **The watering can's slow was a no-op.** It wrote the percentage into
   projectile scratch, which was read by `e.stun = Math.max(e.stun, 0)`.
3. **`applyHit` damaged before it applied statuses**, so a killing chili shot
   never lit what it killed and T3 "burn spreads on death" could not fire at
   all. Statuses land first now; a mark should also benefit the hit that applies
   it.
4. **Barn Dog T2 multiplied velocity by 1.5 every tick** it ran, which compounds
   without bound. Speed is a target the dog steers toward now.

Acid pools and gas clouds damage the player, which is what the acid zombie is
*for*; they spawned, rendered and were harmless. Making them lethal made hazard
readability a fairness requirement rather than polish, so harmful hazards now
read in a different colour family from yours, carry a bright rim, and pulse —
movement in the periphery is what you notice with two hundred enemies on screen,
and it is reserved for the things that hurt.

### The axe's orbit, and measuring weapons honestly

Fixing the stamp bug exposed a second problem: at the design's 74px the blade
sweeps a ring enemies are never in. Chasers press to about 25px, and a blade
orbiting at 74 passes 49px clear of them. The axe worked only at a sprint.

The orbit now interpolates between a 42px floor and the design's 74 on
`velocityFraction`, so it tightens as you slow. This keeps the wide sweep the
design drew for a moving player, makes the axe a real pick for The Hand, and
reads in play — the blades visibly draw in when you plant your feet. T2's
"+25% radius" scales only the wide end: the floor is geometry, not a tunable,
and scaling it pushed a T2 axe back out of contact and made the rider worse than
no rider.

**The measurement mattered as much as the fix.** The first probe topped a ring of
enemies back up as they died, which measures throughput *and* how long
replacements take to walk in — and those pull against each other, so a stronger
tier clears faster, stands idle, and scores lower. It reported a T2 axe as worse
than T1. The tier test now holds the dummies at 1e9 hp and measures output
alone. Any future weapon comparison should use that rig and not the other one.

---

---

# Session 2 — playtest fixes, M4 art pipeline

## The shop freeze

The reported freeze at the first shop was not a time limit and not the sim
hanging. The HUD is a full-viewport overlay created *after* the screens, so it
painted on top of them, and `#ui > * { pointer-events: auto }` beat
`.hud { pointer-events: none }` on ID specificity. Every click on a shop or
level-up card landed on the HUD. The sim was paused with no reachable way out,
so **the first shop of every run was terminal**. Layers now opt in individually.

Confirmed by hit-testing the card's centre before and after: `elementFromPoint`
returned `.hud`, now returns the card, and a full buy → close → resume cycle
works.

Also fixed: the shop subtitle named the wrong wave, because `onWaveComplete`
fired before the wave counter advanced.

## Balance changes

**Enemy speeds up, slow end hardest.** Chasing shamblers was the dead time, so
the floor moved more than the ceiling: farmhand 65→82, acid zombie 70→88,
bloated 75→90, hauler 50→66, sheep 45→60, hog 60→84 (charge 220→260), dog
110→132, sprayer 85→100, rooster 145→160, duck 170→185.

The first pass overshot at 92 for farmhands. That left The Hand a 36 px/s margin
at its 128 px/s and **it cleared 1 seed in 6 while The Kid cleared 6 of 6** — a
class-balance break, not a difficulty one. Softened to 82 and the two classes are
back to succeeding and failing on the same seeds. The run acceptance test now
surveys six seeds instead of pinning one, and asserts class parity directly, so
that gap cannot silently reopen.

**Damage scaling.** Nothing in the pool touched `damagePct`, and `meleePct` and
`rangedPct` were in the damage formula with no source at all — weapon merging
was the only way to scale damage. Added Whetstone (+10% damage), Hay Hook (+18%
melee), Sling Bands (+18% ranged), Kerosene Can (+25% damage, −15 max HP).

**Rarity** is now declared in `items.json` rather than inferred from shape.

## The level-up screen

Four cards: **exactly one uncommon-or-better at double magnitude**, the rest
common at normal. The boosted slot is shuffled into position so it has to be
read for rather than learned.

Doubling is level-up only. The shop is where you pay to get exactly what you
need; doubling there too would flatten the difference between the two systems
that §3 is built on.

A boosted item is pushed into the resolver **twice** rather than scaled, so stat
resolution stays a pure additive sum and nothing multiplies. A boosted weapon
merge jumps two tiers.

## Harvestable crops

46 crops scattered from ten real crop sprites, broken by any weapon, paying feed,
regrowing five a wave so the field is never permanently stripped. HP scales with
the wave. They y-sort with everything else, so the player walks in front of and
behind them.

This is the Brotato-style economy the design did not have: it gives a player
with spare seconds something to do with them, and turns "the wave is thin right
now" into a decision rather than dead time.

## M4 — art pipeline

**`tools/png.ts`** — a minimal PNG codec on Node's built-in zlib. Written rather
than pulled in because the design caps dependencies at three, and adding `sharp`
(a native binary) or `pngjs` to slice sprites offline is not worth the budget.
Handles 8-bit greyscale, RGB, palette and RGBA, non-interlaced — everything the
packs actually use.

**`tools/build-atlas.ts`** — slices every source named in `art/sprites.json`,
trims each frame to content bounds, records a bottom-centre pivot, and packs one
`public/atlas.png` + `atlas.json` with 2px bleed. The game never reads `assets/`
at runtime, which is also what keeps the licensed art out of a deployed build.

**The 1792×704 assertion is in** and is the point of the file. A wrong-sized
sheet fails the build naming the file.

**`tools/inspect-sheet.ts`** — reports the frame grid of any sheet. This is how
the rigs were derived rather than guessed, and it should be run on every new
generator export.

### What the rigs actually are

The design says all thirteen character sheets share one rig, and they do — but
not the one the doc implies. They are 56×22 cells of 32px, and **a character is
32×64 spanning a stacked row pair**: the even row holds the upper half, the odd
row the lower. That gives 11 clips at 4/24/24/36/36/56/40/36/24/8/36 frames,
which matches the pack's own `_36_frames` / `_56_frames` file naming. Only idle
(4) and walk (24 = 4 directions × 6) are packed; slicing all 22 rows for 13
characters would spend most of the atlas on animations nobody sees.

**The animal sheets do not share a rig.** Each species differs, and this is worth
knowing before anyone plans content around "animals are free":

| Species | Sprite | Walk row | Frames/direction |
|---|---|---|---|
| Rooster | 32×32, single row | 3 | 6 |
| Feral dog | 32×64, row pair | 4 | 12 |
| Duck | 32×64, row pair | 2 | 12 |
| Sheep | 32×64, row pair | 2 | 12 |
| Pig | 32×64, row pair | 2 | 12 |

`atlas.json` emits per-sheet clip lengths, because a renderer assuming one number
animates a rooster at half speed. Animals ship no idle clip, so walk frame 0 is
packed again under an idle key.

### The animal sheets fought back

First pass produced 10×50 "plank" enemies for the up and right facings. The
cause is not a slicing bug: on the two-row animal sheets the front and back
clips are drawn at proportions that do not match the side views — a rear-view
pig measures **16×52 against a 28×32 side view** — and there is no 32px grid
alignment that makes both read correctly.

Rather than ship visibly broken sprites, only the two **side** clips are packed,
and up/down alias onto them. Every animal now reads correctly at every facing;
it simply does not turn to face the camera, which at this sprite size is close to
unnoticeable. `sideCols` in `art/sprites.json` carries the column offsets, and
the rooster (a single-row sheet whose four directions are all well-formed) still
uses all four via `allDirections`.

**Worth revisiting** with fresh eyes: the front/back clips are real art that is
currently unused, and understanding their layout would give the animals proper
facing. `tools/inspect-sheet.ts` and a scaled dump are how to approach it.

Also added `dominantBandBounds` to the PNG helpers — takes the tallest
*contiguous* band of occupied rows rather than raw bounds, so a frame window
that catches a slice of a neighbouring clip discards it. A no-op for
well-formed sprites; cheap insurance for the next sheet.

### Renderer

446 frames, 1024×1024, 85KB. Draws at **2× integer zoom** — a 32px sprite at
1080p is otherwise about a fingernail, and non-integer scaling breaks the pixel
grid. Walk frames advance by **distance travelled**, not time, so sprites never
skate. Terrain bakes once from real tiles.

Hit flash uses a white silhouette copy of the atlas rendered once at load, so it
costs one `drawImage` from a different source rather than a per-sprite
`save`/`globalCompositeOperation`/`restore` — at 800 enemies that is the frame
budget.

Anything the atlas has no art for still draws as a coloured square with bob and
lean, so a missing sheet costs the art and not the game.

## Dependency added

`@types/node`, dev-only and types-only, zero runtime bytes, so the build tools
typecheck. Tools have their own `tsconfig` since they need node globals and `.ts`
import extensions the game's config should not allow. Recorded here because
CLAUDE.md requires a written reason.

## Still not done in M4

- **`tools/conform-fx.ts` and `art/palette.json`.** The FX pack is untouched and
  unused. The design is emphatic that dropping it in unconformed is the single
  most likely way this ends up looking assembled rather than made — so nothing
  uses it yet rather than using it raw.
- **Boss art.** The Prize Bull (cow ×2) and Duster (tractor ×3) are M6.
- **Props, fences, pickups.** XP gems and feed are still coloured squares. They
  read fine as abstract game objects, but the pack has real sprites for them.
- **Palette-index recolour** for enemy variants (§10 step 4).

## Open questions, updated

1. **Base move speed is 160 px/s** and every enemy speed is now tuned against it.
   Still the most consequential invented number in the project.
2. **Direction order** is assumed to be down/up/left/right. Down and up are
   confirmed by eye; left and right are a coin-flip that looks right at 32px and
   would be a one-line fix in `art/sprites.json` if they are swapped.
3. **Crop density (46) and feed value (2)** are guesses. If harvesting is better
   than fighting, the value is too high.
4. Everything in the previous session's list below still stands.

---

# Session 1 — M0 through M3

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

## Performance, measured

Chrome at 1920×1080, driving sim and renderer directly (the browser pane was not
compositing, so these exclude presentation — rAF frame time was not measurable in
that environment and should be confirmed by eye).

| Load | Sim/step | Draw/frame | Total | Budget |
|---|---|---|---|---|
| ~450 enemies | 0.12ms | 0.19ms | **0.31ms** | 16.6ms |
| 800 (pool cap), 6 weapons, 1482 draw calls | 0.32ms | 0.39ms | **0.71ms** | 16.6ms |
| same, worst single frame | 5.6ms | 2.7ms | **8.3ms** | 16.6ms |

M1's "500 enemies holds 60fps" passes with roughly 20× headroom on average.

## The bark recursion

Feral dogs bark to summon a second pack (§8). Every summoned dog also barked, so
each pack summoned a pack: **4ⁿ growth that saturated the 800-enemy pool inside
18 seconds of wave 4** and ended every run there. Barks also bypassed the
pressure ceiling, which was enforced inside the spawner while the bark path went
around it.

Fixed both ways: bark-summoned dogs are marked as having already barked, and
barks check the ceiling and a 6-second global interval. That interval
(`BARK_INTERVAL` in `world.ts`) is the one number in code rather than JSON — it
is a recursion guard, not balance.

Invisible while playing, obvious the moment a bot ran the whole 17 minutes.

## Deviations from the spec

**1. Added `src/content/tuning.json`** for engine-level constants the design did
not specify — base move speed, pickup radius, camera lerp, knockback decay, pool
sizes, i-frames. The design's own five JSON files are byte-identical to delivery
apart from the balance changes noted in session 2.

**2. Built all 12 weapons and all 6 enemy behaviours at base fidelity**, ahead of
M5, because M3's shop draws from the full pool and a shop offering a weapon that
does nothing would have made the milestone untestable. The named tier riders (T3
shovel hitting twice, chili burn spreading on death) are still M5 — **the cards
currently describe riders that do not fire yet**.

**3. Enemy on-death specials are half-wired.** Acid pools and gas clouds spawn as
hazards and render, but only damage enemies, not the player. Player-facing hazard
damage, gas readability and Wet Rag's grace window are M5.

**4. `ASSET_MAP.md` paths are stale.** The sheets were normalised to
lowercase-hyphen names in subfolders before the handoff arrived, so
`assets/generated/farmer.png` is now
`assets/generated/characters/farmer-01.png`. Full mapping in
`assets/generated/README.md`. The atlas manifest uses the real paths.

Related: the map lists `Gas zombie.png` as an excluded 16×16 export. No such file
exists in the repo. All 12 committed sheets are 1792×704.

**5. GitHub Pages will not deploy from a private repo on a free plan.** The
workflow builds, typechecks and tests correctly, but the deploy step needs a paid
plan, and the repo must stay private. M0's "on a live URL" is unmet unless the
plan changes or the build is hosted privately elsewhere.

## Design decisions still open

1. **There is no damage-percentage item** — addressed in session 2, but the
   original design intent (merging *is* the offensive game) was deliberate and
   the new items may undercut it.
2. **The shop can thin out late** when all six slots are full and every weapon is
   maxed; those offers are filtered, so late shops trend toward items only.
3. **Elites are spawn-time only.** §8 says one in ten on every fifth wave,
   implemented as written, which means an elite can spawn into a wave the player
   skips past.
4. **Hitstop is global.** 40ms on a crit freezes the whole sim. At +200% attack
   speed with several crit sources this may need a floor.
