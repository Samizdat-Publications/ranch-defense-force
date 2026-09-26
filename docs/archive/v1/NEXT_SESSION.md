# Next session — the account is closing; finish the derivations, then play

> Rewritten 2026-09-19 (session 25). The version before this one said *"PixelLab
> is gone. The subscription was cancelled with the balance spent to exactly 0
> and the API key is dead."* That was written in session 15 and had been wrong
> for nine sessions — the account is live, paid, and the key resolves from
> `.mcp.json` with no env var. It also listed the yard scene, the crops, the
> weapons and the `duster` boss as outstanding art; every one of those had
> already been done. **Check the code before believing a document in this repo,
> including this one.**

## The clock, and what it actually costs you to ignore it

The owner said on 2026-09-18 that he is keeping PixelLab for **one more month**
and does not know the cut-off: *"once its cut off its cut off and i dont know
when it cuts off."*

State at the end of session 25: Tier 2, **~4300 generations** left this cycle (~700 spent),
**$8.52** credits, allowance resets 2026-10-14. Generations are abundant.
Credits barely move, because template animations and map-objects bill the
monthly allowance and not the USD pot — measured either side, repeatedly.

**What dies is not the art. It is the IDS.** Downloaded PNGs are ours forever
and committed. But `animate_character`, `animate_object`, `create_object_state`
and style-chaining all take an id that lives on PixelLab's servers. When the
account lapses you cannot derive a new animation, rotation or state from a
subject already paid for — you would start it again from nothing.

So the priority order is not "what art is missing". It is:

1. **Derivations off ids we already own** — new clips on existing characters and
   objects. This is the only work that becomes impossible.
2. **Claiming and downloading anything unclaimed.** `status: review` and the
   `rdf-surplus` tag both mean "bought, never picked up". Claiming is free.
3. **New subjects.** Last, because they are the spend that does not survive.

## 1. The enemy roster is finished — LimeZu is out of it entirely

Session 25 took enemy clip coverage from 10 of 22 sheets to **23 of 23 sheets
carrying the art they are meant to carry**, and no enemy draws from a bought
pack any more.

| sheet | what happened |
|---|---|
| ten humanoids | `attack`, `hit`, `death`, `walkHurt` generated off the `mannequin` skeleton |
| `duster` | was LimeZu's `Tractor_32x32`; now a generated 8-direction rusted crop duster with a nine-frame death |
| `duckFlight` | was LimeZu's `Duck_Brown_32x32`; now a generated 8-direction mallard in flight with a death |
| `crow` | generated in an earlier session, tagged `rdf-wired`, packed nowhere. Finished and packed; defined as an enemy but **held out of the rotation** |

**The crow is one line from being live, and that line is yours.** It is priced,
packed and sitting at `"weight": 0`; putting `"crow": 0.9` in a map's
`enemyBias` switches it on, because a map entry REPLACES the default rather than
multiplying it. It is held out because at every price tried it pushed
`tests/run.test.ts`'s idle-buy bar past its cap — 7/24 at `threatCost` 3, 6/24
at 4, against a cap of 5. A new enemy type does not add bodies to a fixed wave
budget, it redistributes them, so any crow worth fighting is also worth xp.

**And note how an enemy is held out**, because the obvious way is wrong:

    const bias = this.map.enemyBias[id] ?? def.weight ?? 1

Deleting an enemy's bias entries does not remove it — it defaults to **1 and
spawns on every map**. `"weight": 0` in `enemies.json` is the mechanism, and
`spawner.ts` says so in the comment directly above that line.

Two deliberate gaps, stated so they read as decisions: `duckFlight` has no
attack or hit (a lane-flying flock never turns to face you) and `duster` has
neither (its own content note says nobody is driving it).

**What is left is not enemy art.** Terrain, weapon and tool icons, the FX pack's
three surviving clips, the projectile pack, the scene strips. `terrainSource` is
the big one and needs **no generation at all** — 29 Wang sets are already packed
and retiring it is a wiring job.

**And the companions need no generations either.** `joy` (idle/walk/attack/sit),
`wiz`, `ouiji`, both cats, the mules and the hens are all packed with walk
clips. The owner's "companions that follow you, each with special abilities" ask
is a CONTENT job — items carrying a `minionSprite`, the way the Barn Dog and
Broody Hen already work. It was left alone because it changes balance, and
balance is the owner's call.

## 2. What is banked and not switched on

Four bosses, a crow, five biome props and twenty-five unused Wang sets are
built, packed, tested and deliberately inert. Each is one line from live:

| thing | the line |
|---|---|
| a boss | `waves.json` -> `bossWaves`, e.g. `"15": "bossSow"` |
| the crow | a map's `enemyBias`, e.g. `"crow": 0.9` |
| a biome node | a map's `nodes.variantWeights`, e.g. `"node.cattails": 20` |
| **The Bottoms** | `"weight": 1` on the map that is already written |
| another level | a `maps.json` entry naming one of the 25 unused ground sets |

