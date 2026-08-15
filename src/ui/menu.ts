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
 * The two backdrops, straight from the design's `PLACEMENTS.md`.
 *
 * **Absolute pixels in 1920x1080 stage space**, not percentages of the window.
 * The stage letterboxes as one unit, so these numbers are the composition and
 * nothing here needs a breakpoint.
 *
 * Every sprite is drawn at an INTEGER multiple of its native size. The design's
 * table computes that column rather than asserting it, and a non-integer zoom is
 * a bug on either side — so `stagePlace` derives the size from the atlas frame
 * and the zoom instead of taking a drawn size on trust.
 *
 * The one composition rule to preserve if anything moves:
 *
 *   NOTHING THAT MOVES GOES IN x 0-430 ABOVE y 726.
 *
 * The left third is reserved for print. The class panel is only 78% opaque, so
 * anything behind it ghosts through and reads as a rendering fault rather than
 * as scenery. Two rounds of that bug are why the rule is written down.
 */
interface Place {
  sprite: string
  x: number
  y: number
  /** Integer multiple of the sprite's native size. */
  zoom?: number
  /** A tiled band rather than a single sprite: tile w/h in stage pixels. */
  tile?: [number, number]
  /** Band size when tiled; otherwise the sprite's own size is used. */
  size?: [number, number]
  anim?: string
  opacity?: number
  blur?: number
}

const YARD: Place[] = [
  { sprite: 'scene.treeOak', x: 1150, y: 300 },
  { sprite: 'scene.treeOak', x: 1420, y: 282 },
  { sprite: 'scene.treeOak', x: 596, y: 268 },
  { sprite: 'scene.silo', x: 1664, y: 192 },
  { sprite: 'scene.coop', x: 800, y: 478 },
  { sprite: 'scene.nest', x: 936, y: 542 },
  { sprite: 'scene.scarecrow', x: 968, y: 546, anim: 'y-sway 7.4s ease-in-out infinite' },
  { sprite: 'scene.well', x: 1112, y: 596 },
  { sprite: 'scene.hay', x: 646, y: 616 },
  { sprite: 'scene.treeOak', x: 1742, y: 414 },
  { sprite: 'scene.doghouse', x: 722, y: 552 },
  { sprite: 'scene.penV', x: -2, y: 20 },
  { sprite: 'scene.cow', x: 1628, y: 658, anim: 'y-bob 5.4s ease-in-out infinite' },
  { sprite: 'scene.calf', x: 1746, y: 672, anim: 'y-bob 3.1s ease-in-out infinite 0.6s' },
  { sprite: 'scene.sheep', x: 1826, y: 678, anim: 'y-bob 4.2s ease-in-out infinite 1.4s' },
  { sprite: 'scene.trough', x: 1600, y: 700 },
  { sprite: 'scene.chickenPeckStrip', x: 856, y: 676, tile: [256, 64], size: [256, 64], anim: 'y-strip-256 2s steps(4) infinite' },
  { sprite: 'scene.chick', x: 920, y: 678, zoom: 2, anim: 'y-bob 2.2s ease-in-out infinite' },
  { sprite: 'scene.chickenPeckStrip', x: 992, y: 660, tile: [256, 64], size: [256, 64], anim: 'y-strip-256 2.6s steps(4) infinite 0.8s' },
  { sprite: 'scene.chickenPeckStrip', x: 1064, y: 674, tile: [256, 64], size: [256, 64], anim: 'y-strip-256 3.1s steps(4) infinite 1.9s' },
  { sprite: 'scene.fencePicket', x: -20, y: 742, tile: [96, 32], size: [1960, 32] },
  { sprite: 'scene.dogLab', x: 132, y: 818, zoom: 2, anim: 'y-bob 2.4s ease-in-out infinite' },
  { sprite: 'scene.milkcan', x: 24, y: 872, zoom: 2 },
  { sprite: 'scene.milkcan', x: 66, y: 890, zoom: 2 },
]

