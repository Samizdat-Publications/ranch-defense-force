# Handoff: Ranch Defense Force

A wave-based bullet-heaven (Vampire Survivors / Brotato lineage) set on a farm
outside Canton, Ohio. This package is everything needed to build the first
level: two classes, twelve weapons, ten enemies, two bosses, twenty-four waves,
and a between-runs meta layer.

## What this package is

**Not UI mocks.** This is a game design and build specification. There is no
HTML to recreate — `Build Spec.dc.html` is a readable presentation of the same
content in `GAME_DESIGN.md`, included so a human can review it. Build from the
markdown and JSON.

Read in this order:

| File | What it's for |
|---|---|
| `GAME_DESIGN.md` | The full spec. Systems, numbers, formulas, content. Read first. |
| `ASSET_MAP.md` | Every game entity mapped to a real file path in the repo. |
| `MILESTONES.md` | Nine milestones with acceptance criteria. The build order. |
| `CLAUDE.md` | Drop at the repo root. Conventions and non-negotiables. |
| `content/*.json` | Ready-to-use game data. Copy into `src/content/`. |
| `art/sprites.example.json` | The shape of the atlas manifest, with real entries. |

## The codebase

Private repo, art already staged: **Samizdat-Publications/ranch-defense-force**

Read `ASSETS.md` at the repo root before anything. The art is commercially
licensed and **must not be redistributed** — the repo stays private, and only
the packed `atlas.png` ever ships, never `assets/`.

There is no application code yet. Start at M0.

## Stack

TypeScript + Vite + Canvas 2D. No game engine, no physics library, no UI
framework. Dependencies: `vite`, `typescript`, `vitest`, and nothing else.
Rationale is in GAME_DESIGN.md §1 — the short version is that a bullet-heaven
needs pooling, a fixed timestep, and one atlas blitted in one pass, and an
engine helps with none of those while adding API surface.

Browser first. Tauri wrapper later if desktop is wanted; that decision changes
nothing structural.

## Fidelity

The numbers in this spec are **starting values, not final balance**. They are
internally consistent and safe to build against, but every one of them lives in
`content/*.json` precisely so they can be tuned without touching a system.
Expect to change them during M8. Do not hardcode any of them.

The systems, formulas, and architecture are **specified**, not suggestions.
Deviating from the tick order or the single-pass stat resolution will cause
problems that are expensive to unwind later.

## Where the art actually is

Everything renders from one atlas built offline by `tools/build-atlas.ts` from
`art/sprites.json`. The game never reads `assets/` at runtime.

Two things to know before you touch art:

1. **Everything is 32×32.** The packs ship 16, 32 and 48. Read only the 32
   directories. Assert it in the atlas builder — every humanoid sheet must be
   exactly 1792×704 or the build fails loudly with the filename. This has
   already gone wrong once silently.

2. **All thirteen character sheets share one rig:** 56 columns × 22 rows.
   Player, zombies, gas-mask enemies — identical layout, order and pivot. One
   slicer config and one animation state machine serves every humanoid in the
   game. This is the most important structural fact in the project.

## Commentary

**Build in the order given.** M0–M3 produce a complete, playable game loop made
of coloured squares. Do not skip ahead to art. If it is not fun with squares,
no amount of pixel art will save it, and you will have made it much harder to
tell what is wrong.

**M4 (art) comes before M5 (content) deliberately.** Ten enemies are far easier
to judge once the game looks right. Judging content through placeholder squares
produces bad calls about what is fun.

**The FX pack is the one visual risk.** It was drawn by a different artist and
is more saturated than LimeZu's muted palette. Run `tools/conform-fx.ts` before
judging whether any effect works — plenty look wrong raw and right conformed.
Dropping it in unconformed is the single most likely way this game ends up
looking assembled rather than made.

**Ship a dev overlay in M0.** Frame time graph, entity counts by pool, draw
calls, wave-skip key, and a seed box. Without it, balancing twenty-four waves
means playing twenty-four waves, every time.

**Write NOTES.md at the end of every milestone.** What was built, what deviated
from this spec and why, what feels wrong in play, and the two or three design
decisions now needed. That file is the handoff back for the next design pass.

## Known gaps

- **Audio is unsourced.** Neither pack ships sound. Sixteen effects and three
  music layers still need a decision: another purchase, or synthesised in
  WebAudio. Everything else is covered by files that exist.
- `assets/generated/` may not yet contain the character sheets — confirm they
  are pushed before M4.
