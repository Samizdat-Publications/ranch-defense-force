# Next session — finish retiring LimeZu, then maps, then tune

**This is the owner's own order, in their words:**

> *"Do finish retiringn lime zu > more maps > then we cna play and tune again
> since i just got done playing"*

They have played the built game and it held up — *"I plaed it and it was
great."* Two things came out of that playtest and both are carried below.

**Two facts that change what this session is.**

1. **PixelLab is gone.** The subscription was cancelled with the balance spent
   to exactly 0 and the API key is dead. Nothing can be regenerated. Every art
   task below is *picking and wiring* from candidates already on disk. If a
   candidate set has no good option, the answer is a stand-in and a note — not a
   generation.
2. **The art is already made.** Session 15 generated 247 images covering
   essentially everything LimeZu still supplied. Read
   **`assets/pixellab/SESSION15.md`** before touching any of it; it names the
   duds, the de-carded picks, and the two sprites whose size changed.

---

## 1. Finish retiring LimeZu

The exact remaining inventory is the second table in `HANDOFF.md` under *"What
is generated vs what is still LimeZu"*. Work it top-down; the yard scene is the
biggest surface and the first thing anyone sees.

### The rule that has cost this project time three times

**Two art groups writing the same frame key: the later pass silently wins.**
Remove the old manifest entry, never leave it alongside. There is no error, no
warning, and the symptom is that the game draws the old sprite while the new art
packs perfectly. It has been caught only by taking a screenshot.

The matching trap: **the frame key for an enemy is its TYPE ID**, not the
`sheet` field — `sheet` is read by nothing. Renaming `sheet` is a silent no-op.

### Order, and what each one needs

1. **The yard scene** (`scene` + `sceneStrips`, 25 sprites). Candidates in
   `assets/pixellab/yard/` with the four hero buildings de-carded into
   `yard_picked/`, and the five livestock in `field/scene_*`.
   **`scene` is packed `noTrim` and that is load-bearing** — Design's scene
   coordinates are the top-left of the sprite's FULL box, so a trimmed frame
   lands at the right place and the wrong offset, silently, on every prop.
   **`barn` is now 400×224 (was 480) and `silo` 224×400 (was 448)** — the API
   caps at 400px. Both want a coordinate nudge in `src/ui/scene.ts`, not a
   rescale. **Integer zoom only.**
   The farmers (`scene.farmerIdle`, `scene.farmer2Idle`) need no generation —
   the generated characters in `assets/pixellab/character/` are exactly this.
2. **Field crops** (`singles`, 10). `field/crop_*`. Blighted variants now exist
   for corn, grain, pumpkin, cabbage and tomato that never did before — prefer
   `field2/` over `field/` where both have the same name. These feed straight
   into the ground's existing blight bands: a blighted map should swap the crop
   art, not remove the crop.
3. **The eight weapon sprites** (`weapons`). `field/weapon_*`. These are what
   the player sees ringed around them, so judge them in a run, not on a sheet.
4. **The `duster` boss** (wave 25). `assets/pixellab/duster/` has 22 candidates
   across four facings. **The model ignored the requested facing about half the
   time — pick four that actually face four different ways rather than trusting
   the filename.** It patrols a fixed pattern and does not chase, so four
   facings is the whole rig it needs. The owner has said a boss may be
   *"slightly bigger than would be standard"*.
5. **The stragglers.** `duckFlight` (`field/duck_*`, four facings),
   `pickup.heal` (`field/pickup_heal_*` — candidate 0 is a grey square),
   `gasMaskIcon` (`field/icon_gasmask_*` — candidate 2 is a grey square).
6. **`public/ui/panel.png`.** The LimeZu Modern UI pack is the last thing
   outside the atlas still coming from a purchased pack. **Only
   `field2/ui_panel_1.png` has a real frame**; every other candidate is blank
   parchment. It is a nine-slice, so it wants `noTrim`.
