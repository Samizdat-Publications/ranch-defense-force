/**
 * The home screen: the yard at dusk, and who you take out into it.
 *
 * The design asks for a place rather than a list. There is no barn art in the
 * atlas yet, so the yard is built from what the game already owns — a dusk sky,
 * a treeline, a band of real terrain tiles, and actors standing on it at 2x
 * against the scenery's 1x. That size difference is what makes it read as
 * depth; see home.css.
 *
 * Class cards are the same `card()` object the level-up and shop use. A locked
 * class is a packet somebody nailed shut, with the acre price branded on the
 * top board — not a black silhouette. You should be able to see what is up
 * there from your first run, which is the whole reason the Bunkhouse has a
 * ladder worth climbing.
 */
import { CLASSES, CLASS_IDS } from '../content'
import { clear, el } from './dom'
import { card, deal } from './card'
import { spriteEl } from './sprite'

/** Scenery, drawn once. Kept small — this is dressing, not a level. */
const TREELINE = [
  'node.treeBig', 'node.treeMedium', 'node.treeBig', 'node.treeSmall',
  'node.treeMedium', 'node.treeBig', 'node.treeMedium', 'node.treeSmall',
  'node.treeBig', 'node.treeMedium', 'node.treeBig',
]

export class MenuScreen {
  private readonly root: HTMLElement
  private readonly seedInput: HTMLInputElement
  private readonly homesteadBtn: HTMLButtonElement
  private cardsEl!: HTMLElement
  private yardEl!: HTMLElement
  private selected = CLASS_IDS[0]
  /** Which classes the save has paid for. Set by main before every open(). */
  private unlocked = new Set<string>(CLASS_IDS.filter((id) => CLASSES[id]?.unlocked === true))
  /** id -> acre price, for the brand on a nailed packet. */
  private prices = new Map<string, number>()

  constructor(
    parent: HTMLElement,
    private readonly onStart: (classId: string, seed: string) => void,
    onHomestead?: () => void,
  ) {
    this.homesteadBtn = el('button', { class: 'btn', text: 'Homestead' })
    this.homesteadBtn.onclick = () => onHomestead?.()

    this.seedInput = el('input', { class: 'home-seed' })
    this.seedInput.placeholder = 'seed (blank = random)'

    this.cardsEl = el('div', { class: 'home-rail' })

    const head = el('button', { class: 'btn btn-primary', text: 'Head out →' })
    head.onclick = () => this.onStart(this.selected, this.seedInput.value.trim())

    this.yardEl = this.yard()

    this.root = el('div', { class: 'screen home' }, [
      this.yardEl,
      el('div', { class: 'home-inner' }, [
        el('h1', { class: 'home-title', text: 'RANCH DEFENSE FORCE' }),
        el('p', {
          class: 'home-sub',
          text: 'Something came off the crop duster that went over low on Tuesday. '
            + 'Work the field until the light goes.',
        }),
        this.cardsEl,
        el('div', { class: 'home-actions' }, [this.seedInput, this.homesteadBtn, head]),
      ]),
      el('div', { class: 'home-foot' }, [
        el('div', { text: 'WASD / arrows / left stick to move · Space or RT for your ability · weapons fire themselves' }),
        el('div', { text: 'Art by LimeZu (limezu.itch.io)' }),
      ]),
    ])
    this.root.style.display = 'none'
    parent.appendChild(this.root)
    this.renderCards()
  }

  /** Sky, treeline, ground, actors, porch light. All dressing, no state. */
  private yard(): HTMLElement {
    const yard = el('div', { class: 'home-yard' })

    const trees = el('div', { class: 'home-treeline' })
    for (const t of TREELINE) {
      const s = spriteEl(t, 96, 1)
      if (s) trees.append(s)
    }

    // The ground band tiles one terrain frame rather than spawning a node per
    // tile — a hundred divs to draw dirt is a hundred divs.
    const ground = el('div', { class: 'home-ground' })
    const dirt = spriteEl('terrain.dirt', 32, 1)
    if (dirt) {
      ground.style.backgroundImage = dirt.style.backgroundImage
      ground.style.backgroundPosition = dirt.style.backgroundPosition
      ground.style.backgroundSize = dirt.style.backgroundSize
      ground.style.backgroundRepeat = 'repeat'
    }

    const actors = el('div', { class: 'home-actors' })
    for (const [sheet, dir] of [['rooster', 'right'], ['hand', 'down'], ['feralDog', 'left']] as const) {
      const s = spriteEl(`${sheet}.idle.${dir}.0`, 128, 2)
      if (s) actors.append(el('div', { class: 'home-actor' }, [s]))
    }

    yard.append(ground, trees, actors, el('div', { class: 'home-lamp' }))
    return yard
  }

  /**
   * Build the class cards for whoever is currently unlocked.
   *
   * Rebuilt on every `open()` rather than once in the constructor: the
   * constructor runs before the Homestead has ever been visited, so a list
   * built there can only ever show the starting two — or, if it ignores the
   * save, silently hand out every paid class for free. It did the latter the
   * moment four buyable classes existed.
   */
  private renderCards(): void {
    clear(this.cardsEl)
    const built: HTMLElement[] = []

    for (const id of CLASS_IDS) {
      const def = CLASSES[id]
      if (!def) continue
      const locked = !this.unlocked.has(id)
      const price = this.prices.get(id)

      const c = card({
        kind: locked ? 'Bunkhouse · locked' : 'The Bunkhouse',
        name: def.name,
        blurb: def.blurb,
        sprite: `${id}.idle.down.0`,
        zoom: 2,
        stats: [
          { label: 'Passive', value: shortOf(def.passive.desc) },
          { label: def.ability.name, value: shortOf(def.ability.desc) },
          { label: 'Starts with', value: def.startingWeapon },
        ],
        lot: locked ? 'NAILED SHUT' : 'READY',
        source: locked && price ? `${price} ACRES` : 'HIRED',
        selected: !locked && id === this.selected,
        dead: locked,
        onClick: () => this.select(id),
      })
      if (locked) {
        c.classList.add('is-nailed')
        if (price) {
          c.querySelector('.pcard-window')?.append(
            el('div', { class: 'pcard-brand', text: `${price} ACRES` }),
          )
        }
      }
      this.cardsEl.appendChild(c)
      built.push(c)
    }

    if (!this.unlocked.has(this.selected)) {
      this.selected = CLASS_IDS.find((id) => this.unlocked.has(id)) ?? CLASS_IDS[0]
    }
    deal(built)
  }

  /**
   * Called by main from the save, before opening — and again once the atlas
   * resolves, because this screen is built at module load and every sprite it
   * asked for before then came back null.
   */
  setUnlocked(ids: readonly string[], prices?: ReadonlyMap<string, number>): void {
    this.unlocked = new Set(ids)
    if (prices) this.prices = new Map(prices)
    const fresh = this.yard()
    this.yardEl.replaceWith(fresh)
    this.yardEl = fresh
    this.renderCards()
  }

  private select(id: string): void {
    if (!this.unlocked.has(id)) return
    this.selected = id
    this.renderCards()
  }

  open(): void {
    this.root.style.display = ''
  }

  close(): void {
    this.root.style.display = 'none'
  }
}

/** Ability and passive text is a sentence; a card stat row is a phrase. */
function shortOf(text: string): string {
  const first = text.split('.')[0]
  return first.length > 46 ? `${first.slice(0, 44)}…` : first
}
