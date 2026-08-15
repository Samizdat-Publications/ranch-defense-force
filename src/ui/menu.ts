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
import { CLASSES, CLASS_IDS, WEAPONS } from '../content'
import { clear, el } from './dom'
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

/** Where the Homestead call-out sits, per scene — the barn is in a different spot. */
const DOOR = { yard: [832, 624], field: [822, 618] } as const

export class MenuScreen {
  private readonly root: HTMLElement
  private readonly stageEl: HTMLElement
  private readonly uiEl: HTMLElement
  private readonly seedInput: HTMLInputElement
  private selected = CLASS_IDS[0]
  private unlocked = new Set<string>(CLASS_IDS.filter((id) => CLASSES[id]?.unlocked === true))
  private prices = new Map<string, number>()
  private acres = 0
  /** Which backdrop this load got. Mutable only via the dev toggle. */
  private isField: boolean

  constructor(
    parent: HTMLElement,
    private readonly onStart: (classId: string, seed: string) => void,
    private readonly onHomestead?: () => void,
  ) {
    // Alternate rather than randomise: the design reads the last scene from
    // storage and mounts the other one, so the game never opens the same way
    // twice running. Random would repeat about half the time.
    let last = ''
    try { last = localStorage.getItem('rdf.homeScene') ?? '' } catch { /* private mode */ }
    this.isField = last !== 'field'
    try { localStorage.setItem('rdf.homeScene', this.isField ? 'field' : 'yard') } catch { /* ignore */ }

    this.seedInput = el('input', { class: 'home-seed-input' })
    this.seedInput.placeholder = 'random'

    this.stageEl = el('div', { class: 'home-scene' }, [this.scene()])
    // The UI lives INSIDE the stage's coordinate space and scales with it.
    // That is the whole reason this design needs no breakpoints: every number
    // in the mockup is a 1920x1080 stage pixel, interface included. Building
    // the scene to the design and then laying my own responsive UI over it is
    // exactly the mistake that made the first attempt look nothing like it.
    this.uiEl = el('div', { class: 'home-ui' })

    this.root = el('div', { class: `screen home${this.isField ? ' is-field' : ''}` }, [
      el('div', { class: 'home-stagewrap' }, [this.stageEl, this.uiEl]),
    ])
    this.root.style.display = 'none'
    parent.appendChild(this.root)
    this.renderUi()
    this.fitScene()
    window.addEventListener('resize', () => this.fitScene())
  }

  /** Dev only: swap the backdrop in place, no reload. */
  private flipScene(): void {
    this.isField = !this.isField
    this.root.classList.toggle('is-field', this.isField)
    this.stageEl.replaceChildren(this.scene())
    this.renderUi()
    this.fitScene()
  }

