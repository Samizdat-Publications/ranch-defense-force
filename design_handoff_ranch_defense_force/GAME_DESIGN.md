# Ranch Defense Force — Game Design Specification

Version 2.0 · Canton, Ohio · one level, two classes

---

## 0. Premise

Something came off the crop duster that went over low on Tuesday. By Thursday
the hands had stopped going home. You are the last person on the property who
still has a job to do, and the job is what it always was: work the field until
the light goes.

That sentence pays for every asset in the packs. The zombie farmhands are the
people who breathed it. The figures in gas masks are the ones who knew it was
coming and came anyway. The livestock got it too. And the tractor is still out
in the far field running the pattern somebody gave it on Tuesday morning,
because nobody ever told it to stop.

Tone: cute, with real stakes and real blood. Pixel gore that stains, not horror.

---

## 1. Stack

**TypeScript + Vite + Canvas 2D. No engine.**

A bullet-heaven needs three things an engine does not help with: thousands of
pooled entities per frame, a fixed-timestep simulation, and a single sprite
atlas blitted in one pass. Everything else — scenes, physics bodies, tweens, an
editor — is API surface in the way.

Canvas 2D holds well over a thousand sprites at 60fps in Chrome when they all
come from one atlas and you never touch `save/restore` per sprite. That is
above the ceiling this game needs. If profiling ever disagrees, swap the
renderer module for a WebGL sprite batcher; nothing else changes, because
rendering sits behind one interface.

Rejected: **Phaser** (GameObject model fights pooling), **Godot** (best engine
for the genre, worst agent loop — no fast text-only iteration, scene files
hostile to diffs), **Electron** (200MB of Chromium for a 3MB game; use Tauri
later if desktop is wanted).

Dependencies: `vite`, `typescript`, `vitest`. Nothing else. HUD and menus are
DOM overlaid on the canvas.

---

## 2. Architecture

```
src/
  main.ts       boot, canvas sizing, atlas load, scene switch
  core/         loop · input · rng (seeded mulberry32) · pool
                spatial (64px hash grid) · atlas · audio
  sim/          world · player · enemy · spawner · weapon · projectile
                damage · pickup · stats
  content/      classes.json  weapons.json  items.json  enemies.json
                waves.json  meta.json
  behaviours/   weapons.ts  enemies.ts  bosses.ts   (string key -> function)
  render/       renderer (camera, y-sort, one atlas)
                terrain (baked once) · vfx · decals (blood, stains)
  ui/           hud · levelup · shop · homestead · menu · results   (DOM)

tools/          build-atlas.ts   slice + pack the LimeZu and generated sheets
                conform-fx.ts    quantise the FX pack to the LimeZu palette
art/            palette.json     32 colours extracted from the packs
                sprites.json     source-of-truth asset manifest
```

Every number lives in JSON. Behaviour that cannot be data — a boss phase, a
weapon's firing pattern — is a named function in a lookup table that the JSON
references by string key.

### Tick order — never reorder

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

### Non-negotiables

- Fixed 1/60s step with accumulator; render interpolates.
- Zero allocation in the hot loop. Pool everything; reverse-iterate + swap-pop.
- Circle-vs-circle collision against the hash grid only.
- All randomness through the seeded RNG.
- Sim and render never import each other's internals.

---

## 3. The loop

Waves flow into one another with **no break** — wave 8 begins on the frame wave
7 ends. Only two things stop the game: a level-up card screen (fires the
instant a gem tips you over) and the shop (after waves 5, 10, 15, 20, and once
more before the final boss).

Twenty-four waves at 40 seconds ≈ a 17-minute run.

| Phase | Duration | What happens |
|---|---|---|
| Wave *n* (1–24) | 40s, no gap | Threat budget spends down. Survivors carry into the next wave. |
| Level-up | instant freeze | 3 cards from the full pool. Resume on pick. |
| Shop — 5/10/15/20 | untimed | Arena clears. 4 slots, reroll, lock. Same pool as level-ups. |
| Wave 12 | — | Mid-boss: the Prize Bull, alongside normal spawns. |
| Wave 25 | — | Final shop, then the Duster. No trash until phase 2. |

