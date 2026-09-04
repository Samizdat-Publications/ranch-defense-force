/**
 * The upgrade pool. Level-ups and the shop draw from **exactly the same pool**
 * (§3) — the difference is agency and cost, not contents. A level-up is free,
 * fast and random; the shop is slow and paid but rerollable and lockable, which
 * is what makes it the place you go hunting for the item that finishes a build.
 *
 * ## The draw was rebuilt (docs/UPGRADE_ROSTER.md §7, batch 1)
 *
 * The measured complaint was "the options are mostly the same like 7 things".
 * `tools/offer-stream.ts` found three structural causes and this file is the
 * answer to all three:
 *
 *  - **§7.2** `drawLevelUp` used to fill its boosted slot from the
 *    uncommon-or-better cards and then fill *every remaining slot from commons
 *    alone*. A merge's rarity is its next tier, never `common`, so a merge —
 *    or an element, or a special — could not appear in slots 2, 3 or 4 of a
 *    level-up at any point in any run. 100.0% of the 6,090 uncommon+ level-up
 *    cards measured were the one boosted slot, and the eleven common stat items
 *    inherited 46.3% of every card the player ever saw. All four slots now draw
 *    from the whole candidate set under category quotas.
 *  - **§7.3** the suppression memory was 90 *seconds* and the shops are 200
 *    seconds apart, so it had always expired by the time it was needed. It is
 *    counted in **boards** now.
 *  - **§7.4** the shop had no memory of its own visit at all, so a reroll was
 *    free to hand back the board it had just swept away, and 100.0% of shop
 *    visits reshowed an id from the previous visit.
 *
 * **§7.8, stated out loud:** this changes how many `next()` calls a run
 * consumes, so every recorded seed replays as a different run. The map pick is
 * untouched — it is still the first draw off the stream and still exactly one
 * draw (see `maps.json` `_rngNote`), so the arena a seed produces has not
 * moved. Everything after it has.
 */
import {
  ITEMS, RARITY, TUNING, WEAPONS, weaponCardSprite,
  type ItemDef, type StatMods, type WeaponDef,
} from '../content'
import type { Rng } from '../core/rng'
import type { Player } from './player'

export type OfferKind = 'weapon' | 'item'
/**
 * Five tiers, rarest last. Every offer carries one — there is no unrated card.
 *
 * The weights and the per-tier colour live in `src/content/rarity.json`, not
 * here: a rarity is a balance knob and a visual language at the same time, and
 * both belong in content where they can be tuned without a rebuild of meaning.
 */
export type Rarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary'

/** Where an offer may appear. Shop-only is how the shop gets to be special. */
export type OfferSource = 'levelup' | 'shop' | 'both'

/**
 * What KIND of decision a card is (§7.1).
 *
 * **Declared, never sniffed.** The measurement tool used to derive this by
 * looking for a `special`/`element`/`toolUpgrade` key, and a draw that guesses
 * its own quotas is a draw that changes meaning every time a card gains a
 * field. `items.json` states it per card; a weapon's is the only one computed,
 * because whether a weapon is a merge or a new pickup depends on the player.
 *
 * `weaponMod` and `class` are declared here and unused until batches 2 and 4 —
 * the quota that asks for them already falls through cleanly when none exist.
 */
export type OfferCategory =
  | 'stat' | 'merge' | 'newWeapon'
  | 'load' | 'rider' | 'onHit' | 'onKill' | 'ally' | 'body' | 'ledger'
  | 'weaponMod' | 'class'

/** Slot C's quota: the cards that change how a run plays. */
const BEHAVIOURAL: ReadonlySet<string> =
  new Set(['load', 'rider', 'onHit', 'onKill', 'ally', 'body', 'ledger'])
/** Slot B's quota: the cards that only exist because of what you already own. */
const GATED: ReadonlySet<string> = new Set(['weaponMod', 'class'])

/**
 * The four buckets `tools/offer-stream.ts` reports against.
 *
 * The §2 targets ("all-one-category boards ≤ 3%", "3+ of one category ≤ 20%")
 * are stated in these, so the board's variety rule has to be stated in them
 * too or it would be optimising something the instrument cannot see.
 */