They are inert because **`weight: 0` is the only thing that holds an enemy
out** -- the spawner reads `map.enemyBias[id] ?? def.weight ?? 1`, so deleting a
bias entry PROMOTES an enemy to weight 1 on every map rather than removing it.
That cost a full test cycle to find. Same pattern for node variants.

**The Bottoms is already built** -- a wide shallow bog on ground, nodes and a
hazard decal that were all already paid for. It sits at weight 0 because a sixth
surface map costs exactly one seed on the idle-buy bar: 6 of 24 against a cap of
5. That number did not move when its bias was retuned hard in both directions,
so it is the reshuffle of which map each seed rolls rather than the map being
soft. Turning it on is a decision about that bar, which is yours.

The Feedlot, the Orchard and the Dustbowl all have their ground packed and
waiting, and The Bottoms is the template.

## 3. The endpoints, so you do not rediscover them

Both were found by reading `/v2/openapi.json`, which is fetchable with the same
key. **Ask the API rather than guessing at it.**

| subject | endpoint |
|---|---|
| character (humanoid, has a skeleton) | `POST /v2/animate-character` |
| object (animal, machine, prop) | `POST /v2/objects/{object_id}/animations` |

They are mirror images of each other and the wrong one 404s or 405s. In
particular `POST /v2/characters/{id}/animations` **exists** and answers OPTIONS
with `allow: DELETE`, so using it returns 405 — which reads as a bad request
body on a good endpoint and will send you debugging the wrong file.

`npm run charanim -- <jobs.json>` wraps the character side, backs off on the
ten-job concurrency ceiling, and `--list` prices a run for free.

Three more things that cost session 25 time:

- **The template list is per SKELETON.** The OpenAPI description advertises
  `attack`; `attack` is invalid on `mannequin`, and the 422 names the real list.
- **A character or object is `423 Locked` for download while ANY of its jobs is
  pending.** You cannot judge clips as they land one at a time.
- **Per-direction size drift.** Two directions of the duster's death came back
  96x96 against the object's 113x113 because they were generated when the object
  was smaller. The packer catches it and refuses. Do not pad or scale — 113/96
  is not an integer and the boss would visibly shrink when it faced west.
  Regenerate that direction with `replace_existing: true`.

## 4. What a generated loop is good for

Session 25 bought 42 clips through `/animate-with-text-v3` and wired twelve.
**The endpoint regenerates its subject on every frame.** It is good when a rigid
body carries a small bright emitter and the emitter is what changes — crystal
glow, flame, gas, an electric arc. It is unusable on a large textured mass: the
regeneration noise exceeds the motion, boulders morph into different stones, and
it recolours (a rusty burn barrel came back teal, a hay bale sage) or removes
content (a water trough drained).

**Sway, bob and rock are geometry, not art.** They are done in code now —
`tuning.json` -> `sway`, a rotation about the sprite's bottom-centre draw origin
so a plant pivots at its roots. Free, deterministic, cannot morph.

## 5. Then play and tune — still the owner's call, still untouched

**The balance question has not been touched.** Session 24 measured it precisely
and deliberately stopped; session 25 was an art session and changed exactly two
things in the sim — the `playFx` fallback that had been swallowing every
elemental impact, and the crow's `threatCost`, which was priced to be
balance-neutral because `tests/run.test.ts` caught it not being so. The question
is unchanged and it is a design decision, not a dial:

> A player who stands still and takes weapons and merges clears the game on
> every class but the Widow. `idle-greedy` on all six classes: hand 18/24, kid
> 12, widow 9, vet 16, agronomist 20, drifter 14.

Read the end of the session 24 entry in NOTES.md before touching a number. Its
measured conclusion is that every lever on the hp/xp curve moves WHEN a run ends
and none of them touches "untouched through wave 10", because what produces that
is arrival shape and not arrival count. Its three candidates, in its own order of
preference:

1. **Weapon slots that open over the run** — three at the start, one more at each
   shop. A greedy picker cannot then have six weapons by wave 4, and it touches
   nothing else.
2. `weaponOfferWeight` down from 6.
3. `xp.exponent` 1.85 -> 2.0 as the fallback.

`npm run probe -- 24 idle-greedy` is the measurement. The owner's rule is to
tune from his play and not from the bots, so bring him numbers rather than a
changed game.

## Verification, every time

```bash
npm run atlas      # and READ THE PRINTED DIMENSIONS, not just the exit code
npm test           # 273 tests, and run.test.ts alone takes about 20 minutes
npm run objfill -- <id>:<name>                # loop until every clip is 8/8 -- one round is never enough
npm run typecheck  # game and tools have separate tsconfigs
npm run shot -- 600 out.png 4242 hand --hit   # a real run, headless; --hit forces recoils
npm run contact -- <sheet> <clip>             # pull frames back OUT of the packed atlas
```

`npm run contact` is the one that proves the whole chain — manifest entry,
packer, frame key and direction list together. A sheet can be perfect on disk
and still be drawn wrong because its key is not the one the renderer asks for.

**The browser pane only composites when the window is focused**, so
`requestAnimationFrame` never fires otherwise and screenshots time out. Use
`npm run shot` for the field and `npm run scene` for the title screens.
