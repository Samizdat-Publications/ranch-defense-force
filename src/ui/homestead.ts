/**
 * The Homestead (§4, §12): four buildings you spend acres in.
 *
 * Laid out as buildings rather than tabs because the spec asks for a farmyard,
 * and because four named places are easier to hold in your head between runs
 * than four tab labels. Inside each is a plain grid of purchase cards — name,
 * effect, cost, owned rank.
 *
 * The one rule that carries the screen: **anything affordable gets a warm
 * outline.** That is what lets it answer "what can I buy right now" without
 * reading a word, which is the question a player actually arrives with.
 *
 * This screen only ever mutates the save through `meta.ts` helpers, and writes
 * after every purchase. A crash between buying and leaving must not cost the
 * player the thing they just bought.
 */
import { CLASSES, ITEMS, META, WEAPONS } from '../content'
import type { Save } from '../sim/save'
import { save as writeSave } from '../sim/save'
import {
  FEED_TRACKS, feedStoreCost, metaStats, catalogOffers, bunkhouseOffers,
  isClassUnlocked, maxTier, tierConfig, spend,
} from '../sim/meta'
import { clear, el } from './dom'
import { spriteEl } from './sprite'

type Building = 'bunkhouse' | 'catalog' | 'feed' | 'fair'

const BUILDINGS: { id: Building; name: string; blurb: string; icon: string }[] = [
  { id: 'catalog', name: 'The Seed Catalog', blurb: 'More of the roster in every run.', icon: 'weapon.grainLure' },
  { id: 'feed', name: 'The Feed Store', blurb: 'Permanent stats. Capped, on purpose.', icon: 'pickup.feed' },
  { id: 'bunkhouse', name: 'The Bunkhouse', blurb: 'Who you take out there.', icon: 'hand.idle.down.0' },
  { id: 'fair', name: 'The County Fair', blurb: 'Harder ground, richer ground.', icon: 'weapon.scythe.t3' },
]

const FEED_LABELS: Record<string, { name: string; blurb: string; unit: string }> = {
  maxHp: { name: 'Full Larder', blurb: 'You start every run with more to lose.', unit: 'max hp' },
  moveSpeedPct: { name: 'Broken-In Boots', blurb: 'You get out of the way sooner.', unit: '% move speed' },
  armor: { name: 'Canvas Apron', blurb: 'Every hit lands a little lighter.', unit: 'armor' },
  harvestPct: { name: 'Sharp Tools', blurb: 'Rocks and trees give up faster.', unit: '% harvest' },
  luck: { name: 'Rabbit Foot', blurb: 'Better cards, rarer drops.', unit: 'luck' },
}

export class HomesteadScreen {
  private readonly root: HTMLElement
  private readonly acresEl: HTMLElement
  private readonly bodyEl: HTMLElement
  private readonly titleEl: HTMLElement

  private profile: Save | null = null
  private onLeave: (() => void) | null = null
  private onTier: ((tier: number) => void) | null = null
  private tier = 1
  private where: Building | null = null

  constructor(parent: HTMLElement) {
    this.root = el('div', { class: 'screen homestead' })
    this.root.style.display = 'none'

    const head = el('div', { class: 'homestead-head' })
    this.titleEl = el('h1', { class: 'homestead-title' })
    this.titleEl.textContent = 'The Homestead'
    this.acresEl = el('div', { class: 'homestead-acres' })
    head.append(this.titleEl, this.acresEl)

    this.bodyEl = el('div', { class: 'homestead-body' })

    const foot = el('div', { class: 'homestead-foot' })
    const back = el('button', { class: 'btn' })
    back.textContent = '← Back'
    back.onclick = () => {
      if (this.where === null) this.onLeave?.()
      else { this.where = null; this.render() }
    }
    const out = el('button', { class: 'btn btn-primary' })
    out.textContent = 'Head out →'
    out.onclick = () => this.onLeave?.()
    foot.append(back, out)

    this.root.append(head, this.bodyEl, foot)
    parent.append(this.root)
  }

  get isOpen(): boolean {
    return this.root.style.display !== 'none'
  }

  open(profile: Save, tier: number, onTier: (t: number) => void, onLeave: () => void): void {
    this.profile = profile
    this.tier = tier
    this.onTier = onTier
    this.onLeave = onLeave
    this.where = null
    this.root.style.display = ''
    this.render()
  }