export type OfferGroup = 'stat' | 'merge' | 'newWeapon' | 'special'

export function groupOf(category: OfferCategory): OfferGroup {
  return category === 'stat' || category === 'merge' || category === 'newWeapon'
    ? category
    : 'special'
}

/**
 * How likely a tier is to be drawn, before the recency penalty.
 *
 * Both numbers come from `rarity.json`: the base weight, and how hard a point
 * of luck pushes toward this tier. Luck therefore makes good cards likelier
 * without ever making commons impossible, which is what keeps a luck build a
 * build rather than a different game.
 */
export function rarityWeight(rarity: Rarity, luck: number): number {
  const tier = RARITY[rarity] ?? RARITY.common
  return tier.weight * (1 + (luck / 100) * tier.luckScaling)
}

/**
 * Draw structure, from `tuning.offers`.
 *
 * These are the numbers §8 calls "draw structure rather than balance" — and
 * they still live in content, beside `weaponOfferWeight`, because the rule the
 * project runs on does not have an exception for numbers that feel structural.
 */
interface OfferTuning {
  weaponOfferWeight: number
  suppressBoards: number
  softSuppressBoards: number
  softSuppressWeight: number
  relaxWeight: number
  maxStatPerBoard: number
  maxMergePerBoard: number
  maxPerGroup: number
  tagBiasPerMatch: number
  tagBiasLuckDivisor: number
  tagBiasCap: number
}

const OFF = (TUNING as unknown as { offers: OfferTuning }).offers

export interface Offer {
  kind: OfferKind
  id: string
  name: string
  /** What the card says it does. */
  detail: string
  /** Atlas frame key to show on the card, if this offer has art. */
  sprite?: string
  cost: number
  rarity: Rarity
  /** The draw's own quota axis (§7.1). Declared in content, never sniffed. */
  category: OfferCategory
  /** Synergy tags (§4). Drives the tag bias; no RNG is consumed by it. */
  tags: readonly string[]
  /** Stat changes, for the delta line. Empty for behavioural weapons. */
  mods: StatMods
  /** Set when taking this would merge an owned weapon up a tier. */
  mergesTo: number | null
  /**
   * The stack counter the card prints (§5): `n` is the copy this offer would
   * be, `max` the ceiling. `max === 1` prints ONE ONLY; `n === max` prints
   * LAST. Null for a weapon, whose stack is its tier and is already on the art.
   */
  stacks: { n: number; max: number } | null
  /** Doubled magnitude. The level-up screen always has exactly one, and it is
   *  always the uncommon-or-better card — so the choice is a smaller boost to
   *  the stat you want against a double boost to one you want less. */
  boosted: boolean
  /** Tiers a weapon merge jumps: 2 when boosted, 1 otherwise. */
  tierJump: number
  locked?: boolean
}

export type DrawMode = 'levelup' | 'shop'

export class OfferPool {
  /**
   * id -> the board index it was last offered on (§7.3).
   *
   * Boards, not seconds. Level-ups arrive every ~30s early and every ~90s
   * late, so a 90-second memory meant "the last three boards" at level 5 and
   * "the last board" at level 30 — and, against shops 200 seconds apart, it
   * meant nothing at all.
   */
  private readonly offeredAt = new Map<string, number>()
  private boardIndex = 0
  /** Every id shown at the PREVIOUS shop visit (§7.4). Hard-banned. */
  private lastShopBoard = new Set<string>()
  /** Every id shown so far THIS visit, rerolled-away ones included (§7.4).
   *  This is what makes a reroll a reroll. */
  private thisShopSeen = new Set<string>()
  /** Tags the current build holds, rebuilt once per draw. Not per candidate. */
  private readonly ownedTags = new Map<string, number>()
  /** Ids unlocked via the Homestead's Seed Catalog; empty means "all". */
  private unlocked: Set<string> | null = null

  constructor(private readonly rng: Rng) {}

  setUnlocked(ids: readonly string[] | null): void {
    this.unlocked = ids && ids.length > 0 ? new Set(ids) : null
  }

