# Going down — subterranean levels

The owner's direction, recorded the day it was given so it does not get
paraphrased into something smaller later:

> "remember we want cave floors, stalagtites and stalagmites, different
> buildings or items in there. Like one could be a layer of an old coal mine
> where they stored all the industrial waste in barrels etc. Think of things
> like that, what will the edge boundaries of the map look like, cave walls?
> think up things other than just caves but basically various different levels
> of subterranian horror as we go"

The load-bearing phrase is **"other than just caves"**. A cave is a texture. A
*level* is a place with a reason to exist, and the farm above gives every one of
these a reason: somebody dug it, and then something went wrong down there.

---

## What is actually down there — the spine

The owner's direction, and it supersedes the "old mine" framing this document
started with:

> "Like we live above a giant military base with missile silos, and eventually
> aliens etc that would be fun."

**Not now.** He was explicit that this comes at the appropriate time, after the
title screens land. It is written down here so it survives, and because knowing
the ending changes what the earlier layers should look like.

### Why this is the right answer

Claude Design's first pass at an underground scene arrived at a bunker on its
own — poured concrete, hazard striping, a lift gate, and stencilling that read
**SEC 4 · LIFT 12 · CONTRACT 1971 · DO NOT OPEN**. That is a stronger idea than
a mine, and the reason is intent: a mine is a place, a facility is a *decision*.
Somebody built it, catalogued it, sealed it, and wrote a date on it.

And the image the whole thing hangs on is already standing in the yard:

**The grain silo above ground is a missile silo below.**

Same shape, same word, one of them lying since 1971. `ranch.silo` is 224x400 and
domed; the thing under it is the same cylinder going the other way. A player who
has stared at that silo on the title screen for twenty runs gets to find out
what it is. That is a reveal you cannot buy with art — it is free, and it is
sitting there already.

The blight follows from it, and the owner's word for the shape of it is the
right one: **a lab outbreak.**

That is a better answer than "they stored something toxic" for three reasons,
and they are all reasons that show up in play:

- **It explains the animals specifically.** Chemicals poison; they do not turn a
  hen into something that hunts. Something biological and transmissible does,
  and every enemy in this game is an animal that used to be somebody's.
- **It explains the spread upward.** A spill stays where it is spilled. An
  outbreak climbs, which is exactly what the wave structure already models — the
  farm getting worse over twenty-five waves is the thing arriving from below.
- **It gives the drums a job.** Not waste: containment. Sixteen labelled drums
  are frightening in a way sixteen toxic ones are not, because a label is
  inventory, inventory implies a catalogue, and a catalogue implies somebody
  knew exactly what was inside and wrote the number down.

So the layers are a chain of custody read backwards. The player starts at the
symptom, walks down through the industry that hid it, and ends at the room where
somebody was working on it on purpose.

Aliens are the floor of that shaft, and they should stay a rumour for a long
time. The farm animals turning is the symptom; the base is the cause; whatever
the base was holding is the reason. Three questions, answered in that order,
over the depth progression below.

### The asset vocabulary — this is where the monotony break comes from

The owner: *"We could make a bunch of really cool assets around that and it
would break up the monotony."* He is right, and it is worth being precise about
WHY, because "more stuff" is not the reason.

**The farm's visual language is warm, wooden, organic and curved.** Every asset
in the atlas obeys it: barns, bales, troughs, animals, crops. Two hundred of
them still read as one place, and after twenty-five waves that place is
familiar in a way that stops being atmospheric and starts being wallpaper.

**The base is the opposite language on every axis** — cold, metal, geometric,
straight, lit by things that were installed rather than by the sun. That
contrast is the break. A player who drops from the field into the base should
feel the change before reading a single label.