### Two upgrade systems, one pool

Level-ups and the shop draw from **exactly the same pool**. The difference is
agency and cost:

- A **level-up** is free, fast and random. Three cards, take one, keep running.
- The **shop** is slow and paid: four slots you can reroll and individually
  lock for next time. This makes it where you go *hunting* for the one item
  that finishes a build.

Level-ups give you what the run offers. The shop lets you go get what the build
needs. Feed pays for both.

### Formulas

```
xpToNext(L)   = ceil( 6 + 3*L + 0.9 * L^1.55 )     // ~34 levels per run
waveIncome(n) = 6 + 3*n                             // feed, paid at wave end
shopReroll    = 3 + 2*rerollsThisShop
levelReroll   = 4 flat
interest      = 8% of unspent feed at each shop, capped at 12
```

Cards per level-up: 3 (4 at high luck).

---

## 4. Between runs — the Homestead

A run pays out **acres**:

```
acres = 2*wavesCleared + 25*bossKill + 10*firstTimeThisTier
```

Four tracks. Three make the game *wider*; only one makes it easier, and that
one is hard-capped.

| Track | Cost | What it does |
|---|---|---|
| **The Bunkhouse** | 40 / 90 / 150 / 240 | Classes. The Hand and The Kid are free. Four more locked. A new class is one Farmer Generator export plus a stat block and one ability. Show locked ones as dark silhouettes from day one. |
| **The Seed Catalog** | 15–40 each | **Pool expansion — the important one.** Runs start with 8 of 12 weapons and 12 of 20 items. The rest unlock permanently into every future run. Makes runs more *varied* rather than more powerful. |
| **The Feed Store** | 5 ranks each | Permanent stats: +5 max HP, +2% move speed, +1 armor, +3% harvest, +2% luck. **Total effect at full purchase must land near +25% and no further.** |
| **The County Fair** | earned | Difficulty tiers. Killing the Duster unlocks Tier 2, etc. Each adds +25% enemy HP and one named modifier. Tiers multiply the acre payout so climbing beats farming Tier 1. |

### Save format

One versioned JSON blob in localStorage:

```json
{ "v": 1, "acres": 0, "unlockedClasses": [], "unlockedPool": [],
  "feedStoreRanks": {}, "tierCleared": 0, "bestRun": null }
```

Store **purchases, never derived values** — recompute stat totals at run start.
Ship a migration function from v1 on day one; you will change this shape.

---

## 5. Combat math

```
raw   = weapon.base * (1 + dmgPct + typePct) + flatDmg
crit  = roll(critChance) ? raw * (1.5 + critDmgBonus) : raw
final = max(1, crit * (1 - armor / (armor + 40)))
        * waveScalar          // enemies only: 1 + 0.06*(wave-1)
```

**Stats (14).** Offence: Damage %, Melee %, Ranged %, Attack speed, Crit
chance, Crit damage, Range, Projectile count. Defence/utility: Max HP, HP
regen, Armor, Dodge, Lifesteal, Move speed, Pickup radius, Luck, Harvest.

**Resolution is one pass:** sum flat, sum percentages additively, apply once.
No multiplicative stacking anywhere — it is the fastest way to break a game
like this, and it keeps every upgrade's value predictable to the player.

Caps: dodge 60%, attack speed +300%. Armor uncapped (diminishing curve).

---

## 6. The two classes

Both are Farmer Generator exports on the identical rig, so they cost nothing
extra to support. They differ on the **movement axis**, which changes what
every item in the shared pool is worth — move speed is survival for one and
nearly dead weight for the other; armor is the reverse.

### The Hand — anchor · `farmer.png`

*Thirty years on this ground. Slow, hard to move, and not especially worried.*

HP 140 · Speed −20% · Armor +6 · Regen +1.5/s · Pickup radius +40% · Crit −50%

