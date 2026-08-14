/**
 * Level-up screen (§12). The game freezes, three cards slide up staggered, and
 * keys 1-3 pick.
 *
 * The delta line is the load-bearing detail: a player who can't see what a card
 * did won't feel the upgrade, so every stat a card moves is written out as
 * "from → to" against the live build, not as the raw modifier.
 */
import { STAT_LABELS, WAVES } from '../content'
import type { Offer } from '../sim/offers'
import type { OfferPool } from '../sim/offers'
import type { World } from '../sim/world'
import { emptyDerived, previewDelta } from '../sim/stats'
import { LEVEL_REROLL_COST } from '../sim/formulas'
import { card, deal, lotOf } from './card'
import { clear, el, fmtStat } from './dom'

export class LevelUpScreen {
  private readonly root: HTMLElement
  private readonly cardsEl: HTMLElement
  private readonly rerollBtn: HTMLButtonElement
  private readonly subtitle: HTMLElement
  private offers: Offer[] = []
  private onPick: ((o: Offer) => void) | null = null
  private world: World | null = null
  private pool: OfferPool | null = null

  private readonly scratchA = emptyDerived()
  private readonly scratchB = emptyDerived()

  constructor(parent: HTMLElement) {
    this.cardsEl = el('div', { class: 'cards' })
    this.subtitle = el('h2', { text: '' })
    this.rerollBtn = el('button', {
      class: 'btn',
      text: `Reroll (${LEVEL_REROLL_COST} feed)`,
      onClick: () => this.reroll(),
    })

    this.root = el('div', { class: 'screen' }, [
      el('div', { class: 'screen-inner' }, [
        el('h1', { text: 'LEVEL UP' }),
        this.subtitle,
        this.cardsEl,
        el('div', { class: 'actions' }, [this.rerollBtn]),
      ]),
    ])
    this.root.style.display = 'none'
    parent.appendChild(this.root)
  }

  get visible(): boolean {
    return this.root.style.display !== 'none'
  }

  open(world: World, pool: OfferPool, onPick: (o: Offer) => void): void {
    this.world = world
    this.pool = pool
    this.onPick = onPick
    this.subtitle.textContent = `Level ${world.player.level} · pick one`
    this.drawOffers()
    this.root.style.display = ''
  }

  close(): void {
    this.root.style.display = 'none'
    this.onPick = null
  }

  private drawOffers(): void {
    const world = this.world
    const pool = this.pool
    if (!world || !pool) return
    const count = world.player.stats.luck >= 40
      ? WAVES.xp.cardsAtHighLuck
      : WAVES.xp.cardsPerLevel
    this.offers = pool.draw(world.player, count, world.elapsed, world.player.stats.luck, 'levelup')
    this.render()
  }

  private reroll(): void {
    const world = this.world
    if (!world || world.player.feed < LEVEL_REROLL_COST) return
    world.player.feed -= LEVEL_REROLL_COST
    this.drawOffers()
  }

  private render(): void {
    const world = this.world
    if (!world) return
    clear(this.cardsEl)

    const built = this.offers.map((offer, i) => {
      const c = card({
        kind: `[${i + 1}]  ${offer.kind}${offer.boosted ? ' · 2x' : ''}`,
        name: offer.name,
        blurb: offer.detail,
        sprite: offer.sprite,
        rarity: offer.rarity,
        stats: this.deltaLines(offer).map((d) => {
          // "Attack speed 12% -> 24%" splits on the last space run before the
          // arrow; the label is everything up to the first digit or sign.
          const m = /^(.*?)\s+([-+\d].*)$/.exec(d)
          const raw = m ? m[2] : d
          return {
            label: m ? m[1] : d,
            value: raw,
            tone: raw.includes('-') && !raw.includes('->') ? 'cost' as const : 'gain' as const,
          }
        }),
        lot: lotOf(offer.id),
        source: offer.kind === 'weapon' ? 'WEAPON' : 'ITEM',
        onClick: () => this.pick(offer),
      })
      this.cardsEl.appendChild(c)
      return c
    })
    deal(built)

    this.rerollBtn.disabled = world.player.feed < LEVEL_REROLL_COST
    this.rerollBtn.textContent = `Reroll (${LEVEL_REROLL_COST} feed · have ${world.player.feed})`
  }

  /** "Attack speed 12% → 24%" for everything the card moves. */
  private deltaLines(offer: Offer): string[] {
    const world = this.world
    if (!world || Object.keys(offer.mods).length === 0) return []
    const changes = previewDelta(world.player.statSources, offer.mods, this.scratchA, this.scratchB)
    return changes.map((c) => `${STAT_LABELS[c.key]} ${fmtStat(c.key, c.from)} → ${fmtStat(c.key, c.to)}`)
  }

  private pick(offer: Offer): void {
    const cb = this.onPick
    this.close()
    cb?.(offer)
  }

  /** Number-key selection, routed from the input sampler. */
  handleDigit(n: number): void {
    if (!this.visible) return
    const offer = this.offers[n - 1]
    if (offer) this.pick(offer)
  }

  destroy(): void {
    this.root.remove()
  }
}
