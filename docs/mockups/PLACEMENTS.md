# Scene placements — generated, do not hand-edit

Written by `npm run placements` straight out of the Claude Design artboards.
All numbers are in **1920x1080 stage space**, top-left origin. Layer = DOM order
(higher paints later), which is the order `src/ui/scene.ts` must build in.

`still` is an atlas key drawn once. `strip` is `sheet.clip.direction` — a
packed animation, drawn by `stripActor`/`clipActor` rather than as an image.

## Yard Grounding Fix

52 placements.

| # | kind | key | x | y | w | h | animation | tint |
|---|---|---|---|---|---|---|---|---|
| 1 | still | `scene.treeOak` | 230 | 368 | 250 | 212 | — | op 0.4 · blur(2.4px) brightness(0.4) saturate(0.5) |
| 2 | still | `scene.treeOak` | 520 | 360 | 250 | 212 | — | op 0.46 · blur(2px) brightness(0.46) saturate(0.58) |
| 3 | still | `scene.treeOak` | 1130 | 364 | 250 | 212 | — | op 0.43 · blur(2.2px) brightness(0.43) saturate(0.54) |
| 4 | still | `scene.treeOak` | 1408 | 356 | 250 | 212 | — | op 0.48 · blur(2px) brightness(0.48) saturate(0.58) |
| 5 | still | `scene.treeOak` | 1716 | 366 | 250 | 212 | — | op 0.41 · blur(2.4px) brightness(0.41) saturate(0.5) |
| 6 | still | `ranch.silo` | 1559 | 337 | 227 | 406 | — | brightness(0.92) saturate(0.9) |
| 7 | still | `ranch.bunkhouse` | 132 | 453 | 290 | 290 | — | brightness(0.8) saturate(0.86) |
| 8 | still | `ranch.barn` | 1079 | 476 | 460 | 257 | — | brightness(0.92) saturate(0.94) |
| 9 | still | `ranch.farmhouse` | 405 | 254 | 435 | 544 | — | brightness(0.86) saturate(0.9) |
| 10 | strip | `windmill.spin.down` | 806 | 510 | 188 | 188 | y-strip 4.5s steps(9) infinite | brightness(0.86) saturate(0.85) |
| 11 | still | `ranch.roundBale` | 605 | 657 | 107 | 107 | — | brightness(0.9) saturate(0.94) |
| 12 | still | `ranch.squareBales` | 729 | 743 | 42 | 21 | — | brightness(0.9) |
| 13 | still | `ranch.doghouse` | 825 | 693 | 54 | 54 | — | brightness(0.92) |
| 14 | still | `ranch.wellStone` | 688 | 734 | 104 | 69 | — | brightness(0.92) saturate(0.92) |
| 15 | still | `ranch.coop` | 958 | 626 | 137 | 171 | — | brightness(0.88) saturate(0.88) |
| 16 | still | `ranch.nestBox` | 1085 | 722 | 43 | 32 | — | brightness(0.9) |
| 17 | strip | `scarecrow.sway.down` | 1404 | 648 | 96 | 96 | y-strip 7.4s steps(9) infinite | — |
| 18 | still | `ranch.feedPan` | 889 | 749 | 80 | 53 | — | brightness(0.94) |
| 19 | still | `ranch.eggClutch` | 1105 | 730 | 43 | 28 | — | — |
| 20 | still | `ranch.eggClutch` | 985 | 786 | 43 | 28 | — | — |
| 21 | strip | `brahmaHen.peck.downRight` | 856 | 708 | 40 | 40 | y-strip 1.9s steps(9) infinite | — |
| 22 | strip | `brahmaHen.peck.down` | 934 | 734 | 40 | 40 | y-strip 2.3s steps(9) infinite 0.6s | — |
| 23 | strip | `leghornHen.walk.down` | 1002 | 716 | 36 | 36 | — | — |
| 24 | strip | `beardedHen.walk.down` | 828 | 756 | 34 | 34 | — | — |
| 25 | strip | `silkieHen.walk.down` | 1040 | 770 | 30 | 30 | — | — |
| 26 | strip | `barredHen.walk.down` | NaN | NaN | NaN | NaN | mull-idle 53s step-end infinite | — |
| 27 | strip | `barredHen.walk.left` | NaN | NaN | NaN | NaN | y-strip 0.8s steps(9) infinite, mull-out 53s step-end infinite | op 0 |
| 28 | strip | `barredHen.walk.left` | NaN | NaN | NaN | NaN | y-strip 0.8s steps(9) infinite, mull-back 53s step-end infinite | op 0 |
| 29 | strip | `polishHen.walk.down` | NaN | NaN | NaN | NaN | mull-idle 43s step-end infinite | — |
| 30 | strip | `polishHen.walk.left` | NaN | NaN | NaN | NaN | y-strip 0.8s steps(9) infinite, mull-out 43s step-end infinite | op 0 |
| 31 | strip | `polishHen.walk.left` | NaN | NaN | NaN | NaN | y-strip 0.8s steps(9) infinite, mull-back 43s step-end infinite | op 0 |
| 32 | strip | `farmRooster.walk.down` | NaN | NaN | NaN | NaN | mull-idle 67s step-end infinite | — |
| 33 | strip | `farmRooster.walk.left` | NaN | NaN | NaN | NaN | y-strip 0.9s steps(9) infinite, mull-out 67s step-end infinite | op 0 |
| 34 | strip | `farmRooster.walk.left` | NaN | NaN | NaN | NaN | y-strip 0.9s steps(9) infinite, mull-back 67s step-end infinite | op 0 |
| 35 | strip | `tabbyCat.walk.left` | NaN | NaN | NaN | NaN | mull-idle 71s step-end infinite | — |
| 36 | strip | `tabbyCat.walk.left` | NaN | NaN | NaN | NaN | y-strip 0.7s steps(9) infinite, mull-out 71s step-end infinite | op 0 |
| 37 | strip | `tabbyCat.walk.left` | NaN | NaN | NaN | NaN | y-strip 0.7s steps(9) infinite, mull-back 71s step-end infinite | op 0 |
| 38 | still | `ranch.stockTank` | 1558 | 750 | 78 | 52 | — | brightness(0.94) |
| 39 | strip | `fjordPony.graze.downRight` | 1450 | 704 | 96 | 96 | y-strip 5.3s steps(9) infinite | — |
| 40 | strip | `fjordPony.walk.left` | NaN | NaN | NaN | NaN | mull-idle 61s step-end infinite | — |
| 41 | strip | `fjordPony.walk.left` | NaN | NaN | NaN | NaN | y-strip 1.4s steps(9) infinite, mull-out 61s step-end infinite | op 0 |
| 42 | strip | `fjordPony.walk.left` | NaN | NaN | NaN | NaN | y-strip 1.4s steps(9) infinite, mull-back 61s step-end infinite | op 0 |
| 43 | strip | `joy.sit.downRight` | NaN | NaN | 60 | 60 | y-strip 3.1s steps(9) infinite, joy-sit 43s step-end infinite | — |
| 44 | strip | `joy.walk.right` | NaN | NaN | 60 | 60 | y-strip 0.62s steps(9) infinite, joy-right 43s step-end infinite | op 0 |
| 45 | strip | `joy.walk.left` | NaN | NaN | 60 | 60 | y-strip 0.62s steps(9) infinite, joy-left 43s step-end infinite | op 0 |
| 46 | still | `scene.fencePicket` | -20 | 834 | 1960 | 32 | — | brightness(0.6) saturate(0.85) |
| 47 | strip | `wheat.sway.down` | 1403 | 732 | 88 | 88 | y-strip 5.1s steps(9) infinite | op 0.88 · brightness(0.8) |
| 48 | strip | `wheat.sway.down` | 1563 | 772 | 88 | 88 | y-strip 6.3s steps(9) infinite 1.1s | op 0.82 · brightness(0.72) |
| 49 | strip | `wheat.sway.down` | 303 | 820 | 88 | 88 | y-strip 8.1s steps(9) infinite 2.4s | op 0.76 · brightness(0.6) |
| 50 | strip | `wheat.sway.down` | 1683 | 860 | 88 | 88 | y-strip 9.7s steps(9) infinite 3.6s | op 0.7 · brightness(0.44) |
| 51 | still | `ranch.feedBucket` | 487 | 858 | 52 | 52 | — | brightness(0.6) |
| 52 | still | `ranch.feedBucket` | 539 | 876 | 52 | 52 | — | brightness(0.54) |

