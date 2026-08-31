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

**Engine.** Per-map dressing (scenery and decals are data, not hardcoded farm
lists). A wall band for the arena edge, as a Wang TERRAIN not stamped sprites.
`boundary.inset` holding the player, nodes, breakables, hazards, scenery and
decals off it — defaulting to 0, so every surface map is byte-identical. A level
exit: a door that unseals after a wave, `World.descendTo` that swaps the room and
keeps the run, and `theLift` as a second base level. `World(seed, cls, mods,
tier, forceMapId)` overriding the map draw's RESULT and never the draw.

**Scene helpers.** `sceneSprite` and `groundActor` in `src/ui/scene.ts`. The card
helpers (`spriteEl`, `clipActor`) snap to whole-pixel zoom and silently discard
their size argument — that was the bulldog-the-size-of-a-pony bug.

**Art.** The whole clean farm cast walks. Five base enemies (tech, guard,
hazmat, operator, breacher) at `weight: 0`. Pens as whole sprites with detected
ground quads and punched-out interiors. Corn wall and treeline horizons. Drum
rank / scatter / stack. Barn kit. Bunker fittings.

## What is IN FLIGHT and unfinished

- **The vat's scale is a STORY call and it is the owner's.** `vault.vatSpecimen`
  is drawn at `drawAt` 78, which is 206 tall against a 64px person. Measured:
  the tube is 58x153 and the silhouette inside it is 36x87, so the figure is 57%
  of the tube whatever size it is drawn. That gives three readings, and none of
  them is a bug:

  | `drawAt` | tube | figure | reads as |
  |---|---|---|---|
  | **78** (shipped) | 206 | 117 | 1.8x a person — something bigger than human in there |
  | **43** | 113 | 64 | exactly a person |
  | **38** (Design's suggestion) | 100 | 57 | slightly under a person |

  43 is the precise version of what Design proposed; 38 undershoots by 7px.
  Nothing is changed pending the owner — a monumental tank is a legitimate
  choice and arguably the better story, which is why Design built it at 78 and
  flagged it rather than fixing it.
- **`pen.chickenRunFlat` is a known partial failure** — the wire mesh reads as
  interior to the flood, so the quad came back degenerate. Do not use it.
- **Balance on the base cast has still never been played.** Five enemies, all
  numbers interpolated. This is the joint-activity item and it is the largest
  unfinished thing in the project.

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
