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
import { STAT_KEYS, STAT_LABELS, WEAPONS } from '../content'
import type { Offer, OfferPool } from '../sim/offers'
import type { World } from '../sim/world'
import { emptyDerived, previewDelta, type DerivedStats } from '../sim/stats'
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
    this.cardsEl = el('div', { class: 'cards' })
    this.sheetEl = el('div', { class: 'sheet' })
    this.feedEl = el('div', { class: 'card-cost' })
    this.subtitle = el('h2', { text: '' })
    this.rerollBtn = el('button', { class: 'btn', text: 'Reroll', onClick: () => this.reroll() })

    this.root = el('div', { class: 'screen' }, [
      el('div', { class: 'screen-inner' }, [
        el('h1', { text: 'THE SHOP' }),
        this.subtitle,
        el('div', { class: 'row' }, [
          el('div', {}, [
            this.cardsEl,
            el('div', { class: 'actions' }, [
              this.rerollBtn,
              el('button', {
                class: 'btn primary',
                text: 'Back to work →',
                onClick: () => this.finish(),
              }),
            ]),
            this.feedEl,
          ]),
          this.sheetEl,
        ]),
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

  private render(): void {
    const world = this.world
    if (!world) return
    clear(this.cardsEl)

    this.offers.forEach((offer, i) => {
      if (!offer) return
      const affordable = world.player.feed >= offer.cost
      const isLocked = this.locked[i] !== null
      const card = el('div', {
        class: `card rarity-${offer.rarity}${affordable ? '' : ' unaffordable'}${isLocked ? ' locked' : ''}`,
        onClick: () => this.buy(i),
      }, [
        el('div', { class: 'card-key', text: offer.kind }),
        el('div', { class: 'card-name', text: offer.name }),
        el('div', { class: 'card-detail', text: offer.detail }),
      ])

      const deltas = this.deltaLines(offer)
      if (deltas.length > 0) {
        card.appendChild(el('div', { class: 'card-delta' }, deltas.map((d) => el('div', { text: d }))))
      }

      card.appendChild(el('div', { class: 'card-cost', text: `${offer.cost} feed` }))
      card.appendChild(el('button', {
        class: 'card-lock',
        text: isLocked ? 'Locked ✓' : 'Lock',
        onClick: (e) => {
          e.stopPropagation()
          this.toggleLock(i)
        },
      }))

      card.addEventListener('mouseenter', () => {
        this.hovered = offer
        this.renderSheet()
      })
      card.addEventListener('mouseleave', () => {
        this.hovered = null
        this.renderSheet()
      })

      this.cardsEl.appendChild(card)
    })

    const cost = shopRerollCost(this.rerollsThisShop)
    this.rerollBtn.textContent = `Reroll (${cost} feed)`
    this.rerollBtn.disabled = world.player.feed < cost
    this.feedEl.textContent = `${world.player.feed} feed`
    this.renderSheet()
  }

  private deltaLines(offer: Offer): string[] {
    const world = this.world
    if (!world || Object.keys(offer.mods).length === 0) return []
    const changes = previewDelta(world.player.statSources, offer.mods, this.scratchA, this.scratchB)
    return changes.map((c) => `${STAT_LABELS[c.key]} ${fmtStat(c.key, c.from)} → ${fmtStat(c.key, c.to)}`)
  }

  /** Live character sheet: slots, passives, and the full stat block. */
  private renderSheet(): void {
    const world = this.world
    if (!world) return
    const p = world.player
    clear(this.sheetEl)

    this.sheetEl.appendChild(el('h3', { text: p.def.name }))

    this.sheetEl.appendChild(el('h3', { text: `Weapons (${p.weapons.length}/6)` }))
    for (const slot of p.weapons) {
      this.sheetEl.appendChild(el('div', { class: 'sheet-row' }, [
        el('span', { text: WEAPONS[slot.id]?.name ?? slot.id }),
        el('span', { text: `T${slot.tier}` }),
      ]))
    }

    if (p.items.length > 0) {
      this.sheetEl.appendChild(el('h3', { text: 'Passives' }))
      const counts = new Map<string, number>()
      for (const id of p.items) counts.set(id, (counts.get(id) ?? 0) + 1)
      for (const [id, n] of counts) {
        this.sheetEl.appendChild(el('div', { class: 'sheet-row' }, [
          el('span', { text: id }),
          el('span', { text: n > 1 ? `x${n}` : '' }),
        ]))
      }
    }

    // Hover preview resolves the hovered card against the live build.
    let preview: DerivedStats | null = null
    if (this.hovered && Object.keys(this.hovered.mods).length > 0) {
      previewDelta(p.statSources, this.hovered.mods, this.scratchA, this.scratchB)
      preview = this.scratchB
    }

    this.sheetEl.appendChild(el('h3', { text: 'Stats' }))
    for (const key of STAT_KEYS) {
      const value = p.stats[key]
      if (value === 0 && key !== 'maxHp') continue
      const changedThisWave = this.opening[key] !== value
      const previewed = preview && preview[key] !== value
      const row = el('div', { class: `sheet-row${changedThisWave || previewed ? ' changed' : ''}` }, [
        el('span', { text: STAT_LABELS[key] }),
        el('span', {
          text: previewed
            ? `${fmtStat(key, value)} → ${fmtStat(key, preview![key])}`
            : fmtStat(key, value),
        }),
      ])
      this.sheetEl.appendChild(row)
    }
  }

  destroy(): void {
    this.root.remove()
  }
}