  /**
   * A shop visit has opened (§7.4).
   *
   * Rolls this visit's seen-set into the ban list and starts a fresh one, so
   * the next visit cannot reshow what this one showed and a reroll inside a
   * visit cannot reshow what the visit has already swept away. Called by
   * `ShopScreen.open`, and by the two harnesses where they mirror it.
   */
  beginShopVisit(): void {
    this.lastShopBoard = this.thisShopSeen
    this.thisShopSeen = new Set()
  }

  private isAvailable(id: string): boolean {
    return this.unlocked === null || this.unlocked.has(id)
  }

  /**
   * Draw `count` distinct offers. `now` is world elapsed seconds; it is kept in
   * the signature because every caller has it and the memory used to be
   * denominated in it, but the memory counts boards now (§7.3). Luck widens the
   * draw slightly toward rarer entries and sharpens the tag bias (§7.6).
   */
  draw(
    player: Player,
    count: number,
    now: number,
    luck: number,
    mode: DrawMode = 'shop',
  ): Offer[] {
    void now
    const candidates: Offer[] = []

    for (const [id, def] of Object.entries(WEAPONS) as [string, WeaponDef][]) {
      if (!this.isAvailable(id)) continue
      const owned = player.hasWeapon(id)
      // A weapon you can neither take nor merge is not an offer.
      if (owned && player.weaponAtMaxTier(id)) continue
      if (!owned && player.slotsFull) continue
      candidates.push(this.weaponOffer(id, def, player))
    }

    for (const [id, def] of Object.entries(ITEMS) as [string, ItemDef][]) {
      if (!this.isAvailable(id)) continue
      // Shop-only items are the reason a shop visit is worth stopping for: the
      // level-up hands you what the run offers, the shop is where the run's
      // best cards live and you pay feed for them.
      const source = def.source ?? 'both'
      if (source !== 'both' && source !== mode) continue
      // A maxed-out item is not an offer. Without this the pool keeps handing
      // out a card the player has already taken as many times as it can help,
      // which is the "same five things over and over" complaint wearing a hat.
      if (!player.canTakeItem(id)) continue
      // A card gated on something the run does not have yet is not an offer.
      // This is what makes the pool GROW through a run instead of shrinking.
      if (!this.gateOpen(def, player)) continue
      candidates.push(this.itemOffer(id, def, player))
    }

    if (candidates.length === 0) return []

    this.boardIndex++
    this.collectTags(player)

    const picked = mode === 'levelup'
      ? this.drawBoard(candidates, count, luck, mode, true)
      : this.drawBoard(candidates, count, luck, mode, false)

    for (const o of picked) {
      this.offeredAt.set(o.id, this.boardIndex)
      if (mode === 'shop') this.thisShopSeen.add(o.id)
    }
    // Shuffle so the boosted card is not always in the same slot — it should
    // have to be read for, not learned by position.
    return mode === 'levelup' ? this.rng.shuffle(picked) : picked
  }

  /**
   * Whether a gated card's precondition is met (§3).
   *
   * `requiresItem` is the only gate batch 1 needs — the four Load Riders are
   * meaningless without a Load on, and offering them to a run that has never
   * seen the shop is exactly the kind of dead card the rebuild exists to
   * remove. `requiresWeapon` and `requiresClass` are read here so batches 2
   * and 4 are a content edit rather than another pass over this function.
   */
  private gateOpen(def: ItemDef, player: Player): boolean {
    const needsWeapon = def.requiresWeapon
    if (typeof needsWeapon === 'string' && !player.hasWeapon(needsWeapon)) return false
    const needsClass = def.requiresClass
    if (typeof needsClass === 'string' && player.classId !== needsClass) return false
    const needsItem = def.requiresItem
    if (typeof needsItem === 'string' && player.itemCount(needsItem) === 0) return false
    // "any load" — the four riders, which care that you have one, not which.
    if (def.requiresLoad === true && player.element === 'none') return false
    /*
       "any weapon of this type". A card that only ever touches a bullet is
       dead weight to a build that owns no gun, and the balance harness found
       it the hard way: The Hand opens with a pitchfork, five of the seven
       On-Hit cards are ranged-only, and his board was being filled with cards
       that could not fire. A weapon TYPE is as much a gate as a particular
       weapon is, and it is the same trick §3 describes -- a card that cannot
       appear yet cannot dilute the board.
    */
    const needsType = def.requiresWeaponType
    if (typeof needsType === 'string'
      && !player.weapons.some((w) => WEAPONS[w.id]?.type === needsType)) return false
    return true
  }