- **Passive — Braced.** Standing still for 1s grants stacking damage reduction,
  +6% per second to 30%. Resets on move.
- **Ability — Dig In (14s).** Plants the shovel. Immovable and 70% damage
  reduction for 2.5s, ending in a knockback pulse clearing 140px. Uses the
  digging animation rows verbatim.
- **Starting weapon — Shovel.**

### The Kid — momentum · `Female Farmer.png`

*Home from school for the summer. Only ever safe at speed; stopping is the
mistake.*

HP 75 · Speed +35% · Armor 0 · Dodge +10% · Crit damage +25% · Regen 0

- **Passive — Momentum.** Damage scales with current speed: +1% per 2% of max
  velocity, to +50%. Falls to zero when standing.
- **Ability — Bolt (6s).** Dash 180px with i-frames, leaving a dust trail that
  blinds pursuers for 2s. Uses the run rows plus a stretched afterimage.
- **Starting weapon — Seed Spitter.**

**Adding classes later:** pick a new *axis*, not a new stat spread. Range,
summons, luck, and a class that rewards standing in the gas would give six that
never overlap. Candidates already exported: `farmer2`, `farmer3`, `farmer4`,
`1.png`, `2.png`.

---

## 7. Weapons

**Structural decision: weapons do not attach to the player.** They orbit, arc
and fly on their own, moved by code. That is how the genre works anyway, and it
means every weapon is a single static sprite the engine rotates and translates
— no rig, no per-class animation, no new art.

Buying a duplicate **merges it up a tier** rather than filling a second slot.
Each tier scales base damage ×1.6 and adds one behavioural rider, so a maxed
weapon is qualitatively different, not just bigger. Six slots.

Full data in `content/weapons.json`. Summary:

| Weapon | Dmg / CD | Behaviour · T3 rider |
|---|---|---|
| Shovel | 18 / 0.7s | Forward arc, heavy knockback. T3: hits twice. |
| Axe | 13 / cont. | Orbits the player, spinning. Scales with move speed. T3: second blade. |
| Watering Can | 4 / 0.35s | Rotating jet, 130px, slows. T3: washes gas clouds away. |
| Fishing Rod | 26 / 1.8s | Hooks the *furthest* enemy in range and drags it to you. T3: drags three. |
| Seed Spitter | 6 / 0.22s | Fast inaccurate stream. T3: +2 projectiles. |
| Melon Lob | 15 / 1.1s | Arcs to target, 50px splash. T3: leaves a slippery rind. |
| Chili Shot | 8 / 0.5s | Pierces 2, applies burn. T3: burn spreads on death. |
| Egg Toss | 11 / 0.9s | Bounces twice, splits on the second. T3: splits into four. |
| Slop Bucket | 20 / 2.0s | Leaves a slick halving speed for 5s. T3: the slick damages. |
| Framing Hammer | 34 / 1.6s | Overhead slam, small radius, stuns. T3: shockwave ring. |
| Grain Lure | 0 / 6s | Drops a sack pulling enemies toward it for 4s. Enables every AoE build. T3: detonates. |
| Barn Dog | 10 / 1.0s | Autonomous, hunts the nearest small enemy using its own run animation. T3: two dogs. |

### Passive items

Twelve to start, in `content/items.json`: Feed Sack (+20 max HP), Work Boots
(+8% speed), Weather Vane (+12% attack speed), Salt Lick (+1.0 regen), Barbed
Wire (reflect 5 to contact attackers), Tractor Plate (+4 armor, −5% speed),
Rooster Alarm (+25% pickup radius), Silo Key (+15% harvest), Four-Leaf (+10
luck), Coffee Thermos (+6% speed, +6% attack speed, −10 max HP), Straw Hat
(enemies within 60px deal 15% less), Wet Rag (immune to gas for first 2s of
contact).

---

## 8. Level one — the Whitacre place

Single open arena, **2400 × 1600**, camera-followed with a soft dead zone. Not
a maze — sight lines are the game. Corn rows on two edges are the only
occluders, drawn above the player, and things come out of them.

