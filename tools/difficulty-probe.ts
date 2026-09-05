/**
 * Difficulty probe — the compact instrument the session-23 retune iterated on.
 *
 *   npm run probe -- [runs] [what] [coefficient sweep] [class subset]
 *
 * `npm run balance` prints a page per class per pilot. Retuning the curve needs
 * three numbers per change, side by side, twenty times in a row: where `idle`
 * dies, where the home pilots land, and how many bodies are on the field in the
 * first five waves. This prints exactly those and nothing else.
 *
 *   what = idle | home | density | all   (default all)
 */
import { World } from '../src/sim/world.ts'
import { OfferPool, applySwap, type Offer } from '../src/sim/offers.ts'
import { Rng } from '../src/core/rng.ts'
import { TUNING, WAVES } from '../src/content/index.ts'
import { threatBudget, waveHpScalar } from '../src/sim/formulas.ts'

const STEP = 1 / 60

const runs = Number(process.argv[2] ?? 24)
const what = process.argv[3] ?? 'all'
/**
 * Optional 4th argument: semicolon-separated coefficient sets, applied to the
 * live `WAVES` object before each block. `int`/`lin`/`quad` are threatBudget,
 * `hplin`/`hpq` are waveHpScalar, `ceil` the pressure ceiling, `gmin`/`gmax`
 * the group interval, `elite` eliteEveryNWaves, `ec` the elite chance, `em`
 * its hp multiplier, `xpp`/`xpe` the xp curve's power coefficient and exponent, `mind` the
 * minimum spawn distance. Sweeping by editing JSON between runs is how a
 * sweep gets a number wrong.
 *
 *   ... -- 12 home "int=96,lin=30;int=96,lin=30,quad=2.6"
 */
const specs = (process.argv[4] ?? '').split(';').map((x) => x.trim()).filter(Boolean)
/** Optional 5th argument: a comma-separated class subset, to shorten a sweep. */
const only = (process.argv[5] ?? '').split(',').map((x) => x.trim()).filter(Boolean)

function applySpec(spec: string): void {
  const b = WAVES.threatBudget
  const h = WAVES.waveHpScalar
  for (const part of spec.split(',')) {
    const [k, v] = part.split('=')
    const n = Number(v)
    if (k === 'int') b.intercept = n
    else if (k === 'lin') b.linear = n
    else if (k === 'quad') b.quadratic = n
    else if (k === 'hplin') h.linear = n
    else if (k === 'hpq') h.quadratic = n
    else if (k === 'ceil') (WAVES as { pressureCeiling: number }).pressureCeiling = n
    else if (k === 'gmin') WAVES.spawn.groupInterval.min = n
    else if (k === 'gmax') WAVES.spawn.groupInterval.max = n
    else if (k === 'mind') (WAVES.spawn as { minDistanceFromPlayer: number }).minDistanceFromPlayer = n
    else if (k === 'elite') (WAVES as { eliteEveryNWaves: number }).eliteEveryNWaves = n
    else if (k === 'ec') WAVES.elite.chance = n
    else if (k === 'em') WAVES.elite.hpMultiplier = n
    else if (k === 'wsl') WAVES.waveScalar.linear = n
    else if (k === 'iv') (TUNING.player as { invulnSecondsAfterHit: number }).invulnSecondsAfterHit = n
    else if (k === 'cdi') (TUNING.player as { contactDamageInterval: number }).contactDamageInterval = n
    else if (k === 'xpp') WAVES.xp.power = n
    else if (k === 'xpe') WAVES.xp.exponent = n
    else throw new Error(`unknown key "${k}"`)
  }
}

type Pilot = 'kite' | 'brawl' | 'space' | 'idle' | 'idle-buy'

const HOME_PILOT: Record<string, Pilot> = {
  hand: 'brawl',
  kid: 'kite',
  widow: 'brawl',
  vet: 'space',
  agronomist: 'brawl',
  drifter: 'kite',
}
const SPACER_RANGE = 200

const pickSmart = (offers: Offer[]): Offer | undefined => {
  const merge = offers.find((o) => o.mergesTo !== null)
  if (merge) return merge
  const defensive = offers.find(
    (o) => (o.mods.maxHp ?? 0) > 0 || (o.mods.armor ?? 0) > 0 || (o.mods.hpRegen ?? 0) > 0,
  )
  return defensive ?? offers[0]
}

interface Probe {
  cleared: boolean
  waveReached: number
  level: number
  kills: number
  /** Mean enemies alive, sampled once a second, per wave index 1..25. */
  alivePerWave: number[]
  aliveSamples: number[]
  /** The most that were ever alive at once, and how many seconds the pressure
   *  ceiling was withholding. A ceiling that binds is a difficulty CAP. */
  peakAlive: number
  ceilingSeconds: number
  aliveAt60s: number
}