  /** The tags this build already holds, for the §4 bias. Rebuilt per draw. */
  private collectTags(player: Player): void {
    this.ownedTags.clear()
    for (const owned of player.items) {
      const tags = (ITEMS[owned.id] as ItemDef | undefined)?.tags
      if (!Array.isArray(tags)) continue
      for (const t of tags) this.ownedTags.set(t as string, 1)
    }
    for (const slot of player.weapons) {
      const tags = (WEAPONS[slot.id] as WeaponDef | undefined)?.tags
      if (!Array.isArray(tags)) continue
      for (const t of tags) this.ownedTags.set(t as string, 1)
    }
  }

  /**
   * §4: bias toward tags the build already holds, so a build FORMS rather than
   * accumulating. Deterministic — a weight, never a draw, so it consumes no
   * RNG and cannot move a seed. §7.6 scales it with luck, which is a far
   * better luck fantasy than "slightly more epics": a lucky run's cards agree
   * with each other.
   */
  private tagBias(o: Offer, luck: number): number {
    if (this.ownedTags.size === 0 || o.tags.length === 0) return 1
    let matches = 0
    for (const t of o.tags) if (this.ownedTags.has(t)) matches++
    if (matches === 0) return 1
    const per = OFF.tagBiasPerMatch + luck / OFF.tagBiasLuckDivisor
    return Math.min(OFF.tagBiasCap, 1 + per * matches)
  }

  /**
   * One card's weight, at a given relax level.
   *
   * `relax` is how much of the memory to give up when the filtered pool cannot
   * fill a board. 0 is the full rules; 1 softens the board memory to a
   * suppression; 2 softens the shop's own bans too. The escalation order is
   * the priority order: the shop-repeat rule has a 0% target and is therefore
   * the last thing surrendered.
   */
  private weightOf(o: Offer, luck: number, mode: DrawMode, relax: number): number {
    let w = rarityWeight(o.rarity, luck) * (o.kind === 'weapon' ? OFF.weaponOfferWeight : 1)
    w *= this.tagBias(o, luck)

    const at = this.offeredAt.get(o.id)
    if (at !== undefined) {
      const age = this.boardIndex - at
      if (age <= OFF.suppressBoards) w *= relax >= 1 ? OFF.relaxWeight : 0
      else if (age <= OFF.suppressBoards + OFF.softSuppressBoards) w *= OFF.softSuppressWeight
    }

    if (mode === 'shop' && (this.lastShopBoard.has(o.id) || this.thisShopSeen.has(o.id))) {
      w *= relax >= 2 ? OFF.relaxWeight : 0
    }
    return w
  }

