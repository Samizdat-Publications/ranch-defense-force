/**
 * The Homestead (§4, §12): four buildings you spend acres in.
 *
 * Design draws it as **the yard at dusk with the four buildings standing in
 * it, each fronted by a staked sign** — so it is a place, like the title
 * screen, rather than a menu with a picture behind it.
 *
 * The backdrop is `scene.ts`'s BARN INTERIOR, and it used to be the yard.
 *
 * The yard was the mockup's composition and it was wrong for one reason that
 * nobody had said out loud: this screen is entered through the barn DOOR, from
 * either surface scene, and it then composed the yard again behind itself. The
 * player walked into a building and came out standing in front of it. `scene.ts`
 * builds the room on the other side of that door now -- one more `SceneKind`,
 * the same stage, the same `sceneSprite`/`groundActor` mechanics -- so the two
 * screens meet at a threshold instead of contradicting each other across it.
 *
 * It is also where eight generated assets finally land. Two stall fronts, a
 * divider, a loft edge, two hanging lanterns, a floor tile and a bolted ladder
 * were bought, claimed and packed sessions ago and drawn by nothing, waiting on
 * exactly this scene: nine rows of the ledger's open queue, closed by building
 * the one thing they were all for.
 *
 * Whichever backdrop it is, it is `scene.ts`'s and not a second copy. Building
 * one here would leave two rooms to keep in step and they would drift the first
 * time either moved.
 *
 * The one rule that carries the screen, and which Design lists as having
 * earned its place: **anything affordable gets a warm outline.** That lets it
 * answer "what can I buy right now" without reading a word, which is the
 * question a player actually arrives with.
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
import { card, deal } from './card'
import { buildScene } from './scene'

type Building = 'bunkhouse' | 'catalog' | 'feed' | 'fair'

// All four signs are generated art now. They used to borrow — a grain lure for
// the catalog, a feed pickup for the store, the player's own head for the
// bunkhouse and a tier-3 scythe for the fair — which meant the Homestead read
// as four inventory items rather than four places you can walk into.
const BUILDINGS: { id: Building; name: string; blurb: string; icon: string }[] = [
  { id: 'catalog', name: 'The Seed Catalog', blurb: 'More of the roster in every run.', icon: 'meta.seedCatalog' },
  { id: 'feed', name: 'The Feed Store', blurb: 'Permanent stats. Capped, on purpose.', icon: 'meta.feedStore' },
  { id: 'bunkhouse', name: 'The Bunkhouse', blurb: 'Who you take out there.', icon: 'meta.bunkhouse' },
  { id: 'fair', name: 'The County Fair', blurb: 'Harder ground, richer ground.', icon: 'meta.countyFair' },
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

  /** The scene, so it can be rebuilt when the atlas resolves. */
  private readonly sceneEl: HTMLElement
  private readonly footNote: HTMLElement

  constructor(parent: HTMLElement) {
    this.root = el('div', { class: 'screen phome' })
    this.root.style.display = 'none'

    this.sceneEl = el('div', { class: 'phome-scene' }, [buildScene('barn')])

    this.titleEl = el('h1', { class: 'phome-title', text: 'The Homestead' })
    this.acresEl = el('div', { class: 'phome-acres' })
    const head = el('div', { class: 'phome-head' }, [
      el('div', {}, [
        el('div', { class: 'phome-eyebrow', text: 'BETWEEN RUNS' }),
        this.titleEl,
      ]),
      this.acresEl,
    ])

    this.bodyEl = el('div', {})

    // The rail carries the tier you are on, the credit the licence requires,
    // and the way out. A back that means two different things depending on
    // where you are standing is the one control this screen needs.
    this.footNote = el('span', { text: '' })
    const back = el('button', {
      text: '← BACK',
      onClick: () => {
        if (this.where === null) this.onLeave?.()
        else { this.where = null; this.render() }
      },
    })
    const out = el('button', { text: 'HEAD OUT →', onClick: () => this.onLeave?.() })
    const foot = el('div', { class: 'phome-foot' }, [
      back, this.footNote, el('span', { text: 'ART BY LIMEZU · LIMEZU.ITCH.IO' }), out,
    ])

    const ui = el('div', { class: 'phome-ui' }, [head, this.bodyEl, foot])
    this.root.append(el('div', { class: 'phome-stagewrap' }, [this.sceneEl, ui]))
    parent.append(this.root)

    this.fit()
    window.addEventListener('resize', () => this.fit())
  }

  /**
   * Fit the 1920x1080 stage inside the window, exactly as the home screen
   * does — `contain`, bled with the yard's own edge colours.
   */
  private fit(): void {
    this.root.style.setProperty(
      '--scene',
      String(Math.min(window.innerWidth / 1920, window.innerHeight / 1080)),
    )
  }

  /**
   * Rebuild the backdrop once the atlas resolves.
   *
   * Screens are constructed at module load and the atlas lands later, so the
   * first `buildScene` returns a sky with nothing standing in it. This is the
   * fourth screen to need this and it has been the cause of a blank render
   * every time it was forgotten.
   */
  refreshScene(): void {
    this.sceneEl.replaceChildren(buildScene('barn'))
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
    clear(this.acresEl)
    this.acresEl.append(
      el('div', { class: 'phome-acres-n', text: String(s.acres) }),
      el('div', { class: 'phome-acres-unit' }, [
        el('span', { text: 'ACRES' }), el('br'), el('span', { text: 'BANKED' }),
      ]),
    )
    this.titleEl.textContent = this.where
      ? (BUILDINGS.find((b) => b.id === this.where)?.name ?? 'The Homestead')
      : 'The Homestead'

    const cfg = tierConfig(this.tier)
    this.footNote.textContent = cfg
      ? `TIER ${this.tier} · ${cfg.acreMultiplier}× ACRES · +${cfg.enemyHpPct}% ENEMY HP`
      : `TIER ${this.tier} · 1× ACRES`

    clear(this.bodyEl)
    if (this.where === null) this.renderYard(s)
    else if (this.where === 'catalog') this.renderCatalog(s)
    else if (this.where === 'feed') this.renderFeedStore(s)
    else if (this.where === 'bunkhouse') this.renderBunkhouse(s)
    else this.renderFair(s)
  }

  /**
   * The four staked signs, standing in the yard.
   *
   * A sign is "open" — warm outline, gold footer board — when there is
   * something in that building you can afford right now. That is the affordable
   * rule applied one level up: the yard tells you where to walk before you have
   * walked anywhere.
   */
  private renderYard(s: Save): void {
    const signs = el('div', { class: 'phome-signs' })
    BUILDINGS.forEach((b, i) => {
      const state = this.buildingState(s, b.id)
      const board = el('div', { class: 'phome-sign-board' }, [
        el('div', { class: 'phome-sign-row' }, [
          el('div', { class: 'phome-sign-icon' }, [spriteEl(b.icon, 48)]),
          el('div', { style: { flex: '1' } }, [
            el('div', { class: 'phome-sign-name', text: b.name }),
            el('div', { class: 'phome-sign-count', text: state.count }),
          ]),
        ]),
        el('div', { class: 'phome-sign-blurb', text: b.blurb }),
      ])

      const sign = el('button', {
        class: `phome-sign${state.open ? ' is-open' : ''}`,
        onClick: () => { this.where = b.id; this.render() },
      }, [
        el('div', { class: 'phome-sign-drop' }, [
          board,
          el('div', { class: 'phome-sign-foot' }),
        ]),
        el('div', { class: 'phome-stake' }),
      ])
      sign.style.animationDelay = `${i * 90}ms`
      signs.append(sign)
    })
    this.bodyEl.append(signs)
  }

  /** What a building has in it, and whether any of it is affordable today. */
  private buildingState(s: Save, id: Building): { count: string; open: boolean } {
    if (id === 'catalog') {
      const offers = catalogOffers(s)
      return {
        count: offers.length ? `${offers.length} STILL LOCKED` : 'ALL YOURS',
        open: offers.some((o) => s.acres >= o.cost),
      }
    }
    if (id === 'feed') {
      const ranks = (META as unknown as { feedStore: { ranks: number } }).feedStore.ranks
      const held = FEED_TRACKS.reduce((n, t) => n + (s.feedStoreRanks[t] ?? 0), 0)
      return {
        count: `${held} / ${FEED_TRACKS.length * ranks} RANKS`,
        open: FEED_TRACKS.some((t) => {
          const c = feedStoreCost(s, t)
          return c !== null && s.acres >= c
        }),
      }
    }
    if (id === 'bunkhouse') {
      const offers = bunkhouseOffers(s)
      const hired = Object.keys(CLASSES).filter((c) => isClassUnlocked(s, c)).length
      return {
        count: `${hired} HIRED · ${offers.length} TO HIRE`,
        open: offers.some((o) => s.acres >= o.cost),
      }
    }
    const max = maxTier(s)
    // The Fair costs nothing, so "open" means there is a harder tier to pick.
    return { count: `TIER ${this.tier} OF ${max}`, open: max > this.tier }
  }

  /**
   * One purchase card.
   *
   * Design: "Purchase cards are the upgrade card cut down — same paper, same
   * tin plate, with rank pips instead of a rarity tier and the price on the
   * plate. Warm outline means you can afford it. Grey means come back later,
   * and the card still tells you what it does."
   *
   * So this is `card()`, not a fifth card object. The whole card is the buy
   * button — no separate control inside it, which is what the old one did and
   * which is also invalid HTML.
   */
  private card(opts: {
    kind: string
    name: string
    blurb: string
    cost: number | null
    owned?: string
    pips?: number
    icon?: string
    affordable: boolean
    onBuy?: () => void
    locked?: boolean
  }): HTMLElement {
    return card({
      kind: opts.kind,
      name: opts.name,
      blurb: opts.blurb,
      sprite: opts.icon,
      zoom: 2,
      pips: opts.pips,
      stats: opts.owned ? [{ label: 'OWNED', value: opts.owned }] : undefined,
      price: opts.cost ?? undefined,
      priceUnit: 'acres',
      source: opts.cost === null ? 'OWNED' : undefined,
      affordable: opts.affordable,
      // Grey is "come back later", never "broken" — and the card keeps telling
      // you what it does either way, which is the whole point of showing a
      // locked class at all.
      dead: opts.cost !== null && !opts.affordable,
      onClick: opts.onBuy,
    })
  }

  /**
   * The room you walked into: a note, then the cards, over a darkened yard.
   *
   * The yard stays behind it rather than being replaced. You are inside a
   * building on the place, not on a different screen, and keeping the dusk
   * visible is what says so.
   */
  private room(note: string, cards: HTMLElement[], empty: string): void {
    const wrap = el('div', { class: 'phome-room' })
    if (note) wrap.append(el('div', { class: 'phome-room-note', text: note }))
    if (cards.length === 0) {
      wrap.append(el('div', { class: 'phome-empty', text: empty }))
    } else {
      const g = el('div', { class: 'phome-grid' })
      g.append(...cards)
      wrap.append(g)
      deal(cards)
    }
    this.bodyEl.append(wrap)
  }

  private renderCatalog(s: Save): void {
    const cards = catalogOffers(s).map((o) => {
      const def = o.kind === 'weapon' ? WEAPONS[o.id] : ITEMS[o.id]
      const blurb = typeof def?.blurb === 'string' ? def.blurb : o.kind
      const icon = o.kind === 'weapon'
        ? (def as { sprite?: string })?.sprite
        : (def as { cardSprite?: string; icon?: string })?.cardSprite
          ?? (def as { icon?: string })?.icon
      return this.card({
        kind: o.kind === 'weapon' ? 'WEAPON' : 'FIELD KIT',
        name: o.name,
        blurb,
        cost: o.cost,
        icon,
        affordable: s.acres >= o.cost,
        onBuy: () => this.buy(o.cost, (sv) => { sv.unlockedPool = [...sv.unlockedPool, o.id] }),
      })
    })
    this.room(
      'Unlocks join every future run’s pool. Wider, not stronger.',
      cards,
      'Everything in the catalog is already yours.',
    )
  }

  private renderFeedStore(s: Save): void {
    const m = metaStats(s)
    const cap = (META as unknown as { feedStore: { totalEffectCapPct: number; ranks: number } }).feedStore

    const cards = FEED_TRACKS.map((t) => {
      const label = FEED_LABELS[t] ?? { name: t, blurb: '', unit: t }
      const owned = s.feedStoreRanks[t] ?? 0
      const cost = feedStoreCost(s, t)
      const per = (META as unknown as { feedStore: { tracks: Record<string, number> } }).feedStore.tracks[t]
      return this.card({
        kind: 'FEED STORE',
        name: label.name,
        blurb: `${label.blurb} +${per} ${label.unit} per rank.`,
        cost,
        // The rank IS the pip count. This is the one surface in the game with a
        // real rank rather than a rarity, which is what `pips` is for.
        pips: owned,
        owned: `${owned} / ${cap.ranks}`,
        affordable: cost !== null && s.acres >= cost,
        onBuy: () => cost !== null && this.buy(cost, (sv) => {
          sv.feedStoreRanks = { ...sv.feedStoreRanks, [t]: (sv.feedStoreRanks[t] ?? 0) + 1 }
        }),
      })
    })
    this.room(
      `Permanent, and hard-capped near +${cap.totalEffectCapPct}% overall. `
      + `Now: +${m.maxHp} hp, +${m.moveSpeedPct}% speed, +${m.armor} armor, `
      + `+${m.harvestPct}% harvest, +${m.luck} luck.`,
      cards, '',
    )
  }

  private renderBunkhouse(s: Save): void {
    const cards: HTMLElement[] = []
    for (const id of Object.keys(CLASSES)) {
      const def = CLASSES[id] as { name?: string; blurb?: string }
      if (isClassUnlocked(s, id)) {
        cards.push(this.card({
          kind: 'HIRED',
          name: def.name ?? id,
          blurb: def.blurb ?? 'Ready to work.',
          cost: null,
          icon: `${id}.idle.down.0`,
          affordable: false,
        }))
      }
    }
    // A locked class shows its face and its price, never an empty slot — you
    // should be able to see what is up there from your first run, which is the
    // whole reason this ladder is worth climbing.
    for (const o of bunkhouseOffers(s)) {
      cards.push(this.card({
        kind: 'TO HIRE',
        name: o.name,
        blurb: 'Not yet hired.',
        cost: o.cost,
        icon: `${o.id}.idle.down.0`,
        locked: true,
        affordable: s.acres >= o.cost,
        onBuy: () => this.buy(o.cost, (sv) => { sv.unlockedClasses = [...sv.unlockedClasses, o.id] }),
      }))
    }
    this.room('A new hand changes how a run opens, not how strong it ends.', cards, '')
  }

  private renderFair(s: Save): void {
    const max = maxTier(s)
    const cards: HTMLElement[] = []
    for (let t = 1; t <= max; t++) {
      const cfg = tierConfig(t)
      const chosen = t === this.tier
      cards.push(card({
        kind: chosen ? 'RUNNING' : 'AVAILABLE',
        name: `Tier ${t}`,
        blurb: cfg
          ? `+${cfg.enemyHpPct}% enemy hp. ${cfg.modifier}`
          : 'The Whitacre place as it stands.',
        // A tier is a rank, so it gets the rank plate. Tier 3 is three pips.
        pips: t,
        stats: [{
          label: 'PAYS',
          value: `${cfg ? cfg.acreMultiplier : 1}× acres`,
          tone: 'gain',
        }],
        source: chosen ? 'SELECTED' : 'SELECT',
        // The Fair costs nothing — the tier you are on is `selected`, and the
        // rest are live. Nothing here is ever dead stock.
        selected: chosen,
        affordable: !chosen,
        onClick: () => { this.tier = t; this.onTier?.(t); this.render() },
      }))
    }
    this.room(
      max > s.tierCleared + 1
        ? 'Clear a tier to open the next one.'
        : 'Each tier pays more. Climbing beats farming.',
      cards, '',
    )
  }
}
