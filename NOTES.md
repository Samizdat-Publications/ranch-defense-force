# Notes

The live handoff for v2. Short on purpose: what exists, how it fits together,
what is open. The plan and the decisions log are in [docs/V2.md](docs/V2.md).
v1's 5,700-line log is archived at
[docs/archive/v1/NOTES-v1.md](docs/archive/v1/NOTES-v1.md); it is still the
best record of WHY the sim and the content are shaped the way they are, and
of every sim bug that cost time.

## Where things are (2026-09-26)

Branch `v2`. `main` is still v1 and is what GitHub Pages serves; do not merge
`v2` into `main` until the owner has looked at it (pushing `main` deploys).
The v1 state is tagged `v1-final`.

| Area | State |
|---|---|
| Renderer | WebGL2, done. `src/render/gl/*` + `src/render/gl-renderer.ts`. The v1 Canvas 2D renderer stays as the fallback on a browser without WebGL2 (and `?r=2d`). 400 enemies at night at 1080p: ~1 ms of renderer CPU per frame. |
| Light and time | Done. `src/render/daylight.ts`, curve in `tuning.json` -> `daylight`. |
| The place | Every surface map has a `place` block: the Home Field by hand, the Salt Flats, Scrapyard, Burn, Bone Orchard and Bottoms by an agent working from it. |
| HUD | Rebuilt: `src/ui/hud.ts`, `hud.css`. |
| Title | Rebuilt as a live diorama: `src/ui/title.ts`, `title.css`, `src/render/diorama.ts`. `menu.ts` is deleted. `scene.ts` and `home*.css` remain: the class-card CSS lives in `home-ui.css`, and the Homestead's painted barn is its fallback without WebGL2. |
| Homestead | Stands over the diorama in its `homestead` framing; signs show prices. `src/ui/homestead.ts` `useLiveScene`. |
| Ambience | Synthesised birds, wind, crickets, owl, thunder: `src/core/ambience.ts`. |
| Sim | Rebalanced for a horde (docs/V2.md D16-D20): off-screen spawn ring, a `horde` block in waves.json, seed merging, a boss every third wave, the Duster as a flying plane. The replay and bot tests still describe it, re-measured. |

## How the renderer works, in one screen

- The world draws into a target at ART resolution (1 art px = 1 texel), 450
  texels tall (`tuning.render.viewHeight`; 540 until critic round 4, when four
  reviewers in a row could not read a fight drawn 40 px tall), and the composite scales it to the
  canvas with a sharp-bilinear filter, applying the camera's sub-pixel part so
  motion is smooth. The diorama shoots at 380 for a closer camera.
- Four buffers: colour (its ALPHA is "a standing sprite covers this pixel",
  so sun shadow falls only on the ground), emissive (glows, feeds the bloom),
  light (additive point and cone lights, float if available), shadow (R = sun
  blocked, G = contact shadow). `gl/device.ts` has the composite.
