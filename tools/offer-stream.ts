/**
 * Offer-stream harness: what the upgrade screens ACTUALLY show over a run.
 *
 *   npm run offers -- [runs] [class|both|all] [pilot]
 *
 * `tools/balance.ts` asks whether a run is survivable. This asks whether it is
 * INTERESTING: how many distinct cards a player is shown by level 5, 10, 15,
 * 20 and the end; how often a draw is four of the same kind of thing; how often
 * the shop repeats itself between visits; how much of the stream is a plain
 * percentage; and the level at which the pool of things you could still take
 * stops being big enough to make a draw feel like a choice.
 *
 * The owner's complaint was "I hit the upgrade screen like 20 times in a few
 * waves, but the options are mostly the same like 7 things". These are the
 * numbers that complaint predicts, measured, so the roster rebuild has a
 * before to be judged against.
 *
 * The pilot is the same crude bot `balance.ts` flies, for the same reason:
 * relative numbers across a change are the product, not absolute ones. It
 * takes cards the way the acceptance test does (merge, then defence, then
 * whatever is first), so the BUILD it walks into is representative of a
 * player who never rerolls and never plans.
 *
 * Nothing here touches src/. It replays the same filter `OfferPool.draw` uses
 * to count candidates, because the pool does not expose that count and the
 * "how thin is the pool" question is the one the roster has to answer.
 */
import { World } from '../src/sim/world.ts'
import { OfferPool, applySwap, type Offer } from '../src/sim/offers.ts'
import { CLASSES, ITEMS, WAVES, WEAPONS } from '../src/content/index.ts'
import type { Player } from '../src/sim/player.ts'

const STEP = 1 / 60

const runs = Number(process.argv[2] ?? 24)
const classArg = process.argv[3] ?? 'both'
const ALL = Object.keys(CLASSES).filter((k) => !k.startsWith('_'))
const classes = classArg === 'both'
  ? ['hand', 'kid']
  : classArg === 'all'
    ? ALL
    : classArg.split(',').map((c) => c.trim()).filter(Boolean)
for (const c of classes) {
  if (!ALL.includes(c)) throw new Error(`unknown class "${c}" - known: ${ALL.join(', ')}`)
}
type Pilot = 'kite' | 'brawler' | 'spacer'
const pilot = (process.argv[4] ?? 'kite') as Pilot
const SPACER_RANGE = 200

/** Marker levels the report snapshots distinct-id counts at. */
const MARKS = [5, 10, 15, 20] as const

// --------------------------------------------------------------- categories

type Category = 'stat' | 'merge' | 'newWeapon' | 'special'

/**
 * What KIND of decision a card is, which is the axis the complaint is really
 * about. A percentage is a percentage whatever its name; a merge is the same
 * card sixteen times; a special is the only thing that changes how a run plays.
 */
function categorise(o: Offer): Category {
  if (o.kind === 'weapon') return o.mergesTo === null ? 'newWeapon' : 'merge'
  // §7.5: the `swap` offer trades a weapon for a weapon, so it buckets with
  // `newWeapon` rather than falling through to the item sniff below, which
  // would misread it as a `stat` card (`ITEMS['swap']` does not exist).
  if (o.kind === 'swap') return 'newWeapon'
  /*
     §7.1 made the category a DECLARED field, so the instrument reads it rather
     than sniffing for `special` / `element` / `toolUpgrade`.

     The sniff is kept underneath as the fallback, and it is not decoration: it
     is what makes the before and after columns comparable. Every card that
     existed before batch 1 buckets identically either way — the elements and
     the tool upgrades were `special` by the sniff and are `load` / `ledger` by
     declaration, and both of those fold into `special` here — so a change in
     these numbers is a change in the DRAW and never in the ruler.
  */
  const def = ITEMS[o.id] as Record<string, unknown> | undefined
  const declared = def?.category
  if (typeof declared === 'string') {
    return declared === 'stat' ? 'stat' : 'special'
  }
  if (def && (def.special !== undefined || def.element !== undefined
    || def.toolUpgrade !== undefined)) return 'special'
  return 'stat'
}

/**
 * The candidate set `OfferPool.draw` would build right now, replayed.
 *
 * Deliberately duplicated rather than exported from offers.ts: this tool must
 * not be able to change the thing it measures, and a `src/` edit made to serve
 * a measurement is how instruments start agreeing with themselves.
 */
