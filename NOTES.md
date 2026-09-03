# NOTES

Handoff back to the next design pass, per CLAUDE.md. Latest session first.

---

# STILL OPEN — the owner sees ~2fps, and this session measured why it cannot see it

**Read this before anything else in the performance line.** The owner reports
the game at about 2 frames per second while playing. Session 22 spent a
measurement pass on it — no game code touched, everything under `tools/` —
and the findings are in `docs/PERF_FINDINGS_2026-09-02.md` (the report;
the tools that produce it are committed under `tools/`). The short version, in order of
what it changes:

## What was measured, so nobody measures it again

| | |
|---|---|
| machine | RTX 5070 Ti laptop, 16 threads, 31GB, ~240Hz; `chrome://gpu` says Canvas, raster, compositing all **hardware accelerated** |
| three real runs, seed `harvest` | fps median 228/236/236, min 64-122; frames >33ms 123/211/137 — **±35% run-to-run on the spike count** |
| CPU profile | **55.7% idle**; `stroke` 5.4% (melee sweep + hazard rings), `drawImage` 4.6%, nothing of ours above 1.6%. **The profile is mined out.** |
| production site vs dev server, 1920x1080 at dpr 1.25 | 179/226 vs 238 median — within the spread. No production-only slowdown. Heap flat at 6-10MB. |
| covered window | **could not reproduce a throttle.** Half covered 151, fully covered by another Chrome window 236. |
| `--disable-gpu` | frame cap 80Hz; 12-22fps under heavy load. Not 2. |

## The atlas hypothesis was half right, and not the half NOTES nominated

Measured with `tools/atlas-bench.ts`, same Chrome, 600 and 4000 blits a frame,
six source conditions, three repeats:

- **The 4096x8192 atlas costs 2x a 2048x2048 one at the game's own draw load**
  (8.3ms vs 4.2ms a frame), 3.4x at heavy load, and **7x the JS self-time
  inside `drawImage`** (2.8ms vs 0.4ms). Under software raster it is **25x**.
- **It is the size, not the access pattern.** Reads confined to one 1024
  window of the big atlas cost exactly what reads scattered across it cost.
  Repacking for locality would buy nothing.
- **2048 is already as cheap as 1024.** There is no reason to go smaller.
- The white `flash` canvas and switching source image every draw cost
  nothing extra.

And the thing nobody had looked for, from a chrome trace of a real run
(`tools/play-trace.ts`): **Chrome re-decodes the entire 12.7MB PNG from
scratch about once per second for the whole run** — 291-301ms each, 6-9s of
decode in a 28s window, plus a 9-17ms GPU re-upload every time. A 134MB
decoded image cannot be held in the image-decode cache, so it is decoded at
raster, forever. **On this machine that costs zero frames** (inter-frame gap
4.16ms median with a decode in flight, 4.16ms without) because sixteen threads
absorb it. That is the whole reason nothing here has reproduced the report:
the cost is real and continuous, and this machine has the headroom to hide it.

**The per-frame texture-thrash hypothesis is dead**: 23-31 uploads in ~28s,
not 230 a second.

## What was decided

**Split the atlas into ≤2048x2048 pages.** Justified on measured grounds
whatever the owner's window was doing: it halves per-blit cost at the game's
own load, cuts `drawImage` self-time 7x, removes the per-second re-decode, and
on a machine without canvas acceleration it is the difference between the game
working and not. The atlas is 56% occupied (18.7 of 33.6 Mpx), so it is five
or six pages. Session 22 delegated that change; see its entry below for what
landed.

**Do not optimise the renderer's JS.** It is over half idle.

## What stayed open, and only the owner could close it

1. **Which Chrome profile.** Every measurement here ran a fresh playwright
   profile, which had acceleration on. The owner's own profile could have "Use
   graphics acceleration when available" off — a per-profile setting no tool
   can see. Ask for `chrome://gpu` from the owner's own browser.
2. **The window.** Covering the window did not throttle rAF here, most likely
   because an attached CDP debugger suppresses renderer throttling. **That is
   a limit of the instrument, not evidence that occlusion is harmless**: no
   playwright-driven tool in this repo can reproduce a throttled window. The
   owner's own answer — fronted, split-screen, or behind something — is the
   only measurement of it that exists.

## The owner answered both, the same evening

1. **The profile.** The owner's own `chrome://gpu` (`about-gpu-2026-09-03`)
   is the same picture the fresh profile gave: Canvas, raster, compositing,
   WebGL all **hardware accelerated**, RTX 5070 Ti active, "Use graphics
   acceleration when available" on, the browser org-managed but with no
   graphics policy in effect. **Software rasterisation is ruled out on this
   machine.** The 25x figure in §6 describes some other machine, not this one.
2. **The window.** *"I've had the window in the background this whole time."*
   That is the 2fps: Chrome throttles a backgrounded window's animation frames
   to roughly two a second, this game only advances on a presented frame, and
   the throttle is exactly what no CDP-attached tool here could reproduce. The
   owner was bringing it to the front to confirm as this was written; the
   confirmation belongs in the next entry.

So the report was the throttle, and the atlas split proceeds anyway on its own
measured merits — it is still 2x per frame and a 300ms re-decode every second,
just on a machine that can afford both.


## Found in passing

**The live site had no audio.** `public/audio/` was gitignored (generated), the
deploy runs `npm run atlas` but nothing regenerates sound, so every
`sfx-*.mp3` and all three music loops 404 on GitHub Pages. The music is CC-0
and the effects are the project's own ElevenLabs output, 7MB in 29 files.
The owner chose to commit the directory; it ships now.

## The tools that exist for this

    npm run play -- hand 240 out/dir seed      a real run, real renderer
    RDF_PROFILE=1 npm run play -- ...          CPU profile via CDP, self time by function
    node node_modules/vite-node/vite-node.mjs tools/gpu-report.ts     chrome://gpu, through shadow DOM
    node node_modules/vite-node/vite-node.mjs tools/atlas-bench.ts    texture size, isolated
    node node_modules/vite-node/vite-node.mjs tools/play-trace.ts hand 30 out seed   compositor/GPU trace
    node node_modules/vite-node/vite-node.mjs tools/play-prod.ts <url|dev> 75 out.md  drives a build with no rdf handle, by clicking

**The standing lesson holds: when run-to-run variance is larger than the effect
you are testing, A/B-ing suspects never converges.** The spike count varies
±35% between identical runs. Get a profile or a trace instead.

---


# Session 22 — measured first, then four agents in four worktrees

The 2fps report got a measurement pass before anything else (the section above
is its result). Then the session split into four isolated worktrees, each with
its own `npm ci` and `npm run atlas`, and merged them onto an integration
branch as they landed: the farmhand silhouette, the four locked classes, the
home screen, and the atlas split. Each subsection below is the agent's own
account, edited only for accuracy against the diff.

The owner also settled two open Design questions in this session, by looking at
the live site: **the class cards get out of the scene's way** (they shrink and
drop; the composition stays), and the home screen gets a scene sequence — calm,
lightning, blight, then a camera descent through the soil to the lab that is
"secretly right under the farm."

## The four locked classes now answer the game differently

The standing directive is done. `widow`, `vet`, `agronomist` and `drifter` were
three `braced`s and three `momentum`s with `digIn` or `bolt` bolted on. Each now
owns an axis of a system the game already had, chosen because **The Hand and The
Kid had already taken the MOVEMENT axis between them** and a third variation on
standing-versus-running is another stat spread whatever the numbers say.

- **Widow / attrition.** `grit` splits a blow: 55% lands now, the rest is a wound
  that bleeds off over 5s and that each kill closes a quarter of. Fighting
  through a hit erases it; running pays all of it. `holdTheLine` plants a ward
  that slows and pays per kill inside, and does NOT root her — a ward you cannot
  leave is a worse Dig In. Her flat regen came down 1.4 → 0.3 because Grit IS
  her sustain now.
- **Veteran / spacing.** `overwatch` pays +40% past 170px, charges -20% inside
  80px. PER-TARGET, so it joins the additive sum in `resolveDamage` — the stat
  block and `passiveDamagePct` are both one number for the whole tick.
  `claymore` plants a mine: arms in 0.8s, trips on the first thing within 90px
  or a 6s fuse, 55 in a ring plus knockback and a 1.2s stun. A ring, not a
  cone: all reach here is circle-vs-circle, and a mine you walked away from
  has no facing.
- **Agronomist / status.** `cultivar` makes every burn, bleed and slow she
  applies hit 70% harder and last 70% longer (slows capped at 75%), at the point
  the payload leaves the projectile. She is the one class for whom the element
  pick changes character. `fieldSample` lobs a flask 190px that leaves a slick
  carrying her element, or a 50% slow if she has none. Not a dash.
- **Drifter / tempo.** `hotStreak` stacks +5% damage and +2.5% speed per kill to
  twelve, on a 4s window from the last kill; any hit at all takes the lot. The
  Kid's Momentum asks how fast you MOVE; this asks how fast you KILL. `lightOut`
  is a 220px line through the crowd: 45 to everything crossed, shoved aside,
  0.35s untouchable, and 1.5s off the cooldown per kill on the way.

### The balance table, before from a revert and not from memory

24 seeds, `npm run balance`, home pilot in bold. "Before" is the pre-change code
re-measured after reverting `src/sim` and `classes.json` to b6b0b6a4.

| class | pilot | kite | brawler | spacer |
|---|---|---|---|---|
| hand | brawl | 33% | **79%** | 58% |
| kid | kite | **58%** | 46% | 75% |
| widow | brawl | 42% → 88% | **75% → 83%** | 92% → 79% |
| vet | space | 13% → 38% | 33% → 46% | **54% → 67%** |
| agronomist | brawl | 46% → 54% | **50% → 75%** | 67% → 71% |
| drifter | kite | **4% → 58%** | 17% → 54% | 8% → 79% |

On the test's seed ladder (home pilots, /24): hand 21, kid 13, widow 22 → 20,
vet 13 → 16, agronomist 11 → 18, drifter 1 → 17. Mean 17.5, worst deviation
4.5 against a bar of 8. `spacer` is a new pilot in `tools/balance.ts` that
holds ~200px, because a range class flown by a brawler measures the wrong game.

### The Drifter was a trap pick, and had been for a while

**1/24 kiting, 4/24 brawling, 2/24 spacing — dying on WAVE 2 in fourteen of
twenty-four, on the code that was already committed.** He had been broken since
the density pass halved enemy hp and damage to buy BODIES. Nothing caught it
because **the parity test only ever ran The Hand and The Kid**, and Momentum was
hiding it: +60% damage essentially free, since a harness bot never stops
moving. Hot Streak pays nothing until you are already killing, which exposed it.

The cause is the STARTING WEAPON, proved rather than argued: every other number
held still, 4/24 holding the Harpoon Gun and 13/24 holding the Scattergun. At
T1 `hookFurthest` fires one shot at ONE enemy every 1.8s, at the FURTHEST enemy
in range, so it does not even answer the thing about to touch you. **Stat
inflation was tried first and refused to move it — 95 hp, +45% attack speed and
+15% damage took 4/24 to 4/24.**

The fix is that `hookFurthest` now reads `projectileCount`, a declared stat
that until now **only the Scattergun's `stream` looked at**. Nothing in the game
grants it, so every existing build resolves it at 0 and the line is
arithmetically the one it replaces; the Drifter's stat block pays for extra
hooks. The Harpoon Gun is still a bad T1 weapon for everyone else — a T1 rider
on the weapon, or a different starting weapon, is a design call.

### The weapon ring targets the NEAREST enemy, and that shapes range passives

