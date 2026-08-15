# Home screen — placement tables

Authoritative coordinates, extracted from the mockup source rather than typed by hand.
All numbers are in **1920×1080 stage space**, top-left origin. Layer = DOM order (higher paints later).

Every sprite is drawn at an **integer multiple of its native size**. Where a displayed
size is not a whole multiple, that is a bug — the `zoom` column below is computed, not asserted.

## YARD

| Layer | Sprite | x | y | drawn | native | zoom | animation |
|---|---|---|---|---|---|---|---|
| 1 | `tree_oak.png` | 1150 | 300 | 250×212 | 250×212 | 1× | — |
| 2 | `tree_oak.png` | 1420 | 282 | 250×212 | 250×212 | 1× | — |
| 3 | `tree_oak.png` | 596 | 268 | 250×212 | 250×212 | 1× | — |
| 4 | `silo.png` | 1664 | 192 | 224×448 | 224×448 | 1× | — |
| 7 | `coop.png` | 800 | 478 | 128×160 | 128×160 | 1× | — |
| 8 | `nest.png` | 936 | 542 | 64×96 | 64×96 | 1× | — |
| 9 | `scarecrow.png` | 968 | 546 | 96×96 | 96×96 | 1× | ySway 7.4s ease-in-out infinite |
| 10 | `well.png` | 1112 | 596 | 96×64 | 96×64 | 1× | — |
| 11 | `hay.png` | 646 | 616 | 64×32 | 64×32 | 1× | — |
| 12 | `tree_oak.png` | 1742 | 414 | 250×212 | 250×212 | 1× | — |
| 13 | `doghouse.png` | 722 | 552 | 64×96 | 64×96 | 1× | — |
| 19 | `pen_v.png` | -2 | 20 | 16×32 | 16×32 | 1× | — |
| 22 | `cow.png` | 1628 | 658 | 90×54 | 90×54 | 1× | yBob 5.4s ease-in-out infinite |
| 23 | `calf.png` | 1746 | 672 | 52×40 | 52×40 | 1× | yBob 3.1s ease-in-out infinite 0.6s |
| 24 | `sheep.png` | 1826 | 678 | 52×34 | 52×34 | 1× | yBob 4.2s ease-in-out infinite 1.4s |
| 25 | `trough.png` | 1600 | 700 | 64×32 | 64×32 | 1× | — |
| 28 | `chicken_peck_strip.png` (tiled) | 856 | 676 | tile 256×64 | 128×32 | 2× | yStrip256 2s steps(4) infinite |
| 29 | `chick.png` | 920 | 678 | 64×64 | 32×32 | 2× | yBob 2.2s ease-in-out infinite |
| 30 | `rooster.png` | 758 | 640 | 64×64 | 32×32 | 2× | yBob 3.6s ease-in-out infinite |
| 31 | `chicken_peck_strip.png` (tiled) | 992 | 660 | tile 256×64 | 128×32 | 2× | yStrip256 2.6s steps(4) infinite 0.8s |
| 32 | `chicken_peck_strip.png` (tiled) | 1064 | 674 | tile 256×64 | 128×32 | 2× | yStrip256 3.1s steps(4) infinite 1.9s |
| 35 | `fence_picket.png` (tiled) | -20 | 742 | tile 96×32 | 96×32 | 1× | — |
| 36 | `dog_lab.png` | 132 | 818 | 120×84 | 60×42 | 2× | yBob 2.4s ease-in-out infinite |
| 37 | `milkcan.png` | 24 | 872 | 48×64 | 24×32 | 2× | — |
| 38 | `milkcan.png` | 66 | 890 | 48×64 | 24×32 | 2× | — |

## FIELD

| Layer | Sprite | x | y | drawn | native | zoom | animation |
|---|---|---|---|---|---|---|---|
| 1 | `tree_oak.png` | 900 | 352 | 250×212 | 250×212 | 1× | — |
| 2 | `tree_oak.png` | 1560 | 352 | 250×212 | 250×212 | 1× | — |
| 3 | `silo.png` | 1672 | 116 | 224×448 | 224×448 | 1× | — |
| 4 | `barn.png` | 1208 | 340 | 480×224 | 480×224 | 1× | — |
| 5 | `house.png` | 560 | 244 | 256×320 | 256×320 | 1× | — |
| 6 | `farmer_idle.png` | 1392 | 508 | 32×64 | 32×64 | 1× | — |
| 7 | `farmer2_idle.png` | 1436 | 512 | 32×64 | 32×64 | 1× | — |
| 10 | `chicken_peck_strip.png` (tiled) | 1350 | 542 | tile 128×32 | 128×32 | 1× | fStrip128 2.4s steps(4) infinite |
| 11 | `chicken_peck_strip.png` (tiled) | 1386 | 548 | tile 128×32 | 128×32 | 1× | fStrip128 3.1s steps(4) infinite 0.7s |
| 12 | `chicken_peck_strip.png` (tiled) | 1478 | 544 | tile 128×32 | 128×32 | 1× | fStrip128 2.8s steps(4) infinite 1.5s |
| 13 | `chicken_peck_strip.png` (tiled) | 1560 | 540 | tile 128×32 | 128×32 | 1× | fStrip128 3.4s steps(4) infinite 2.2s |
| 16 | `wheat.png` (tiled) | -32 | 574 | tile 64×64 | 32×32 | 2× | fCrop 5.2s ease-in-out infinite |
| 17 | `wheat.png` (tiled) | -32 | 636 | tile 64×64 | 32×32 | 2× | fCrop 5.9s ease-in-out infinite 0.7s |
| 18 | `wheat2.png` (tiled) | -32 | 700 | tile 96×96 | 32×32 | 3× | fCrop 6.4s ease-in-out infinite |
| 19 | `wheat2.png` (tiled) | -32 | 806 | tile 96×96 | 32×32 | 3× | fCropSlow 7.1s ease-in-out infinite 1.2s |
| 20 | `wheat2.png` (tiled) | -32 | 902 | tile 128×128 | 32×32 | 4× | fCropSlow 8.3s ease-in-out infinite |
| 22 | `scarecrow.png` | 640 | 522 | 96×96 | 96×96 | 1× | fSway 6.6s ease-in-out infinite |
| 23 | `hay.png` | 700 | 606 | 64×32 | 64×32 | 1× | — |