- Sprites: one instanced batch (`gl/sprites.ts`), texelFetch from a
  TEXTURE_2D_ARRAY atlas, 1 px outline, partial hit flash, emissive, and a
  shadow mode that projects the same instances along the sun from their feet.
  A negative emissive means "only the eyes glow" (bright yellow/red pixels),
  used on enemies at night. A negative tint alpha draws the outline alone
  (the player's outline over crowds).
- Ground: `gl/ground.ts`, per pixel, from ten seamless tiles picked in the
  map's `place.ground`, a quarter-res layout mask from `render/place.ts`, and
  value noise. Blight creeps in from the fences with run progress.
- Hazards: `gl/hazards.ts`, per pixel puddles and clouds by kind.
- Everything in the day comes from `evaluateDay(t)`; `?tod=0.8` pins it for
  a look. Lightning and rain are pure functions of time in `daylight.ts` so
  the thunder (ambience) and the flash (renderer) agree without talking.

## What the critic rounds changed (2026-09-26)

Scores 4 (v1), then 5, 6, 5, 5, 6, 5, 5, 5, 5 across nine rounds of fresh
reviewers: the menus settled at near-commercial early and the in-run frames
climbed from a flat field to a place. Each row in docs/V2.md. The fixes that
mattered most, in the order they were found:

- **The layout mask bug.** `bakeLayout` rasterised rectangles with an
  unsigned distance, so every tilled plot and yard sat at 0.5 all the way
  through and the edge noise flipped half of it back to grass. It read as a
  camouflage rectangle and three reviewers called it a masking bug. Signed
  distance now (`place.ts`). If a region of ground ever looks like camo
  again, check the mask value INSIDE it first.
- **The curse is drawn.** Non-boss enemies are pushed toward a bruised lilac
  pallor (the complement of the field's greens), eyes glow at every hour, and
  after dark they carry a moonlit rim and a little self-light. Encoded as
  outline alpha above 1 in the sprite batch (`gl/sprites.ts`); numbers in
  `tuning.render`.
- **Ground calm.** Grass slots are flat tones, tilled plots are procedural
  furrows, terrain edges have no per-pixel dither, tar is a thin film with a
  lit lip, blood is sparse splats that weather. Fence pieces are never
  scattered inside a place's fence (`fieldSceneryExcluded`).
- **Light.** A knee above 1 in the composite so the lantern pools warm
  instead of bleaching the player; dawn has cool shade and warm sun.
- **Readability.** View 450; damage numbers self-lit, big digits for crits only (round 11),
  ticks under 3 not drawn; HUD pixel-caps at 13-15 px; telegraphs are a faint
  fill with a hard edge; hit sparks warmed off pure white.
- **The Homestead** had an opaque painted-ground panel and a generic screen
  blur over the live farm. Both gone.
- **Rounds 6-9.** Night is near-dark outside the lantern (the pale blue
  fog was the "wash"); every dirt, soil and yard patch has a ragged grass lip
  (`gl/ground.ts`), which is what made the ground read as authored rather
  than pasted; the Home Field is four worked fields with headlands, not a
  lawn; tar is a glossy slick; the tour bot holds a fighting distance so the
  crowd stays in frame; locked heroes are silhouettes; the Homestead has a
  real "Head out" button. The damage-number glyphs are trimmed to their ink.
- **The label font is IBM Plex Mono** at 500/600 (`RDF Label` in
  `tokens.css`), the body's family. Two pixel faces failed first: Silkscreen
  (an 8 px grid font) closed C into O at label sizes, and Pixelify Sans, which
  replaced it in round 9, drew C as O and B as 8 in round 12's screenshots.
  Silkscreen stays for the in-world damage digits, drawn at exactly 8 and 16 px.

## The horde and the bosses (2026-09-26, after the owner lifted D13)

- **Where enemies come from.** `Spawner.pickSpawnPoint`: 85% step on from a
  ring just outside a 16:9 view round the player (`waves.json` spawn.ring),
  the rest over the fence. Before this, 6 to 17 enemies were ever on screen.
- **How many.** `waves.json` horde: budget x (1.6 + 0.16 per wave; 1.5 + 0.12 before round 15), groups
  x sqrt of that; each ordinary enemy's hp x(0.5 + 0.024 per wave), contact
  damage x0.6, xp x0.35 (0.45 before the horde grew), feed x0.15 (0.3 until round 11 counted 11,215 banked); feed left at the end sells at 150 an acre. Below about 0.5 hp every hit overkills and merging stops
  paying (run.test.ts caught it). Bosses are exempt from all of it. `npm run probe -- 8 density`
  now prints an on-screen count per wave: that is the number to watch.
- **Seeds and feed.** `World.dropMerged` merges a drop into one of its kind
  already lying within 40 px; a seed worth 3+ draws as a pile of three
  seeds (the big seed art read as an egg, round 15), feed worth 8+ as the
  full token (`pickup.feedBig`). Feed the Birds tokens merge the same way.
- **Braced** drains over 0.75 s on a move instead of resetting (`drDecayPerSec`).
- **Pickups draw on the ground layer** (under actors), with a dark outline;
  feed is warmed toward gold so a sack does not read as a clod on tilled soil.
- **Orbiting weapons** (the Scythe) draw their own tier art spinning, not the
  pack's "death wave" clip, which read as ghost skulls.
- **Bosses.** Cockerel 6, Thing in the North Pasture 9, Prize Bull 12, Sow 15,
  Combine 18, Spray Rig 21, Duster 25. A boss's hp is base x the wave's hp
  curve, so base values are set per slot.
- **The Duster** (`behaviours/enemies.ts` duster, `enemies.json` plane): a
  heading with a turn rate, so every change of course is an arc. Phase 1
  flies lanes; phase 2 strafes through the player. Drawn by
  `GLRenderer.drawPlanes`: a drop shadow on the ground layer and the plane
  above the canopy, rotated on its centre. The Spray Rig is the same behaviour
  at tractor speed on the old tractor sheet.
- **The probe knobs** for all of this: `hc`, `hcw`, `hhp`, `hdmg`, `hxp`,
  `ring` (tools/difficulty-probe.ts).

## The self-test loop

1. `npm run tour -- --url http://localhost:5180` (or without `--url` to start
   its own vite; a server for the tour wants `RDF_NO_HMR=1`). Headed Chrome, 14 deterministic scenarios from title to
   results, written to `screenshots/tour/` with `report.json`.
2. Hand the PNGs and `tools/critic-brief.md` to a fresh subagent that sees
   nothing else. Log its score in docs/V2.md.
3. Fix the worst problems, repeat.

Dev flags: `?dev` (overlay; F1 still toggles), `?tod=0..1`, `?map=<id>`,
`?r=2d`, `?tour`, `?seed` (shows the seed field on the title).

What the tour STAGES, and why (all in `src/main.ts` rdf hooks, tour only):
the hour (by fast-forwarding), the player's health (`stageHp`: the bot kites
better than a person and is always full), the boss's position (`stageBoss`:
a strong late build kills the Duster in five seconds, so waiting photographs
an empty field), the camera (snapped to the player on held frames), and the
blood (a fast-forward keeps only its last fifteen seconds; nothing weathers
while nothing draws). The autopilot collects its pickups and drifts to the
middle. None of it touches the sim or a test.