Overwatch shipped at 220/110 and measured 0/8 kiting. `findNearestEnemy` means a
range-scaling passive is graded against the closest body on nearly every shot,
so the near penalty applied continuously in any crowd and the far bonus could
never be earned. 170/80 makes the penalty a contact-range punishment and the
bonus something a standoff reaches: 16/24.

### The parity bar was about to measure the wrong thing

The six-class test keeps the pair test's TOLERANCE, `ceil(n/3)`, and
deliberately not its statistic. Bounding `max - min` over six classes at a
number written for `|a - b|` over two is silently far stricter, because a
sample's range grows with how many things are in it. It would also have been a
test of two classes out of scope: The Hand at 21/24 and The Kid at 13/24 span
exactly ceil(24/3) = 8 between them before any unlockable is considered. Each
class is held within `ceil(n/3)` of the six-class mean instead. Read the
deviation, not the pass: 4.5 against a bar of 8. 207 tests now.

### Facts found along the way

- **`animRow` is read by nothing**, and the names in The Hand's and The Kid's
  entries (`dig`, `run`) are fiction. The shared humanoid rig declares exactly
  `idle` and `walk`, checked against the built `atlas.json`. The four new
  entries name real clips and a `_animRowNote` records it.
- **`npm run play` never pressed SPACE.** Every playthrough report in this repo
  until now measured a class with its ability button unplugged. It presses once
  a second now and reports how many times the ability fired.
- `tryAbility` refunds the cooldown for an id it has no branch for, so a dead
  button is instantly dead rather than also lying about recharging.
- The balance harness presses the ability once every 400 ticks (6.67s), so it
  under-measures every cooldown shorter than that. Light Out's kill-refund is
  essentially invisible to it.

### What wants a human playing it

- **Whether Grit reads as anything.** The wound is invisible: nothing in the HUD
  shows outstanding damage, so what a player sees is a health bar that keeps
  falling after the hit and stops when they kill something. That is the whole
  class and it has no readout.
- **`lifestealPct: 1` on the Drifter is doing a lot of work** — 4% put him at
  21/24 and 2% at 20/24, roughly five clears per point.
- **The Claymore may be invisible in practice.** Its only marker is the
  TRIGGER-radius telegraph; the larger blast radius is never drawn.
- Overwatch's bands have no on-screen expression at all.


## The atlas is pages now, and the per-second re-decode is gone

Acting on `docs/PERF_FINDINGS_2026-09-02.md` §3 and §4, which are the
measurements this is built on and are not repeated here.

`public/atlas.png` was one 4096x8192 sheet, 8,176 frames, 12.7MB of PNG,
~134MB decoded, 56% occupied. It is now `public/atlas-0.png … atlas-6.png`,
each at most 2048x2048, and one `atlas.json` whose every frame carries the
`page` it sits on. `public/atlas.png` is not built any more; `npm run atlas`
deletes a stale one.

| page | size | frames | used | PNG |
|---|---|---|---|---|
| 0 | 2048x2048 | 987 | 82% | 1647KB |
| 1 | 2048x2048 | 1521 | 82% | 2631KB |
| 2 | 2048x2048 | 1658 | 83% | 2666KB |
| 3 | 2048x2048 | 1943 | 81% | 2746KB |
| 4 | 2048x1216 | 1854 | 72% | 1165KB |
| 5 | 2048x2048 | 191 | 75% | 1231KB |
| 6 | 2048x64 | 22 | 34% | 18KB |

23.6M pixels against 33.6M, 79% occupied against 56%, 12,105KB of PNG against
12,433KB. The number that matters is not any of those: it is that no single
surface is above 16MB decoded any more, where one was 134MB.

### What it bought, measured on the owner's machine

Three `npm run play -- hand 90 <dir> harvest` runs each side, and one
`play-trace.ts hand 30` each side, machine otherwise idle.

| | before | after |
|---|---|---|
| `Decode Image` (png) per ~30s of play | 35, median 337ms, 11.3s total | 1, 52ms, 0.1s |
| `GpuImageDecodeCache::UploadImage` | 36 | 1 |
| `DrawFrame` in the window | 6937 | 7063 |
| fps median | 242 / 242 / 238 | 242 / 238 / 242 |
| fps min | 222 / 154 / 104 | 222 / 200 / 234 |
| frames over 33ms | 82 / 74 / 101 | 12 / 30 / 10 |

**The frame rate does not move and was never going to** — this machine absorbs
the cost. What moves is the stall count, 74-101 down to 10-30, and the fps
floor, 104-222 up to 200-234. Those two ranges do not overlap, which is more
than the previous session could say about anything it A/B-ed.

Caveat when reading the traces: the BEFORE trace reports "152.2s of trace" in
its own header where the after reports 30.0s. 6937 presented frames at ~235fps
is ~30s, so that denominator is wrong and its per-second column is deflated 5x.
Compare counts.

### What was decided and why

- **2048, and not smaller.** The bench measured 2048 exactly as cheap as 1024
  at both loads. Below 2048 buys nothing and costs pages.
- **The packer is NOT arranged for locality.** Measured irrelevant. Frames are
  grouped only so the home screen's very large scenery (`scene`, `sceneBg`,
  `ranch`, `pen`, `vault`, `meta`, `portrait`, and the animated props
  `vatSpecimen`/`windmill`/`scarecrow`/`wheat`/`labConsole`/`tank*`) lands on
  pages 5-6 and the pages the renderer samples every frame carry only field
  art. That grouping is tidiness; a frame carries its page and every reader
  indexes by it. `base.*` is deliberately field — `maps.json` uses it for the
  lab map. So is `item.*`: `drawPickups` draws an item's card art as its
  ground pickup.
- **Page height rounds to 64, not to a power of two.** These are `drawImage`
  sources on a 2D canvas — no mipmaps, no wrap — and POT rounding turned a page
  needing 1216 rows into 2048, 43% full. 25.3M pixels became 23.6M.
- **The flash copy split for free**: one white silhouette canvas per page.

### Where the page index shows up

`Atlas` holds `images[]`, `flash[]` and `pageUrls[]`, loads the manifest first
(it says how many pages) then every page in parallel. `AtlasFrame` gains
`page`. The renderer's hot path is still one `drawImage`, no state change, no
allocation — `images[f.page]` is an array index beside five property reads the
loop already did. `src/ui/sprite.ts` gives each DOM sprite its frame's page url
AND that page's `background-size` through one `pageOf()`; its exported helpers
are unchanged and `card.ts`/`menu.ts`/`scene.ts` needed no edits. The nine
offline tools that used to open `public/atlas.png` go through
`tools/atlas-read.ts`.

### Evidence the pixels did not move

- `npm run shot -- 600 … harvest hand` is sha256-identical before and after,
  and again after wiping `public/` and rebuilding.
- `npm run strips` rewrote all 714 strips and `npm run catalog` every contact
  sheet with **zero diff**. That is the page indexing checked against 714
  files, which is better evidence than one screenshot.
- `npm run scene -- yard` is NOT deterministic — the yard has a timed CSS
  entrance, so two consecutive shots differ. Do not use it as an A/B.

### Two corrections made in passing

**`tools/play.ts` blamed the atlas for slow page load, and that was wrong.**
`tools/load-time.ts` (new) separates boot (`goto` → `window.rdf`) from art
(`goto` → `rdf.atlas`). A cold browser context takes ~81s and `rdf.atlas`
resolves **7ms** after `window.rdf` — the atlas fetched in parallel while vite
transformed the module graph. It is vite, not the art. Later loads: ~190ms to
boot, ~700ms to art; the atlas's own share went from ~750ms to ~490ms.

**`build-atlas.ts` had an error flush in the wrong place.** `errors` was
printed before the tileset and pack sections, so "tileset is incomplete" and
"the atlas does not fit" were pushed and never seen. There is a second flush
after the pack now. A build that previously shipped a holed tileset will fail.

`tools/atlas-bench.ts` can no longer open a 4096x8192 file, so it composes one
from `atlas-0.png` and round-trips it through `toBlob`; pointing condition (a)
at a page would have turned the experiment into 2048-vs-2048 and had it report
"no difference" forever. Re-run on this tree it still reproduces the original
result.

Unrelated and still true: `tools/animal-check.png` in the repo is stale
(2336x4590 committed against 2400x11352 regenerated).


## The farmhand takes off the player's hat

Session 20 filed it and session 21 filed it again, in the same words both
times: **enemy humanoids share the player's silhouette.** Same straw hat, same
blue dungarees, same 32x64, and the density pass put 2.2x as many of them on
the field. At wave 6 you cannot find yourself in the crowd. Two things were
wrong at once and they needed different fixes.

### The obvious fix was to generate a new character, and it was wrong

`docs/PIXELLAB_INVENTORY.md` holds four turned farmhands and **all four are
already claimed**: `9bcb41fd` is the superseded 40x40 first pass sitting in
`farmhand_orig/`, `7418d20d` is the sheet actually in use (confirmed against
the live account — walk 8f, hit 6f, death 7f, which is exactly what
`sprites.json` declares), `f6e8c1fb` is `bloatedFarmhand` and `371055e3` is
`acidZombie`. Nothing unclaimed, nothing in review. So the art we already own
gets repainted, and this session spent **zero generations**.

### tools/recolour-sheet.ts

Every pixel goes into one of four colour FAMILIES by its Oklab hue and chroma,
and each family is re-ramped onto blight anchors taken from the cursed block of
`art/palette.json` — the block that exists because "cursed art is grey-green
rot ... those greens must be DISTINCT from the healthy pasture greens".

    straw    the hat and its leather   ->  rotted brown-black
    denim    the dungarees             ->  rot-green work cloth
    flesh    mouth, wounds, blood      ->  still red, taken down
    pallor   skin, shirt, grime        ->  sick pale green, and BRIGHTER

Classification is by colour and never by position, which is the whole reason it
is cheap: one rule set covers all 88 frames of a four-direction rig without
anyone hand-masking a hat. Run `--mask` and look at the output — the hat, the
dungarees and the skin fall out of the hue boundaries almost perfectly, and the
few stray pixels read as grime. Two things are never touched: anything below
`INK_L` is outline and stays black, and the sickly yellow eye is already the
right horror cue.

**The reason it works is value, not hue.** The player is a bright hat over a
dark body. The farmhand is now a dark hat over a body darker still, with a pale
green head — the arrangement inverted, not merely recoloured. Hue is what you
notice at 8x in a contact sheet; value is what survives 32 pixels on a 520px
camera. Squint any wave-7 shot down to 25% and that is the whole difference.

Output is `assets/pixellab/character/farmhandBlight/`: identical filenames,
identical cells, identical strip widths, identical alpha. Only colours differ,
so every packed offset, measured anchor and clip length carried over untouched.
Committed rather than gitignored, the same call `assets/generated/characters/`
already makes — a fresh clone must be able to run `npm run atlas` without
first running every upstream tool. `npm run recolour` re-runs it.

### The other half: a mark the crowd never has

Repainting the enemy tells the eye what to rule OUT. It needed something to
hunt FOR as well, so the player now stands in a soft contact shadow with a
faint lamp ring round it — `Renderer.drawPlayerMark`, once per frame, in the
ground layer where the dash dust goes.

Deliberately NOT a per-enemy outline or tint. The sprite pass is one
`drawImage` per item with no state changes at all, and putting a stroke or a
composite mode inside it would cost the whole field to mark one entity. This
costs two shapes, allocates nothing, and puts `globalAlpha` back.

All ten numbers are in `tuning.playerMark`, and its `_restraintNote` is the
part worth keeping: this is a farm at dusk, not a MOBA. The shadow does most
of the work by GROUNDING him; the ring only has to survive a squint. Raise
`ringAlpha` before `ringWidth` — a thick ring reads as UI painted over the
world, a faint wide one reads as lamplight on grass.

### Where the sheet choice is stated, and why there

