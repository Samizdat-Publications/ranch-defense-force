# The Hand — generated character, game-ready cells

The first infected-farmhand character, generated in PixelLab and re-cut to the
game's grid. This is the enemy the player sees more than anything else in a run.

## What is here

| File | Size | What it is |
|---|---|---|
| `idle_<dir>.png` | 32×64 | One idle cell per direction, 8 directions |
| `idle_8dir_strip.png` | 256×64 | All eight idles in one strip, for review |
| `walk_<dir>_strip.png` | 256×64 | Scary Walk, 8 frames, one strip per direction |

Directions: `south`, `south-east`, `east`, `north-east`, `north`, `north-west`,
`west`, `south-west`.

## The re-cut, and why it was needed

PixelLab exports a centred figure on a square canvas — 40×40 for rotations,
56×56 for animation frames, both sized for motion room rather than for a tile
grid. Dropped in as-is the character would sit at a different height in every
frame and would not line up with LimeZu's cells.

Every frame here has been trimmed to its opaque bounds and re-placed on a
**32×64 cell**, centred horizontally, with the **feet on y=52** — the same
baseline LimeZu's farmer sheets use. Content measures 24–27 px wide by 38 px
tall in every direction, against the player's 37 px, so the two stand eye to eye.

Do not re-scale these. They are 1:1 game pixels.

## How it was generated

- Tool: **Characters → Create from Text**, Humanoid, **Pro** mode
- Character Size: **40px** custom (the 32px preset produced a 30px body, which
  read as a child next to the player)
- Camera View: **Low Top-Down**
- Reference images: the LimeZu farmer walk sheet and a 4-frame character strip
- Animation: **Walking → Scary Walk**, 8 frames, all 8 directions
- Cost: roughly 20–40 generations for the character, plus the walk per direction

The description that produced it is in `PIXELLAB.md`. The single most important
part of it is the **chibi proportion block** — very large head at about a third
of total height, oversized hat brim, no neck, short stubby legs. Without that
the model returns realistic proportions, which are better pixel art and the
wrong game.

## Use this as the Style Character

PixelLab lets you nominate one of your own characters as the style reference for
the next one. **Nominate this one** for every infected thing that follows — the
boss, the infected livestock, any second enemy type. That is what keeps the
family coherent without re-describing the style each time.

## Where it belongs in the repo

`assets/pixellab/character/farmhand/`, then referenced from `art/sprites.json`
as `hand.idle.<dir>` and `hand.walk.<dir>.<0-7>`. The atlas builder packs strips
the same as any other sheet; the 8-frame walk needs no special handling.