Terrain bakes once into an offscreen canvas from `1_Terrains_32x32.png` and the
autotiles, then blits as one image per frame. Props from
`Single_Files_32x32/Props_and_Buildings_32x32/`.

**Ambient life.** Uninfected chickens wander and scatter when anything nears.
Worth 2 feed if killed — a small, unkind choice. They stop appearing after wave
14; nobody remarks on it.

**Gas.** The one hazard that isn't an enemy. Clouds linger, expand slightly and
deal damage per second inside. It is the readability risk in a game this dense,
so: gas is the **only** translucent thing on screen and it renders **below**
all sprites.

### Enemy roster

Full data in `content/enemies.json`.

| Enemy | HP/Spd/Dmg | Waves | Sheet | Behaviour — and what it teaches |
|---|---|---|---|---|
| Farmhand | 14 / 65 / 6 | 1–24 | `Zombie` | Straight shamble, spawns in tens. The chaff that makes AoE feel good. |
| Rooster | 9 / 145 / 4 | 2–24 | `Chickens_and_Roosters` | Fast, erratic, no separation. Hard to single-target, melts to anything wide. |
| Feral Dog | 30 / 110 / 10 | 4–24 | `Dogs` | Packs of four, flanks rather than beelines, and barks — a 1s tell that a second pack is inbound. Teaches: check behind you. |
| Duck Flight | 12 / 170 / 7 | 5–24 | `Ducks` | Eight at once, fly a straight lane past you and loop back. Teaches: don't stand in a lane. |
| Acid Zombie | 40 / 70 / 12 | 6–24 | `Acid Zombie` | Leaves a corrosive pool *where it dies*. Teaches: kill things somewhere you don't need to stand. |
| Masked Sprayer | 45 / 85 / 14 | 7–24 | `gas enemy` | The only ranged enemy. Holds at 260px, sprays a telegraphed cone. Teaches: priority targeting. |
| Blown Sheep | 120 / 45 / 18 | 9–24 | `Sheeps` | Immune to knockback, 60% damage reduction from the front. Teaches: get behind things. |
| Sick Hog | 160 / 60→220 / 25 | 10–24 | `Pigs` | Lines up, charges straight, overshoots, staggers 1.5s. The window is the reward. |
| Bloated Farmhand | 55 / 75 / 10 | 12–24 | `zombie2` | Bursts into a spreading gas cloud on death; the cloud outlives it by 6s. Punishes indiscriminate clearing. |
| Masked Hauler | 220 / 50 / 22 | 14–24 | `gas enemy2` | Slow tank granting +40% HP to every enemy within 150px. Kill it first or kill nothing. Teaches: read the field, not the nearest target. |

> `Gas zombie.png` was an accidental 16×16 export and is **not used**.

### Spawn director

Each wave has a **threat budget**, not a spawn list:

```
budget(n) = 30 + 22*n + 1.4*n^2
```

Spend it on enemies unlocked at that wave, weighted per-enemy, spread across
the wave with a bias toward a heavy final quarter. Spawns come from arena edges
and corn tiles, **never within 220px of the player**.

**Pressure ceiling.** Because waves never stop, above **380 live enemies** the
director withholds spawns until the count drops. Without it, a player who falls
behind compounds into an unwinnable screen by wave 15 and the run is decided
long before it ends.

**Elites.** Every fifth wave, one enemy in ten spawns as an elite: ×4 HP, ×1.5
draw size, gold outline, guaranteed feed drop. Same sprite, palette-shifted
outline — no new art.

---

## 9. The two bosses

Both are existing sprites drawn at integer scale with a palette shift.
**Integer only — ×2 or ×3, never ×2.5**, or the pixel grid breaks and the whole
screen stops being pixel art. A 32px cow at ×2.2 is a blurry cow; at ×2 with a
darkened palette and a half-speed walk cycle it is a different animal entirely.
Scale plus timing does the work new art would otherwise do.

### Wave 12 — The Prize Bull
`Cows_32x32` @ ×2 · 900 HP

