# Session state — read this first if you are picking up cold

Written mid-session against a hard time limit. **Everything below is pushed to
`claude/rdf-merge-session-l7ta2j`** (PR #4, open, draft, mergeable). 204 tests
pass. Atlas 8029 frames at 4096x8192.

## The three documents that matter

| file | what |
|---|---|
| `docs/SCENE_ASSETS.md` | **the five standing rules** for scene art and every trap that cost a generation |
| `DESIGN_HANDOFF_LAB.md` | the fourth scene is a LAB now, not a barn — what exists for it |
| `NOTES.md` (session 19) | why the title screens were wrong, and it was not Design |

## Commands — everything is generated, nothing is hand-edited

```
npm run atlas      pack public/atlas.png          npm test        204 tests
npm run scale      art/scene-scale.json           npm run strips  art/strips/ (699)
npm run pens       art/pen-quads.json + HOLLOWS   npm run catalog docs/ASSET_CATALOG.md
npm run inventory  docs/PIXELLAB_INVENTORY.md     npm run rmbg    strip carded backgrounds
```

Order after generating art: `atlas` → `scale` → `pens` → `strips` → `catalog`.

## What landed this session

- **The character cut tool was cutting the heads off, and PixelLab was
  innocent.** All five base humanoids were clipped on all four sides. Three
  diagnoses were wrong first — the exporter, then "lost at generation", then my
  own first fix. Cause: the base cast was generated on a 92px canvas (figures
  35-46 x 64-70) and cut into a fixed 32x64 cell. Measured: PixelLab source has
  10-13px of headroom and a rounded 6-10px top row; the cut had 0 and a flat
  17-22px. Size-64 cast 0/8 frames touch row 0, size-92 cast 8/8. The cell is
  DERIVED now (44x75 to 48x79, per sheet in the manifest) and re-cutting cost
  zero generations. Feet verified unmoved.
- **`npm run scene`** — the live title screen can be photographed for the first
  time. See below; this is the biggest change here.
- **`npm run placements`** — Design's artboards become a coordinate table.
- **`npm run decard`** — strips PixelLab's opaque card offline and free, instead
  of `rmbg` at a generation an image. A card is a SCALE bug, not a cosmetic one:
  100% opaque means the alpha box is the canvas, so `npm run scale` measures the
  card. `vault.drumRank` published 210x126 against a true 210x48.
- **`baseOperator` and `baseBreacher` had no art at all** — wired into
  `enemies.json` with spawn weights in two maps and never declared in
  `art/sprites.json`, so both would have walked into the lab as coloured
  rectangles. Now packed. `tests/content.test.ts` asserts every enemy a map can
  roll has `idle` and `walk` packed for every direction.
- **A red test was fixed that had been reported as green** — the scale-entry
  guard knew stills and cast sheets but not ambient loops.
- All five underground humanoids carry `drawAt` 64; none did.

**Do not trust `def.sheet` in `enemies.json`.** The sim reads
`def.sheets ?? typeId`; the singular field disagrees with the packed art for six
WORKING enemies (`farmhand` claims `"zombie"`). It produced a wrong diagnosis
and eight false-positive test failures in one session.

## What is IN FLIGHT and unfinished

**The next session is LOCAL.** Everything below assumes that.

### THE ONE BIG THING: implement Design's two rebuilt scenes

Design exported `Yard Grounding Fix.dc.html` and `Lab at Depth.dc.html`; both
are in `docs/mockups/` and both are UNIMPLEMENTED. The coordinates are already
extracted for you:

```bash
npm run placements -- "docs/mockups/Yard Grounding Fix.dc.html" "docs/mockups/Lab at Depth.dc.html"
```

writes `docs/mockups/PLACEMENTS.md` — 52 yard placements and 44 lab, every path
resolved to an atlas key or a packed clip, in DOM/paint order, in 1920x1080
stage space. **Do not hand-type any of those numbers**; if the artboard changes,
re-run the tool.

The artboards are reference documents, not code to lift — `docs/mockups/
README.md` is explicit that the inline styles, the `<x-dc>` machinery and
`support.js` never ship. Implement with the helpers already in `src/ui/scene.ts`
(`sprite`, `groundActor`, `stripActor`, `clipActor`, `tileBand`, `travelling`).

Two things to carry over from Design's build:

- **The grounding rule indoors.** The wall/floor junction is the horizon,
  nothing stands in y 496-556, first foot line is 636.
- **The lab is at one scale**: a grown person is 174px, 97px per metre.

`lab` is a new `SceneKind` alongside `yard` and `field`.

### Now you can SEE it, which you could not before

```bash
npm run scene -- yard /tmp/yard.png 1500
```

Starts the real dev server, drives the real app in Chromium, waits for the
loops, writes a PNG, and reports console errors and failed requests. This is the
review step that did not exist for the whole of the scene work, and it is why
every scene defect was found late and by a human. **Look at the shot before
claiming a scene is done.**

The first shot found: the home screen renders the FIELD scene; the farmhouse and
barn stand on a hard horizon with the wheat band cutting their footings; the
distant treeline is small sprites on that line; the class cards cover the lower
third. There is also an unexplained 404 on load — worth five minutes.

### Still open, unchanged

- **`scene.fencePicket` is a re-opened blocker; the audit is 7 of 8.** Design
  cleared it, then reversed itself: `ranch.fenceRun` is drawn RECEDING (tall
  near post, panels shrinking away), so tiling it sideways repeats the vanishing
  point every 108px. The near fence is LimeZu's picket tile again. What closes
  it is one wide shallow generation asked for as a THING — "a long low wooden
  rail fence filling the frame edge to edge", 400x64. **I have not verified
  either of Design's two opposite calls by measurement.**
- **`ranch.well` and `ranch.wellStone` are named BACKWARDS.** `well` is the ruin
  with the collapsing roof; `wellStone` is the intact one with a bucket. Same
  trap as `latrine` and `medChair`.
- **The vat's scale is a STORY call and it is the owner's.** `vault.vatSpecimen`
  is `drawAt` 78. The silhouette is 57% of the tube at any size, so: 78 -> tube
  206, figure 117 (1.8x a person); 43 -> tube 113, figure 64 (exactly a person);
  38 -> tube 100, figure 57. Nothing changed pending the owner.
- **`pen.chickenRunFlat` is a known partial failure** — the wire mesh reads as
  interior to the flood, so the quad came back degenerate. Do not use it.
- **Balance on the base cast has still never been played.** Five enemies, all
  numbers interpolated. This is the joint-activity item, it is the largest
  unfinished thing in the project, and going local is what finally makes it
  possible: `npm run dev` and play it WITH the owner. Do not tune alone.

### Setting the local session up

```bash
git clone https://github.com/Samizdat-Publications/ranch-defense-force
cd ranch-defense-force
git checkout claude/rdf-merge-session-l7ta2j
npm install
npm run atlas          # REQUIRED — a fresh clone renders coloured squares without it
npm run dev
```

Two things do not come with the repo:

1. **`.mcp.json` is gitignored** (that is what keeps the PixelLab key out of a
   public repo). Recreate it locally. **Rotate the key while you are at it** —
   it has been through a chat transcript.
2. **Design access is TWO commands and they are not the same thing.** Read out
   of the installed CLI rather than guessed, because `DesignSync`'s own error
   message only ever names the second one:

   | command | description | non-interactive |
   |---|---|---|
   | `/design-consent` | Grant Claude agent access to your Design projects | **yes** (`supportsNonInteractive: true`, and `isHidden`) |
   | `/design-login` | Authorize design-system access for `/design-sync` with your claude.ai account | no — interactive only |
   | `/design-revoke` | Revoke it | — |

   `/design-login` is stored PER MACHINE, so running it locally does nothing for
   a cloud session — that is what the error means by "on this machine".
   `/design-consent` is the one that can run in a non-interactive session, so
   **try it before assuming Design access needs a local terminal at all.**

## Object IDs generated late and NOT yet in the ledger

The ledger in `art/pixellab-queue.json` predates most of this session, which is
a real gap — `base.tank0-4`'s ids could not be found when they needed animating.
These are the late ones, recorded here so the same thing does not happen again:

```
vat with specimen      8a0ae4ed-a5ea-4a6b-9c94-88481ed14482
lab console bank       5bf9663a-d0c9-4728-9488-3c3d1e67f726
exam table             551417ef-31b9-4373-8178-7cdab54526da
specimen jar rack      1d6d5189-efcb-43a6-853a-c666ab95592b
alien in vat           c53a74dc-f5b6-4a84-8e49-c5c2c9c14db4
broken empty vat       e81388b4-9adb-43cc-87cb-19af545374ac
paddock reshoot 400x200  692633fd-ff9d-442a-a86c-27e6f0ad8a1a
chicken run reshoot      8c798908-f85f-4df9-a5a6-cf9823d5ea8f

baseGuard    8d18e16d-4c2e-4ae1-a651-238c6388a464
baseTech     8317aa47-9ad6-416d-8d18-89d1eb701e99
baseHazmat   fb95af8d-7628-4b74-9c4d-85a3497d1a9b
baseOperator da70f7c4-7660-42b5-8532-81a5b3dee860
baseBreacher f2c594e5-7369-4975-84ba-a3377352012f
```

**Record an object id the moment you generate it.** Deriving a state, a rotation
or an animation from a finished object needs the id, and it lives only on
PixelLab's servers.

**But a recorded id is not packed art.** All five base humanoids are listed
above and only three of them were ever cut into the repo; `baseOperator` and
`baseBreacher` had spawn weights in two maps and not one packed frame, so both
would have appeared as coloured rectangles. This ledger says what exists on the
account. `tests/content.test.ts` says what exists in the game. When they
disagree, believe the test — it reads the built atlas.

All five are now cut, packed and walking (four cardinals, eight frames,
`scary-walk`), and all five carry a `drawAt` of 64.

## Standing constraints

- **Balance is JOINT.** The five base enemies' numbers are a first pass,
  interpolated from the enemies either side of each first-wave, and say so in
  `enemies.json`. Nothing has been measured against a human playing it.
- **The PixelLab key lives in a gitignored `.mcp.json`** and must never be
  committed. It has passed through a chat transcript and should be rotated.
- **Credits: ~$12.** Subscription generations are exhausted until Sep 14.
