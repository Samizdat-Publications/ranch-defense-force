# Ranch Defense Force — second brief for Claude Design

**From the engineering side, answering your handoff.**

Short version: the package was excellent and most of it is in. This document is
what I could not build from what you sent, what I had to decide myself, and what
I would like next.

Read `DESIGN_LANGUAGE.md` first if you need to reload context — it is now
committed at `docs/DESIGN_LANGUAGE.md`, along with `docs/PIXELLAB.md` and
`docs/PIXELLAB_MANIFEST.md`.

---

## What shipped

| Pass | State |
|---|---|
| `rarity.json` | In, unchanged. The five-tier contract drives everything. |
| `items.json` — 40 items | In. Mockup fields stripped as instructed. |
| `weapons-additions.json` — 16 weapons | In. All four new ones reuse shipped behaviours; no new code, exactly as you said. |
| The ten `special` branches | **All ten implemented**, including the four legendaries. |
| The card | Built as one component, reused by the level-up and class select. |
| Paper & Pin tokens | Built. The old panel language is gone, `fill` bug included. |
| Fonts | Self-hosted. Rye, Silkscreen, IBM Plex Mono, latin only, 100KB. |
| Home screen | Built — see caveats below. |
| PixelLab art | 24 icons packed. Atlas is at 1,233 frames. |

**Balance note you will want.** Your roster was authored against the file's
scale rather than from play, and one consequence was not in the numbers at all:
growing the item pool from 22 to 40 cut *weapon merge* opportunities by about a
third, because once weapon slots are full a draw is six weapons against forty
items instead of six against twenty-two. Cleared runs stopped reaching tier 4
entirely. There is now a `tuning.offers.weaponOfferWeight` knob (1.6) that
restores the old share. **If you change the item count again, that number moves.**

Threshing Floor and Crop Duster went through the harness as you asked. Neither
ran away. 131 tests pass.

---

## What I could not build from the package

### 1. The four `.dc.html` mockups were not in the zip

`README.md` refers to them as "the four `.dc.html` files in the project root",
but the archive contains only `handoff/`. I built from `DESIGN_LANGUAGE.md`,
which was written to make that possible and did — but it means **every visual
judgement below is mine, not yours**, and the mockups are the thing that would
settle them.

If you can re-send those four files, I will reconcile. In particular I never saw
the HUD, pause, results or Homestead layouts.

### 2. The home screen has no barn

The design is "the yard at dusk, with the barn doors as the Homestead entrance."
There is no barn, no farmhouse and no outbuilding art in the atlas — the packs
are characters, terrain, props and animals. I built the yard from what exists: a
dusk sky, a treeline of tree sprites at 1x, a ground band of real terrain tiles,
three actors at 2x, and the porch light on its 11s cycle.

**It reads as a field at dusk, not as a farmyard**, and the barn-doors-as-door
idea is not in it. Buildings are priority 3 in `art/pixellab-queue.json`.

### 3. No sprite strips, so nothing walks

You specified walk cycles as one strip PNG per actor with
`background-position` + `steps(n)`. Those strips do not exist and I did not
generate them. The three actors on the home screen are idle frames. The porch
light is currently the only motion on the screen, which is *more* faithful to
"the only event" than intended, but not what you drew.

---

## Decisions I made that are yours to overrule

1. **Epic is still red.** You flagged that it may read too close to the HUD's
   damage red and gave violet as a tested alternative. The HUD is not converted
   yet, so I could not judge it. Call it when you see them together.
2. **The class rail card is a compact variant.** Six class cards at level-up
   height wrapped to two rows and pushed the buttons 260px below the fold at
   1400x900. I shortened the art window to 96px, dropped the min-heights, clamped
   the blurb to three lines and made the rail scroll horizontally. The card is
   still the same object — but the class-select proportions are no longer yours.
3. **Eight items are wearing borrowed art.** Marked `_standInArt` in
   `items.json`: Work Boots, Feed Sack, Boot Knife, Straw Hat, Ditch Light,
   Threshing Floor, Crop Duster, Whitacre Bull. They are in the generation queue.
4. **Two weapons are wearing tool ladders.** Post Auger and Combine Head use the
   pickaxe and axe tier ladders as stand-ins, chosen because they are genuine
   four-step progressions so tier still reads.
5. **The Seed Drill got its own round.** It was assigned `proj.glob`, which the
   Tar Bomb already uses — two weapons on one bullet is the exact thing the
   distinctness test exists to stop.

---

## What I would like next, in priority order

### 1. The four missing mockups, or their values

HUD, pause, results, Homestead. These are the four screens still on the old
styling and they are the bulk of what the player sees. `DESIGN_LANGUAGE.md`
gives me the HUD rail positions but not the pause, results or Homestead layouts.

### 2. The Homestead, designed properly

It is currently four buttons and a grid of purchase cards — functional, mine,
and the least considered screen in the game. Four buildings, acres top-right,
locked classes as nailed packets. It wants your pass.

### 3. Sprite strips, or a spec for generating them

If you tell me the frame count and cadence you want, I can generate walk cycles
through PixelLab's **Animate with text** and **Generate 8 rotations** and build
the strips. I do not want to guess the timing.

### 4. A card back, or a deal-from-somewhere

The deal animation currently slides cards up from nothing. If cards came off a
stack — a seed packet box, a pinned board — the level-up would have a place
rather than being four cards that appear.

### 5. The two things you listed as open that I did not touch

Infected livestock (still ordinary animals with a CSS filter — you were right
that it looks like it) and class portraits. Both are in the generation queue at
priorities 2 and 3; I have not spent on either, because the art direction for
"infected" is a judgement call and I would rather you made it.

---

## Things worth knowing about the codebase now

- **Art generation is scripted.** `npm run pixellab -- --list` prices a run for
  free; without `--list` it generates every subject in `art/pixellab-queue.json`
  that has no sheet yet. Pro tools are 20 generations each against 2,000/month,
  so the queue as written is 860 and should not be run in one go.
- **Adding a class is five strings.** `art/characters.json` composites character
  sheets from the licensed generator pieces. Do not ration classes.
- **Every tunable is in `src/content/*.json`**, including tier colours. The UI
  reads `colour` / `dark` / `ink` / `rank` from `rarity.json` and hardcodes
  nothing.
- **`src/ui/card.ts` is the one card.** Anything that should differ per screen
  belongs as a flag on `CardSpec`, not as a second card.
- The repo is public: https://github.com/Samizdat-Publications/ranch-defense-force
