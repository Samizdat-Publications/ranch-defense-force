# Home screen: the sequence, the blight, and the descent — handoff

Branch `worktree-agent-ac16dfe61a144f5c5`, worktree
`.claude/worktrees/agent-ac16dfe61a144f5c5`. Nothing is pushed. This session was
cut short by a usage limit, so this file is the state of it rather than a
finished NOTES entry — fold it into `NOTES.md` and delete it.

**This branch has NOT seen the atlas split.** It still expects a single
`public/atlas.png` and `atlas.json`. The integration branch it will be merged
onto has `atlas-0..6.png` pages; `src/ui/sprite.ts` and `src/core/atlas.ts` were
deliberately left untouched here so that merge is clean.

---

## What works, verified

All five commits below are on the branch. `npm run typecheck` passes; `npm test`
passes 205/205 (656s); `npm run blight` reports every mapping resolving; real
screenshots taken through `npm run scene` at three window sizes with no console
errors and no failed requests.

### 1. The page was wider than the window — root cause found and fixed

`#stage` was `width: 100vw; height: 100vh`. **On any display whose device pixel
ratio is not a whole number, `100vw` is wider than
`document.documentElement.clientWidth`.** Measured on the owner's machine,
maximised Chrome, dpr 1.5 on a 2560px panel:

    document.documentElement.clientWidth   1707
    a probe element at width: 100vw        1707.33

So the stage overhung the right edge by a third of a CSS pixel and the document
rendered 2561 device pixels wide on a 2560 device pixel screen. `#dev` is
`position: absolute; right: 0` inside it, so it hung off by that much — and the
root has `overflow: hidden`, so there was no scrollbar to say so and no way to
scroll to it.

Fixed by `#stage { position: fixed; inset: 0; overflow: hidden }` — the initial
containing block IS the viewport, exactly, at every ratio. `resize()` in
`main.ts` now reads `documentElement.clientWidth/clientHeight` rather than
`window.innerWidth/innerHeight`, which include the scrollbar gutter and round.
`MenuScreen.fitScene` reads the same. `#dev` also gained `max-width: 100%` and
`overflow-wrap: anywhere`, because its width is data — it is as wide as the
`<select>` carrying every id in `ENEMY_IDS`.

Verified at 1920x1080, 2560x1440 and 1920x1080@1.25: `scrollWidth ===
clientWidth` and `#dev`'s right edge lands exactly on `clientWidth` in all three.
`npm run scene` prints those numbers on every shot now and warns on either.

### 2. Dev overlay hidden in production

`DevOverlay.visible` is `import.meta.env.DEV`. F1 and backtick still toggle in
every build. The toggle also writes `data-dev` on `<body>`, which the scene
selector reads — see below.

### 3. The cards got out of the scene's way

The owner's decision on the open Design question: **the artboards keep their
composition and the interface moves.** Measured before: the rail's cards ran
y 734–1028 in stage space with the selected card's gold band to 1040, over a
footbar at 1054 — 294px of card over Joy, the coop, the bunkhouse's foot and
three of the four wheat clumps in the yard, and over the consoles, the jar shelf
and the barrel stacks in the lab.

Now 200px (a shade over two thirds) at `bottom: 46`: rail y 837–1034, gold band
to 1044, footbar at 1054. Ten clear pixels, nothing off the stage. Measured live
at 1920x1080 and 2560x1440. The portrait window went 120 → 68 and the plates go
in at **zoom 1 rather than 2** (`heroCard` in `menu.ts`) — the plates are 63–64px
tall, so 64px of portrait with four pixels of headroom, whole-pixel and crisp.
Locked cards (the acres price boards) were re-measured with everything else.

### 4. The sequence

`SCENE_CYCLE` is gone. `MenuScreen` runs a state machine of chained timeouts —
no rAF, no per-frame JS; every visible change is a CSS class or transition.

| Beat | ms | What |
|---|---|---|
| `calm` | 4600 | The surface scene as it was |
| `flash` | 640 | Three white strikes (`y-lightning` in home.css). The blight is dressed at 440ms so the white lifts off a changed farm |
| `blight` | 7000 | The longest hold — it is the only frame that says what the game is about |
| `down` | 3000 | The column travels; `.home-column`'s transition matches |
| `lab` | 8000 | |
| `up` | 3000 | Back up into the OTHER surface scene, calm, and around |

**No thunder sound.** `public/audio` and `src/content/audio.json` were checked —
there is no lightning or thunder cue and none was generated.

The column is one tall strip: surface at 0, 520px of soil (`SOIL_H` in
`scene.ts`, published to CSS as `--soil`), lab below it. Both scenes are live the
whole way. The soil is two tiled ground layers (`terrain.dirt` topsoil over
`terrain.soil` subsoil — measured averages rgb(170,143,90) and rgb(102,68,60), so
the pack already carries the geology), a blurred seam, a depth gradient, six
`cave.branches*` roots and six `node.rock*` stones off a **fixed table, never the
run's RNG** (the map draw is the first draw off the seeded stream), and one
`base.wallPipes` conduit running the whole way down.

