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

State at the end of session 25: Tier 2, **~4870 generations** left this cycle,
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

## 1. Finish the enemy roster — two sheets left

Session 25 took enemy clip coverage from 10 of 22 sheets to 20 of 22 by
generating `attack`, `hit`, `death` and `walkHurt` on the ten humanoids that
were short. What remains:

| sheet | state |
|---|---|
| `duckFlight` | idle + walk only, and still **LimeZu's `Duck_Brown_32x32`**. The last pack sheet any enemy uses. |
| `duster` | now generated and 8-directional with a real death, but no `attack`. Arguably correct — nobody is driving it — decide rather than default. |

`duckFlight` is the one to finish. It is a bird, so it is an **object**, not a
character: `POST /v2/objects/{id}/animations`. Grep
`docs/PIXELLAB_INVENTORY.md` for duck first — session 25 found a complete
8-direction boss sitting unclaimed under `rdf-surplus`, and that is the second
time this repo has found finished work it had forgotten buying.

## 2. The endpoints, so you do not rediscover them

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

## 3. What a generated loop is good for

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

## 4. Then play and tune — still the owner's call, still untouched

**Nothing in the sim has moved since session 23.** Session 24 measured the
problem precisely and deliberately stopped, and session 25 was an art session.
The question is unchanged and it is a design decision, not a dial:

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
npm test           # 271 tests
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