## Round 11, followed (2026-09-26)

The owner asked for the reviewer's suggestions to be followed, so round 11's
list was worked item by item (V2.md D21):

- **The farmhand wears three looks**, cycled per spawn: `farmhandBlight`, and
  `farmhandCoat` and `farmhandFlannel`, which are PixelLab STATES of the same
  character (7418d20d), so they share its rig, height and every clip. Cut
  with one translation per direction from the idle rotation (feet on row 57),
  never per frame, so a clip keeps its motion. Two older 44x44 characters were
  tried first and dropped: 32 px tall beside 52.
- **Loose crops** stand on a soil mound (`GLRenderer.drawCropBeds`,
  `tuning.render.cropBed`) and sit back a shade; the Home Field lost its
  single cabbages, cauliflowers and strawberries and a quarter of its crops.
- **`decard` trusts a transparent corner.** `node_milk_cans.png` had a white
  card inside a transparent margin and passed `--check`. Look at the alpha
  inside the frame, not the corner.
- The night outline is a dim violet at a lower glow, the Duster has a
  propeller (`drawPropBlur`), and the player ring is stronger (0.42).

## Rounds 12 to 15 (2026-09-26/27)

Each round's list was worked; V2.md D22 to D24 has the what and why. The
traps worth knowing:

- **The emissive target's alpha is coverage, not glow.** With alpha = glow,
  anything drawn in front added its small glow over the big glow behind it,
  so the crowd's eyes shone through the Duster (`gl/sprites.ts`).
- **`button.btn` outranks `.btn-primary`.** The gold primary button drew dark
  for sessions; `button.btn.btn-primary` in `style.css` fixes it everywhere.
- **The HUD sets the weapon grid's columns inline** (`hud.ts`), so a CSS
  width change does nothing until the inline template changes too.
- **A reward on the ground is also a lure.** Paying Feed the Birds straight
  into the purse cost the Hand's smart bot a clear in `run.test.ts`: the
  pilots walk to tokens. Merge them instead.