`enemies.json` gained `farmhand.sheets: ["farmhandBlight"]`. Which sheet an
enemy WEARS is content, `world.spawnEnemy` already read the field and
`tests/content.test.ts` already validated it, so nothing in `src/sim` changed.
The straw `farmhand` entry was DELETED from `sprites.json` rather than left
beside the new one — packing both would spend 88 frames on art nothing draws.
`art/sprites.json` cannot express "this sheet lives at that path": the packer
derives the directory from the sheet id (`${_base}${id}/`), so the sheet id IS
the path, which is why the directory is `farmhandBlight`.

### Still open from this

- **`bloatedFarmhand` and `acidZombie` still wear the straw hat.** Neither has
  the same problem — one is 60% belly, the other vivid green. But the hat is
  now the player's signature, and leaving it on any enemy weakens the rule.
  `npm run recolour` handles either in one command; a trial of the bloated one
  looked right. Design's call, not code's.
- **The arena's bottom edge is still a hard black band** below the boundary
  tiles. Session 20 filed it with the silhouette complaint; only one of the two
  is fixed.


---

# Session 21 — the balance session, and a stutter that was a debug guard

The owner played it split-screen while this ran and gave two verdicts: too easy,
and a stutter every 6-10 seconds. Both were real. Balance was given a free hand.

## The stutter was `assertUiLayersClickable`

It shouts when a UI layer holding controls computes `pointer-events: none` --
three screens have shipped unreachable that way, so the guard earns its keep. It
was wired to a `MutationObserver` on `#ui` with `subtree: true, attributes:
true`, re-checking on a microtask. **The HUD lives inside `#ui` and writes styles
every frame** — hp bar width, xp fill, cooldown sweeps. Every frame fired the
observer, and the check calls `getComputedStyle`, which forces a synchronous
style recalc. The game paid a full style flush per frame to ask a question whose
answer only changes when a screen opens.

CPU profile of a real run: **4.05s self, plus 2.54s inside `querySelectorAll`,
against ~28s of non-idle JS.** About a quarter of everything the game did,
second only to `drawImage`. Both are gone from the top 25 now.

**Three guesses were wrong first, and the order matters.** GC was ruled out (one
collection per run). The measuring tool was ruled out by QUADRUPLING its sample
interval and watching the ~0.9s spike period not move. The dev overlay was ruled
out and measured *worse* with it off — which is the result that ended the
guessing, because it proved run-to-run variance exceeds the effects being A/B'd.
A CPU profile named the function in one run. **When variance beats the effect,
stop swapping suspects and go get a profile.**

## The difficulty curve inverted, and one multiplier could not fix it

Baseline deaths over 64 harness runs clustered almost entirely before wave 12;
past that nothing could kill anyone. `waveScalar` is LINEAR while player power
COMPOUNDS through levels, six weapon slots and tier-4 merges.

Three single-lever fixes were measured and every one broke a guardrail
(`+0.004n^2` and `+0.002n^2` on `waveScalar`, `+0.004n^2` on hp alone). That is
the same wall the `threatBudget` note hit from the other direction: **the game
had no headroom, and no single multiplier buys any.**

What worked was the change that note had been asking for, made all at once:

- **`enemies.json`: hp x0.55, damage x0.55, threatCost x0.45.** Cutting cost
  harder than the other two is what buys BODIES rather than the same fight
  re-priced. With `groupInterval` 0.5-1.5s -> 0.3-0.9s so the director can emit
  them: kills per run ~1900 -> ~4000, enemies alive at death 8-22 -> 37-125.
- **A separate `waveHpScalar`, quadratic, on hp only.** Damage is the wrong
  lever and it was measured twice: multiplying incoming damage rewards flat
  damage reduction and punishes a low-hp dodger, so The Hand shrugged and The
  Kid fell to 30% cleared on a median wave of 8. Time-to-kill costs both classes
  the same.
- **Flat `hpRegen` rescaled by the same 0.55.** The subtle one, and worth
  remembering: **regen is an ABSOLUTE number, so halving enemy damage silently
  made every point of it nearly twice as valuable.** The Hand carries 1.5 and
  The Kid none, which alone failed class parity at a gap of 10 against 8.
  Raising The Kid's dodge was tried first and moved nothing — the gap was never
  about avoidance. Percentage defences (armour is `armor/(armor+k)`, braced DR)
  are scale-free and untouched.

    pilot           cleared          deaths
    hand/kite       75% -> 31%       w4 w9 w12 w12 w13 w15x4 w18 w19
    hand/brawler    75% -> 81%       w11 w21 w25
    kid/kite        75% -> 50%       w5x3 w12x2 w16 w20 w25
    kid/brawler     38% -> 56%       w4x4 w5 w12x2

Deaths land across the whole run now instead of piling up before wave 12, and
each class is still strongest at its own game — which `run.test.ts` explicitly
wants. **This is a first pass by bots that cannot dodge, aim or read an offer.
It wants playing.**

## A test that was measuring the wrong quantity

`Threshing Floor splashes when something dies in reach` asserted on
`damageDealt`, which does not count the chain. A chain that finishes an enemy
REMOVES weapon damage the run would otherwise have dealt, so the relic reliably
LOWERS the number the test demanded it raise — 36 kills for 397 damage against
28 kills for 504. It passed on the old enemy hp by luck and the density pass
tipped it over. It asserts on kills now.

## Standing directive from the owner: the locked classes

**The four unlockable classes should be notably different from each other — not
one better than another, but skilled in different areas and carrying different
powers.** Right now `widow`, `vet`, `agronomist` and `drifter` are variations on
two passives: three carry `braced` at different rates and three carry `momentum`
at different rates, with `digIn` or `bolt` bolted on. They read as stat spreads
of The Hand and The Kid rather than as their own answers to the game. This is a
design ask, not a tuning one, and it is the next balance-adjacent job.

## Both artboards are implemented

Design sync was abandoned as a route and it cost nothing: **all 69 sprite keys
the two artboards reference already resolve in the atlas** — checked with a
script, not assumed. Nothing was needed from Design that was not in the repo.

`lab` is a `SceneKind` alongside `yard` and `field`, and the yard is rebuilt.

**The placement table is the sprites. The scene is more than the sprites.** This
bit twice in one session and is the thing to remember:

- The lab came out as furniture floating in black, because the wall, the floor
  and the join between them are CSS in the artboard and `npm run placements`
  extracts SPRITES. The room is wall 0-496, a 26px junction band AT 496, floor
  below — which is the same horizon the previous handoff states as a rule
  ("nothing stands in y 496-556"). Drawing it as a band makes the rule visible
  rather than merely obeyed.
- The yard's fence came out as a row of smears. The table reports
  `scene.fencePicket` at 1960x32 because that is the BOX it fills; the sprite is
  a 96x32 TILE. **A width in the table is not always a size.**

The yard rebuild also settled an argument the old code had documented. The
previous yard deliberately disagreed with the placement table — the table put
the treeline at y 268-414, the ground began at 620, and three of four oaks hung
a hundred pixels up in the sky, so that session wrote "ground wins". The
Grounding Fix is Design's answer: **the horizon moved to 540** and the trees
stand on it. The table and the ground agree now.

What grounding turned out to mean in practice: every standing thing gets a
blurred contact ellipse pushed BEFORE it, so paint order puts the shadow under
the object. That is session 19's *"everything is in the air"* fix applied to
props rather than only animals, and it is most of why the scene reads as a place
instead of a collage. The treeline is blurred 2-2.4px and dimmed to 0.4-0.48
opacity — depth here is entirely blur and value, and a sharp tree at the back
reads as a prop standing in the yard.

`MenuScreen` held a BOOLEAN for the backdrop and could not express a third one.
It is `SCENE_CYCLE` now. That also fixes why every automated scene shot came
back as `field`: a fresh browser profile has no stored key, so a two-way flip
always landed the same side.

## What the scenes still want, and it is Design's call, not code

- **The class cards cover the lower third of every scene.** Joy, the wheat
  clumps and the bunkhouse are all placed under them in Design's own
  composition. Someone has to decide whether the artboards should compose around
  the UI or the UI should move.
- `scene.fencePicket` is still the re-opened blocker at 7 of 8; the near fence
  is LimeZu's tile. Closing it needs one wide shallow generation asked for as a
  THING — "a long low wooden rail fence filling the frame edge to edge", 400x64.
- **Enemy humanoids share the player's silhouette.** Same straw hat and
  dungarees as The Hand, at the same size, and the density pass put 2.2x as many
  of them on the field. This got worse, not better.
- **Enemy humanoids share the player's silhouette.** The farmhands wear the same
  straw hat and dungarees as The Hand, at the same size. With the density pass
  putting 2.2x as many of them on the field, this got worse, not better.
- `scene.fencePicket`, the `ranch.well`/`wellStone` naming reversal, the vat
  scale story call and `pen.chickenRunFlat` are all untouched.

---

# Session 20 — the game can be watched now, and it had never been

The previous handoff said the next session should be LOCAL, because locally you
can see and play the thing. That was the right call for a reason nobody had
measured: **nothing in this project could see the game at all.**

## Three separate blindfolds, all of them silent

**`npm run shot` does not use the renderer.** It drives `tools/draw-world.ts`,
which says so in its own header -- "It deliberately reimplements the renderer".
Nothing in `tools/` imports `src/render/renderer.ts`. As an independent check on
frame selection that is a good idea and it is worth keeping. As a way to look at
the game it is worthless, and it was the only way we had.

**`npm run scene` was photographing `<body>`.** Its stage locator
`.scene, #scene, [data-scene]` matched NOTHING -- the real root is
`home-yard is-<kind>` inside `.home-scene` -- and it fell back to the whole page
without saying so. Every "scene shot" ever taken was a full-page screenshot.

**And its `kind` argument was decorative.** It named the output file and could
not choose what rendered. `MenuScreen` ALTERNATES: `isField = last !== 'field'`
read off `localStorage['rdf.homeScene']`. A fresh browser profile has no such
key, so `null !== 'field'` is true and every shot was the FIELD scene. **That is
the "the home screen renders the FIELD scene" defect the last session logged.**
It was never a bug in the scene. It was a bug in where the camera pointed.

## The game only advances on a presented frame

The loop is `requestAnimationFrame`, so the sim advances only when a frame is
actually composited. Measured, not assumed:

| where | rAF ticks per second |
|---|---|
| the editor's hidden browser pane | **0** |
| headless Chromium, throttling flags off | 2-4 |
| headed Chrome, window covered | 2 |
| headed Chrome, window on top | **78-240** |

The owner independently reported the in-editor preview "choppy, like 5fps"
without knowing any of this had been measured. Same cause. **A hidden or covered
window does not run this game**, and the failure mode is silent: the sim sits at
wave 1, every keypress looks ignored, and it reads as a broken game rather than
a stopped clock. `main.ts` had already written the warning, in the comment on
`rdf.screens` -- "a rAF-driven game loop that a headless pane may never run".

Two Windows facts fell out of this, both measured here: playwright's bundled
`chromium-1234/chrome-win64/chrome.exe` is **permission-denied** on this machine
and fails with `spawn UNKNOWN`, so headed runs go through `channel: 'chrome'`;
and `spawn('npx', ...)` is ENOENT on Windows, which is why the scene tool was
simply dead the moment the project moved off the cloud sandbox.

## `npm run play` — a run, watched, through the real renderer

    npm run play -- [class] [seconds] [outDir] [seed]

Boots the real app in real Chrome, starts a run through `window.rdf.startRun`,
kites with real keyboard events, takes level-ups by the number key the game
already routes, leaves the shop by its own button, and reports everything off
`rdf.world` -- the sim's own counts, not a guess from pixels. Every sample
carries its own frame rate, so a report can tell a throttled window from a stuck
sim instead of leaving someone to guess between them.