  /**
   * The board (§7.2). Four slots, filled in quota order, from the WHOLE
   * candidate set — no commons-only pool anywhere.
   *
   *  A. the doubled slot: the highest-rarity card drawn, at double magnitude.
   *     Kept exactly as it was. It was a good rule; it was just carrying the
   *     entire non-common roster on its own.
   *  B. gated — a weapon upgrade or a class card, if any exists.
   *  C. behavioural — a load, rider, on-hit, on-kill, ally, body or ledger card.
   *  D. free.
   *
   * Plus three board-level caps, applied as filters while filling: at most one
   * `stat`, at most one `merge`, and at most `maxPerGroup` of any one reported
   * group. The third is not in §7.2 — it is what stops "slot B has no gated
   * card to draw, so B, C and D are all behavioural" reproducing the very
   * shape the rebuild is measured against, in a different colour. It is stated
   * in the instrument's own buckets because the §2 targets are.
   */
  private drawBoard(
    candidates: Offer[], count: number, luck: number, mode: DrawMode, boost: boolean,
  ): Offer[] {
    const want = Math.min(count, candidates.length)
    const picked: Offer[] = []
    const taken = new Set<number>()
    let stats = 0
    let merges = 0
    const groups = new Map<OfferGroup, number>()

    const capped = (i: number): boolean => {
      const c = candidates[i].category
      if (c === 'stat' && stats >= OFF.maxStatPerBoard) return true
      if (c === 'merge' && merges >= OFF.maxMergePerBoard) return true
      return (groups.get(groupOf(c)) ?? 0) >= OFF.maxPerGroup
    }

    /** Weighted pick over the unused candidates a predicate admits, or -1. */
    const tryPick = (
      pred: (o: Offer) => boolean, relax: number, respectCaps: boolean,
    ): number => {
      let any = false
      const w = candidates.map((o, i) => {
        if (taken.has(i) || !pred(o)) return 0
        if (respectCaps && capped(i)) return 0
        const x = this.weightOf(o, luck, mode, relax)
        if (x > 0) any = true
        return x
      })
      if (!any) return -1
      return this.rng.weightedIndex(w)
    }

    /**
     * Fill one slot. The quota first, then any slot-specific second choice,
     * then §7.2's fallback chain — behavioural, gated, merge, stat, anything.
     * Only after all of those does it give up the caps, and only after those
     * the memory. A slot is never left empty and an id is never repeated
     * within a board.
     */
    const fill = (quota: (o: Offer) => boolean, second?: (o: Offer) => boolean): void => {
      const chain: ((o: Offer) => boolean)[] = [
        quota,
        ...(second ? [second] : []),
        (o) => BEHAVIOURAL.has(o.category),
        (o) => GATED.has(o.category),
        (o) => o.category === 'merge',
        (o) => o.category === 'stat',
        () => true,
      ]
      /*
         Caps OUTSIDE, memory inside — and that order is the whole rule.

         Written the other way round it surrenders the board caps before it
         surrenders the recency memory, which means a board whose good cards
         happen to be suppressed deals four stat commons rather than
         re-showing one card from three boards ago. A real run photographed
         exactly that at level 6 (`tools/play/batch1`): four commons, the
         boosted slot among them, the precise shape this rebuild exists to
         remove. Re-showing a card slightly too soon is a small cost; a board
         of four percentages is the whole complaint.
      */
      for (const respectCaps of [true, false]) {
        for (let relax = 0; relax <= 2; relax++) {
          for (const pred of chain) {
            const i = tryPick(pred, relax, respectCaps)
            if (i < 0) continue
            taken.add(i)
            const o = candidates[i]
            if (o.category === 'stat') stats++
            if (o.category === 'merge') merges++
            const g = groupOf(o.category)
            groups.set(g, (groups.get(g) ?? 0) + 1)
            picked.push(o)
            return
          }
        }
      }
    }

    // Slot A. Doubling is level-up only: the shop is where you buy exactly
    // what you need and it charges you for the privilege, so handing out
    // doubles there too would flatten the difference between the two systems.
    if (want > 0) {
      const before = picked.length
      fill((o) => o.rarity !== 'common')
      if (boost && picked.length > before) picked[before] = boosted(picked[before])
    }
    /*
       Slot B — gated, and until batch 2 lands there are almost none.

       §7.2's fallback chain starts at `behavioural`, which is right for the
       full roster and wrong here: slot C's quota is ALSO behavioural, so with
       no gated cards to draw, B and C both fill with the same kind of card and
       three of the four slots end up behavioural. That is the measured
       40%-of-boards-are-four-of-a-kind shape reproduced in a different colour,
       and the balance harness said so in as many words — a bot that had been
       clearing 79% of hand/brawler runs fell to 13%, dying on wave 6 with a
       tier-1 loadout, because the board had stopped offering it weapons.

       So slot B takes a WEAPON card as its second choice: a merge, or one it
       does not own. A gated card is a card about a weapon you already carry,
       and until those exist the closest thing to one is the weapon itself.
       This is the slot the roster means to be "the card that exists because of
       what you are already holding", and it keeps that meaning either way.
    */
    if (want > 1) {
      fill(
        (o) => GATED.has(o.category),
        (o) => o.category === 'merge' || o.category === 'newWeapon',
      )
    }
    if (want > 2) fill((o) => BEHAVIOURAL.has(o.category))
    /*
       Slot D — free, and it deals the board's ONE stat card.

       §11's sentence about the stat cards is the whole rule: "they are still
       the reliable filler a player wants when nothing else on the board fits
       the build; there are just no longer four of them at once." At most one
       and at least one, so the player always has somewhere to put a level-up
       that the rest of the board does not answer.

       This is not bookkeeping. Dropped, the balance harness fell off a cliff:
       hand/brawler went 79% -> 13% cleared, dying on wave 6 having taken less
       total damage than the old build shrugged off, because a bot whose whole
       survival is max HP and armour was being handed one stat card every
       third board. A HUMAN would spend a behavioural card instead — but the
       harness is the instrument and the instrument said the board had stopped
       being playable in the most ordinary way there is.

       Any further slot (the high-luck fifth) goes to a group the board does
       not have yet, because the cheapest thing a spare slot can do is not
       repeat what is already on the table.
    */
    while (picked.length < want) {
      const before = picked.length
      const thin = (o: Offer): boolean => (groups.get(groupOf(o.category)) ?? 0) === 0
      if (stats === 0) fill((o) => o.category === 'stat', thin)
      else fill(thin)
      if (picked.length === before) break // pool exhausted; nothing left to deal
    }

    if (mode === 'shop') this.guaranteeOneAboveCommon(candidates, taken, picked, luck)
    return picked
  }