| axis | the farm | the base |
|---|---|---|
| palette | warm browns, greens, straw | grey-green, oxide, hazard yellow, sodium orange |
| shape | curved, irregular, hand-built | rectilinear, repeated, machined |
| light | one sun, soft | fixtures, pools, hard edges, dark between |
| texture | grain, straw, rust on iron | poured concrete, painted steel, stencil |
| sound (later) | open air | enclosed, reverberant, hum |

What to generate when the time comes, roughly in order of how much each one
buys:

- **Blast door**, sealed and part-open. The single most useful asset: it is a
  destination, a gate, and a reveal in one object.
- **Missile silo interior** — the cylinder from inside, gantries, the thing
  still in it. This is the reveal; it should be generated last and generated
  well.
- **Lift cage and shaft** — how you get down, and the only thing tying the
  layers into a sequence rather than a set.
- **Stencilled signage** as a tileable vocabulary: sector numbers, arrows,
  hazard striping, DO NOT OPEN. Cheap, endlessly reusable, and it does most of
  the storytelling.
- **Fluorescent fixtures**, working and dead. Half of them dead is the whole
  mood.
- **Console banks, pipe runs, cable trays, floor grating, ventilation ducts** —
  the connective tissue that makes a corridor read as a facility.
- **Filing and inventory**: crates with contract numbers, clipboards, a
  catalogue. The drums are already generated (sixteen variants) and are the
  centrepiece; what they need is the paperwork that proves somebody KNEW.
- **Concrete Wang tilesets** for the floor, and **wall band art** for the map
  edge — see the boundary section below.

Every one of those is a map-object or a tileset, which are the cheapest things
this project generates. The expensive item is the last one on the list, and it
should not be designed until the layers above it have been played.

### THE STRUCTURE — numbered levels, and the descent is the run

The owner: *"all levels of the military base with prominent level numbers on
each level."* This is the piece the rest of the document was missing, and it
changes the game's shape rather than just its scenery.

**A named layer is a set. A numbered level is a meter.** "The Coal Seam" tells
you where you are; **LEVEL 7** tells you where you are, how far you have come,
and that there is a LEVEL 8. One of those is decoration and the other is a
progress bar the player reads without being taught.

It also makes the aesthetic functional. Stencilled sector numbering, floor
indicator dials, painted bulkhead markings — those stop being set dressing and
become **the interface**. The number on the wall is the number that matters.

#### The descent is the run

The important consequence, and the one worth arguing about before it is built:

Today a run is twenty-five waves on one map, and the difficulty curve is an
invisible number going up. Instead — **every few waves, you take the lift down.**
The level number increments, the palette shifts, the roster changes, and the
same curve is now a place you can see.

That is the whole pitch: *the difficulty curve becomes a depth gauge.* It costs
almost nothing mechanically, because the wave/threat budget already escalates —
this just gives the escalation a floor number and a door.

It also answers a question the map system currently fudges. Five maps chosen at
random are five flavours of the same run. Ten numbered levels visited in order
are a **journey**, and the player's story after a loss is "I got to LEVEL 6",
which is a far better thing to say than "I got to wave 19".

#### How you get to the next level

The owner asked for a door that opens in a wall, or a machine that makes a
portal, and left the choice open. The recommendation is **both, in that order,
and the switch between them is a story beat.**

**Levels 1 to N: the lift.** A door goes sideways; a lift goes DOWN, and down is
the thing the level number measures. It is also already in the fiction — Claude
Design stencilled `LIFT 12` on its own scene without being asked, which is a good
sign that the vocabulary is doing the work.

Concretely, when the floor is cleared:

1. A **blast door** somewhere on the wall unseals — the wheel turns, the hazard
   striping splits. Sixteen blast door variants are generated, so which door and
   where can differ per level.
2. Behind it, the **lift cage**. Walking in ends the floor.
3. The **floor indicator ticks** — and that is where the level number lives
   during the transition, counting down as you descend. One asset, reused every
   level, doing the job a loading screen would otherwise do badly.
