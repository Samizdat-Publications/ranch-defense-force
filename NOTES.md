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
| Sim | Unchanged from v1 so far. The replay and bot tests still describe it. |

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

Scores 4 (v1) -> 5 -> 6 -> 5 -> 5 -> 6. Each row in docs/V2.md. The fixes that
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
- **Readability.** View 450; damage numbers self-lit, big digits from 40,
  ticks under 3 not drawn; HUD pixel-caps at 13-15 px; telegraphs are a faint
  fill with a hard edge; hit sparks warmed off pure white.
- **The Homestead** had an opaque painted-ground panel and a generic screen
  blur over the live farm. Both gone.

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

- The owner has not played v2. D13 in docs/V2.md: the sim's balance is v1's, on purpose.
- The critic log and the milestone table are in docs/V2.md.
- The resize rule: the diorama and a run share one GPU device and its view height. Only the renderer that owns the canvas may be resized (`resize(forRun)` in main.ts), or a run inherits the title's closer framing.
