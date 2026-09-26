# Ranch Defense Force

*Work the field until the light goes.*

A pixel-art bullet-heaven set on the Whitacre place outside Canton, Ohio, in
1987. A crop duster went over low on Tuesday, and whatever it sprayed turned
the hands, the neighbours and the stock into cursed, shambling things. You are
the last one on the property with a job to do.

A run is **one day**. The first wave comes at first light; the sun crosses the
sky, the shadows swing and lengthen, the light goes gold and then red, and the
last waves are fought by lantern light in the rain, with eyes shining in the
corn, until the Duster comes in with its lamps on. The blight creeps in from
the fences as the day goes.

TypeScript, Vite and a hand-written WebGL2 renderer. No engine.

## Play

```bash
npm install
npm run atlas    # builds the sprite atlas from assets/ (required once)
npm run dev
```

| | |
|---|---|
| Move | WASD / arrow keys / left stick |
| Class ability | Space / right trigger |
| Pick a card | click, or 1-4 |
| Pause | Esc |
| Title screen | arrows choose a class, Enter starts, H opens the Homestead |

Weapons fire on their own. Collect the green gems to level up and pick a card;
feed buys from the shop after waves 5, 10, 15, 20 and 24. Six classes, each on
a different axis (the Hand anchors, the Kid runs, and so on); four unlock at
the Homestead with the acres a run pays out.

## How it looks the way it does

- The world is drawn at the art's own resolution (one art pixel to one
  texel) and scaled to the screen once, so every sprite shares one pixel
  density, and the camera glides sub-pixel without crawling.
- Light is real: a colour buffer, an emissive buffer, a float light buffer
  and a shadow mask, composited every frame. Sun shadows are the sprites
  themselves projected along the sun from their feet; the lantern, muzzle
  flashes, fires and gems are lights; eyes and tracers glow into a bloom.
- The day is one keyframed curve in `src/content/tuning.json`, so dusk moves
  with a content edit.
- The ground is drawn per pixel from a map's layout (paths, plots, yard,
  water), so there are no tile staircases, and each map has a farm standing
  around its fence.
- The title screen is the game renderer too: the farm at sundown, live.
- Birds, wind, crickets, an owl and thunder are synthesised in WebAudio and
  follow the time of day.

## For developers

Read [CLAUDE.md](CLAUDE.md) (conventions), [NOTES.md](NOTES.md) (how it fits
together) and [docs/V2.md](docs/V2.md) (the plan and decisions).

```bash
npm test                                  # vitest; run.test.ts plays whole runs and is slow
npm run typecheck
npm run tour -- --url http://localhost:5180   # the photo tour -> screenshots/tour/
npm run build
```

## Credits

Art by [LimeZu](https://limezu.itch.io/), used and published here with
LimeZu's permission (this permission does not extend to reusing the packs
elsewhere; please don't lift `assets/`). Character, animal, building and item
art generated with [PixelLab](https://pixellab.ai/).

Music by **Abstraction**, from the
[Music Loop Bundle](https://tallbeard.itch.io/music-loop-bundle) by Benjamin
Burnes / Tallbeard Studios, released CC-0. Sound effects generated with
[ElevenLabs](https://elevenlabs.io/); ambience synthesised in code.
