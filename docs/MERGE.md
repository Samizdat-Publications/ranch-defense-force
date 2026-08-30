# The repo has two heads. Read this before writing any code.

**`origin/main` and `session-14-16-maps-caves-archive` have both moved a long
way from the same base, and neither contains the other.** Nothing is lost;
nothing is merged. This is the first job of the next session.

```
                    ┌─ origin/main                        28 commits
bdff23af ───────────┤   art, effects, scenery, the fence, the XP gem,
                    │   the cursed cast, "the last LimeZu buildings"
                    │
                    └─ session-14-16-maps-caves-archive    1 commit
                        maps, caves, the descent, the screenshot archive
```

## How this happened, so it does not happen again

The working tree this session started from was **28 commits behind
`origin/main`** and nobody noticed, because the tree was also full of
uncommitted changes that looked exactly like unfinished work. Sessions 14, 15
and 16 were built on a stale base and their conclusions inherited it — most
visibly "there is no generated building art anywhere on disk", which was true of
that tree and false of the repo.

> **`git fetch && git status` before reading anything else.** Twice more this
> session the same shape of mistake appeared: a brief that said PixelLab was
> cancelled when the subscription was active, and a handoff that said no art
> existed when fourteen finished tilesets were sitting on the account. **Check
> the source, not the document about the source.**

## What is on each side

### `origin/main` — 28 commits, all art and presentation

`git log --oneline bdff23af..origin/main`. The ones that matter most:

- **"Pickups, the gas that was never drawn, and the last LimeZu buildings"**
- **"The effects are ours, animated, at one generation each"**
- "Scenery, y-sorted, around the edges of the field"
- "A real fence, scattered decals, and the last stand-in retired"
- "The rocks and trees you mine are ours, and they are wrong on purpose"
- "The ground gets worse as the run does" — a blight, implemented **not** in
  `src/render/blight.ts`, which does not exist on that side
- "The XP gem stops being a coloured square"
- "Five enemies are generated animals now, and they turn eight ways"
- "The rarity plate is struck metal, and it cost eight generations"
- "Spend the last of the PixelLab subscription, and keep the drivers"

It has **58 files in `assets/tilesets/`** (29 sets) and 20 scene strips.

### `session-14-16-maps-caves-archive` — one commit, all systems

New files, none of which exist on the other side:

- `src/content/maps.json`, `src/render/terrain.ts`, `src/render/blight.ts`
- `tests/maps.test.ts` (12 tests), `tools/map-check.ts`, `tools/sprite-look.ts`
- `tools/snap.ts`, `tools/snap-history.ts`, `tools/object-strip.ts`,
  `tools/tileset-audit.ts`
- `docs/progress/` — 30 images, the whole visual record

### There is a THIRD line

`origin/claude/pixel-labs-credit-plan-ufnx41`, two commits, not merged into
`origin/main` either. It carries **`assets/pixellab/yard_picked/` — a generated
barn, farmhouse, silo and oak**, plus `tools/pixellab-rmbg.ts`,
`tools/contact-dir.ts` and `tools/pixellab-mapobject.ts`. The buildings are the
biggest remaining LimeZu presence on the home screen and they are sitting right
there. Check whether `origin/main`'s "last LimeZu buildings" commit already
supersedes them before merging both.

## The merge, measured

`git merge origin/main` from the session branch gives **21 conflicts, 28 hunks**:

| file | hunks | what the two sides did |
|---|---|---|
| `src/render/renderer.ts` | 7 | **the hard one.** Both rewrote the terrain bake |
| `tools/draw-world.ts` | 4 | both changed the headless painter's terrain |
| `src/content/tuning.json` | 4 | one removed `terrain.groundSet`/`soilSet`, the other added to them |
| `HANDOFF.md` | 4 | both rewrote it |
| `docs/NEXT_SESSION.md` | 3 | both rewrote it |
| `art/sprites.json` | 2 | both added groups |
| `tools/pixellab-tileset.ts` | 2 | add/add, two implementations of the same tool |
| `NOTES.md` | 1 | both prepended a session; **keep both, ordered by date** |
| `package.json` | 1 | scripts, additive |
| 12 × `assets/tilesets/*` | — | add/add. Both sides pulled the same sets. Compare bytes; if identical, take either |

**`src/sim/world.ts` and `tools/build-atlas.ts` auto-merged.** That is worth
knowing: the two sides touched different parts of both.

### How to do it

1. **From the session branch**, not from main — the branch is the smaller side
   and its systems are the newer layer.
2. **Take `origin/main` wholesale for anything under `assets/`.** Its art is
   later and richer, and the session branch only added downloads.
3. **`renderer.ts` and `draw-world.ts` need reading, not resolving.** The
   session branch replaced the hardcoded three-pass bake with
   `groundLayers(map, …)`; `origin/main` added scenery, y-sorting and a blight
   to the same methods. The layer system is the shape that survives, and
   `origin/main`'s additions need re-hanging on it.
4. **Two blight implementations exist.** `src/render/blight.ts` on the session
   branch is shared by both renderers and has four tests. Whatever
   `origin/main` did, one of them has to go, and the tested one is the default.
5. **`NOTES.md`: keep every session from both sides**, newest first. It is the
   project's memory and a resolution that drops half of it loses more than the
   code would.
6. `npm run atlas && npm run typecheck && npm test` — 147 on the branch, and the
   merged tree should be at least that.

## If it goes wrong

Nothing is only in a working tree. Both sides are committed, the session branch
is `47667ab3`, `origin/main` is `ec41be6a`, and `git merge --abort` returns to
either cleanly. This document was written from an aborted attempt.