It found two bugs in its own first two runs, and both are instructive:

- **A 6-minute run whose last 290 samples were byte-identical.** The level-up
  screen pauses the world and its root class is exactly `screen` -- no
  identifying name at all -- so `className.includes('levelup')` is always false
  and the card was never dismissed. Detection goes through
  `rdf.screens.*.visible` now. **The level-up screen having no distinguishing
  class is a real wart**; it is why nothing can target it, in CSS or otherwise.
- **A "stall" that was a death.** `World.step` returns immediately on
  `this.over`, set the tick the player stops being alive, but `finishRun` needs
  a frame before the results screen reports visible. In between, the sim clock
  is stopped and no screen is open, which looks exactly like a hang.

## The first balance evidence that came from the game

Two runs, The Hand, seed "harvest", identical settings. They are NOT identical
runs -- the bot's input is wall-clock driven, so it diverges. That variance is
itself the finding:

| run | reached | level | kills | ended |
|---|---|---|---|---|
| A | wave 6 | 9 | ~150 | **died at 155s** |
| B | wave 17 | 22 | 851 | ran out of clock at 480s |

Run B is the one to look at. **From wave 16 the player sits at 160/160 and never
drops again** -- full health through waves 16 and 17 while killing 851 things.
That is the classic bullet-heaven failure where the build outruns the threat
curve, and it happened to a bot orbiting in a fixed square that took offer 1
every single time without reading it. A build chosen at random should not become
untouchable two thirds of the way in.

**This does not settle balance and must not be used to.** The bot cannot dodge,
cannot read an offer and cannot aim; run A dying on wave 6 with the same inputs
shows how wide the spread is. Balance stays JOINT, as it has been all along.
What changed is that there is now evidence at all, and a way to generate more.

## Closed: the unexplained 404

`404 /favicon.ico`. There is no favicon in `public/` and `index.html` declares
none, so the browser asks for the default and vite has nothing to serve. Checked
directly against a dev server: `/favicon.ico` 404, `/` 200. Harmless, and no
longer an open question.

## Still open, unchanged

- Design's two rebuilt artboards, `Yard Grounding Fix.dc.html` and
  `Lab at Depth.dc.html`, are still UNIMPLEMENTED. `SceneKind` is still
  `'yard' | 'field'` with no `lab`. `npm run placements` already extracts both.
- `scene.fencePicket`, the `ranch.well`/`wellStone` naming reversal, the vat
  scale story call and `pen.chickenRunFlat` are all untouched.

## Two things to look at in the shots

Both from `tools/play/hand/`, and both are for Design rather than for me:

- **Enemy humanoids share the player's silhouette.** At wave 14 the farmhands
  wear the same straw hat and dungarees as The Hand, at the same size. Telling
  yourself apart from the crowd is not a nice-to-have in a bullet-heaven.
- **The arena's bottom edge is a hard black band** below the boundary tiles.

---

# Session 19 — why the title screens were wrong, and it was not Design

Claude Design produced three landing scenes that the owner called horrible, and
was right to. The interesting part is that **both defects were in this repo's
helpers**, and Design had been given no way to know.

## Everything rendered at the same size

`spriteEl(name, box)` snaps to **whole-pixel zoom**. That is correct for a card,
where a 20px gun at 1.7x is a blurry gun, and it is fatal in a scene.

Every animal in this game is authored on the 32x64 grid, because in the game
every entity IS a grid cell:

    wiz       (a cat)         16x42        hand      (a grown man)   30x52
    brahmaHen (a hen)         26x43        blackMule (a mule)        28x63
    joy       (a bulldog)     29x42        fjordPony (a pony)        25x53

Six things within a few pixels of each other that are nothing like the same size
in life. Integer zoom pins all six to 1x, so `spriteEl('joy', 40)` returns 40px
tall and `spriteEl('fjordPony', 96)` returns **53px**. The box argument was
being silently discarded above 1x, and no choice of numbers could have fixed it.
That is the bulldog the size of a pony, and it took reading `spriteEl` to see
it — the scene code looked correct.

`sceneSprite(name, height)` scales fractionally and hits the number. Nearest
neighbour keeps it crisp, and a scene is composited once at a fixed size rather
than scrolled past a moving camera, so the half-pixel seams the game camera
would show never appear.

## Everything floated

No sprite had a contact shadow, and actors were positioned by `top`. A `top`
says where a head is and nothing at all about where a thing stands. The owner's
words were *"everything is in the air"*, which is exactly the symptom.

`groundActor` takes a `footY`, adds one soft ellipse, and sets `z-index` from
the ground line so back-to-front sorting is free. The ellipse is the whole fix:
the eye reads ground contact from the shadow before it reads placement, and no
amount of correct placement substitutes for it.

## The catalog had no scale, and raw canvas is a third scale again

`docs/ASSET_CATALOG.md` listed frame keys and clips and **no sizes at all** for
the cast. The building tables listed raw canvas, which is its own trap:
`ranch.barn` is 400px wide, `ranch.coop` 128 and `ranch.windmill` 128 — a
chicken coop drawn at a third of a barn, and a windmill drawn the same as the
coop when a windmill is taller than a barn is wide.

Every table now carries a **`draw at`** column derived from what the thing
actually is, against one stated reference: **a grown person is 64 pixels tall**,
so 36.6px per metre. Small animals sit deliberately above life scale — a cat at
true scale is 9px and unreadable — but the ORDER is always right.

## The animation gap was real and it was ours

The owner asked Design to lean on the animated assets. It had four.

    prizeBull   attack, death, hit, walk, walkHurt, idle   8 directions   <- an ENEMY
    fjordPony   graze (3 dir), idle
    joy         attack (1 dir), sit (3 dir), idle
    brahmaHen   peck (4 dir), idle
    16 others   idle ONLY

**Every enemy in the game is fully rigged and the cast the title screen is made
of was not.** The catalog said `*static*` against sixteen rows and Design
believed it, correctly. Tier 5 in `docs/ANIMATION_PLAN.md` had this filed as
"$0.53, scene-only, nice to have"; it is the difference between a diorama and a
farm, and it is re-costed at $1.09 for walk on the whole cast.

Walk is the clip that matters, not the ambient ones — it is the only one that
reads at any size or distance. Landed this session, eight directions each:
fjordPony, arabian, blackMule, beigeMule, rosie, joy.

## Ambient world motion, and where to put a one-direction loop

A title screen is carried by things that move without being looked at. A
windmill turning, wheat swaying, a scarecrow shifting. All three objects already
existed, so each cost an animate call rather than a generation.

They fit nothing that was here. The animal pipeline wants eight compass folders;
the fx pipeline emits `fx.name.i` on a centre pivot. `sceneClips` packs them
under the same `sheet.clip.dir.frame` keys as everything else, with the single
direction spelled `down`, so `clipsOf`, `stripUrl` and `groundActor` need no
special case.

**Packed untrimmed, and that is load-bearing.** `stripUrl` bottom-aligns and
centres each frame in a uniform cell, which is right for a walking animal whose
silhouette barely changes. A windmill's blades change their extents every frame,
so a trimmed box would shift frame to frame and the tower would wobble under its
own vanes.

Watch the name collision: `windmill.spin` moves, `ranch.windmill` does not.

## Per-map dressing, and a wall that is a terrain

`Renderer.buildScenery` and `paintDecals` each carried a hardcoded list of farm
props, which is how the first bunker preview came out with a plough and a grave
marker on a concrete floor. Fog, overhead art, breakable skins and the ground
were already per-map; the dressing was the one layer that was not, so every new
biome inherited a barnyard. It is data now, and the five surface maps are
unchanged to the pixel — asserted, not claimed.

The arena edge can be a `wall` instead of a `fence`, and the wall is a **Wang
terrain, not a run of stamped sprites.** That is the whole reason the corners
work: corner autotiling already turns a band into a room, where sprites need a
hand-written case per corner and then another one the first time a map is not a
rectangle.

`boundary.inset` is the only part that touches the sim and it defaults to 0. The
player clamp, node and breakable scatter, hazard placement, the scenery band and
the decals all add it, and `rng.range` costs one draw whatever its bounds — so a
surface map draws the identical numbers it always did.

Two things the shots caught that the descriptions did not: **a wall the same
pale as the floor reads as nothing at all** (two tilesets wasted before
regenerating near-black), and oil drums standing on the wall band.

## World takes a forced map now

`new World(seed, class, mods, tier, forceMapId)` overrides the map draw's RESULT
and never the draw, so a forced run sits at the identical stream position. It is
the only way to reach a weight-0 map — `pickMapId` can never return one — so
photographing the preview vault previously meant editing content and remembering
to put it back. `npm run shot -- ... --map=<id>` uses it, and the level system
will need the same door.

## Two generation lessons worth carrying

**"Seen from below" is not a view the model has.** All three ceiling pieces
asked for that way came back near-empty. Asked for plainly and treated as
overhead by the RENDERER, they came back right first time. Overhead is a
renderer decision, not a prompt.

**A map-object is not a tile.** Every one comes back outlined all the way round,
so eight in a row read as eight bricks and never as a wall. That cost a
generation to learn. Things bolted ONTO a wall are what they are good for.

## Open

- Cats, hens, rooster and chick still need walk/peck. Queued as credits allow.
- The perched crow cannot be animated: `status: review`, generated and paid for
  and never claimed, and `animate_object` refuses a source that is not
  `completed`. **Claiming is free.**
- `public/fonts/rdf-bunker-stencil.ttf` is committed and referenced by nothing.
  Same pattern: made, never picked up.
- The level exit (blast door / lift) is art-complete and engine-absent.
- Per-map enemy rosters for the base — the farm cast currently spawns in a
  bunker. That is Tier 4 and the owner has said balance is a joint session.

---

# Session 17 — the flash, the roster, and what a dollar buys

Overnight, unsupervised, with the owner's approval to spend and to add systems.
**$1.22 of $15 spent.** Five things landed, and two of them were bugs that had
been shipping for a while.

## The white flash was eating the game

The owner's own playtest screenshots showed wave 15 with 266 enemies where most
of the crowd rendered as **solid white silhouettes**, and the wave-12 boss could
not be seen at all while being fought. Two causes, six lines apart.

`e.flash = C.hitFlashSeconds` sat OUTSIDE the `if (!fromDot)` guard in
`damageEnemy`, so every burn tick, bleed tick and hazard tick re-armed it. A
burn ticks several times a second per enemy, so a 60ms flash never expired.

The second cause survives fixing the first: once a build is up, direct hits also
land faster than 60ms. Re-arming on every one makes the flash a fill, not a
blink.

The tell was sitting right underneath it the whole time. The spark immediately
below was already rate-limited, with the comment *"so a late wave reads as
combat rather than as a wall of white."* Somebody saw the exact failure, fixed
it for the sparks, and did not notice the flash — which is the thing that
actually fills the sprite.

DoT no longer flashes, and a `flashLock` refractory caps the duty cycle at
60/(60+160) = 27%. **Measured after: mean 0.9% of live enemies flashing, worst
frame 20%.** Both numbers are in `tuning.json`, because which one to turn
depends on whether crowds still wash out or single hits stop registering.

Three pools were also pinned at capacity and silently refusing: particles
900/900 with 23,824 dropped, damage numbers 64/64 with 35,233 dropped, hazards
64/64. `props` was 120 against boneOrchard's 140 node maximum, so the biggest map
could not finish scattering its own field. Now 2400 / 256 / 192 / 320.

## Five enemies were already in the atlas

`arabianCursed`, `donkeyCursed`, `draftMuleCursed`, `fjordPonyCursed` and
`infectedHen` were complete 8-direction rigs — walk, attack, death, idle, 224
frames each — **sitting in the shipped atlas wired to nothing.** 1,120 frames,
26% of the packed page, bought in an earlier session and never drawn.