He took a blue ribbon at the county fair two years running and he is nine
hundred pounds of it. Palette shifted to near-black with red eyes, walk cycle
slowed to half speed so every step lands heavy.

- **Charge.** Paws the ground for 1.2s facing you — the tell is a dust puff
  loop at his feet — then crosses the entire arena in a straight line, damaging
  everything in the lane *including his own trash*. Slams the far fence,
  staggers 2s.
- **Stampede.** Below 50%, every charge summons four Sick Hogs that charge
  alongside him in the same lane. The lane becomes the whole fight.
- **Why he's here.** Wave 12 is where a build either works or doesn't, and a
  boss that only ever attacks in a straight line tells the player which without
  killing them for a bad build. Normal spawns continue throughout.

### Wave 25 — The Duster
`Vehicles_32x32` tractor @ ×3 · 2,400 HP

Nobody is driving it. It has been running the same pattern since Tuesday
morning and the tank on the back is still three-quarters full.

- **Phase 1 — The Pattern.** It drives a fixed agricultural back-and-forth
  across the arena at a steady, unhurried speed, laying a strip of gas behind
  it. **It does not chase, ever.** The fight is about where you stand relative
  to a machine that will not deviate — the arena fills with lanes you can't be
  in, and the danger is entirely of your own making. Rust-red palette, no other
  change.
- **Phase 2 (below 50%) — Off the Rails.** The pattern breaks. It turns, finds
  you, and comes on directly and slowly, dragging its gas strip in a curve. Hay
  bales fly off the back on a timer and bounce off the fences. Farmhands and
  Bloated Farmhands pour continuously from the corn. The rows burn inward from
  the edges over ninety seconds, shrinking the arena to roughly a third.
- **Tells.** Every attack has a ≥0.7s wind-up with a ground decal. No
  unavoidable damage — the arena shrink is the only undodgeable pressure and
  it's slow enough to plan around.
- **Death.** It doesn't explode. It slows, coughs and stops, and the gas thins
  out. Then the light goes.

### Boss rendering rules

- Nearest-neighbour, integer scale only.
- Palette shift by remapping through `palette.json` **indices**, not a CSS
  filter or alpha tint — index remapping keeps the art flat, filters make it
  muddy.
- **Slow the animation frame rate rather than adding frames.** Big things read
  as heavy when they move at 6fps against everything else's 12.
- Health bar pinned to the top of the screen, not floating over the sprite.

---

## 10. Art pipeline

### The generator exports are the best thing in the project

All thirteen character sheets share one grid: **56 columns × 22 rows**,
1792×704 at 32px per cell. Player, zombies, acid variants, gas-mask figures —
identical layout, frame order and pivot. One slicer config, one animation state
machine, one code path for every humanoid. Swapping a character is swapping an
atlas page index and nothing else.

It also means **new enemies are nearly free forever**. A new export is a new
enemy with full animation for the cost of a JSON entry — which is why §4's
Bunkhouse track and the difficulty tiers can promise content without promising
art.

### Step 1 — Hold the scale, and enforce it in code

32×32 everywhere. The packs ship 16, 32 and 48; only the 32 directories are
ever read. This already went wrong once — `Gas zombie.png` came out at 896×352,
the 16px export, and would have silently rendered at half size.

**So the atlas builder asserts it.** Every humanoid sheet must be exactly
1792×704 or the build fails loudly with the filename. Thirty seconds of code
that removes an entire category of bug you would otherwise find by eye, late,
in a crowd of two hundred sprites.

### Step 2 — Build one atlas from a manifest

`tools/build-atlas.ts` reads `art/sprites.json` — the only place a file path
ever appears — slices each source by its declared grid, trims to content
bounds, records a bottom-centre pivot and a collision radius, and packs
everything into `public/atlas.png` + `atlas.json` with 2px bleed. Runs offline;
the game never sees the packs.

**Only slice the rows you actually use.** Twenty-two rows per humanoid is
generous; the game needs idle, walk, run, a hit pose and a death pose. Slicing
all 22 for 13 characters wastes most of the atlas on animations nobody sees.

