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

### An overhead layer — this is what sells "underground"

**Stalactites hang from a ceiling, and the renderer has no ceiling.** Every
sprite y-sorts against the ground; there is no pass that draws *over* the
player regardless of position. That pass is small — one more loop after
`sortAndDraw` — and it is the single cheapest thing on this list that makes a
space read as enclosed rather than as a dark field.

It buys more than stalactites: hanging roots, a broken ladder, a shaft of light
from a grate, the underside of floorboards.

### Sight radius

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