They went in at waves 3, 8, 13, 16 and 19, weighted to the back half, because
that was the actual gap: the last new enemy arrived at wave 14 and **waves 15–25
introduced nothing at all.** Half of every run was the same eight things with
bigger numbers.

### The NaN that ate the spawner

Adding a `_lateRosterNote` to `enemies.json` took the entire acceptance suite
down, and the mechanism is worth writing down because it is silent and total.

`ENEMIES` only ever stripped `_bosses`. Every other underscore key survived into
the roster as a fake enemy with no `firstWave` (so `refreshRoster` never filtered
it) and no `threatCost` — and `1 / Math.sqrt(undefined)` is NaN. **One NaN makes
`weightedIndex` return garbage for every enemy**, so the director stops spawning
and a full run reports zero kills. The file had never carried a top-level note
before, so nothing had ever triggered it.

`defsOf` already existed for exactly this, and its own comment records the bug
biting twice before. Enemies now go through it.

## The acceptance tests were measuring their own sample size

This came up **three times in one session**, so it is now written down properly.

The clear rate was surveyed over 40–60 full runs each time: **60%** before maps,
**55%** on the unchanged Home Field alone, **62.5%** with the expanded roster. At
a true rate near 60%, six seeds fail a 50% bar about **one time in five on a
passing game.** Twice that turned the suite red for no reason at all, and the
reflex both times was to go tuning the game.

`SEEDS` is now 24 and `CROSSOVER_SEEDS` 32. **Both bars are untouched** — a
bigger sample against the same bar is strictly harder to pass by luck. The
parity tolerance became `ceil(n/3)` rather than a hardcoded `2`, which is the
same third-of-the-sample it always was and was about to become four times
stricter by accident.

## Two real balance findings, one fixed and one not

**Fixed, because it was mine:** `donkeyCursed` shipped one pass as
`knockbackImmune` + `flank`. A flanker that cannot be pushed off is aimed
squarely at the one class whose kit is standing still. The control measured The
Hand's preference for holding ground at **21-vs-11 without these enemies and
26-vs-21 with them** — the gap halved, and this one card was why. Knockback
restored.

**Not fixed, because it is not:** that same control settled something bigger.
**The Kid's class identity is already gone.** Kiting scored 15 against 15
standing still *without any of tonight's enemies*. The class whose damage scales
with velocity currently has no measurable reason to move, and it predates
tonight's work. It belongs in the play session, not in a commit made while the
owner was asleep.

## What a PixelLab dollar actually buys

Every figure measured with the balance read either side:

| | USD |
|---|---|
| map-object, 48px | $0.0070 |
| map-object, 128px | $0.0078 |
| animate-with-text-v3, 8 frames | $0.0343 |
| Wang tileset (32px, 16 tiles) | ~$0.017 |
| 8-direction character, standard mode | ~$0.01 |

**Size is nearly free** — 1.10× the cost for 7.1× the pixels. The repo's standing
"generate small, candidates are free money" advice optimises the *subscription
generation counter*, which is a different currency and is at zero until Sep 14.
On credits there is no size penalty.

The subscription is **active, not cancelled**, and the key is **not dead** —
`docs/PIXELLAB.md` says both and both are wrong. What is true is that the 4,710
monthly generations are spent.

## The floor lesson, learned twice in one night

Ten Wang tilesets generated. **None wired**, and that is the finding.

The first family went out at `highly detailed` with decorative nouns —
wildflowers, plates splitting. At 32px, detail becomes a **repeating motif**: the
pasture tiled into visible polka dots and the hardpan into red brickwork with
the enemies unreadable on top of it. `tuning.json`'s `_chosenNote` already
recorded exactly this about `dirt_to_grass`, with the reason spelled out — *the
ground is what two hundred enemies are read against.* It was overridden anyway.

The second family, at `low detail` + `flat shading` + `lineless` +
`tile_strength 0.4`, is much better and the sprites read against it — but still
carries a faint repeat that `dirt_to_grass_plain` does not. So the Home Field
stays on the ground it was tuned on, because it is the control, and all ten sit
packed as stock to be chosen in motion.

**Rule, now in `maps.json`: for ground, ask for LESS.**

Related, and worth correcting: **the ground was never LimeZu.** Those 29 Wang
sets were generated off the account earlier. What IS still LimeZu is five
manifest groups — `weapons` (8), `animals` (duckFlight), `vehicles` (the
Duster), `singlesExtra` (pickup.heal) and the yard `scene` — and a generated
replacement for every one is already on disk, unwired. That is the whole
remaining retirement job.

## The crops are ours now

Ten field crops swapped from the LimeZu pack to the generated set that had been
sitting unwired since session 15, picked by contact sheet. The pack entries were
**deleted, not left alongside** — two groups writing one frame key is the trap
this repo has hit before and the later one wins silently.

They are 32×32 where the pack crops were 32×64, because the pack drew a whole
plant with its soil and these are the fruit alone, which is what a 13px harvest
radius wants. Blighted variants for five of them are picked and on disk but
deliberately unwired: swapping crop art mid-run changes what a map looks like
and belongs in the play session.

## Props can animate now

`Renderer.propFrame` draws `sprite.N` when the atlas holds a loop for that key
and falls back to the single static frame when it does not — so **adding motion
to a prop is an atlas change with no code and no content edit.** Phase comes
from world position rather than a per-prop timer, because props are pooled and
have no animation state, and forty crops swaying on the same frame reads as the
screen refreshing rather than as wind. The headless painter mirrors it exactly,
phase included, or a screenshot would be a picture of a different program.

Ambient loops run at 8fps against combat art's 15. At 15 a crop flickers.

## Four animals from the owner's actual farm

The white Fjord pony with the cream mane, the bay Arabian with the golden mane
and tail, Job the tan-and-white bulldog, and Wiz the black cat with green eyes —
each an 8-direction rig for **one generation** via the quadruped templates.

Those templates also expose presets for walk, run, eat, dying and — the useful
one — **`hit-left` and `hit-right`**, which means hit reactions stop being custom
animation work entirely.

**Known defect:** the Fjord's *west* rotation came back on an opaque grey card.
Unwired, so nothing ships broken, but it needs a `remove-background` pass first.

Standard mode is visibly flatter than the existing cursed animals, which were
made with `create_8_direction_object` at 20–40 generations. For animals this
personal, the richer path is probably worth $0.09 apiece — that is a look-at-it
decision, not a measurable one.

## Open, in priority order

1. **The Kid's identity** — measured at zero, predates tonight, needs the play
   session.
2. **The rest of the owner's roster** — two more mules, Rosie, three more cats,
   and ten chicken variants, wanted both as scene characters and as corrupted
   enemies, with the hen flock varied rather than one hen repeated.
3. **Choose a ground** in motion from the ten packed sets.
4. **Retire the last five LimeZu groups** — all replacements already bought.
5. **Hit reactions** — the preset exists, the sim needs a `hit` clip slot.
6. **Destructibles and the magnet** — designed in the plan, not started.
7. **The Fjord's grey card.**

---

# Session 16 — maps

Five maps. A run picks one, and it changes the ground, the field, the roster
and the arena's shape. Plus the merge that was not a merge.

## The brief was wrong about the repository, and checking cost four commands

The session opened with an instruction to merge three divergent heads using a
file-by-file map in `docs/MERGE.md`, then a warning: *a document about the world
is evidence, not the world.* The warning applied to the instruction.

```
git branch -a                  # 3 branches, none named session-14-16-maps-caves-archive
git cat-file -t 6c379013       # not a valid object name
git diff ec41be6a 18ec1b03     # empty. identical trees: 249538987b62b6…
ls docs/MERGE.md               # does not exist, and never has in any commit
```

`origin/main` and `origin/claude/pixel-labs-credit-plan-ufnx41` are the same two
commits authored twice — same messages, same trees, different SHAs. There was
nothing to merge, and nothing was lost by not merging. Also checked and already
true: the GitHub description no longer says "private", the homepage already
points at the Pages URL, and `assets/pixellab/yard_picked/` (barn, farmhouse,
silo, oak) was already on `main`, added by `77158591`.

The named-but-absent work was substantial: a `groundLayers` layer system, a
`src/render/blight.ts`, `npm run maps`, `npm run snap`, a `docs/progress/`
archive, 147 tests. None of it exists in the tree, in any commit, in the reflog,
in a stash, or among the unreachable objects (`git fsck` finds one dangling
commit — an August 14 home-screen fix, superseded). The owner's call was that it
was never built. **This session built the maps part from
`docs/NEXT_SESSION.md` §2, from scratch.**

The general lesson is the one already written down, so this is only a second
data point: the cost of checking was four commands, and the cost of not checking
would have been a day of trying to resolve conflicts in files that do not exist.

## What a map is

`src/content/maps.json`. Five of them, each changing all four things §2 asked
for: ground and tileset, node and enemy mix, arena size and shape, hazards.

| map | arena | ratio | ground | biome node | hazard |
|---|---|---|---|---|---|
| The Home Field | 2400x1600 | 1.50 | dirt_to_grass_plain | — | none |
| The Salt Flats | 2900x1300 | 2.23 | grass_to_palegreygreen | salt rock | gas |
| The Scrapyard | 1700x1700 | 1.00 | dirt_to_gravel | scrap heap | oil sump (slow) |
| The Burn | 1700x2350 | 0.72 | ash_to_dyinggrass_v2 | ash stump | fire (damage) |
| The Bone Orchard | 2300x1700 | 1.35 | earth_to_pasture | bone heap | grave gas |

The Home Field is weighted 2 against 1 for the others, and is **exactly** the
game that was played and liked — same arena, same nodes, same roster, no
hazards. It is the control, deliberately, so that "is this map worse" always has
an answer.

Each map carries its own blight chain, so the ground degrades differently: the
Salt Flats goes pale grey-green to grey earth to dead ground to cold ash, the
Burn is already ash at wave 1 and is cold ash by 20.

## The map is the first draw off the run RNG

`docs/NEXT_SESSION.md` called this the one hard constraint, and it is:

```ts
this.rng = new Rng(seed)
this.mapId = pickMapId(this.rng.next())   // exactly one draw, before anything else
```

Exactly one `next()`, before the spawner, the pools or the field scatter. It has
to be first because arena size feeds the spatial grid, which is built before the
field is scattered; and it has to be exactly one draw because the cost in stream
position is what every later draw is measured from.

`arenaW`/`arenaH` stopped being field initialisers and became constructor
assignments to make this possible — a field initialiser runs before the
constructor body, so it cannot see a map that the constructor picks.

Two tests pin it, and both fail if the pick moves or costs a second draw. They
were checked by mutation, not by assumption: inserting one extra `rng.next()`
before the pick fails both.

**Every pre-existing seed now replays as a different run.** That is unavoidable
— a draw at the front reseats the whole stream — and `NEXT_SESSION.md` had
already granted it. `run.test.ts`'s "replays a whole run identically from its
seed" still passes, because it compares two runs of the same seed rather than a
recorded transcript.

## Three things measured that were not guesses

### The maps did not break the acceptance test; the sample size did

After wiring, `run.test.ts` failed at 2 of 6 seeds cleared against a bar of 3.
The reflex reading is "maps are too hard". The measurement says otherwise —
60 runs of the real harness:

```
homeField    11/20  (55%)   <- unchanged content, the control
theBurn       7/13  (54%)
saltFlats     5/10  (50%)
scrapyard     7/10  (70%)
boneOrchard   6/7   (86%)
TOTAL        36/60  (60%)
```