const FIELD: Place[] = [
  { sprite: 'scene.treeOak', x: 900, y: 352 },
  { sprite: 'scene.treeOak', x: 1560, y: 352 },
  { sprite: 'scene.silo', x: 1672, y: 116 },
  { sprite: 'scene.barn', x: 1208, y: 340 },
  { sprite: 'scene.house', x: 560, y: 244 },
  { sprite: 'scene.farmerIdle', x: 1392, y: 508 },
  { sprite: 'scene.farmer2Idle', x: 1436, y: 512 },
  { sprite: 'scene.chickenPeckStrip', x: 1350, y: 542, tile: [128, 32], size: [128, 32], anim: 'f-strip-128 2.4s steps(4) infinite' },
  { sprite: 'scene.chickenPeckStrip', x: 1386, y: 548, tile: [128, 32], size: [128, 32], anim: 'f-strip-128 3.1s steps(4) infinite 0.7s' },
  { sprite: 'scene.chickenPeckStrip', x: 1478, y: 544, tile: [128, 32], size: [128, 32], anim: 'f-strip-128 2.8s steps(4) infinite 1.5s' },
  { sprite: 'scene.chickenPeckStrip', x: 1560, y: 540, tile: [128, 32], size: [128, 32], anim: 'f-strip-128 3.4s steps(4) infinite 2.2s' },
  // The crop bands SKEW in place rather than scrolling, so the field breathes
  // without the tiling reading as moving wallpaper. Each carries a different
  // x-offset so the seams never line up vertically.
  { sprite: 'scene.wheat', x: -32, y: 574, tile: [64, 64], size: [1984, 64], opacity: 0.9, anim: 'f-crop 5.2s ease-in-out infinite' },
  { sprite: 'scene.wheat', x: -32, y: 636, tile: [64, 64], size: [1984, 64], opacity: 0.62, anim: 'f-crop 5.9s ease-in-out infinite 0.7s' },
  { sprite: 'scene.wheat2', x: -32, y: 700, tile: [96, 96], size: [1984, 96], opacity: 0.92, anim: 'f-crop 6.4s ease-in-out infinite' },
  { sprite: 'scene.wheat2', x: -32, y: 806, tile: [96, 96], size: [1984, 96], opacity: 0.55, blur: 1.2, anim: 'f-crop-slow 7.1s ease-in-out infinite 1.2s' },
  { sprite: 'scene.wheat2', x: -32, y: 902, tile: [128, 128], size: [1984, 128], opacity: 0.95, blur: 2.6, anim: 'f-crop-slow 8.3s ease-in-out infinite' },
  { sprite: 'scene.scarecrow', x: 640, y: 522, anim: 'f-sway 6.6s ease-in-out infinite' },
  { sprite: 'scene.hay', x: 700, y: 606 },
]

/** Edge colours the letterbox bleeds with, per scene. */
const BLEED = {
  yard: { top: '#191b36', bottom: '#191d13' },
  field: { top: '#1d2140', bottom: '#201e13' },
}

export class MenuScreen {
  private readonly root: HTMLElement
  private readonly seedInput: HTMLInputElement
  private readonly homesteadBtn: HTMLButtonElement
  private cardsEl!: HTMLElement
  private stageEl!: HTMLElement
  private selected = CLASS_IDS[0]
  /** Which classes the save has paid for. Set by main before every open(). */
  private unlocked = new Set<string>(CLASS_IDS.filter((id) => CLASSES[id]?.unlocked === true))
  /** id -> acre price, for the brand on a nailed packet. */
  private prices = new Map<string, number>()
  /** Which backdrop this page load got. Fixed for the session, see `scene()`. */
  private readonly isField = Math.random() < 0.5

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

    this.stageEl = el('div', { class: 'home-scene' }, [this.scene()])

