/**
 * Title and class picker. Minimal by design — the framed panels, portraits and
 * the Homestead entrance land in M6/M7. What it does carry from day one is the
 * seed box, because a run you can't reproduce is a bug you can't chase.
 *
 * The LimeZu credit is here because the UI pack's licence asks for it.
 */
import { CLASSES, CLASS_IDS } from '../content'
import { clear, el } from './dom'

export class MenuScreen {
  private readonly root: HTMLElement
  private readonly seedInput: HTMLInputElement
  private selected = CLASS_IDS[0]
  private cardsEl!: HTMLElement
  /** Which classes the save has paid for. Set by main before every open(). */
  private unlocked = new Set<string>(CLASS_IDS.filter((id) => CLASSES[id]?.unlocked === true))

  constructor(parent: HTMLElement, private readonly onStart: (classId: string, seed: string) => void) {
    this.seedInput = el('input', { class: 'seed' }) as HTMLInputElement
    this.seedInput.placeholder = 'seed (blank = random)'
    this.seedInput.style.fontFamily = 'inherit'
    this.seedInput.style.padding = '6px'
    this.seedInput.style.background = '#1c1814'
    this.seedInput.style.color = '#d9c9a3'
    this.seedInput.style.border = '2px solid #6b5a3e'

    const cards = el('div', { class: 'cards' })
    this.cardsEl = cards

    this.root = el('div', { class: 'screen' }, [
      el('div', { class: 'screen-inner' }, [
        el('h1', { text: 'RANCH DEFENSE FORCE' }),
        el('h2', {
          text: 'Something came off the crop duster that went over low on Tuesday. Work the field until the light goes.',
        }),
        cards,
        el('div', { class: 'actions' }, [
          this.seedInput,
          el('button', {
            class: 'btn primary',
            text: 'Head out →',
            onClick: () => this.onStart(this.selected, this.seedInput.value.trim()),
          }),
        ]),
        el('div', {
          class: 'card-key',
          style: { marginTop: '18px', textAlign: 'center' },
          text: 'WASD / arrows / left stick to move · Space or RT for your ability · weapons fire themselves',
        }),
        el('div', {
          class: 'card-key',
          style: { marginTop: '6px', textAlign: 'center' },
          text: 'Art by LimeZu (limezu.itch.io)',
        }),
      ]),
    ])
    this.root.style.display = 'none'
    parent.appendChild(this.root)
    this.root.style.display = 'none'
    parent.appendChild(this.root)
    this.renderCards()
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
    const cards = this.cardsEl
    clear(cards)
    for (const id of CLASS_IDS) {
      if (!this.unlocked.has(id)) continue
      const def = CLASSES[id]
      const card = el('div', {
        class: 'card',
        data: { id },
        onClick: () => this.select(id, cards),
      }, [
        el('div', { class: 'card-name', text: def.name }),
        el('div', { class: 'card-detail', text: def.blurb }),
        el('div', { class: 'card-delta' }, [
          el('div', { text: `${def.passive.desc}` }),
          el('div', { text: `${def.ability.name}: ${def.ability.desc}` }),
        ]),
        el('div', { class: 'card-cost', text: `Starts with ${def.startingWeapon}` }),
      ])
      cards.appendChild(card)
    }
    // Selection may have pointed at a class that is no longer offered.
    if (!this.unlocked.has(this.selected)) this.selected = CLASS_IDS[0]
    this.select(this.selected, cards)
  }

  private select(id: string, cards: HTMLElement): void {
    this.selected = id
    for (const child of Array.from(cards.children)) {
      const isSel = (child as HTMLElement).dataset.id === id
      child.classList.toggle('rarity-rare', isSel)
    }
  }

  /** Called by main from the save, before opening. */
  setUnlocked(ids: readonly string[]): void {
    this.unlocked = new Set(ids)
    this.renderCards()
  }

  open(): void {
    this.root.style.display = ''
  }

  close(): void {
    this.root.style.display = 'none'
  }

  get visible(): boolean {
    return this.root.style.display !== 'none'
  }
}
