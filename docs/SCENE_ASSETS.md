# Scene assets — the standing rules, and every trap found the hard way

**Read this before generating anything for a title scene.** It is the compressed
result of a long session of getting it wrong, and every rule here cost at least
one generation or one round of review.

Companion files, all generated, none hand-edited:

| file | command | what it holds |
|---|---|---|
| `docs/ASSET_CATALOG.md` | `npm run catalog` | every drawable key, grouped, with contact sheets |
| `art/scene-scale.json` | `npm run scale` | `drawAt` width, `drawAtHeight`, `contentBox` |
| `art/pen-quads.json` | `npm run pens` | each pen's ground quad and foot line |
| `art/strips/index.json` | `npm run strips` | every animation as a flat PNG strip |
| `docs/PIXELLAB_INVENTORY.md` | `npm run inventory` | what the account already holds |

---

## The five rules

**1. Describe the OBJECT, never the composition or the camera.** This is the
single most expensive lesson here. The generator draws things; it does not take
instruction about the angle you look at one from, or about what a thing is part
of. Three separate failures, all the same shape:

- "a fence running away from the viewer" — three phrasings, three single posts
- "ceiling pipes seen from below" — three near-empty canvases
- "a strip of treeline on a horizon" — a sparse row of tiny trees in a big margin

Each one came back correct the moment it was asked for as a *thing*: "a dense
wall of trees filling the whole frame", "a horizontal bundle of pipes running
edge to edge". **Constrain geometry with the CANVAS, not with words** — a wide
shallow canvas forces a wide shallow drawing far better than any adjective.

**2. Whole objects, never kits.** A pen assembled from rail, post and corner
pieces is where three rounds of the title screen died: the sides never line up
with the front and the pieces disagree about scale. One sprite per pen, all four
sides, and it cannot desync. Same for a drum rank, and same for the split
weeping drum and its puddle — one asset, because it is the story of the game and
should not be two things aligned by hand.

**3. Everything scene-scale comes back CARDED.** An opaque fill behind the
sprite — measured at 0% transparent on the treeline. A carded pen drawn over a
title screen is an opaque rectangle across the sky and the ground, and it
survives review because the sprite looks fine in isolation. `npm run rmbg` fixes
it. **Verify the alpha afterwards rather than trusting the call.** Large subjects
card; the same prompt at 96px comes back clean.

**4. Never infer a height from the canvas.** The `ranch.*` group is packed
UNTRIMMED, so the frame rect is the generation canvas and the art floats inside
it. `ranch.farmhouse` is a 256x320 canvas holding 194x165 of house — inferring
height from the canvas made a 330-wide house 413 tall instead of 281 and put the
farmhouse above the barn. `npm run scale` measures the alpha box and derives the
height. Never hand-type the second number.

**5. Where the art and the world disagree, the art wins.** `ranch.windmill` was
listed at 100x366, derived from a real Aermotor being ~10m tall and 2.5m wide.
The sprite is 68x115 — a ratio of 1.7, not 4 — so 366 stretched it. A stretched
sprite is a visible defect; a short windmill is a style choice. Wanting a taller
windmill is a regeneration, not a multiplier.

---

## Scale: one reference for everything

> **A grown person is 64 pixels tall.** That is 36.6px per metre.

Every number in `art/scene-scale.json` derives from that. Two things to know:

- **The two families are in different units.** A cast entry is a HEIGHT; a
  building or vehicle entry is a WIDTH. A chicken coop is 92 and an Arabian horse
  104, and the coop is not smaller than the horse — it is wider than one and
  shorter than one at the same time. A test that compared across them failed, and
  the test was what was wrong.
- **Small animals sit above life scale on purpose.** A cat at true scale is 9px
  and unreadable. What matters is that the ORDER always holds: hen < dog < pony <
  barn. `tests/content.test.ts` asserts exactly that and nothing about the
  absolute numbers, because asserting those would be asserting taste.

**Why the table exists at all:** every animal is authored on the game's 32x64
grid, because in the game every entity IS a grid cell. `wiz` (a cat) is 16x42,
`joy` (a bulldog) 29x42, `blackMule` 28x63, `hand` (a grown man) 30x52. Drawn at
their own size they are a row of identical silhouettes.