4. The doors open on **LEVEL 08** stencilled ten feet tall on the concrete
   opposite.

That sequence is worth building carefully because it is the only moment in a run
where nothing is attacking the player. It is the game's punctuation.

**Below that: the portal machine.** Here is why it should not be the mechanism
on level 2.

The base is a 1971 military facility. Everything about it — poured concrete,
stencils, dial indicators, cage lifts — says *people built this with the
engineering they had.* A portal on level 2 throws that away for a magic door,
and spends the mystery before it has been earned.

But **when the lifts run out**, that is the reveal. The shafts stop. The last
lift goes as deep as human engineering went, and below that there is something
else — a machine nobody in 1971 could have built, humming, already running.
Stepping into it is the moment the game says *you have left the part of this that
people made.* That is worth an enormous amount, and it is free: it costs one
asset, placed once, at the depth where the fiction turns.

So the mechanism is the story. Lift while it is a facility. Portal when it stops
being one.

**A note on the arena for both.** Neither works until the map has edges — a lift
in the middle of an open field is a prop, not an exit. The wall band described
below is what makes an exit legible, and it is the cheap version of the boundary
work. Do that first.

#### What varies with depth

Each level should change at least three of these, so the descent reads as
descent and not as a palette swap:

| axis | shallow (1–3) | mid (4–7) | deep (8+) |
|---|---|---|---|
| who built it | farm, then industry | government | not people |
| light | daylight down a shaft | working fixtures | failing, then none but what you carry |
| palette | earth, timber, rust | concrete grey-green, hazard yellow | wrong colours, bioluminescence |
| enemies | the farm's own animals | staff, security, things in suits | what the tanks held |
| hazards | dust, dark | gas, electrical, contamination | unknown |
| ground fog | light | heavy | heaviest, and it moves |
| arena | open, farm-shaped | corridors and chambers | large and wrong |

**The blight gets stronger as you descend, because you are walking toward the
source.** That is the fiction and the difficulty curve agreeing with each other,
which is the cheapest kind of good design there is.

#### Showing the number

Three places, and all three are cheap:

1. **Diegetically, large, on the wall.** A stencilled `LEVEL 07` painted on
   concrete, big enough to read at a glance, placed where the lift opens. This
   is the one that matters.

   **Render it with a font, do not generate it as art.** Tried and measured:
   asking PixelLab for "the numeral SEVEN in tall military stencil" returned
   four candidates — white-on-white, an illegible run of drips, one passable
   yellow 7, and a blank. It renders text well as INCIDENTAL detail (the blast
   doors came back with legible SECTOR numbering nobody asked for) and badly as
   the subject. Generating ten digits that way is ten chances to get a wrong,
   inconsistent glyph.

   `create_font` is the tool: 25 generations / $0.125 for a full glyph atlas AND
   a .ttf — every digit, letter and punctuation mark, one style, one cost. That
   covers level numbers, sector codes, contract dates and every sign the base
   will ever need, and they will all match because they are one typeface.
2. **On the lift indicator** — a dial or a lit number that ticks as you descend.
   One asset, reused every level.
3. **In the HUD**, quietly, next to the wave counter.

The first one does the work. A player who steps out of a lift and sees **LEVEL
09** stencilled ten feet tall on the wall opposite knows exactly how much
trouble they are in, and nobody had to write a tutorial.

#### What this means for the map system

`maps.json` already carries everything a level needs — terrain, node mix, enemy
bias, hazards, fog, overhead, breakable skins. **A level is a map.** The work is
not new content plumbing, it is:

- an ordered sequence rather than a weighted random pick
- a descent trigger (clear the floor, the lift opens)
- the level number as a first-class field, shown in-world and in the HUD
- and the arena boundary, because a corridor needs walls — see below

That last one is the only real engine work, and it is already specified.

### What that changes about the layers