function simulate(seed: number, classId: string, pilot: Pilot): Probe {
  const world = new World(seed, classId)
  const offers = new OfferPool(world.rng)
  // A SEPARATE stream, so an idle pilot's coin flips do not shift the sim's.
  const choice = new Rng(seed ^ 0x9e3779b9)
  let pending = 0
  let shopQueued = false
  const idle = pilot === 'idle' || pilot === 'idle-buy'

  const alivePerWave = new Array<number>(WAVES.waveCount + 2).fill(0)
  const aliveSamples = new Array<number>(WAVES.waveCount + 2).fill(0)
  let peakAlive = 0
  let ceilingSeconds = 0
  let aliveAt60s = 0

  world.events = {
    onLevelUp: (n) => { pending += n },
    onWaveComplete: (wave) => {
      if ((WAVES.shopAfterWaves as number[]).includes(wave)) shopQueued = true
    },
  }

  const take = (o: Offer): void => {
    if (o.kind === 'weapon') world.player.addWeapon(o.id, o.tierJump)
    else if (o.kind === 'swap') applySwap(world.player, world.rng)
    else { world.player.addItem(o.id, o.boosted); world.refreshSpecialItems() }
  }

  let ticks = 0
  const maxTicks = 60 * 60 * 25
  while (!world.over && world.spawner.wave <= WAVES.waveCount && ticks < maxTicks) {
    const t = ticks * STEP
    let mx = 0
    let my = 0
    if (!idle) {
      mx = Math.cos(t * 0.6)
      my = Math.sin(t * 0.6)
      if (world.enemies.live > 0) {
        let cx = 0
        let cy = 0
        let near = 0
        const n = Math.min(world.enemies.live, 60)
        for (let i = 0; i < n; i++) {
          const e = world.enemies.items[i]
          cx += e.x
          cy += e.y
          if (Math.hypot(e.x - world.player.x, e.y - world.player.y) < 130) near++
        }
        const healthy = world.player.hp > world.player.stats.maxHp * 0.55
        if (pilot === 'brawl' && healthy && near < 6) {
          mx = 0
          my = 0
        } else if (pilot === 'space' && healthy && near < 6) {
          const dx = world.player.x - cx / n
          const dy = world.player.y - cy / n
          const d = Math.hypot(dx, dy) || 1
          const sign = d < SPACER_RANGE ? 1 : -1
          mx = (dx / d) * sign + ((world.arenaW / 2 - world.player.x) / world.arenaW) * 1.5
          my = (dy / d) * sign + ((world.arenaH / 2 - world.player.y) / world.arenaH) * 1.5
          const m = Math.hypot(mx, my) || 1
          mx /= m
          my /= m
        } else {
          const dx = world.player.x - cx / n
          const dy = world.player.y - cy / n
          const d = Math.hypot(dx, dy) || 1
          mx = dx / d + ((world.arenaW / 2 - world.player.x) / world.arenaW) * 1.5
          my = dy / d + ((world.arenaH / 2 - world.player.y) / world.arenaH) * 1.5
          const m = Math.hypot(mx, my) || 1
          mx /= m
          my /= m
        }
      }
    }

    if (ticks % 60 === 0) {
      const w = world.spawner.wave
      if (world.enemies.live > peakAlive) peakAlive = world.enemies.live
      if (world.enemies.live >= WAVES.pressureCeiling) ceilingSeconds++
      if (w >= 1 && w < alivePerWave.length) {
        alivePerWave[w] += world.enemies.live
        aliveSamples[w]++
      }
    }

    world.step(STEP, mx, my, !idle && ticks % 400 === 0)
    ticks++
    if (ticks === 60 * 60) aliveAt60s = world.enemies.live

    if (pending > 0) {
      const board = offers.draw(world.player, 4, world.elapsed, world.player.stats.luck, 'levelup')
      const chosen = idle
        ? (board.length ? board[choice.int(0, board.length - 1)] : undefined)
        : pickSmart(board)
      if (chosen) take(chosen)
      pending--
    }
    if (shopQueued) {
      shopQueued = false
      offers.beginShopVisit()
      for (let i = world.enemies.live - 1; i >= 0; i--) world.enemies.free(i)
      if (pilot === 'idle') {
        // Walks past it. The owner's own run banked 4,614 feed.
        offers.draw(world.player, 3, world.elapsed, world.player.stats.luck)
      } else {
        for (let s = 0; s < 4; s++) {
          const board = offers.draw(world.player, 3, world.elapsed, world.player.stats.luck)
          const o = pilot === 'idle-buy'
            ? board.find((c) => world.player.feed >= c.cost)
            : pickSmart(board)
          if (o && world.player.feed >= o.cost) { world.player.feed -= o.cost; take(o) }
        }
      }
    }
  }

  return {
    cleared: !world.over,
    waveReached: world.spawner.wave,
    level: world.player.level,
    kills: world.kills,
    alivePerWave,
    aliveSamples,
    peakAlive,
    ceilingSeconds,
    aliveAt60s,
  }
}

