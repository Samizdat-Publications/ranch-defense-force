# Backlog — owner's asks, session 16

Raised during session 16, not yet built. Ordered by impact rather than by when
they were said. The measured generation costs behind the art estimates are in
`docs/PIXELLAB.md` under *Paying in dollars*.

---

## P0 — The white flash makes the game unreadable

**This is not polish. It is the single worst thing on screen right now.**

Owner, on the wave-12 boss: *"when an enemy is being hit or dying it just turns
white so like the boss bull appeared and I kept hitting him so he stayed white
and I never got to see him."* Two screenshots at wave 15 with 266 live enemies
show **most of the crowd as solid white silhouettes** — the hit flash never gets
a chance to decay because attack speed is high enough that every enemy is
re-flashed before the previous flash ends.

The flash is `Enemy.flash`, set on every hit and decayed in `updateEnemies`,
drawn as a white `source-atop` redraw. Spec §10 lists it as a 60ms effect; at
this fire rate it is effectively permanent.

Fix in two parts:

1. **Code, immediate and free.** Cap or refractor the flash so it cannot
   re-trigger while already flashing, and shorten it. A boss should read as a
   boss while being hit. This alone fixes the screenshots.
2. **Art, cheap.** A real `hit` clip per creature — a recoil, not a colour
   swap. Measured at ~$0.0104 per direction, so a hit reaction for one enemy in
   all 8 directions is **$0.08**. The crow probe already has one generated
   (`object 1597da81-71fe-430b-9e17-4353004e2d60`, clip `hit`, 6 frames).

Do (1) before any art. The flash logic is wrong regardless of what art exists.

---

## P0 — Pool starvation, visible in the dev overlay

From the same screenshots, at wave 15:

```
particles 861/900  peak 900  STARVED 23824
dmgNums    63/64   peak  64  STARVED 35233
hazards    64/64   peak  64
crops      54/120  peak  74
```

Three pools are pinned at capacity and dropping tens of thousands of requests.
`hazards 64/64` is the one that matters for the maps work — the ambient hazard
system added this session is competing with weapon hazards for 64 slots.

All three are one-line content edits in `tuning.json`. The download-size reason
to keep them small no longer applies (live link, and the owner has said not to
optimise for bytes). Target 30–60fps and raise until the frame budget says stop —
the overlay already reports frame time, so this is measurable rather than
guessed.

Also seen: **`hp -0/140`** in the homestead screenshot — a negative-zero HP
display.

---

## P1 — Homestead is unfinished

Owner: *"right now it doesn't work or go backwards when selecting things."*
Screenshot shows the County Fair tier card stuck on `SELECTED` with no way back.
Needs a working back/cancel path and a confirm step. `src/ui/homestead.ts`.

## P1 — UI overlap

The between-waves panel overlaps the weapon ring row along the bottom edge, and
the HUD's top-left health bar collides with the County Fair banner. Both visible
in the screenshots.

## P1 — Harvest feedback

Owner: *"when you harvest something it should say so, maybe under the life bar,
how much of what you picked up."* A small floating readout under the health bar.
The damage-number pool pattern is the obvious model — but note it is starving,
so this needs its own budget or a shared, larger pool.

---

## P2 — Bring the map alive (the current focus)

Owner: *"our job right now is to bring this map and characters and objects alive
with full animations to take full advantage of the fact we can generate whatever
we want."* And: *"even the rocks with diamonds can glimmer."*

Everything on the field currently sits still. `animate-with-text-v3` turns any
existing still into an 8-frame loop for **$0.024 at 48px**, and it works on art
already in the repo — no re-generation needed.

| subject | count | est. |
|---|---|---|
| ore/crystal rocks — glimmer loop | 5 | $0.12 |
| plain rocks — subtle settle | 3 | $0.07 |
| trees — sway loop | 4 | $0.10 |
| crops — sway, healthy + blighted | 20 | $0.48 |
| scenery props — flag, drip, smoke | 18 | $0.43 |
| **total** | **50** | **~$1.20** |

Nothing about this is expensive. It is the highest visible-quality-per-dollar
item on the list.

## P2 — Destructible map objects

Owner: *"a lot of items on the map, I want them to be destructible and auto
aimed at and occasionally have rare gear, usually have nothing, and sometimes
have XP or food, kind of like your standard Vampire Survivors type thing."*

Design is in the session plan. Blocking issue: `TUNING.pools.props` is **120**
and boneOrchard's node maxima already total **140** — the pool is
over-subscribed before anything is added.

Note the drop table is a **new** shape: today every node pays out. "Usually
nothing, sometimes XP/food, rarely rare gear" needs a weighted table per
destructible class, and "rare gear" implies dropping an *item card* from the
field, which does not exist yet.

"Auto aimed at" also conflicts with the current design on purpose —
`world.ts:1002-1014` records that weapons used to damage nodes and it "quietly
defeated the whole harvesting design." Destructibles that weapons target need to
be a **separate kind** from harvestable nodes, not a change to them.

## P2 — Companions

Owner wants companions that *"follow you, each with special abilities, fully
animated so they can walk next to you or independently and seek enemies on their
own or throw oil slicks or freeze enemies."*

`minionHunt` already does autonomous seek-and-bite (Barn Dog). What is new is
per-companion abilities. A fully animated 8-direction companion with walk,
attack, death and hit is **~$0.42**; ten of them is $4.20.

## P2 — Element variants changing bullets

Owner: *"consider different classes of the same weapon like ice modifier or acid
etc and how that changes the bullets with different combos."*