The five layers keep their shapes but gain a direction of travel: **the deeper
you go the less of it was made by farmers.** Root cellar is a farm building.
Coal seam is industry. The vault is government. Below that, nothing human built.

That progression is the level design. It is also the art budget in order —
concrete, stencils and hazard striping are cheap and reusable; whatever is at
the bottom is not, and it should not be designed until the layers above it have
been played.

## The layers

Ordered by depth, which is also the order they should unlock, because the
sequence is an answer arriving slowly: the blight has a cause and it is down
here.

### 1. The Root Cellar — under the barn

The shallowest and the least alien, and that is the point: it is a farm
building that happens to be underground. Dirt floor, whitewashed stone, shelves
of canning jars, a coal chute, a hand pump. Human scale, low ceiling.

It exists to make the transition legible. Drop the player straight into a
cathedral cavern and the farm game becomes a different game; drop them into a
cellar and they are still on the farm, just under it.

**Art it needs that we already have:** the hand pump (16 variants claimed), the
mason jar, the crate, the split-rail. Almost none of this is new.

### 2. The Coal Seam — the old mine

The owner's own example. Timber props holding the roof, rail track and tipped
carts, coal dust that blackens everything, a ventilation shaft with grey
daylight a very long way up.

**Its hook is the props.** A timber roof support is scenery you must not break
— and the game now has a mechanic that says containers pay out and fixtures do
not. A mine is where that rule gets tested, because the fixtures are load
bearing in the fiction too.

### 3. The Waste Vault — the drums

The one the owner named, and the one that should be the *reveal*. Poured
concrete, stencilled hazard numbering, and rank on rank of steel drums, some
intact, some split and weeping.

We already hold **sixteen distinct oil drums and sixteen burn barrels**, in
rust, in paint, dented, stencilled. That is not a texture, that is a room.

This is where the blight comes from. Everything above — the cursed animals, the
rot in the crops, the walkers who used to be neighbours — traces back to a
company that paid the farm to bury something. The player has been fighting a
symptom for twenty-five waves.

### 4. The Flooded Level — the water table

The mine went below the water table and the pumps stopped. Standing black
water, drowned machinery, drips that never stop. Movement cost in the shallows,
a real hazard in the deep.

Mechanically this is the one that changes how the game is *played* rather than
how it looks, and that is worth one level.

### 5. The Bone Layer — older than the farm

A natural cavern the mine broke into. Nobody dug this. Stalactites and
stalagmites, a floor of pale bone that is not any animal anyone can name, no
tools, no timber, no rails.

The horror here is the absence of human trace. Every other layer is somebody's
mistake. This one was already here.

---

## What this actually costs in code

Art is the easy half. Four things below are engine work, and they are listed
smallest-first so a level can ship before all four exist.

### Map edge boundaries — the owner's question

**Today the arena is a rectangle and the edge is a clamp.** `world.ts` pins
`e.x` and `e.y` into `[0, arenaW/H]` and that is the entire boundary; there is
nothing to see and nothing to collide with. A cave that just stops at an
invisible line will read as a bug.

Two ways to answer it, and they are very far apart in cost:

**(a) A wall band.** Keep the rectangle. Shrink the clamp inward by the band
width and draw wall art in the margin, dark at the inner edge. The playable
region is still a rectangle, so steering, spawning, the spatial grid and every
existing test are untouched. This gets most of the look for close to nothing,
and it is what should ship first.

**(b) A real walkable mask.** A per-tile passable grid, with steering, spawn
placement and knockback all respecting it. This is what gets tunnels, chambers
and dead ends — actual cave *shape* rather than a rectangular room with rocky
edges. It touches the enemy steering, the spawner, and the arena clamp, which
are three of the most load-bearing things in the sim.

Do (a) now. Do (b) only when a level design actually needs a corridor, and
budget it as its own milestone, not as part of an art pass.

### An overhead layer — BUILT