  close(): void {
    this.root.style.display = 'none'
  }

  /** Buy, persist, redraw. Persisting per purchase, not on exit, is deliberate. */
  private buy(cost: number, apply: (s: Save) => void): void {
    const s = this.profile
    if (!s || !spend(s, cost)) return
    apply(s)
    writeSave(s)
    this.render()
  }

  private render(): void {
    const s = this.profile
    if (!s) return
    this.acresEl.textContent = `${s.acres} acres · Tier ${this.tier}`
    this.titleEl.textContent = this.where
      ? (BUILDINGS.find((b) => b.id === this.where)?.name ?? 'The Homestead')
      : 'The Homestead'
    clear(this.bodyEl)
    if (this.where === null) this.renderYard()
    else if (this.where === 'catalog') this.renderCatalog(s)
    else if (this.where === 'feed') this.renderFeedStore(s)
    else if (this.where === 'bunkhouse') this.renderBunkhouse(s)
    else this.renderFair(s)
  }

  private renderYard(): void {
    const grid = el('div', { class: 'homestead-yard' })
    for (const b of BUILDINGS) {
      const card = el('button', { class: 'panel building' })
      const icon = spriteEl(b.icon, 48)
      if (icon) card.append(icon)
      const name = el('div', { class: 'building-name' })
      name.textContent = b.name
      const blurb = el('div', { class: 'building-blurb' })
      blurb.textContent = b.blurb
      card.append(name, blurb)
      card.onclick = () => { this.where = b.id; this.render() }
      grid.append(card)
    }
    this.bodyEl.append(grid)
  }

  /**
   * One purchase card. `affordable` drives the warm outline that is the whole
   * navigational trick of this screen.
   */
  private card(opts: {
    name: string
    blurb: string
    cost: number | null
    owned?: string
    icon?: string
    affordable: boolean
    onBuy?: () => void
    locked?: boolean
  }): HTMLElement {
    const c = el('div', { class: 'panel buy-card' })
    if (opts.affordable) c.classList.add('affordable')
    if (opts.locked) c.classList.add('silhouette')
    const icon = opts.icon ? spriteEl(opts.icon, 40) : null
    if (icon) c.append(icon)
    const name = el('div', { class: 'buy-name' })
    name.textContent = opts.name
    const blurb = el('div', { class: 'buy-blurb' })
    blurb.textContent = opts.blurb
    c.append(name, blurb)
    if (opts.owned) {
      const owned = el('div', { class: 'buy-owned' })
      owned.textContent = opts.owned
      c.append(owned)
    }
    if (opts.cost === null) {
      const done = el('div', { class: 'buy-cost buy-done' })
      done.textContent = 'Owned'
      c.append(done)
    } else {
      const btn = el('button', { class: 'btn buy-cost' })
      btn.textContent = `${opts.cost} acres`
      btn.disabled = !opts.affordable
      btn.onclick = () => opts.onBuy?.()
      c.append(btn)
    }
    return c
  }

  private grid(children: HTMLElement[], empty: string): void {
    if (children.length === 0) {
      const none = el('div', { class: 'homestead-empty' })
      none.textContent = empty
      this.bodyEl.append(none)
      return
    }
    const g = el('div', { class: 'buy-grid' })
    g.append(...children)
    this.bodyEl.append(g)
  }

  private renderCatalog(s: Save): void {
    const note = el('div', { class: 'homestead-note' })
    note.textContent = 'Unlocks join every future run’s pool. Wider, not stronger.'
    this.bodyEl.append(note)

    const cards = catalogOffers(s).map((o) => {
      const def = o.kind === 'weapon' ? WEAPONS[o.id] : ITEMS[o.id]
      const blurb = typeof def?.blurb === 'string' ? def.blurb : o.kind
      const icon = o.kind === 'weapon'
        ? (def as { sprite?: string })?.sprite
        : (def as { cardSprite?: string; icon?: string })?.cardSprite
          ?? (def as { icon?: string })?.icon
      return this.card({
        name: o.name,
        blurb,
        cost: o.cost,
        icon,
        affordable: s.acres >= o.cost,
        onBuy: () => this.buy(o.cost, (sv) => { sv.unlockedPool = [...sv.unlockedPool, o.id] }),
      })
    })
    this.grid(cards, 'Everything in the catalog is already yours.')
  }

