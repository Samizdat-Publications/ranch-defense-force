# Cost probes — session 16

Two real generations, made to measure what a dollar of PixelLab credit buys once
the monthly allowance is exhausted. Both are usable assets rather than
throwaways; the measurement was the point, but nothing was wasted on it.

| file | `image_size` | USD | verdict |
|---|---|---|---|
| `drum_128.png` | 128×128 | $0.007777 | **good.** Rusted steel drum, correct palette and outline weight. Wire it as a destructible prop. |
| `magnet_orb.png` | 48×48 | $0.007040 | **dud.** Reads as a lifebuoy, not a magnet. Re-roll with "horseshoe magnet, two poles" rather than "orb". |

**The finding: 1.10x the cost for 7.1x the pixels.** Cost is very nearly flat
with output size, which is the opposite of how the generation counter prices a
call. Recorded in `docs/PIXELLAB.md` under *Paying in dollars*.

Both were `POST /v2/map-objects`, `view: low top-down`, single colour outline,
basic shading, medium detail, `text_guidance_scale: 10` — the same parameters
`npm run mapobject` sends, so these numbers transfer to a batch.
