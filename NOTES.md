# NOTES

Handoff back to the next design pass, per CLAUDE.md. Latest session first.

---

# Session 16 — the descent, and the account was never dead

Three asks: more floor types, a way down into caves that get worse as you go,
and a record of the project's screenshots. All three landed. The first one
started by correcting the premise the last two sessions were built on.

## PixelLab was never cancelled, and that cost two sessions

Sessions 14 and 15 opened with "PixelLab is cancelled — balance 0, key dead,
nothing can be regenerated", took it on trust, and wrote it into **four
documents**. It is wrong.

```
credits: $0.00      generations_remaining: 0
generations_used: 4710 / 4710
subscription: ACTIVE (Tier 2: Pixel Artisan)
generations_reset: 2026-09-14
```

The subscription is live. What ran out is one cycle's allowance, and it refills.
Generating was never a wall, it was a sixteen-day wait — and two sessions of
planning went into a shortage that did not exist.

**Worse: downloading has always been free, and there was a lot to download.**
Twenty-nine tilesets exist on the account and fifteen were on disk. Fourteen had
never been fetched. Nine of those are in the plain family — the one that works —
each a distinct grey or sickly tone, and they arrived for nothing.

Session 13 hit the identical thing: four cursed animals "that had never been
downloaded", finished and free, while the handoff said the art did not exist.
**Twice is a pattern. Check the account before believing a document about it.**
`npm run tsaudit` is that check now.

## The answer to "did we not generate other floors"

Yes. Nine of them, sitting unfetched. And then most of them failed.

Tiled 5x5 and then shot at play zoom under real cave darkness, of the nine:
`grass_to_greybrown` tiles into rows of identical marks, `grass_to_darkgrey`
into a grid of dark blue glyphs, `grass_to_greystone` into horizontal lines. All
three were wired into the caves before they were tested that way.

**Darkness helps far less than it seems like it should.** The argument for
shipping a patterned floor underground was that you would not see it — the Root
Cellar at 0.42 darkness reads its floor pattern perfectly clearly. A repeat at
40% brightness is still a repeat.

What holds, and what the caves ship on: **bare earth** and **muddy water**, both
already proven at any scale, and **`grass_to_greenrot`**, verified the same way.

## The descent

A way down opens in the field at the wave-10 boundary, on the same boundaries
the shop uses. Walk to it, press **E**, and you go under. There is no way back.

| | | |
|---|---|---|
| The Root Cellar | 1800x1200, dark 0.42 | packed earth under the house |
| The Washout | 1600x1100, dark 0.55 | where it drained to; standing mud |
| The Seam | 1400x1000, dark 0.68 | the blight coming UP out of the rock |

**The fiction is the point.** The dusters were not spraying the crops, they were
spraying to hold something down, and the blight spreads from below. So the way
down opens once the field has already started going grey — a hole in a clean
field is a hole, and a hole in a field that is already rotting is where the rot
is coming from. `descentFromWave` is 10 for that reason and not as a difficulty
gate.

**The difficulty is emergent and nothing in `enemies.json` changed.** Enemies
spawn on ARENA EDGES, and the caves run 1800x1200 down to 1400x1000 against a
surface 2400x1600 to 3200x2100. A small arena is a close one: the crowd is on
you immediately. That inverts the property session 15 measured — bigger maps are
slower — and it means the descent gets harder for free.

The reward is `acres.perDepth`, 0.25 a level, so a run banked from The Seam pays
1.75x. That is the only reward and deliberately so.

### It has to be a decision, and the acceptance suite is what said so

Walking into the hole used to be enough. The bots — random walkers — kept
wandering across a 34px circle, taking a one-way trip and dying two levels down.
The clear rate fell from five seeds in six to two.

That was the test reporting a **design** fault, not a broken build. A one-way
trip you can take by accident is a trap. It takes `[E]` now, `World.step`'s
interact argument defaults to false so every existing caller means "did not
choose to", and the prompt over the hole says so.

### And it moved the RNG, which is the third time

`openDescent` drew its position from `world.rng`. That takes up to twelve
numbers off the stream at the wave-10 boundary, so **every spawn, drop and offer
after wave 10 moved** — two of six seeds cleared instead of five, with nothing
about the descent itself wrong.

Derived from the seed now, like `mapForSeed`, the terrain bake and the blight.
Third time this project has paid for that rule; there is a test for it now.

## What descending actually does

`World.map`, `arenaW`, `arenaH` and `fieldDensity` are no longer readonly, and
`descend()` swaps all four together. Everything sized from them is rebuilt in
the same call, and that list is the whole risk:

- **the spatial grid**, which is sized from the arena and cannot outlive one;
- **the camera bounds**, or the view walks off the edge of a smaller world;
- **the decal canvas**, which silently stops taking stains past its old size;
- **the terrain bake**, forced full on a map change rather than incremental;
- **every pool**, cleared — an enemy at x=3100 in a 1400-wide cave is
  unreachable and leaks a slot per descent.

Pickups are magnetised before the clear, so descending does not cost the player
XP already on the ground.

## Two bugs in the tools, one of which ate the main tree

**`git worktree remove --force` followed a junction and deleted the main tree's
`node_modules/.bin`.** The history reconstruction linked the main tree's
`node_modules` into a throwaway worktree to save an install; removing the
worktree walked through the link and took out every shim, so `npm run typecheck`
stopped working mid-session. A junction is not a boundary, and a cleanup that
can reach outside the thing it is cleaning is not a cleanup. Each worktree
installs its own now.

**The headless painter never clamped its camera.** It centred on the player
unconditionally, so standing near an edge put the void on screen. Invisible on a
3200x2100 field, and the bottom third of every cave shot on a 1400x1000 one. The
real camera has always clamped; this now does the same two lines.

## The dark is in both renderers, and it had to be

`Renderer.drawDark` is a canvas radial gradient. `tools/draw-world.ts` has no
canvas, so it computes the same falloff per pixel — the same lit radius, the
same three stops, the same alphas, and both files say the other one exists.

Without it a headless shot of a cave shows a floor at a brightness nobody will
ever see it at, which would make every image in the new screenshot archive a lie
about the cave levels. It is also what let the floors be judged at all: the
browser pane could not composite this session, so the only way to look at a cave
was to make the offline painter honest.

## The screenshot archive

Nothing was ever kept. `npm run shot` writes to a gitignored path that the next
shot overwrites, so sixteen sessions left no visual record — the only images in
git are card mockups.

`docs/progress/` is committed now, written by **`npm run snap`**, indexed by a
generated `LOG.md` that is rebuilt from the directory so it cannot drift.

**And the history was reconstructed.** `npm run snaphist` checks a commit out
into a throwaway worktree, builds that commit's atlas from that commit's assets,
and runs that commit's own screenshot tool. It is not a photograph and the log
says so — but it is that commit's code and art, and the earliest one is real:
2026-08-11, a farmer and one zombie on flat green.

Thirty images, eleven captures, 2026-08-11 to today, 4.1MB.

## Open

- **The caves have ONE floor each**, because every tileset on the account pairs
  GRASS with something and a second cave layer would draw grass fringes
  underground. The fix is a chained cave family, and each cave records the base
  tile id to chain off. **Order it on 2026-09-14.**
- **The dark is a flat radius.** No light sources, no torches, nothing that
  varies. It wants a flicker at least.
- **Nothing about the caves has been PLAYED**, same as everything else.
- The brawling Kid's +5 clears on the bigger surface maps, still untouched.

---

# Session 15 — five maps, and the arena stops being a constant

The brief: *"bigger maps that are either pre-made or procedurally generated,
with a variety of floor tile types — right now it's all one map."*

There are five now. They are **pre-made descriptors with procedural fill**: a
map names its size and an ordered list of ground LAYERS, each a Wang set plus a
shape, and the shapes are generated from the seed. Authored where authoring
matters — size, which grounds, how much of each — and generated where hand
placement would be busywork.

| map | size | what it is |
|---|---|---|
| The Home Quarter | 2400x1600 | the original arena, layer for layer. The control. |
| The Long Acre | 3200x1600 | wide, drainage ditch down the long axis |
| Creek Bottom | 2800x2000 | a wide mud channel crossing the short axis, no plough |
| The Back Forty | 3200x2100 | the big one; broad tilled beds you move through |
| The Dry Lot | 2800x1800 | bare earth with pasture surviving in islands |

The seed picks one, evenly (1173–1246 each over 6000 seeds).

## The RNG trap the handoff warned about twice was avoidable

`docs/NEXT_SESSION.md` had said for two sessions: *"the map choice has to be the
FIRST draw off the RNG, or every existing seed stops replaying."* True — **and
only if you draw it.**

`mapForSeed` DERIVES a stream from the seed instead: `imul(seed ^ salt, k)`. It
consumes nothing from `world.rng`, so wave order, drops and offers are
byte-identical to what a seed produced before maps existed. The terrain bake and
the blight already used exactly this trick; nobody had noticed it answered the
map question too.

The arena SIZE still changes what a seed plays out as, because spawns are on
arena edges and nodes scatter across the arena. That is a real difference and
not an ordering bug: the same seed replays itself exactly, which is what the
acceptance test asserts, and it still passes.

## Bigger arenas broke three acceptance tests, and the cause was not balance

First run with maps in: `completes all 25 waves` down to 2 of 6 seeds, `each
class does better at its own game` INVERTED for The Hand, `rewards build
quality` inverted.

**The cause was that `nodes.json` quotes counts, not density.** Scatter 74 nodes
across a 1.75x arena and you have 57% of the crops per screen. The run economy
is downstream of harvest-per-minute, so the player levels slower and is
under-built by wave 20 — and The Hand, the one class whose identity is standing
still, is punished hardest, because standing still on a sparse field harvests
nothing.

`nodes.field.referenceArea` is 2400x1600 now and every count is multiplied by
`arenaArea / referenceArea`. Home Quarter scales by exactly 1.0, so the shipped
numbers still mean what they meant. That fixed two of the three failures
outright.

**The props pool had to grow with it** — 120 to 240 — because the biggest map
wants 200 standing nodes and `Pool.acquire()` returns null rather than erroring.
A pool that is too small does not fail, it quietly shortens the field. There is
a test for that now.

## What maps actually do to the balance, measured

`npm run balance -- 24 both [mapId]` takes a map now, so the arena can be held
still while something else varies. 24 seeds per configuration:

| pilot | old single arena | map rotation |
|---|---|---|
| hand / kite | 10/24 | 10/24 |
| hand / brawler | 16/24 | 16/24 |
| kid / kite | 16/24 | 17/24 |
| **kid / brawler** | **11/24** | **16/24** |

Three of four are unchanged. **The brawling Kid gains five clears** — a brawler
on a bigger field has room to break off when the crowd builds, and The Kid is
fast enough to use it.

That one real effect is also what broke the third test. `treats both classes
comparably` compares two classes over SIX seeds, and with the map varying per
seed it was comparing two sets of arenas at the same time — six seeds cannot
resolve a class difference through that much variance.

**So every test in `run.test.ts` now pins the arena to `home_quarter`.** That is
not the tests being loosened, it is a confound being removed: those tests ask
about classes and builds, and Home Quarter IS the old arena layer for layer, so
pinning makes them ask exactly what they asked before. All six pass unchanged.

Pinning removed the maps' only coverage, so `tests/maps.test.ts` is the coverage
that is actually about maps — six tests, and each one is a bug that already
happened or nearly did:

- every layer CHAINS onto its base (checked against the tilesets' own
  `base_tile_ids`);
- editing one layer cannot move another;
- a ribbon stays in its lane;
- node density is constant across map sizes, and the pool can hold the biggest;
- a seed always gets the same map, and seeds spread evenly;
- every map is playable at all.

## The ribbon was a diagonal with a wobble on it

The first "vertical" creek crossed a 2800x2000 field corner to corner at about
forty degrees, and a "horizontal" farm track arced from the bottom-left of the
map to the top and back down.

**A clamped accumulating drift saturates.** Once the drift hits its limit it
stays there, so the band leaves at a constant angle. The walk needs three terms
and all three matter: noise, DAMPING so a run of same-sign noise decays instead
of compounding, and a PULL back toward the line it started on. That last one is
what keeps a track in its lane over a hundred steps.

## `--tile 5` — the only honest test of a ground tile, and it rejected two

`npm run look -- <frame> --tile 5` repeats a tile five by five. A 32px tile
judged ALONE looks like texture; the same tile across a field turns its mottling
into a visible grid, and that is what the eye reads at play zoom.

| ground | verdict |
|---|---|
| mown grass, bare earth | pass at any scale — nearly featureless |
| muddy water | pass at any scale — mottled, soft, no motif |
| tilled soil | pass in bands and beds. It repeats hard, but what it repeats is FURROWS |
| `grass_to_gravel_v2` | **FAIL** — a grid of identical grey glyphs that read as printed characters |
| `grass_to_ash_v2` | **FAIL** — rows of little ledges with drop shadows (as session 13 said) |

The gravel was in three maps before this test was written. It looked like
plausible gravel as one tile, and worse in a narrow track than in a patch.

**The pack-green family was tested at play zoom and rejected too** — a whole map
built on it and shot through the real renderer: dense tuft pattern in the grass,
an obvious brick grid in the soil, a wavy repeat in the water, and a hard cream
rim line at every terrain edge. Session 12 reached the same conclusion from the
tilesheet; this checked it the fair way and agrees.

So the floors are grass, bare earth, tilled soil, mud and blight — five, where
the old arena had four. **The rest of the variety is layout and size**, and
after the tiled test that is the honest place for it to come from.

## Coverage is tuned to measured numbers

`npm run maps` prints per-layer coverage as a percentage of vertices. Guessing
and looking got the first Stony Ground to 57% gravel in one merged grey mass —
worse than the flat map it was replacing. The shipped arena is the reference:
11.3% worn earth, 10.5% tilled edges. Same lesson as the blight's coverage table
in session 13, and it needed relearning.

## The wave-change hitch is now smaller than it was BEFORE maps

A re-bake repaints the whole arena, and that scales with area. Measured in the
browser on 3200x2100: **56.7ms on the wave-change frame**, against 0.12ms for a
warm one. Nearly four dropped frames, and roughly double what the old arena cost.

The fix rests on a property the blight already guarantees and a test already
asserts: **it is MONOTONIC.** Wave N's field is wave N-1's plus more, so the
cells that gained no ash are already correct on the canvas. `repaintBlight`
touches only the changed cells, in the same layer order as the full bake, and
bails to a full bake if the field is ever not a superset.

| | full bake | incremental |
|---|---|---|
| median wave change, all five maps | — | **2–4ms** |
| worst wave change | 56.7ms | **7.7–17.1ms** |
| picture at wave 25 | — | **identical on all five maps** |

The identity was checked, not assumed: walking wave by wave and jumping straight
to 25 produce the same ash coverage to the decimal on every map.

## New and changed tools

- **`npm run maps -- [wave] [outDir] [seed] [scale]`** — bakes every map's whole
  ground and prints per-layer coverage. `npm run shot` draws a 520x330 camera
  window, which is the wrong instrument for a 3200px composition.
- **`npm run look -- ... --tile N`** — see above. It has now decided three
  grounds and a whole tileset family.
- **`npm run balance -- 24 both [mapId]`** — hold the arena still.
- **`new World(seed, class, mods, tier, mapId?)`** — for TOOLS ONLY. The game
  never passes it.
- **The dev overlay names the map**, its size and its node density. With five
  arenas, "which map is this" is a real question.

## Open, and deliberately not decided here

- **MUD DOES NOT BLOCK OR SLOW YOU.** There is no terrain collision and adding
  it is a gameplay change, so a wet channel is a floor you walk over. It is the
  one thing on these maps that looks like it should stop you. A question for the
  play session.
- **The brawling Kid's +5 clears.** Real, measured, and left alone — it is a
  balance change and the owner asked not to be tuned around.
