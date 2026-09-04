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
import { ITEMS, STAT_KEYS, STAT_LABELS, WEAPONS } from '../content'
import { stackLabel, type Offer, type OfferPool } from '../sim/offers'
import type { World } from '../sim/world'
import { emptyDerived, previewDelta, type DerivedStats } from '../sim/stats'
import { card, deal, lotOf } from './card'
import { interestOn, shopRerollCost } from '../sim/formulas'
import { clear, el, fmtStat } from './dom'

const SLOTS = 4

export class ShopScreen {
  private readonly root: HTMLElement
  private readonly cardsEl: HTMLElement
  private readonly sheetEl: HTMLElement
  private readonly rerollBtn: HTMLButtonElement
  private readonly feedEl: HTMLElement
  private readonly subtitle: HTMLElement

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

    // Interest on unspent feed, paid on arrival (§3).
    const interest = interestOn(world.player.feed)
    world.player.feed += interest
    this.subtitle.textContent = interest > 0
      ? `After wave ${world.spawner.wave - 1} · +${interest} feed interest`
      : `After wave ${world.spawner.wave - 1}`

    // Snapshot the stat block so the sheet can mark what changed.
    Object.assign(this.opening, world.player.stats)

    this.offers = []
    for (let i = 0; i < SLOTS; i++) this.offers.push(this.locked[i])
    this.fillEmptySlots()
    this.render()
    this.root.style.display = ''
  }

  private fillEmptySlots(): void {
    const world = this.world
    const pool = this.pool
    if (!world || !pool) return
    const needed = this.offers.filter((o) => o === null).length
    if (needed === 0) return
    const fresh = pool.draw(world.player, needed, world.elapsed, world.player.stats.luck)
    let f = 0
    for (let i = 0; i < SLOTS; i++) {
      if (this.offers[i] === null) this.offers[i] = fresh[f++] ?? null
    }
  }

  private reroll(): void {
    const world = this.world
    if (!world) return
    const cost = shopRerollCost(this.rerollsThisShop)
    if (world.player.feed < cost) return
    world.player.feed -= cost
    this.rerollsThisShop++
    for (let i = 0; i < SLOTS; i++) {
      if (this.locked[i] === null) this.offers[i] = null
    }
    this.fillEmptySlots()
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
    this.fillEmptySlots()
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
        kind: offer.kind,
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

    const cost = shopRerollCost(this.rerollsThisShop)
    this.rerollBtn.textContent = `REROLL · ${cost}`
    this.rerollBtn.disabled = world.player.feed < cost
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

    this.sheetEl.appendChild(el('div', {
      class: 'pshop-section',
      text: `WEAPONS ${p.weapons.length}/6`,
    }))
    this.sheetEl.appendChild(rows(p.weapons.map((slot) =>
      line(WEAPONS[slot.id]?.name ?? slot.id, `T${slot.tier}`))))

    if (p.items.length > 0) {
      const counts = new Map<string, number>()
      // A boosted copy counts as two, which is exactly how it resolves.
      for (const owned of p.items) {
        counts.set(owned.id, (counts.get(owned.id) ?? 0) + (owned.boosted ? 2 : 1))
      }
      this.sheetEl.appendChild(el('div', { class: 'pshop-section', text: 'CARRYING' }))
      this.sheetEl.appendChild(rows([...counts].map(([id, n]) =>
        line(ITEMS[id]?.name ?? id, n > 1 ? `x${n}` : '·'))))
    }

    // Hover preview resolves the hovered card against the live build.
    let preview: DerivedStats | null = null
    if (this.hovered && Object.keys(this.hovered.mods).length > 0) {
      previewDelta(p.statSources, this.hovered.mods, this.scratchA, this.scratchB)
      preview = this.scratchB
    }

    this.sheetEl.appendChild(el('div', { class: 'pshop-section', text: 'STATS' }))
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
    this.sheetEl.appendChild(rows(statLines))

    this.sheetEl.appendChild(el('div', { class: 'pshop-dash' }))
    this.feedEl.textContent = `FEED ${p.feed}`
    this.sheetEl.appendChild(this.feedEl)
    this.sheetEl.appendChild(this.rerollBtn)
    this.sheetEl.appendChild(el('button', {
      class: 'pshop-btn',
      text: 'BACK TO THE FIELD',
      onClick: () => this.finish(),
    }))
  }

  destroy(): void {
    this.root.remove()
  }
}