function candidateIds(player: Player, mode: 'levelup' | 'shop'): string[] {
  const out: string[] = []
  let anyUnownedWhileFull = false
  for (const id of Object.keys(WEAPONS)) {
    if (id.startsWith('_')) continue
    const owned = player.hasWeapon(id)
    if (owned && player.weaponAtMaxTier(id)) continue
    if (!owned && player.slotsFull) { anyUnownedWhileFull = true; continue }
    out.push(id)
  }
  // §7.5: the shop's `swap` offer, mirroring `OfferPool.draw` — one
  // candidate, shop-only, once the loadout is full and something is left
  // unowned.
  if (mode === 'shop' && anyUnownedWhileFull) out.push('swap')
  for (const id of Object.keys(ITEMS)) {
    if (id.startsWith('_')) continue
    const def = ITEMS[id] as Record<string, unknown>
    const source = (def.source as string) ?? 'both'
    if (source !== 'both' && source !== mode) continue
    if (!player.canTakeItem(id)) continue
    // The gates from the roster’s §3. A card the run cannot be offered yet
    // is not a candidate, and counting it would report a pool deeper than the
    // one the draw is actually dealing from.
    if (def.requiresLoad === true && player.element === 'none') continue
    if (typeof def.requiresWeapon === 'string' && !player.hasWeapon(def.requiresWeapon)) continue
    if (typeof def.requiresClass === 'string' && player.classId !== def.requiresClass) continue
    out.push(id)
  }
  return out
}

/** How many more copies of `id` the player could take. 0 means maxed out. */
function headroom(player: Player, id: string): number {
  if (WEAPONS[id] !== undefined) {
    if (!player.hasWeapon(id)) return player.slotsFull ? 0 : 4
    return player.weaponAtMaxTier(id) ? 0 : 1
  }
  return player.canTakeItem(id) ? 1 : 0
}

// ------------------------------------------------------------------- record

interface DrawRecord {
  mode: 'levelup' | 'shop'
  level: number
  wave: number
  ids: string[]
  cats: Category[]
  rarities: string[]
  /** Which slots on this board carried the doubled magnitude. */
  boosted: boolean[]
  /** Ids in this draw the player already owns at least one copy of. */
  repeats: number
  /** Ids in this draw already maxed out (should be 0 - the pool filters them). */
  maxed: number
  candidates: number
}

interface RunRecord {
  seed: number
  cleared: boolean
  waveReached: number
  level: number
  levelUps: number
  shopVisits: number
  draws: DrawRecord[]
  /** Distinct ids seen by the time the player hit each mark level. */
  distinctAt: Record<number, number>
  distinctEnd: number
  cardsShown: number
  /** First level at which the takeable candidate pool fell below 12. */
  thinAtLevel: number | null
  /** Per shop visit, every id that appeared on the board during it. */
  shopSets: string[][]
}

/** Merge what we own, then take defence, then anything. Mirrors balance.ts. */
function pickSmart(offers: Offer[]): Offer | undefined {
  const merge = offers.find((o) => o.mergesTo !== null)
  if (merge) return merge
  const defensive = offers.find(
    (o) => (o.mods.maxHp ?? 0) > 0 || (o.mods.armor ?? 0) > 0 || (o.mods.hpRegen ?? 0) > 0,
  )
  return defensive ?? offers[0]
}

