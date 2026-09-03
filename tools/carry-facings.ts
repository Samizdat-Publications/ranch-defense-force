/**
 * One class, six weapons, four facings, side by side.
 *
 *     npm run facings -- [class] [out.png] [seed]
 *
 * The loadout is the one thing in this game whose bugs are all in the SPATIAL
 * relationship between a sprite and a body, and a shot of a run catches
 * exactly one facing per screenshot. Three weapons stacked on the farmhand's
 * chin, a pitchfork through his hat, a rifle that swings its stock through him
 * as it tracks — every one of those was found by looking at four facings at
 * once, and none of them is visible in a single frame of play.
 *
 * It draws through `tools/draw-world.ts`, the second painter, for the reason
 * that file exists: it is an independent implementation of the same rules, so
 * a composite that looks right here and wrong in the game is a real finding
 * rather than a tooling artefact.
 *
 * The player is armed by hand rather than by playing to a level, because the
 * point is the geometry and not the run: the same six weapons, at the same
 * tier, for every class, so two composites can be laid side by side.
 */
import { writeFileSync } from 'node:fs'
import { WorldPainter, encodePng, blankImage } from './draw-world.ts'
import { blit } from './png.ts'
import { World } from '../src/sim/world.ts'
import { drawText } from './tinyfont.ts'

const classId = process.argv.slice(2).filter((a) => a !== '--')[0] ?? 'hand'
const out = process.argv.slice(2).filter((a) => a !== '--')[1]
  ?? `docs/progress/carry-facings-${classId}.png`
const seed = Number(process.argv.slice(2).filter((a) => a !== '--')[2] ?? 20260903)

/**
 * One of everything that is carried, so no slot is left to guesswork.
 *
 * `RDF_KIT=harpoon,pitchfork` narrows it, and narrowing it is how an anchor is
 * actually diagnosed: eight objects on a 30px-wide body is the state worth
 * shipping, and it is useless for working out which of them is the one at the
 * wrong angle. Look at the full kit to judge the silhouette, one weapon to
 * judge an anchor.
 */
const KIT = (process.env.RDF_KIT ?? 'scattergun,varmintRifle,drumGun,harpoon,pitchfork,chemSprayer')
  .split(',').filter(Boolean)

/** down, up, left, right — as `directionIndex` reads them, not as it lists them. */
const FACINGS: [string, number][] = [
  ['DOWN', Math.PI / 2],
  ['UP', -Math.PI / 2],
  ['LEFT', Math.PI],
  ['RIGHT', 0],
]

/**
 * The view is in WORLD pixels; the painter multiplies by its own zoom, so the
 * cell on the sheet is `VIEW_W * ZOOM` across. Reading that off the canvas
 * rather than assuming it is what stops the composite cropping each cell to
 * its top-left corner and losing the man off the right-hand edge.
 */
const VIEW_W = 64
/**
 * Tall, and then cropped, because the camera centres on the player's ORIGIN
 * and a 52px man drawn at the painter's zoom is 104 canvas pixels of which
 * all but a few are ABOVE that point. A view short enough to frame him nicely
 * puts his head off the top edge; this frames him with room for a pitchfork
 * over the shoulder and throws away the empty ground below his boots.
 */
const VIEW_H = 120
const PAD = 6
/**
 * The composite is enlarged before it is written, and only here.
 *
 * The game already draws at an integer zoom and this multiplies that again by
 * an integer, nearest-neighbour, so no pixel is invented — it is a magnifying
 * glass over the shot, not a resample. Every anchor bug this sheet is for is a
 * two-or-three pixel relationship on a 52px body, and at 1:1 they are all
 * below the threshold at which anyone can see them.
 */
const MAG = 3

const world = new World(seed, classId, {}, 1)
for (const id of KIT) if (!world.player.weapons.some((w) => w.id === id)) world.player.addWeapon(id, 1)
// Tier 3 on everything: a merged loadout is the state the art was drawn for,
// and it is the one that stacks the most objects on the smallest body.
for (const w of world.player.weapons) w.tier = 3
world.player.pickaxeTier = 2
world.player.axeTier = 2
// Stand him in the middle of the arena. The painter's camera clamps to the
// arena edges exactly as the game's does, so a player near a wall is drawn
// off-centre and the right-hand cell loses half its loadout off the edge.
world.player.x = world.arenaW / 2
world.player.y = world.arenaH / 2
world.player.px = world.player.x
world.player.py = world.player.y

const probe = new WorldPainter(VIEW_W, VIEW_H)
const CELL_W = probe.canvas.width
/**
 * Only the top of the cell is kept. A character's origin is the floor of his
 * cell and the camera centres on that origin, so a square view spends its
 * whole bottom half on the ground he is standing on and squeezes the man --
 * the only thing this sheet is about -- into a band at the top.
 */
const CELL_H = Math.round(probe.canvas.height / 2) + 26

const sheet = blankImage(CELL_W * FACINGS.length, CELL_H)
for (let i = 0; i < FACINGS.length; i++) {
  const [label, angle] = FACINGS[i]
  const p = world.player
  p.facing = angle
  // Every weapon aims where he faces, so the held one is read against the
  // body rather than against wherever the last enemy happened to be.
  for (const w of p.weapons) w.aimAngle = angle
  // `hand` belongs to whatever fired most recently; give it to the first of
  // the kit so the same weapon is held in all four cells.
  p.weapons[0].firedAt = 1

  const painter = new WorldPainter(VIEW_W, VIEW_H)
  painter.paint(world)
  blit(painter.canvas, 0, 0, CELL_W, CELL_H, sheet, i * CELL_W, 0)
  drawText(sheet, label, i * CELL_W + PAD, PAD, 0xf0e8d0, 1)
}

const big = blankImage(sheet.width * MAG, sheet.height * MAG)
for (let y = 0; y < big.height; y++) {
  for (let x = 0; x < big.width; x++) {
    const si = (((y / MAG) | 0) * sheet.width + ((x / MAG) | 0)) * 4
    const di = (y * big.width + x) * 4
    big.data[di] = sheet.data[si]
    big.data[di + 1] = sheet.data[si + 1]
    big.data[di + 2] = sheet.data[si + 2]
    big.data[di + 3] = sheet.data[si + 3]
  }
}
drawText(big, `${classId.toUpperCase()}  T3  ${KIT.length} WEAPONS  ${MAG}X`, PAD, big.height - 12, 0xf0e8d0, 2)
writeFileSync(out, encodePng(big))
console.log(`${out}  ${big.width}x${big.height}  ${classId} at ${MAG}x`)