---

## Pens

A pen is a **rectangle on the ground plane in perspective**, so "inside it" is a
quadrilateral, not a box. `art/pen-quads.json` publishes the four inside corners
in sprite-local pixels: `far` is the back corner, `near` the front, `left` and
`right` the sides. Stand an animal by interpolating its `footY` between the far
and near edges, and give the near rail a z-index of the front edge so an animal
at the back draws behind it.

Detected, not eyeballed — flood the interior fill from the sprite centre and take
the four extreme points, which ARE the corners because the quad is
diamond-oriented in this projection. Nothing hand-typed, so nothing goes stale.

**The interior is punched out after measuring.** A pen must carry no ground of
its own: the first chicken run came back a golf-green against the ranch's
olive-khaki, and a pen that brings its own floor only works on one surface.
Asking the generator for a transparent interior does not work — it fills it
regardless — but the fill is exactly what makes the quad detectable, so the
answer is keep it, measure with it, delete it. `npm run pens` does both in one
pass, and re-running on a hollow pen is a no-op.

**The first four pens are in the wrong projection and want a reshoot.**
`pen.paddockDirt`'s floor quad is 269 wide x 123 deep, a depth/width of 0.457 —
a camera 25-30° above the horizon looking down into the pen. `ranch.barn`'s
content box is 383x183 = 0.478 for a building FACE, which is a camera only
10-15° up. So the buildings show their front walls while the pens show their
whole floor as a lozenge, and no placement reconciles the two. A reshoot wants
depth/width near **0.20-0.25**, forced with a wide shallow canvas.

---

## Grounding, and why things float

Two helpers in `src/ui/scene.ts`, and scenes must use them instead of the card
helpers:

```ts
sceneSprite('ranch.barn', 440)                     // exact height, shadow, grounded
groundActor('fjordPony', 'walk', 'left', x, footY, 96, '1.1s')
```

`spriteEl` and `clipActor` are for CARDS. `spriteEl` snaps to whole-pixel zoom,
which silently discards its size argument above 1x — `spriteEl('joy', 40)` and
`spriteEl('fjordPony', 96)` return 40px and 53px, which is a bulldog nearly as
tall as a pony. `sceneSprite` scales fractionally and hits the number.

`groundActor` positions by the **feet** and adds a contact shadow. A `top` says
where a head is and nothing about where a thing stands, and the eye reads ground
contact from the shadow before it reads placement. It also sets `z-index` from
`footY`, so back-to-front sorting is free.

**A building on the horizon line floats too.** The ground plane has to start
above its feet, not at them — otherwise the hard sky/ground edge runs straight
through the base of every building and they read as stickers on a backdrop.

---

## Animation

`npm run strips` writes every clip as a flat PNG to `art/strips/` with an
`index.json` giving `{cell, frames, file}`. 687 of them. The contract is
identical to `stripUrl`'s at runtime — uniform square cell, frames centred and
bottom-aligned — so a preview built from the strips and the running game show
the same animation.

Partial clips are skipped rather than half-written: several v3 clips returned 3
of 8 directions, and a strip missing its tail animates into empty space.
`index.json` is the authority on what exists.

**The whole clean cast walks** — all five equines, Joy, four cats, nine hens and
the rooster. Plus three ambient world loops, which is what a title screen
actually lives on: `windmill.spin`, `wheat.sway`, `scarecrow.sway`. Watch the
name collision — `windmill.spin` moves, `ranch.windmill` is the still one; the
moving versions have no prefix.

---

## Naming

Two assets are named for what they ARE and not what was asked for, which is the
rule this project keeps relearning (`node_scrapheap_2` is a fire truck;
`node_saltrock_1` is amethyst):

- `ranch.latrine` — prompted as an emergency eyewash station, came back an
  unmistakable toilet. A bunker wants a latrine anyway.
- `ranch.medChair` — prompted as a wheeled gurney, came back a reclining
  examination chair.
- `ranch.stockTank` and `ranch.feedPan` — prompted as a long trough and a hay
  ring, came back a round stock tank and a feed pan.

Good art of the wrong subject is kept and renamed. Bad art is deleted.
