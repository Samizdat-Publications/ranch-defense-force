# farmhandBlight — GENERATED. Do not hand-edit.

Every PNG beside this file is written by:

```bash
npm run recolour -- assets/pixellab/character/farmhand assets/pixellab/character/farmhandBlight
```

The source is `../farmhand/` — PixelLab character `7418d20d` (`rdf-farmhand-infected`),
delivered already cut to the game's 32×64 cells. This directory is that same rig
with nothing moved: identical filenames, identical cell size, identical strip
widths, identical alpha. **Only the colours differ**, which is why every packed
offset, every measured anchor and every clip length carries over untouched.

Committed rather than gitignored for the same reason `assets/generated/characters/`
is: a fresh clone must be able to run `npm run atlas` without first running every
upstream tool. Regenerating it is one command and is deterministic — if this
directory and the tool ever disagree, the tool is right.

## Why it exists

The delivered farmhand wore the player's clothes. Same straw hat, same blue
dungarees, same 32×64, and the density pass put 2.2× as many of them on the
field — so from wave 6 on you could not find yourself in the crowd. Sessions 20
and 21 both filed it. `tools/recolour-sheet.ts` has the full argument and the
family-by-family colour mapping in its header.

## What was NOT done, and why

Not regenerated. `docs/PIXELLAB_INVENTORY.md` lists four turned farmhands and
**all four are already claimed**: `9bcb41fd` (40×40, the superseded first pass,
kept at `../farmhand_orig/`), `7418d20d` (this one's source), `f6e8c1fb`
(`bloatedFarmhand`) and `371055e3` (`acidZombie`). There was no unclaimed
candidate to pick up, and the fix did not need one. Zero generations were spent.
