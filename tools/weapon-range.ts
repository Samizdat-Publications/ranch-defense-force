/**
 * The weapon range: every weapon, fired, on one labelled contact sheet.
 *
 *   npm run range                    # solo sheet, tier 1
 *   npm run range -- --tier 4        # solo sheet, everything maxed
 *   npm run range -- --mode stack    # 1..6 weapons at once, to check the ring
 *   npm run range -- --mode element  # one weapon under each element
 *   npm run range -- --mode rounds   # the rounds themselves, side by side
 *
 * This exists because "when I get new weapons I'm not noticing them" is a claim
 * about what reaches the screen, and no unit test was ever going to settle it.
 * Each cell is a real run of the real sim with exactly one loadout, painted with
 * the real atlas, held until that weapon actually has something in flight.
 *
 * It also prints a distinctness report, because the sheet answers "do these
 * look different" by eye and the report answers "does any pair of weapons draw
 * the identical sprite" by measurement. The second one is the regression guard:
 * a sheet nobody looks at catches nothing.
 */
import { writeFileSync } from 'node:fs'
import {
  WorldPainter, projectileSprite, drawSpriteScaled, roundScale,
  frames, clipLengths, fillRect, encodePng, ZOOM,
} from './draw-world.ts'
import { blankImage, type Image } from './png.ts'
import { drawText } from './tinyfont.ts'
import { World } from '../src/sim/world.ts'
import { WEAPONS, ELEMENTS } from '../src/content/index.ts'

const STEP = 1 / 60
const VIEW_W = 260
const VIEW_H = 180
const LABEL_H = 30
const PAD = 4
const BG = 0x14181c
const INK = 0xe8e0cc
const WARN = 0xe86a4a

function flag(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}

const mode = flag('mode', 'solo')
const tier = Number(flag('tier', '1'))
const seed = Number(flag('seed', '20260813'))
const out = flag('out', `tools/range-${mode}${mode === 'solo' ? `-t${tier}` : ''}.png`)

/** Weapon ids in content order; `_`-prefixed keys are notes, not weapons. */
const WEAPON_IDS = Object.keys(WEAPONS).filter((k) => !k.startsWith('_'))

interface Cell {
  label: string
  sub: string
  painter: WorldPainter
  /** Atlas frame keys this cell's projectiles actually drew. */
  drew: Set<string>
  live: number
  /** The tick this cell was photographed at. */
  tick: number
}

/**
 * Run one loadout until it has something in the air, then paint it.
 *
 * The wait matters: a weapon with a 2.4s cooldown photographed at a fixed tick
 * count is empty in half its screenshots, which reads as "this weapon draws
 * nothing" when the truth is "this weapon was between shots". So the run steps
 * until the frame is worth taking, and reports honestly if it never is.
 */
function build(ids: { id: string; tier: number }[], element: string): World {
  const world = new World(seed, 'hand')
  const player = world.player as unknown as { element: string }
  world.player.weapons.length = 0
  for (const w of ids) {
    world.player.addWeapon(w.id, 1)
    // Tier is reached by merging, the way the game reaches it.
    for (let t = 1; t < w.tier; t++) world.player.addWeapon(w.id, 1)
  }
  player.element = element
  return world
}

/**
 * Keep the subject alive, so a slow weapon gets to reach its own best moment.
 *
 * Max HP is `player.stats.maxHp`, NOT `player.maxHp` — which does not exist.
 * Writing the wrong one sets hp to undefined, `alive()` goes false, `world.over`
 * latches, and every later `step()` returns immediately. The range then paints
 * a world frozen at tick one and reports, very confidently, that four weapons
 * draw nothing. Ask for the field by its real name.
 */
function godMode(world: World): void {
  world.player.hp = world.player.stats.maxHp
}

/**
 * How much visible weapon output is on screen this tick.
 *
 * Counts hazards and FX as well as projectiles. Counting only projectiles is
 * what made this tool report the Sledge and the Bait Drum as drawing nothing:
 * a slam is a shockwave effect and a bait drum is a ground hazard, and neither
 * has ever been a projectile. The weapon was fine; the definition of "visible"
 * was too narrow.
 */
function busyness(world: World): number {
  let n = 0
  for (let j = 0; j < world.projectiles.live; j++) {
    const p = world.projectiles.items[j]
    // Areas are the loudest thing a weapon can put on screen, so a frame with
    // one counts as a good frame.
    n += p.behaviour === 'arcSwing' || p.type === 'aura' ? 2 : 1
  }
  n += world.hazards.live * 2
  n += world.effects.live
  return n
}

