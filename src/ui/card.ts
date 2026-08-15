/**
 * The card. One object, reused by the level-up, the shop, the Homestead and
 * class select.
 *
 * The design handoff's instruction was "one card, correct, then reuse it", and
 * the reason is not just consistency: four screens each inventing a card is how
 * the previous UI ended up reading as four UIs that shipped together. Anything
 * that differs between screens is a flag on this function, not a second card.
 *
 * Rarity is never hardcoded here. The tier's colour, ink and pip count come
 * from `rarity.json` through `RARITY`, and are handed to CSS as custom
 * properties on the plate — so retuning a tier is a content edit.
 */
import { RARITY, type RarityTier } from '../content'
import { el } from './dom'
import { spriteEl } from './sprite'

export interface CardStat {
  label: string
  value: string
  /** Drives the green/red split. Neutral when omitted. */
  tone?: 'gain' | 'cost'
}

export interface CardSpec {
  /** The band across the top: WEAPON, ITEM, CLASS, UPGRADE… */
  kind: string
  name: string
  blurb?: string
  /** Atlas key for the art window. */
  sprite?: string
  /** Integer zoom for the sprite. Cards may zoom freely; the field may not. */
  zoom?: number
  rarity?: string
  stats?: CardStat[]
  /** Footer left slot. The design calls it a lot number. */
  lot?: string
  /** Footer right slot — where the card came from, or its price. */
  source?: string
  /** Shop and Homestead: the price, rendered in the footer. */
  price?: number
  /** What the price is denominated in. Feed in the shop, acres at the Homestead. */
  priceUnit?: string
  /**
   * A plain tin plate carrying this many pips, for a surface that has a RANK
   * rather than a rarity — the Homestead's purchase cards, per the design:
   * "rank pips instead of a rarity tier". Ignored when `rarity` is set; a card
   * has one plate.
   */
  pips?: number
  affordable?: boolean
  selected?: boolean
  /** Unaffordable or locked: unprinted stock rather than disabled chrome. */
  dead?: boolean
  /** Shop: this card is held for the next visit. */
  clipped?: boolean
  onClick?: () => void
}

/** The plate: colour, the tier spelled out, and `rank` pips either side. */
function plate(rarity: string): HTMLElement | null {
  const tier = RARITY[rarity] as RarityTier | undefined
  if (!tier) return null

  const p = el('div', { class: `pcard-plate${tier.foil ? ' is-legendary' : ''}` })
  // Content drives the colour; CSS only knows the variable names.
  p.style.setProperty('--tier-colour', tier.colour)
  p.style.setProperty('--tier-dark', tier.dark)
  p.style.setProperty('--tier-ink', tier.ink)

  const pips = (): HTMLElement => {
    const wrap = el('div', { class: 'pcard-pips' })
    for (let i = 0; i < tier.rank; i++) wrap.append(el('div', { class: 'pcard-pip' }))
    return wrap
  }

  p.append(
    el('div', { class: 'pcard-rivet left' }),
    pips(),
    el('div', { class: 'pcard-plate-name', text: tier.name }),
    pips(),
    el('div', { class: 'pcard-rivet right' }),
  )
  return p
}

/**
 * The same tin, carrying a RANK rather than a tier.
 *
 * The Homestead's purchases have no rarity — a rank of the Feed Store is not
 * rare, it is your third one — so the design puts pips on a plain plate there
 * instead. Same stamped metal, same position, no colour claim.
 */
function rankPlate(pips?: number): HTMLElement | null {
  if (!pips || pips < 1) return null
  const p = el('div', { class: 'pcard-plate is-rank' })
  const wrap = el('div', { class: 'pcard-pips' })
  for (let i = 0; i < pips; i++) wrap.append(el('div', { class: 'pcard-pip' }))
  p.append(
    el('div', { class: 'pcard-rivet left' }),
    wrap,
    el('div', { class: 'pcard-rivet right' }),
  )
  return p
}

/** Build one card. Returns a button so it is focusable and keyboard-operable. */
export function card(spec: CardSpec): HTMLElement {
  const classes = ['pcard']
  if (spec.selected) classes.push('is-selected')
  if (spec.affordable) classes.push('is-affordable')
  if (spec.dead) classes.push('is-dead')

  const root = el('button', { class: classes.join(' ') })
  root.type = 'button'
  if (spec.onClick) root.onclick = () => spec.onClick?.()
  if (spec.dead) root.disabled = true

  const tab = el('div', { class: 'pcard-tab' })
  tab.append(el('div', { class: 'pcard-punch' }))
  root.append(tab)
  if (spec.clipped) root.append(el('div', { class: 'pcard-clip' }))

  root.append(el('div', { class: 'pcard-kind', text: spec.kind }))

  const window = el('div', { class: 'pcard-window' })
  const art = spec.sprite ? spriteEl(spec.sprite, 96, spec.zoom) : null
  if (art) window.append(art)
  root.append(window)

  const pl = spec.rarity ? plate(spec.rarity) : rankPlate(spec.pips)
  if (pl) root.append(pl)

  root.append(el('div', { class: 'pcard-name', text: spec.name }))
  if (spec.blurb) root.append(el('div', { class: 'pcard-blurb', text: spec.blurb }))

  if (spec.stats?.length) {
    root.append(el('div', { class: 'pcard-perf' }))
    const stats = el('div', { class: 'pcard-stats' })
    spec.stats.forEach((s, i) => {
      const row = el('div', { class: 'pcard-stat' })
      // Staggered against the card's own deal, so the rows fill in after it lands.
      row.style.animationDelay = `${260 + i * 50}ms`
      row.append(
        el('div', { class: 'pcard-stat-label', text: s.label }),
        el('div', { class: `pcard-stat-value${s.tone ? ` ${s.tone}` : ''}`, text: s.value }),
      )
      stats.append(row)
    })
    root.append(stats)
  }

  const foot = el('div', { class: 'pcard-foot' })
  foot.append(el('div', { text: spec.lot ?? '' }))
  if (typeof spec.price === 'number') {
    foot.append(el('div', {
      class: 'pcard-price',
      text: `${spec.price} ${spec.priceUnit ?? 'feed'}`,
    }))
  } else {
    foot.append(el('div', { text: spec.source ?? '' }))
  }
  root.append(foot)

  return root
}

/**
 * Deal a set of cards in, staggered.
 *
 * Applied after the nodes are in the DOM rather than baked into the class, so a
 * screen that re-renders without a deal (a shop reroll of one slot) does not
 * replay the whole animation.
 */
export function deal(cards: readonly HTMLElement[]): void {
  cards.forEach((c, i) => {
    c.style.setProperty('--deal-delay', `${i * 110}ms`)
    c.classList.add('is-dealing')
  })
}

/** A stable, meaningless-but-consistent lot number, for the footer. */
export function lotOf(id: string): string {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return `LOT ${String(h % 90 + 10)}`
}
