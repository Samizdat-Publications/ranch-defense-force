/**
 * Balance harness: run the whole game many times headlessly and report what
 * happened.
 *
 *   npm run balance -- [runs] [class|both]
 *
 * `tests/run.test.ts` asks yes/no questions — does a run complete, is either
 * class a trap. This asks *how* and *why*: which wave runs die on, what killed
 * them, which weapons the offer pool actually hands out, which ones get merged
 * to T4 and what they contribute. Those are the questions a balance change
 * needs answered before and after, and a pass/fail test cannot answer them.
 *
 * The pilot is deliberately the same crude bot the acceptance test uses —
 * kiting, merging, favouring defence. It is nowhere near a competent human, so
 * read these numbers as *relative*: the comparison between two runs of this
 * tool across a change is meaningful, the absolute clear rate is not a
 * prediction of how a person will do.
 */
import { World } from '../src/sim/world.ts'
import { OfferPool, type Offer } from '../src/sim/offers.ts'
import { CLASSES, WAVES, WEAPONS } from '../src/content/index.ts'

const STEP = 1 / 60

const runs = Number(process.argv[2] ?? 24)
/**
 * `both` is the original pair, `all` is every class in classes.json, and
 * anything else is a comma-separated list of class ids.
 *
 * The four unlockables are content exactly like the other two, and the only
 * reason this tool ever knew two names was the default. `_`-prefixed keys are
 * documentation, as everywhere else in this project's JSON, so `all` skips
 * them.
 */
const classArg = process.argv[3] ?? 'both'
const ALL = Object.keys(CLASSES).filter((k) => !k.startsWith('_'))
const classes = classArg === 'both'
  ? ['hand', 'kid']
  : classArg === 'all'
    ? ALL
    : classArg.split(',').map((c) => c.trim()).filter(Boolean)
for (const c of classes) {
  if (!ALL.includes(c)) throw new Error(`unknown class "${c}" — known: ${ALL.join(', ')}`)
}
/** Optional 4th arg: one pilot name, to halve the runtime when you know which. */
const pilotArg = process.argv[4] ?? ''

/**
 * Two pilots, because one pilot measures one class.
 *
 * `kite` runs from the crowd's centre of mass at all times. That is The Kid's
 * entire kit — fast, damage scaling with velocity — and the precise opposite of
 * The Hand's, which pays damage reduction for standing still and has an ability
 * that roots it. A kiting-only harness therefore reports The Hand as the weaker
 * class no matter what the game does, and tuning the game to close that gap
 * would be tuning it to a blind spot in the instrument.
 *
 * `brawler` holds ground while it is healthy and the crowd is not on top of it,
 * and breaks off when either stops being true.
 *
 * `spacer` is the third, added for The Veteran, whose Overwatch pays for range
 * and charges for contact. It does not flee and it does not plant: it holds a
 * stated distance from the crowd's centre of mass, closing when it drifts too
 * far and backing off when the crowd closes. A kiting bot runs to the far wall
 * and a brawling bot lets the crowd inside the penalty ring, so neither of the
 * two existing pilots can measure a spacing class at all.
 */
type Pilot = 'kite' | 'brawler' | 'spacer'
const PILOTS: Pilot[] = pilotArg
  ? [pilotArg as Pilot]
  : ['kite', 'brawler', 'spacer']
/** The distance `spacer` tries to keep, in pixels. */
const SPACER_RANGE = 200

/** Merge what we own, then take defence, then anything. Mirrors the run test. */
function pickSmart(offers: Offer[]): Offer | undefined {
  const merge = offers.find((o) => o.mergesTo !== null)
  if (merge) return merge
  const defensive = offers.find(
    (o) => (o.mods.maxHp ?? 0) > 0 || (o.mods.armor ?? 0) > 0 || (o.mods.hpRegen ?? 0) > 0,
  )
  return defensive ?? offers[0]
}

interface Result {
  cleared: boolean
  waveReached: number
  seconds: number
  level: number
  kills: number
  contact: number
  hazard: number
  crops: number
  feedSpent: number
  weapons: { id: string; tier: number }[]
  /** Field state at the moment of death, to tell a difficulty spike apart from
   *  an elite that happened to land on you. */
  enemiesAtDeath: number
  elitesAtDeath: number
  hazardsAtDeath: number
}