### Step 3 — Conform the FX pack to LimeZu's palette

The FX pack is the one thing in the repo drawn by a different hand, and it is
more saturated and more arcade than LimeZu's muted farm palette. Dropping it in
raw is the single most likely way this game ends up looking assembled rather
than made.

`tools/conform-fx.ts`: extract 32 colours from the LimeZu sheets into
`art/palette.json`, then quantise every FX frame to the nearest entry **in
Oklab, not RGB**. Same shapes, same timing, now the same game. Do this before
judging whether an effect works — plenty look wrong raw and right conformed.

The FX filenames are meaningless numbers. Pick the eight or ten you need off
the preview GIFs, rename them semantically in `sprites.json`, and never look at
the other 186 again.

### Step 4 — Get variety from code, not from files

- **Palette-index recolour** — one sheet becomes four enemy variants by
  remapping indices at atlas-build time. This is how you get tiered enemies
  without more exports.
- **Bob and lean** — 2px vertical sine tied to distance travelled, 4–8°
  rotation into the direction of travel. Applies to sprites with no run cycle.
- **Squash and stretch** — scaleY 1.0→1.08 on the same phase, scaleX inverse.
- **Hit flash** — redraw the sprite in white with
  `globalCompositeOperation:'source-atop'` for 60ms.
- **Death** — no death frames needed: spin, scale to zero over 200ms, spray
  palette-coloured pixels.

---

## 11. Game feel and blood

In this genre feel *is* the game — the mechanics are trivially simple. Build
these during M1, not as polish afterwards, because without them nothing can be
evaluated.

**On hit:** 60ms white flash on the target · 2px knockback along the hit vector
· damage number rises 20px, fades 500ms, jitters ±4px so stacks stay readable ·
one conformed FX frame scaled to the hit's damage · 40ms hitstop **on crits
only** — never on chaff, or it reads as lag.

**Camera:** 40px dead zone, 0.12 lerp · leads the player 30px in the movement
direction · trauma-based shake (player hit 0.4, bull charge 0.7, decays
quadratically).

**Readability rules:**
- Enemy projectiles are the only saturated magenta on screen. Nothing else may
  use that hue.
- Gas is the only translucent thing, and renders below all sprites.
- Separation steering keeps a pile from fully occluding the player.
- The player renders at 85% opacity when a crowd overlaps them.
- Cap simultaneous damage numbers at 40; merge the rest.

**Pickup joy:** gems *accelerate* toward the player rather than lerping (the
greed curve) · ascending pitch on consecutive pickups within 300ms · wave
boundaries auto-collect everything in one sweep.

### Blood — cute, but it stains

One flat palette red (`#A02C2C`) plus one darker tone for stains. Never bright,
never wet-looking, never more than two colours — that restraint keeps it funny
rather than grim against LimeZu's soft palette.

- **Hit** — 3–5 red pixels along the hit normal, gravity-affected, 400ms life.
- **Death** — 8–14 pixels in a cone away from the killing blow, scaled to enemy
  size. Roosters spray a token 2 so a swarm doesn't redden the screen.
- **Stains** — landed pixels stamp a permanent decal onto a separate offscreen
  canvas above the baked terrain: **zero per-frame cost at any count**. Cap
  400; oldest fade over 2s.
- **Why it matters** — by wave 20 the ground where you like to stand is visibly
  dark. That accumulated record of your own run is the best feedback in the
  game and costs almost nothing.
- **Player damage never sprays** — a red screen-edge vignette instead, so you
  always know whose blood it is.
- **Acid and gas deaths** — green, same system, different palette index.

---

## 12. Screens

Five screens, all DOM over the canvas. Every panel, button and frame comes from
`modern-ui/32x32/Modern_UI_Style_1.png`, sliced as CSS `border-image` so frames
stretch cleanly to any size. **Pick Style 1 or Style 2 and never mix them.**
The Portrait Generator gives each class a face for the picker and results.