    this.root = el('div', { class: `screen home${this.isField ? ' is-field' : ''}` }, [
      this.stageEl,
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
    this.fitScene()
    window.addEventListener('resize', () => this.fitScene())
  }

  /**
   * Pick a backdrop for this load.
   *
   * Two ship and one is chosen at random per page load rather than per open —
   * re-rolling every time you back out of the Homestead would make the home
   * screen feel unstable, which is the opposite of what a home screen is for.
   */
  private scene(): HTMLElement {
    const places = this.isField ? FIELD : YARD
    const scene = el('div', { class: 'home-yard' })

    if (this.isField) {
      scene.append(el('div', { class: 'field-sun' }))
      for (const [top, secs, opacity] of [[11, 150, 0.5], [21, 104, 0.7], [31, 76, 0.9]] as const) {
        const c = el('div', { class: 'field-cloud' })
        c.style.top = `${top}%`
        c.style.opacity = String(opacity)
        c.style.animation = `field-drift ${secs}s linear infinite`
        scene.append(c)
      }
      // A distant treeline is a small SPRITE, not a small scale, so this band is
      // a blurred CSS silhouette rather than shrunken oaks.
      scene.append(el('div', { class: 'field-treeline' }))
    }

    for (const p of places) {
      const node = this.stagePlace(p)
      if (node) scene.append(node)
    }

    if (!this.isField) scene.append(el('div', { class: 'home-lamp' }))
    // The scene's own two shaped passes, on the stage so they letterbox with it.
    scene.append(el('div', { class: 'home-vignette' }))
    return scene
  }

  /**
   * One placement, in stage pixels.
   *
   * Sizes are derived from the atlas frame times the zoom rather than taken from
   * the design's drawn-size column, so a sprite that gets re-cropped cannot end
   * up stretched — the table's `zoom` is the intent and the frame is the truth.
   */
  private stagePlace(p: Place): HTMLElement | null {
    const f = frameOf(p.sprite)
    if (!f) return null

    const node = el('div', { class: 'home-place' })
    node.style.left = `${p.x}px`
    node.style.top = `${p.y}px`

    if (p.tile) {
      // A tiled band: needs a standalone tile texture, never an atlas window —
      // repeating an atlas window repeats the whole atlas.
      const url = spriteTileUrl(p.sprite)
      if (!url) return null
      const [tw, th] = p.tile
      const [w, h] = p.size ?? p.tile
      node.style.width = `${w}px`
      node.style.height = `${h}px`
      node.style.backgroundImage = `url('${url}')`
      node.style.backgroundSize = `${tw}px ${th}px`
      node.style.backgroundRepeat = 'repeat-x'
      node.style.setProperty('--tile-w', `-${tw}px`)
      node.style.imageRendering = 'pixelated'
    } else {
      const sprite = spriteEl(p.sprite, 4096, p.zoom ?? 1)
      if (!sprite) return null
      node.append(sprite)
    }

    if (p.anim) node.style.animation = p.anim
    if (p.opacity !== undefined) node.style.opacity = String(p.opacity)
    if (p.blur) node.style.filter = `blur(${p.blur}px)`
    return node
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
    this.stageEl.replaceChildren(this.scene())
    this.renderCards()
  }

  private select(id: string): void {
    if (!this.unlocked.has(id)) return
    this.selected = id
    this.renderCards()
  }

  open(): void {
    this.root.style.display = ''
    this.fitScene()
  }

  /**
   * Fit the 1920x1080 stage INSIDE the window.
   *
   * `contain`, not `cover`, and that is Design's call rather than a preference:
   * the composition is horizontal — barn right, print left — so cropping the
   * sides destroys exactly the relationship the scene is built on. The leftover
   * space is bled with the scene's own edge colours, which reads as a wider
   * window rather than as bars.
   */
  private fitScene(): void {
    const s = Math.min(window.innerWidth / 1920, window.innerHeight / 1080)
    this.root.style.setProperty('--scene', String(s))
    // The bleed lives here rather than in `scene()`: that runs while the stage
    // is being built, which is BEFORE `this.root` exists, and setting a
    // property on it there threw on construction.
    const bleed = this.isField ? BLEED.field : BLEED.yard
    this.root.style.setProperty('--bleed-top', bleed.top)
    this.root.style.setProperty('--bleed-bottom', bleed.bottom)
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
