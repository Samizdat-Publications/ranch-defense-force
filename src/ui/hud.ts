/**
 * The HUD: everything on the edges, nothing in the middle or along the bottom
 * centre, where the fight is (docs/V2.md D6).
 *
 *  - Top left, the STATUS TAG: the class portrait, HP with the delayed white
 *    chaser, the level badge on its XP bar, armour pips.
 *  - Top centre, the DAY DIAL: the sun (or moon) on its arc over the field,
 *    the clock, the wave and what is left of it. A run is one day, and this is
 *    where the player reads how much of it is left. The boss bar hangs under it.
 *  - Top right, feed.
 *  - Bottom left, the class ability with a radial cooldown.
 *  - Bottom right, the carried weapons: small tiles, tier pips, cooldown wipes.
 *
 * Updated every frame from the world, but writes to the DOM only when a value
 * changes.
 */
import { ELEMENTS, ENEMIES, ITEMS, TUNING, WAVES, WEAPONS, itemCardSprite, weaponCardSprite } from '../content'
import type { World } from '../sim/world'
import { clear, el } from './dom'
import { frameOf, spriteEl } from './sprite'
import { dayProgress } from '../render/daylight'

function weaponArtKey(id: string, tier: number): string | null {
  const key = weaponCardSprite(id, tier)
  return key && frameOf(key) ? key : null
}

/**
 * The one item id whose `element` matches, or `null` for `'none'`. Exported so
 * a test can check the Load label against content without a DOM.
 */
export function loadItemFor(element: string): string | null {
  if (element === 'none') return null
  for (const id in ITEMS) if ((ITEMS[id] as { element?: string }).element === element) return id
  return null
}

const DAY = (TUNING as unknown as { daylight: { clockStart: number; clockEnd: number } }).daylight

/** "4:12 PM" for a fractional hour. */
function clockText(hour: number): string {
  const h24 = Math.floor(hour) % 24
  const m = Math.floor((hour - Math.floor(hour)) * 60)
  const h12 = ((h24 + 11) % 12) + 1
  return `${h12}:${String(m).padStart(2, '0')} ${h24 < 12 ? 'AM' : 'PM'}`
}

export class Hud {
  private readonly root: HTMLElement
  private readonly hpFill: HTMLElement
  private readonly hpChase: HTMLElement
  private readonly hpText: HTMLElement
  private readonly hpBar: HTMLElement
  private readonly armour: HTMLElement
  private armourShown = -1
  private readonly levelBadge: HTMLElement
  private readonly xpFill: HTMLElement
  private readonly portrait: HTMLElement
  private readonly sun: HTMLElement
  private readonly dial: HTMLElement
  private readonly clock: HTMLElement
  private readonly waveN: HTMLElement
  private readonly waveLeft: HTMLElement
  private readonly waveFill: HTMLElement
  private readonly feed: HTMLElement
  private readonly weapons: HTMLElement
  private readonly load: HTMLElement
  private readonly ability: HTMLElement
  private readonly abilityName: HTMLElement
  private readonly abilityKey: HTMLElement
  private readonly abilityRing: HTMLElement
  private readonly bossBar: HTMLElement
  private readonly bossFill: HTMLElement
  private readonly bossName: HTMLElement

  private lastHp = -1
  private lastHpText = ''
  private lastWave = -1
  private lastFeed = -1
  private lastLevel = -1
  private lastClock = ''
  private lastLeft = ''
  private lastSlotSig = ''
  private lastBossName = ''
  private lastLoadSig = ''
  private lastPortrait = ''
  private lastAbilityState = ''

