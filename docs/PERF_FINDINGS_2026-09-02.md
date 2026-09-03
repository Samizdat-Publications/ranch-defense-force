# The ~2fps question, measured

A measurement session, not an optimisation one. No game code, content JSON or
renderer was touched; everything new is under `tools/`. Every number below was
taken on the owner's machine, sequentially, with nothing else running.

**The headline: the atlas hypothesis is half right, and the half that is right
is not the half NOTES nominated.** The 4096x8192 atlas is genuinely and
measurably expensive — 2x the frame cost of a 2048x2048 one at the game's own
draw load, 3-4x at heavy load — and Chrome re-decodes the whole 12MB PNG from
scratch roughly **once per second, forever, while you play**. But on THIS
machine both are absorbed: 16 hardware threads and an RTX 5070 Ti swallow them,
and the game still runs at 180-240fps. Nothing measured here produces 2fps, and
nothing measured here can, because every tool in this repo drives Chrome over
CDP and an attached debugger suppresses the throttling that 2fps looks like.

---

## The machine, stated once

From `chrome://gpu`, read through the same `channel: 'chrome'` launch every
tool here uses. Full text in `tools/play/perf-gpu.txt`.

| | |
|---|---|
| Chrome | 152.0.7977.65 |
| GPU (active) | NVIDIA GeForce RTX 5070 Ti Laptop, driver 32.0.16.1071 |
| second GPU | Intel, present, **not** active. Optimus: false |
| backend | ANGLE / D3D11, feature level 12_1, passthrough decoder |
| **Canvas** | **Hardware accelerated** |
| Rasterization | Hardware accelerated |
| Compositing / WebGL / WebGPU | Hardware accelerated |
| Direct Rendering Display Compositor | Disabled |
| Skia Graphite | Disabled |
| hardware concurrency | 16 |
| RAM | 31 GB |
| display | refreshes fast enough to cap rAF at ~240Hz |

Problems detected: only `webgpu_on_vk_via_gl_interop` disabled, plus the
`exit_on_context_lost` and `unpack_overlapping_rows_separately_unpack_buffer`
driver workarounds. GPU process crash count 0. Nothing here explains a slow
canvas.

**This is a caveat, not a clearance.** Playwright launches Chrome with a fresh
temporary profile. The owner's own Chrome profile could have "Use graphics
acceleration when available" off, which is a per-profile setting this
measurement cannot see. That is the single cheapest thing left to check and it
has to be checked in the owner's Chrome, not this one.

---

## 1. Baseline: three real runs, same class, same seed

    RDF_PROFILE=1 npm run play -- hand 150 tools/play/perf-a harvest
    npm run play -- hand 150 tools/play/perf-b harvest
    npm run play -- hand 150 tools/play/perf-c harvest

All three reached wave 4, level 7, 130-180 kills, 15-44 enemies alive.

| run | fps samples (median / min / max) | frames > 33ms | median spike | worst |
|---|---|---|---|---|
| perf-a (profiled) | 228 / 64 / 242 | 123 | 258ms | 496ms |
| perf-b | 236 / 82 / 242 | 211 | 183ms | 371ms |
| perf-c | 236 / 122 / 242 | 137 | 183ms | 392ms |

Run-to-run spread on the fps median is 8fps; on the spike count it is
123-211, i.e. **±35%**. That is the variance band. Any A/B whose effect is
smaller than that cannot be resolved by running this tool twice, which is the
lesson the previous session paid for.

Note the low fps samples (64-122) land on the ticks where `play.ts` itself is
doing work — its 500ms rAF probe, a screenshot, a level-up keypress. The
cleaner numbers are in §5, taken with a harness that touches the page once
every five seconds.

### CPU profile, 167s of samples (`tools/play/perf-a/REPORT.md`)

| self | % | function |
|---|---|---|
| 93.02s | 55.7% | `(idle)` |
| 44.01s | 26.3% | `(program)` |
| 9.08s | **5.4%** | `stroke` |
| 7.70s | 4.6% | `drawImage` |
| 2.65s | 1.6% | `update /src/ui/hud.ts:63` |
| 1.46s | 0.9% | `restore` |
| 0.76s | 0.5% | `save` |

The main thread is **over half idle**. Nothing in the game's own JS is above
1.6%. The largest attributable cost is now `stroke`, not `drawImage` — it comes
from `drawArcs` (the melee sweep and aura rings, `renderer.ts:1533/1547`) and
`drawHazards` (`renderer.ts:1851`), and `hand` is a melee class so the sweep is
drawn every frame. That is a small finding and it is the biggest one a CPU
profile has left to give: **the profile has been mined out.** The cost, if
there is one, is not in JS.