## Lab at Depth

44 placements.

| # | kind | key | x | y | w | h | animation | tint |
|---|---|---|---|---|---|---|---|---|
| 1 | still | `base.ceilingPipes` | NaN | NaN | NaN | 96 | — | brightness(0.72) |
| 2 | still | `base.striplightLit` | 260 | 44 | 192 | 96 | l-hum 5.3s ease-in-out infinite | — |
| 3 | still | `base.striplightLit` | 700 | 44 | 192 | 96 | l-hum 6.7s ease-in-out infinite 1.4s | — |
| 4 | still | `base.striplightLit` | 1500 | 44 | 192 | 96 | l-hum 7.9s ease-in-out infinite 0.6s | — |
| 5 | still | `base.striplightDead` | 1060 | 36 | 192 | 144 | — | brightness(0.5) |
| 6 | still | `base.wallPipes` | 200 | 280 | 96 | 144 | — | brightness(0.88) |
| 7 | still | `base.wallHazard` | 330 | 280 | 96 | 144 | — | brightness(0.9) |
| 8 | still | `base.warningSign` | 104 | 300 | 96 | 144 | — | — |
| 9 | still | `base.wallVent` | 1120 | 280 | 96 | 144 | — | brightness(0.86) |
| 10 | still | `base.wallStencil` | 1240 | 280 | 96 | 144 | — | brightness(0.9) |
| 11 | still | `base.wallLamp` | 1360 | 280 | 96 | 144 | — | brightness(1.05) |
| 12 | still | `base.warningSign` | 1462 | 300 | 96 | 144 | — | — |
| 13 | still | `base.wallPipes` | 1790 | 280 | 96 | 144 | — | brightness(0.82) |
| 14 | still | `base.lift3` | 820 | 244 | 256 | 256 | — | — |
| 15 | still | `base.blastDoor5` | 1500 | 248 | 256 | 256 | — | — |
| 16 | strip | `tankSwirl.swirl.down` | 1167 | 475 | 192 | 192 | y-strip 2.9s steps(9) infinite | — |
| 17 | strip | `tankSwirl.churn.down` | 1352 | 483 | 192 | 192 | y-strip 3.3s steps(9) infinite 0.6s | — |
| 18 | strip | `tankPanel.churn.down` | 1540 | 491 | 192 | 192 | y-strip 3.9s steps(9) infinite 1.3s | — |
| 19 | strip | `tankBarrel.swirl.down` | 1710 | 496 | 192 | 192 | y-strip 4.3s steps(9) infinite 2.1s | — |
| 20 | still | `vault.vatBroken` | NaN | NaN | 194 | 292 | — | brightness(0.82) |
| 21 | still | `vault.vatAlien` | NaN | NaN | 161 | 241 | — | brightness(0.94) |
| 22 | strip | `vatSpecimen.bubble.down` | 386 | 456 | 261 | 261 | y-strip 3.6s steps(9) infinite | — |
| 23 | strip | `baseHazmat.walk.right` | NaN | NaN | NaN | NaN | mull-haz-pr 41s step-end infinite | brightness(0.9) |
| 24 | strip | `baseHazmat.walk.left` | NaN | NaN | NaN | NaN | mull-haz-pl 41s step-end infinite | op 0 · brightness(0.9) |
| 25 | strip | `baseHazmat.walk.left` | NaN | NaN | NaN | NaN | y-strip 1.2s steps(8) infinite, mull-haz-wl 41s step-end infinite | op 0 · brightness(0.9) |
| 26 | strip | `baseHazmat.walk.right` | NaN | NaN | NaN | NaN | y-strip 1.2s steps(8) infinite, mull-haz-wr 41s step-end infinite | op 0 · brightness(0.9) |
| 27 | still | `vault.floorGrate` | 980 | 890 | 143 | 143 | — | brightness(0.62) |
| 28 | still | `vault.floorGrate` | 1420 | 930 | 143 | 143 | — | brightness(0.56) |
| 29 | strip | `labConsole.flicker.down` | NaN | NaN | NaN | NaN | y-strip 1.8s steps(9) infinite | — |
| 30 | still | `vault.jarRack` | NaN | NaN | 210 | 210 | — | brightness(0.92) |
| 31 | still | `vault.drumRank` | NaN | NaN | 516 | 309 | — | brightness(0.84) |
| 32 | still | `base.labBench` | NaN | NaN | 188 | 150 | — | brightness(0.96) |
| 33 | strip | `baseTech.walk.left` | NaN | NaN | NaN | NaN | mull-tech-pl 47s step-end infinite | — |
| 34 | strip | `baseTech.walk.right` | NaN | NaN | NaN | NaN | mull-tech-pr 47s step-end infinite | op 0 |
| 35 | strip | `baseTech.walk.right` | NaN | NaN | NaN | NaN | y-strip 1.2s steps(8) infinite, mull-tech-wr 47s step-end infinite | op 0 |
| 36 | strip | `baseTech.walk.left` | NaN | NaN | NaN | NaN | y-strip 1.2s steps(8) infinite, mull-tech-wl 47s step-end infinite | op 0 |
| 37 | strip | `baseGuard.walk.left` | NaN | NaN | NaN | NaN | mull-guard-pl 59s step-end infinite | brightness(0.86) |
| 38 | strip | `baseGuard.walk.right` | NaN | NaN | NaN | NaN | mull-guard-pr 59s step-end infinite | op 0 · brightness(0.86) |
| 39 | strip | `baseGuard.walk.right` | NaN | NaN | NaN | NaN | y-strip 1.2s steps(8) infinite, mull-guard-wr 59s step-end infinite | op 0 · brightness(0.86) |
| 40 | strip | `baseGuard.walk.left` | NaN | NaN | NaN | NaN | y-strip 1.2s steps(8) infinite, mull-guard-wl 59s step-end infinite | op 0 · brightness(0.86) |
| 41 | still | `vault.drumScatter` | NaN | NaN | 372 | 239 | — | brightness(0.62) |
| 42 | still | `vault.examTable` | NaN | NaN | 414 | 296 | — | brightness(1.02) |
| 43 | strip | `tankVat.swirl.down` | 1147 | 848 | 179 | 179 | y-strip 5.4s steps(9) infinite | brightness(0.86) |
| 44 | still | `vault.drumStack` | NaN | NaN | 268 | 241 | — | brightness(0.7) |