- **The horde is two numbers, not one.** More bodies level the bots faster;
  raising the count without cutting xp made the never-move pilots clear more.

## Rounds 16 to 19 (2026-09-27)

V2.md D25 to D28 has the what and why. What a later session should know:

- **The healthy grass tile is one flat colour.** `wang.dirt_to_grass_plain.1111`
  measures a standard deviation of zero, so every "smeared ground" complaint
  was the grade and the fog on a flat fill. The ground shader draws blades
  now (`gl/ground.ts`). Round 7 read an older, denser blade pass as
  "sandpaper"; these are sparse one-pixel strokes on two jittered grids.
- **Pickups drift in after `tuning.pickups.settleSeconds` (4).** Ten left
  sixty feed sacks on screen at wave 17: the horde kills about fifty a second.
  It is a sim change, so it moves `run.test.ts`; re-measure if you touch it.
- **Telegraphs carry a width.** `addTelegraph(..., width)` draws a lane
  instead of a cone; the charge behaviour lays one for its run. The shapes
  batch is flushed self-lit for warnings, or the night swallows them.
- **`impactFx` on a weapon** picks the burst its ordinary hits throw when
  the player has no element. `hitSpark` at full scale reads as a red urchin
  at dusk; only the pitchfork keeps it, at its jab scale.
- **The Duster at night is dark on purpose**: found by its lamps, its moon
  rim and its spray lane (`drawNavLights`, `drawSprayLanes`). Its searchlight
  pools start 230 px ahead, or they light its own wings.
- **The auger's swing was still the demon-bite loop** the pitchfork gave up
  (`proj.claw`). Grep `swingClip` before assuming an art complaint is gone.

## Traps found this session

- **The Preview tool and this session's working directory disagreed** after
  the OneDrive move: the dev server was serving the stale OneDrive copy, so
  the first "GL" screenshots were v1. Check `curl localhost:5180/src/main.ts`
  contains what you expect before trusting a screenshot.
- **GLSL int precision**: a uniform int declared in both shaders needs
  `precision highp int;` in both, or the link fails.
- **The 3/4-view shadow problem**: a sun shadow projected up the screen lands
  on the caster's own body. Solved with the coverage alpha (above).
- **Blood carpet**: v1's stains never faded; by wave 20 the field was red.
  The decal target now weathers every two seconds.
- **Canvas 2D cannot carry data in alpha**: the layout mask is built as raw
  bytes because a canvas premultiplies and destroys the channels.
- **A dev server with watching off serves stale code.** `RDF_NO_HMR` used to
  switch off the file watcher too, and a tour photographed the previous
  build. HMR off, watching on, now (`vite.config.ts`).
- **Vite strips comments** from served TypeScript: wait on a code token, not
  a comment, when checking what a server serves.
- **Git Bash rewrites `/paths`** in env vars (`VITE_BASE=/x/` became a
  Windows path). `MSYS_NO_PATHCONV=1` for a production preview.

## Open

- **Pacing, the owner's call.** Critic round 17: every weapon is T4 by wave 12
  of 24, and thousands of feed sit unspent at the end (they now sell for
  acres). Two switches exist and are OFF: `tuning.merge.tierOpensAt` (e.g.
  `{"4": 440}` opens tier 4 at wave 12) and `waves.json` economy.pricePerWave
  (e.g. 0.04 makes shop prices climb 4% a wave). Every tier gate measured cost
  `run.test.ts` either "merging beats taking whatever came up" or "a minority
  of seeds clear"; turning one on means re-tuning around it, ideally after the
  owner has played.

- The owner has not played v2. D13 (balance frozen) was lifted by the owner; the horde balance (D16-D20) is measured on bots only.
- **The full test suite takes about an hour now**, most of it tests/run.test.ts: every full-run test simulates the horde, three to five times the enemies of v1. Run the fast files (content, maps, meta, core, sim, specials, world) while iterating and the whole suite once at the end.
- The critic log and the milestone table are in docs/V2.md.
- The resize rule: the diorama and a run share one GPU device and its view height. Only the renderer that owns the canvas may be resized (`resize(forRun)` in main.ts), or a run inherits the title's closer framing.