The **unchanged** map clears 55%. The whole game, with maps, clears 60%. The
test asks 6 seeds to resolve a ~55% rate against a 50% bar, which is a coin
flip with extra steps — at p=0.55, six samples fail the bar about one time in
five, and always did. Reseeding the stream simply moved which fifth we were in.
`run.test.ts` was not touched: it is byte-identical to `origin/main` and it
passes.

The first pass genuinely was too hard on two maps, and those were fixed — see
the `_tuningNote` in each. theBurn measured 21% against a 32% baseline on the
first pass, boneOrchard 29% against 55%. Both are now in band.

### Arena AREA was a stealth difficulty knob, and it inverted a class

The one real regression maps introduced. `run.test.ts`'s crossover test — each
class does better at its own game — inverted: The Kid, whose damage scales with
velocity, started preferring to stand still.

```
                         handStand  handRun  kidRun  kidStand
original code (16 seeds)     12        7       12       7      correct
maps, first pass (32)        20       19       15      20      INVERTED
maps, area held (32)         22       16       20      23      passes
```

The cause was not hazards and not the enemy mix. It was that the first pass
varied arena **area** along with shape — theBurn at 4.75M px² and boneOrchard at
4.32M against the Home Field's 3.84M — and a class that needs enemies to run
past deals nothing on a field big enough to run into empty ground.

**Shape is the feature; area is a confound.** Every map now sits within about 4%
of 3.84M except the Scrapyard, which is small on purpose. The five ratios are
0.72 / 1.00 / 1.35 / 1.50 / 2.23, so the maps still play completely differently.

### `maxLive` was not the hazard density, and the hazards were invisible

Both painters were drawing the ambient hazards correctly and there were almost
none to draw. Two separate mistakes:

1. **Density is `life / everySeconds`, not `maxLive`.** One spawn per interval
   living `life` seconds settles at that ratio and never approaches a cap of 9.
   The maps were configured for 9–14 and were running 1–3.
2. **They spawned anywhere on the arena.** The view is about 520x330 and the
   arena is nearly four million square pixels. Measured: an ambient hazard was
   on screen **0% of sampled seconds**. It was a tax rolled over the horizon.

Fixed by making the density relationship explicit in the content file — and
writing it down there, because the next person will otherwise set `maxLive`
again — and by spawning in a **ring** around the player rather than uniformly:

```
theBurn      avgLive 5.4   on screen 80% of the time
saltFlats    avgLive 4.9   on screen 80%
scrapyard    avgLive 4.5   on screen 85%
```

The ring is the load-bearing half. At this density a uniform scatter would still
be invisible; putting hazards just past the edge of sight and within a short
walk is what makes "this map vents gas" learnable instead of merely survivable.

## Hazards damage both sides, and that is the design

`dps` and `playerDps` are separate numbers and both are usually non-zero. A fire
on the Burn does 26 to enemies and 6 to the player. That is deliberate: a hazard
that only punishes is a tax, and a hazard you can drag a hog into is a tool. It
also means the ambient maps measure *easier* than the Home Field for a kiting
bot, which is worth watching in a real playtest — a human who fights rather than
runs may find them the opposite.

`playerSlowPct` is new and separate from `slowPct`. `slowPct` has only ever
slowed enemies; the Watering Can's rind slick is a player tool and had to keep
behaving exactly as it did. Only the Scrapyard's oil sumps set the player one
(45 to enemies, 30 to the player). `Player.move` gained a `slow` parameter that
defaults to 0, so every existing caller is untouched, and `velocityFraction`
stays measured against the *unslowed* move speed — a Kid bogged in a sump should
read as slow, because it is.

## One source of truth for the ground

`TUNING.terrain` is gone. It moved into each map rather than being copied,
because two content files naming the same ground is the same trap as two art
groups writing one frame key: the later one silently wins and nothing tells you
which is live. `tuning.json` keeps a pointer and the reasoning that picked the
Home Field's pair.

`tools/draw-world.ts` had its **own** copy of the terrain constants — its own
`GROUND_SET`, its own `BLIGHT`, its own `groundSetFor`. Its file header says a
screenshot that disagrees with the game is the thing it exists to avoid, and it
was one edit from doing exactly that: still reading `tuning.json`, it would have
painted all five maps as the Home Field. Both painters now read
`world.map.terrain`.

## Art

Seven frames added, all from candidates already on disk — nothing generated,
the subscription is still dead. Picked by looking at a contact sheet, not by
filename, and the filenames would have picked wrong three times out of seven:

- `node_scrapheap_2` is an entire fire truck. A vehicle, not a scatterable node.
- `node_saltrock_1` is magenta and reads as amethyst, not salt.
- `node_boneheap_0` is a single skull-and-crossbones icon; this wanted a heap.

The four biome nodes are declared in `nodes.json` at **weight 0** and raised by
whichever map wants them, so all the numbers stay in one file and a map that
says nothing gets exactly the field the game always had.

`damage` hazards had no colour of their own and fell through to the acid green,
which had never mattered because nothing in the game raised a bare `damage`
hazard. The Burn's fires do, and an acid-green fire is a lie about what is
hurting you. They burn orange now, in both painters.

## A test that could not fail, and was deleted

While hardening the scatter loop against picking a weight-0 variant, a test was
written to cover it and then **mutation-checked**: reverting the fix left the
test passing. The reason is arithmetic — `roll` is `next() * totalWeight` with
`next()` in [0, 1), so with integer weights the loop always breaks on the last
weighted entry and the old fallback was unreachable. A second attempt using
fractional weights also could not fail: the two versions diverge only when float
error exceeds the gap to `totalWeight`, which needs `next()` to land in the last
~1e-16 of its range.

The test was deleted rather than kept. A test that passes under the bug it names
is worse than no test, because it reads like coverage. The hardened code stayed
— `maps.json` is a content file and `"weight": 2.5` is one edit from making the
arithmetic argument stop holding — and the code comment now says plainly that it
is defensive and deliberately untested.

Every other new test was mutation-checked too. Moving the map pick one draw
later fails two of them.

## What is now open

**The whole balance conversation, and it is explicitly not for a session alone.**
`NEXT_SESSION.md` says play it *with* the owner, and three tuning passes were
already needed just to get the maps into a sane band. Those passes were about
making new content not-broken, not about tuning the game, and the line should
stay there.

Carried forward, in the order they will matter:

1. **Density is still the top ask**, from the playtest note that predates this
   session: *"Needs more enemies per wave to balance."* Untouched. `enemyBias`
   now gives a per-map lever that did not exist before, which may be a better
   place to spend the change than `pressureCeiling`.
2. **Ambient hazards measure as a net help to a kiting bot**, because they
   damage enemies and a bot that never stops rarely stands in one. A human who
   holds ground will experience the opposite. Worth an early look — if it holds
   up, `playerDps` is the knob, not density.
3. **The Bone Orchard clears 86% on a small sample.** It may simply be the easy
   map. Wanted: more samples, or a human.
4. **The `threatBudget` split is still there** — hardcoded in `formulas.ts`
   while `waves.json` carries a `formula` string nothing reads. This session did
   not touch it, and it is still the thing that turns the next balance session
   from editing code into editing content.
5. **The Salt Flats' ground reads as stripes** at 32px. Same wallpaper problem
   `tuning.json` recorded about `dirt_to_grass`; `grass_to_greyearth` has a
   visible horizontal repeat. A different set from the packed 29 would fix it.
6. **The mud sprite is brown-on-brown** inside a brown sump disc and barely
   reads. Legibility, not correctness.

## Verification

```
npm run atlas      4283 frames, 2048x8192 — +7, dimensions unchanged
npm run typecheck  clean, game and tools
npm test           154 passed (131 before, +23 maps)
npm run shot       all five maps, looked at, all five draw
```

`run.test.ts` is byte-identical to `origin/main`. The acceptance bar was not
moved to land this.

---

# Session 15 — the account is spent, and the handoff is honest again

Two jobs: convert the last of a dying subscription into art, and leave the
repo readable by someone who was not here. **Balance went 259 -> 0.** 247
images landed. **None of it is wired, on purpose.**

## Why nothing was wired

Same calculus as session 13, and it is worth restating because it looks like
laziness from the outside: credits expire, engineering time does not. The
account died at the end of this session. Wiring is available forever; the
generations were available for one more afternoon. So the afternoon bought
art, and the wiring is the next session's — which is also the session that
can *look* at each sprite in a real run, which this one could not.

The corollary is that `art/sprites.json` is untouched. Packing an unreviewed
pick is precisely how a wrong sprite ships silently here, and that has
happened before.

## What the money bought

| directory | subjects | what |
|---|---|---|
| `assets/pixellab/yard/` + `yard_picked/` | 18 | the whole home-screen scene |
| `assets/pixellab/field/` | 28 + 19 | crops, the 8 weapon sprites, the duck, hazards, biome nodes, blighted crop variants |
| `assets/pixellab/field2/` | 5 | retries of what the first pass got wrong |
| `assets/pixellab/duster/` | 4 facings | the wave-25 boss |

That covers essentially everything LimeZu still supplied except the terrain
sheet, which needs no art at all — 29 Wang sets are already packed.

## `/map-objects` costs a twentieth of what session 13 paid

The single most useful measurement here. `POST /v2/map-objects` is **1
generation**; `create-1-direction-object` is **20**, for art of the same
quality. It also takes a non-square `image_size`, which is what a 400x224
barn needs and what the square-only endpoint cannot do. Session 13 spent
roughly 2,000 generations through the expensive path on the belief that it
was cheap, recorded in `docs/PIXELLAB.md` as "cheap; returns 16 candidate
frames". That row is now corrected.

Three related things, all measured rather than assumed:

- **Candidate count moves with size at the same price**: 32px returns 64
  candidates, 64px returns 16, 96-128px returns 4, above ~160px returns one.
  The cheapest way to get choice is to generate small.
- **`remove-background` costs 1, not free** as the docs claim.
- **Rejections are free.** `detail` is a validated enum and I sent
  `"highly detailed"` instead of `"high detail"` — 20 calls 422'd for zero
  generations. A cheap probe before a big batch genuinely costs nothing, and
  that is how the 400px size cap got established too.

## Everything large comes back on a card

Every subject generated at ~400px returned a framed illustration on a solid
opaque ground. Every subject at <=160px came back cleanly cut out. The barn,
house, silo and oak all needed `remove-background`, which is why
`yard_picked/` exists as a separate directory from `yard/`.

**Protect before you write.** Session 13 made the opposite mistake — re-cut
the coop from its carded candidate *before* protecting it — so the de-card
pass writes to a staging copy here and the raw candidates stay raw.

## What the model ignored

Worth recording because it is a prompting limit, not a fluke:

- **The duster ignored the requested facing about half the time**, even with
  LEFT and RIGHT capitalised and "seen from directly behind" spelled out. 22
  candidates across four facings gives enough to pick four genuinely
  different views, but the filenames cannot be trusted.
- **"Blighted" needed to be said several ways.** A first pass asking for a
  "rotting pumpkin" returned a healthy orange one. Naming the absence —
  "no healthy colour", "grey and mouldy", "collapsed" — at guidance 18 was
  what worked.
- **`ui_panel` produced one usable candidate out of twelve.** Eleven came
  back as blank parchment with no frame at all. A panel is a shape, and the
  endpoint wants to draw a subject.

## The handoff was lying, and that was the real blocker

`HANDOFF.md` said "current as of session 12" and its outstanding list still
asked for work finished in sessions 13 and 14 — item 3 wanted sixteen animals
packed that are packed, item 6 wanted a gas cloud wired that is wired.
`docs/NEXT_SESSION.md` was still the session-12 brief, "make the field
frightening", every item of which is done. And `HANDOFF.md` sends a cold
reader to `NEXT_SESSION.md` **first**.