- **Ten of the fifteen tilesets are unused** and still packed into the atlas,
  which is 160 frames of nothing. Harmless, and filtering the packer to used
  sets is a small win nobody needs yet.
- **Enemies still spawn on ARENA EDGES**, so a bigger map is a longer walk in.
  The density fix covers the economy; it does not change that pressure arrives
  later on a big map. If the play session finds the big maps slow, spawning on a
  ring around the player is the lever — and it is a tuning decision.

---

# Session 14 — everything alive in the yard is ours

The brief: finish retiring LimeZu by picking and wiring art that is already
generated, then more maps, then play together. Yard scene first.

**PixelLab is cancelled — balance zero, key dead.** That is the fact the whole
session runs on. Nothing can be generated, so "retire LimeZu" means: find what
is on disk, judge it, and mount it. Where nothing is on disk, LimeZu stays, and
saying so is part of the job.

## Correcting the brief, because three of its pointers do not exist

The session opened with "read NOTES.md session 15, then
`assets/pixellab/SESSION15.md` — it names the duds and the de-carded picks."

- **There is no session 15 or 14 in NOTES.md.** The top entry was session 13.
- **There is no `SESSION15.md` anywhere** in the repo, under any casing.
- `HANDOFF.md` and `docs/NEXT_SESSION.md` were current — current as of
  **session 13**.

The dud list and the de-carded picks had to be derived from the files instead,
which is most of why the first hour went on inventory. This is the third session
running in which the brief's claims about disk did not match disk; session 13
records the same thing happening to it. **Check the pointers before planning
around them.**

## What the yard actually is now

| in the yard | was | is |
|---|---|---|
| foreground dog | LimeZu labrador, breathing on the spot | `barn_dog`, generated, walking a patrol |
| pen, three head | LimeZu cow, calf, sheep | `whitacre_bull`, `fjord_pony`, `donkey` |
| loose on the grass | — | `arabian_horse`, the one addition |
| hand crossing the yard | LimeZu farmer | **The Hand** — the same file the atlas cuts the player's walk from |
| walking up the track | LimeZu farmer | **The Widow** |
| rooster, oaks, treeline | already ours | unchanged |

**Ten LimeZu entries left `art/sprites.json`** — the cow, calf, sheep and
labrador statics, their four graze/idle strips, and `farmer_walk_up`. Removed
rather than left as `?? sprite(...)` fallbacks, because a fallback to LimeZu is
not a retirement; it is the same picture one atlas failure away. The files are
still in `assets/scene/` and in git — only the manifest decides what ships.
`farmer_walk_strip` stays because the FIELD scene mounts it three times.

### What CANNOT be retired, and it is most of the frame

There is **no generated building, fence or structure art anywhere on disk** —
`assets/pixellab/` was checked folder by folder. So the barn, the farmhouse, the
silo, the coop, the nest, the doghouse, the well, the hay, the trough, the milk
cans, the picket band, the whole stock pen, the cow sign and the scarecrow are
LimeZu and stay LimeZu until somebody pays for generations again. The birds stay
too: there is a generated rooster, and no generated hen or chick that is not
already cursed.

Those buildings are the largest objects on the screen. **"The yard is ours" is
not true and should not be claimed. "Everything alive in the yard except the
hens is ours" is true.**

## `npm run objstrip` — the API is dead, the art is not

`npm run anim` downloads an `animate_image` job and therefore no longer runs. But
a dozen 8-direction objects were pulled down before the account lapsed, and each
holds a full walk at `animations/<clip>/<compass>/frame_NNN.png`. That is the
picture the scene wants, in the wrong shape.

`tools/object-strip.ts` is the shape change, offline. One rule in it matters:

> **Frames are concatenated RAW, and exactly one crop rectangle — the union of
> every frame's content — is applied to every cell.**

`pixellab-anim.ts` bottom-centres each frame on its own content because an
`animate_image` job returns ragged frames. Doing that here would be the session
12 bobbing bug: a PixelLab object walk is already registered on one shared 56 or
68px canvas (verified per object; the tool bails if one ever is not), and
re-registering per frame makes the animal rise and fall by the swing of its own
legs.

## Two real bugs, and one that was not

### `rotations/west.png` faces LEFT on five objects and RIGHT on the bull

Put them side by side and it is instant: dog, pony, donkey, arabian and mule all
face left in `west/`; **`whitacre_bull` and its cursed variant face right.** The
generator did not hold one convention across the batch.

Nothing downstream could catch it. The renderer never mirrors a sprite, so
`prizeBull` charging left drew a bull pointed right — that reads as a sliding
model rather than as an error, and it has been in the game since session 13.

**The IoU sign-off cannot catch this, and the manifest claimed it could.** "east
matches a mirrored west" is true of every one of them and says nothing about
which way EITHER faces. `pixellabObjects` entries may now carry their own
`compassToDirection`; the bull does, and the group default still covers the rest.

### A `scaleX` flip written 4% apart is an interpolation, not a flip

The first ambling animals came out looking like a bull's head towing a mosaic of
the fence. The cause: `scaleX(1)` → `scaleX(-1)` is a range CSS INTERPOLATES,
and the middle of that range is `scaleX(0)`.

Measured rather than argued, with a probe element driven through its own cycle:
**a 64px element written the old way is 0.000px wide at 48%** — three quarters
of a second per turn at a 19s period, with the compositor resampling that sliver
back up out of whatever was behind it.

The flip stops now sit **0.01% apart** — under two milliseconds against a
sixteen-millisecond frame, so it is a cut. Sampling every ambling animal at 2001
points across its cycle now gives `min width === max width` exactly.

**`y-rooster-path` had the identical fault** at 2%, and had had it since the
rooster was built. Same fix, and its return leg moved from 62% to 63.9% so that
the two percent he spends walking on the spot before the peck strip takes over
is the same two percent it always was. Collapsing a turn without moving the stop
after it does not remove the pause, it lengthens it.

### The one that was not a bug: a moving layer smears in a SCREENSHOT

A hen rendered as the same mosaic — and the hen was never touched. Freezing
every animation in the scene and re-shooting: clean. **A layer that is moving
when a screenshot is taken can composite as a smear even while it renders
correctly.** That nearly bought a second bug report on innocent code.

The rule out of it: **freeze the scene before judging a still.** Pausing every
`Animation` under `.home-yard` and setting `currentTime` puts every walk
mid-stride and every path off a turn, which is a fair frame rather than a lucky
one. The `scaleX` bug survives that test because it was measured on element
widths rather than read off a picture — which is exactly why it was real and the
hen was not.

## Found, not fixed: the conform pass deletes the hen's comb

`npm run look -- assets/scene/chicken_walk_left_strip.png --conform`, and there
it is. Raw, the hen has a red comb, a wattle and a yellow beak; conformed, they
are gone into the body brown and the bird has no face.

Same family as the ore tier that went missing in session 13: the house palette
has no saturated red at that value, as it has no mid cold blue. **Left alone on
purpose** — adding a colour re-quantises every conformed group, which session 13
already says wants its own pass looking at all of them. It is one more entry on
that session's list, and the hens are LimeZu anyway.

## `npm run look`

`tools/sprite-look.ts`. Any number of PNGs, side by side, bottom-aligned, on flat
grey, at an integer zoom, optionally with the house palette applied after the raw
copies. It found both of the above. Grey rather than transparent because on a
dark page a transparent pixel and a dark pixel look identical, and "the prop is
standing on baked-in ground" is the fault it gets used for most.

## Generated, still unmounted

- **`draft_mule`** — good art, deliberately not in the yard. It is very nearly
  black, and at dusk against ground this dark it is a silhouette with no shape
  in it. Its strip is built (`assets/scene/muleWalk_strip.png`) and not in the
  manifest. It wants a lit scene or a pale one.
- **`hen_rotten`**, and the four cursed equines — still no slot. Unchanged.
- **Fifteen tilesets** in `assets/tilesets/`, of which one is used. That is the
  supply for "more maps" and it needs no generation at all.

## Verified

`npm test` 135 passed, `npm run typecheck` clean, atlas 1693 frames. In the
browser: every sprite name either scene asks for resolves in the atlas, all ten
retired keys are gone, the field scene is untouched, no console errors. The
bull, pony, donkey, horse, dog, Hand and Widow were each looked at zoomed and
frozen, in place.

**Still unverified: feel.** Nobody has played it. That was true at the end of
session 13 and it is true now.

---

# Session 13 — the field catches up with the cast

The brief was one sentence: *"the characters look right and the world they stand
in doesn't."* Three things changed — the animals became ours, the scenery became
ours, and the ground now rots as the run goes on.

## The brief said this was wiring. It was not.

`docs/NEXT_SESSION.md` opened with "sixteen cursed animals are already generated
and unpacked, four directions was decided, so it's manifest plus renderer
bucket, not judgement." Three of those claims were wrong on disk, and finding
out cost the first hour:

- **The six good cursed animals had no walk.** `arabian_cursed`,
  `barn_dog_cursed2`, `bull_cursed`, `donkey_cursed`, `draft_mule_cursed` and
  `fjord_pony_cursed2` each held eight static ROTATIONS and nothing else.
  `create_object_state` returns all eight rotations of a variant — that is what
  the note about it "satisfying the pairing rule by construction" meant — but it
  does not carry the base object's ANIMATIONS across. Nobody had checked.
- **The four `*_rotten` retries did not exist locally at all.** They exist on
  PixelLab, they are good, and they had simply never been downloaded. `npm run
  object` on the four ids from `list_objects` is the whole fix.
- **The four animals that DID have walks are the weak ones.** `infected_hog`
  reads as a spotted pig and `infected_sheep` as an ordinary sheep, exactly as
  HANDOFF recorded. They are superseded by the rotten retries and now unused.

So the work was a manifest entry, a renderer bucket, **and ten walk cycles**.

**`animate_object(mode: 'v3')` is nearly free and that is the headline.** Four
cardinals at `frame_count: 8` for five animals cost about two generations
against a 2,153 balance. `pro` is 20–40 generations PER DIRECTION — 160–320 for
one animal — so that mode flag is a three-order-of-magnitude decision and the
default is the right one. v3 also **keeps its input as frame 0**, so
`frame_count: 8` stores nine frames; `clipLengths` already carries per-sheet
lengths, so nothing downstream cared.

Gait is worth prompting. Each animal got its own — a stiff lurching limp, a
jerky twitching strut, a laboured stagger, a slow bloated waddle, a heavy
lurching gait — and they read differently in motion for no extra cost.

### What is on the field now

| enemy | was | is |
|---|---|---|
| `feralDog` | LimeZu basenji | `barn_dog_cursed2` |
| `rooster` | LimeZu **hen** (the old bug) | `rooster_rotten` |
| `sickHog` | LimeZu pink pig | `hog_rotten` |
| `blownSheep` | LimeZu white sheep | `sheep_rotten` |
| `prizeBull` | LimeZu black cow | `bull_cursed` |
| `duckFlight` | LimeZu duck | **still LimeZu** — nothing generated for it |

The rooster fix came free. The enemy was drawing `Rooster_Brown_32x32.png` row
3, which is a hen row; replacing the bird rather than re-deriving the row was
the right call and it is now moot.

Unused but generated and good: `hen_rotten`, and the four cursed equines
(`arabian`, `donkey`, `draft_mule`, `fjord_pony`) which have no enemy slot.
They are still static — animating one is a single `animate_object` call.

## `pixellabObjects` — a fourth sprite layout

The humanoids are 32x64 on stacked row pairs, the LimeZu animals are four
direction clips in one band at a 64 or 96px pitch, the tractor is 192px frames
stacked by direction, and a PixelLab object is **one PNG per rotation plus one
PNG per walk frame in named compass folders**. None of them could have been
assumed from the others; that is now four for four.

Two numbers are measured in the packer rather than declared, because the animal
is drawn loose inside a 56 or 68px square canvas:

- **One baseline per (object, DIRECTION).** Per FRAME is the bobbing bug from
  session 12 — the dog's south walk swings 6px between standing and mid-stride.
  Per OBJECT is wrong the other way: the bottom gap is 5px facing south against
  7px in profile, because from behind the hind legs are nearer the camera and
  drawn lower, so one number for all four sinks the animal when it turns. The
  rotation is folded into the same measurement, so nothing jumps the moment it
  starts walking.
- **x pivots on the CANVAS centre, not the content centre**, which drifts as a
  leg swings out and would slide the animal sideways within its own walk.

The compass mapping needed no new derivation: `south→down, north→up, west→left,
east→right`, byte-identical to `pixellabStrips`.

**The LimeZu entries were REMOVED from `animals.sheets`, not left alongside.**
Both groups write the same frame keys and whichever runs later silently wins.
That is trap 3, and it has now cost eight sessions between them.

## The scenery, and one prompt lesson worth more than the art

Eleven props: three trees, three rocks, five ore. `create_map_object`, not
`create_1_direction_object`, **and the reason is the camera** — 1-direction only
accepts `top-down` or `sidescroller`, while map objects accept `low top-down`,
which is what ART_STYLE commits every asset to. Getting that wrong is invisible
in one sprite and obvious the moment it stands next to the cast. Map objects
auto-delete after eight hours, so `npm run mapobj` pulls them down in the same
session that makes them.

**The crops cost nothing at all.** The pack ships `Crop_*_Rotten_32x32.png`
beside every `_Ripe_`, so "crops rotted in the row rather than absent" was a
`_Ripe_` → `_Rotten_` replace across ten manifest lines. It is the one piece of
LimeZu art that is right for the premise as shipped.

### Generated props stand on ground you did not ask for

Three of eleven came back on a baked disc of soil or grass — fine on pasture,
obviously wrong on ash. Negation fixes it (`isolated on nothing, no grass, no
ground, no soil, no shadow`) but not reliably: the same wording worked for the
oak at 192, failed for the broken tree at 128, and worked for it at 96. **Look
at the base of every generated prop.**

### The palette has no light blue, and it ate an ore tier

`oreBlue` was generated as a bright cyan crystal and came out of conform as
bone-white — indistinguishable from `oreSilver`, which is a real regression,
because the ore tier is meant to be readable before you swing at it.

The cause is the coverage rule `art/palette.json` warns about in its own header.
Its only blues are three dusk-sky slates at value 24–38, with nothing above
that, so any light blue lands on cream. Fixed **without touching the palette**,
by generating a near-black navy that lands on the dusk blues instead — the five
tiers now read as copper, bone, olive, navy and raw red.

**The gap is still there.** Adding one mid-value cold blue would be the honest
fix, and it re-quantises every conformed group, which is not a change to make at
the end of a session without looking at all of them.

## The ground rots now, and it is the biggest single change

`grass_to_ash_v2` was the obvious candidate and **it is not ash**. Extracted and
looked at, it is a grey ROCK LEDGE with a cliff edge and a drop shadow, at
`transition_size: 0`. It would have put a quarry in the field.

Seven tilesets to find phrasing that works, and the lesson generalises past this
asset:

> **Keep the noun that already works and change only the colour.** `bare earth,
> smooth, matte, almost featureless` is what produced the good plain grass.
> `dead ash`, `cold grey ash` and `dead grey-green rot` all came back as
> RUBBLE — the model hears the substance and draws stones.

And a second, which is the opposite of the instinct:

> **Negative prompts made it worse.** `perfectly flat, uniform colour, no
> texture, no speckles, no marks, no detail` came back MORE mottled than the
> plain request it was trying to improve on.

`grass_to_blight` is the winner, and the only one of seven with neither a
repeating motif nor a hard rim line at the terrain edge. It is bone-pale, which
was not the first instinct — but "dead and wrong in sunlight" is the brief, the
cursed animals read strongly against it, and a farm turning to dust in daylight
is the premise rather than a compromise with it.

### `src/render/blight.ts`

Shared by `Renderer.bakeWangGround` and `tools/draw-world.ts`, which already
bake the same ground twice and already carry a note that the duplication has to
stay in step by hand. A third hand-kept copy of a seeded field was not on.

