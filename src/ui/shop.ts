/**
 * Shop (§12). Opens after waves 5/10/15/20/24, arena cleared, untimed.
 *
 * Four cards you can reroll at an escalating cost and individually lock to
 * carry to the next shop. That lock is what turns the shop from "more upgrades"
 * into the place you go hunting for the one item that finishes a build — the
 * level-up gives you what the run offers, the shop lets you go get what you
 * need.
 *
 * The right-hand character sheet highlights anything that changed since the
 * last wave, and hovering a card previews its effect in a second colour.
 */
import { STAT_KEYS, STAT_LABELS } from '../content'
import { categoryLabel, stackLabel, type Offer, type OfferPool } from '../sim/offers'
import type { World } from '../sim/world'
import { emptyDerived, previewDelta, type DerivedStats } from '../sim/stats'
import { card, deal, lotOf } from './card'
import { shopRerollCost } from '../sim/formulas'
import { clear, el, fmtStat } from './dom'
import { buildLedger } from './ledger'

const SLOTS = 4

/** `items.json`'s Reroll Chit — see `buy()`. */
const REROLL_CHIT_ID = 'rerollChit'

/**
 * Handbill (batch 5, epic, shop-only): the shop shows five cards instead of
 * four, and the first reroll each visit is free. Both are read off the item
 * count directly rather than flattened into `specialItems` — this is the one
 * card whose effect is the SHOP SCREEN's own shape, not the sim's, so it has
 * no business in the tick loop.
 */
const HANDBILL_SLOTS = 5

export class ShopScreen {
  private readonly root: HTMLElement
  private readonly cardsEl: HTMLElement
  private readonly sheetEl: HTMLElement
  private readonly rerollBtn: HTMLButtonElement
  private readonly feedEl: HTMLElement
  private readonly subtitle: HTMLElement
  /** §7.7: what this visit uniquely sells. */
  private readonly exclusiveNote: HTMLElement

  private offers: (Offer | null)[] = []
  /** Locked cards survive the reroll and the next shop visit. */
  private locked: (Offer | null)[] = [null, null, null, null]
  private rerollsThisShop = 0
  private world: World | null = null
  private pool: OfferPool | null = null
  private onBuy: ((o: Offer) => void) | null = null
  private onClose: (() => void) | null = null

  /** Stats as they were when the shop opened, for the "changed" highlight. */
  private readonly opening = emptyDerived()
  private readonly scratchA = emptyDerived()
  private readonly scratchB = emptyDerived()
  private hovered: Offer | null = null

  constructor(parent: HTMLElement) {
    // The cards row and the counter sit in the SAME flex row, per the mockup.
    // The counter is a column of that row rather than a sidebar, so on a narrow
    // window it wraps under the cards instead of being cropped off the edge.
    this.cardsEl = el('div', { class: 'pshop-row' })
    this.sheetEl = el('div', { class: 'pshop-counter' })
    this.feedEl = el('div', { class: 'pshop-feed' })
    this.subtitle = el('div', { class: 'pshop-sub' })
    this.exclusiveNote = el('div', { class: 'pshop-exclusive' })
    this.rerollBtn = el('button', {
      class: 'pshop-btn is-gold',
      text: 'REROLL',
      onClick: () => this.reroll(),
    })

    this.root = el('div', { class: 'screen pshop' }, [
      el('div', { class: 'pshop-inner' }, [
        el('div', { class: 'pshop-head' }, [
          el('div', { class: 'pshop-eyebrow', text: 'BETWEEN WAVES' }),
          el('h1', { class: 'pshop-title', text: 'Same packet, priced' }),
          this.subtitle,
          this.exclusiveNote,
        ]),
        this.cardsEl,
      ]),
    ])
    this.root.style.display = 'none'
    parent.appendChild(this.root)
  }

  get visible(): boolean {
    return this.root.style.display !== 'none'
  }