So a new session following the documented reading order would have redone two
sessions of finished work before writing a line. Both are rewritten. This is
the failure mode of a per-session handoff file: it is the highest-leverage
document in the repo and the one nobody re-reads after writing it.

## The playtest, and the one thing it changes

The owner played it: *"I plaed it and it was great."* Two findings:

- **More enemies per wave.** And critically, **performance is not the
  limit** — they ran 200+ enemies alive several times and *"it all worked
  great"*. `pressureCeiling: 380` is a design choice to revisit, not a frame
  budget.
- **The class dropdown is untested.** Six classes ship, some have never been
  played.

Found while checking that first note, and it is the thing that makes tuning
awkward: **`threatBudget` is hardcoded in `src/sim/formulas.ts`** as
`30 + 22*wave + 1.4*wave*wave`, while `waves.json` carries
`threatBudget.formula` as a string that **nothing reads**. The content file
describes the curve; the code is the truth. `waveScalar` has the identical
split. Since the owner's first tuning ask is density, the first move of that
session is to read those coefficients from content — which CLAUDE.md's
no-balance-constants-in-code rule requires anyway. Not done here, because it
belongs to the session with a person at the controls.

## Tools kept

Three drivers moved out of `/tmp` into `tools/`, reading `PIXELLAB_API_KEY`
from the environment rather than a scratchpad path: `npm run mapobject`,
`npm run rmbg`, and `npm run contactdir` (which tiles a directory of raw
candidates at an integer zoom — 32px art cannot be judged at 1:1, and every
review pass this session needed it). The first two cannot run again without a
new account. They are kept as the record of what works and what it costs.

---

# Session 14 — the art goes in

Session 13 bought raw material and wired none of it, deliberately. This
session wired it. The subscription is still being cancelled; balance went
322 -> 277, and every generation spent here was spent fixing something the
wiring exposed rather than buying anything new.

## The camera question, settled

The owner asked whether `high top-down` was an option, since the handoff
kept warning about camera mismatch. **It is** — `low top-down`,
`high top-down` and `side` on objects, characters and tilesets alike, and
`create-1-direction-object` takes `top-down` or `sidescroller`. Verified
against the live OpenAPI schema, not from memory.

But the project already chose, deliberately, in `docs/ART_STYLE.md`: low
top-down, "because **horror needs a face** — a high top-down view looks at
the top of its head". Someone had already run the experiment too;
`assets/pixellab/object/barn_dog_hightopdown/` is a full ring, and the
difference for an animal is marginal.

**And the warning it was raised against has dissolved.** `_howToWireIt`
said "the mismatch is CAMERA ANGLE, NOT SCALE" about PixelLab animals
against *LimeZu's* animals. LimeZu's animals are deleted now. What matters
is that the animals match the PLAYER, and both are low top-down.
`npm run scale` puts them on one baseline and they agree.

## The enemy roster

feralDog, rooster, sickHog, blownSheep and prizeBull are the cursed
animals, with walk, attack and death in eight directions. The rooster swap
also fixed a wrong-species bug — its LimeZu sheet was drawing a hen.

**Eight directions needed a second rig family, not a manifest entry.**
`atlas.json` carried ONE global rig, `[down, up, left, right]`, and
`directionIndex` indexed straight into it. Sheets now declare their own
list (`dirSets`); a sheet absent from it uses the rig's four, so the six
classes and five humanoid enemies were untouched. Four keeps its
comparison — that list is not angle-sorted and the comparison is what
biases toward the side views — while eight is a single rounded division.

**The atlas needed a shape change, not a size one.** At `width = 1024` the
animals take it to 1024x16384. The area is fine; the dimension is not.
Widened to 2048: same pixels, `2048x8192`, both dimensions inside limits
everywhere.

## Three silent traps, all caught by looking rather than by a test

1. **The frame key is the enemy TYPE ID, not the `sheet` field.** The first
   swap changed `sheet` in enemies.json, which is read by nothing. The art
   packed, the game drew the old sprite, nothing errored. Caught by taking
   a screenshot.
2. **`src/content/index.ts` destructures `_bosses` by name and treats every
   other key as an enemy.** A one-line `_artNote` in enemies.json was
   spawned as a monster and took out seven tests.
3. **`scale-check` ignored `drawScale`** and reported the boss at trash-mob
   size, producing the confident and wrong claim that "the bull is about
   player height". It is 2x and dwarfs the player. A comparison tool that
   omits a transform the renderer applies is wrong with authority.

## What the corpse timer is coupled to

Death clips play now, but only the boss lingers, and the reason is worth
keeping: **`s.update(dt, this.enemies.live)` feeds the spawner the enemy
count INCLUDING corpses inside their `dying` window.** Holding bodies half
a second instead of 0.2 throttles spawning, and the "merging beats taking
whatever came up" balance test caught it at 16 waves against 26. So trash
mobs play the clip inside the existing 0.2s and only prizeBull gets
`deathSeconds: 0.8` — one corpse, no pool pressure.

## Picking 1,900 candidates

The median silhouette: take every candidate's content bounds, take the
median area, pick the closest. Both failure modes sit at the extremes.

**The grid of all picks earned itself immediately** — it showed three props
on opaque white cards, which no area heuristic can see because a card is a
perfectly ordinary area. The corner test catches them: a cut-out prop has
transparent corners on its content box, a carded one has opaque ones.
Where *every* candidate was carded the fix was `remove-background`, not a
better pick. (Measured: that utility costs 1 generation, despite the docs
calling utilities free.)

**Nothing hand-picked was overwritten.** A prop with art in `picked/` and
no entry in `art/prop-picks.json` is left alone. One ordering mistake
worth remembering: `--write` re-cut a repaired prop from its carded
candidate before I protected it. Protect, then write.

## The ground

`tuning.terrain.blight` bands the ground by wave — pasture, then withered
grass at 9, rot at 15, cold ash at 21. Bands rather than a blend because a
Wang set is a whole terrain pair; you swap and re-bake. Safe because the
bake already had **its own RNG stream**, separate precisely so "the ground
must not move a single later spawn".

## The rest of it

**The attack clips play.** I had stopped on this saying the charge
behaviours own the `t0`/`s0` scratch and their wind-up state is not
exposed. True, and the wrong conclusion: the fix is not for the renderer
to decode private state, it is for the sim to say something the renderer
can use. `e.attackT` is that — a behaviour says "the attack starts now"
and never learns the clip length. `charge` fires it on the tell,
everything else on the contact hit, because the chasers have no attack
state at all. Cosmetic, so unlike the death timer it needed no balance
concession.

**Scenery is on the field**, eighteen props, renderer-owned rather than
sim-owned because scenery has no behaviour. Placed in a band near the
edges, and that is a constraint not a taste: they carry no collision, and
walking through a water trough in open field would read as a bug.
Scattered BEFORE the draw list is sized, because `push()` returns null
when full and every caller breaks — under-sizing silently drops whatever
sorts last.

**The fence is real art** instead of a `strokeRect`, and flat decals are
baked into the terrain. Only flat things are baked: a decal can never be
walked behind, so it loses nothing by having no y-sort.

**Threshing Floor was the last `_standInArt` item** and now has the
generated chain lightning arc. That flag is zero across the whole content
set.

**And the screenshot tool was lying about the camera.** `draw-world`
centred on the player with no clamp while `Camera.clamp` bounds the real
one, so shots near an edge showed ground beyond the fence that the game
never lets you see. Found by looking at a fence screenshot and asking
what the flat green band was.

## Both of those got done, and the reason they were cheap

**`/map-objects` costs ONE generation and takes any aspect ratio.** That is
the single most useful thing learned this session. Every prop this project
generated went through `create-1-direction-object` at TWENTY apiece, and
that endpoint only accepts a square `size`. So the ~120 generations spent
on unusable square rarity badges were not merely the wrong shape — they
were on the wrong endpoint by a factor of twenty.

**The rarity plate** is one 192x32 steel banner, measured against the real
destination this time (a 30px plate across a 210px card). One plate, not
six: `card.css` already expresses every tier through `--tier-colour`, so
the banner is blended OVER that gradient and all five rarities plus the
plain-steel rank variant keep working with no per-tier art. Eight
generations, including two first attempts that came back as a dirty white
board and a flat bar — what makes a plate read as struck metal is
STRUCTURE, a bevelled rim and rivets, not surface noise.

**The FX are ours and animated.** `animate-with-text-v3` turns a finished
still into eight or nine frames for ONE generation, the cheapest thing on
the price list. muzzle, gas, dust, explosion and slash replaced; seven
generations for the set including two new stills.

They are deliberately NOT conformed to the house palette, unlike the pack
FX. Conforming exists to drag a bought sheet onto our palette; these never
left it, and the palette is authored for terrain and creatures with no
coverage for an electric blue arc. Quantising would send those pixels
somewhere absurd — the "explosion turning magenta" failure already on
record.

**A detector that had to be measured rather than guessed.** The animator's
failure mode is a last frame that collapses to a flat block of colour, and
it would have flashed a filled rectangle over the game on the last frame of
every shot. Bounds cannot catch it: an effect legitimately fills its
canvas, and frames 0-2 of that same muzzle flash do. Measured, the good
frames are 43-56% transparent with about twenty colours and the bad one is
7% with four — so the test is both conditions together, and a dense
explosion is never mistaken for a failure.

**One stale note corrected:** the queue claimed "nothing in the game
renders gas". `playFx('gas')` has always been there and the pack had a gas
clip. The generated one replaces it rather than filling a hole.

# Session 13 — spending the subscription down

The owner is cancelling PixelLab. The brief was to burn the remaining
generations on whatever is most valuable, most important first, so that
anything we run out of money for is small.

**The framing that decided everything:** credits are use-it-or-lose-it,
engineering time is not. So the job was never "improve the game with
credits". It was **acquire raw material that can only be made while the
account is live, and leave every bit of wiring for later**. Nothing was
wired this session on purpose. Wiring works forever; generating does not.

Started at **2,096 of 4,710** remaining (Tier 2, resets Sep 14). Ended at
about **334**. Roughly **1,760 generations spent**, and a further large
pile recovered for nothing.

## The best thing done this session cost zero generations

**Auditing the account against the repo.** `GET /v2/objects`,
`/v2/characters` and `/v2/tilesets` enumerate everything the account
holds, and a lot of it had never been downloaded. It would simply have
vanished.

- **17 environment objects** from 2026-08-18 — six dead and dying trees,
  eleven boulders, rocks and stones with ore, crystal and rot. That is
  most of the "trees and rocks/minerals" work session 12's handoff asked
  for, already paid for and forgotten. They also map straight onto
  `nodes` and `nodeTrees`, which are LimeZu rocks and LimeZu trees.
- **The four `rotten` livestock**, three of them already carrying full
  eight-direction walks with the right clip names — "a jerky twitching
  strut", "a slow bloated waddle", "a laboured stagger". These are the
  finished infected enemies, not the mildly-diseased first attempt.
- **15 tilesets**, ten of them one family chained off a single grass on
  the low-detail/lineless recipe: cold ash, grey-green rot, withered dead
  grass, dead ground, gravel, muddy water, tilled soil, four bare earths.

**Check the account before generating anything, ever.** Nearly a third of
what this session "needed" already existed.

## The perishable asset is the object ids, not the balance

This is the one thing worth carrying forward. A downloaded PNG is ours
forever. But `create_object_state`, `animate_object` and
`create_8_direction_object`-with-a-`style_object_id` all take an **id
that lives on PixelLab's servers**. Once the account lapses you cannot
derive a new state, rotation or animation from anything already
generated — the animal has to start again from nothing.

So derivations went first, and `art/pixellab-queue.json` `_accountLedger`
now records every id the account held, against the repo path it landed
in. After cancellation that block is history rather than a menu.