7. **`terrainSource` needs no art at all.** 29 Wang sets are already packed.
   Retiring it is a wiring job and it belongs to the maps work below.

**Verify by looking.** `npm run atlas` then `npm run contact -- <sheet> <clip>`
pulls frames back OUT of the packed atlas, which proves manifest entry, packer,
frame key and direction list together. A sheet can be perfect on disk and still
be drawn wrong because its key is not the one the renderer asks for. Then
`npm run shot` for a real run.

---

## 2. Maps

The owner wants a map to change **all four** of: ground and tileset, node and
enemy mix, arena size and shape, and hazards.

Most of the machinery exists. `tuning.json`'s `terrain` block already treats the
ground set as content and already carries per-blight-band sets. 29 Wang tilesets
are packed. Hazards have 64 pool slots in the sim and gas is already wired.
Session 15 generated `field/hazard_{gas,mud,fire}` and four biome nodes
(`node_saltrock`, `node_scrapheap`, `node_boneheap`, `node_ashstump`) for
exactly this.

**The one hard constraint: the map choice must be the FIRST draw off the seeded
RNG.** Insert it anywhere else and every existing seed stops replaying.
`run.test.ts` has a "replays a whole run identically from its seed" case that
must keep passing. The owner does not care about preserving old seeds, so this
is a freedom — but the test still has to pass, and the ordering still has to be
deliberate rather than accidental.

A map descriptor wants: tileset, ground bake, node mix, enemy weighting, arena
size, hazard flavour. `waves.json` owns arena width/height today, so arena size
moving into the map descriptor is a content-shape change, not just an addition.

---

## 3. Play and tune

**Carry the owner's note verbatim:**

> *"Needs more enemies per wave to balance but I spawned 200+ enemies a few
> times and it all worked great I didnt ge tto test all the models fromthe
> dropdown yet though."*

Three things follow from that one sentence:

- **Performance is not the constraint.** 200+ live enemies ran fine.
  `pressureCeiling: 380` in `waves.json` is a design choice to revisit, not a
  frame-rate limit.
- **Density is the ask**, and it is the top balance item.
- **The class dropdown is untested.** Six classes ship and only some have been
  played. Play all six before tuning anything, or you will tune against one.

**Do this first, before changing a single number:** `threatBudget` is hardcoded
in `src/sim/formulas.ts` as `30 + 22*wave + 1.4*wave*wave`, while `waves.json`
carries `threatBudget.formula` as a string that **nothing reads**. The content
file describes the curve; the code is the truth. Read those three coefficients
from `waves.json` and the rest of the session becomes editing content instead of
editing code — which CLAUDE.md requires anyway. `waveScalar` has the identical
split.

**The known trap, from session 12:** raising the budget OR the spawn rate both
fail `run.test.ts` on the identical budget, because density and player power are
coupled. More enemies that are individually weaker across `enemies.json` is the
shape of the fix, not a bigger number in one place.

Also parked for that session: base move speed 160, crop density and feed value,
damage-% items vs *"merging IS the offensive game"*, late shops thinning to
items only, elites being spawn-time only, and global hitstop.

---

## Verification, every time

```bash
npm run atlas      # and READ THE PRINTED DIMENSIONS, not just the exit code
npm test           # 131 tests, incl. the headless full run and the seed replay
npm run typecheck  # game and tools have separate tsconfigs
npm run shot       # a real run, rendered headlessly, no browser
```

The atlas is 2048 wide because at 1024 the animals forced a `1024×16384` page —
the area was fine, the dimension was past many GPUs' max texture size. If a
change pushes the height back toward 16384, that is the signal.

**The browser pane only composites when the window is focused**;
`requestAnimationFrame` never fires otherwise and screenshots time out. Use
`npm run shot`.

**Stand any new creature next to the player before accepting it.** The first
generated farmhand was better pixel art than LimeZu's and unusable, because its
proportions belonged to a different game.