  open(
    world: World,
    pool: OfferPool,
    onBuy: (o: Offer) => void,
    onClose: () => void,
  ): void {
    this.world = world
    this.pool = pool
    this.onBuy = onBuy
    this.onClose = onClose
    this.rerollsThisShop = 0
    /*
       §7.4. The shop could not remember its own visit: 100.0% of visits
       reshowed an id from the previous one and a reroll was free to hand back
       the board it had just swept away. This is the call that rolls the last
       visit into the ban list and opens a fresh seen-set. HELD cards are
       exempt for free — a held slot is never redrawn, so it is never a draw.
    */
    pool.beginShopVisit()

    // Interest on unspent feed, paid on arrival (§3). Ledger Book (batch 5)
    // raises the cap and the rate, so this reads it off the world rather than
    // the pure formula.
    const interest = world.interestFor(world.player.feed)
    world.player.feed += interest
    this.subtitle.textContent = interest > 0
      ? `After wave ${world.spawner.wave - 1} · +${interest} feed interest`
      : `After wave ${world.spawner.wave - 1}`

    // Snapshot the stat block so the sheet can mark what changed.
    Object.assign(this.opening, world.player.stats)

    // Handbill: a fifth slot. Grown, never shrunk — `locked` only ever
    // carries what a PREVIOUS visit held, and a run does not lose an item —
    // so a slot that has already existed keeps whatever was pinned in it.
    while (this.locked.length < this.slotCount()) this.locked.push(null)

    this.offers = []
    for (let i = 0; i < this.slotCount(); i++) this.offers.push(this.locked[i] ?? null)
    this.fillEmptySlots()
    this.updateExclusiveNote()
    this.render()
    this.root.style.display = ''
  }

  /**
   * §7.7: "the shop shows what it uniquely sells and why a visit is worth
   * stopping for." Counted rather than asserted — a run that has bought out
   * the exclusive pool for this visit should not keep reading a line that is
   * no longer true.
   */
  private updateExclusiveNote(): void {
    const n = this.offers.filter((o) => o?.exclusive).length
    this.exclusiveNote.textContent = n > 0
      ? `${n} of ${this.offers.length} cards here you will never see at a level-up.`
      : 'The swap, the Loads, and every epic and legendary live only here.'
  }

  /** 5 with Handbill, 4 without. */
  private slotCount(): number {
    return this.world && this.world.player.itemCount('handbill') > 0 ? HANDBILL_SLOTS : SLOTS
  }

  private fillEmptySlots(): void {
    const world = this.world
    const pool = this.pool
    if (!world || !pool) return
    const needed = this.offers.filter((o) => o === null).length
    if (needed === 0) return
    const fresh = pool.draw(world.player, needed, world.elapsed, world.player.stats.luck)
    let f = 0
    for (let i = 0; i < this.offers.length; i++) {
      if (this.offers[i] === null) this.offers[i] = fresh[f++] ?? null
    }
  }

  private reroll(): void {
    const world = this.world
    if (!world) return
    // Handbill: the first reroll of the visit costs nothing.
    const free = this.rerollsThisShop === 0 && world.player.itemCount('handbill') > 0
    const cost = free ? 0 : shopRerollCost(this.rerollsThisShop)
    if (!free && world.player.feed < cost) return
    world.player.feed -= cost
    this.rerollsThisShop++
    for (let i = 0; i < this.offers.length; i++) {
      if (this.locked[i] === null) this.offers[i] = null
    }
    this.fillEmptySlots()
    this.updateExclusiveNote()
    this.render()
  }

  private toggleLock(index: number): void {
    this.locked[index] = this.locked[index] ? null : this.offers[index]
    this.render()
  }

  private buy(index: number): void {
    const world = this.world
    const offer = this.offers[index]
    if (!world || !offer || world.player.feed < offer.cost) return
    world.player.feed -= offer.cost
    this.onBuy?.(offer)
    this.offers[index] = null
    this.locked[index] = null
    /*
       Reroll Chit (batch 6 shop sink, `items.json` id `rerollChit`): spending
       it turns the WHOLE board over for free, right now — no cost, no bump to
       `rerollsThisShop`'s escalating price, held cards untouched. A UI-only
       effect (the board it redraws belongs to this screen, not the sim), so
       it is special-cased here rather than routed through `Player.addItem`
       the way the other four sinks are.
    */
    if (offer.id === REROLL_CHIT_ID) {
      for (let i = 0; i < this.offers.length; i++) {
        if (this.locked[i] === null) this.offers[i] = null
      }
    }
    this.fillEmptySlots()
    this.updateExclusiveNote()
    this.render()
  }

  private finish(): void {
    this.root.style.display = 'none'
    // Locked cards persist to the next shop; everything else is discarded.
    this.onClose?.()
  }

