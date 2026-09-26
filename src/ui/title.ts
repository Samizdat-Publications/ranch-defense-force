/**
 * The title screen, over the live diorama (`render/diorama.ts`).
 *
 * The farm behind is the real game renderer at sundown, so the screen needs
 * very little of its own: the name, one unmistakable way to start, the class
 * you are taking out, the rail of class cards, and the door to the Homestead.
 *
 * Laid out on a 1920x1080 stage scaled to fit the window, so every number in
 * title.css is a stage pixel and there are no breakpoints.
 *
 * Keys: left/right choose a class, Enter starts, H opens the Homestead.
 */
import { CLASSES, CLASS_IDS, WEAPONS } from '../content'
import { clear, el } from './dom'
import { spriteEl } from './sprite'

export class TitleScreen {
  private readonly root: HTMLElement
  private readonly stage: HTMLElement
  private readonly seedInput: HTMLInputElement
  private selected = CLASS_IDS[0]
  private unlocked = new Set<string>(CLASS_IDS.filter((id) => CLASSES[id]?.unlocked === true))
  private prices = new Map<string, number>()
  private acres = 0
  private isOpen = false

  constructor(
    parent: HTMLElement,
    private readonly onStart: (classId: string, seed: string) => void,
    private readonly onHomestead?: () => void,
    private readonly onSelect?: (classId: string) => void,
  ) {
    this.seedInput = el('input', { class: 'title-seed-input' })
    this.seedInput.placeholder = 'random'
    this.stage = el('div', { class: 'title-stage' })
    this.root = el('div', { class: 'screen title' }, [this.stage])
    this.root.style.display = 'none'
    parent.appendChild(this.root)
    this.render()
    this.fit()
    window.addEventListener('resize', () => this.fit())
    window.addEventListener('keydown', (e) => this.onKey(e))
  }

  private onKey(e: KeyboardEvent): void {
    if (!this.isOpen || document.activeElement === this.seedInput) return
    const open = CLASS_IDS.filter((id) => this.unlocked.has(id))
    const i = open.indexOf(this.selected)
    if (e.code === 'ArrowRight' || e.code === 'KeyD') this.choose(open[(i + 1) % open.length])
    else if (e.code === 'ArrowLeft' || e.code === 'KeyA') this.choose(open[(i - 1 + open.length) % open.length])
    else if (e.code === 'Enter' || e.code === 'NumpadEnter') this.start()
    else if (e.code === 'KeyH') this.onHomestead?.()
  }

  private choose(id: string | undefined): void {
    if (!id || id === this.selected) return
    this.selected = id
    this.onSelect?.(id)
    this.render()
  }

  private start(): void {
    this.onStart(this.selected, this.seedInput.value.trim())
  }

  private render(): void {
    clear(this.stage)
    const def = CLASSES[this.selected]

    const logo = el('div', { class: 'title-logo' }, [
      el('div', { class: 'title-eyebrow', text: 'THE WHITACRE PLACE · CANTON, OHIO · 1987' }),
      el('h1', { class: 'title-name' }, [
        el('span', { text: 'Ranch Defense' }), el('br'), el('span', { text: 'Force' }),
      ]),
      el('div', { class: 'title-tagline', text: 'Work the field until the light goes.' }),
    ])

    const actions = el('div', { class: 'title-actions' }, [
      el('button', { class: 'title-start', onClick: () => this.start() }, [
        el('span', { class: 'title-start-label', text: 'Work the field' }),
        el('span', { class: 'title-start-key', text: 'ENTER' }),
      ]),
      el('button', { class: 'title-home', onClick: () => this.onHomestead?.() }, [
        el('span', { text: 'The Homestead' }),
        el('span', { class: 'title-home-acres', text: `${this.acres} acres` }),
      ]),
      // A seed is for replaying a run, not something a first-time player
      // needs on the front page: `?seed` or `?dev` shows it.
      /[?&](seed|dev)/.test(location.search)
        ? el('div', { class: 'title-seed' }, [
          el('span', { class: 'title-seed-label', text: 'SEED' }),
          this.seedInput,
        ])
        : null,
    ])

    const playing = el('div', { class: 'title-playing' }, [
      el('div', { class: 'title-playing-label', text: 'TAKING THE FIELD' }),
      el('div', { class: 'title-playing-name', text: def?.name ?? '' }),
      el('div', { class: 'title-playing-blurb', text: def?.blurb ?? '' }),
      el('div', { class: 'title-playing-rows' }, [
        row('PASSIVE', def?.cardPassive ?? def?.passive.desc ?? ''),
        row('ABILITY', def?.ability.name ?? ''),
        row('CARRIES', WEAPONS[def?.startingWeapon ?? '']?.name ?? def?.startingWeapon ?? ''),
      ]),
    ])

    const rail = el('div', { class: 'title-rail' })
    CLASS_IDS.forEach((id, i) => {
      const c = this.heroCard(id, i)
      if (c) rail.append(c)
    })

    const foot = el('div', { class: 'title-foot' }, [
      el('span', { text: 'WASD MOVE · SPACE ABILITY · WEAPONS FIRE THEMSELVES · ESC PAUSE' }),
      el('span', { text: 'ART BY LIMEZU & PIXELLAB · MUSIC BY ABSTRACTION' }),
    ])

    this.stage.append(logo, actions, playing, rail, foot)
  }

