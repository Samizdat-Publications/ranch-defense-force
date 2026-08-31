# The fourth scene is a LAB, not a barn

**Owner's call, and it is the right one:** scrap the barn scene and replace it
with an underground laboratory layer. The reasoning is asset reality — the barn
was always going to be CSS rectangles and hand-built stall geometry, while the
sci-fi cast is already fully rigged and packed. Build with what exists.

---

## What already exists for this scene

### The cast — 8 directions, walk cycles in 4

| sheet | who | clips |
|---|---|---|
| `baseTech` | lab technician — stained white coat, cracked goggles, clipboard | `idle`, `walk` (8f) |
| `baseGuard` | facility security — olive uniform, webbing belt, peaked cap | `idle`, `walk` (8f) |
| `baseHazmat` | containment crew — orange suit, round visor, air hose | `idle`, `walk` (8f) |
| `baseOperator` | response operator — black tactical kit, helmet | `idle`, `walk` (8f) |
| `baseBreacher` | riot breacher — heavy armour and a ballistic shield | rotations |

All five are enemies in `enemies.json` at `weight: 0`, so they spawn only where
a map asks. They are the scene's population.

Also usable: every blighted farm animal (`*Blight`), and `rosie`/`arabian`/the
mules, which is the point — **an animal from the field, down here, in a tank.**

### The room

| key | what |
|---|---|
| `base.wallPipes` `wallHazard` `wallVent` `wallStencil` `wallLamp` `wallPlain` | wall panels, 32x48, bolted on |
| `base.striplightLit` `striplightDead` | ceiling strips; the dead one hangs at an angle off its cable |
| `base.ceilingPipes` `ceilingDuct` | 96x32 service runs |
| `base.blastDoor0-5` | sealed doors with legible stencilled SECTOR numbering |
| `base.lift0-4` | cage lift gates with floor-indicator dials |
| `vault.floorGrate` | steel grate set in concrete |
| `concrete_to_wall` `concrete_to_steelwall` `concrete_to_grating` | Wang tilesets |

### The fittings

`base.tank0-4` (containment tanks, green glow) · `base.serverRack` ·
`base.labBench` · `base.lockers` · `base.medChair` · `base.filingSpill` ·
`base.cratePallet` · `base.rubble` · `base.cableSpool` · `base.warningSign` ·
`base.palletJack` · `base.latrine` · `vault.drumRank` · `vault.drumScatter` ·
`vault.drumStack` · `vault.drumWeeping`

**Use all three drum groupings.** Two copies of one rank read as two neat lines
and lose the variety the scene had when drums were placed individually.

---

## The four rules, unchanged

They are in `docs/SCENE_ASSETS.md` and they apply here:

1. **`sceneSprite` / `groundActor`, never `spriteEl` / `clipActor`.** The card
   helpers snap to whole-pixel zoom and silently discard the size argument.
2. **Everything gets a contact shadow and a foot line.** `groundActor` does both
   and derives `z-index` from `footY`.
3. **`draw at` comes from `art/scene-scale.json`**, at *a grown person is 64px
   tall*. Both dimensions, measured — never inferred from the canvas.
4. **Strips are in `art/strips/`** with `index.json`. 699 of them.

---

## What is still wrong in the three live scenes

From the owner, watching the current build:

- **Buildings float on the horizon.** The ground plane has to start ABOVE their
  feet. Right now the hard sky/ground edge runs through the base of every
  building and they read as stickers on a backdrop. This is the single biggest
  remaining defect and it is in all three scenes.
- **Joy keeps landing in the black foreground silhouette** where she cannot be
  seen. Twice now.
- **Nothing moves but one pony**, with 699 strips available.
- The pens are still shallower front-to-back than one pony is tall.

---

## Pens — the depth answer

Design measured it and is right: **0.113 is too flat.** Interior depths on
screen were 52 / 65 / 72 / 36px against ponies 96-100px tall, so a pen is
shallower than one pony is tall and reads as a pair of parallel rails.

**Target 0.20-0.22.** A reshoot is generating on a 400x200 canvas — the
canvas-constraint trick is what works, not words about camera angle. The old
0.457 lozenge pens stay packed until it lands.

---

## The LimeZu credit — audited, and my count was wrong

I said "64 LimeZu `scene.*` keys" from a `grep -c`. Claude Design audited it
properly: **44 keys** (25 `scene` + 19 `sceneStrips`), 36 replaceable, **8 still
blocking**. Six of the eight are the pen's cow, calf and sheep.

Two corrections worth carrying:

- **Never sweep by prefix.** `scene.oak` and `scene.rooster` are already
  GENERATED art sitting under the `scene.` prefix. Counting the prefix counts
  them as LimeZu and they are not.
- **Retiring beats regenerating** for the six pen animals — the owner's real
  farm has no cow, calf or sheep, so they are set dressing nobody asked for.
  Cutting them from the scene clears six of the eight blockers for free.

## The LimeZu credit

It is a **licence requirement**, not a preference: `CLAUDE.md` records that the
UI pack's licence requires attribution, and the owner obtained permission to
publish this repo on that basis.

But `src/ui/scene.ts` still references **64 LimeZu `scene.*` keys**, and the
generated `ranch.*` / `pen.*` / `base.*` set now covers nearly all of it. If the
scenes migrate off those keys entirely, the attribution can move to a credits
screen instead of the corner of every scene. That is an audit worth doing and it
has not been done yet — do not remove the credit before it is.