  /**
   * The shop is the level-up frame with a price plate. Design was explicit that
   * there is no shop card: the same packet, plus a feed price in the footer and
   * a bulldog clip when you hold one for the next visit.
   *
   * `card()` already carried `price`, `affordable`, `dead` and `clipped`. This
   * screen used to draw its own `.card` and ask for none of them, which is how
   * the shop and the level-up ended up looking like two different games.
   */
  private render(): void {
    const world = this.world
    if (!world) return
    clear(this.cardsEl)

    const built: HTMLElement[] = []
    this.offers.forEach((offer, i) => {
      if (!offer) return
      const affordable = world.player.feed >= offer.cost
      const held = this.locked[i] !== null

      const c = card({
        // §5: a weapon-upgrade card names its weapon; `swap` shows plainly.
        kind: offer.band ?? offer.kind,
        category: categoryLabel(offer.category),
        // §7.7: the shop's own pitch — a card here that a level-up could
        // never have dealt you.
        exclusive: offer.exclusive,
        name: offer.name,
        blurb: offer.detail,
        sprite: offer.sprite,
        rarity: offer.rarity,
        stats: this.statRows(offer),
        lot: lotOf(offer.id),
        stack: stackLabel(offer.stacks),
        price: offer.cost,
        affordable,
        // Unaffordable is UNPRINTED STOCK, not disabled chrome — pulpboard
        // grey, and the plate drops its emboss. It reads as "not for you yet"
        // rather than "broken".
        dead: !affordable,
        clipped: held,
        onClick: () => this.buy(i),
      })

      // Hovering previews the card against the live build, in the counter. The
      // listener is on the SLOT rather than the card, because `dead` disables
      // the card's button and a disabled button fires no pointer events — and
      // the card you cannot afford is exactly the one you most want to price.
      const slot = el('div', { class: 'pshop-slot' }, [
        c,
        el('button', {
          class: `pshop-hold${held ? ' is-held' : ''}`,
          text: held ? 'HELD' : 'HOLD',
          onClick: () => this.toggleLock(i),
        }),
      ])
      slot.addEventListener('mouseenter', () => {
        this.hovered = offer
        this.renderSheet()
      })
      slot.addEventListener('mouseleave', () => {
        this.hovered = null
        this.renderSheet()
      })

      this.cardsEl.appendChild(slot)
      built.push(c)
    })

    this.cardsEl.appendChild(this.sheetEl)
    deal(built)

    const freeReroll = this.rerollsThisShop === 0 && world.player.itemCount('handbill') > 0
    const cost = shopRerollCost(this.rerollsThisShop)
    this.rerollBtn.textContent = freeReroll ? 'REROLL · FREE' : `REROLL · ${cost}`
    this.rerollBtn.disabled = !freeReroll && world.player.feed < cost
    this.renderSheet()
  }

  /** The card's stat rows, split the way the level-up splits them. */
  private statRows(offer: Offer): { label: string; value: string; tone?: 'gain' | 'cost' }[] {
    return this.deltaLines(offer).map((d) => {
      const m = d.match(/^(.*?)\s+([-+\d].*)$/)
      const raw = m ? m[2] : d
      return {
        label: m ? m[1] : d,
        value: raw,
        tone: raw.includes('-') && !raw.includes('→') ? 'cost' as const : 'gain' as const,
      }
    })
  }

  private deltaLines(offer: Offer): string[] {
    const world = this.world
    if (!world || Object.keys(offer.mods).length === 0) return []
    const changes = previewDelta(world.player.statSources, offer.mods, this.scratchA, this.scratchB)
    return changes.map((c) => `${STAT_LABELS[c.key]} ${fmtStat(c.key, c.from)} → ${fmtStat(c.key, c.to)}`)
  }

