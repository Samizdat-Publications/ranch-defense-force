# Next session — make the field frightening

**The characters look right and the world they stand in does not.** That is the
whole brief. The owner, looking at a live run:

> *"I love the player character models and vibe, but the ground and general
> tone/vibe isn't really scary infected zombie like the new character art we are
> doing. Let's focus on the map and the trees and rocks/minerals etc."*

The cast is generated, muted and cohesive. The ground is a clean pasture and the
props are cheerful LimeZu farm scenery — green birch, grey boulders, bright ore.
A ranch where the crop dusters turned everyone should not look like a nice farm
with some sick people on it.

---

## The order to do it in

### 1. Wire the sixteen animals that already exist — biggest win, no generation

Every humanoid is ours; **no animal is**. The feral dogs "barely look infected"
because they are still LimeZu's basenji. Meanwhile sixteen cursed animals are
generated and sitting unused in `assets/pixellab/object/`.

**Four directions was decided** (see `_howToWireIt` in `art/pixellab-queue.json`,
where the mapping, frame counts and sizes are all measured). What remains is a
manifest entry and a renderer bucket — engineering, not judgement.

Use `*_cursed2` for the pony and dog and `*_rotten` for the livestock; the first
attempts did not take. Why is in the "name the colour, not the symptoms" section
of `docs/ART_STYLE.md`.

**While you are there:** the `rooster` ENEMY is drawing a hen — `walkRow: 3` on
`Rooster_Brown_32x32.png` is a hen row. Do not re-derive the LimeZu row; replace
the bird.

### 2. The environment: trees, rocks, ore, crops

This is the actual tone work. Generate against `docs/ART_STYLE.md` — low
top-down, 32px grid, muted daylight — and let `conform` handle the palette.

Worth thinking about before generating: **what does a blighted farm look like at
midday?** Not a dark dungeon. Dead and wrong in sunlight is more unsettling than
dark, and it preserves the day/night contrast the premise rests on:

- trees stripped, split, or heavy with something they should not be carrying
- crops rotted in the row rather than absent
- rocks stained, ore that reads as diseased rather than valuable
- the props that already exist as scenery — troughs, fences, feed sacks — with
  something wrong about them

`create_map_object` and `create_1_direction_object` are the tools; the icon
recipes in ART_STYLE apply.

### 3. Ground and biomes

Six Wang sets exist and are chained off one canonical grass. The horror ones
(`grass_to_ash_v2`) are generated but the arena only ever bakes
`terrain.groundSet` + `terrain.soilSet` from `tuning.json`.

Making a run's ground get *worse* as waves progress — pasture giving way to ash —
is the single strongest tone lever available, and the machinery is already there.
It is a bake change in `renderer.ts`, not new art.

### 4. Only then, more maps

`_mapsAndTilesets` in the queue. **The map choice must be the FIRST draw off the
RNG** or every existing seed stops replaying — though the owner has said they do
not care about existing seeds, so this is a freedom rather than a constraint now.

---

## What NOT to redo

- The ground autotiles from Wang sets. `src/render/wang.ts` owns the key
  convention and both the packer and renderer import it.
- `art/palette.json` is **authored**, not extracted. Do not regenerate it with
  `npm run conform -- --write` without diffing; that overwrites it from the
  LimeZu sheets and undoes the house palette.
- Every character. All six classes and five humanoid enemies are generated, cut
  to a 32x64 cell with feet on **y58**.
- Class plates are portraits derived from each class's own sprite.
- The scene actors animate; the rooster walks a 24s beat.

## The traps that have actually cost time here

Read `HANDOFF.md`'s rules list, but these are the ones this work will hit:

1. **`size` on `create_character` is the CANVAS.** The figure fills ~76% of it.
   64 is the house setting.
2. **Adding to a namespace someone already owns fails silently.** Seven times so
   far. Grep the name first.
3. **Both art groups writing the same frame key: the later pass silently wins.**
   Remove the old entry, do not leave it alongside.
4. **The atlas trims to content bounds** — right for a sprite drawn from a pivot,
   wrong for anything tiled or stepped. Use `noTrim`.
5. **Conform matches a palette, it cannot shift one.**

## Verifying

`npm test` (131), `npm run typecheck`, `npm run atlas` after any art change.
`npm run shot` renders a real run headlessly and needs no browser.

**The Browser pane only composites when the Claude Code window is displayed and
focused.** When it is not, `requestAnimationFrame` never fires — the game loop
does not tick and screenshots time out. Say so before relying on it.

## Rollback

`git reset --hard pre-cast-swap` returns to the last commit before the art swap.