function simulate(seed: number, classId: string): RunRecord {
  const world = new World(seed, classId)
  const offers = new OfferPool(world.rng)
  let pending = 0
  let shopQueued = false

  const rec: RunRecord = {
    seed, cleared: false, waveReached: 1, level: 1, levelUps: 0, shopVisits: 0,
    draws: [], distinctAt: {}, distinctEnd: 0, cardsShown: 0,
    thinAtLevel: null, shopSets: [],
  }
  const seen = new Set<string>()
  let markCursor = 0

  world.events = {
    onLevelUp: (n) => { pending += n },
    onPlayerDeath: () => {},
    onWaveComplete: (wave) => {
      if ((WAVES.shopAfterWaves as number[]).includes(wave)) shopQueued = true
    },
  }

  const take = (o: Offer): void => {
    if (o.kind === 'weapon') world.player.addWeapon(o.id, o.tierJump)
    else if (o.kind === 'swap') {
      const added = applySwap(world.player, world.rng)
      if (added) offers.guaranteeMergeNext(added)
    }
    else { world.player.addItem(o.id, o.boosted); world.refreshSpecialItems() }
  }

  const record = (mode: 'levelup' | 'shop', drawn: Offer[], candidates: number): void => {
    const pl = world.player
    const d: DrawRecord = {
      mode,
      level: pl.level,
      wave: world.spawner.wave,
      ids: drawn.map((o) => o.id),
      cats: drawn.map(categorise),
      rarities: drawn.map((o) => o.rarity),
      boosted: drawn.map((o) => o.boosted),
      repeats: drawn.filter((o) =>
        (WEAPONS[o.id] !== undefined ? pl.hasWeapon(o.id) : pl.itemCount(o.id) > 0)).length,
      maxed: drawn.filter((o) => headroom(pl, o.id) === 0).length,
      candidates,
    }
    rec.draws.push(d)
    rec.cardsShown += drawn.length
    for (const id of d.ids) seen.add(id)
    if (rec.thinAtLevel === null && candidates < 12) rec.thinAtLevel = pl.level
    while (markCursor < MARKS.length && pl.level >= MARKS[markCursor]) {
      rec.distinctAt[MARKS[markCursor]] = seen.size
      markCursor++
    }
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
      if (pilot === 'brawler' && healthy && near < 6) {
        mx = 0
        my = 0
      } else if (pilot === 'spacer' && healthy && near < 6) {
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

    world.step(STEP, mx, my, ticks % 400 === 0)
    ticks++

    if (pending > 0) {
      const count = world.player.stats.luck >= 40
        ? (WAVES.xp.cardsAtHighLuck as number)
        : (WAVES.xp.cardsPerLevel as number)
      const cands = candidateIds(world.player, 'levelup').length
      const drawn = offers.draw(
        world.player, count, world.elapsed, world.player.stats.luck, 'levelup',
      )
      record('levelup', drawn, cands)
      rec.levelUps++
      const chosen = pickSmart(drawn)
      if (chosen) take(chosen)
      pending--
    }

    if (shopQueued) {
      shopQueued = false
      // Mirrors ShopScreen.open. The tool already mirrors the four slots and
      // the buy-and-refill loop; a visit that never closes would let §7.4’s
      // ban list grow without bound and report a shop nobody plays.
      offers.beginShopVisit()
      rec.shopVisits++
      for (let i = world.enemies.live - 1; i >= 0; i--) world.enemies.free(i)
      // Mirror ShopScreen: FOUR slots on the board at once, refilled one at a
      // time as they are bought. The balance harness draws 3 four times, which
      // is not a shop and cannot see a shop repeating itself.
      const SLOTS = 4
      const cands = candidateIds(world.player, 'shop').length
      let board = offers.draw(world.player, SLOTS, world.elapsed, world.player.stats.luck, 'shop')
      record('shop', board, cands)
      rec.shopSets.push(board.map((o) => o.id))
      let guard = 0
      while (guard++ < 12) {
        const affordable = board.filter((o) => world.player.feed >= o.cost)
        const buy = pickSmart(affordable)
        if (!buy) break
        world.player.feed -= buy.cost
        take(buy)
        board = board.filter((o) => o !== buy)
        const refill = offers.draw(
          world.player, 1, world.elapsed, world.player.stats.luck, 'shop',
        )
        if (refill.length > 0) {
          board.push(refill[0])
          record('shop', refill, candidateIds(world.player, 'shop').length)
          rec.shopSets[rec.shopSets.length - 1].push(refill[0].id)
        }
      }
    }
  }

  rec.cleared = !world.over
  rec.waveReached = world.spawner.wave
  rec.level = world.player.level
  rec.distinctEnd = seen.size
  for (const m of MARKS) if (rec.distinctAt[m] === undefined) rec.distinctAt[m] = NaN
  return rec
}

// -------------------------------------------------------------- aggregation

const mean = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)
const median = (xs: number[]): number => {
  if (xs.length === 0) return 0
  const s = [...xs].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}
const pct = (n: number, d: number): string => (d ? `${((n / d) * 100).toFixed(1)}%` : '-')
const fx = (n: number, d = 1): string => (Number.isNaN(n) ? '-' : n.toFixed(d))

const seeds = Array.from({ length: runs }, (_, i) => 1000 + i * 7919)

const ROSTER = [...Object.keys(WEAPONS), ...Object.keys(ITEMS)]
  .filter((id) => !id.startsWith('_')).length

interface Agg { label: string; records: RunRecord[] }

const aggs: Agg[] = []
for (const classId of classes) {
  aggs.push({ label: classId, records: seeds.map((s) => simulate(s, classId)) })
}
if (classes.length > 1) aggs.push({ label: 'ALL', records: aggs.flatMap((a) => a.records) })