  /**
   * Every set of cards contains at least one uncommon or better.
   *
   * Kept for the shop only. On a level-up slot A already draws from the
   * uncommon-or-better candidates, so §7.2 is right that the special case can
   * go there — an all-common level-up became arithmetically rare rather than
   * something to patch after the fact. The shop's board has no boosted slot
   * and still wants the floor.
   *
   * Replaces the last pick rather than adding a card, so the count the caller
   * asked for is what it gets.
   */
  private guaranteeOneAboveCommon(
    candidates: readonly Offer[],
    taken: Set<number>,
    picked: Offer[],
    luck: number,
  ): void {
    if (picked.length === 0) return
    if (picked.some((o) => o.rarity !== 'common')) return

    const upgradeWeights = candidates.map((o, i) =>
      o.rarity !== 'common' && !taken.has(i) ? rarityWeight(o.rarity, luck) : 0,
    )
    if (upgradeWeights.every((w) => w === 0)) return // pool has nothing better

    const idx = this.rng.weightedIndex(upgradeWeights)
    picked[picked.length - 1] = candidates[idx]
  }

  private weaponOffer(id: string, def: WeaponDef, player: Player): Offer {
    const slot = player.weapons.find((w) => w.id === id)
    const nextTier = slot ? slot.tier + 1 : null
    // A new weapon leads with what it DOES; the numbers are the second line.
    // Leading with numbers produced "utility · 0 damage / 6s" for the Bait
    // Drum, which is a card nobody would ever pick and says nothing about the
    // fact that it gathers the crowd for everything else you own.
    const stats = `${def.type} · ${def.base > 0 ? `${def.base} damage` : 'no damage'}` +
      `${def.cooldown > 0 ? ` / ${def.cooldown}s` : ''}`
    const detail = nextTier
      ? mergeDetail(def, nextTier, nextTier)
      : typeof def.blurb === 'string' ? `${def.blurb}
${stats}` : stats
    // A weapon's rarity is its tier: merging is the offensive game, so a merge
    // into tier 4 should read as the rarest thing the pool can hand you.
    const rarity: Rarity = nextTier === null
      ? 'common'
      : nextTier >= 4 ? 'legendary' : nextTier === 3 ? 'epic' : 'uncommon'
    const tags = Array.isArray(def.tags) ? (def.tags as string[]) : EMPTY_TAGS
    return {
      kind: 'weapon',
      id,
      name: def.name,
      detail,
      // One question, one answer, in content: the HUD slot asks it too, and
      // the Harpoon Gun's `gun.pistol.*` art is unreadable at every tier.
      sprite: weaponCardSprite(id, nextTier ?? 1) || undefined,
      cost: nextTier ? 14 + nextTier * 8 : 20,
      rarity,
      category: nextTier === null ? 'newWeapon' : 'merge',
      tags,
      mods: {},
      mergesTo: nextTier,
      // A weapon's stack IS its tier, and the tier is already drawn on the art
      // and stamped on the merge line. A second counter would say it a third
      // time and mean something slightly different.
      stacks: null,
      boosted: false,
      tierJump: 1,
    }
  }

