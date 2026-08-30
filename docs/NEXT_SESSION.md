# Next session — merge the two heads, then play it WITH the owner

## 0. THE MERGE, BEFORE ANYTHING ELSE

`origin/main` and `session-14-16-maps-caves-archive` both moved a long way from
the same base and neither contains the other: 28 commits of art and presentation
on one side, the map/cave/archive systems on the other. 21 conflicts, 28 hunks,
mapped file by file in **[`docs/MERGE.md`](MERGE.md)**.

There is a third, smaller line too — `origin/claude/pixel-labs-credit-plan-ufnx41`
carries **a generated barn, farmhouse and silo**, which is the biggest remaining
LimeZu presence on the home screen.

Nothing is lost and nothing is urgent-broken. But every plan below assumes one
tree, so this comes first.

---

# After the merge — play it, WITH the owner

Sessions 14 and 15 cleared the two things the owner asked for ahead of playing:
everything alive in the yard is generated art now, and there are five maps
instead of one. `NOTES.md` sessions 14 and 15 are the detail.

**The owner's order of work, in their words: finish retiring LimeZu, then more
maps, then play and tune together — and do not start tuning without them.**
Steps one and two are done as far as they can go. **Step three is next and it is
theirs to lead.**

---

## Read this first, because it changes everything below

**PixelLab is NOT cancelled — that was wrong, and it was wrong in four documents.**

The subscription is **active** (Tier 2). What is spent is this cycle's
allowance — 4710 of 4710 — and it **refills on 2026-09-14**. Sessions 14 and
15 were told the account was dead, wrote it down, and planned around a
shortage that was really a sixteen-day wait.

**And downloading has always been free.** `npm run tsaudit` found fourteen
finished tilesets on the account that had never been fetched, nine of them
usable, while the docs said no new ground could be had. Session 13 hit the
identical thing with the cursed animals. **Check the account before believing
a document about it.**

So a plan that begins "generate a…" is a plan for **2026-09-14**, not a dead
letter. Until then: `npm run tsaudit` fetches anything already finished on the
account, and `npm run objstrip` and `npm run look` need no account at all.

**The one order already written and waiting** is a chained cave family — the
caves have one flat floor each because every tileset pairs GRASS with something,
so a second cave layer would draw grass fringes underground. Each cave in
`maps.json` records the base tile id to chain off in `_caveFamilyTodo`.

---

## 1. Play it together. Do not tune alone.

Said explicitly, twice. Function has been verified for four sessions running;
feel has never been checked by a person holding the controls. What is waiting:

- **The balance work**, still the largest un-started thing and unchanged since
  session 12. Waves too slow, and raising either the budget or the spawn rate
  fails `run.test.ts` on the identical budget because density and player power
  are coupled. The fix is more enemies that are individually weaker across
  `enemies.json`; numbers are in `formulas.ts` above `threatBudget`.
- **The brawling Kid gained five clears in 24 on the map rotation** (11/24 →
  16/24). Real, measured with `npm run balance`, and deliberately left alone —
  a brawler on a bigger field has room to break off. Decide whether that is a
  feature.
- **MUD DOES NOT BLOCK OR SLOW YOU.** There is no terrain collision and adding
  it would be a gameplay change, so the wet channels on Creek Bottom, Long Acre
  and Dry Lot are floors you walk over. It is the one thing on these maps that
  looks like it should stop you.
- **Enemies spawn on ARENA EDGES and walk in**, so a bigger map means pressure
  arrives later. Node density is corrected for map size; this is not. If the big
  maps feel slow, spawning on a ring around the player is the lever.
- **The blight is bone-PALE**, so the screen gets lighter as the run gets worse.
  Deliberate, and still the most likely thing to want reversing after ten
  minutes. Everything is in `tuning.json` → `terrain.blight`.
- **The weapon ring** — five specific things in `HANDOFF.md`, of which the first
  and third (uneven held spacing, z-order against the body) are cheap and are
  most of the feel.

## 2. Save export/import, before anyone else plays

~30 lines, no backend, no accounts. The save is one JSON blob in `localStorage`
under `rdf.save`. It does not survive "clear site data" and no browser storage
does. The first person to lose a Homestead will not report a bug, they will stop
playing.

## 3. If more maps or caves are wanted

Adding one is a descriptor in `src/content/maps.json` and nothing else. Read its
`_groundsNote` and `_caveGroundNote` first — they record which tiles survived
the tiled test and which did not, and why.