for (const agg of aggs) {
  const rs = agg.records
  const draws = rs.flatMap((r) => r.draws)
  /** Full boards only: the 1-card shop refills are not a "draw" a player reads. */
  const fullDraws = draws.filter((d) => d.ids.length >= 3)
  const allCards = draws.flatMap((d) => d.cats)

  console.log(`\n=== ${agg.label} / ${pilot} - ${rs.length} runs over ${seeds.length} seeds ===`)
  console.log(`cleared            ${rs.filter((r) => r.cleared).length}/${rs.length}` +
    `   median wave ${median(rs.map((r) => r.waveReached))}` +
    `   median level ${median(rs.map((r) => r.level))}`)
  console.log(`upgrade screens    ${fx(mean(rs.map((r) => r.levelUps)))} level-ups + ` +
    `${fx(mean(rs.map((r) => r.shopVisits)))} shops per run, ` +
    `${fx(mean(rs.map((r) => r.cardsShown)), 0)} cards shown`)

  const line: string[] = []
  for (const m of MARKS) {
    const xs = rs.map((r) => r.distinctAt[m]).filter((n) => !Number.isNaN(n))
    line.push(`L${m}: ${fx(mean(xs))} (${xs.length}/${rs.length})`)
  }
  console.log(`distinct ids seen  ${line.join('   ')}`)
  console.log(`                   end ${fx(mean(rs.map((r) => r.distinctEnd)))} of ${ROSTER}` +
    `  (median ${median(rs.map((r) => r.distinctEnd))},` +
    ` min ${Math.min(...rs.map((r) => r.distinctEnd))},` +
    ` max ${Math.max(...rs.map((r) => r.distinctEnd))})`)

  const maxedDraws = draws.filter((d) => d.maxed > 0).length
  const repeatDraws = draws.filter((d) => d.repeats > 0).length
  console.log(`draws w/ a maxed id      ${maxedDraws}/${draws.length} ` +
    `(${pct(maxedDraws, draws.length)})`)
  console.log(`draws w/ an owned id     ${repeatDraws}/${draws.length} ` +
    `(${pct(repeatDraws, draws.length)})   mean ${fx(mean(draws.map((d) => d.repeats)), 2)} of ` +
    `${fx(mean(draws.map((d) => d.ids.length)))} cards`)

  const cats: Category[] = ['stat', 'merge', 'newWeapon', 'special']
  const monoAll = fullDraws.filter((d) => new Set(d.cats).size === 1)
  console.log(`all-one-category boards  ${monoAll.length}/${fullDraws.length} ` +
    `(${pct(monoAll.length, fullDraws.length)})`)
  for (const c of cats) {
    const n = fullDraws.filter((d) => d.cats.every((x) => x === c)).length
    if (n > 0) console.log(`    all ${c.padEnd(11)}    ${n} (${pct(n, fullDraws.length)})`)
  }
  const threePlus = fullDraws.filter((d) => {
    const counts = new Map<Category, number>()
    for (const c of d.cats) counts.set(c, (counts.get(c) ?? 0) + 1)
    return Math.max(...counts.values()) >= 3
  })
  console.log(`3+ of one category       ${threePlus.length}/${fullDraws.length} ` +
    `(${pct(threePlus.length, fullDraws.length)})`)
  const dupeBoards = fullDraws.filter((d) => new Set(d.ids).size < d.ids.length).length
  console.log(`boards w/ a duplicate id ${dupeBoards}/${fullDraws.length} ` +
    `(${pct(dupeBoards, fullDraws.length)})`)

  let shopPairs = 0
  let shopRepeatIds = 0
  let shopTotalIds = 0
  let shopVisitsWithRepeat = 0
  for (const r of rs) {
    for (let i = 1; i < r.shopSets.length; i++) {
      shopPairs++
      const prev = new Set(r.shopSets[i - 1])
      const hits = r.shopSets[i].filter((id) => prev.has(id))
      shopRepeatIds += hits.length
      shopTotalIds += r.shopSets[i].length
      if (hits.length > 0) shopVisitsWithRepeat++
    }
  }
  console.log(`shop repeats prev visit  ${shopVisitsWithRepeat}/${shopPairs} visits ` +
    `(${pct(shopVisitsWithRepeat, shopPairs)}), ${pct(shopRepeatIds, shopTotalIds)} of shop cards`)

  console.log('offer mix')
  for (const c of cats) {
    const n = allCards.filter((x) => x === c).length
    console.log(`    ${c.padEnd(12)}${String(n).padStart(6)}  ${pct(n, allCards.length)}`)
  }

  /*
     Rarity, split by screen and by whether the card was the doubled one.

     This is the structural half of the finding. `drawLevelUp` fills its
     non-boosted slots from `commonIdx` ALONE, and a merge offer's rarity is its
     next tier -- never `common`. So on a level-up, every uncommon-or-better
     card in the game, merges included, is competing for exactly ONE of the four
     slots, and the other three can only ever be commons.
  */
  const lvCards = draws.filter((d) => d.mode === 'levelup')
  const flat = lvCards.flatMap((d) => d.rarities.map((r, i) => ({
    r, boosted: d.boosted[i], cat: d.cats[i],
  })))
  const nonCommon = flat.filter((x) => x.r !== 'common')
  console.log(`level-up rarity          ${pct(flat.filter((x) => x.r === 'common').length, flat.length)} common,` +
    ` ${pct(nonCommon.length, flat.length)} uncommon+`)
  console.log(`  uncommon+ that were the doubled slot   ` +
    `${pct(nonCommon.filter((x) => x.boosted).length, nonCommon.length)}`)
  const lvMerge = flat.filter((x) => x.cat === 'merge')
  console.log(`  merges on a level-up   ${pct(lvMerge.length, flat.length)} of cards, ` +
    `${pct(lvMerge.filter((x) => x.boosted).length, lvMerge.length || 1)} of them the doubled slot`)

  const thin = rs.map((r) => r.thinAtLevel).filter((n): n is number => n !== null)
  console.log(`candidate pool < 12      first at level ${thin.length ? fx(mean(thin)) : '-'} ` +
    `(median ${thin.length ? median(thin) : '-'}) in ${thin.length}/${rs.length} runs`)
  const byLevel = new Map<number, number[]>()
  for (const d of draws) {
    if (!byLevel.has(d.level)) byLevel.set(d.level, [])
    byLevel.get(d.level)!.push(d.candidates)
  }
  const parts: string[] = []
  for (const b of [1, 5, 10, 15, 20, 25, 30]) {
    const xs = [...byLevel.entries()].filter(([l]) => l >= b && l < b + 5).flatMap(([, v]) => v)
    if (xs.length) parts.push(`L${b}-${b + 4}: ${fx(mean(xs), 0)}`)
  }
  console.log(`candidates available     ${parts.join('   ')}`)

  const late = draws.filter((d) => d.level >= 10)
  const lateIds = new Set(late.flatMap((d) => d.ids))
  console.log(`from L10 on              ${late.length} draws showed ${lateIds.size} distinct ids ` +
    `across ${rs.length} runs`)

  /*
     The complaint's own unit. "I hit the upgrade screen like 20 times in a few
     waves, but the options are mostly the same like 7 things" is a claim about
     a WINDOW, not about a run: how much new material does a player see across
     five consecutive level-ups? A run-total distinct count cannot answer it and
     will always look healthy, because 31 level-ups eventually touch everything.
  */
  const wIds: number[] = []
  const wCards: number[] = []
  for (const r of rs) {
    const lv = r.draws.filter((d) => d.mode === 'levelup')
    for (let i = 0; i + 5 <= lv.length; i++) {
      const ids = new Set<string>()
      let cards = 0
      for (let k = i; k < i + 5; k++) {
        for (const id of lv[k].ids) ids.add(id)
        cards += lv[k].ids.length
      }
      wIds.push(ids.size)
      wCards.push(cards)
    }
  }
  console.log(`5 consecutive level-ups  ${fx(mean(wIds))} distinct ids across ` +
    `${fx(mean(wCards))} cards ` +
    `(${pct(mean(wIds), mean(wCards))} of the cards were new)`)

  const freq = new Map<string, number>()
  for (const d of draws) for (const id of d.ids) freq.set(id, (freq.get(id) ?? 0) + 1)
  const top = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)
  console.log(`most-shown ids           ` +
    top.map(([id, n]) => `${id} ${pct(n, allCards.length)}`).join(', '))
  const sorted = [...freq.entries()].sort((a, b) => b[1] - a[1])
  for (const k of [7, 11, 20]) {
    const n = sorted.slice(0, k).reduce((a, b) => a + b[1], 0)
    console.log(`  top ${String(k).padStart(2)} ids are      ${pct(n, allCards.length)} of every card shown`)
  }
  const commons = sorted.filter(([id]) =>
    (ITEMS[id] as { rarity?: string } | undefined)?.rarity === 'common')
  const commonShare = commons.reduce((a, b) => a + b[1], 0)
  console.log(`  ${commons.length} common stat items  ${pct(commonShare, allCards.length)} of every card shown`)
  const never = [...Object.keys(WEAPONS), ...Object.keys(ITEMS)]
    .filter((id) => !id.startsWith('_') && !freq.has(id))
  if (never.length) console.log(`never shown              ${never.join(', ')}`)
}