/**
 * Run one loadout, find the tick where it has the most in the air, replay to
 * exactly that tick, and paint it.
 *
 * The two passes are the whole point. The first version of this took whatever
 * happened to be on screen when the loop ended, and duly reported that the
 * Grenade Launcher, Harpoon, Sledge and Bait Drum draw nothing at all — when
 * what it had actually measured was that all four have long cooldowns and the
 * photo was taken between shots. That is the same failure this project has now
 * hit four times: the instrument was wrong before the game was. A weapon is
 * only silent here if it is silent at its own best moment.
 *
 * Replaying is free and exact because the sim is seeded and fixed-step, so pass
 * two lands on the identical world state pass one measured.
 */
function shoot(ids: { id: string; tier: number }[], element: string, label: string, sub: string): Cell {
  // Long enough for the spawner to put enemies in range; the player circles
  // slowly so weapons that need a target have one.
  const WARMUP = 900
  const MAX = 2600

  const scout = build(ids, element)
  let best = -1
  let bestTick = WARMUP
  for (let i = 0; i < MAX; i++) {
    const t = i * STEP
    godMode(scout)
    scout.step(STEP, Math.cos(t * 0.4) * 0.6, Math.sin(t * 0.4) * 0.6, false)
    if (i < WARMUP) continue
    const n = busyness(scout)
    if (n > best) { best = n; bestTick = i }
  }

  const world = build(ids, element)
  for (let i = 0; i <= bestTick; i++) {
    const t = i * STEP
    godMode(world)
    world.step(STEP, Math.cos(t * 0.4) * 0.6, Math.sin(t * 0.4) * 0.6, false)
  }

  const painter = new WorldPainter(VIEW_W, VIEW_H)
  painter.paint(world)

  const drew = new Set<string>()
  for (let j = 0; j < world.projectiles.live; j++) {
    // The same rule the painter used, from the same function, so the report can
    // never claim something the picture above it does not show.
    drew.add(projectileSprite(world, world.projectiles.items[j]).key)
  }
  for (let j = 0; j < world.hazards.live; j++) drew.add(`(${world.hazards.items[j].kind} zone)`)
  for (let j = 0; j < world.effects.live; j++) drew.add(`fx.${world.effects.items[j].clip}`)
  return { label, sub, painter, drew, live: busyness(world), tick: bestTick }
}

// --------------------------------------------------------------- the sheets

const cells: Cell[] = []

if (mode === 'solo') {
  for (const id of WEAPON_IDS) {
    const def = WEAPONS[id] as unknown as { name?: string; projectileClip?: string }
    const c = shoot([{ id, tier }], 'none', def.name ?? id, def.projectileClip ?? '(icon)')
    cells.push(c)
    console.log(
      `  ${id.padEnd(16)} t${tier}  live ${String(c.live).padStart(3)}  ` +
      `@${String(c.tick).padStart(4)}  drew ${[...c.drew].join(', ') || 'NOTHING'}`,
    )
  }
} else if (mode === 'stack') {
  for (const n of [1, 2, 3, 4, 5, 6]) {
    const load = WEAPON_IDS.slice(0, n).map((id) => ({ id, tier }))
    const c = shoot(load, 'none', `${n} weapon${n > 1 ? 's' : ''}`, load.map((l) => l.id).join(' '))
    cells.push(c)
    console.log(`  ${n} weapons  live ${String(c.live).padStart(3)}  drew ${[...c.drew].join(', ')}`)
  }
} else if (mode === 'element') {
  const els = ['none', ...Object.keys(ELEMENTS).filter((k) => !k.startsWith('_'))]
  for (const el of els) {
    // Six ranged weapons at once, so the sheet shows whether an element keeps
    // them distinguishable — the exact thing that was broken before.
    const load = WEAPON_IDS.slice(0, 6).map((id) => ({ id, tier }))
    const c = shoot(load, el, el, 'six ranged')
    cells.push(c)
    console.log(`  ${el.padEnd(8)} live ${String(c.live).padStart(3)}  drew ${[...c.drew].join(', ')}`)
  }
} else if (mode === 'rounds') {
  roundsSheet()
} else {
  console.error(`unknown --mode ${mode}; expected solo, stack, element or rounds`)
  process.exit(1)
}

/**
 * The rounds themselves, at true size on grass, one row per weapon.
 *
 * Judging a bullet off a gameplay tile is guesswork: it is 30 pixels of a 520
 * pixel frame, half the time behind an enemy. This lines every signature round
 * up against the same background at the exact scale the game draws it, with its
 * element variants beneath, which is the only view that actually answers "can
 * you tell these apart".
 */