  private itemOffer(id: string, def: ItemDef, player: Player): Offer {
    const mods = def.mods ?? {}
    // Rarity is declared in items.json. The old heuristic (special = rare,
    // multi-stat = uncommon) is kept only as a fallback for an item that has
    // not been given one yet.
    const rarity: Rarity = def.rarity
      ?? (def.special ? 'rare' : Object.keys(mods).length > 1 ? 'uncommon' : 'common')
    const max = typeof def.maxStacks === 'number' ? def.maxStacks : 0
    const n = player.itemCount(id) + 1
    return {
      kind: 'item',
      id,
      name: def.name,
      detail: describeItem(def, n),
      // Elements and tool upgrades have real art; ordinary stat items do not,
      // and a card without a sprite simply shows no sprite.
      sprite: typeof def.cardSprite === 'string' ? def.cardSprite : undefined,
      cost: def.cost,
      rarity,
      category: categoryOf(def),
      tags: Array.isArray(def.tags) ? (def.tags as string[]) : EMPTY_TAGS,
      mods,
      mergesTo: null,
      stacks: max > 0 ? { n, max } : null,
      boosted: false,
      tierJump: 1,
    }
  }
}

const EMPTY_TAGS: readonly string[] = []

/**
 * §7.1: the category is declared, not derived.
 *
 * The fallback exists only so an item added without one is a plain stat card
 * rather than a crash, and `tests/content.test.ts` asserts that no item in the
 * roster actually reaches it.
 */
export function categoryOf(def: ItemDef): OfferCategory {
  const c = def.category
  return typeof c === 'string' ? (c as OfferCategory) : 'stat'
}

/**
 * The merge card's concrete delta (§5).
 *
 * The whole card used to be `Tier 3: +2 pellets (+60% damage)` — a rider name,
 * a hardcoded percentage, no before and no after. The "+60%" is now the tier
 * multiplier in `tuning.merge` and the rest comes out of the weapon's own
 * `tiers[n].delta`, which is authored beside the numbers it describes.
 */
export function mergeDetail(def: WeaponDef, fromTier: number, toTier: number): string {
  const tier = (t: number): { name: string; delta: string } | null => {
    const raw = def.tiers[String(t)] as unknown
    if (raw && typeof raw === 'object') return raw as { name: string; delta: string }
    return typeof raw === 'string' ? { name: raw, delta: '' } : null
  }
  if (toTier <= fromTier) {
    const t = tier(toTier)
    if (!t) return `Tier ${toTier}: stronger`
    return t.delta ? `Tier ${toTier}: ${t.name} — ${t.delta}` : `Tier ${toTier}: ${t.name}`
  }
  // Two tiers at once (the boosted slot). The riders are both named, and the
  // damage step is computed across the whole jump rather than quoted from one
  // tier's delta, which would understate it by a factor of the multiplier.
  const names: string[] = []
  for (let t = fromTier; t <= toTier; t++) {
    const e = tier(t)
    if (e) names.push(e.name)
  }
  const mul = MERGE_TIER_MULTIPLIER
  const from = def.base * Math.pow(mul, fromTier - 2)
  const to = def.base * Math.pow(mul, toTier - 1)
  const dmg = def.base > 0 ? ` · ${fmtDamage(from)} → ${fmtDamage(to)} damage` : ''
  return `Tier ${fromTier} → ${toTier}, two tiers: ${names.join(', ')}${dmg}`
}

/** §7: each tier is base damage × this. Content, not a constant in code. */
const MERGE_TIER_MULTIPLIER =
  (TUNING as unknown as { merge: { tierDamageMultiplier: number } }).merge.tierDamageMultiplier

function fmtDamage(v: number): string {
  return Number.isInteger(v) ? String(v) : v.toFixed(1)
}