The terrain re-bakes when the wave changes — compared in `draw()` rather than
subscribed to, which keeps the renderer's one-way dependency on the sim intact,
and costs one 2400x1600 repaint per wave rather than per frame.

**Two properties are load-bearing and both are now tested.**

- **Deterministic**, because a run replays from its seed and the ground is part
  of what replays. Every blob is drawn from the stream on every bake and the
  wave decides only how many are USED — drawing just `live` of them would
  advance the stream differently per bake and reshuffle the field.
- **Monotonic**, because ash that came and went reads as a rendering fault
  rather than as rot. **The test caught a real bug here**: the lobe offsets
  scaled with progress, so lobes MOVED as they grew and uncovered four vertices
  at wave 9. Four vertices flickering back to grass between two bakes is
  invisible in a screenshot and would have survived indefinitely.

### The numbers were measured, not eyeballed

The first curve was squared over waves 3–22 and gave **0% coverage until wave 7
and 4% at wave 10** — an effect nobody would ever see. Writing a five-line
coverage table was the whole fix:

| wave | 1 | 5 | 10 | 15 | 20 | 25 |
|---|---|---|---|---|---|---|
| ash | 0% | 5% | 31% | 54% | 84% | 99% |

## Verified in the browser, and the port fight that delayed it

`npm run shot` draws through `tools/draw-world.ts`, which is a SEPARATE COPY of
the bake — so the headless pictures prove the blight field, the tilesets, the
props and every animal frame, and prove **nothing** about
`Renderer.bakeWangGround`'s blight pass or the re-bake-on-wave-change in
`draw()`. Those two live only on the browser path. They are now checked.

`.claude/launch.json` pinned `--strictPort` with `autoPort: false`, so a second
session could not start a server at all while the first held 5199. **`autoPort`
is now true and `--strictPort` is gone**, and the harness substitutes the real
port into `runtimeArgs` — the log line reads `vite --port 51878`. A fixed port
is only worth having while exactly one session wants it.

Measured on the renderer's own terrain canvas, driving `window.rdf` directly and
sampling pale pixels away from the tilled edges:

| wave | 1 | 5 | 10 | 15 | 20 | 25 |
|---|---|---|---|---|---|---|
| pale | 9% | 19% | 37% | 66% | 87% | 99% |

`bakedWave` tracked the wave on every step, so the re-bake fires. The 9% floor
at wave 1 is worn dirt caught by the threshold, not ash — the shape above it is
what matters, and it matches `blightField` closely.

Then wave 12 with one of each cursed animal ringed around the player: rotten
hogs, rotten sheep, rotten roosters and cursed dogs on spreading ash, with the
dead oak and an ore boulder in frame. 236fps, 41 draw calls, 0.50ms frame.

**What is still unverified is FEEL, not function.** Nobody has played it.

---

# Session 12 — the art becomes ours

The owner: *"I'm not tied to ANY of the original artwork. I just needed something
to start and used an asset pack because they were $5 each. Now that we can
generate our own art it changes the game."*

That is the largest decision this project has taken, and it dissolves three
constraints that had been shaping everything:

- **The camera mismatch stops mattering.** Sessions were spent trying to make
  PixelLab animals match LimeZu's high top-down. We pick the camera now.
- **The palette mismatch stops mattering.** Same.
- **The licence deadlock goes away.** LimeZu forbids redistribution, which is why
  `assets/` is a careful special case and why several sound packs were rejected
  outright. Our own art has no such constraint.

**`docs/ART_STYLE.md` is the output, and it is now third in the HANDOFF reading
order.** Read it before generating anything. The three decisions, made
deliberately rather than inherited:

| | | why |
|---|---|---|
| camera | low top-down | horror needs a face; a high top-down looks at the top of its head |
| scale | 32px grid, character 32×64 | the atlas, the hash, the bake and the integer zoom all rest on 32 |
| palette | muted daylight → sick green when cursed | the horror works because it is a DEPARTURE |

## The ground autotiles, and the blockiness was geometry

`create_topdown_tileset` returns a 16-tile Wang set. The bake samples terrain at
**vertices, not cells**: a cell asks what sits at its four corners and draws the
tile matching that combination, so a boundary runs THROUGH tiles rather than
around them.

**That is the whole fix.** The staircase was in the geometry, and no amount of
extra tile detail was ever going to remove it — worth remembering, because the
instinct was to ask for better tiles.

- `src/render/wang.ts` owns the key convention and BOTH the packer and the
  renderer import it. Six bugs here have been a name built one way and read
  another; this one cannot be.
- The build FAILS if a set is missing any of its 16 corner combinations, rather
  than drawing a hole in the ground.
- `draw-world.ts` bakes the same way, so `npm run shot` pictures the ground the
  game draws rather than a second one that resembles it.
- Which sets are used is content (`tuning.json` → `terrain`), so a map descriptor
  can eventually pick its own pair.

## The palette had to be authored, because conform cannot shift one

`create_topdown_tileset` has a hard prior for bright saturated green. "Dry muted
sage green, dusty, desaturated" still came back arcade.

Quantising was the obvious answer and **it made the grass worse the first time**
— flatter and MORE saturated. The reason is the keeper: **conform matches a
palette, it cannot shift one.** `art/palette.json` was 32 colours k-means'd out
of the LimeZu sheets, which are full of saturated green, so the nearest entry to
a bright green was a bright green.

The palette is **authored** now. With muted daylight actually in it, conform
delivers the house look whatever the model returns — the only reliable way to get
consistency out of a generator with its own opinions.

**Coverage beats taste when editing that file.** A quantiser sends every pixel to
its nearest entry, so a missing region lands somewhere absurd — session 3 lost a
day to an explosion turning magenta with no saturated red between hue 20 and 40.
The cursed greens are kept distinct from the pasture greens on purpose, or a
diseased animal quantises straight back into a healthy one.

## The whole cast is generated now

Seven characters — six player classes and the infected farmhand — from ONE anchor
via `style_character_id`, walked with the template animator at one generation per
direction, and cut to the 32×64 cell.

**`size` is the CANVAS, not the character.** This is what made the old farmhand
look like a child among adults, and it was measured rather than guessed:

    player classes, and every LimeZu enemy   32x46
    farmhand (the one PixelLab character)    26x38

PixelLab leaves motion room, so the figure fills about 76% of the canvas. `size:
46` gives 19×35 of content; `size: 64` gives 30×52. **64 is the house setting.**
After the swap the farmhand is 28×52 against the player's 30×52.

**The baseline moved 52 → 58.** 52 was LimeZu's and fit their 46px characters;
the generated cast is 51–55 tall, so a 55px Kid placed feet-at-52 would start at
y=−3 and lose the top of his cap — silently, because a cut that overflows just
clips. Safe only because every character is being replaced: the atlas takes each
sprite's pivot from where its feet sit, so a cast cut consistently at 58 aligns
with itself. **Mixing 52 and 58 is what would break.**

**One baseline per STRIP, not per frame.** Cutting each walk frame to its own
content bounds and concatenating gives a character who bobs, because a mid-stride
pose is shorter than a standing one. `tools/pixellab-character.ts` takes the
baseline from the tallest frame in the strip and offsets the rest against it.

**The LimeZu entries had to be REMOVED, not left alongside.** Both groups write
the same frame keys and the humanoid pass runs later, so it silently wins. The
symptom last time was a walk with 6 frames instead of 8 and no error anywhere.

## The weapon ring was two bugs wearing one coat

The owner: *"I don't like the weapons just attached to a circle surrounding
him."*

1. **Evenly spaced around a full circle IS the visual signature of orbiting**,
   and no art fixes it. They fan across a 250° arc centred on his facing now,
   leaving a gap behind his head. Same weapons, same aiming; the emptiness at the
   top is what says *carried*.
2. **The lift was going into the depth sort.** `it.y` was both the drawn position
   AND the sort key, so the 14px torso lift also pushed weapons 14px toward the
   back — a weapon at his SIDE drew behind him. `liftY` separates them,
   defaulting to 0 so everything standing on the ground is unaffected.

**Lift is a picture, depth is a position, and they are not the same number.**

## The rooster, and a gap I put there myself

Three complaints, three causes:

1. **"There's a gap in between it reloading."** Mine. The three visibility
   windows did not abut — walk switched off at 64% and peck did not switch on
   until 66%. Two percent of a 24s cycle is 0.48s with NO layer visible, three
   times a loop. Every off stop is now the same number as the next layer's on
   stop; verified by sampling the whole cycle at 0.1%, zero holes.
2. **"It pops — generated on a different palette."** `conform: false` on the
   `pixellab` and `sceneStrips` groups. The tilesets went through the house
   palette and the sprites did not. Both conform now.
3. **"You can see the flip."** `scaleX(-1)` mirrors every asymmetric detail at
   once, which is exactly what the eye catches. He is regenerated as a proper
   8-direction object with REAL east and west rotations.

## Wave density: measured, attempted, reverted

The owner reported the waves as far too slow. The harness agreed — **19 enemies
alive at the average death**, ~76 kills a wave, one every half-second, which is
the rate they arrive at. The field never builds.

Raising it was tried three ways and every one failed the acceptance test:

    budget x2.3 + faster groups -> 46-65 alive, kills 1898 -> 4093, clears 88->25%
    budget x1.3 + faster groups -> still under the bar
    budget UNCHANGED, groups alone at 1.8x -> still under it

**That last line is the finding: the game has no headroom at all.** Spawn rate
alone, on the identical budget, drops `run.test.ts` below "clears 25 waves on
most seeds". Density and player power are coupled, and the fix is not a bigger
number — it is **more enemies that are individually weaker**, across
`enemies.json`. Values are reverted; the numbers are recorded in `formulas.ts` so
nobody re-tries it blind.

Kept from the attempt: the group interval is CONTENT now rather than
`rng.range(0.5, 1.5)` buried in the spawner, and two tests stopped restating
constants they should have been reading.

## The browser pane, finally explained

It composites when the Claude Code window is **displayed and focused**. Reporting
`visibilityState: hidden` with `hasFocus: false` means the app is backgrounded or
the panel is collapsed — and when it is, `requestAnimationFrame` never fires, so
the game loop does not tick and screenshots time out.

Most of the pipeline does not need it: `npm run shot`, `npm run range` and the
tests are all headless. It is needed for judging COLOUR and for watching anything
animate.

## Verified

- 131 tests and a clean typecheck on game and tools, at every commit.
- Atlas 1581 frames. Every Wang set complete; the build fails if one is not.
- The cast measured in the atlas: 26–32 wide, 51–55 tall, 8 walk frames each.
- Ground, cast and props looked at on screen rather than inferred.

---

# Session 11 — the first real playtest since the art landed, and one token behind three of the bugs

The owner played it and took notes. Everything below came out of that, which is
the whole argument for the playtest: **131 tests and a clean typecheck were green
through every one of these.**

## Three separate complaints, one redefined token

Reported as three things — the pause screen's white-on-cream text, the level-up
cards being unreadable, and "the homestead cards look incorrect". One cause.

`--ink` was defined **three times**: `#33261a` in tokens.css, then `#241f1a` and
then `#f0e4d2` in style.css. `@import` is only legal at the top of a stylesheet,
so tokens.css is always FIRST in the cascade and any `:root` written further down
outranks it. The last definition won, and it was the cream from the old dark-field
panel language.

Every surface in the game is paper now. So that one token turned the level-up card
names, the pause sheet's title and tallies, the Homestead sign names, the class
hero names and the HUD feed counter into cream text on cream paper.