**Judge a floor at PLAY ZOOM, not from the tilesheet.** Nine grey tilesets were
recovered for the caves and most of them failed: three tile into a visible grid
that the darkness does not hide. `npm run look --tile 5` is the first filter and
a real shot is the second, and the second overruled the first three times.

## 4. On 2026-09-14, when generations refill

- **A chained cave family.** The one thing the caves actually need: a second
  ground per level, chained off that level's own floor rather than off grass.
  The base tile ids are in `maps.json`.
- **A mid-value cold blue and a saturated red** in the palette. It ate an ore
  tier in session 13 and it deletes the LimeZu hen's comb.
- **`duckFlight`**, the last enemy on LimeZu art.
- Buildings and fences, which is most of what the home screen still is.

---

## What NOT to redo

- **The yard's livestock and people.** Done. Table in NOTES session 14.
- **The map system.** Five maps, layered Wang grounds, seeded fill. NOTES 15.
- **Believing a document about the PixelLab account.** Run
  `npx vite-node -e` on `get_balance`, or just try. Twice now the docs have
  been wrong in the direction of giving up.
- **The `grass_to_gravel_v2` gravel.** It fails `--tile 5` and it was in three
  maps before the test existed. Do not put it back without regenerating it.
- **The pack-green tileset family.** Tested at play zoom and rejected, twice
  now, for the same reason.
- **The palette.** `art/palette.json` is authored, not extracted. Never run
  `npm run conform -- --write` without diffing.

## The traps this work will hit

1. **A test that measures a CLASS must pin the map.** The seed picks the arena
   now, so a six-seed class comparison also compares two sets of arenas, and the
   arena is a big variable — the balance harness puts the brawling Kid at 46% on
   one arena and 67% across the rotation. `simulate()` in `run.test.ts` defaults
   to `home_quarter` for exactly this. `npm run balance` takes a map id too.
2. **Counts in content that scale with the arena are a DENSITY.** `nodes.json`
   quotes against `referenceArea` and everything is multiplied by
   `arenaArea / referenceArea`. Getting this wrong broke three acceptance tests
   at once and looked like a balance regression.
3. **A pool that is too small does not error.** `acquire()` returns null and the
   field is quietly short. `tests/maps.test.ts` checks the props pool against
   the biggest map; do the same for anything else that scales.
4. **Judge a ground tile with `--tile 5`, never alone.** It has rejected three
   grounds and a whole family.
5. **A ribbon needs a restoring pull or it is a diagonal.** Clamped drift
   saturates. Noise, damping and a pull toward the home line — all three.
6. **A CSS `scaleX` flip written a few percent apart INTERPOLATES through
   `scaleX(0)`.** Put the two stops 0.01% apart. Fixed in `y-amble` and
   `y-rooster-path`; it will recur the next time anything is flipped.
7. **A layer that is MOVING when you screenshot it composites as a smear** even
   though it renders correctly. Freeze the scene before judging a still.
8. **Two art groups writing the same frame key means the later pass wins,
   silently.** Nine sessions and counting.
9. **The palette has no saturated red and no mid cold blue.** It ate an ore tier
   in session 13 and it deletes the LimeZu hen's comb. `npm run look -- <file>
   --conform` shows either in one glance.

## Verifying

`npm test` (147), `npm run typecheck`, `npm run atlas` after any art change.

**Know what each instrument does NOT cover.**

- `npm run shot` draws through `tools/draw-world.ts`, a separate implementation,
  so it says nothing about `Renderer.bakeWangGround` or anything else on the
  browser path. It is also a 520x330 camera window, which is the wrong scale for
  a map question.
- `npm run maps` bakes whole maps and prints coverage, and draws no entities.
- **The home screen is DOM and CSS, so `npm run shot` cannot see it at all.**
- For the browser path, drive `window.rdf` in a real page: `rdf.renderer.terrain`
  is the baked canvas, `rdf.startRun(class, seedText)` starts a run, and
  `rdf.world.spawner.wave` plus `rdf.renderer.draw()` steps the ground through a
  whole run in one expression. **`rdf.world.descend()` goes down a level** —
  the only way to reach a cave without playing to wave 10.
- **`npm run snap -- <slug> "<caption>"` after anything visible changes.** The
  archive in `docs/progress/` is the first visual record this project has ever
  had; sixteen sessions before it left none at all.

## Rollback

`git reset --hard pre-cast-swap` returns to the last commit before the art swap.