/** Double an offer's magnitude for the level-up screen's guaranteed slot. */
function boosted(offer: Offer): Offer {
  const mods: StatMods = {}
  for (const [k, v] of Object.entries(offer.mods)) {
    mods[k as keyof StatMods] = (v as number) * 2
  }
  const doubledDetail = offer.kind === 'item'
    ? describeMods(mods) || offer.detail
    : offer.mergesTo !== null
      ? mergeDetail(
        WEAPONS[offer.id] as WeaponDef, offer.mergesTo, Math.min(4, offer.mergesTo + 1),
      )
      : offer.detail
  return {
    ...offer,
    mods,
    boosted: true,
    tierJump: 2,
    detail: doubledDetail,
    // A boosted item is two copies in one card, so the counter has to say so
    // or the "3/5" on the face is a lie the moment it is taken.
    stacks: offer.stacks
      ? { n: Math.min(offer.stacks.max, offer.stacks.n + 1), max: offer.stacks.max }
      : null,
    // Cost is untouched: the doubling is the reward for the rarity roll, not
    // something the player pays extra for.
  }
}

const PCT_KEYS = new Set([
  'moveSpeedPct', 'pickupRadiusPct', 'harvestPct', 'damagePct', 'meleePct',
  'rangedPct', 'attackSpeedPct', 'critChancePct', 'critDamagePct', 'rangePct',
  'dodgePct', 'lifestealPct', 'xpPct',
])

export function describeMods(mods: StatMods): string {
  const parts: string[] = []
  for (const [key, value] of Object.entries(mods)) {
    const v = value as number
    const sign = v >= 0 ? '+' : ''
    parts.push(`${sign}${v}${PCT_KEYS.has(key) ? '%' : ''} ${humanKey(key)}`)
  }
  return parts.join(' · ')
}

/**
 * The card's body text.
 *
 * `stackBlurb` (§5) is the behavioural card's answer to "what does taking this
 * AGAIN do": a template with `{n}` substituted from the copy this offer would
 * be, so a card whose whole effect is a blurb still states its numbers at the
 * stack the player is actually looking at. `stack` is 1-based and is the copy
 * being offered, not the copy already held.
 */
export function describeItem(def: ItemDef, stack = 1): string {
  const parts: string[] = []
  // An item whose whole effect is behavioural — an element, a tool tier — has
  // no stat mods to describe, and was rendering a completely blank card. The
  // blurb IS the description for those.
  const stackBlurb = def.stackBlurb
  if (typeof stackBlurb === 'string') parts.push(fillStack(stackBlurb, def, stack))
  else if (typeof def.blurb === 'string') parts.push(def.blurb)
  const base = describeMods(def.mods ?? {})
  if (base) parts.push(base)
  if (def.special === 'reflect') parts.push(`reflects ${def.reflectDamage} to attackers`)
  if (def.special === 'auraDamageReduction') {
    parts.push(`enemies within ${def.radius}px deal ${def.reductionPct}% less`)
  }
  if (def.special === 'gasGrace') parts.push(`immune to gas for ${def.graceSeconds}s of contact`)
  return parts.join(' · ')
}

/**
 * Substitute a stack blurb's placeholders.
 *
 * `{n}` is the copy being offered. `{total}` is what the player will HAVE if
 * they take it — `n × stackPer` — and it is the one that matters: "15% of
 * kills drop a feed token" is a different card on your first copy and your
 * fourth, and §5's contract is that the card says which one you are looking
 * at. A card with a `{total}` and no `stackPer` prints its stack count rather
 * than the placeholder, so a missing field is a wrong number and never a
 * literal `{total}` on the face of a card — which is exactly what a real run
 * photographed before this existed.
 */
function fillStack(template: string, def: ItemDef, stack: number): string {
  const per = typeof def.stackPer === 'number' ? def.stackPer : 1
  const total = per * stack
  const shown = Number.isInteger(total) ? String(total) : total.toFixed(1)
  return template.replace(/\{n\}/g, String(stack)).replace(/\{total\}/g, shown)
}

/** The footer's lot slot (§5): `3/5`, `ONE ONLY`, or `4/4 · LAST`. */
export function stackLabel(stacks: { n: number; max: number } | null): string {
  if (!stacks) return ''
  if (stacks.max <= 1) return 'ONE ONLY'
  return stacks.n >= stacks.max ? `${stacks.n}/${stacks.max} · LAST` : `${stacks.n}/${stacks.max}`
}

function humanKey(key: string): string {
  return key
    .replace(/Pct$/, '')
    .replace(/([A-Z])/g, ' $1')
    .toLowerCase()
    .trim()
}