`prefers-reduced-motion`: the flash step is skipped entirely and the pan becomes
a 240ms fade out / move / fade in (`.home-scene.is-cutting`), not a teleport.

### 5. The scene selector

Top right of the stage, in the print language of `home-ui.css`, and it **ships**
(its predecessor was a dev-only cycling button). A pick jumps with the right
transition — surface↔lab is the descent/climb, surface↔surface is a swap — stops
the sequence dead for the session, and persists to `rdf.homeScene`. A persisted
`lab` starts the next load at the lab's hold and carries on upward.

It collides with `#dev` by construction: `#dev` is anchored to the **viewport**
and the selector to the **scaled stage**, so no fixed pair of coordinates keeps
them apart at every window size (90 CSS px of dev panel is 101 stage px at a
1707px window and 216 at an 800px one). `body[data-dev='on'] .home-scene-pick {
top: 150px }` drops it below.

`DOOR` (the Homestead hotspot) tracks the showing scene and is moved on the
element rather than by re-rendering the interface — during a descent the move is
**delayed** to `BEAT.pan - 900` so its 900ms glide lands as the room does instead
of hanging in the dirt for two seconds. Verified live: yard 1292,644 / field
1404,574 / lab 948,500, opacity 1 in all three.

### 6. Lab actors

`patrol()`'s wrapper carried `step-end`, and **`step-end` on a transform does not
travel — it holds and jumps at the keyframe.** That is the owner's "treadmill":
every figure played its eight-frame walk on the spot and then teleported three
hundred pixels. The yard's `wander()` had `linear` from the start; the lab was
written a session later and did not. It is `linear` now.

The consequence is that the `-path` travel windows must line up with the
`-wl`/`-wr` opacity windows to the percent, or a figure slides while standing.
Two of three did not (`haz` 62% vs 64.01%, `guard` 54% vs 56.01%) and are fixed.
The scientist (`baseTech`) is retimed from 47s to 26s as an **errand** — stand at
the consoles, walk 280px left to the specimen vats, stand, walk back, stand
longest at the consoles. 36% of the clock is travel where Design had 3.8% (1.8
seconds of movement in three quarters of a minute). The hazmat suit's leg is 10%
instead of 6.1%, so it covers its aisle at 73px/s rather than 120.

---

## The actor → blight mapping

Every key asserted against the real `public/atlas.json` by `npm run blight`
(`tools/check-blight.ts`), which walks the same fallback ladder `blightStrip`
does and reports which rung each actor lands on. **All resolve.** Output:

| actor · dir | clip asked | resolves to |
|---|---|---|
| brahmaHen · downRight | peck | `brahmaHenBlight.walk.downRight` (9f) |
| brahmaHen · down | peck | `brahmaHenBlight.walk.down` (9f) |
| leghornHen · down | walk | `leghornHenBlight.walk.down` (9f) |
| beardedHen · down | walk | `beardedHenBlight.walk.down` (9f) |
| silkieHen · down | walk | `silkieHenBlight.walk.down` (9f) |
| barredHen · down / left | walk | `barredHenBlight.walk.*` (9f) |
| polishHen · down / left | walk | `polishHenBlight.walk.*` (9f) |
| farmRooster · down / left | walk | `farmRoosterBlight.idle.*` (**1f — a still**) |
| tabbyCat · left | walk | `tabbyCatBlight.idle.left` (**1f — a still**) |
| fjordPony · downRight | graze | `fjordPonyCursed.walk.downRight` (9f) |
| fjordPony · left | walk | `fjordPonyCursed.walk.left` (9f) |
| joy · downRight | sit | `joyBlight.idle.downRight` (**1f — a still**) |
| joy · right / left | walk | `joyBlight.idle.*` (**1f — a still**) |

The field's baked `scene.*` strips keep their BOX (the reference's placement) and
get the turned figure scaled to it, bottom-aligned:

| baked strip | resolves to |
|---|---|
| `scene.farmerIdleBreatheStrip` | `farmhand.idle.down` (1f) |
| `scene.farmer2IdleBreatheStrip` | `bloatedFarmhand.idle.down` (1f) |
| `scene.farmerWalkStrip` | `farmhand.walk.left` (8f) |
| `scene.chickenPeckStrip` | `infectedHen.idle.down` (1f) |
| `scene.chickenWalkLeftStrip` | `infectedHen.walk.left` (9f) |

**`farmhand`, not `farmhandBlight`.** This worktree's atlas has only `farmhand`
and `bloatedFarmhand` — checked, no `farmhandBlight` key exists here. The
integration branch is said to carry `farmhandBlight`. **On merge, rename the two
`farmhand` entries in `BLIGHT_STRIP` (`src/ui/scene.ts`) and in `STRIP`
(`tools/check-blight.ts`) to `farmhandBlight` and re-run `npm run blight`.**
Those are the only two places the name appears.