function simulate(seed: number, classId: string, pilot: Pilot): Result {
  const world = new World(seed, classId)
  const offers = new OfferPool(world.rng)
  let pending = 0
  let shopQueued = false
  let feedSpent = 0

  let enemiesAtDeath = 0
  let elitesAtDeath = 0
  let hazardsAtDeath = 0

  world.events = {
    onLevelUp: (n) => { pending += n },
    onPlayerDeath: () => {
      enemiesAtDeath = world.enemies.live
      hazardsAtDeath = world.hazards.live
      for (let i = 0; i < world.enemies.live; i++) {
        if (world.enemies.items[i].elite) elitesAtDeath++
      }
    },
    onWaveComplete: (wave) => {
      if ((WAVES.shopAfterWaves as number[]).includes(wave)) shopQueued = true
    },
  }

  const take = (o: Offer): void => {
    if (o.kind === 'weapon') world.player.addWeapon(o.id, o.tierJump)
    else { world.player.addItem(o.id, o.boosted); world.refreshSpecialItems() }
  }

  let ticks = 0
  const maxTicks = 60 * 60 * 25
  while (!world.over && world.spawner.wave <= WAVES.waveCount && ticks < maxTicks) {
    const t = ticks * STEP
    let mx = Math.cos(t * 0.6)
    let my = Math.sin(t * 0.6)
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
      // The brawler plants its feet while it can afford to, which is the only
      // way The Hand's standing-still damage reduction and Dig In ever apply.
      if (pilot === 'brawler' && healthy && near < 6) {
        mx = 0
        my = 0
      } else if (pilot === 'spacer' && healthy && near < 6) {
        // Hold a band, not a point. Inside it, back off; outside it, close.
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
        // Run from the crowd's centre of mass, biased back toward the middle so
        // the bot does not pin itself on a wall.
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

    world.step(STEP, mx, my, ticks % 400 === 0)
    ticks++

    if (pending > 0) {
      const chosen = pickSmart(
        offers.draw(world.player, 4, world.elapsed, world.player.stats.luck, 'levelup'),
      )
      if (chosen) take(chosen)
      pending--
    }
    if (shopQueued) {
      shopQueued = false
      // Mirrors ShopScreen.open: a visit boundary is what makes §7.4’s
      // no-repeat rule mean anything. Without it the harness measures a shop
      // that never closes, which is not the shop the player sees.
      offers.beginShopVisit()
      for (let i = world.enemies.live - 1; i >= 0; i--) world.enemies.free(i)
      for (let s = 0; s < 4; s++) {
        const o = pickSmart(offers.draw(world.player, 3, world.elapsed, world.player.stats.luck))
        if (o && world.player.feed >= o.cost) {
          world.player.feed -= o.cost
          feedSpent += o.cost
          take(o)
        }
      }
    }
  }

  return {
    cleared: !world.over,
    waveReached: world.spawner.wave,
    seconds: world.elapsed,
    level: world.player.level,
    kills: world.kills,
    contact: world.damageTakenFromContact,
    hazard: world.damageTakenFromHazards,
    crops: world.cropsHarvested,
    feedSpent,
    weapons: world.player.weapons.map((w) => ({ id: w.id, tier: w.tier })),
    enemiesAtDeath,
    elitesAtDeath,
    hazardsAtDeath,
  }
}

const median = (xs: number[]): number => {
  if (xs.length === 0) return 0
  const s = [...xs].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}
const mean = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)
const pct = (n: number, d: number): string => (d ? `${((n / d) * 100).toFixed(0)}%` : '-')

/*
   Fixed seed ladder, so two runs of this tool compare like for like.

   Two ladders, selectable with a 5th argument. The default is this tool's own,
   which every measurement in NOTES was taken on. `test` is the ladder
   `tests/run.test.ts` uses for its parity tests, and it exists because tuning
   a class until the HARNESS is happy and then discovering the TEST disagrees
   is a slow way to find out that two different seed sets are two different
   samples. When a parity test fails, measure the seeds it actually failed on.
*/
const ladder = process.argv[5] ?? 'balance'
const seeds = ladder === 'test'
  ? Array.from({ length: runs }, (_, i) => 1009 * (i + 1))
  : Array.from({ length: runs }, (_, i) => 1000 + i * 7919)

for (const classId of classes) {
 for (const pilot of PILOTS) {
  const results = seeds.map((s) => simulate(s, classId, pilot))
  const cleared = results.filter((r) => r.cleared)
  const died = results.filter((r) => !r.cleared)

  console.log(`\n=== ${classId} / ${pilot} — ${runs} runs ===`)
  console.log(`cleared        ${cleared.length}/${runs}  (${pct(cleared.length, runs)})`)
  console.log(`wave reached   median ${median(results.map((r) => r.waveReached))}  ` +
    `min ${Math.min(...results.map((r) => r.waveReached))}  ` +
    `max ${Math.max(...results.map((r) => r.waveReached))}`)
  console.log(`level          median ${median(results.map((r) => r.level))}`)
  console.log(`kills          median ${median(results.map((r) => r.kills)).toFixed(0)}`)
  console.log(`crops taken    median ${median(results.map((r) => r.crops))}  ` +
    `feed spent mean ${mean(results.map((r) => r.feedSpent)).toFixed(0)}`)

  const contact = mean(results.map((r) => r.contact))
  const hazard = mean(results.map((r) => r.hazard))
  console.log(`damage taken   contact ${contact.toFixed(0)} (${pct(contact, contact + hazard)})  ` +
    `hazard ${hazard.toFixed(0)} (${pct(hazard, contact + hazard)})`)

  if (died.length > 0) {
    const byWave = new Map<number, number>()
    for (const r of died) byWave.set(r.waveReached, (byWave.get(r.waveReached) ?? 0) + 1)
    const spread = [...byWave.entries()].sort((a, b) => a[0] - b[0])
      .map(([w, n]) => `w${w}x${n}`).join(' ')
    console.log(`died on        ${spread}`)
    console.log(`at death       ${mean(died.map((r) => r.enemiesAtDeath)).toFixed(0)} enemies, ` +
      `${mean(died.map((r) => r.elitesAtDeath)).toFixed(1)} elite, ` +
      `${mean(died.map((r) => r.hazardsAtDeath)).toFixed(1)} hazards  ` +
      `(${died.filter((r) => r.elitesAtDeath > 0).length}/${died.length} deaths had an elite on the field)`)
  }

  // Which weapons the run pool actually hands out, and how far they get merged.
  const seen = new Map<string, { runs: number; tiers: number[] }>()
  for (const r of results) {
    for (const w of r.weapons) {
      const e = seen.get(w.id) ?? { runs: 0, tiers: [] }
      e.runs++
      e.tiers.push(w.tier)
      seen.set(w.id, e)
    }
  }
  console.log('weapon          held    median tier')
  for (const id of Object.keys(WEAPONS)) {
    const e = seen.get(id)
    if (!e) {
      console.log(`  ${id.padEnd(15)} —`)
      continue
    }
    console.log(`  ${id.padEnd(15)}${pct(e.runs, runs).padStart(4)}    ${median(e.tiers)}`)
  }
 }
}