  /**
   * The counter: who you are, what you are carrying, what it costs.
   *
   * The mockup draws five stat rows against placeholder content. This keeps the
   * real thing — weapons with their tiers, passives with their stack counts,
   * every non-zero stat — because the panel's job is to answer "do I need this"
   * and five rows cannot. The chrome is the mockup's; the content is the game's.
   */
  private renderSheet(): void {
    const world = this.world
    if (!world) return
    const p = world.player
    clear(this.sheetEl)

    this.sheetEl.appendChild(el('div', {
      class: 'pshop-counter-head',
      text: `${p.def.name.toUpperCase()} · WAVE ${world.spawner.wave - 1}`,
    }))

    const rows = (lines: HTMLElement[]): HTMLElement => el('div', { class: 'pshop-rows' }, lines)
    const line = (
      label: string, value: string, tone?: 'changed' | 'preview',
    ): HTMLElement => el('div', {
      class: `pshop-row-line${tone ? ` is-${tone}` : ''}`,
    }, [el('span', { text: label }), el('b', { text: value })])

    /*
       The ledger CANNOT push the buttons below off screen — the third shop
       problem the owner hit at wave 24: 34 items plus 14-odd stat rows ran
       the panel past the bottom of a 1366x768 window with no way to reach
       "BACK TO THE FIELD". Everything that can grow without bound (the
       ledger sections AND the stat rows — both scale with how long the run
       has gone on) lives inside `.pshop-counter-body`, which is the ONLY
       part of the counter with `overflow-y: auto`; the head above it and the
       feed/reroll/continue footer below it are outside that box and cannot
       scroll away. See shop.css's `.pshop-counter` for the max-height that
       makes this matter instead of decoration.
    */
    const body = el('div', { class: 'pshop-counter-body' })
    this.sheetEl.appendChild(body)

    /*
     * The ledger (docs/UPGRADE_ROSTER.md batch 5, part 1): the same builder
     * the pause screen reads, so "readable from the pause screen and the
     * shop" is one fact rather than two screens each keeping their own copy.
     * Weapon rows print H12's mods by name; class cards get their own
     * section; everything else prints its stack footer, n/N.
     */
    const ledger = buildLedger(p)
    body.appendChild(el('div', {
      class: 'pshop-section',
      text: `WEAPONS ${ledger.weapons.length}/6`,
    }))
    body.appendChild(rows(ledger.weapons.map((w) =>
      line(w.name, w.mods.length > 0 ? `T${w.tier} · ${w.mods.join(', ')}` : `T${w.tier}`))))

    if (ledger.classCards.length > 0) {
      body.appendChild(el('div', { class: 'pshop-section', text: 'CLASS CARDS' }))
      body.appendChild(rows(ledger.classCards.map((name) => line(name, '✓'))))
    }

    if (ledger.items.length > 0) {
      body.appendChild(el('div', { class: 'pshop-section', text: 'CARRYING' }))
      body.appendChild(rows(ledger.items.map((it) => line(it.name, it.stack || '·'))))
    }

    // Hover preview resolves the hovered card against the live build.
    let preview: DerivedStats | null = null
    if (this.hovered && Object.keys(this.hovered.mods).length > 0) {
      previewDelta(p.statSources, this.hovered.mods, this.scratchA, this.scratchB)
      preview = this.scratchB
    }

    body.appendChild(el('div', { class: 'pshop-section', text: 'STATS' }))
    const statLines: HTMLElement[] = []
    for (const key of STAT_KEYS) {
      const value = p.stats[key]
      const changedThisWave = this.opening[key] !== value
      const previewed = preview !== null && preview[key] !== value
      // A stat you have none of is hidden, so the panel stays a build sheet
      // rather than a table of zeroes — but NOT when the card under the cursor
      // would give you some. "This is the thing that gets you luck at all" is
      // the most interesting answer this panel has, and it was the one row it
      // could never show.
      if (value === 0 && key !== 'maxHp' && !previewed) continue
      statLines.push(line(
        STAT_LABELS[key],
        previewed
          ? `${fmtStat(key, value)} → ${fmtStat(key, preview![key])}`
          : fmtStat(key, value),
        previewed ? 'preview' : changedThisWave ? 'changed' : undefined,
      ))
    }
    body.appendChild(rows(statLines))

    const foot = el('div', { class: 'pshop-counter-foot' })
    foot.appendChild(el('div', { class: 'pshop-dash' }))
    this.feedEl.textContent = `FEED ${p.feed}`
    foot.appendChild(this.feedEl)
    foot.appendChild(this.rerollBtn)
    foot.appendChild(el('button', {
      class: 'pshop-btn',
      text: 'BACK TO THE FIELD',
      onClick: () => this.finish(),
    }))
    this.sheetEl.appendChild(foot)
  }

  destroy(): void {
    this.root.remove()
  }
}
