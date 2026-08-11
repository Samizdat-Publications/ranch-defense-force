/**
 * Results (§12). Wave reached, time, kills, damage, the build you ended with,
 * acres earned and the seed.
 *
 * "Run it back" restarts immediately with the same class — never make the
 * player walk back through a menu. The Homestead button lands in M7.
 */
import { WEAPONS } from '../content'
import type { World } from '../sim/world'
import { acresEarned } from '../sim/formulas'
import { el } from './dom'

export class ResultsScreen {
  private readonly root: HTMLElement
  private readonly inner: HTMLElement

  constructor(parent: HTMLElement) {
    this.inner = el('div', { class: 'screen-inner' })
    this.root = el('div', { class: 'screen' }, [this.inner])
    this.root.style.display = 'none'
    parent.appendChild(this.root)
  }

  get visible(): boolean {
    return this.root.style.display !== 'none'
  }

  open(world: World, cleared: boolean, onRunItBack: () => void, onMenu: () => void): void {
    const p = world.player
    const acres = acresEarned(world.wavesCleared, 0, false, 1)
    const mins = Math.floor(world.elapsed / 60)
    const secs = Math.floor(world.elapsed % 60)

    const rows: [string, string][] = [
      ['Wave reached', String(world.spawner.wave)],
      ['Time survived', `${mins}:${String(secs).padStart(2, '0')}`],
      ['Kills', String(world.kills)],
      ['Crops harvested', String(world.cropsHarvested)],
      ['Damage dealt', String(Math.round(world.damageDealt))],
      ['Level', String(p.level)],
      ['Feed left', String(p.feed)],
      ['Acres earned', String(acres)],
      ['Seed', String(world.seed)],
    ]

    const build = p.weapons
      .map((w) => `${WEAPONS[w.id]?.name ?? w.id} T${w.tier}`)
      .concat(p.items.map((i) => (i.boosted ? `${i.id} (2×)` : i.id)))
      .join(' · ')

    this.inner.replaceChildren(
      el('h1', { text: cleared ? 'THE LIGHT GOES' : 'YOU STOPPED' }),
      el('h2', {
        text: cleared
          ? 'You worked the field until the light went.'
          : 'The hands got you. They were people on Tuesday.',
      }),
      el('div', { class: 'sheet' }, rows.map(([k, v]) =>
        el('div', { class: 'stat-line' }, [
          el('span', { text: k }),
          el('span', { text: v }),
        ]),
      )),
      el('div', { class: 'sheet', style: { marginTop: '12px' } }, [
        el('h3', { text: 'The build you ended with' }),
        el('div', { class: 'card-detail', text: build || '(nothing)' }),
      ]),
      el('div', { class: 'actions' }, [
        el('button', { class: 'btn primary', text: 'Run it back', onClick: () => { this.close(); onRunItBack() } }),
        el('button', { class: 'btn', text: 'Menu', onClick: () => { this.close(); onMenu() } }),
      ]),
    )
    this.root.style.display = ''
  }

  close(): void {
    this.root.style.display = 'none'
  }

  destroy(): void {
    this.root.remove()
  }
}