  private renderFeedStore(s: Save): void {
    const m = metaStats(s)
    const cap = (META as unknown as { feedStore: { totalEffectCapPct: number; ranks: number } }).feedStore
    const note = el('div', { class: 'homestead-note' })
    note.textContent =
      `Permanent, and hard-capped near +${cap.totalEffectCapPct}% overall. `
      + `Now: +${m.maxHp} hp, +${m.moveSpeedPct}% speed, +${m.armor} armor, `
      + `+${m.harvestPct}% harvest, +${m.luck} luck.`
    this.bodyEl.append(note)

    const cards = FEED_TRACKS.map((t) => {
      const label = FEED_LABELS[t] ?? { name: t, blurb: '', unit: t }
      const owned = s.feedStoreRanks[t] ?? 0
      const cost = feedStoreCost(s, t)
      const per = (META as unknown as { feedStore: { tracks: Record<string, number> } }).feedStore.tracks[t]
      return this.card({
        name: label.name,
        blurb: `${label.blurb} +${per} ${label.unit} per rank.`,
        cost,
        owned: `Rank ${owned} / ${cap.ranks}`,
        affordable: cost !== null && s.acres >= cost,
        onBuy: () => cost !== null && this.buy(cost, (sv) => {
          sv.feedStoreRanks = { ...sv.feedStoreRanks, [t]: (sv.feedStoreRanks[t] ?? 0) + 1 }
        }),
      })
    })
    this.grid(cards, '')
  }

  private renderBunkhouse(s: Save): void {
    const note = el('div', { class: 'homestead-note' })
    note.textContent = 'A new hand changes how a run opens, not how strong it ends.'
    this.bodyEl.append(note)

    const cards: HTMLElement[] = []
    for (const id of Object.keys(CLASSES)) {
      const def = CLASSES[id] as { name?: string; blurb?: string }
      if (isClassUnlocked(s, id)) {
        cards.push(this.card({
          name: def.name ?? id,
          blurb: def.blurb ?? 'Ready to work.',
          cost: null,
          icon: `${id}.idle.down.0`,
          affordable: false,
        }))
      }
    }
    // Locked classes render as solid dark silhouettes with their price, never
    // as empty slots — you should be able to see what is up there from day one.
    for (const o of bunkhouseOffers(s)) {
      cards.push(this.card({
        name: o.name,
        blurb: 'Not yet hired.',
        cost: o.cost,
        icon: `${o.id}.idle.down.0`,
        locked: true,
        affordable: s.acres >= o.cost,
        onBuy: () => this.buy(o.cost, (sv) => { sv.unlockedClasses = [...sv.unlockedClasses, o.id] }),
      }))
    }
    this.grid(cards, '')
  }

  private renderFair(s: Save): void {
    const max = maxTier(s)
    const note = el('div', { class: 'homestead-note' })
    note.textContent = max > s.tierCleared + 1
      ? 'Clear a tier to open the next one.'
      : 'Each tier pays more. Climbing beats farming.'
    this.bodyEl.append(note)

    const cards: HTMLElement[] = []
    for (let t = 1; t <= max; t++) {
      const cfg = tierConfig(t)
      const chosen = t === this.tier
      const c = el('div', { class: 'panel buy-card' })
      if (chosen) c.classList.add('affordable')
      const name = el('div', { class: 'buy-name' })
      name.textContent = `Tier ${t}`
      const blurb = el('div', { class: 'buy-blurb' })
      blurb.textContent = cfg
        ? `+${cfg.enemyHpPct}% enemy hp. ${cfg.modifier}`
        : 'The Whitacre place as it stands.'
      const owned = el('div', { class: 'buy-owned' })
      owned.textContent = cfg ? `${cfg.acreMultiplier}x acres` : '1x acres'
      const btn = el('button', { class: 'btn buy-cost' })
      btn.textContent = chosen ? 'Selected' : 'Select'
      btn.disabled = chosen
      btn.onclick = () => { this.tier = t; this.onTier?.(t); this.render() }
      c.append(name, blurb, owned, btn)
      cards.push(c)
    }
    this.grid(cards, '')
  }
}