  constructor(parent: HTMLElement) {
    this.hpChase = el('div', { class: 'hud-hp-chase' })
    this.hpFill = el('div', { class: 'hud-hp-fill' })
    this.hpText = el('div', { class: 'hud-hp-text' })
    this.hpBar = el('div', { class: 'hud-hp' }, [this.hpChase, this.hpFill, this.hpText])
    this.armour = el('div', { class: 'hud-armour' })
    this.levelBadge = el('div', { class: 'hud-level' })
    this.xpFill = el('div', { class: 'hud-xp-fill' })
    this.portrait = el('div', { class: 'hud-portrait' })

    this.sun = el('div', { class: 'hud-sun' })
    this.dial = el('div', { class: 'hud-dial' }, [el('div', { class: 'hud-dial-arc' }), this.sun])
    this.clock = el('div', { class: 'hud-clock' })
    this.waveN = el('div', { class: 'hud-wave-n' })
    this.waveLeft = el('div', { class: 'hud-wave-left' })
    this.waveFill = el('div', { class: 'hud-wave-fill' })

    this.feed = el('div', { class: 'hud-feed-n' })
    this.weapons = el('div', { class: 'hud-weapons' })
    this.load = el('div', { class: 'hud-slot hud-load' })
    this.load.style.display = 'none'

    this.abilityRing = el('div', { class: 'hud-ability-ring' })
    this.abilityName = el('div', { class: 'hud-ability-name' })
    this.abilityKey = el('div', { class: 'hud-ability-key', text: 'SPACE' })
    this.ability = el('div', { class: 'hud-ability' }, [this.abilityRing, this.abilityName, this.abilityKey])

    this.bossFill = el('div', { class: 'hud-boss-fill' })
    this.bossName = el('div', { class: 'hud-boss-name' })
    this.bossBar = el('div', { class: 'hud-boss' }, [el('div', { class: 'hud-boss-track' }, [this.bossFill]), this.bossName])
    this.bossBar.style.display = 'none'

    this.root = el('div', { class: 'hud' }, [
      el('div', { class: 'hud-status' }, [
        this.portrait,
        el('div', { class: 'hud-status-bars' }, [
          this.hpBar,
          el('div', { class: 'hud-xp-row' }, [this.levelBadge, el('div', { class: 'hud-xp' }, [this.xpFill])]),
          this.armour,
        ]),
      ]),
      el('div', { class: 'hud-day' }, [
        this.dial,
        el('div', { class: 'hud-day-text' }, [
          this.clock,
          el('div', { class: 'hud-wave-line' }, [this.waveN, this.waveLeft]),
          el('div', { class: 'hud-wave-track' }, [this.waveFill]),
        ]),
        this.bossBar,
      ]),
      el('div', { class: 'hud-feed' }, [el('div', { class: 'hud-feed-icon' }), this.feed]),
      this.ability,
      el('div', { class: 'hud-kit' }, [this.load, this.weapons]),
    ])
    parent.appendChild(this.root)
    this.fit()
    window.addEventListener('resize', this.fit)
  }

  /** The HUD's scale: viewport height over 900, clamped, published as --s. */
  private readonly fit = (): void => {
    const s = Math.min(1.6, Math.max(0.72, window.innerHeight / 900))
    this.root.style.setProperty('--s', s.toFixed(3))
  }