  /** Everything printed, in stage coordinates. */
  private renderUi(): void {
    clear(this.uiEl)
    const def = CLASSES[this.selected]
    const [doorX, doorY] = this.isField ? DOOR.field : DOOR.yard

    const title = el('div', { class: 'home-title-block' }, [
      el('div', { class: 'home-eyebrow', text: 'THE WHITACRE PLACE · 1987' }),
      el('h1', { class: 'home-title' }, [
        el('span', { text: 'Ranch' }), el('br'),
        el('span', { text: 'Defense' }), el('br'),
        el('span', { text: 'Force' }),
      ]),
      el('div', { class: 'home-tagline' }, [
        el('span', { class: 'home-tagrule' }),
        el('span', { text: 'Work the field until the light goes.' }),
      ]),
    ])

    const playing = el('div', { class: 'home-playing' }, [
      el('div', { class: 'home-playing-label', text: 'YOU ARE PLAYING' }),
      el('div', { class: 'home-playing-name', text: def?.name ?? '' }),
      el('div', { class: 'home-playing-blurb', text: def?.blurb ?? '' }),
      el('div', { class: 'home-playing-rule' }),
      el('div', { class: 'home-playing-rows' }, [
        row('PASSIVE', def?.cardPassive ?? def?.passive.desc ?? ''),
        row('ABILITY', def?.ability.name ?? ''),
        row('STARTS', WEAPONS[def?.startingWeapon ?? '']?.name ?? def?.startingWeapon ?? ''),
      ]),
    ])

    const seedBox = el('div', { class: 'home-seedbox' }, [
      el('div', { class: 'home-seed-field' }, [
        el('div', { class: 'home-seed-label', text: 'SEED' }),
        this.seedInput,
      ]),
      el('button', {
        class: 'home-seed-new',
        text: 'NEW',
        onClick: () => { this.seedInput.value = '' },
      }),
    ])

    const door = el('div', { class: 'home-door' }, [
      el('button', {
        class: 'home-door-btn',
        text: 'THE HOMESTEAD',
        onClick: () => this.onHomestead?.(),
      }),
      el('div', { class: 'home-door-note', text: `${this.acres} acres banked` }),
    ])
    door.style.left = `${doorX}px`
    door.style.top = `${doorY}px`

    const rail = el('div', { class: 'home-rail' })
    CLASS_IDS.forEach((id, i) => {
      const c = this.heroCard(id, i)
      if (c) rail.append(c)
    })

    const foot = el('div', { class: 'home-footbar' }, [
      el('span', { text: '24 WAVES · TWO BOSSES · WEAPONS FIRE THEMSELVES' }),
      el('span', { text: 'ART BY LIMEZU · LIMEZU.ITCH.IO' }),
    ])

    this.uiEl.append(title, playing, seedBox, door, rail, foot)

    // The scene toggle. Design marks it a REVIEWER CONTROL, not shipped — so it
    // is dev-only. Flipping backdrops without reloading is the difference
    // between checking both compositions and checking one.
    if (import.meta.env.DEV) {
      this.uiEl.append(el('button', {
        class: 'home-scene-toggle',
        text: `SCENE: ${this.isField ? 'FIELD' : 'YARD'}`,
        onClick: () => this.flipScene(),
      }))
    }
  }

  /**
   * One class card, per `Class Card.dc.html`.
   *
   * Deliberately NOT the `pcard` the level-up and shop use. The design draws
   * this one as a different object — a keyword band, a figure window with a
   * horizon line, three read-off stat bars, a footer of ability and weapon —
   * and a card that is genuinely different should be a different component
   * rather than eight flags bolted onto the first one.
   */
  private heroCard(id: string, index: number): HTMLElement | null {
    const def = CLASSES[id]
    if (!def) return null
    const locked = !this.unlocked.has(id)
    const price = this.prices.get(id)
    const bars = def.bars ?? { body: 50, speed: 50, reach: 50 }
    const selected = id === this.selected

    const figure = el('div', { class: 'hero-window' })
    const sprite = spriteEl(`${id}.idle.down.0`, 4096, 3)
    if (sprite) {
      sprite.classList.add('hero-figure')
      figure.append(sprite)
    }
    figure.append(el('div', { class: 'hero-horizon' }), el('div', { class: 'hero-shade' }))

    if (locked) {
      // A packet somebody nailed shut: two boards across the window, the figure
      // still visible in the gap, the acre price branded on the top board. Not
      // a black silhouette — you should be able to see there is somebody there.
      figure.append(
        el('div', { class: 'hero-board hero-board-top' }, [
          el('span', { class: 'hero-price', text: price ? `${price} ACRES` : 'LOCKED' }),
        ]),
        el('div', { class: 'hero-board hero-board-bottom' }),
      )
    }

    const card = el('div', {
      class: `hero${locked ? ' is-locked' : ''}${selected ? ' is-selected' : ''}`,
    }, [
      el('div', { class: 'hero-tab' }, [el('div', { class: 'hero-punch' })]),
      el('div', { class: 'hero-body' }, [
        el('div', { class: 'hero-tag', text: def.tag ?? '' }),
        figure,
        el('div', { class: 'hero-name', text: def.name }),
        el('div', { class: 'hero-rule' }),
        el('div', { class: 'hero-bars' }, [
          bar('BODY', bars.body), bar('SPEED', bars.speed), bar('REACH', bars.reach),
        ]),
        el('div', { class: 'hero-foot' }, [
          el('span', { text: (def.ability.name ?? '').toUpperCase() }),
          el('span', {
            text: (WEAPONS[def.startingWeapon]?.name ?? def.startingWeapon).toUpperCase(),
          }),
        ]),
      ]),
      selected && !locked ? el('div', { class: 'hero-taking', text: 'TAKING THE FIELD' }) : null,
    ])
    card.style.animationDelay = `${index * 90}ms`
    card.onclick = () => {
      // A locked card sends you where you can unlock it, rather than doing
      // nothing — a dead click on the most interesting card is a bad answer.
      if (locked) { this.onHomestead?.(); return }
      if (selected) { this.onStart(id, this.seedInput.value.trim()); return }
      this.selected = id
      this.renderUi()
    }
    return card
  }

