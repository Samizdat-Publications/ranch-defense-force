# Animation states — what exists, what is left, what it costs

Written session 18 so that a session with credits can start work in the first
minute instead of spending twenty rediscovering the shape of the job.

## The engine is done. This is purely art.

`Renderer.collectSprites` and `tools/draw-world.ts` both run the clip state
machine already:

    death  >  hit  >  attack  >  injured walk  >  walk  >  idle

**Every step falls through when its clip is absent.** So none of the work below
has to land together, nothing is blocked on anything else, and shipping a single
enemy's recoil is a complete change on its own. That is the property to protect:
do not batch these into an all-or-nothing pass.

Content knobs are `combat.hitClipSeconds` and `combat.injuredBelowPct` in
`tuning.json`. Both are render-only — neither changes damage, speed, or any
decision the sim makes — so they can be tuned without a balance session.

## How to add one

```
# 1. find the object id
grep -i "<the animal>" docs/PIXELLAB_INVENTORY.md

# 2. generate (MCP): animate_object with a description whose FIRST WORD
#    the classifier recognises — see tools/object-manifest.ts
#      reeling / recoiling / flinching / jerking / taking  -> hit
#      limping / staggering / hobbling / dragging          -> walkHurt
#      walking                                             -> walk
#      buckling / toppling / folding / collapsing ...      -> death
#      grazing / pecking / crowing / sitting ...           -> ambient
#    Anything else falls to `attack`, silently.

# 3. pull it down, classify, pack, catalog
npm run object -- <object-id> <directory-name>
npm run objman -- --write
npm run atlas
npm run catalog
```

**Check the directions landed.** v3 loses some silently and reports them as
covered — see `docs/PIXELLAB.md`. `objman` warns when a combat clip is short.
Filling a gap needs `directions=[...]` AND `replace_existing: true`.

## What is left, costed

At the measured **$0.0104 per direction**, so $0.083 for an eight-direction clip.

### Tier 1 — the animal enemies — **DONE**

All ten animal enemies carry `hit` and `walkHurt` in eight directions:
arabianCursed, blownSheep, donkeyCursed, draftMuleCursed, feralDog,
fjordPonyCursed, infectedHen, prizeBull, rooster, sickHog.

Cost the plan predicted: $1.41. Actual, including refill calls for directions
the API reported as covered and did not deliver: **about $1.90.** That 1.3x is
the direction-loss multiplier now recorded in `docs/PIXELLAB.md`, and it is the
number to budget with.

Two clips sit at 7/8 after refills that came back short twice --
`fjordPonyCursed.walkHurt` (no north-west) and `feralDog.walkHurt` (no
south-west). Both keep their ordinary walk in that one facing. Chasing the last
direction was not worth a third round trip; the fallback chain is what makes it
a cosmetic gap rather than a missing sprite.

### Tier 1 — as originally planned ($1.41, ~70 min serial)

These are PixelLab *objects*, so `animate_object` works directly and the
pipeline above is exactly what to run.

| clip | who is missing it | clips | cost |
|---|---|---|---|
| `hit` | blownSheep, donkeyCursed, draftMuleCursed, fjordPonyCursed, prizeBull, rooster, sickHog | 7 | $0.58 |
| `walkHurt` | all ten animal enemies | 10 | $0.83 |

Done already: `hit` on infectedHen, feralDog, arabianCursed.

**Do this tier first.** It is the visible half — these are the enemies that fill
a late wave, and the recoil is what makes a hit read as a hit.

### Tier 2 — the humanoid enemies — **PIPELINE UNBLOCKED, 3 of 5 done**

`farmhand`, `acidZombie` and `bloatedFarmhand` now carry idle / walk / hit /
death. `maskedHauler` and `maskedSprayer` remain.

**The blocker was tooling, not budget.** `tools/pixellab-character.ts` looked for
one hardcoded animation folder called `walk`, so hit and death art for these five
could be generated and would never be cut — the pipeline appeared to work and
produced nothing. It scans now, reads frame counts per clip, and prints the
manifest block so the template lengths are never hand-typed.

**Template presets are far cheaper than the animal path.** `taking-punch` and
`falling-back-death` cost 1 generation per direction, and the humanoid rig is
four-way rather than eight — so a humanoid state runs about a SIXTH of an animal
one. Actual spend for three humanoids, six clips: well under $0.20.