**HUD.** Top-left: HP bar with a delayed white damage-chaser. Top-centre: wave
number and a depleting timer ring. Top-right: feed. Bottom-centre: a thin XP
bar spanning the width — the one element the player actually watches.
Bottom-left: six weapon slots with cooldown wipes. Bottom-right: ability icon
with radial cooldown and a key hint from the gamepad glyph sheet. Everything
hugs the edges; the centre 70% stays clear.

**Level-up.** Game dims and freezes. Three cards slide up staggered 60ms apart:
icon, name, one line of effect, rarity edge (common straw / uncommon green /
rare gold). **The delta on any stat the card changes is written out** — "+12%
attack speed → 1.24/s" — because a player who can't see the effect won't feel
the upgrade. Keys 1–3 select. Reroll costs 4 feed.

**Shop.** Left: four cards with prices, an escalating-cost reroll, and a lock
toggle per card carrying it to the next shop. Right: the live character sheet —
six weapon slots, owned passives, the full stat block with anything changed
since last wave highlighted. Hovering a card previews its effect on that block
in a second colour. "Back to work" button, bottom right, always reachable.

**Results.** Wave reached, time survived, kills, damage dealt, the build you
ended with, acres earned, run seed. Two buttons: "Run it back" (restarts with
the same class immediately) and "Homestead" if there are acres to spend. Never
make the player walk back through a menu.

**Homestead.** A farmyard laid out as four buildings you click into, drawn from
the props sheet. Acres fixed top-right with the current tier beside it. Inside
each: a plain grid of purchase cards — name, effect, cost, owned rank. Locked
classes render as solid dark silhouettes with their price, never as empty
slots. Anything affordable gets a warm outline, so the screen answers "what can
I buy right now" without reading a word. One "Head out" button to the class
picker.

**Controls.** WASD / arrows / left stick to move. Space or right trigger for
the class ability. That is the whole game — weapons fire themselves. Full
gamepad support from day one; it's thirty lines and the UI pack ships glyphs.

**Audio.** Neither pack ships sound — this is the one real gap. Sixteen effects
and three music layers still need sourcing. WebAudio, no library, voice cap of
8 per sound with a 40ms retrigger guard, or two hundred roosters dying at once
will blow out the mix.

---

## 13. Performance budget

| | |
|---|---|
| Enemy cap | 800 |
| Projectile cap | 1200 |
| Frame ceiling | 16.6ms |
| Total download | <5MB |

Terrain bakes once at load and blits as a single image per frame — never
per-tile draws. Sprites y-sort with a **counting sort into 8px buckets**, not
`Array.sort`. Blood decals live on their own canvas and cost nothing.

**Ship a dev overlay from M0:** frame time graph, entity counts by pool, draw
calls, wave-skip key, seed box. Without it, balancing twenty-four waves means
playing twenty-four waves.

---

## 14. Open questions

These are judgement calls, not settled facts. Revisit them in play.

- **Audio is unsourced.** The only genuine gap. Decide early: another purchase,
  or synthesised in WebAudio.
- **Twenty-four waves at 40 seconds.** If playtests say it drags, cut to 20
  waves *before* touching any other number — run length is the first dial, not
  enemy HP.
- **Shop and level-ups share one pool.** Clean, but a shop can offer what a
  level-up just gave you. If that feels bad, the fix is a short memory (nothing
  offered twice within 90 seconds), not two separate pools.
- **Ten enemies is a lot for one level.** If M5 sprawls, cut the Masked Hauler
  and Blown Sheep first; bring them back as Tier 2 additions.
- **Gas readability is untested.** Translucent hazards in a 400-entity screen
  are a real risk. If it reads badly, switch gas from a filled area to an
  animated outline with a sparse interior.
- **The Duster's phase 1 might be too passive.** A boss that never chases is an
  unusual choice and either lands beautifully or feels like an obstacle course.
  The fix is giving it one tracking attack, not making it chase.

Everything here is cheap to change before M3 and expensive after it.
