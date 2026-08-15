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
import { spriteEl, spriteTileUrl, frameOf } from './sprite'

/**
 * The yard, as placements on a 1920x1080 reference frame.
 *
 * Positions are percentages of that frame so the scene scales with the window
 * without anything needing to be re-measured. `zoom` is the integer sprite
 * scale: distant buildings at 1x, actors at 2x, and ONE foreground building at
 * 2x cropped by the frame edge — the silo. That scale ladder is what carries
 * the depth; without it the yard is a wall of sprites at one size.
 */
interface Placement {
  sprite: string
  /** Percent of the reference frame, from the left / from the top. */
  x: number
  y: number
  zoom: number
  /** Distance haze. Far things are dimmer and slightly blue. */
  dim?: number
  blur?: number
  z?: number
}

const YARD: Placement[] = [
  { sprite: 'scene.barn', x: 10, y: 30, zoom: 1, dim: 0.72, z: 1 },
  { sprite: 'scene.house', x: 33, y: 22, zoom: 1, dim: 0.66, z: 1 },
  { sprite: 'scene.coop', x: 57, y: 44, zoom: 1, dim: 0.8, z: 2 },
  { sprite: 'scene.well', x: 70, y: 56, zoom: 1, dim: 0.82, z: 2 },
  { sprite: 'scene.scarecrow', x: 47, y: 52, zoom: 1, dim: 0.78, z: 2 },
  { sprite: 'scene.doghouse', x: 78, y: 52, zoom: 1, dim: 0.84, z: 2 },
  { sprite: 'scene.hay', x: 26, y: 62, zoom: 2, dim: 0.9, z: 3 },
  { sprite: 'scene.tractorLeft', x: 6, y: 58, zoom: 1, dim: 0.8, z: 2 },
  // The foreground silo, deliberately running off the right edge.
  { sprite: 'scene.silo', x: 86, y: 8, zoom: 2, dim: 0.5, z: 6 },
]

/** Walking actors: one strip each, stepped by CSS. */
interface Walker {
  sprite: string
  frames: number
  x: number
  y: number
  zoom: number
  /** Seconds for one full cycle. */
  cycle: number
  dim?: number
}

const WALKERS: Walker[] = [
  { sprite: 'scene.farmerWalkstrip', frames: 6, x: 41, y: 70, zoom: 2, cycle: 0.75, dim: 0.92 },
  { sprite: 'scene.chickenWalkLeftstrip', frames: 6, x: 62, y: 76, zoom: 2, cycle: 0.6, dim: 0.9 },
  { sprite: 'scene.chickenPeckstrip', frames: 4, x: 30, y: 78, zoom: 2, cycle: 1.1, dim: 0.9 },
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

  /** The yard: ground, buildings, walkers, porch light. All dressing, no state. */
  private yard(): HTMLElement {
    const yard = el('div', { class: 'home-yard' })

    // The ground band tiles one terrain frame rather than spawning a node per
    // tile — a hundred divs to draw dirt is a hundred divs. It must be a
    // standalone tile texture, NOT an atlas window: repeating an atlas window
    // repeats the whole atlas, and the first version of this drew a wall of
    // every sprite in the game across the bottom of the home screen.
    const ground = el('div', { class: 'home-ground' })
    const dirt = spriteTileUrl('terrain.dirt')
    if (dirt) {
      ground.style.backgroundImage = `url('${dirt}')`
      ground.style.backgroundRepeat = 'repeat'
      ground.style.backgroundSize = '64px 64px'
    }
    yard.append(ground)

    for (const p of YARD) {
      const s = spriteEl(p.sprite, 4096, p.zoom)
      if (!s) continue
      const wrap = el('div', { class: 'home-place' }, [s])
      wrap.style.left = `${p.x}%`
      wrap.style.top = `${p.y}%`
      wrap.style.zIndex = String(p.z ?? 1)
      wrap.style.filter =
        `brightness(${p.dim ?? 1})${p.blur ? ` blur(${p.blur}px)` : ''}`
      yard.append(wrap)
    }

    for (const w of WALKERS) {
      const strip = spriteTileUrl(w.sprite)
      if (!strip) continue
      const f = frameOf(w.sprite)
      if (!f) continue
      const cellW = f.w / w.frames
      const el2 = el('div', { class: 'home-walker' })
      // Pixel background-position and an explicit pixel background-size.
      // PERCENTAGES LOOK EQUIVALENT AND ARE NOT: with a 6-frame strip, -600%
      // lands frame 0 and then five blank offsets, so the character shows one
      // frame and then flickers. Documented in the handoff as already shipped
      // once into a mockup.
      el2.style.width = `${cellW * w.zoom}px`
      el2.style.height = `${f.h * w.zoom}px`
      el2.style.backgroundImage = `url('${strip}')`
      el2.style.backgroundSize = `${f.w * w.zoom}px ${f.h * w.zoom}px`
      el2.style.setProperty('--walk-end', `-${f.w * w.zoom}px`)
      el2.style.animation = `walk-strip ${w.cycle}s steps(${w.frames}) infinite`
      el2.style.left = `${w.x}%`
      el2.style.top = `${w.y}%`
      el2.style.filter = `brightness(${w.dim ?? 1})`
      yard.append(el2)
    }

    yard.append(el('div', { class: 'home-lamp' }))
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