---

## 2. Is the canvas accelerated on this machine?

**Yes.** See the table above. This closes the "integrated graphics with limited
VRAM" branch of the NOTES hypothesis on this hardware — there is no integrated
GPU in play at all.

---

## 3. The microbenchmark: texture size, isolated from everything else

`tools/atlas-bench.ts`. N random 32x64 blits per frame onto a 1600x900
`alpha:false` canvas with `imageSmoothingEnabled=false`, in the same headed
Chrome, no sim and no renderer. Six sources, three repeats, 1s warmup + 3s
measured per cell.

    node node_modules/vite-node/vite-node.mjs tools/atlas-bench.ts

| source | 600 draws: frame ms | fps | JS in loop | 4000 draws: frame ms | fps | JS in loop |
|---|---|---|---|---|---|---|
| a — real atlas.png, 4096x8192 `<img>` | **8.30** (8.20–8.30) | 121 | 2.80 | **41.7** (37.5–50.0) | 24 | 17.9 |
| b — 2048x2048 crop `<img>` | **4.20** (4.20–4.20) | 238 | 0.40 | **12.4** (8.4–12.5) | 81 | 10.0 |
| c — 1024x1024 crop `<img>` | **4.20** (4.20–4.20) | 238 | 0.40 | **12.4** (8.4–12.5) | 81 | 10.1 |
| d — flash `<canvas>`, 4096x8192 | 8.30 (4.20–8.30) | 121 | 2.00 | 45.9 (37.5–54.2) | 22 | 14.7 |
| e — alternating a/d each draw | 8.30 (4.30–8.30) | 121 | 2.30 | 46.0 (41.7–54.1) | 22 | 17.9 |
| f — atlas.png, reads confined to one 1024 window | 8.20 (4.20–8.30) | 122 | 2.50 | 45.7 (37.6–50.0) | 22 | 19.3 |

Spreads are in brackets. 4.20ms is the vsync floor, which is why (b) and (c)
are identical at 600 draws — they finish inside a refresh and the display
decides the rest. The 4000-draw column exists because of that floor.

Four things fall out, all of them larger than the spread:

1. **The 4096x8192 atlas costs about twice a 2048x2048 one at the game's own
   draw load**, and 3.4x at heavy load. 8.3ms vs 4.2ms; 41.7ms vs 12.4ms.
2. **It is the size, not the access pattern.** Condition (f) reads only inside
   one 1024x1024 window of the big atlas and is indistinguishable from (a),
   which reads all over it. Repacking the atlas for locality would buy nothing.
   Shrinking it would buy everything.
3. **2048x2048 is already as cheap as 1024x1024.** (b) and (c) match at both
   loads. The cliff is somewhere between 2048x2048 and 4096x8192, so an atlas
   split into ≤2048² pages should recover the whole difference — there is no
   need to go smaller than that.
4. **The flash canvas is not a separate problem, and source-switching is not
   one either.** (d) matches (a), and (e) — alternating source every single
   draw, which is what the hit-flash path does — matches both. The second
   4096x8192 surface costs what the first one costs, no more.

The JS-side column is worth reading twice: at 600 draws the synchronous time
spent inside the `drawImage` calls is 2.80ms for the big atlas against 0.40ms
for a small one. **7x, on the CPU, in the calling thread.** So this is not
purely a GPU effect that a CPU profile would miss — part of it is exactly the
`drawImage` self-time the profile already shows at 4.6%.

---

## 4. GPU-side trace of the real game — and the thing nobody had looked for

`tools/play-trace.ts`: the same run, driven the same way, with a chrome trace
over categories `disabled-by-default-gpu.service, gpu, cc, viz, blink,
devtools.timeline, disabled-by-default-devtools.timeline(.frame)`.

    RDF_TRACE_WARMUP=120 node node_modules/vite-node/vite-node.mjs \
      tools/play-trace.ts hand 30 tools/play/trace harvest

Summary in `tools/play/trace/perf-trace.md`. Two windows were taken, 26.1s at
32 enemies alive and 29.6s at 11; they agree.

### The compositor is healthy