  update(world: World): void {
    const p = world.player

    if (p.classId !== this.lastPortrait) {
      this.lastPortrait = p.classId
      clear(this.portrait)
      const art = spriteEl(`portrait.${p.classId}`, 52) ?? spriteEl(`${p.classId}.idle.down.0`, 52)
      if (art) this.portrait.appendChild(art)
    }

    const armour = Math.max(0, Math.round(p.stats.armor))
    if (armour !== this.armourShown) {
      this.armourShown = armour
      this.armour.replaceChildren(
        ...Array.from({ length: Math.min(12, armour) }, () => el('span', { class: 'hud-armour-pip' })),
      )
    }

    const hpPct = Math.max(0, (p.hp / p.stats.maxHp) * 100)
    if (Math.abs(hpPct - this.lastHp) > 0.05) {
      this.hpFill.style.width = `${hpPct}%`
      this.hpChase.style.width = `${hpPct}%`
      this.lastHp = hpPct
      this.hpBar.classList.toggle('low', hpPct < 30)
    }
    const hpText = `${Math.ceil(Math.max(0, p.hp))} / ${Math.round(p.stats.maxHp)}`
    if (hpText !== this.lastHpText) {
      this.hpText.textContent = hpText
      this.lastHpText = hpText
    }

    this.xpFill.style.width = `${Math.min(100, (p.xp / p.xpNeeded) * 100)}%`
    if (p.level !== this.lastLevel) {
      this.levelBadge.textContent = `LV ${p.level}`
      this.lastLevel = p.level
    }

    // The day: the sun rides a half arc from the left horizon to the right,
    // then the moon takes over for the dark.
    const t = dayProgress(world)
    const hour = DAY.clockStart + (DAY.clockEnd - DAY.clockStart) * t
    const sunset = 0.84
    const onArc = t < sunset ? t / sunset : (t - sunset) / (1 - sunset)
    const a = Math.PI * (1 - onArc)
    this.sun.style.transform = `translate(${(Math.cos(a) * 42).toFixed(1)}px, ${(-Math.sin(a) * 30).toFixed(1)}px)`
    this.sun.classList.toggle('moon', t >= sunset)
    const clock = clockText(hour)
    if (clock !== this.lastClock) {
      this.clock.textContent = clock
      this.lastClock = clock
      this.dial.style.setProperty('--sky', t < 0.08 ? '#c98f6a' : t < 0.7 ? '#8fb3c9' : t < sunset ? '#c9724a' : '#2b3553')
    }

    const wave = world.spawner.wave
    if (wave !== this.lastWave) {
      const count = WAVES.waveCount as number
      this.waveN.textContent = wave > count ? 'THE DUSTER' : `WAVE ${wave} / ${count}`
      this.lastWave = wave
    }
    const left = `${Math.max(0, Math.ceil(world.spawner.waveRemaining))}s`
    if (left !== this.lastLeft) {
      this.waveLeft.textContent = left
      this.lastLeft = left
    }
    const dur = WAVES.waveDuration as number
    this.waveFill.style.transform = `scaleX(${Math.min(1, Math.max(0, world.spawner.waveTime / dur)).toFixed(3)})`

    const boss = world.findBoss()
    if (boss) {
      const pct = Math.max(0, Math.min(1, boss.hp / boss.maxHp))
      this.bossBar.style.display = ''
      this.bossFill.style.transform = `scaleX(${pct.toFixed(3)})`
      const name = ENEMIES[boss.typeId]?.name ?? 'BOSS'
      if (this.lastBossName !== name) {
        this.bossName.textContent = name
        this.lastBossName = name
      }
    } else if (this.lastBossName !== '') {
      this.bossBar.style.display = 'none'
      this.lastBossName = ''
    }

    if (p.feed !== this.lastFeed) {
      this.feed.textContent = String(p.feed)
      this.lastFeed = p.feed
    }

    const sig = p.weapons.map((w) => `${w.id}${w.tier}${weaponArtKey(w.id, w.tier) ?? '-'}`).join(',')
    if (sig !== this.lastSlotSig) {
      clear(this.weapons)
      for (const slot of p.weapons) {
        const key = weaponArtKey(slot.id, slot.tier)
        const art = key ? spriteEl(key, 34) : null
        const name = WEAPONS[slot.id]?.name ?? slot.id
        const window_ = el('div', { class: 'hud-slot-art' })
        if (art) window_.appendChild(art)
        else window_.appendChild(el('span', { class: 'hud-slot-art-fallback', text: name.slice(0, 3) }))
        const pips = el('span', { class: 'hud-slot-pips' },
          Array.from({ length: Math.min(4, slot.tier) }, () => el('i')))
        this.weapons.appendChild(
          el('div', { class: `hud-slot tier-${Math.min(4, slot.tier)}`, data: { id: slot.id }, title: name }, [
            window_, el('span', { class: 'hud-slot-cd' }), pips,
          ]),
        )
      }
      this.lastSlotSig = sig
    }

    const loadSig = `${p.element}:${p.loadStacks}`
    if (loadSig !== this.lastLoadSig) {
      this.lastLoadSig = loadSig
      clear(this.load)
      if (p.element === 'none') {
        this.load.style.display = 'none'
      } else {
        this.load.style.display = ''
        const itemId = loadItemFor(p.element)
        const key = itemId ? itemCardSprite(itemId) : null
        const art = key && frameOf(key) ? spriteEl(key, 34) : null
        const name = ELEMENTS[p.element]?.name ?? p.element
        const window_ = el('div', { class: 'hud-slot-art' })
        if (art) window_.appendChild(art)
        else window_.appendChild(el('span', { class: 'hud-slot-art-fallback', text: name.slice(0, 3) }))
        const maxStacks = itemId ? (ITEMS[itemId] as { maxStacks?: number }).maxStacks : undefined
        this.load.title = name
        this.load.append(
          window_,
          ...(typeof maxStacks === 'number' && maxStacks > 1
            ? [el('span', { class: 'hud-load-stacks', text: `${p.loadStacks}/${maxStacks}` })]
            : []),
        )
      }
    }

    const slotEls = this.weapons.children
    for (let i = 0; i < p.weapons.length && i < slotEls.length; i++) {
      const slot = p.weapons[i]
      const def = WEAPONS[slot.id]
      const cd = slotEls[i].querySelector('.hud-slot-cd') as HTMLElement | null
      if (!cd || !def) continue
      const frac = def.cooldown > 0 ? Math.max(0, slot.cooldownLeft / def.cooldown) : 0
      cd.style.transform = `scaleY(${frac.toFixed(3)})`
    }

    const ready = p.abilityCooldown <= 0 && p.abilityActive <= 0
    const active = p.abilityActive > 0
    const total = (p.def.ability as { cooldown?: number }).cooldown ?? 10
    const frac = ready ? 1 : active ? 1 : 1 - Math.max(0, Math.min(1, p.abilityCooldown / total))
    this.abilityRing.style.setProperty('--p', `${(frac * 360).toFixed(1)}deg`)
    const state = ready ? 'ready' : active ? 'active' : 'cooling'
    if (state !== this.lastAbilityState) {
      this.ability.className = `hud-ability ${state}`
      this.abilityName.textContent = p.def.ability.name
      this.lastAbilityState = state
    }
  }

  setVisible(v: boolean): void {
    this.root.style.display = v ? '' : 'none'
  }

  destroy(): void {
    window.removeEventListener('resize', this.fit)
    this.root.remove()
  }
}