Frame counts come back at the template's own length — taking-punch 6,
falling-back-death 7, walk 8 — NOT a uniform 9. `pixellabStrips` slices a strip
by the manifest number, and a wrong one does not error: it slices at the wrong
width and the animation slides instead of stepping.

### Tier 2 — as originally planned ($1.66, ~80 min serial)

acidZombie, bloatedFarmhand, farmhand, maskedHauler, maskedSprayer. These are
PixelLab **characters**, not objects, so they need `animate_character` — and
that has a TEMPLATE mode with presets, including **`taking-punch`**, which is
the recoil as a preset rather than a written description. Cheaper and more
consistent than describing it.

They currently have `walk` and nothing else: no attack, no death, no recoil. So
they are also the roster's biggest quality gap — five enemies that pop out of
existence instead of dying.

| clip | count | cost |
|---|---|---|
| `hit`, `attack`, `death`, `walkHurt` × 5 | 20 | $1.66 |

### Tier 3 — the player classes (~$0.50)

The six playable classes have `walk` and `idle` only. A recoil on the player is
worth more than a recoil on any single enemy — it is on screen every second of
every run.

### Tier 4 — the blighted farm roster as enemies ($6.30, several hours)

The nineteen blighted twins are packed and drawable but wired to nothing. To
field them as enemies they each need `walk`, `attack`, `death`, `hit`,
`walkHurt` — 19 × 5 clips ≈ $7.90, less the ten flock walks already generated,
so roughly **$6.30**.

**This is a balance change as well as an art job.** Nineteen new enemies is more
than the current roster of seventeen, and `enemies.json` weighting is a joint
session with the owner, not something to tune alone. Do the art, wire nothing,
and bring measurements.

Cheaper alternative worth considering first: the `sheets` mechanism on
`EnemyDef` lets ONE enemy draw from many sprite sheets, cycled per spawn. Ten
blighted hens over one stat block is a varied flock for the cost of the art and
zero balance risk.

**But it needs `death` per bird, not just `walk`, and that is not obvious.**
Measured: the base `infectedHen` carries five clips (walk, attack, death, hit,
walkHurt); the nine blighted variants carry `walk` and nothing else. Wiring
`sheets` today would therefore trade one fully-animated hen for nine that fall
back to the spin-and-shrink on death -- losing the death animation on roughly
89% of hen spawns to gain plumage variety.

That is a bad trade and the reason this is not wired yet. `attack` matters much
less: a peck is 0.35s and falls back to the walk, which reads fine. **Death is
the expensive gap** -- it is a full second of an enemy leaving the screen, and
the spin is the stand-in the generated animals were bought to replace.

So the order is: nine `death` clips (~$0.75, plus refills), THEN wire `sheets`.
Eight of the nine walks are already packed; `farmRoosterBlight` still needs one.

### Tier 5 — ambient clips for the clean cast (~$0.53)

Scene-only, three facings each, for the title screen: equines graze, cats sit,
chickens peck, the rooster crows. Done: brahmaHen, fjordPony, arabian, rosie,
joy. Seventeen animals remain at three directions each.

Not needed for gameplay at all. It is what stops the yard being a diorama.

## Actual spend, measured

| tier | planned | actual | note |
|---|---|---|---|
| 1 — animal hit + injured | $1.41 | **~$1.90** | the 1.3x direction-loss multiplier |
| 2 — humanoids (3 of 5) | $1.00 | **<$0.20** | template presets, four-way rig |

The two numbers move in opposite directions and both are worth carrying
forward: **animal states cost more than they look** because v3 loses directions
and you pay to refill, and **humanoid states cost far less than they look**
because templates are 1 gen/direction on a four-way rig.

## Running total

| tier | cost | why it is in this order |
|---|---|---|
| 1 — animal enemy hit + injured | $1.41 | the enemies you actually fight |
| 2 — humanoid enemies, full set | $1.66 | five enemies currently pop out of existence |
| 3 — player recoil | $0.50 | on screen every second |
| 5 — ambient cast | $0.53 | the title screen |
| 4 — blighted roster as enemies | $6.30 | biggest, and needs a balance session |
| | **$10.40** | |

## The thing to not do

Do not generate anything before running:

```
grep -i <subject> docs/PIXELLAB_INVENTORY.md
```

Four sessions running described the barn, farmhouse and silo as missing art
while they sat generated and paid for. `npm run inventory` refreshes that file;
reading it costs nothing.
