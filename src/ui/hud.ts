/**
 * HUD (§12). Everything hugs the edges; the centre stays clear. The HP bar has
 * the delayed white chaser so a big hit reads as a big hit, and the XP bar
 * spans the bottom because it is the one element the player actually watches.
 *
 * Updated from the world every frame, but only writes to the DOM when a value
 * actually changes — layout thrash in a 60fps loop is not free.
 */
import { WEAPONS } from '../content'
import type { World } from '../sim/world'
import { clear, el } from './dom'

export class Hud {
  private readonly root: HTMLElement
  private readonly hpFill: HTMLElement
  private readonly hpChase: HTMLElement
  private readonly hpText: HTMLElement
  private readonly waveN: HTMLElement
  private readonly waveTimer: HTMLElement
  private readonly feed: HTMLElement
  private readonly xpFill: HTMLElement
  private readonly levelText: HTMLElement
  private readonly weapons: HTMLElement
  private readonly ability: HTMLElement

  private lastHp = -1
  private lastWave = -1
  private lastFeed = -1
  private lastLevel = -1
  private lastSlotSig = ''

  constructor(parent: HTMLElement) {
    this.hpChase = el('div', { class: 'hud-hp-chase' })
    this.hpFill = el('div', { class: 'hud-hp-fill' })
    this.hpText = el('div', { class: 'hud-hp-text' })
    this.waveN = el('div', { class: 'hud-wave-n' })
    this.waveTimer = el('div', { class: 'hud-wave-timer' })
    this.feed = el('div', { class: 'hud-feed' })
    this.xpFill = el('div', { class: 'hud-xp-fill' })
    this.levelText = el('div', { class: 'hud-level' })
    this.weapons = el('div', { class: 'hud-weapons' })
    this.ability = el('div', { class: 'hud-ability' })

    this.root = el('div', { class: 'hud' }, [
      el('div', { class: 'hud-hp' }, [this.hpChase, this.hpFill, this.hpText]),
      el('div', { class: 'hud-wave' }, [this.waveN, this.waveTimer]),
      this.feed,
      this.weapons,
      this.ability,
      this.levelText,
      el('div', { class: 'hud-xp' }, [this.xpFill]),
    ])
    parent.appendChild(this.root)
  }

  update(world: World): void {
    const p = world.player

    const hpPct = Math.max(0, (p.hp / p.stats.maxHp) * 100)
    if (Math.abs(hpPct - this.lastHp) > 0.05) {
      this.hpFill.style.width = `${hpPct}%`
      // The chaser lags the real bar via a CSS transition, so damage reads as
      // a white band draining behind the red.
      this.hpChase.style.width = `${hpPct}%`
      this.hpText.textContent = `${Math.ceil(Math.max(0, p.hp))} / ${Math.round(p.stats.maxHp)}`
      this.lastHp = hpPct
    }

    if (world.spawner.wave !== this.lastWave) {
      this.waveN.textContent = `WAVE ${world.spawner.wave}`
      this.lastWave = world.spawner.wave
    }
    this.waveTimer.textContent = `${world.spawner.waveRemaining.toFixed(0)}s`

    if (p.feed !== this.lastFeed) {
      this.feed.textContent = `${p.feed} feed`
      this.lastFeed = p.feed
    }

    this.xpFill.style.width = `${(p.xp / p.xpNeeded) * 100}%`
    if (p.level !== this.lastLevel) {
      this.levelText.textContent = `LV ${p.level}`
      this.lastLevel = p.level
    }

    const sig = p.weapons.map((w) => `${w.id}${w.tier}`).join(',')
    if (sig !== this.lastSlotSig) {
      clear(this.weapons)
      for (const slot of p.weapons) {
        this.weapons.appendChild(
          el('div', { class: 'hud-slot', data: { id: slot.id } }, [
            el('span', { class: 'hud-slot-cd' }),
            el('span', { class: 'hud-slot-tier', text: String(slot.tier) }),
            el('span', { text: WEAPONS[slot.id]?.name ?? slot.id }),
          ]),
        )
      }
      this.lastSlotSig = sig
    }

    // Cooldown wipes, cheap enough to touch every frame.
    const slotEls = this.weapons.children
    for (let i = 0; i < p.weapons.length && i < slotEls.length; i++) {
      const slot = p.weapons[i]
      const def = WEAPONS[slot.id]
      const cd = slotEls[i].querySelector('.hud-slot-cd') as HTMLElement | null
      if (!cd || !def) continue
      const frac = def.cooldown > 0 ? Math.max(0, slot.cooldownLeft / def.cooldown) : 0
      cd.style.transform = `scaleY(${frac})`
    }

    const ready = p.abilityCooldown <= 0 && p.abilityActive <= 0
    this.ability.className = ready ? 'hud-ability ready' : 'hud-ability'
    this.ability.textContent = ready
      ? `${p.def.ability.name} · SPACE`
      : `${Math.max(0, p.abilityCooldown).toFixed(1)}s`
  }

  setVisible(v: boolean): void {
    this.root.style.display = v ? '' : 'none'
  }

  destroy(): void {
    this.root.remove()
  }
}
