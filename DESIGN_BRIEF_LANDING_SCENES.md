# Brief for Claude Design — the landing screens

**Repository:** `Samizdat-Publications/ranch-defense-force` (public, read access)
**Branch with everything current:** `claude/rdf-merge-session-l7ta2j`

You have complete creative control over what these scenes are. This brief gives
you the material, the constraints that are real, and a few starting ideas —
**take them or leave them.** If the ideas here are worse than yours, use yours.

Ask the owner questions. He would rather answer three good ones than receive a
scene built on a guess.

---

## What the game is

A wave-based bullet-heaven set on a farm outside Canton, Ohio. Something buried
under the land has gone wrong, and the farm has turned: the animals, the crops,
the neighbours. TypeScript + Vite + Canvas 2D, no engine.

The tone that has worked so far is **not** monster-movie. It is *this was
somebody's farm last week*. The horror is recognition — you know that barn, you
know that dog. Keep that and the scenes will land.

---

## Read these first, in this order

| file | why |
|---|---|
| `docs/PIXELLAB_INVENTORY.md` | **Start here.** Every asset the project owns — 797 objects, 41 tilesets, 23 characters. Committed, greppable, no API key needed. |
| `DESIGN_BRIEF_HOMESCREEN.md` | The previous brief. §1 is the buildings placement job, §2 is the lightning cut. The session-18 section lists the owner's own farm animals with atlas keys. |
| `src/ui/scene.ts` | The current yard scene. This is the thing you are replacing or extending — read it before designing, the layer model is already good. |
| `docs/ART_STYLE.md` | The house style, and the rules that were learned the hard way. |
| `docs/DESIGN_LANGUAGE.md` | Type, colour, spacing. |
| `art/sprites.json` | The atlas manifest — the authoritative list of frame keys. |
| `docs/SUBTERRANEAN.md` | Where the game is going next. Useful if you want a scene that hints at it. |

**Grep the inventory before assuming anything is missing.** Four sessions
running described the barn, farmhouse and silo as missing art. They had been
generated and paid for the whole time. The prose in this repo is not evidence.

---

## How a scene is actually built here

`src/ui/scene.ts` mounts a **1920x1080 stage of absolutely positioned `<img>`
layers**, scaled as one unit to fit the viewport. Sprites come out of the packed
atlas by frame key:

```ts
spriteEl('scene.barn', 400)                 // key, box size
spriteEl('rosie.idle.downRight', 96)        // any 8-direction sheet, any facing
actor('scene.cowGrazeStrip', x, y, w, h, 9, '5.4s')   // a CSS strip animation
```

Constraints that are real, not preferences:

- **Integer zoom only.** A 32px sprite at 2.2x is a blurry sprite and the whole
  screen stops being pixel art.
- **CSS animation only.** No new runtime dependencies, nothing per-frame in JS.
  The existing scene does drifting clouds, a sun, a porch-light flicker and
  several `steps()` strip animations entirely in CSS.
- **A full-screen white flash is a photosensitivity trigger.** If you use one,
  it needs a luminance ceiling and a `prefers-reduced-motion` path that
  cross-fades instead. This is not negotiable.
- **`assets/` never deploys.** Only the packed `public/atlas.png` ships. Design
  against atlas keys, not against files in `assets/`.

---

## What you have to work with

### The owner's own farm, clean and blighted

Twenty animals generated from his description of his real farm. **Nineteen have
a blighted twin made with `create_object_state`**, which means each twin is
provably the *same animal gone wrong* — same pose, same size, same canvas. A
cross-fade between `x.idle.down.0` and `xBlight.idle.down.0` lands with nothing
to re-register. That is the whole reason the corruption transition is cheap.

Full table with keys is in `DESIGN_BRIEF_HOMESCREEN.md`. In short:

- **Equines:** `fjordPony` (white, blonde mane), `arabian`, `blackMule`,
  `beigeMule`, `rosie` (small brown-and-white donkey)
- **Cats:** `wiz` (black, green eyes), `ouiji` (black, yellow-green eyes),
  `tabbyCat`, `siameseCat`
- **Joy** — `joy`, the tan-and-white bulldog. **She has a name and a role.**
  She is the companion you pick at level-up. Treat her as a character, not as
  one of the set.
