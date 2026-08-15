/**
 * Results (§12). Wave reached, time, kills, damage, the build you ended with,
 * acres earned and the seed.
 *
 * "Run it back" restarts immediately with the same class — never make the
 * player walk back through a menu. The Homestead button lands in M7.
 */
import { ITEMS, WEAPONS } from '../content'
import type { World } from '../sim/world'
import { el } from './dom'

export class ResultsScreen {
  private readonly root: HTMLElement
  private readonly inner: HTMLElement

  constructor(parent: HTMLElement) {
    this.inner = el('div', { class: 'screen-inner' })
    this.root = el('div', { class: 'results-wrap' }, [this.inner])
    this.root.style.display = 'none'
    parent.appendChild(this.root)
  }

  get visible(): boolean {
    return this.root.style.display !== 'none'
  }

  /**
   * @param acres what was actually banked, passed in rather than recomputed —
   *              two independent calculations of the same number drift, and the
   *              one the player reads must be the one they were paid.
   */
  open(
    world: World, cleared: boolean, acres: number,
    onRunItBack: () => void, onMenu: () => void, onHomestead?: () => void,
  ): void {
    const p = world.player
    const mins = Math.floor(world.elapsed / 60)
    const secs = Math.floor(world.elapsed % 60)

    // The tally. Seed last, because it is a reference rather than a result.
    const rows: [string, string][] = [
      ['Wave reached', String(world.spawner.wave)],
      ['Time survived', `${mins}:${String(secs).padStart(2, '0')}`],
      ['Kills', String(world.kills)],
      ['Crops harvested', String(world.cropsHarvested)],
      ['Damage dealt', String(Math.round(world.damageDealt))],
      ['Level reached', String(p.level)],
      ['Feed left', String(p.feed)],
      ['Seed', String(world.seed)],
    ]

    const statRow = ([label, value]: [string, string], i: number): HTMLElement => {
      const row = el('div', { class: 'psheet-stat' }, [
        el('span', { class: 'psheet-stat-label', text: label }),
        el('span', { class: 'psheet-stat-lead' }),
        el('b', { class: 'psheet-stat-value', text: value }),
      ])
      row.style.animationDelay = `${i * 45}ms`
      return row
    }

    // Chips, not a comma list: the build is the thing you want to read back.
    const chips = el('div', { class: 'psheet-chips' })
    for (const w of p.weapons) {
      chips.append(el('span', {
        class: 'psheet-chip',
        text: `${WEAPONS[w.id]?.name ?? w.id} T${w.tier}`,
      }))
    }
    for (const it of p.items) {
      chips.append(el('span', {
        class: 'psheet-chip',
        text: `${ITEMS[it.id]?.name ?? it.id}${it.boosted ? ' 2x' : ''}`,
      }))
    }
    if (!p.weapons.length && !p.items.length) {
      chips.append(el('span', { class: 'psheet-chip', text: 'nothing' }))
    }

    // Where the acres came from, in words. A bare number tells you nothing
    // about whether you should have climbed a tier.
    const parts: string[] = []
    if (world.wavesCleared > 0) parts.push(`${world.wavesCleared} waves`)
    if (world.bossKills > 0) parts.push(`${world.bossKills} boss${world.bossKills > 1 ? 'es' : ''}`)
    const note = parts.length
      ? `${parts.join(' and ')}${world.tier > 1 ? `, at Tier ${world.tier}` : ''}.`
      : 'Nothing banked. Clear a wave to earn.'

    this.inner.replaceChildren(
      el('div', { class: 'results' }, [
        el('div', { class: 'results-head' }, [
          el('h1', {
            class: 'results-title',
            text: cleared ? 'The light goes' : 'You stopped',
          }),
          el('p', {
            class: 'results-sub',
            text: cleared
              ? 'You worked the field until the light went.'
              : 'The hands got you. They were people on Tuesday.',
          }),
        ]),
        el('div', { class: 'results-grid' }, [
          el('div', { class: 'psheet' }, [
            el('div', { class: 'psheet-body' }, [
              el('div', { class: 'psheet-head' }, [
                el('h2', { class: 'psheet-title', text: "The day's sheet" }),
                el('span', { class: 'psheet-hint', text: cleared ? 'Field cleared' : 'Field lost' }),
              ]),
              el('div', { class: 'psheet-rule' }),
              el('div', { class: 'psheet-stats' }, rows.map(statRow)),
              el('div', { class: 'psheet-rule', style: { marginTop: '22px' } }),
              el('div', { class: 'psheet-section', text: 'The build you ended with' }),
              chips,
              el('div', { style: { height: '18px' } }),
            ]),
          ]),
          el('div', { style: { display: 'flex', flexDirection: 'column', gap: '18px' } }, [
            el('div', { class: 'results-acres' }, [
              el('div', { class: 'psheet-section', text: 'Banked at the Homestead' }),
              el('div', { class: 'results-stamp' }, [
                el('span', { class: 'results-stamp-n', text: String(acres) }),
                el('span', { class: 'results-stamp-unit', text: 'ACRES' }),
              ]),
              el('div', { class: 'results-acres-note', text: note }),
            ]),
          ]),
        ]),
        el('div', { class: 'results-actions' }, [
          el('button', { class: 'btn btn-primary', text: 'Run it back', onClick: () => { this.close(); onRunItBack() } }),
          // Only offered when there is something to spend — §12 says never make
          // the player walk through a menu, and an empty Homestead is a menu.
          acres > 0 && onHomestead
            ? el('button', { class: 'btn', text: 'The Homestead', onClick: () => { this.close(); onHomestead() } })
            : null,
          el('button', { class: 'btn', text: 'Menu', onClick: () => { this.close(); onMenu() } }),
        ]),
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