function roundsSheet(): void {
  const ELS = ['none', 'fire', 'acid', 'frost']
  const rows: { id: string; label: string; clips: string[] }[] = []
  for (const id of WEAPON_IDS) {
    const def = WEAPONS[id] as unknown as { name?: string; projectileClip?: string }
    if (!def.projectileClip) continue
    rows.push({
      id,
      label: def.name ?? id,
      clips: ELS.map((e) => (e === 'none' ? def.projectileClip! : `${def.projectileClip}.${e}`)),
    })
  }

  const CELL = 96
  const LABEL = 96
  const STEPS = 5 // frames sampled across each clip
  const w = LABEL + ELS.length * (STEPS * CELL + 12)
  const h = rows.length * CELL + 24
  const img = blankImage(w, h)
  // Grass, because that is what a bullet is always seen against.
  fillRect(img, 0, 0, w, h, 0x479757)

  ELS.forEach((e, ei) => {
    drawText(img, e, LABEL + ei * (STEPS * CELL + 12) + 4, 6, 0x14181c, 3)
  })

  rows.forEach((row, ri) => {
    const y = 24 + ri * CELL
    drawText(img, row.label, 3, y + CELL / 2 - 8, 0x14181c, 2)
    row.clips.forEach((clip, ci) => {
      const len = clipLengths[clip]?.play ?? 0
      for (let s = 0; s < STEPS; s++) {
        const f = frames[`${clip}.${Math.floor((s / STEPS) * Math.max(1, len))}`]
        if (!f) continue
        const cx = LABEL + ci * (STEPS * CELL + 12) + s * CELL + CELL / 2
        const cy = y + CELL / 2
        drawSpriteScaled(img, f, cx, cy, roundScale(row.id))
      }
    })
  })

  writeFileSync(flag('out', 'tools/range-rounds.png'), encodePng(img))
  console.log(`
tools/range-rounds.png  ${w}x${h}  ${rows.length} rounds x ${ELS.length} elements`)
  process.exit(0)
}

// --------------------------------------------------------------- composite

const tileW = VIEW_W * ZOOM
const tileH = VIEW_H * ZOOM
const cols = Math.min(4, cells.length)
const rows = Math.ceil(cells.length / cols)
const sheet = blankImage(
  cols * (tileW + PAD) + PAD,
  rows * (tileH + LABEL_H + PAD) + PAD,
)
fillRect(sheet, 0, 0, sheet.width, sheet.height, BG)

function blit(dst: Image, src: Image, dx: number, dy: number): void {
  for (let y = 0; y < src.height; y++) {
    const ty = dy + y
    if (ty < 0 || ty >= dst.height) continue
    for (let x = 0; x < src.width; x++) {
      const tx = dx + x
      if (tx < 0 || tx >= dst.width) continue
      const si = (y * src.width + x) * 4
      const di = (ty * dst.width + tx) * 4
      dst.data[di] = src.data[si]
      dst.data[di + 1] = src.data[si + 1]
      dst.data[di + 2] = src.data[si + 2]
      dst.data[di + 3] = 255
    }
  }
}

cells.forEach((c, i) => {
  const cx = PAD + (i % cols) * (tileW + PAD)
  const cy = PAD + Math.floor(i / cols) * (tileH + LABEL_H + PAD)
  blit(sheet, c.painter.canvas, cx, cy)
  const empty = c.drew.size === 0
  drawText(sheet, c.label, cx + 2, cy + tileH + 5, empty ? WARN : INK, 3)
  const sub = empty ? 'DREW NOTHING' : [...c.drew].join(' ')
  drawText(
    sheet,
    sub.length > 62 ? `${sub.slice(0, 60)}..` : sub,
    cx + 2, cy + tileH + 21, empty ? WARN : 0x8d9aa4, 2,
  )
})

writeFileSync(out, encodePng(sheet))

// ------------------------------------------------------- distinctness report

console.log(`\n${out}  ${sheet.width}x${sheet.height}`)

if (mode === 'solo') {
  const byClip = new Map<string, string[]>()
  for (const c of cells) {
    for (const d of c.drew) {
      if (!byClip.has(d)) byClip.set(d, [])
      byClip.get(d)!.push(c.label)
    }
  }
  const shared = [...byClip].filter(([k, who]) => who.length > 1 && k.startsWith('proj.'))
  const silent = cells.filter((c) => c.drew.size === 0)

  console.log('\ndistinctness:')
  for (const [clip, who] of [...byClip].sort()) {
    const f = frames[`${clip}.0`]
    const size = f ? `${f.w}x${f.h}` : '-'
    console.log(`  ${clip.padEnd(22)} ${size.padEnd(8)} ${who.join(', ')}`)
  }
  if (shared.length) {
    console.log('\nSHARED SPRITES (these weapons are indistinguishable in flight):')
    for (const [clip, who] of shared) console.log(`  ${clip}: ${who.join(', ')}`)
  }
  if (silent.length) {
    console.log('\nDREW NOTHING (fired no visible object in the window):')
    for (const c of silent) console.log(`  ${c.label}`)
  }
  if (!shared.length && !silent.length) console.log('\nno shared sprites, nothing silent.')
}
