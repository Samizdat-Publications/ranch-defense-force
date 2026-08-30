/**
 * Headless screenshot: runs the real simulation, draws it with the real atlas,
 * writes a PNG. No browser, no canvas.
 *
 *   npm run shot -- [ticks] [out.png] [seed] [class]
 *
 * This exists because verifying "does it look right" through a browser is slow
 * and awkward, and because the sim already runs headlessly — the only missing
 * piece was a blitter, and `tools/png.ts` already had one. The drawing lives in
 * `draw-world.ts`; this file is the run that produces something worth drawing.
 */
import { writeFileSync } from 'node:fs'
import { WorldPainter, encodePng } from './draw-world.ts'
import { World } from '../src/sim/world.ts'
import { OfferPool, type Offer } from '../src/sim/offers.ts'
import { TUNING } from '../src/content/index.ts'

const STEP = 1 / 60
const VIEW_W = 520
const VIEW_H = 330

const ticks = Number(process.argv[2] ?? 1500)
const out = process.argv[3] ?? 'tools/shot.png'
const seed = Number(process.argv[4] ?? 20260811)
const classId = process.argv[5] ?? 'hand'
/**
 * `--hit` arms every live enemy's recoil just before the draw.
 *
 * The clip is 0.22s inside a 25-minute run, so catching one by chance takes
 * dozens of screenshots. This is the only practical way to LOOK at the recoil
 * state, and looking is how this repo verifies rendering.
 */
const forceHit = process.argv.includes('--hit')
/**
 * `--map=<id>` puts the shot on a chosen map instead of the one the seed rolls.
 *
 * This is the only way to photograph a WEIGHT-0 map: `pickMapId` can never
 * return one, so a preview map added ahead of the level system was previously
 * unreachable without editing its weight in content and remembering to put it
 * back. It overrides the map draw's RESULT and not the draw itself, so the shot
 * is still of a real, replayable run.
 */
const mapArg = process.argv.find((a) => a.startsWith('--map='))?.slice(6)

const world = new World(seed, classId, {}, 1, mapArg)
const offers = new OfferPool(world.rng)
let pending = 0
world.events = { onLevelUp: (n) => { pending += n } }

const pickSmart = (list: Offer[]): Offer | undefined =>
  list.find((o) => o.mergesTo !== null) ?? list[0]

for (let i = 0; i < ticks; i++) {
  const t = i * STEP
  world.step(STEP, Math.cos(t * 0.55), Math.sin(t * 0.55), i % 400 === 0)
  if (pending > 0) {
    const o = pickSmart(offers.draw(world.player, 4, world.elapsed, world.player.stats.luck, 'levelup'))
    if (o) {
      if (o.kind === 'weapon') world.player.addWeapon(o.id, o.tierJump)
      else { world.player.addItem(o.id, o.boosted); world.refreshSpecialItems() }
    }
    pending--
  }
}

if (forceHit) {
  let n = 0
  for (let i = 0; i < world.enemies.live; i++) {
    const e = world.enemies.items[i]
    if (e.dying > 0) continue
    // Mid-clip rather than the first frame: frame 0 of a recoil is the idle
    // pose, so arming it fully would produce a shot that looks like nothing.
    e.hitT = (TUNING.combat.hitClipSeconds as number) * 0.45
    n++
  }
  console.log(`--hit: armed ${n} recoils`)
}

const painter = new WorldPainter(VIEW_W, VIEW_H)
painter.paint(world)
writeFileSync(out, encodePng(painter.canvas))

console.log(
  `${out}  ${painter.canvas.width}x${painter.canvas.height}\n` +
  `wave ${world.spawner.wave}  lv ${world.player.level}  enemies ${world.enemies.live}  ` +
  `crops ${world.props.live}  kills ${world.kills}  fx live ${world.effects.live}`,
)