| | per second |
|---|---|
| `DrawFrame` (frames actually presented) | 228 – 231 |
| `BeginFrame` | 240 |
| `FireAnimationFrame` (the game's own JS) | ~209, 1.07ms each |
| `SkiaOutputSurfaceImplOnGpu::SwapBuffers` | 1.61ms per presented frame |
| `DXGISwapChainImageBacking::Present` | 1.51ms per presented frame |

At 230fps the whole frame budget is 4.3ms. JS takes 1.07 and the GPU-process
swap takes 1.5-1.6. Nothing is starved.

### The atlas is re-decoded from PNG about once a second

This is the finding.

| | 26.1s window | 29.6s window |
|---|---|---|
| `Decode Image` (`imageType: png`) | 31 | 23 |
| median duration | **301ms** | **291ms** |
| total decode time | **8.77s** | **6.2s** |
| gap between decodes | 0.91, 0.87, 1.01, 1.05, 1.08, 0.94, 0.95, 0.94, 0.93, 0.93, 0.96 … | same cadence |
| `GpuImageDecodeCache::UploadImage` after each | 9-17ms | 9-17ms |
| `GpuImageDecodeCache::DecodeImage` (same events) | 31 | 23 |

Only one PNG in the shipped build is big enough to take 300ms to decode:

    12,731,138  public/atlas.png
         4,555  public/ui/plate.png
           733  public/ui/panel.png

So the 12MB, 4096x8192 atlas is being fully re-decoded from compressed PNG, on
a renderer raster worker thread, roughly **once per second for the entire
duration of play** — about 290-300ms of CPU per second of wall clock, ~30% of
one core, continuously, plus a 9-17ms GPU re-upload each time. `has_alpha` on
the decode path and the `paint_image_id: 0` on the cache events say this is the
at-raster path, not a cached one.

The mechanism is not directly measured, and should be stated as a hypothesis: a
4096x8192 RGBA image is ~134MB decoded, which is far over `GpuImageDecodeCache`'s
working-set budget, so it can never be held and is re-decoded every time it is
needed. That is consistent with §3 — where the same image is 2x the cost of one
that fits — and it is consistent with 2048x2048 (16MB decoded) being free.

### But on THIS machine it costs zero frames

The tool buckets every inter-frame gap by whether a decode was in flight:

| frames presented | median gap | p95 gap | max gap |
|---|---|---|---|
| while a decode was running (1481) | 4.16ms | 5.47ms | 8.45ms |
| with no decode running (5374) | 4.16ms | 4.78ms | 63.65ms |

Identical. The decode is worker-thread work, and with 16 hardware threads and a
fast GPU the main thread never waits for it. **That is the whole reason nothing
in this repo has ever reproduced the owner's report: the cost is real,
continuous, and entirely hidden by this machine's headroom.**

### What is not happening

`GpuImageDecodeCache::UploadImage` runs 23-31 times in ~28s, not 230 times a
second. **The texture is not re-uploaded per frame.** The per-frame thrash in
the NOTES hypothesis is ruled out; the per-second thrash that replaces it is a
different animal and a smaller one.

Raster traffic is high but cheap: ~5000 `RasterCHROMIUM` ops/second, ~0.015ms
each, ~34 per presented frame. `RasterDecoderImpl::DoEndRasterCHROMIUM` totals
0.94ms per presented frame. That is the canvas being drawn, and it is in budget.

---

## 5. Production vs dev, at the owner's window size

`tools/play-prod.ts` starts a run by CLICKING (a `.hero` card selects, a second
click takes the field), so it works against a build with no `window.rdf` —
though as it turns out the deployed build DOES expose `window.rdf`, so wave and
enemy counts are readable there too. Viewport 1920x1080 at
`deviceScaleFactor 1.25`, canvas backing **2400x1350** — a quarter again bigger
in each axis than the 1600x900 every other measurement in this repo has used.

    node node_modules/vite-node/vite-node.mjs tools/play-prod.ts \
      https://samizdat-publications.github.io/ranch-defense-force/ 75 tools/play/perf-prod.md
    node node_modules/vite-node/vite-node.mjs tools/play-prod.ts dev 75 tools/play/perf-dev.md

fps measured as frames counted in the page over 5-second windows.

| run | median | min | max | enemies reached | frames > 33ms |
|---|---|---|---|---|---|
| production (live site) #1 | 179 | 127 | 240 | not recorded | 0-9 per 5s |
| production (live site) #2 | 226 | 201 | 240 | 35 | 0-4 per 5s |
| dev server | 238 | 148 | 241 | 50 | 0-7 per 5s |

**Production and dev match within the spread.** Two production runs 75s apart
differ from each other (179 vs 226 median) by more than either differs from
dev, which is the variance lesson again. There is no production-only slowdown.
Growing the canvas to 2400x1350 did not change the picture either.

`document.visibilityState` was `visible` in every sample of every run.
`performance.memory.usedJSHeapSize` sat at **6.2-7.5MB in production** and
**9.0-10.7MB in dev**, flat, with no upward trend across 75 seconds. There is
no leak.

One unrelated defect fell out: the deployed build 404s on **every** sound
effect — `audio/sfx-*.mp3`, eleven of them, plus music. `public/audio/` is
gitignored (regenerated by `npm run music`/`npm run sfx`), so the deploy ships
without it. The live game is silent. That is not a performance problem and it
is worth someone's attention.

## 5b. Occlusion — what a covered window actually does here

Two controls, both with the anti-throttling flags **removed** (three of the four
exist precisely to defeat this, so leaving them on would have measured nothing):

| | median fps | at the moment of covering |
|---|---|---|
| half covered by a second Chrome window from t=30s | 151 | no change |
| fully covered (1930x1090 over 1920x1080) from t=25s | 236 | one 140fps window, then back to 236 |

**Neither reproduced the 2fps signature.** Full occlusion by another Chrome
window did not throttle rAF at all. The 140fps dip at t=25s is the cost of
launching the covering browser, and it recovers immediately.

Two readings of that, and the second is the important one:

- Chrome's native occlusion detection did not fire for a Chrome window covering
  another Chrome window from the same automation session.
- **More likely and more consequential: an attached CDP debugger suppresses
  renderer throttling.** Every tool in this repo drives Chrome over CDP.
  If that is the reason, then *no playwright-driven measurement in this
  repository can ever reproduce the owner's throttled window*, and the 2fps
  reading NOTES records from a previous session was taken under conditions this
  one did not reconstruct. This is a limit of the instrument, and it should be
  written down as one rather than read as "occlusion is harmless".

The honest summary is: this session **could not reproduce 2fps by covering a
window**, and cannot conclude from that that the owner's window was not covered.

---

## 6. Software rasterisation — the decisive control

The same microbenchmark with `--disable-gpu`, two repeats
(`tools/play/perf-bench-sw.md`):

    RDF_BENCH_SWRAST=1 RDF_BENCH_REPEATS=2 node node_modules/vite-node/vite-node.mjs \
      tools/atlas-bench.ts tools/play/perf-bench-sw.md

| source | 600 draws: frame ms | JS in loop | 4000 draws: frame ms | fps |
|---|---|---|---|---|
| a — atlas.png 4096x8192 | 12.50 | **12.40** | 87.5 | 13 |
| b — 2048x2048 crop | 12.50 | **0.50** | 58.3 | 19 |
| c — 1024x1024 crop | 12.50 | **0.50** | 45.9 | 22 |
| d — flash canvas 4096x8192 | 12.50 | 9.80 | 66.6 | 17 |
| e — alternating | 12.60 | 13.20 | 87.5 | 13 |
| f — big atlas, 1024 window | 12.60 | 13.30 | 83.4 | 12 |

Without GPU acceleration the frame cap drops to 80Hz and everything at 600
draws pins there. But look at the JS column: **12.4ms of main-thread CPU per
frame from the big atlas against 0.5ms from a small one — 25x.** At the game's
own draw load, a machine without canvas acceleration would spend 12ms per frame
just blitting, before the sim, the HUD or anything else.

That still lands at 12-22fps at heavy load, not 2. **Software rasterisation
alone does not explain 2fps** — but it is the one condition measured here where
the atlas size becomes catastrophic rather than merely wasteful, and it is a
condition a different machine, a different Chrome profile, or a driver
blacklist could put the owner in.

---

## What this means for the next decision

**Ranked, with what each is worth.**

1. **Ask the owner for `chrome://gpu` from their own Chrome, and their
   `chrome://settings` "Use graphics acceleration when available".** Cost:
   one message. This session measured a fresh temporary profile on an RTX 5070
   Ti and found everything accelerated; it cannot see the owner's profile. §6
   says the atlas gets 25x worse when acceleration is off. This is the highest
   value-per-effort question left and it should be asked before any code moves.

2. **The window question stays open and this session could not close it.**
   Covering the window did not throttle rAF here (§5b), most likely because CDP
   is attached. Do not read that as "it wasn't the window". Read it as "the
   instrument cannot answer this" and get the answer from the owner.

3. **Splitting the atlas into ≤2048x2048 pages is now justified on measured
   grounds, whatever the answer to (1).** It halves per-blit frame cost at the
   game's own load (8.3ms → 4.2ms, §3), cuts JS `drawImage` self-time 7x, and
   eliminates a 300ms full-PNG re-decode that currently runs once a second
   forever (§4). On this machine it buys headroom nobody needs. On a weaker
   machine it is the difference between the game working and not. Note that
   2048 is enough — 1024 measured no better — and that repacking for locality
   is **not** worth doing, because condition (f) proved locality is irrelevant.
   The atlas is 8176 frames; four 2048x2048 pages hold the same content, and
   the flash copy splits with it for free (condition (d) tracked (a) exactly).

4. **Do not optimise the renderer's JS.** It is 55.7% idle with nothing above
   1.6%, and the profile has been mined out (§1). The only JS-side item worth
   even noting is `stroke` at 5.4%, from the melee sweep and hazard rings — and
   it is 5.4% of a mostly-idle thread, i.e. nothing.

5. **The per-frame texture-thrash hypothesis in NOTES is dead** (§4): 23-31
   uploads in ~28 seconds, not 230 a second. Replace it in NOTES with the
   per-second re-decode, which is real, is measured, and is a smaller animal.

6. Unrelated but shipping: **the live site has no audio at all** — every
   `sfx-*.mp3` and the music 404 (§5).

---

## Reproducing all of it

    npm run atlas                     # once, if public/atlas.png is missing

    # 1  baselines and CPU profile
    RDF_PROFILE=1 npm run play -- hand 150 tools/play/perf-a harvest
    npm run play -- hand 150 tools/play/perf-b harvest
    npm run play -- hand 150 tools/play/perf-c harvest

    # 2  what Chrome says about this machine   -> tools/play/perf-gpu.txt
    node node_modules/vite-node/vite-node.mjs tools/gpu-report.ts

    # 3  atlas size, isolated                  -> tools/play/perf-bench.md
    node node_modules/vite-node/vite-node.mjs tools/atlas-bench.ts

    # 4  GPU/compositor trace of a real run    -> tools/play/trace/perf-trace.md
    RDF_TRACE_WARMUP=120 node node_modules/vite-node/vite-node.mjs \
      tools/play-trace.ts hand 30 tools/play/trace harvest
    #    add RDF_TRACE_RAW=1 for the raw trace — it is 737MB for 25s, and this
    #    repo lives inside a OneDrive folder, so it is off by default

    # 5  production and dev, at the owner's window size
    node node_modules/vite-node/vite-node.mjs tools/play-prod.ts \
      https://samizdat-publications.github.io/ranch-defense-force/ 75 tools/play/perf-prod.md
    node node_modules/vite-node/vite-node.mjs tools/play-prod.ts dev 75 tools/play/perf-dev.md
    RDF_COVER=1 RDF_COVER_AT=30 node node_modules/vite-node/vite-node.mjs tools/play-prod.ts \
      https://samizdat-publications.github.io/ranch-defense-force/ 75 tools/play/perf-covered.md
    RDF_COVER=1 RDF_COVER_AT=25 RDF_COVER_SIZE=1930,1090 node node_modules/vite-node/vite-node.mjs \
      tools/play-prod.ts https://samizdat-publications.github.io/ranch-defense-force/ 60 \
      tools/play/perf-covered-full.md

    # 6  software raster control                -> tools/play/perf-bench-sw.md
    RDF_BENCH_SWRAST=1 RDF_BENCH_REPEATS=2 node node_modules/vite-node/vite-node.mjs \
      tools/atlas-bench.ts tools/play/perf-bench-sw.md

The four new tools are `tools/gpu-report.ts`, `tools/atlas-bench.ts`,
`tools/play-trace.ts` and `tools/play-prod.ts`. They add no dependencies, they
typecheck under `tools/tsconfig.json`, and none of them is invoked through
`npx` — `package.json` was deliberately left alone, so they are run with
`node node_modules/vite-node/vite-node.mjs` directly. Everything they write
lands under `tools/play/`, which is gitignored.

Measurements were taken sequentially with the machine otherwise idle. One
caveat on that: an editor hook reported another session's vite dev server
running in this folder throughout. An idle vite server is cheap, and the runs
agree with each other, but it was not a perfectly clean room.
