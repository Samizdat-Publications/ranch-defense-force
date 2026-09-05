/**
 * The same moment of the same run, rendered at several target world heights.
 *
 *   npm run zoom -- [canvasHeight] [heights,comma,separated]
 *
 * Zoom is the one setting that cannot be judged from a number. Too tight and
 * you cannot see what is coming; too wide and every round is a speck, which is
 * the state the game shipped in. This renders the candidates side by side at
 * the pixel density of a real screen, so the tradeoff is looked at rather than
 * argued about.
 *
 * Each tile simulates a screen `canvasHeight` pixels tall: zoom is picked the
 * way the game picks it, and the tile is exactly the view that produces.
 */
import { writeFileSync } from 'node:fs'
import { WorldPainter, fillRect, encodePng } from './draw-world.ts'
import { blankImage, type Image } from './png.ts'
import { drawText } from './tinyfont.ts'
import { World } from '../src/sim/world.ts'
import { OfferPool, applySwap, type Offer } from '../src/sim/offers.ts'

const STEP = 1 / 60
const canvasH = Number(process.argv[2] ?? 1145)
const targets = (process.argv[3] ?? '340,420,500,580,660').split(',').map(Number)
const ASPECT = 16 / 9

/** Build one run and hold it, so every tile shows the identical moment. */
function run(ticks: number): World {
  const world = new World(4098483203, 'hand')
  const offers = new OfferPool(world.rng)
  let pending = 0
  world.events = { onLevelUp: (n) => { pending += n } }
  const pick = (l: Offer[]): Offer | undefined => l.find((o) => o.mergesTo !== null) ?? l[0]
  for (let i = 0; i < ticks; i++) {
    const t = i * STEP
    world.player.hp = world.player.stats.maxHp
    world.step(STEP, Math.cos(t * 0.45), Math.sin(t * 0.45), false)
    if (pending > 0) {
      const o = pick(offers.draw(world.player, 4, world.elapsed, world.player.stats.luck, 'levelup'))
      if (o) {
        if (o.kind === 'weapon') world.player.addWeapon(o.id, o.tierJump)
        else if (o.kind === 'swap') {
          const added = applySwap(world.player, world.rng)
          if (added) offers.guaranteeMergeNext(added)
        }
        else { world.player.addItem(o.id, o.boosted); world.refreshSpecialItems() }
      }
      pending--
    }
  }
  return world
}

const world = run(3557)

const tiles: { label: string; img: Image }[] = []
for (const target of targets) {
  const zoom = Math.max(2, Math.min(16, Math.round(canvasH / target)))
  const viewH = Math.round(canvasH / zoom)
  const viewW = Math.round(viewH * ASPECT)
  const p = new WorldPainter(viewW, viewH, zoom)
  p.paint(world)
  tiles.push({ label: `target ${target}  zoom ${zoom}  view ${viewW}x${viewH}`, img: p.canvas })
  console.log(`  target ${String(target).padStart(4)} -> zoom ${zoom}, world view ${viewW}x${viewH}`)
}

const PAD = 6
const LABEL = 22
const w = Math.max(...tiles.map((t) => t.img.width)) + PAD * 2
const h = tiles.reduce((a, t) => a + t.img.height + LABEL + PAD, PAD)
const sheet = blankImage(w, h)
fillRect(sheet, 0, 0, w, h, 0x14181c)
let y = PAD
for (const t of tiles) {
  drawText(sheet, t.label, PAD, y, 0xe8e0cc, 3)
  for (let yy = 0; yy < t.img.height; yy++) {
    for (let xx = 0; xx < t.img.width; xx++) {
      const si = (yy * t.img.width + xx) * 4
      const ty = y + LABEL + yy
      if (ty >= sheet.height) continue
      const di = (ty * sheet.width + PAD + xx) * 4
      sheet.data[di] = t.img.data[si]
      sheet.data[di + 1] = t.img.data[si + 1]
      sheet.data[di + 2] = t.img.data[si + 2]
      sheet.data[di + 3] = 255
    }
  }
  y += t.img.height + LABEL + PAD
}
writeFileSync('tools/zoom-check.png', encodePng(sheet))
console.log(`\ntools/zoom-check.png  ${w}x${h}  (simulating a ${canvasH}px-tall canvas)`)
