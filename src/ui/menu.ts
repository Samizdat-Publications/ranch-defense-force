/**
 * The home screen: the Whitacre place at dusk, and who you take out into it.
 *
 * The design asks for a place rather than a list. The two backdrops live in
 * `scene.ts` — layer-for-layer ports of Design's own runtime scenes in
 * `docs/reference/` — and this file owns only what is printed on top of them.
 *
 * Class cards are a card object of their own. A locked class is a packet
 * somebody nailed shut, with the acre price branded on the top board — not a
 * black silhouette. You should be able to see what is up there from your first
 * run, which is the whole reason the Bunkhouse has a ladder worth climbing.
 */
import { CLASSES, CLASS_IDS, WEAPONS } from '../content'
import { clear, el } from './dom'
import { spriteEl } from './sprite'
import { BLEED, DOOR, buildScene, type SceneKind } from './scene'



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

    this.stageEl = el('div', { class: 'home-scene' }, [buildScene(this.kind)])
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
    this.stageEl.replaceChildren(buildScene(this.kind))
    this.renderUi()
    this.fitScene()
  }

  /** Everything printed, in stage coordinates. */
  private renderUi(): void {
    clear(this.uiEl)
    const def = CLASSES[this.selected]
    const { x: doorX, y: doorY } = DOOR[this.kind]

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
      el('span', { text: 'ART BY LIMEZU · MUSIC BY ABSTRACTION' }),
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
    /*
       A PORTRAIT IF THERE IS ONE, the walking sprite if not.

       The class plates used to show `<id>.idle.down.0` at 3x — the same 32px
       figure that walks around the field, enlarged. It reads as a game sprite
       standing in a box rather than as a picture OF someone, which is what a
       class card wants.

       The portraits are derived from each class's own finished sprite via
       `character_to_portrait`, so a plate cannot drift from the character it
       names. Falling back keeps the screen working when the atlas has no
       portrait — a missing one costs the plate, not the menu.
    */
    const sprite = spriteEl(`portrait.${id}`, 4096, 2) ?? spriteEl(`${id}.idle.down.0`, 4096, 3)
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

  /** Which backdrop this load got. */
  private get kind(): SceneKind {
    return this.isField ? 'field' : 'yard'
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
    this.stageEl.replaceChildren(buildScene(this.kind))
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
    const bleed = BLEED[this.kind]
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