`BLIGHT_SHEET` also carries `buffHen`, `bantamHen`, `rosie`, `wiz`, `ouiji`,
`siameseCat`, `blackMule`, `beigeMule`, `arabian` — packed and correct, but no
current scene asks for them. They are there for when one does.

### Fell back to the CSS filter (no counterpart art)

`saturate(0.25) brightness(0.78) sepia(0.55) hue-rotate(55deg)`, composed into
each element's **inline** filter rather than left to a stylesheet rule — half the
scene already carries an inline `filter` and an inline declaration beats a class,
so a rule in home.css would have silently done nothing to exactly the layers that
most need it.

The windmill, the scarecrow, the wheat, every `ranch.*` building plate, the oak
treeline, the tractor, the fence, the hay, the silo, the barn, the house, and
`scene.scarecrowSwayStrip`.

**The scarecrow specifically.** `docs/PIXELLAB_INVENTORY.md` lists
`rdf-scene-scarecrow-wrong` — four candidates of "a scarecrow gone wrong",
generated and paid for — and **none of them is claimed**, so none is in
`art/sprites.json` and none is in the atlas (checked: no key matches `/wrong/i`).
Claiming is free. Packing it is a separate job with an API key in it. **Zero art
was generated this session**, per CLAUDE.md.

---

## Screenshots taken (all `tools/play/home/`, gitignored)

All at settle 2500ms — at 1600ms the card rail's `card-in` stagger and the
Homestead button's 860ms delay are still mid-flight and shots come back with
cards missing. That is a photography artefact, not a defect; the live probe
confirms 6/6 cards and the door at opacity 1 in every scene.

| file | what | window |
|---|---|---|
| `01-yard-calm.png` | yard, calm, whole window | 1920x1080 |
| `02-yard-blight.png` | yard blighted — green sky, pale dead sun, porch and barn lights still warm, every animal turned | 1920x1080 |
| `03-pan-soil.png` | parked mid-descent: topsoil, subsoil, roots, stones, conduit, lab below | 1920x1080 |
| `04-lab.png` | lab, consoles/jars/barrels clear of the cards | 1920x1080 |
| `05-field-blight.png` | field blighted, turned farmhands and infected hens | 1920x1080 |
| `06-yard-2560.png` | yard calm | 2560x1440 |
| `07-lab-2560.png` | lab | 2560x1440 |
| `08-yard-dpr125.png` | yard calm | 1920x1080@1.25 |

`npm run scene -- <kind> <out> [ms] [phase] [scene|page] [WxH[@DPR]]`. `phase` is
one of `calm flash blight down lab` and parks the sequence there via
`localStorage['rdf.homePhase']`; timing a screenshot against a 640ms flash is a
race nobody wins.

---

## Not done / next steps

1. **The `farmhandBlight` rename on merge.** Two call sites, listed above. This
   is the one thing that will silently degrade rather than error: `stripUrl`
   returns null, the layer is skipped, and the blighted field quietly has fewer
   people in it. `npm run blight` catches it — run it after the merge.
2. **Claim `rdf-scene-scarecrow-wrong`** (4 unclaimed candidates, already paid
   for) and pack it, then add `scarecrow: '<claimed name>'` to `BLIGHT_SHEET`.
   Do not generate a fifth one.
3. **Screenshots of the cards on the field and the lab at 2560** were not taken
   before the session ended; `06`/`07` cover yard and lab at that size, and the
   card geometry was measured live at both sizes, but `05` at 2560 is missing.
4. **`npm run scene` intermittently times out** waiting for `.home-scene` on a
   cold vite transform — roughly one run in three, no pattern, retries succeed.
   Worth a longer `waitUntil` budget in `tools/harness.ts` rather than a retry.
5. **`tools/diag-home.ts`, `diag-real.ts`, `diag-verify.ts`, `diag-door.ts` are
   uncommitted one-offs** left in the worktree. They are the probes that found
   the width bug and the door position; delete them or fold what is useful into
   `scene-shot.ts`, which already absorbed the width assertion.
6. The blighted yard is dark. It reads, but somebody should look at it on the
   owner's panel before it is called finished.

---

## Commits on this branch

    0ce8c1ab  The page was wider than the window, by a third of a pixel
    3f3b4e9b  The cards got out of the scene's way
    cab8b1f3  The farm turns over, and the lab is under it
    cfe0b0a2  Reduced motion gets the descent as a fade, not as a teleport
    91452ebc  `npm run scene` can ask for a window size, and reports the page width

Files touched: `src/main.ts` (the `resize()` measurement only), `src/ui/dev.ts`,
`src/ui/style.css`, `src/ui/home.css`, `src/ui/home-ui.css`, `src/ui/scene.ts`,
`src/ui/menu.ts`, `tools/scene-shot.ts`, `tools/check-blight.ts` (new),
`package.json` (the `blight` script). `src/ui/sprite.ts` and `src/core/atlas.ts`
were deliberately not touched. `NOTES.md` and `CLAUDE.md` were deliberately not
touched.