## What the money bought

**221 generations of animation**, which was overwhelmingly the best value
on the price list.

- Seven rings had rotations and no walk. `animate_object(mode='v3')` is
  **one generation per direction**, so a full eight-direction walk is
  eight. Six cursed animals and the rotten hen now walk.
- **Ten attacks and ten deaths**, per species rather than shared, because
  at eight generations each there is no reason to share one. Every enemy
  in the roster now has walk + attack + death. The two player minions —
  Barn Dog and Whitacre Bull — got attacks too; they are summons that
  fight and had only a walk.

**~1,520 generations of map objects**, 76 of them across four waves, each
wave ordered so a shortfall would cost scenery rather than substance:

1. Crops healthy and rotted (corn, wheat, pumpkin, cabbage), the horror
   props and their healthy twins, then landmarks last.
2. Pickups — `xp_seed` was a flat coloured square — plus the gas cloud,
   which matters because `gasImmune`, `trailGas` and `gasGrace` have all
   been in the sim with nothing ever rendering gas. Plus a chain
   lightning arc for Threshing Floor, the last `_standInArt` item left.
   Plus barn, farmhouse and bunkhouse.
3. Field dressing and the FX set the game never owned — muzzle flash,
   dust, sparks, heal glow, level-up burst.
4. Biome props, ground decals, and the six stamped-metal UI plates that
   ART_STYLE explicitly sanctions generating because CSS cannot make
   metal look struck.

## Things measured this session, that cost real money to learn

**Size decides how many tries you get, and the price does not change.**
32px returns **64 candidates**, 64px returns **16**, 96–128px returns
**4** — all for the same 20 generations. `_modelNote` said this about
`create_image_pro`; it is true of map objects too. Generate small and
draw at an integer zoom unless the subject genuinely needs the pixels.
The pickups and FX bought 64 tries each; the buildings bought four.

**A 1-direction object never reaches `completed`.** It parks in `review`
holding its candidates in `frame_urls` until a frame is selected. The
first driver polled for `completed` and would have burnt its whole
timeout on every batch with the work already done and paid for.
`tools/pixellab-frames.ts` pulls all the candidates plus a contact sheet.

**A job status is a claim about a job; the object is the artefact.**
The first animation driver trusted `GET /background-jobs/<id>`, read a
single 404 as "finished", and reported arabian_cursed complete at 8/8
with two directions on disk. Verify against the object — ask which
directions actually carry frames — and re-fire the rest. That is also
what makes retries automatic, and retries here are routine: one attack
POST came back 500 and the identical retry landed 8/8.

**`GET /v2/tilesets/<id>` cannot be used by hand.** Unlike the create
response it returns no spritesheet and no bounding boxes, only sixteen
loose base64 tiles. `tools/pixellab-tileset.ts` composes the sheet and
synthesises the boxes from the grid it lays out, which is safer than
trusting supplied ones — the box is true by construction.

## What is now waiting, and none of it needs a subscription

This is the whole point of how the session was spent. **The backlog is
unpacked art, not missing art.**

- **76 map objects** with every candidate kept and a contact sheet each.
  Picking is free: `npm run cut -- single <sheet>/<name>_NN.png
  assets/pixellab/picked/<name>.png`.
- **Twelve animals** with walk, attack and death in eight directions, and
  ten more with walks — still none of it in the atlas. `_howToWireIt` in
  the queue has the direction mapping measured and the four-vs-eight call
  is still a judgement, not a measurement.
- **29 tilesets** against a terrain bake that reads one hardcoded pair
  from `tuning.json`.
- The 17 recovered trees and rocks are a drop-in replacement for the
  LimeZu `nodes` and `nodeTrees`.

`npm test` 131 passing, `npm run typecheck` clean, `npm run atlas` packs
1859 frames with all 29 tilesets present — the build fails on a Wang set
missing any of its sixteen corner combinations, so that is the proof the
recovered sets are whole.

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

## Two enemies were wired into the game with no art at all

`baseOperator` and `baseBreacher` shipped fully specified — stat blocks in
`enemies.json`, spawn weights in both sector maps (`1.0`/`1.4` and `1.2`),
behaviours, `teaches` strings, PixelLab object ids recorded — and neither was
ever declared in `art/sprites.json`. Neither had one packed frame. Both would
have walked into the lab as **plain coloured rectangles**: a wave-12 flanker and
a wave-18 shield tank, drawn as boxes.

Nothing caught it, and the reasons are worth keeping:

- `tests/maps.test.ts` asserts a biased enemy is a *defined* enemy. They were.
- The renderer degrades a missing frame to `null` and draws the fallback box
  rather than erroring — the same forgiving path that makes a fresh clone
  render squares until `npm run atlas` runs.
- `docs/SESSION_STATE.md` listed both object ids under "generated", which reads
  as done. **A recorded id means the art exists on PixelLab's servers, not that
  it exists in this repo.** Those are different claims and the ledger only makes
  the first.

### `def.sheet` is vestigial and lies

Chasing this down surfaced a second thing. The sim does not read the singular
`sheet` field in `enemies.json` at all — `world.ts` sets
`e.sheetId = def.sheets?.[n] ?? typeId`, the plural array or the type id. The
singular field disagrees with the packed art for six enemies: `farmhand` claims
`"zombie"`, `feralDog` claims `"dog"`, `sickHog` claims `"pig"`, `maskedSprayer`
claims `"gas_enemy"`. None of those sheets has a single frame in the atlas, and
all six of those enemies render perfectly.

It is left in place — it is content, it is harmless to the running game, and
deleting a field across the roster is a bigger change than this. But it is a
loaded gun for anyone reasoning about which art an enemy uses, and it fired
twice in one session: it produced a wrong diagnosis of the missing humanoids and
then a coverage test that reported eight false positives on its first run. If
you want to know what sheet an enemy draws, read `world.ts`, not `enemies.json`.

### The fix, and the guard

`baseOperator`'s walk was **already generated** and had been sitting on the
account unclaimed — four cardinals, eight frames, `scary-walk` — so cutting and
packing it cost nothing. `baseBreacher` had rotations but no animations; four
template directions closed it. Measured cost: `generations_used` 4715 → 4719 and
credits unchanged at **$11.99**. The whole roster gap was essentially free,
which is the inventory lesson again in a new costume.

`tests/content.test.ts` now asserts that **every enemy any map can roll has
`idle` and `walk` packed for every direction its sheet declares**, reading the
built atlas rather than mocking it. Two scoping decisions in it were earned:

- It resolves the sheet the way the sim does. Using `def.sheet` reported six
  working enemies as broken.
- It checks `idle` and `walk` only. Everything above them in the renderer's
  chain — `hit`, `attack`, `walkHurt`, `death` — returns `undefined` when absent
  and falls through by design, which is what lets the roster gain clips one
  animal at a time. `humanoidFrame` is the last link and has nothing to fall
  back to, so those two are the real floor. Checking every clip reported
  `fjordPonyCursed` and `prizeBull` as broken for partial `walkHurt` rings that
  are working as intended.

All five underground humanoids now also carry a `drawAt` of 64 — the same
grown-person height as the six player classes. None of the five had one, so the
lab scene had no published height for any of its cast.

## The drums were carded, and a card is a scale bug

`vault.drumRank` and `vault.drumScatter` came back with an opaque fill behind
them. The cosmetic half of that is well documented. The half that was not:
**100% opaque means the alpha content box is the canvas, so `npm run scale`
measures the card.** `drumRank` is 253x58 of drums floating in a 300x180 canvas;
carded, the table published it at 210x126 against a true 210x48 — 2.6x too tall,
on a number whose entire purpose is to be trusted without re-measuring.

The card is a flat fill touching the border, which means it does not need the
API. `npm run decard` floods 4-connected from the edge at a colour tolerance and
removes exactly it — free, offline, deterministic, and repeatable by anyone
without a key. It refuses rather than guesses when the border region is under
15% of the canvas, and it reports enclosed pockets of card colour instead of
cutting them, since a pocket is as likely to be a highlight as a gap. `npm run
rmbg` stays as the API fallback for a background that is textured or graded, at
one generation per image.

Checked on both drums by rendering them over magenta and looking: no grey halo,
outlines and stencilled numbers intact, and the semi-transparent contact shadows
under `drumScatter` survived. Derived heights afterwards were 210x48 and
190x115, against 210x49 and 190x115 measured independently by Design — two
methods agreeing to a pixel, which is the only reason to believe either.

### A red test was pushed and reported as green

`gives every scale entry something real to scale` was failing on this branch
before any of the above, and the previous session's write-up says "204 tests
passing". It was not. The failure was introduced the moment the nine ambient
loops were given `drawAt` entries, and it went out with them.

The test's intent was right; its lookup was one shape short. A scale key can
point at art in three ways, and it knew two:

| shape | example | packed as |
|---|---|---|
| a still | `ranch.barn` | the key IS the frame key |
| a cast sheet | `fjordPony`, `vet` | `<k>.idle.down.0` |
| **an ambient loop** | `vatSpecimen`, `wheat` | `<k>.bubble.down.0`, `<k>.sway.down.0` |

An ambient loop has no `idle` — its clip is whatever the loop was named — so all
nine reported as pointing at nothing while all nine were packed and drawing
fine. Matching any packed frame under the key's own prefix covers all three.

**Checked that the widened test still fails**, by feeding it `ranch.barnn` and
`vatSpecimenn`: both are caught. A guard that has been relaxed until it passes
is worse than no guard, and the only way to know which one you have is to break
it on purpose.

The lesson is not about the lookup. `npm run scale` prints `not packed,
skipped: wheat, scarecrow, windmill, labConsole, vatSpecimen, ...` on every
single run — the exact nine keys, in the exact order the test reports them. The
tool had been saying so all along and it read as routine.

## Nobody could look, and that was the whole problem

Every scene failure this project has had traces to the same gap: there was no
way to see a title screen without a human opening a browser. `npm run shot`
photographs the SIM — it drives `tools/draw-world.ts`, which is canvas and knows
nothing about the home screen. The scenes are DOM, built by `src/ui/scene.ts`.
So Design built them blind, I reviewed them blind, and the owner was the only
pair of eyes in the loop. "Everything is floating on the horizon" and "Joy is in
the black silhouette where you can't see her" were both caught by a person,
late, after the work had shipped.

`npm run scene -- [kind] [out.png] [ms]` closes it. It starts the real dev
server, drives the real app in Chromium, waits for the animation loops to run so
a walk is caught mid-stride rather than on frame 0, and writes a PNG. It also
reports console errors and failed requests, which is how the first run turned up
a 404.

**It is not a re-implementation of the scene, and that is the point.** A second
renderer that agrees with itself proves nothing — that lesson is already in this
file under the cross-renderer agreement tests, and it applies double here.

### The dependency

`playwright`, dev-only. CLAUDE.md requires a reason written down, so: this
environment already ships Chromium at `PLAYWRIGHT_BROWSERS_PATH`, the package is
a driver rather than a bundled browser, it is never imported by `src/`, and it
adds nothing to the production build. Against that, it removes the one review
step in this project that could only be done by a human with a browser open.

One trap worth recording. The browser store's directories carry the BUILD number
the environment shipped (`chromium-1194`) and the npm playwright expects the
build IT was published against; when they differ you get "executable doesn't
exist" with downloads disabled. The tool resolves the binary by listing the
store rather than assuming the conventional path.

### What the first shot showed

The live home screen renders the FIELD scene, not the yard, and the defects the
owner reported are all visible in one frame: the farmhouse and barn stand on a
hard horizon with the wheat band starting abruptly across their footings, the
distant treeline is a row of small sprites on that same line, and the class
cards cover the lower third of the composition. Design's two rebuilt artboards
address exactly these, which is the next piece of work.
