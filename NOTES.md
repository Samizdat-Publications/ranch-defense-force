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

- The world draws into a target at ART resolution (1 art px = 1 texel), 540
  texels tall (`tuning.render.viewHeight`), and the composite scales it to the
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

## The self-test loop

1. `npm run tour -- --url http://localhost:5180` (or without `--url` to start
   its own vite). Headed Chrome, 14 deterministic scenarios from title to
   results, written to `screenshots/tour/` with `report.json`.
2. Hand the PNGs and `tools/critic-brief.md` to a fresh subagent that sees
   nothing else. Log its score in docs/V2.md.
3. Fix the worst problems, repeat.

Dev flags: `?dev` (overlay; F1 still toggles), `?tod=0..1`, `?map=<id>`,
`?r=2d`, `?tour`.

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

## Open

- The owner has not played v2. D13 in docs/V2.md: the sim's balance is v1's, on purpose.
- The critic log and the milestone table are in docs/V2.md.
- The resize rule: the diorama and a run share one GPU device and its view height. Only the renderer that owns the canvas may be resized (`resize(forRun)` in main.ts), or a run inherits the title's closer framing.