**Stalactites hang from a ceiling, and the renderer had no ceiling.** Every
sprite y-sorts against the ground, so there was no pass that drew *over* the
player regardless of position. There is now: `Renderer.drawOverhead`, mirrored
in `tools/draw-world.ts` so screenshots show it.

Per map, in `maps.json`, absent on a map with open sky. Placement is
render-side and seeded off its own stream, the same rule as the scenery band
and the decals — nothing decorative may move a tile, a decal or a spawn.

**It fades where the player is**, to `minAlpha` within `fadeRadius`, on a
smoothstep. That is not polish, it is the difference between atmosphere and a
bug: this is a bullet-heaven, the player has to see what is about to hit them,
and *"the player should move"* is never the answer when a hundred enemies decide
where they can stand. The smoothstep matters too — a linear ramp reads as a
circle sliding around under the art, which draws the eye to exactly the thing
that should go unnoticed.

Enemies are deliberately ignored by the fade. A stalactite that thinned for
every enemy under it would flicker constantly at a late wave, and the crowd is
the one thing on screen already impossible to lose.

It buys more than stalactites: hanging roots, a broken ladder, a shaft of light
from a grate, the underside of floorboards. Sixteen stalactite variants are
packed under `cave.stalactite*`.

**On webs.** Sixteen are packed under `cave.web*`, and they are *not* overhead
art — they are corner-anchored, which is what a real web is, and scattered in
the air they read as floating rags. A web belongs ON something: over a barrel,
in the angle of a fence. The breakable variant system already expresses that,
so a cave map points `breakables.sprites` at webbed variants of the props
rather than the renderer growing a second decal path for it.

### Sight radius — still open

A cave wants the dark to matter. A radial mask centred on the player, drawn
over the ground and under the HUD, is a handful of lines.

**It is also a balance change, not a decoration** — a bullet-heaven where you
cannot see the wave arriving is a different game. That makes it a joint call
with the owner and a thing to measure, not a thing to tune alone.

### Ground fog — already done

Built this session, per-map, in `maps.json`. A cave is exactly what it is for,
at a much heavier `alpha` than any surface map runs. `theBurn` is at 0.26; a
flooded level would sit far above that.

---

## What we can already build with

Not a wishlist — this is claimed, paid-for art sitting in the account today:

| have | layers it serves |
|---|---|
| 16 oil drums, 16 burn barrels | Waste Vault, Coal Seam |
| 16 crates, 16 bone piles, 16 carcasses | all of them |
| 16 hand pumps, 16 ploughs, mason jars | Root Cellar |
| 16 log piles, 16 split-rail sections | mine timbering, reskinned |
| 39 packed Wang ground sets | cave floor is a tileset away |
| ground fog, per map | every layer |
| the blighted farm cast | the things that got out |

The gap is honest and short: **cave floor tilesets, wall art for the band,
stalactites for the overhead layer, rail track and carts, timber props.**
Everything else is bought.

---

## The rule that should govern the art

The surface maps are boring on purpose. `ART_STYLE` says the ground must stay
quiet because two hundred enemies and their bullets are read against it, and
the session-17 attempt at a "highly detailed" floor came back as polka dots and
red brickwork for exactly that reason.

**Underground does not change this rule, it raises the stakes on it.** A cave
floor is darker, so contrast against it is *lower*, so a busy floor eats
readability twice as fast. The atmosphere in these levels has to come from the
fog, the overhead layer, the sight radius and the props — the things that sit
above the floor — and the floor itself has to stay quiet.

Ask for less. Get the mood from the layers.

---

## Session 18 status

| piece | state |
|---|---|
| overhead draw layer, with proximity fade | **built**, both renderers, tested |
| ground fog, per map | **built**, both renderers, tested |
| stalactites (16 variants) | packed, `cave.stalactite*` |
| spider webs (16 variants) | packed, `cave.web*` — for props, not overhead |
| per-map breakable skins | **built** — how a cave reskins the drums |
| cave floor tilesets | **41 tilesets already in the account** — inventory first |
| wall band for the map edge | not started, and it is the cheap one |
| walkable mask | not started, deliberately — own milestone |
| sight radius | not started — it is a balance change, so it is joint |