Proved rather than reasoned, in the live DOM: `--ink-body` and `--ink-band`
computed correctly (#5c4a33, #4b3a24) while `--ink` computed #f0e4d2 — which is
what pointed at a redefinition rather than at any of the rules that consume it.

Both legacy `:root` blocks are deleted. They redefined **fourteen** names between
them, all of which tokens.css already carries as deliberate aliases — it says so,
under "Legacy aliases", precisely so those blocks could go. The only rule that
genuinely wanted cream is `.btn`, which is dark wood rather than paper, and it
asks for `--cream` by name now.

**This is HANDOFF rule 3 for the seventh time: adding to a namespace someone
already owns fails silently. Grep the name before you choose it.**

## The dots were eight times too strong

Separately reported: "the cards still have this messed up background, it's all
dotted." DESIGN_LANGUAGE.md specifies *"dotted stock, 0.12 opacity"*.

`.psheet::before` and `.hero-body::after` honour that by hanging the dots off a
pseudo-element and setting `opacity` on it. But `.pcard` and `.stock` apply the
token **directly as a background-image**, where there is nothing to carry an
opacity — so they painted a solid `#5a4630` dot every 4px, at full strength,
underneath every blurb on every card.

That is the tail of the session-9 fix. Making the card opaque again moved the dots
out of a pseudo-element and into the background shorthand, and quietly left their
opacity behind. The alpha is baked into `--paper-dots` now, so the token is right
wherever it is used, and the two pseudo-elements dropped their own `opacity`
because 0.12 × 0.12 is 0.014 and invisible.

**Worth keeping:** when a value is only correct because of something on the
element that uses it, moving it costs the correction. Put the alpha in the token.

## The trees floated because the table and the ground disagree

`scene.oak` packs at 59x54 and is drawn at 4x, so it is 216 tall. PLACEMENTS.md
puts the four yard oaks at y 268/300/282/414, which lands their BASES at 484, 516,
498 and 630 — against a ground layer that starts at **620**. Three of the four hung
104–136px up in the sky. The fourth was fine, which is why it read as "some trees
float" rather than as a systematic error.

There is no reference to copy for this one: **`tree_oak` does not appear in
`docs/reference/` at all.** Design's final yard drops the oaks; they are in the
game because the owner wants them. So the table is the only source, and the table
disagrees with a ground layer the table never contained. Ground wins — it is in
the reference and the table is not.

Placed by their base instead, varied a few pixels either side of the line so four
identical trees do not stand on a ruler. Verified in the DOM: bases now sit 6–14px
below 620.

**Same lesson as session 9, from the other end.** There it was a table that was
missing two thirds of the picture. Here it is a table whose numbers are internally
consistent and disagree with the scene they are placed into.

## The weapon slots showed names where the design asked for art

§12: *"bottom-centre weapon ring, 128px slots, cooldown wipe + tier chip"*. They
were 78px text chips carrying the weapon's NAME, so six weapons read as six words,
and the cooldown wipe — the one thing that shows a weapon firing — drained down a
word.

They are seed packets now: art window over a stamped name, tier chip, wipe across
the whole card. 128px, six of them plus gaps is 808px, which fits.

**The key comes from content, and getting that wrong would have been silent.**
`weapon.<id>` is the obvious guess and resolves for only five of the sixteen: the
atlas still carries the pre-rename ids (`axe`, `chiliShot`, `eggToss`) and every
ranged weapon draws a gun from a different family entirely (`gun.shotgun.0`).
Eleven slots would have fallen back to a text caption — the exact thing the change
exists to remove.

`weapons.json` already answers it. Every weapon carries `sprite` and a
`tierSprites` array giving its icon at each tier, **authored for all sixteen at
all four tiers and, until now, read by nothing at all.** Merging is supposed to
visibly change the weapon and the art for it was sitting there. Verified: all 64
weapon-tier icons resolve in the packed atlas.

## The results screen was terminal, and that is three screens now

Reported as a blocker: *"All the buttons become unclickable so the user can't
proceed past that point."* Exactly right, and it made every finished run a dead
end — there is no keyboard escape from results.

`#ui` is `pointer-events: none` and each layer opts back in. The rule is
`#ui > .screen`. The results root is **`.results-wrap`**, so it never matched.
`.pause-wrap` is the same shape and survives only because it happens to set
`pointer-events: auto` in its own rule; results never did.

Proved with `elementFromPoint` at each button's centre, which returned
**`CANVAS`** — the click was landing on the game behind the sheet.

**This is the third screen in this project to ship unreachable**: the shop and
level-up cards in session 2 (a blanket `#ui > *` rule outranked `.hud`), the
pause screen in session 6 (caught only because someone thought to hit-test it),
and now results. Every one passed types and tests, because a dead button is a
computed style rather than an error.

So there is a guard now rather than another comment. `assertUiLayersClickable`
in main.ts runs off a MutationObserver on `#ui` and logs a named error when a
layer that contains controls computes `pointer-events: none`. Dev only, never
throws. Verified both ways: silent in normal play, and it names `.results-wrap`
within a frame of the bug being reintroduced deliberately.

It observes on mutation rather than running once at boot **because screens are
built empty and filled on open** — at boot the results layer has no buttons to
count, and a single startup check would have missed this exact bug.

## Two scroll boxes, one of them clipping the other

Also reported: the end screen needed manual scrollbar dragging and cut off the
banked-acres panel.

`.results` is `min(1080px, 94vw)`. It was sitting inside `.screen-inner`, which
is the level-up screen's scroll box: `max-width: min(1000px, 92vw)` with
`overflow: auto`. A 1080px child in a 1000px clipping parent.

Measured: overflowing by **103px**, with the acres panel's right edge 84px past
the clip — which is why "BANKED AT THE HOMEST…" and a halved acre count were on
screen. `.results-wrap` is already the scroll container (`place-items: center`,
`overflow-y: auto`), so the inner box is neutralised back to a plain div.

**Worth keeping:** `overflow-y: auto` alone computes `overflow-x` to `auto` as
well. A container that only means to scroll vertically will still grow a
horizontal scrollbar and clip, and it looks like a layout bug rather than an
overflow one.

## The field shook forever because trauma decays in the sim

*"The background also starts vibrating crazy."*

`world.shake` decays inside `world.step` — `shake -= traumaDecayPerSecond * dt`.
It is CONSUMED in `renderer.draw`, every frame, as a fresh random offset of
`trauma² × maxShakePixels`.

Dying is a hit, so the fatal blow spikes trauma; `finishRun` then sets
`world.paused` and the step stops. The decay stops with it. **The draw does not.**
So the camera kept re-randomising a full-magnitude offset every frame, forever.
Measured before the fix: ±17px of jitter per frame with the sim frozen.

The renderer asks for no shake while paused. That was chosen over teaching the
sim to decay cosmetics on a stopped clock, and it fixes level-up, shop and pause
in the same line — all three set `paused` and all three had a milder version of
this. Verified: 0 across every frame when paused, still shaking when playing.

**The shape worth keeping:** a value that decays on one clock and is consumed on
another is a bug waiting for the two clocks to diverge. Pausing is exactly that
divergence.

## The rest of the screens, swept

Every screen opened in isolation and audited for the same three defects —
unreachable controls, controls off-screen, and unintended horizontal scroll.
Level-up, shop, pause, Homestead and results are all clean. One earlier reading
that flagged the shop's "Back to the field" was an artifact of the audit stacking
two screens that never stack in play; opened properly it hit-tests fine.

## The yard is alive now, and it cost eighteen generations

The owner: *"I like the rooster and its placement, but we need animations so it
walks and pecks at the ground and crows — every character needs a full
animation."* Fair: the yard had two hens and two farmhands on real strips, and
everything else — rooster, cow, calf, sheep, dog, chick, both idle hands, both
scarecrows — was a still frame floating on a CSS `y-bob`.

**`animate_image` is the tool, and it is startlingly cheap.** It animates a LOOSE
sprite — no PixelLab object id required — so it works on art that already exists
in this repo, which is all of it. Cost scales with total pixels: a 64x64 8-frame
animation is **one generation**. Sixteen animations across every frozen actor in
both scenes cost sixteen. Compare `create_8_direction_object` at 20.

Two things about it worth knowing:

1. **It keeps your input as frame 0**, so `frame_count: 8` returns NINE frames.
   Every strip in `sceneStrips` now carries its real count and the note says so;
   assuming six is how a stepped strip slides.
2. **Feed it a URL, not base64.** The repo is public, so it is its own asset
   host — `raw.githubusercontent.com/<owner>/<repo>/<sha>/<path>` — and that
   sidesteps the base64 truncation documented in `_eightDirNotes` entirely.

`npm run anim -- <job-id> <name> [frames]` pulls a job down and assembles the
strip. It composites every frame **bottom-centred on a uniform cell**, which is
the load-bearing part: `stripActor` steps by dividing the strip's width, so an
uneven cell slides, and a top-left composite lets a taller frame lift the bird
off the ground between steps. It also writes a contact sheet on grey, because
**the failure mode of a generated animation is one frame that belongs to a
different animal** — invisible one frame at a time, obvious in a row.

### One keyframe instead of six

The existing pattern is `@keyframes y-strip-384`, one block per strip width. The
new actors arrive at 224, 288, 364, 378, 468, 486, 540, 630, 672 and 810 — ten
more blocks that all say the same thing, each a chance to typo a number that
fails *silently* by sliding instead of stepping. `stripActor` publishes
`--strip-w` and one generic `y-strip` keyframe reads it. The named ones still
work; nothing was migrated.

### The rooster

He pecks on a 2.4s loop, and every twenty-one seconds he crows. Two strips
stacked on one spot with `y-crow-show` / `y-crow-hide` cutting between them —
stops 0.1% apart rather than shared, so it is a cut and not a dissolve, because
two birds cross-fading through each other reads as a ghost.

He also has a **walk** strip, generated and packed and not mounted: walking means
choosing a path with `travelling()`, which is a placement decision rather than an
art one. `rooster_idle`, `dog_walk`, `sheep_idle`, `cow_idle` and `calf_walk` are
generated and deliberately unpacked for the same reason.

### `_`-prefixed notes do not go inside `files`

The atlas builder reads every key in a group's `files` map as a sprite name and
every value as a path, so a `"_generatedNote"` in there made it try to open a
paragraph of prose as a PNG. It failed loudly, naming the file, which is the
1792x704 assertion's spirit working exactly as intended. Notes belong at the
GROUP level.

Verified: atlas 1309 frames (was 1298), all eighteen strip actors mounted in the
live DOM with real image data and no fallbacks, 131 tests pass, typecheck clean.

## The cursed cast, and the edit that actually bites

The owner's direction: *"a ranch where crop dusters have turned everyone
zombies/cursed"*, and lean harder into it. `_horrorPlan` already said the horror
version has to be made FROM the healthy animal or the pair does not read as one
animal before and after. **`create_object_state` is that tool** — it takes an
existing object, applies an edit, and returns a new object **with all eight
rotations intact**. Six went through in one batch.

Four landed hard: the **bull** (mottled sick green over black, hide sloughing),
the **donkey** (green-grey striping over the ribs, gaunt), the **arabian** and
the **draft mule**. Judged as rings, all eight directions agree.

Two did nothing. The **fjord pony** came back an unchanged clean white, and the
**barn dog** got a faint green tint and stayed a friendly brown dog. That is the
same complaint session 9 logged about the four infected livestock — *"the hog
reads as a spotted pig and the sheep as an ordinary sheep in grey"* — and the
cause is now clear:

**Name the colour transformation, not the symptoms.** "matted patchy coat, ribs
showing, green staining" describes what is wrong with the animal and leaves its
palette alone, so a pale coat stays pale. "**the whole white coat turned filthy
grey-green and diseased**, fur sloughing away in bald patches showing raw grey
skin beneath" moves the palette, and the retry on both came back properly sick.

The rule: **an edit that only adds detail is resisted by the base image; an edit
that restates the base colour replaces it.** Dark animals curse easily because
the disease palette is already near their coat. Pale ones need to be told.

## Tilesets: the recipe matters more than the prompt

The owner wants the ground to stop being blocky before any more maps get made.
`create_topdown_tileset` returns a 16-tile Wang set with corner autotiling —
which is the right shape for the problem, because what stops ground looking
blocky is the TRANSITIONS.

**The first three were unusable, and the settings were why.** Asked for "dry
cracked dirt with small stones and tyre ruts" at `highly detailed` +
`detailed shading` + `selective outline`, it returned tan **paving with a purple
grid**; "blighted ash-grey dead earth" came back as grey **dungeon cobblestone**.
At 32px, `highly detailed` does not mean more texture, it means more STRUCTURE —
and structure on a ground tile is a repeating pattern you can count.

Re-run as a four-way settings experiment on one terrain pair, the recipe is:

    detail: 'low detail'   shading: 'flat shading'
    outline: 'lineless'    text_guidance_scale: 15

Lineless matters most: a `selective outline` puts a hard dark rule around every
terrain edge, which is precisely the blockiness being complained about. Guidance
15 over the default 8 is what makes it draw the terrain you asked for instead of
a generic one. Short concrete descriptions beat long evocative ones.

Six sets are in `assets/tilesets/`, PNG plus metadata, **chained**: pass a
finished set's `upper` base tile id as the next one's `lower_base_tile_id` and
the two share that terrain exactly. Everything below hangs off one grass, so
grass→soil, grass→ash and grass→water all meet the same field:

    dirt_to_grass · grass_to_soil · grass_to_ash · grass_to_water
    dirt_to_gravel · ash_to_dyinggrass

**None of it is wired, deliberately.** The terrain bake draws one sprite per
cell; using a Wang set means picking a tile from its four corner values, which
is a real change in `renderer.ts` and wants doing awake and with the owner
looking. The metadata's `bounding_box` is the sheet rect to slice — the
tileset API's own note warns that `wang_N` and `original_position` are NOT sheet
positions and using them is what produces horizontal banding.

## What the browser pane could and could not prove

Computed styles, token values, element geometry and atlas resolution were all
checked live. **No screenshot was possible again** — the pane does not composite,
and because `document.visibilityState` is `hidden` that also means
`requestAnimationFrame` never fires, so the HUD does not tick and the weapon
slots could not be observed populating themselves. The slot DOM was built by hand
against the real atlas to measure the CSS instead.

So: the CSS, the geometry and the art keys are verified. **The weapon slots want
a human to confirm they populate in a real run**, and that is a two-second check
next time someone plays.

---

# Session 10 — the animals measured, and the wrong thing was being worried about

Nothing was wired. This session answered three of the four questions blocking the
ten generated animals, and found that the fourth problem is not the one the queue
had written down. `npm run animal` (`tools/animal-check.ts`) is how, and it should
be re-run rather than believed.

## The direction mapping was never a fourth direction order

The queue said, in capitals, that the compass→game mapping would be **a fourth
distinct direction order** after the humanoids, the animals and the tractor, and
that it had to be measured rather than assumed. That warning conflated two
different problems, and only one of them exists here.

The three sheet families pack their directions as **anonymous bands**. Which band
is which genuinely has to be proved — the `humanoidRig._directionNote` in
`art/sprites.json` is the record of doing it, by pixel-mirroring bands and
counting skin centroids, after a player reported that walking right drew the
down sprite.

A PixelLab object is not that. It comes back as **eight files named for their
compass points**. There is no order to infer; there are only names to check. And
the mapping they imply was already shipped in this repo — `compassToDirection`
under `pixellabStrips`, for the infected farmhand, generated by the same service.

Checked rather than assumed, on all ten, by silhouette IoU against a mirror:

- **south and north are self-symmetric** (0.68–1.00) — a front view and a rear
  view of an animal are bilaterally symmetric
- **east and west are not** (0.26–0.75) — a profile is not
- **east matches a mirrored west** (0.88–1.00) — the two profiles are the same
  animal facing opposite ways

That pins all four axes without anyone judging a picture. `south → down,
north → up, west → left, east → right`, which is what was already in the file.

**Worth keeping:** "measure it, do not assume it" is right, but it is worth
asking *what kind* of unknown you have. Anonymous indices must be proved. Named
files only need verifying, and the verification is cheap enough that there is no
excuse for guessing either way.

## Frame counts

Eight directions × nine frames, confirmed on all ten, against LimeZu's six.
`atlas.json` already emits per-sheet clip lengths for exactly this reason, so
this is a manifest entry rather than a renderer change. This one was already
right in the queue.

## The size problem is a camera problem

The queue framed this as scale: 56–68px sprites against LimeZu animals at 46–54
wide and 32–40 tall. Those LimeZu numbers are correct — but only for the
**profile**, and the profile is the only view where the difference actually
lives. Measured profile against profile:

| | LimeZu | PixelLab | Δw | Δh |
|---|---|---|---|---|
| dog | 46×40 | 49×42 | +7% | +5% |
| hog | 54×32 | 61×39 | +13% | +22% |
| sheep | 52×36 | 58×54 | +12% | **+50%** |
| bull | 92×26 | 64×43 | **−30%** | **+65%** |

**The widths already agree.** It is the heights that do not, and the bull inverts
the sign — LimeZu's `prizeBull` profile is 92 wide by 26 tall, a cow
foreshortened from a high top-down, against a bull standing at 64×43.

So this is not a scale mismatch that a multiplier fixes. **LimeZu draws its
animals from a high top-down and PixelLab drew these nearly side-on.** Scaling
them down to match height would leave them too narrow, and would make the
foreshortening disagree rather than agree. Session 9's note that these "stand
upright where LimeZu draws flatter" was the right observation filed under the
wrong heading.

Worth noticing: the game's own humanoids do not have this problem, because the
LimeZu *characters* are drawn upright too. It is specifically the LimeZu
**animals** that are flat.

## What that makes the next move

**Wire `barn_dog` first, alone.** At +7% wide and +5% tall against the `feralDog`
already on the field it is the one animal that is close to a drop-in, and it is a
weapon minion rather than an enemy — so a wrong call costs one summon rather than
the enemy roster. Whether the other nine need re-generating at LimeZu's camera
height is a question one dog in a real run can answer and no amount of further
measuring can.

## Still a judgement, and deliberately left open

**Four directions or eight.** The renderer buckets an enemy's velocity into four;
going to eight is a change there, not in the art. Four ships sooner and wastes
half of what was generated. Nothing measured here decides it, so nothing here
pretends to.

## Verified

- 131 tests pass; typecheck clean on game and tools.
- `npm run animal` reports all ten and writes a contact sheet at the game's 2×
  zoom on the real `terrain.grass` tile, every animal on a shared baseline.
- The LimeZu animals pack **all four directions**, not the two that session 1
  described — the up/down-alias-onto-side workaround from that session is no
  longer what the atlas contains, and the sheet shows genuine front and rear
  views. That entry below is stale; this is the state.

---

# Session 9 — the two scenes, and a card you could see through

## The scenes were built from an index of the scenes

`docs/reference/Whitacre Yard at Dusk.html` and `Whitacre Field at Dusk.html` are
Design's own runtime-bundled backdrops. They are the target, and until this
session almost none of either one was in the game.

The previous pass built both scenes faithfully from `docs/mockups/PLACEMENTS.md`
and measured correct against it. **That table lists the scenes' `<img>`
placements and only those.** Everything that is not a sprite — and in these two
scenes that is most of the picture — is a CSS layer, and none of it is in the
table. What was missing from the yard:

- the dusk sky itself (a nine-stop gradient; the build had an invented six-stop one)
- the sun, its core, and the flicker they share
- three drifting cloud bands
- the haze band the buildings stand in front of
- the ground — the yard had **no ground layer at all**, just sky to the bottom edge
- the lit top edge of the ground, and the furrow stripes
- the track worn up to the barn doors
- **the barn**, and the glowing doorway that is the Homestead entrance
- **the farmhouse**, its porch light, and three puffs of chimney smoke
- the stock pen: rails, gate, two posts, a sign
- two hens crossing the yard, a hand crossing it, a hand walking away up the track
- four fireflies
- both shaped vignette passes

And from the field: the sun, the clouds, the treeline silhouette band, the ground
and its lit edge, two walking hands, two walking hens, the heat shimmer, three
birds, **the tractor** with its exhaust and dust, the crosser, two fireflies and
the vignettes.

So the yard was a sky with nineteen props sitting on it, and the field was a sky
with a treeline. Both were *correct against the table they were built from*.

`src/ui/scene.ts` is now a layer-for-layer port of the two reference documents,
in their DOM order, which is paint order and is load-bearing. 43 layers in the
yard, 38 in the field.

**The lesson, and it is the same one this project keeps paying for:** a table
extracted from a design is an index of the design, not the design. Read the
thing itself.

## Every scene sprite was in the wrong place, silently

The `scene` group was packed **trimmed**, like every other sprite group. Trimming
is right for a field sprite, which is drawn from a pivot — and wrong for anything
positioned by its box, which is every sprite in these two scenes.

Design's coordinates are the top-left of the sprite's FULL box. Measured against
the packed atlas:

| Sprite | Native | Packed | Drawn |
|---|---|---|---|
| scarecrow | 96x96 | 84x78 | 12px left and 18px high of where it belongs |
| house | 256x320 | 248x296 | 8 and 24 out |
| well | 96x64 | 70x64 | 26 out |
| silo | 224x448 | 216x448 | 8 out |
| hay | 64x32 | 46x32 | 18 out |
| chick | 32x32 | 22x20 | 10 and 12 out, doubled by the 2x zoom |

Nothing errors. Every sprite is present, every frame is non-empty, and the scene
renders a confident, wrong composition. `scene` carries `noTrim` now and every
sprite measures its native size in the live DOM.

This is the fourth distinct thing the atlas's trimming has broken — after the
six-frame strip, the 32px tile and the stepped walk cycle. The rule worth
carrying: **trim what is drawn from a pivot, never what is drawn from a box.**

## The card stock was 94% transparent

Reported with a screenshot: the level-up cards showed the game field straight
through their own blurb text. One rule, in `card.css`:

    background: var(--paper);                                        /* opaque gradient */
    background-image: radial-gradient(#5a4630 1px, transparent 1px); /* replaces it */
    background-size: 4px 4px;

`--paper` is a gradient, so it is a background-IMAGE, and the shorthand also
resets background-COLOR to transparent. The longhand on the next line then
replaced the gradient with the dot pattern. What was left was a 1px dot on a 4px
grid over nothing.

Proved rather than reasoned: applying those two old declarations to a bare
element computes to `background-color: rgba(0,0,0,0)` with a single
radial-gradient. The paper was never there.

`.psheet` and `.hero-body` are the same stock and get it right by hanging the
dots off a pseudo-element — and `tokens.css` even carries a `.stock` helper
whose comment warns that paper elements already own their gradient. The card did
it inline anyway. It now layers both images in one declaration over a flat
colour (`--paper-flat`), so paper stays paper whatever wins the image slot next.

**Worth keeping:** a shorthand followed by a longhand that overwrites the part
doing the work is invisible to review, to types and to tests. Every colour token
in that rule was correct.

## The barn doorway is the Homestead entrance now

`DOOR` was a pair of hand-placed coordinates that predated the barn existing in
the yard at all. It derives from the barn's own position and its door offset now,
so moving a barn moves its door.

## Art

Twelve subjects generated, in three batches of eight.

Landed and wired: the Ditch Light, the Straw Hat, and **all four Homestead
building signs** — which were borrowing a grain lure, a feed pickup, the player's
own head and a tier-3 scythe, and so read as four inventory items rather than
four places you walk into. Also `scene.rooster`, generated, replacing a
transparent crop, and visibly taller than the hens beside him.

Generated and staged, not wired: the oak, four infected livestock side views, the
Whitacre bull, the barn dog, the gas cloud, the crop duster, the salt ring, a post
auger, a combine head, and the owner's own animals — a fjord pony, an arabian, a
draft mule and a donkey. A side view is a reference, not an enemy; see
`art/pixellab-queue.json` for what each still needs.

**The post auger and the combine head have real four-rung ladders now**, and
the way they were made is the point. Each rung was generated FROM the rung below
it as a `reference_images` URL pointing at this repo's own raw.githubusercontent
path — the repo is public, so it is its own asset host — with the description
changing only the material. Generated independently they would have been four
unrelated tools; referenced, they are one tool at four qualities.

The ladder is wear and quality rather than the pickaxe's stone/iron/gold/
titanium, because gold is a silly thing for a fence auger to be made of:
**rusted iron, clean steel, blackened hardened steel, polished chrome.**

Two rungs had to be re-picked or re-run, and both were caught by looking rather
than by measuring. `brass crank handle` on the auger's T4 dragged an orange
squash out of the style anchor into all sixteen candidates; dropping `detail`
from `style_copy` and the colour word fixed it, which is the second time that
exact fix has worked. And the first T3 pick read as T2 with a wooden grip rather
than as an escalation — a ladder has to be judged as a ladder, so `tools/`
grew a throwaway contact-sheet script to put all four side by side on a grey
field. Judging rungs one at a time is how you get four fine icons that are not
a progression.

### Three things about PixelLab that cost something to learn

1. **The concurrency limit is 8 jobs, not a time window.** A ninth returns "rate
   limit exceeded (8/8)". There is no cooldown to wait out: the batch finishes in
   about nine minutes and the slots free. Fire eight, wait, fire eight more.
2. **The style anchor is a sheet of farm produce, and `style_copy` defaults to
   copying `detail` as well as palette, outline and shading — which drags the
   anchor's SUBJECT across.** The first oak came back as four pumpkins and an
   onion. Same prompt, same anchor, `style_copy` narrowed to
   palette/outline/shading: a correct oak, first try. Small hand-held objects are
   fine on the default; anything larger is not.
3. **64x64 is the sweet spot for Pro.** It returns 16 candidates at that size, 4
   at 128px and 1 above 170px, all for the same 20 generations. Reaching for a
   bigger canvas costs twelve of the sixteen tries, which is exactly when a bad
   generation has nowhere to hide. Generate small, draw at an integer zoom.

**One refusal, and it was the wrong layer.** `a small worn boot knife with a
bone handle` came back refused, and it was written up here as a PixelLab
refusal. It was not: the block came from the **Claude Code permission
classifier**, so the prompt never reached the API at all. Retrying the identical
request went straight through and returned sixteen good knives, one of which is
now the Boot Knife's card art. Check which layer refused a generation before
rewriting the prompt — the wording was never the problem.

`npm run fetch -- <job-id> <name>` is new: it pulls every candidate down plus a
4-across contact sheet, because the REST API returns candidates as separate files
and there is no grid for `pixellab-cut grid` to slice.

## The cast can turn now, and it can walk

Ten animals have eight rotations and an eight-direction walk: the owner's own
fjord pony, arabian, draft mule and donkey; the Barn Dog and the Whitacre Bull,
both of which were borrowing a generic sprite; and the four infected livestock.

**`create_8_direction_object` is the tool, not the character creator.** Each
animal was generated FROM its own side view passed as `reference_image_base64`,
so the ring is recognisably the same animal rather than a generic one — the
fjord pony stays white and blonde, the mule black, the donkey small and grey.
The tool's own docs warn that reference identity transfer is unreliable for
CHARACTER sprites; it held for all ten ANIMALS. Do not extrapolate that to
humanoids.

**Animation is one generation per direction.** `animate_object(mode="v3")` cost
eight generations for a full eight-direction walk, against the 160–320 that
`mode="pro"` would have cost. Measured rather than read: the balance moved 451
to 443 across one animal. It queues one job per direction, which is the entire
8-job concurrency limit, so animals animate one at a time at about four minutes
each.

### Two instruments were wrong before the game was, again

- **`reference_image_base64` is intermittently truncated in transit.** The error
  says "broken data stream" and reports the full byte count, so it reads like a
  corrupt file — and the same file opens fine in PIL locally. It is not
  size-related: payloads of 814, 1424, 1938 and 2149 bytes went through while
  1365, 2098 and 3898 byte ones did not, and one file failed twice then
  succeeded unchanged. **Retry.** Quantising through `conform-fx`'s LimeZu
  palette shortens the payload, makes a retry likelier to land, and conforms the
  art on the way in as a bonus.
- **`tar` here is GNU tar, which does not read zips at all.** The object
  download is a zip; the first version of `npm run object` shelled out to `tar`
  and got "This does not look like a tar archive". Zip's central directory is
  forty lines to walk and its entries are raw-deflated, which Node's zlib
  already does for the PNG codec — so it is read in-process now and cannot be
  broken by a PATH.

**`npm run object` writes a `_ring.png` and a `_walk_<dir>.png` per direction,
and that is the point of it.** The failure mode of an eight-way rotation is not
a bad frame, it is ONE DIRECTION that does not belong to the same animal as the
other seven — invisible one frame at a time, obvious on a strip.

**None of it is packed or wired, deliberately.** The renderer advances walk
frames by distance travelled, so a static sprite would skate across the ground:
worse than the placeholder it replaces. And these walks are NINE frames per
direction where the LimeZu animals are six, at 56–68px where LimeZu's are 46–54
wide and 32–40 tall, in a compass order that is the fourth distinct direction
order in this project. Each of those is a small decision and none of them should
be guessed. `_howToWireIt` in the queue lists them.

## The soundtrack is licensed now, not generated

Three CC-0 tracks by **Abstraction** (Benjamin Burnes / Tallbeard Studios) from
the Music Loop Bundle replace the three Lyria clips: an ambient-spooky bed for
the field, an 85-second drum-and-bass for combat, and the pack's heaviest
non-chiptune track for the boss. Chosen from the pack's own metadata — tags,
energy, duration, the author's score — which means they were chosen by reading
and still want checking by ear in a real run.

**OGG, not MP3, and that is the pack author's own instruction:** MP3 leaves a
short gap at the loop point that is very hard to remove, and every layer here
loops for as long as a wave lasts. The loader takes its filename from content,
so this was a JSON edit with no code change.

The prompts stay in `audio.json`. They no longer describe what plays, but they
still describe what each layer is FOR, and they are the brief if the soundtrack
is ever regenerated. `npm run music` would now write `.mp3` files that nothing
points at — noted in the file so the next person does not wonder.

**One clean licence out of ten packs surveyed.** Both horse packs, both admurin
monster packs, both JDSherbert UI packs and the Echoes kit all forbid
redistribution, and this repo is public — committing them to `assets/` *is*
redistribution. That is the same deadlock that kept this repo private through
M0–M5. The rule and the workaround (gitignore the pack, ship only the generated
atlas) are written down in the queue under `_licenceRule`.

The two JDSherbert UI packs were also simply not needed: eleven and fourteen
distinct sounds, all UI blips, against thirteen we already synthesise in-browser
from five numbers each at zero download and no credit obligation.

## There is one map, and the seed does not choose it

Asked directly, and worth writing down because the answer is not what it looks
like. The seed drives everything through the `mulberry32` RNG — spawns, elite
rolls, drops, offer draws, crop scatter — and the terrain bake derives its own
stream from `seed ^ 0x7e44a1` so the ground varies without moving the sim. But
there is **one arena and one tileset**: grass, dirt and soil, scattered. Same
ground every run.

Making the seed pick a map is a real feature, not a content drop, and the
constraint that matters is that the map choice has to be the FIRST draw off the
RNG — anything later and adding a map silently changes every existing seed's
replay, which this project has a test for. Sketched under `_mapsAndTilesets` in
the generation queue, with what PixelLab can actually make for it.

## Verified

- 131 tests pass; typecheck clean on game and tools.
- Both scenes mount with every layer present: 43 in the yard, 38 in the field,
  nothing dropped to a null sprite, console clean after a reload.
- Every scene sprite measures its native size in the live DOM — silo 224x448,
  coop 128x160, well 96x64, milkcan 48x64 at 2x, fence band 1960 wide.
- Card stock computes opaque in all three states, on a `<button>`, which is what
  a card actually is.

**Not verified by eye.** The browser pane was not displayed for this session, so
no screenshot was possible. Everything above is structural and computed-style
evidence. The scenes still want a human looking at them next to
`docs/reference/`.

---

# Session 7 — audio, from two providers

## Two providers, each doing the thing it is for

Checked against both APIs rather than assumed:

- **Gemini** has Lyria 3 for music and TTS for speech, and **no sound-effects
  model**. Prompting a music model for a 90ms shotgun report gets you a short
  piece of music about a shotgun.
- **ElevenLabs** has a purpose-built text-to-sound-effects endpoint
  (`/v1/sound-generation`), which is exactly the gap.

So: **ElevenLabs for effects, Lyria for music.** `npm run audio` runs both.

## Not everything should be a recording

Twenty-six effects are generated and thirteen are still synthesised, chosen per
sound in `audio.json`. (This entry originally said nine and seven; the roster
grew and the line went stale.) **Physical** sounds — gunfire, impacts, stone, a bull scraping
dirt — are unambiguously better from a real generator. **Arcade feedback** — an
XP pickup, a level-up flourish, a UI blip — is not a real-world sound at all,
and a realistic recording of one fights the pixel art rather than serving it.
Vampire Survivors and Brotato both use synthetic blips for the same reason.

**Every effect keeps its synth spec, including the sampled ones.** The engine
prefers a decoded sample and drops to the oscillator when a file is absent, so
the game is fully audible with no API keys at all and degrades one sound at a
time rather than going silent.

## Levels, caught on measurement

Generated samples come back normalised to roughly **full scale (peak 1.0)**,
while the synth path peaks around **0.12** for the same `gain` value. Reusing
one gain for both made every sampled effect about twice as loud as its
synthesised neighbour and would clip when several overlapped. Sample playback
is scaled by `master.sampleGainScale` rather than retuning sixteen hand-set
gains.

ElevenLabs enforces a **0.5s minimum** and several of these want to be 70ms, so
the files carry trailing silence. Harmless — playback is one-shot.

## Verified

All nine decode at 44.1kHz and are audible (peaks 0.52-1.0). Sound intents
confirmed firing in a live run. Loads are claimed synchronously before the
fetch, because `play()` runs many times a second and would otherwise start a
dozen parallel fetches for the same file.

---

# Session 7 — audio

## Gemini has no sound-effects model, and that changed the design

Checked against the API docs rather than assumed: Gemini offers **Lyria 3 for
music** and **TTS for speech**, and nothing for sound effects. Prompting a music
model for a 90ms shotgun report gets you a short piece of music about a shotgun.

So the sixteen effects are **synthesised in the browser** — oscillators, a
shared noise buffer and exponential envelopes through Web Audio — and only the
three music layers come from Lyria.

That split is not a compromise. Synthesis is the better answer here: it matches
the architecture already in place (a hand-written PNG codec rather than pulling
in `sharp`), it adds no dependency and no download, every sound is five numbers
in `audio.json` you can tune without a round trip, and retro synthesis is
stylistically right for pixel art in a way a recorded sample is not.

## The pipeline

`npm run music` (in `tools/fetch-music.ts`) posts each layer's prompt to
`v1beta/interactions` with `lyria-3-clip-preview` and writes base64 audio to
`public/audio/`. Offline like the atlas — a network round trip inside a game
loop is a stutter, not a soundtrack. Needs `GEMINI_API_KEY`; exits with
instructions if it is missing, and says so explicitly if the model 404s, since
Lyria is preview-gated separately from ordinary Gemini.

**The prompts in `src/content/audio.json` are the source of truth for the
score.** Tune the prose and re-run; never hand-edit the audio.

`public/audio/` is gitignored like the atlas. **Missing music is never an
error** — the loader remembers the failure so it does not retry every wave, and
the game is simply quiet.

## Boundaries kept

The sim raises sound *intents* through `WorldEvents.onSound` and never touches
Web Audio, exactly like every other presentation concern. That is what keeps it
headless, and it is why all 90 tests still run with no audio stack at all.

Effects are rate-limited per name in `audio.json`. Two hundred enemies dying in
one frame is a normal Tuesday here, and without a limit that is two hundred
oscillators summing into clipping rather than a sound.

## Verified

Rendered `shootHeavy` through an `OfflineAudioContext` with the shipped spec:
peak 0.124, tail 0.00002 — audible, and it decays cleanly rather than clicking.
Sound intents confirmed firing in a live run (68 shots, 8 deaths, 5 hits, a crit
and a pickup over 15 seconds).

Volume and mute live on the pause screen rather than a settings screen of their
own, and persist to `localStorage`.

---

# Session 6 — the Duster, and one UI language

## The Duster

Wave 25's boss. Phase 1 is the whole idea: it drives a fixed agricultural
back-and-forth and **never chases**, so the arena fills with lanes you cannot be
in and the danger is entirely of your own making. Below half health the pattern
breaks and it comes for you slowly, still dragging its strip, while farmhands
pour out and the rows burn inward — ninety seconds to take the field to 34% of
its shorter axis, measured exactly.

**A third sprite layout.** The tractor is 192x192 frames on a 6x5 grid with ONE
BAND PER DIRECTION, where the animals pack four direction clips side by side
into one band, and its direction order is left/up/right/down against the
animals' right/up/left/down. Three sheet families, three layouts, three
direction orders. Measure every new sheet with `npm run pitch`; do not infer it
from the last one.

§9's "tractor at x3" was written assuming a 32px source. This one is drawn
~130px wide, so x3 would be nearly 400px against a 520px camera. Packed native,
drawn at x1 — still four times the player — and the heavy read comes from the
slowed frame rate instead.

## The panel language

`assets/modern-ui` had never been opened. It is the same LimeZu hand as the farm
tiles, so the screens can match the game with **no conforming at all** — the one
pack in the project that needs none.

Before this, the level-up cards had a flat 3px border, the shop had another, and
pause did not exist: four screens that happened to ship together. There is one
vocabulary now, in `style.css` under THE PANEL LANGUAGE:

- **`.panel`** — LimeZu's carved wood frame as a real CSS `border-image`, which
  is exactly the 9-slice that art was drawn for. `image-rendering: pixelated`
  keeps it on the grid at any size, so one 64x62 source dresses a shop card and
  a pause menu alike.
- **Wood is chrome, never content.** The frame is the border; the inside stays
  the dark field, so text sits on the same background on every surface.
- **Colour means one thing everywhere.** Gold is a choice you can make, grey one
  you cannot afford, red is danger.

Card rarity moved from the border colour (the frame occupies that now) to a bar
along the top edge, which reads better regardless — it survives the frame's own
colour.

`public/ui/panel.png` is generated by `npm run atlas` and gitignored like the
atlas. A missing UI pack costs the chrome and not the game: the border-image
simply does not apply and the colour underneath carries it.

## Pause

`Esc` or `P`, edge-triggered so holding it does not toggle sixty times a second.
Reachable only from play and only returns to play — a level-up or shop is
already a pause with a decision attached, and stacking a second freeze on one of
those is how you get a screen nobody can dismiss.

Verified by hit-testing the panel centre, because the last screen added to this
game was unreachable behind the HUD for a whole milestone.

---

# Session 5 — roster, elements, and the first boss

## Start-here delta

M6 is **half done**: the Prize Bull fights, the Duster does not exist. See
"What M6 still owes" below before picking it up.

## The roster

Twelve weapons rebuilt around the bought art, ranged-heavy. The twelve
behaviours are untouched — they work, they are tested, they are distinct — so
this was a reskin and a retheme, not a rewrite. Three melee were kept on
purpose: they are the only weapons that reward standing still, which is The
Hand's identity and now also how you mine, and an all-ranged roster would have
quietly deleted a class.

Tier art: merging changes the weapon. Guns step up their category, melee steps
up its material. The Pixcuit pack is **not complete per tool** — no Iron
Pitchfork, no Golden Sickle — so the four materials differ by weapon.

Renaming the weapon ids meant first removing the hardcoded id literals
(`findAttached('axe')`, `WEAPONS.eggToss`). Those resolve from the projectile's
own `weaponId` or the owning slot now, which is more correct anyway: renaming a
weapon in JSON can no longer silently break code.

## Elements

Fire, acid or frost, one at a time, converting every ranged weapon. The element
**swaps the whole bullet** rather than tinting one, which cost no new art
because the packs already ship a fireball, an acid glob and an ice spike as
separate animations. Fire ignites slop slicks — two things the player already
chose doing something neither does alone.

It needed no new damage plumbing at all: the lasting damage rides on the
`burnDps`/`bleedDps`/`slowOnHit` payload fields the tier riders already used.

## Harvesting was rewarding the wrong playstyle

Flat-rate proximity harvesting **paid the kiter more than the stander**.
Sweeping past twenty nodes at base rate beat working one, so the mechanic built
to give a stationary player something to do inverted its own intent, and The
Hand's advantage had narrowed from 13 points to 4 before the harness caught it.
Nodes now ramp to 3x over two seconds of dwell and bleed off faster than they
build.

## The boss that spawned itself

`ENEMY_IDS` was `Object.keys(ENEMIES)`, so adding the Prize Bull put it in the
wave director's roster. A boss carries `threatCost: 0` precisely so the budget
cannot refuse it — which meant the director could pick it for free, without
limit. **Every bot run died on wave one.** Bosses are excluded from the roster
now and placed explicitly by `spawnBoss`; there is a test.

Related and long-standing: `bossWaves` put the Duster on wave 25 while
`waveCount` was 24, so the run called `finishRun` the instant wave 24 completed
and wave 25 never began. **The final boss was unreachable in every build that
has ever existed.** waveCount is 25.

## What M6 still owes

1. **The Duster.** Nothing exists — no art, no behaviour. §9 wants two phases:
   a fixed agricultural back-and-forth laying gas that never chases, then below
   50% it comes for you directly while the rows burn inward and shrink the
   arena to a third. The tractor sheet is at
   `assets/modern-farm/32x32/Vehicles_32x32/Tractor_32x32.png` (1152x960) and
   its grid has NOT been measured — run `npm run pitch` on it first; the cow
   sheet turned out to be 96px pitch at row 6 while every other animal is 64 at
   row 2-4.
2. **The Bull's charge is the generic `charge` behaviour.** It winds up and
   staggers, and Stampede fires below 50%, but it does not yet damage its own
   trash in the lane or slam the fence.
3. **Audio.** Still nothing, and still no source material in `assets/` — this
   is the one milestone item blocked on something outside the repo.
4. **Pause screen.** No Escape handling anywhere.

---

# Session 4 — mining, and the assets to draw it

## Harvesting rebuilt on the Deep Rock Galactic: Survivor model

The old model was crops that broke when a stray bullet clipped them. That is
invisible chip damage the player never chooses, and it made the field scenery
rather than a place. The new one is DRG:S's: **nodes you stand next to, worked
continuously by tools that are not weapons.**

- **Three node kinds** in `src/content/nodes.json` — rock, tree, crop — with
  per-variant HP, feed and XP. The LimeZu pack ships rocks with ore already in
  them (bronze, silver, gold, blue, red), so the payout tier is legible before
  you commit to standing there, which is exactly DRG's "minerals embedded in
  the rock".
- **Proximity harvesting.** Stand in range and the tool works on its own,
  every node in reach at once. No weapon slot, no button, no stopping shooting.
- **Two tool ladders**, wood → stone → iron → steel → diamond, bought with
  `pickaxeHead` / `axeHead` upgrades through the normal offer pool.
- **Nodes pay XP as gems**, not just feed. In DRG:S mining is the primary
  early-game XP source and this is what makes that true here rather than
  decorative — ten seconds standing on one bronze seam took a level-1 player to
  level 2.
- **Mobs drop seed packs** (5%), a feed trickle that is not tied to standing
  still, so a player kited all wave still earns.

### Weapons no longer damage nodes, and that was the whole ballgame

The first build kept the old "projectiles break crops" path alongside the new
tools. It silently defeated the entire design: a shovel swing carries more
damage than a wooden pickaxe does in five seconds, so every node was broken
incidentally by whatever was shooting past it.

Measured: **0.28s to break a rock on every tool tier, wood through diamond** —
identical, because the tool was never the thing breaking it, and the upgrades
bought nothing at all. With weapons removed from nodes it reads properly:

| Pickaxe | Time to break a bronze seam |
|---|---|
| Wooden | 5.63s |
| Iron | 1.93s |
| Diamond | 0.90s |

Worth keeping as a shape: a new system layered beside an old one that does the
same job will lose to it silently, and the symptom is "the upgrade does
nothing" rather than an error.

### What the harness says, and why to read it carefully

Clear rates held (Hand 94% holding ground, Kid 100%) and median level rose from
26 to 30, so mining is contributing XP. But **the bots barely mine** — median 0
to 8 nodes in a seventeen-minute run — because they kite constantly and never
choose to stand anywhere. The brawler pilot mines four times what the kiter
does, which is the design working: standing still now pays, and that is The
Hand's identity.

Do not tune harvest rates against these numbers. They measure a bot with no
mining behaviour at all; a human who deliberately parks on a gold seam is a
different economy entirely. This needs a human playtest before any balancing.

---

# Session 3 — M4 finished, M5 content, balance, weapon visibility

## Weapons you can actually see

Playtest finding, and the correct diagnosis was the player's: *"when I get a new
weapon I don't think I'm actually getting a new weapon."* He was right, and it
was one root cause with three symptoms.

**Not one of the twelve weapon sprites was ever packed.** Every entry in
`weapons.json` carries a `sprite` field — `tool_shovel`, `crop_corn`,
`prop_bucket` — and `art/sprites.json` had never heard of any of them. So:

- Projectiles never got a frame and fell through to the coloured-square
  fallback, which is why **every ranged weapon looked identical**: same pale
  green square, sized by radius. Six weapons firing was indistinguishable from
  one.
- Melee arcs took the same path at `radius * 2`, so a shovel swing drew as a
  **~100px white box** — the loudest thing on screen, and the reason melee felt
  like the only weapon that "worked".

Fixed in three parts:

1. **Weapon sprites are packed** as `weapon.<id>`, keyed to the weapon ids.
2. **Projectiles draw their weapon's sprite**, rotated — thrown things tumble,
   fired things point where they are going, orbits spin. A projectile that never
   rotates reads as a decal sliding over grass.
3. **Melee arcs and auras stopped being objects.** They are volumes, so they
   draw as a swept wedge and a soft ring instead of a sprite or a square.

### The weapon ring

Weapons now sit spaced around the player and turn to point at what they are
shooting, Brotato-style, kicking back when they fire. The angles live on the
weapon slot in the sim (`ringAngle`, `aimAngle`, `recoil`) and the renderer only
draws them — targeting is a simulation decision and the render layer does not
get to have an opinion about it. The ring is what makes ownership, aim and rate
of fire legible at a glance, and it is the direct answer to "did I actually get
a new weapon".

### Two things worth keeping

**The pack is an environment set, not an item-icon set.** There is no axe,
watering can or fishing rod anywhere in it at 32x32. Stand-ins are used and
named honestly in `art/sprites.json` — a hacksaw blade for the axe, a milk can
for the watering can, a fishing branch for the rod. Swapping them later is a
one-block change.

**Several files named `*_Load_*` or `*_Stack_*` are multi-tile piles.**
`Bucket_Load` is 58x64 of stacked buckets and went into the ring as an
unreadable brown slab twice the player's size; nothing about it looked wrong in
the manifest, it was just a bucket that was actually nine buckets. The atlas
builder now asserts weapon icons fit one tile and fails naming the file, in the
same spirit as the 1792x704 humanoid check.

---

# Session 3 — M4 finished, M5 content, first balance pass

## The balance pass, and `npm run balance`

`tools/balance.ts` runs the whole game many times headlessly and reports what
happened: clear rate, which wave runs die on, what was on the field when they
did, where the damage came from, and which weapons the offer pool actually hands
out. `tests/run.test.ts` asks yes/no questions; this asks how and why, which is
what a balance change needs before and after.

    npm run balance -- 24 both

Read it as *relative*. The pilots are crude bots and the absolute clear rate is
not a prediction of how a person will do — but the same tool across a change
is a real measurement.

It immediately found three things, two of them bugs rather than balance.

### Standing in acid made you invulnerable

`damagePlayer` grants 0.5s of mercy invulnerability so a crowd cannot chain-hit
you to death in three frames. Wiring hazards into it in M5 meant an acid pool
ticking eight times a second handed out i-frames eight times a second. Standing
in the pool made you immune to everything else on the field, and the pool itself
landed about a quarter of the damage its JSON claimed, because most of its ticks
fell inside the mercy window it had just granted itself.

Environmental damage now neither grants i-frames nor is blocked by them, and
skips the dodge roll — you cannot sidestep a cloud you are standing in.

### The gas cloud was wider than the screen

`cloudRadius 90` + `cloudGrowth 30` over `cloudDuration 6` is a final radius of
**270**, against a camera view 520px wide. Fine while the cloud was decoration;
once it damaged you it was not a hazard you could play around, it was a tax with
no visible edge, and hazards were 44–60% of all damage taken. Growth is now 10,
landing at 150 — half the screen, still frightening, walkable-out-of.

### One elite roll was spawning a whole squad of elites

The worst of the three. The spawner rolled `chance(0.1)` **once per group** and
handed the result to every member, so one success turned a group of three to six
into three to six elites at 4x health, arriving shoulder to shoulder. §8's "one
in ten" means one in ten *enemies*. The roll moved into the per-enemy loop.

The harness had found 2.6 elites alive at the average death and wave 5 — the
first elite wave — killing more runs than any other. Afterwards: 1.2 elites at
death, and the wave 5 spike is gone.

| | before | after |
|---|---|---|
| The Hand, kiting | 71% | 79% |
| The Kid, kiting | 83% | 100% |
| hazard share of damage taken | 44–60% | 31–35% |

### The class gap was the instrument, not the game

Those numbers left The Hand at 79% and The Kid at 100%, and the parity test
started failing. The temptation was to buff The Hand. That would have been
wrong: **the bot only kites**, which is precisely The Kid's kit — fast, damage
scaling with velocity — and precisely the opposite of The Hand's, which buys
damage reduction by standing still and has an ability that roots it. A
kiting-only harness reports The Hand as weaker no matter what the game does.

Adding a `brawler` pilot that holds ground while healthy settled it:

| | kiting | holding ground |
|---|---|---|
| The Hand | 79% | **92%** |
| The Kid | **100%** | 83% |

Each class is strong at its own game and weak at the other's, which is the
design working. The Hand's wave-5 deaths vanish entirely when it is allowed to
stand still. Nothing was tuned; `run.test.ts` now flies each class the way it is
built to be played, and a new test asserts the cross-over above, so if the two
classes ever stop being different the parity numbers stop lying about it.

**The lesson worth keeping:** twice in this session a measurement was wrong
before the game was — the tier probe that rewarded not killing, and the parity
test that measured The Kid twice. Check what the instrument is actually asking
before tuning anything to satisfy it.

### Still open

- The Kid clears 100% of 24 seeds kiting. The bot kites perfectly and a human
  will not, but that is the number to watch if the game feels soft.
- Deaths that remain cluster on waves 10 and 15 — elite waves, now with a
  sensible number of elites on them.
- Crop yield differs a lot by stance: a kiting Kid harvests ~38 a run against a
  standing Hand's ~19, because it covers more ground. Feed income therefore
  favours the runner. Probably fine, possibly worth a look.


## Conforming the FX pack

`tools/conform-fx.ts` extracts 32 colours from the LimeZu sheets by seeded
k-means in Oklab and writes `art/palette.json`; `build-atlas.ts` imports the
quantiser and conforms every FX frame as it packs. There is deliberately no
directory of conformed PNGs on disk — one generated artefact is enough to keep
track of.

**The pack's real geometry, since the spec does not give it and the inspect tool
mis-reports it:** each sheet is **64×64 cells**, columns are animation frames,
and the nine **rows are colour variants of the same animation** (0 orange,
1 magenta, 2 cyan, 3 green, 4 tan, 5 white, 6 mauve, 7 red, 8 blue).
`tools/inspect-sheet.ts` assumes 32px cells and will tell you a sheet is 26×18.
Eight clips are packed, named semantically in `art/sprites.json`; the other 172
files are never looked at again.

### The conform looked wrong, and it was the palette, not the metric

First attempt sampled terrain, crops and animals. The resulting 32 had **no
saturated red between hue 20° and 40° and no light green at all**, so the
explosion's `#d64f5a` body landed on the strawberry crimson `#cf2266` — the only
saturated thing anywhere near that hue — and the gas cloud's bright `#cbf17a`
highlight, which is most of its area, landed on cream. Two effects came out
magenta and olive.

The instinct was to blame nearest-in-Oklab and weight the distance. That was
worth doing and is still in (matching runs in Oklch with hue and chroma charged
above lightness, because a muted palette forces every saturated pixel to lose
chroma somewhere and unweighted matching pays that bill by rotating hue). But it
barely moved these two, and the diagnostic — dumping each clip's dominant
colours with their nearest three palette entries — showed why: **there was
nowhere right to send them.** Sampling `0_Complete_Tileset_32x32.png`, the whole
pack on one sheet, fixed both outright.

Worth remembering as a shape: when a quantiser picks badly, check the palette
covers the region before tuning how you measure distance.

### Effects never touch the sim's RNG

`playFx` takes no RNG and the rate limits are fractional accumulators, not rolls.
A cosmetic decision that consumed `world.rng` would mean the number of sparks
drawn moved every later enemy spawn, and the seed-replay guarantee would be
hostage to the art. There is a test for it.

## M5 — the riders, and four bugs behind them

Every rider named in `weapons.json` now fires, and the magnitudes are all JSON.
Getting there needed infrastructure that did not exist: burn, bleed,
vulnerability marks and slows on enemies, a rider payload on the projectile
applied by `applyHit`, plus `shrinkHazards`, the melon rind, ranked target
search, lure detonation and shard bounces.

**Four things were not missing features but broken code:**

1. **The axe dealt zero damage in every run ever played.** Orbiting blades
   stamped their hits with a constant `-1`, and `spawnEnemy` initialises `e.t1`
   to `-1`, so the "this stamp already hit this enemy" guard was true before the
   blade touched anything. It is sold in the shop. Stamps now come from the tick
   and re-arm on an interval.
2. **The watering can's slow was a no-op.** It wrote the percentage into
   projectile scratch, which was read by `e.stun = Math.max(e.stun, 0)`.
3. **`applyHit` damaged before it applied statuses**, so a killing chili shot
   never lit what it killed and T3 "burn spreads on death" could not fire at
   all. Statuses land first now; a mark should also benefit the hit that applies
   it.
4. **Barn Dog T2 multiplied velocity by 1.5 every tick** it ran, which compounds
   without bound. Speed is a target the dog steers toward now.

Acid pools and gas clouds damage the player, which is what the acid zombie is
*for*; they spawned, rendered and were harmless. Making them lethal made hazard
readability a fairness requirement rather than polish, so harmful hazards now
read in a different colour family from yours, carry a bright rim, and pulse —
movement in the periphery is what you notice with two hundred enemies on screen,
and it is reserved for the things that hurt.

### The axe's orbit, and measuring weapons honestly

Fixing the stamp bug exposed a second problem: at the design's 74px the blade
sweeps a ring enemies are never in. Chasers press to about 25px, and a blade
orbiting at 74 passes 49px clear of them. The axe worked only at a sprint.

The orbit now interpolates between a 42px floor and the design's 74 on
`velocityFraction`, so it tightens as you slow. This keeps the wide sweep the
design drew for a moving player, makes the axe a real pick for The Hand, and
reads in play — the blades visibly draw in when you plant your feet. T2's
"+25% radius" scales only the wide end: the floor is geometry, not a tunable,
and scaling it pushed a T2 axe back out of contact and made the rider worse than
no rider.

**The measurement mattered as much as the fix.** The first probe topped a ring of
enemies back up as they died, which measures throughput *and* how long
replacements take to walk in — and those pull against each other, so a stronger
tier clears faster, stands idle, and scores lower. It reported a T2 axe as worse
than T1. The tier test now holds the dummies at 1e9 hp and measures output
alone. Any future weapon comparison should use that rig and not the other one.

---

---

# Session 2 — playtest fixes, M4 art pipeline

## The shop freeze

The reported freeze at the first shop was not a time limit and not the sim
hanging. The HUD is a full-viewport overlay created *after* the screens, so it
painted on top of them, and `#ui > * { pointer-events: auto }` beat
`.hud { pointer-events: none }` on ID specificity. Every click on a shop or
level-up card landed on the HUD. The sim was paused with no reachable way out,
so **the first shop of every run was terminal**. Layers now opt in individually.

Confirmed by hit-testing the card's centre before and after: `elementFromPoint`
returned `.hud`, now returns the card, and a full buy → close → resume cycle
works.

Also fixed: the shop subtitle named the wrong wave, because `onWaveComplete`
fired before the wave counter advanced.

## Balance changes

**Enemy speeds up, slow end hardest.** Chasing shamblers was the dead time, so
the floor moved more than the ceiling: farmhand 65→82, acid zombie 70→88,
bloated 75→90, hauler 50→66, sheep 45→60, hog 60→84 (charge 220→260), dog
110→132, sprayer 85→100, rooster 145→160, duck 170→185.

The first pass overshot at 92 for farmhands. That left The Hand a 36 px/s margin
at its 128 px/s and **it cleared 1 seed in 6 while The Kid cleared 6 of 6** — a
class-balance break, not a difficulty one. Softened to 82 and the two classes are
back to succeeding and failing on the same seeds. The run acceptance test now
surveys six seeds instead of pinning one, and asserts class parity directly, so
that gap cannot silently reopen.

**Damage scaling.** Nothing in the pool touched `damagePct`, and `meleePct` and
`rangedPct` were in the damage formula with no source at all — weapon merging
was the only way to scale damage. Added Whetstone (+10% damage), Hay Hook (+18%
melee), Sling Bands (+18% ranged), Kerosene Can (+25% damage, −15 max HP).

**Rarity** is now declared in `items.json` rather than inferred from shape.

## The level-up screen

Four cards: **exactly one uncommon-or-better at double magnitude**, the rest
common at normal. The boosted slot is shuffled into position so it has to be
read for rather than learned.

Doubling is level-up only. The shop is where you pay to get exactly what you
need; doubling there too would flatten the difference between the two systems
that §3 is built on.

A boosted item is pushed into the resolver **twice** rather than scaled, so stat
resolution stays a pure additive sum and nothing multiplies. A boosted weapon
merge jumps two tiers.

## Harvestable crops

46 crops scattered from ten real crop sprites, broken by any weapon, paying feed,
regrowing five a wave so the field is never permanently stripped. HP scales with
the wave. They y-sort with everything else, so the player walks in front of and
behind them.

This is the Brotato-style economy the design did not have: it gives a player
with spare seconds something to do with them, and turns "the wave is thin right
now" into a decision rather than dead time.

## M4 — art pipeline

**`tools/png.ts`** — a minimal PNG codec on Node's built-in zlib. Written rather
than pulled in because the design caps dependencies at three, and adding `sharp`
(a native binary) or `pngjs` to slice sprites offline is not worth the budget.
Handles 8-bit greyscale, RGB, palette and RGBA, non-interlaced — everything the
packs actually use.

**`tools/build-atlas.ts`** — slices every source named in `art/sprites.json`,
trims each frame to content bounds, records a bottom-centre pivot, and packs one
`public/atlas.png` + `atlas.json` with 2px bleed. The game never reads `assets/`
at runtime, which is also what keeps the licensed art out of a deployed build.

**The 1792×704 assertion is in** and is the point of the file. A wrong-sized
sheet fails the build naming the file.

**`tools/inspect-sheet.ts`** — reports the frame grid of any sheet. This is how
the rigs were derived rather than guessed, and it should be run on every new
generator export.

### What the rigs actually are

The design says all thirteen character sheets share one rig, and they do — but
not the one the doc implies. They are 56×22 cells of 32px, and **a character is
32×64 spanning a stacked row pair**: the even row holds the upper half, the odd
row the lower. That gives 11 clips at 4/24/24/36/36/56/40/36/24/8/36 frames,
which matches the pack's own `_36_frames` / `_56_frames` file naming. Only idle
(4) and walk (24 = 4 directions × 6) are packed; slicing all 22 rows for 13
characters would spend most of the atlas on animations nobody sees.

**The animal sheets do not share a rig.** Each species differs, and this is worth
knowing before anyone plans content around "animals are free":

| Species | Sprite | Walk row | Frames/direction |
|---|---|---|---|
| Rooster | 32×32, single row | 3 | 6 |
| Feral dog | 32×64, row pair | 4 | 12 |
| Duck | 32×64, row pair | 2 | 12 |
| Sheep | 32×64, row pair | 2 | 12 |
| Pig | 32×64, row pair | 2 | 12 |

`atlas.json` emits per-sheet clip lengths, because a renderer assuming one number
animates a rooster at half speed. Animals ship no idle clip, so walk frame 0 is
packed again under an idle key.

### The animal sheets fought back

First pass produced 10×50 "plank" enemies for the up and right facings. The
cause is not a slicing bug: on the two-row animal sheets the front and back
clips are drawn at proportions that do not match the side views — a rear-view
pig measures **16×52 against a 28×32 side view** — and there is no 32px grid
alignment that makes both read correctly.

Rather than ship visibly broken sprites, only the two **side** clips are packed,
and up/down alias onto them. Every animal now reads correctly at every facing;
it simply does not turn to face the camera, which at this sprite size is close to
unnoticeable. `sideCols` in `art/sprites.json` carries the column offsets, and
the rooster (a single-row sheet whose four directions are all well-formed) still
uses all four via `allDirections`.

**Worth revisiting** with fresh eyes: the front/back clips are real art that is
currently unused, and understanding their layout would give the animals proper
facing. `tools/inspect-sheet.ts` and a scaled dump are how to approach it.

Also added `dominantBandBounds` to the PNG helpers — takes the tallest
*contiguous* band of occupied rows rather than raw bounds, so a frame window
that catches a slice of a neighbouring clip discards it. A no-op for
well-formed sprites; cheap insurance for the next sheet.

### Renderer

446 frames, 1024×1024, 85KB. Draws at **2× integer zoom** — a 32px sprite at
1080p is otherwise about a fingernail, and non-integer scaling breaks the pixel
grid. Walk frames advance by **distance travelled**, not time, so sprites never
skate. Terrain bakes once from real tiles.

Hit flash uses a white silhouette copy of the atlas rendered once at load, so it
costs one `drawImage` from a different source rather than a per-sprite
`save`/`globalCompositeOperation`/`restore` — at 800 enemies that is the frame
budget.

Anything the atlas has no art for still draws as a coloured square with bob and
lean, so a missing sheet costs the art and not the game.

## Dependency added

`@types/node`, dev-only and types-only, zero runtime bytes, so the build tools
typecheck. Tools have their own `tsconfig` since they need node globals and `.ts`
import extensions the game's config should not allow. Recorded here because
CLAUDE.md requires a written reason.

## Still not done in M4

- **`tools/conform-fx.ts` and `art/palette.json`.** The FX pack is untouched and
  unused. The design is emphatic that dropping it in unconformed is the single
  most likely way this ends up looking assembled rather than made — so nothing
  uses it yet rather than using it raw.
- **Boss art.** The Prize Bull (cow ×2) and Duster (tractor ×3) are M6.
- **Props, fences, pickups.** XP gems and feed are still coloured squares. They
  read fine as abstract game objects, but the pack has real sprites for them.
- **Palette-index recolour** for enemy variants (§10 step 4).

## Open questions, updated

1. **Base move speed is 160 px/s** and every enemy speed is now tuned against it.
   Still the most consequential invented number in the project.
2. **Direction order** is assumed to be down/up/left/right. Down and up are
   confirmed by eye; left and right are a coin-flip that looks right at 32px and
   would be a one-line fix in `art/sprites.json` if they are swapped.
3. **Crop density (46) and feed value (2)** are guesses. If harvesting is better
   than fighting, the value is too high.
4. Everything in the previous session's list below still stands.

---

# Session 1 — M0 through M3

## What was built

**M0 — Skeleton.** Vite + TypeScript, pixel-perfect canvas sizing at device DPR,
fixed 1/60s loop with accumulator and render interpolation, keyboard + gamepad
input, follow camera with dead zone and lead, dev overlay, Pages workflow.

**M1 — Combat core.** Fixed-capacity pools with swap-pop, 64px spatial hash
(counting-sort layout, zero per-query allocation), enemy steering with
separation, auto-firing weapons, the §5 damage pipeline, deaths and drops, hit
flash, damage numbers, trauma screenshake, hitstop on crits only.

**M2 — Progression.** XP gems with the accelerating magnet, level-up card screen
with written-out stat deltas, the single-pass stat resolver, all 12 passives.

**M3 — Wave and shop loop.** Spawn director on the threat budget with the
pressure ceiling, 24 continuous waves, feed economy with interest, shop at
5/10/15/20/24 with escalating reroll and per-card lock, six weapon slots with
tier merging, results screen.

## Performance, measured

Chrome at 1920×1080, driving sim and renderer directly (the browser pane was not
compositing, so these exclude presentation — rAF frame time was not measurable in
that environment and should be confirmed by eye).

| Load | Sim/step | Draw/frame | Total | Budget |
|---|---|---|---|---|
| ~450 enemies | 0.12ms | 0.19ms | **0.31ms** | 16.6ms |
| 800 (pool cap), 6 weapons, 1482 draw calls | 0.32ms | 0.39ms | **0.71ms** | 16.6ms |
| same, worst single frame | 5.6ms | 2.7ms | **8.3ms** | 16.6ms |

M1's "500 enemies holds 60fps" passes with roughly 20× headroom on average.

## The bark recursion

Feral dogs bark to summon a second pack (§8). Every summoned dog also barked, so
each pack summoned a pack: **4ⁿ growth that saturated the 800-enemy pool inside
18 seconds of wave 4** and ended every run there. Barks also bypassed the
pressure ceiling, which was enforced inside the spawner while the bark path went
around it.

Fixed both ways: bark-summoned dogs are marked as having already barked, and
barks check the ceiling and a 6-second global interval. That interval
(`BARK_INTERVAL` in `world.ts`) is the one number in code rather than JSON — it
is a recursion guard, not balance.

Invisible while playing, obvious the moment a bot ran the whole 17 minutes.

## Deviations from the spec

**1. Added `src/content/tuning.json`** for engine-level constants the design did
not specify — base move speed, pickup radius, camera lerp, knockback decay, pool
sizes, i-frames. The design's own five JSON files are byte-identical to delivery
apart from the balance changes noted in session 2.

**2. Built all 12 weapons and all 6 enemy behaviours at base fidelity**, ahead of
M5, because M3's shop draws from the full pool and a shop offering a weapon that
does nothing would have made the milestone untestable. The named tier riders (T3
shovel hitting twice, chili burn spreading on death) are still M5 — **the cards
currently describe riders that do not fire yet**.

**3. Enemy on-death specials are half-wired.** Acid pools and gas clouds spawn as
hazards and render, but only damage enemies, not the player. Player-facing hazard
damage, gas readability and Wet Rag's grace window are M5.

**4. `ASSET_MAP.md` paths are stale.** The sheets were normalised to
lowercase-hyphen names in subfolders before the handoff arrived, so
`assets/generated/farmer.png` is now
`assets/generated/characters/farmer-01.png`. Full mapping in
`assets/generated/README.md`. The atlas manifest uses the real paths.

Related: the map lists `Gas zombie.png` as an excluded 16×16 export. No such file
exists in the repo. All 12 committed sheets are 1792×704.

**5. GitHub Pages will not deploy from a private repo on a free plan.** The
workflow builds, typechecks and tests correctly, but the deploy step needs a paid
plan, and the repo must stay private. M0's "on a live URL" is unmet unless the
plan changes or the build is hosted privately elsewhere.

## Design decisions still open

1. **There is no damage-percentage item** — addressed in session 2, but the
   original design intent (merging *is* the offensive game) was deliberate and
   the new items may undercut it.
2. **The shop can thin out late** when all six slots are full and every weapon is
   maxed; those offers are filtered, so late shops trend toward items only.
3. **Elites are spawn-time only.** §8 says one in ten on every fifth wave,
   implemented as written, which means an elite can spawn into a wave the player
   skips past.
4. **Hitstop is global.** 40ms on a crit freezes the whole sim. At +200% attack
   speed with several crit sources this may need a floor.

## The weapon range, and why the bullets all looked the same

Playtest: *"all the bullets looked the same, new weapons didn't appear to equip
or shoot any kind of novel round."* True, and not for the reason I assumed.

**They were not identical. They were too small to tell apart.** The projectile
packs ship every type in two sizes, and only the SMALL size was packed — 16-20px
clips, drawn at the renderer's 0.55 projectile scale, so a bullet reached the
screen about 10 world pixels wide next to a character 64 pixels tall. Six
different silhouettes at 10px on grass are one grey smudge. Colour cannot carry
identity at that size; only shape can, and there was no room for shape.

Fixed by packing the LARGE size for six signature rounds, one silhouette per
weapon — burst, dart, shell, missile, glob, harpoon head — and adding a
per-weapon `projectileScale` in `weapons.json`, because a 89x64 mortar shell and
a 40x40 pellet burst cannot share one number. Scales were computed from the
actual trimmed atlas frames against a target size in world pixels, not guessed.

`npm run range` is the new tool, and it is the point of this entry:

| mode | what it shows |
|---|---|
| `--mode solo` | every weapon firing, one labelled tile each, plus a distinctness report |
| `--mode stack` | 1-6 weapons at once, to check the ring |
| `--mode element` | one loadout under each element |
| `--mode rounds` | the rounds themselves at true size on grass, elements across |

`--mode rounds` is the one that settled it. Judging a bullet off a gameplay tile
is guesswork — it is 30 pixels of a 520 pixel frame, half the time behind an
enemy. Lined up at true scale on the background they are always seen against,
"can you tell these apart" answers itself in a second.

### The instrument was wrong first. Again. Twice.

This makes six times, and both instances were in the tool built to check the
game:

1. **God mode killed the player.** The range set `player.hp = player.maxHp` to
   keep a slow weapon alive long enough to fire. There is no `player.maxHp` —
   max HP is `player.stats.maxHp`. So hp became `undefined`, `alive()` went
   false, `world.over` latched on tick one, and every later `step()` returned
   immediately. The tool photographed a frozen world and reported, confidently,
   that four weapons draw nothing at all.
2. **"Visible" was defined as "is a projectile".** With that fixed, the Sledge
   and the Bait Drum still reported nothing. A slam is a shockwave effect and a
   bait drum is a ground hazard; neither has ever been a projectile, and the
   headless painter did not draw hazards at all. The weapons were fine. The
   definition was too narrow, and the painter had a hole in it.

Both would have read as game bugs. Neither was. The habit that catches this is
cheap: when a tool reports something surprising, check the tool before the game.

### Also fixed here

- **A design note crashed the offer pool.** `_projectileNote` added to
  `weapons.json` went straight into `WEAPON_IDS`, and the offer pool read
  `.tiers` off a bare string. This is the second time an `_`-prefixed note has
  done this. `_`-keys are now stripped once at the content boundary in
  `defsOf()`, so it cannot happen a third time.
- **Elements carried a dead `clip` field** from when they replaced a weapon's
  round instead of recolouring it, and `elements.json` still documented the
  replaced behaviour. Both removed; a test now fails if `clip` comes back.
- **The harpoon went through three rounds before landing.** A magic spike
  trimmed down to something that read as an eye. A helix beam read correctly as
  a cable, but its saturated colours do not survive the LimeZu palette conform —
  fire came back blue and frost magenta. A kunai blade conforms like the other
  five and actually looks like a harpoon head.
- `tools/draw-world.ts` now holds the headless painter, shared by the screenshot
  tool and the range, instead of a second and third copy of the renderer's frame
  rules. `tools/tinyfont.ts` is a 3x5 bitmap font so contact sheets can be
  labelled — an unlabelled twelve-tile sheet is a puzzle, not a report.

`tests/content.test.ts` is new and guards the complaint directly: no two
launching weapons may share a round, every one must have a round, every round
must be scaled above the smudge threshold, and every weapon and item must have a
one-sentence blurb. 96 tests pass.

## The real reason the bullets looked the same: the game was zoomed out

The previous entry made six distinct rounds and proved it with a contact sheet.
The player looked at the game and said they still could not tell them apart, and
that fire and acid changed nothing. Both true. The art was fine; the camera was
not.

**`ZOOM` was a fixed `2`, and the canvas is sized `innerWidth * devicePixelRatio`.**
So screen size and DPI controlled *how much world you see*. At 1920x1080 with
dpr 1.5 the canvas is 2880x1620 and the view was **1440x810 world pixels** of a
2400x1600 arena — well over half the field at once. The farmer was about 2% of
screen width. A 24-pixel round at that scale is three or four screen pixels. No
amount of silhouette work survives that, and an element recolouring a four-pixel
smudge is genuinely invisible.

A denser display was making the game *zoom out*, which is backwards: DPI should
buy sharpness at the same world scale. Zoom is now derived —
`round(canvasHeight / targetWorldHeight)`, integer, clamped — against a
`targetWorldHeight` of 340 in `tuning.json`. The visible world is now ~324-384
pixels tall on every screen tested, from a 1366x768 laptop to 4K at dpr 2. On
the reporter's likely setup that is **2.2x tighter than before**.

`tests/content.test.ts` asserts the visible world height stays within ±30% of
target across eight plausible canvas heights, and that zoom is always an integer.

### Walking right drew the front-facing sprite

Reported in the same message, and it had been wrong since M0.

`humanoidRig.directions` is `[down, up, left, right]`, and the builder used the
*index into that list* as the index of the band on the sheet. The sheet does not
use that order. Proved rather than guessed:

- band 0 is a **pixel-exact horizontal mirror** of band 2 (100% match), so those
  two are the side views;
- the skin centroid sits **+2px** in band 0 and **-2px** in band 2, and a face is
  at the front of a profile, so band 0 faces right and band 2 faces left;
- band 1 has **no skin pixels at all** (back of the head) and band 3 has the most
  (front, two eyes).

The true order is `[right, up, left, down]` — which is exactly the
`directionOrder` the *animal* sheets were already corrected to. The humanoid rig
never was. So `up` and `left` were right by luck, `down` drew the right-facing
pose, and `right` drew the front-facing one. Fixed by giving the humanoid rig a
`directionOrder` and having the builder map canonical direction → source band
through it, the way the animal path already did.

**The build now refuses a wrong order.** A bad band order has no symptom a build
can otherwise see: every frame is present, every frame is non-empty, and the
game renders a confident, wrong sprite. The new assertion is geometric — left
flipped must match right (>45%), and up must *not* match down. A correct order
measures 61-100% across the seven sheets; a wrong one measures 10-12%. The gap
is so wide the threshold barely matters.

### The range tile was lying about size, in both directions

First the tile was 260x180 world pixels at zoom 2 — a much tighter crop than the
game's view, so every round looked bigger than a player ever sees it. Then it was
604x340 at zoom 1, which understated by 3x. What actually decides whether two
bullets are tellable apart is **screen pixels per world pixel**, not how much
world is in frame. The tile now uses the game's own zoom (3, a 1080p screen) and
crops the view to fit twelve to a page. `WorldPainter` takes a zoom argument for
exactly this reason.

That is now seven times the instrument was wrong before the game was. It is the
single most reliable failure mode in this project.

### Elements now change the impact, not just the bullet

"Adding fire or acid changed nothing" was half about the round and half about
the hit. Fire swapped to a bigger impact clip; **Acid and Frost both left the
same orange spark**, so two of the three elements changed nothing at the moment
of contact — which is the moment you are actually looking at. Both impact clips
are now packed in all three element colours and picked via `World.elementalFx`.
Renderer and headless painter both fall back to the base clip if a variant is
missing, because drawing nothing is a worse failure than drawing the wrong
colour.

## Zoom, corrected: 560, not 340

The 340 target was too tight in play — "the zoom is way too much, it was
fine/ideal before". Rendering the same moment at both candidates with
`npm run zoom` made the call easy: at zoom 2 the pellet burst and the dart still
read clearly, because what fixed legibility was **packing bigger art, not
cropping the field**, and zoom 2 keeps the warning time to see a horde coming.

`targetWorldHeight` is now **560**, which lands on ~540 world pixels tall on
every screen from 1080p to 4K. That is the same view a 1080p dpr-1 screen always
had — the framing that was already right, now independent of monitor and DPI. On
a 1620px canvas it is 540 where it used to be 810.

`npm run zoom -- [canvasHeight] [targets]` renders one moment at several targets
at real pixel density. Zoom is the one setting that cannot be judged from a
number.

## The white square was the Scythe

Reported as "the melee hitbox being this white square". It was not a hitbox and
not a debug overlay: `projectileFrame` fell back to `atlas.get('weapon.<id>')`,
which does not exist for any weapon whose art is per-tier. The Scythe's orbiting
blade therefore missed, fell through to the coloured-square fallback, and drew a
large cream rectangle rotating on the spot for the whole of M5-M7. The pitchfork
had a related problem: a swept arc with no art drew as a flat tinted wedge,
which is also a large pale shape.

Melee now gets real art, per weapon, the way ranged does:

| weapon | draws |
|---|---|
| Scythe (orbit) | a dark crescent blade, spinning |
| Pitchfork (swing) | a raking claw, stretched to the swing radius |
| Sledge (slam) | the shockwave it already had |

`swingClip` is the new field for the swept kind — scaled to `radius * 2` rather
than by a per-weapon multiplier, so the picture IS the hit area and +range
visibly widens the sweep. And the projectile fallback now asks for the weapon's
declared `sprite` before giving up, so no weapon can render as a bare rectangle
again.

Note for whoever picks this up: `proj.claw` was red first and the LimeZu palette
conform fringed it magenta. Orange survives. Saturated effect colours are the
ones that lose in the conform — the helix beam did the same thing.

## M7 — The Homestead

Meta progression, per §4. A run pays acres; four buildings spend them.

`src/sim/save.ts` is a versioned localStorage blob that stores **purchases,
never derived values**. What a rank of grain is worth is a number in
`meta.json` that will change; what the player bought will not. `load()`
migrates, validates and clamps, and a corrupt blob yields a fresh save rather
than an exception — losing progress is bad, but a save that throws on boot
means the game will not start at all, which is worse and unrecoverable without
devtools. Migration is a chain of single-version steps so a v1 and a v4 save
take the same path and there is only ever one place to add the next one.

`src/sim/meta.ts` turns purchases into run modifiers at run start and nowhere
else. Three tracks make the game wider, one makes it easier and is capped:

| Track | State |
|---|---|
| **Seed Catalog** | Done. Runs start with 8 of 12 weapons and 12 of 20 items; the rest unlock permanently into `OfferPool.setUnlocked`. |
| **Feed Store** | Done. Five tracks, five ranks, flat per rank, total percentage effect capped near +25% and tested against it. |
| **County Fair** | Done. Tiers scale enemy HP by a flat multiplier on top of the wave curve — Tier 3 is "everything has 50% more HP", not a different curve — and multiply the payout so climbing beats farming. |
| **Bunkhouse** | Structure done, **content blocked**. See below. |

### Two things that are deliberately not finished

**The Bunkhouse had nothing to sell** — now fixed, see "Characters are
generated now" below.

**Seventeen of twenty-two items had no card art** — now fixed, see below.

### Acres

`bankRun` pays `2*waves + 25*bosses`, plus a first-clear bonus, times the tier
multiplier. `tiersPaid` exists because deriving "first time" from `tierCleared`
re-paid the bonus on every later clear of that tier — free acres forever, silent,
and banked into the save. There is a test for exactly that.

The results screen is handed the acres that were *banked* rather than
recomputing them. Two independent calculations of the same number drift, and the
one the player reads has to be the one they were paid.

`window.rdf` (dev builds only) now exposes `profile` and `openHomestead` as
getters. Getters, not values: a plain object captures whatever the module locals
held at construction, and every later `startRun` leaves the console holding a
dead world, which reads as "the game is broken" rather than "the handle is
stale". That cost twenty minutes the first time.

115 tests pass.

### Every item has card art now

`items.json` carried an `icon` field holding plain words — `clover`, `coffee`,
`hat` — which were never atlas keys. Only five items had a real `cardSprite`, so
seventeen rendered as text-only cards in the shop, the level-up screen and the
Homestead alike. Invisible for two milestones because a missing sprite degrades
to nothing rather than erroring, which is the same reason the Scythe's white
square survived: **the fallbacks in this renderer are all quiet, so absent art
never announces itself.**

Most items borrow a frame that was already packed — the thing an item is about
is usually already drawn somewhere. Barbed Wire takes the silver ore, the
Rooster Alarm takes an actual rooster, the Silo Key takes gold ore. Four needed
real icons and came from the pack's 32x32 icon set.

`tests/content.test.ts` now reads the built `atlas.json` and fails if any item
or weapon points at a sprite that is not in it. It checks the art and the
content against each other rather than checking that a string is non-empty,
which is the only version of this test that would have caught the original bug.

## Characters are generated now

The Bunkhouse was blocked on art: the design treats "one Farmer Generator
export" as a manual step, so adding a class meant leaving the codebase, opening
a generator and exporting a PNG by hand. That is why the ladder shipped built,
priced, and with no rungs.

It did not have to be manual. **Every piece under `Farmer_Generator_Pieces/` is
a full 1792x704 sheet in the same rig the atlas builder already reads** — 9
bodies, 13 outfits, 45 hairstyles, 5 eyes, 8 accessories. A character is those
layers alpha-composited in order: skin, eyes, clothes, hair, hat. Any other
order puts a hat under a fringe.

`npm run characters` reads `art/characters.json` and writes
`assets/generated/characters/<id>.png`. **A new class is now five strings**, and
the art is reproducible and diffable like the rest of the content. It runs
automatically as the first step of `npm run atlas`, so a recipe change cannot
leave a stale sheet packed. The two original farmers are deliberately NOT listed
— regenerating them would overwrite art that already ships.

Four classes added, all playable, priced at the spec's 40/90/150/240:

| Class | Shape | Starts with |
|---|---|---|
| **The Widow** | Tanky, regenerating, low crit | Varmint Rifle |
| **The Veteran** | Balanced, crit-leaning | Drum Gun |
| **The Agronomist** | Harvest and luck, fragile | Chem Sprayer |
| **The Drifter** | Fastest, dodgy, highest crit damage | Harpoon Gun |

All six classes were run headlessly to wave 2 to confirm none of them dies to
its own stat block. The Agronomist kills noticeably slower than the rest — the
Chem Sprayer is an aura and ramps late — which is worth a balance look but is
not broken.

### The one compromise, stated plainly

The four share the two *implemented* ability archetypes — `digIn` and `bolt` —
retuned per class, rather than each getting a bespoke one. Abilities dispatch on
`a.id` in `world.ts` and `player.ts`, so an unimplemented id gives the player a
button that silently does nothing. A class with a borrowed ability is fully
playable; a class with a dead button is worse than no class. Bespoke abilities
are follow-up work and the dispatch is where they go.