- **Ten distinct chickens:** `brahmaHen`, `beardedHen`, `buffHen`, `bantamHen`,
  `silkieHen`, `polishHen`, `leghornHen`, `barredHen`, `farmRooster`, `chick`.
  They differ in size as well as plumage — `chick` packs at 34px, `buffHen` at
  56 — so a row of them at one scale already reads as a real flock.

Every one is eight directions: `<id>.idle.<dir>.0` where `<dir>` is `down`,
`downLeft`, `left`, `upLeft`, `up`, `upRight`, `right`, `downRight`. **Use the
facings.** A yard where every animal faces the camera is a lineup, not a farm.

The `chick` has no blighted twin, deliberately — a rotting baby chick is the
owner's call to make, not ours. Ask him if you want it.

### Buildings and yard furniture

Barn, farmhouse, silo, chicken coop, windmill, stone well, bunkhouse, cattle
chute, hay wagon, crop duster, two scarecrows, rusted tractor. Several exist in
four variants each. **Check the inventory for exact ids and sizes** — the
generated buildings are a different size to the ones the current scene's
coordinates were written for (barn is 400x224 where the pack's was 480), so
every placement wants a nudge rather than a rescale.

### Props, in sixteen variants each

Oil drums, burn barrels, milk cans, feed bins, wheelbarrows, log piles, crates,
troughs, hay bales, bone piles, stumps, carcasses, grave markers, ploughs, hand
pumps, split-rail fence. Sixteen genuinely different takes each — the drums come
in rust, paint, dents and stencils, not sixteen renders of one drum.

This is more range than you probably expect. Use it: a yard where every barrel
is the same barrel is the tell that it was placed by a machine.

### Crops, healthy and rotted

Cabbages, pumpkins, wheat, corn — sixteen variants each, in both states. The
rotted set is a ready-made second half for any before/after.

### Atmosphere pieces

- `cave.branches0-6` — bare dead branches drawn **from directly below**, for
  layering over a scene as canopy
- `cave.stalactite0-5`, `cave.web0-5` — for anything underground
- The game itself now has drifting ground fog and an overhead layer; if you want
  a scene to match the game's look, that is the look.

---

## Some starting ideas

Genuinely just starting points.

**1. The turn.** The yard, clean, mid-afternoon, everything where it should be —
Joy on the porch, the flock scratching around the coop, the ponies at the rail.
Then it turns. Not a jump: a *slow* wrongness, the palette draining first, the
animals swapping to their twins one at a time rather than all at once, the barn
sagging last. The horror is that you watch it happen to animals you were just
enjoying looking at.

**2. Two windows, one farm.** Split the screen and run both versions
simultaneously — clean left, blighted right, the same composition, the same
animals in the same places. Let the eye do the work. No transition needed at
all, which sidesteps the photosensitivity problem entirely.

**3. The last normal evening.** Play it entirely straight. A warm, quiet,
completely un-haunted farm at dusk, no corruption anywhere, and let the *title*
carry the dread. The most unsettling version might be the one with nothing
wrong in it.

**4. A rotation.** Several scenes that cycle per visit — the yard, the field at
night, the burnt orchard, the flooded low ground. Different times of day,
different weather, same farm. Rewards coming back.

**5. Something underground.** `docs/SUBTERRANEAN.md` has where the game is
going: a coal seam, a waste vault full of drums, a bone layer older than the
farm. A title screen that hints at what is under the field would be doing
narrative work no other surface does.

Combine them, ignore them, do something better.

---

## Questions worth asking the owner

Rather than guessing:

- One scene or a rotation? If a rotation, on what — per visit, per session, time
  of day?
- How much motion does he want on a screen he will see hundreds of times?
- Should Joy and the named animals be *findable* in the scene, or featured?
- Does the title screen spoil the corruption, or stay clean until you have
  played once?

---

## What "done" looks like

A scene mounted in `src/ui/scene.ts` (or a sibling module) that:

- builds from atlas keys, integer zoom, CSS animation only
- runs at 60fps on a laptop with no per-frame JS
- has a `prefers-reduced-motion` path
- credits **LimeZu (limezu.itch.io)** on the title screen — the UI pack licence
  requires it and that has not changed

Push to a branch and open a draft PR. The owner will look at it in motion, which
is the only way to judge it.
