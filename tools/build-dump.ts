/**
 * One run, one class, one pilot, narrated wave by wave.
 *
 *     node node_modules/vite-node/vite-node.mjs tools/build-dump.ts [class] [seed] [pilot]
 *
 * `npm run probe` says WHERE a pilot dies; this says WHAT it was holding on
 * the way. Session 24: the owner stood still as The Widow and was untouchable
 * from wave 5, and the question was which cards did it. Prints, at every wave
 * boundary, the level, hp, weapons and tiers, items taken, damage dealt in the
 * wave, kills, and contact damage taken so far.
 *
 * `pilot` is one of the probe's idle family: idle | idle-buy | idle-smart |
 * idle-greedy (default). The choice rules are restated here rather than
 * imported because the probe keeps them private; keep the two in step.
 */
import { World } from '../src/sim/world.ts'
import { OfferPool, applySwap, type Offer } from '../src/sim/offers.ts'
import { Rng } from '../src/core/rng.ts'
import { WAVES } from '../src/content/index.ts'

const STEP = 1 / 60
const args = process.argv.slice(2).filter((a) => a !== '--')
const classId = args[0] ?? 'widow'
const seed = Number(args[1] ?? 1009)
const pilot = args[2] ?? 'idle-greedy'

const pickSmart = (offers: Offer[]): Offer | undefined => {
  const merge = offers.find((o) => o.mergesTo !== null)
  if (merge) return merge
  const defensive = offers.find(
    (o) => (o.mods.maxHp ?? 0) > 0 || (o.mods.armor ?? 0) > 0 || (o.mods.hpRegen ?? 0) > 0,
  )
  return defensive ?? offers[0]
}
const pickGreedy = (offers: Offer[]): Offer | undefined => {
  const merge = offers.find((o) => o.mergesTo !== null)
  if (merge) return merge
  const weapon = offers.find((o) => o.kind === 'weapon')
  if (weapon) return weapon
  const offence = offers.find((o) =>
    (o.mods.damagePct ?? 0) > 0 || (o.mods.attackSpeedPct ?? 0) > 0 || (o.mods.rangedPct ?? 0) > 0
    || (o.mods.critChancePct ?? 0) > 0 || (o.mods.projectileCount ?? 0) > 0 || (o.mods.meleePct ?? 0) > 0)
  if (offence) return offence
  const rider = offers.find((o) => o.category === 'onHit' || o.category === 'onKill' || o.category === 'rider')
  return rider ?? offers[0]
}

const world = new World(seed, classId)
const offers = new OfferPool(world.rng)
const choice = new Rng(seed ^ 0x9e3779b9)
const pick = pilot === 'idle-smart' ? pickSmart : pilot === 'idle-greedy' ? pickGreedy : null
let pending = 0
let shopQueued = false
const taken: string[] = []
let lastDealt = 0
let lastKills = 0

const take = (o: Offer, where: string): void => {
  taken.push(`${where}:${o.name}${o.mergesTo ? `→T${o.mergesTo}` : ''}`)
  if (o.kind === 'weapon') world.player.addWeapon(o.id, o.tierJump)
  else if (o.kind === 'swap') applySwap(world.player, world.rng)
  else { world.player.addItem(o.id, o.boosted); world.refreshSpecialItems() }
}

const line = (wave: number): void => {
  const p = world.player
  const s = p.stats
  const weapons = p.weapons.map((w) => `${w.id}:T${w.tier}`).join(' ')
  console.log(
    `w${String(wave).padStart(2)}  lvl ${String(p.level).padStart(2)}  hp ${Math.round(p.hp)}/${Math.round(s.maxHp)}` +
    `  dmg% ${s.damagePct} rng% ${s.rangedPct} as% ${s.attackSpeedPct} crit% ${s.critChancePct}` +
    `  dealt ${Math.round(world.damageDealt - lastDealt)}  kills ${world.kills - lastKills}` +
    `  taken ${Math.round(world.damageTakenFromContact)}  feed ${p.feed}`,
  )
  console.log(`      ${weapons}`)
  if (taken.length) console.log(`      ${taken.join(', ')}`)
  taken.length = 0
  lastDealt = world.damageDealt
  lastKills = world.kills
}

world.events = {
  onLevelUp: (n) => { pending += n },
  onWaveComplete: (wave) => {
    line(wave)
    if ((WAVES.shopAfterWaves as number[]).includes(wave)) shopQueued = true
  },
}

let ticks = 0
const maxTicks = 60 * 60 * 25
while (!world.over && world.spawner.wave <= WAVES.waveCount && ticks < maxTicks) {
  world.step(STEP, 0, 0, false)
  ticks++
  if (pending > 0) {
    const board = offers.draw(world.player, 4, world.elapsed, world.player.stats.luck, 'levelup')
    const chosen = pick
      ? pick(board)
      : (board.length ? board[choice.int(0, board.length - 1)] : undefined)
    if (chosen) take(chosen, 'lvl')
    pending--
  }
  if (shopQueued) {
    shopQueued = false
    offers.beginShopVisit()
    for (let i = world.enemies.live - 1; i >= 0; i--) world.enemies.free(i)
    if (pilot === 'idle') {
      offers.draw(world.player, 3, world.elapsed, world.player.stats.luck)
    } else {
      for (let s = 0; s < 4; s++) {
        const board = offers.draw(world.player, 3, world.elapsed, world.player.stats.luck)
        const affordable = board.filter((c) => world.player.feed >= c.cost)
        const o = pilot === 'idle-buy' ? affordable[0] : pick ? pick(affordable) : pickSmart(board)
        if (o && world.player.feed >= o.cost) { world.player.feed -= o.cost; take(o, 'shop') }
      }
    }
  }
}
console.log(world.over ? `DIED wave ${world.spawner.wave} at ${(ticks / 60).toFixed(0)}s` : `CLEARED at ${(ticks / 60).toFixed(0)}s`)