const median = (xs: number[]): number => {
  if (xs.length === 0) return 0
  const s = [...xs].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}
const SEEDS = Array.from({ length: runs }, (_, i) => 1009 * (i + 1))
const hist = (rs: Probe[]): string => {
  const by = new Map<number, number>()
  for (const r of rs.filter((x) => !x.cleared)) by.set(r.waveReached, (by.get(r.waveReached) ?? 0) + 1)
  return [...by.entries()].sort((a, b) => a[0] - b[0]).map(([w, n]) => `w${w}x${n}`).join(' ')
}

function report(): void {
  if (what === 'idle' || what === 'all') {
    console.log(`
--- idle / idle-buy (${runs} seeds each) ---`)
    console.log('class       pilot      cleared  median  min  max   deaths')
    for (const cls of Object.keys(HOME_PILOT).filter((c) => !only.length || only.includes(c))) {
      for (const p of ['idle', 'idle-buy'] as Pilot[]) {
        const rs = SEEDS.map((s) => simulate(s, cls, p))
        const w = rs.map((r) => r.waveReached)
        console.log(
          `${cls.padEnd(11)} ${p.padEnd(9)} ${String(rs.filter((r) => r.cleared).length).padStart(3)}/${runs}` +
          `  ${String(median(w)).padStart(5)}  ${String(Math.min(...w)).padStart(3)}  ${String(Math.max(...w)).padStart(3)}   ${hist(rs)}`,
        )
      }
    }
  }

  if (what === 'home' || what === 'all') {
    console.log(`
--- home pilots (${runs} seeds) ---`)
    console.log('class       pilot   cleared  lvl  deaths')
    const counts: number[] = []
    for (const [cls, p] of Object.entries(HOME_PILOT).filter(([c]) => !only.length || only.includes(c))) {
      const rs = SEEDS.map((s) => simulate(s, cls, p))
      const n = rs.filter((r) => r.cleared).length
      counts.push(n)
      console.log(
        `${cls.padEnd(11)} ${p.padEnd(6)} ${String(n).padStart(4)}/${runs}  ` +
        `${String(median(rs.map((r) => r.level))).padStart(3)}  ${hist(rs)}`,
      )
    }
    const mean = counts.reduce((a, b) => a + b, 0) / counts.length
    console.log(`mean ${mean.toFixed(1)}  worst deviation ${Math.max(...counts.map((c) => Math.abs(c - mean))).toFixed(1)}  range ${Math.max(...counts) - Math.min(...counts)}`)
  }

  if (what === 'density' || what === 'all') {
    console.log(`
--- enemies alive, mean over the wave, hand/brawl ${Math.min(runs, 12)} seeds ---`)
    const rs = SEEDS.slice(0, 12).map((s) => simulate(s, 'hand', 'brawl'))
    const mid = (w: number): number => {
      let tot = 0
      let n = 0
      for (const r of rs) { tot += r.alivePerWave[w]; n += r.aliveSamples[w] }
      return n ? tot / n : 0
    }
    const line: string[] = []
    for (let w = 1; w <= 8; w++) line.push(`w${w} ${mid(w).toFixed(1)}`)
    console.log('  ' + line.join('   '))
    const late: string[] = []
    for (const w of [12, 16, 20, 24]) late.push(`w${w} ${mid(w).toFixed(1)}`)
    console.log('  ' + late.join('   '))
    console.log(`  waves 1-5 mean alive: ${([1, 2, 3, 4, 5].reduce((a, w) => a + mid(w), 0) / 5).toFixed(1)}`)
    const at60 = rs.map((r) => r.aliveAt60s).sort((a, b) => a - b)
    console.log(`  alive at t=60s: median ${at60[at60.length >> 1]}  min ${at60[0]}  max ${at60[at60.length - 1]}`)
    console.log(`  peak alive mean ${(rs.reduce((a, r) => a + r.peakAlive, 0) / rs.length).toFixed(0)}` +
      `  seconds at the ${WAVES.pressureCeiling} ceiling: mean ${(rs.reduce((a, r) => a + r.ceilingSeconds, 0) / rs.length).toFixed(0)}`)
  }
}

if (specs.length === 0) {
  report()
} else {
  for (const spec of specs) {
    applySpec(spec)
    console.log(`
########## ${spec}`)
    console.log(`  budget w1 ${threatBudget(1).toFixed(0)} w5 ${threatBudget(5).toFixed(0)} w12 ${threatBudget(12).toFixed(0)} w25 ${threatBudget(25).toFixed(0)}` +
      `   hpScalar w5 ${waveHpScalar(5).toFixed(2)} w12 ${waveHpScalar(12).toFixed(2)} w25 ${waveHpScalar(25).toFixed(2)}`)
    report()
  }
}