**Before generating any cave art, run `grep -i cave docs/PIXELLAB_INVENTORY.md`.**
The account holds 41 tilesets and 797 objects. The odds that the floor you are
about to generate already exists are not small — that is how the barn, the
farmhouse and the silo sat unclaimed for four sessions.

---

## First base assets — generated and packed

Sixteen `base.*` keys, and the visual language is established:

| what | keys | notes |
|---|---|---|
| blast doors | `base.blastDoor0-5` | **Legible stencilled SECTOR numbering** — 01, 03, 07, 11, 12. One is chained shut. Hazard striping on several. |
| lift cage gates | `base.lift0-4` | Concertina gates, lattice grilles, **floor indicator dials**, call button plates. Institutional green. |
| containment tanks | `base.tank0-4` | Glass cylinders, green fluid, biohazard trefoils, cable runs from the base. |

Plus **RDF Bunker Stencil** — a full pixel font (`public/fonts/rdf-bunker-stencil.ttf`,
atlas in `assets/pixellab/font/`), `suspect_glyphs: 0`. Every digit, letter and
punctuation mark for $0.125, which is where level numbers and every sign come
from. See the note above on why numbers must not be generated as art.

Sixteen candidates were claimed for each pack, so the six/five listed above are
a curated subset and there are ten more of each available without paying again.

### They are drawn front-on, and that is correct

These mount on WALLS, and a wall in a top-down game is seen from the front.
`base.*` is elevation art for the boundary; the FLOOR pieces — grating, pipe
runs, cable trays, concrete tilesets — want top-down and are not generated yet.
Do not mix the two up: a floor grating drawn in elevation reads as a fence.

### The preview exposed a real gap: scenery is hardcoded to the farm

`theVault` is a weight-0 map added so `npm run shot` can render the concrete
floor before the level system exists. `pickMapId` never selects it, so it costs
no seed and no test — and the maps tests now assert that a weight-0 map is
NEVER drawn, which is what makes adding one safe.

Rendering it showed the floor working: plain, low contrast, not competing with
the sprites, which is the "ask for less" lesson applied correctly.

It also showed **pumpkins, a cabbage, a tree, ore nodes and farm rocks sitting
on a bunker floor.** Two separate causes, both of which the level system has to
fix:

1. **`Renderer.buildScenery` has a hardcoded list of `prop.*` farm fixtures.**
   Ground fog, the overhead layer and the breakable skins are all per-map
   already; this one is not, and it needs the same treatment — a map should
   name its own peripheral scenery, or name none.
2. **`paintDecals` is likewise hardcoded** to tyre ruts, scorch, mud and ash.
   A base floor wants oil stains, scuff marks and drain grates instead.

Neither is hard — both mirror what `maps.json` already does for four other
layers — but a level built before they are fixed will have a farm growing out of
its concrete. **Do these with the wall band**, as one pass over the renderer's
remaining hardcoded farm assumptions.

### What is still missing, in order

1. **A concrete Wang tileset** for the floor. This is the biggest single gap —
   there is no non-farm ground in the atlas at all, and all seven existing
   tilesets are dirt and pasture.
2. **Wall band art**, so the arena has edges. Nothing else on this list works
   without it: a lift in the middle of an open field is a prop, not an exit.
3. **Floor pieces**: grating, pipe runs, cable trays, drains.
4. **Fluorescent fixtures**, working and dead. Half of them dead is the mood.
5. **Paperwork** — crates with contract numbers, clipboards, a catalogue. The
   drums are already generated and are the centrepiece; the paperwork is what
   proves somebody KNEW.
6. **The silo interior.** Last, and only after the layers above have been played.