  /**
   * Pick a backdrop for this load and build it.
   *
   * Placements come from the design's table; see the block at the top of this
   * file. Nothing here is composed by eye.
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
      // A distant treeline needs a small SPRITE, not a small scale, so this is
      // a blurred silhouette band rather than shrunken oaks.
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
   * Sizes are derived from the atlas frame times the zoom rather than taken
   * from the design's drawn-size column, so a re-cropped sprite cannot end up
   * stretched — the table's `zoom` is the intent and the frame is the truth.
   */
  private stagePlace(p: Place): HTMLElement | null {
    const f = frameOf(p.sprite)
    if (!f) return null

    const node = el('div', { class: 'home-place' })
    node.style.left = `${p.x}px`
    node.style.top = `${p.y}px`

    if (p.tile) {
      // A tiled band needs a standalone tile texture, never an atlas window —
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
   * Called by main from the save, before opening — and again once the atlas
   * resolves, because this screen is built at module load and every sprite it
   * asked for before then came back null.
   */
  setUnlocked(ids: readonly string[], prices?: ReadonlyMap<string, number>, acres = 0): void {
    this.unlocked = new Set(ids)
    if (prices) this.prices = new Map(prices)
    this.acres = acres
    if (!this.unlocked.has(this.selected)) {
      this.selected = CLASS_IDS.find((id) => this.unlocked.has(id)) ?? CLASS_IDS[0]
    }
    this.stageEl.replaceChildren(this.scene())
    this.renderUi()
  }

  open(): void {
    this.root.style.display = ''
    this.fitScene()
  }

  close(): void {
    this.root.style.display = 'none'
  }

  /**
   * Fit the 1920x1080 stage INSIDE the window.
   *
   * `contain`, not `cover`, and that is the design's call rather than a
   * preference: the composition is horizontal — barn right, print left — so
   * cropping the sides destroys exactly the relationship the scene is built on.
   * The leftover space is bled with the scene's own edge colours, which reads
   * as a wider window rather than as bars.
   */
  private fitScene(): void {
    const s = Math.min(window.innerWidth / 1920, window.innerHeight / 1080)
    this.root.style.setProperty('--scene', String(s))
    const bleed = this.isField ? BLEED.field : BLEED.yard
    this.root.style.setProperty('--bleed-top', bleed.top)
    this.root.style.setProperty('--bleed-bottom', bleed.bottom)
  }
}

/** A label/value line in the "you are playing" panel. */
function row(label: string, value: string): HTMLElement {
  return el('div', { class: 'home-playing-row' }, [
    el('span', { class: 'home-playing-key', text: label }),
    el('span', { class: 'home-playing-val', text: value }),
  ])
}

/** One BODY/SPEED/REACH meter. */
function bar(label: string, pct: number): HTMLElement {
  const fill = el('div', { class: 'hero-bar-fill' })
  fill.style.width = `${Math.max(0, Math.min(100, pct))}%`
  return el('div', { class: 'hero-bar' }, [
    el('span', { class: 'hero-bar-label', text: label }),
    el('div', { class: 'hero-bar-track' }, [fill]),
  ])
}