**This system already exists and is half-built.** `elements.json` has
fire/acid/frost, and 7 of 10 projectile clips already ship in 4 element colours
(`proj.pellet.fire` etc). Two things are wrong:

- A **live bug** makes it worse, not better: with any element equipped, `scythe`
  and `drumGun` shards render the **weapon icon** instead of the projectile,
  because `renderer.ts:1128` treats a missing clip as present
  (`clipLength` returns a truthy `?? 1`).
- Only `fire` gets its own impact. `none`, `acid` and `frost` all resolve to
  `arrowImpact`, so three of four elements look the same on hit.

Fixing the bug and giving each element its own impact is mostly code. Combos
between elements would be new design.

## P2 — Ambient haze / fog

Owner: *"a layer of haze or fog on the ground or in the air, think up something
we can use interchangeably across levels."*

Should be **code, not art** — a scrolling low-alpha layer the map descriptor
parameterises (colour, density, height, drift speed), so every map gets its own
atmosphere from one implementation. Gas already renders below all sprites and is
the precedent for translucency. Beware: spec §8 says gas is *"the only
translucent thing on screen"* precisely for readability, so a haze layer needs
to be measurably subtler than gas or it fights it — and the white-flash problem
proves this game punishes anything that reduces contrast.

## P3 — More enemy types

After the above. ~$0.42 each fully animated.

---

## Later — a real engine

Owner: *"I'd love to make a version of it in Godot someday, or the new Unity
plugin, or GameMaker — whatever works best."*

PixelLab's Vibe Coding MCP has documented paths for all three.

**What a port would actually get us**, honestly:

| | |
|---|---|
| **Real wins** | Free perf headroom — GPU sprite batching instead of Canvas2D `drawImage` per sprite, which is what caps the current draw calls at ~1,500/frame. Native controller input. Real audio mixing with falloff. One-click export to desktop and consoles. A scene editor for the homestead and title screens instead of hand-placed DOM coordinates. |
| **Costs** | The sim is ~11k lines of TypeScript that would need porting to GDScript or C#. The deterministic seeded-RNG replay guarantee has to be rebuilt exactly or every recorded seed dies. The atlas pipeline and all 15 `tools/*.ts` scripts are Node and would need rewriting or keeping as a side pipeline. |
| **What does NOT transfer** | Nothing about the design. Content JSON, the tick order, the pooling discipline and the balance work all carry over conceptually — the port is mechanical, not creative. |

**Recommendation: not yet, and not for perf.** The current build runs 54–83fps
with 266 enemies on screen, and the overlay says the bottleneck is pool
starvation and draw calls, both fixable in place. A port is worth doing when the
target is *distribution* — Steam, consoles, controller support — not when it is
frame rate. Godot is the right first target if and when: 2D-pixel-native, free,
and the only one of the three with a documented MCP path.

Revisit after the game is content-complete. Porting a moving target is the
expensive way to do it.

---

## Use the right generator — the endpoint is not always `map-objects`

This project has generated nearly everything through `/v2/map-objects` because
it was the cheapest per call on the *generation* counter. On USD credits that
reasoning no longer holds, and PixelLab has purpose-built tools that produce
better results for less work. Match the tool to the subject:

| subject | tool | endpoint | why |
|---|---|---|---|
| Humanoid enemies, the cast, new classes | **Character Creator** | `/create-character-v3`, `/create-character-with-8-directions`, `/animate-character` | Ships **preset animations** — walk cycles, Scary Walk, attacks — so a humanoid does not need a hand-written `animation_description` per clip. `style_character_id` chains one anchor across a whole cast. |
| Creatures, companions, animals | **Object Creator** (8-direction) | `/create-8-direction-object` + `/objects/{id}/animations` | $0.09 rig, then ~$0.0104 per animated direction. Custom descriptions, which animals need. |
| Static props, destructibles, pickups, weapon icons | **Object Creator** (map object) | `/v2/map-objects` | $0.0075 flat, any aspect ratio 32–400px. |
| Ground, biomes, new maps | **Tilesets** | `/create-tileset`, `/create-tileset-sidescroller` | Wang sets, which is exactly what the renderer bakes. 1–4 generations, far cheaper than the 20 this repo records. `tools/pixellab-tileset.ts` already recovers a set by id. |
| Panels, HUD frames, cards, buttons | **UI Creator** | `/create-ui-asset`, `/generate-ui-v2` | `ui_panel` produced **one usable candidate out of twelve** through map-objects last session — eleven blank parchment. A panel is a shape, and the object endpoint wants to draw a subject. This is the tool that was missing. |
| Turning an existing still into a loop | **Animate** | `/animate-with-text-v3` | Works on art already in the repo. $0.024 at 48px. The whole "bring the map alive" pass is this one endpoint. |

Two consequences worth acting on:

- **The UI pack is retirable.** `public/ui/panel.png` is the last thing coming
  from a purchased LimeZu pack, and the reason it survived is that map-objects
  could not draw a nine-slice frame. `/create-ui-asset` is the tool for it.
- **Humanoid enemies get much cheaper.** The roster's people — farmhands,
  sprayers, haulers — are Character Creator subjects with preset walks, not
  8-direction objects needing three custom clips each.

### Angle discipline, per subject type

The house camera is `low top-down` and `docs/ART_STYLE.md` says to pass it
explicitly. **Projectiles are the exception.** The renderer rotates a moving
projectile to `atan2(vy, vx)` every frame, so a round carrying 45° perspective
visibly tips over when it flies north. Generate projectiles `side`, flat, with
no ground and no shadow, authored pointing east. Everything that stands on the
ground — creatures, props, destructibles, tilesets — stays `low top-down`.