  /** One class card: the hero-card design from v1, which already worked. */
  private heroCard(id: string, index: number): HTMLElement | null {
    const def = CLASSES[id]
    if (!def) return null
    const locked = !this.unlocked.has(id)
    const price = this.prices.get(id)
    const bars = def.bars ?? { body: 50, speed: 50, reach: 50 }
    const selected = id === this.selected

    const figure = el('div', { class: 'hero-window' })
    const portrait = spriteEl(`portrait.${id}`, 4096, 1)
    const sprite = portrait ?? spriteEl(`${id}.idle.down.0`, 4096, 2)
    if (sprite) {
      sprite.classList.add('hero-figure')
      if (portrait) sprite.classList.add('is-portrait')
      figure.append(sprite)
    }
    figure.append(el('div', { class: 'hero-horizon' }), el('div', { class: 'hero-shade' }))
    if (locked) {
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
          el('span', { text: (WEAPONS[def.startingWeapon]?.name ?? def.startingWeapon).toUpperCase() }),
        ]),
      ]),
    ])
    card.style.animationDelay = `${index * 70}ms`
    card.onclick = () => {
      if (locked) { this.onHomestead?.(); return }
      if (selected) { this.start(); return }
      this.choose(id)
    }
    return card
  }

  setUnlocked(ids: readonly string[], prices?: ReadonlyMap<string, number>, acres = 0): void {
    this.unlocked = new Set(ids)
    if (prices) this.prices = new Map(prices)
    this.acres = acres
    if (!this.unlocked.has(this.selected)) {
      this.selected = CLASS_IDS.find((id) => this.unlocked.has(id)) ?? CLASS_IDS[0]
      this.onSelect?.(this.selected)
    }
    this.render()
  }

  get selectedClass(): string {
    return this.selected
  }

  open(): void {
    this.isOpen = true
    this.root.style.display = ''
    this.fit()
  }

  close(): void {
    this.isOpen = false
    this.root.style.display = 'none'
  }

  private fit(): void {
    const doc = document.documentElement
    const s = Math.min(doc.clientWidth / 1920, doc.clientHeight / 1080)
    this.root.style.setProperty('--scene', String(s))
  }
}

function row(label: string, value: string): HTMLElement {
  return el('div', { class: 'title-playing-row' }, [
    el('span', { class: 'title-playing-key', text: label }),
    el('span', { class: 'title-playing-val', text: value }),
  ])
}

function bar(label: string, pct: number): HTMLElement {
  const fill = el('div', { class: 'hero-bar-fill' })
  fill.style.width = `${Math.max(0, Math.min(100, pct))}%`
  return el('div', { class: 'hero-bar' }, [
    el('span', { class: 'hero-bar-label', text: label }),
    el('div', { class: 'hero-bar-track' }, [fill]),
  ])
}
