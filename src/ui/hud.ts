/**
 * HUD (§12). Everything hugs the edges; the centre stays clear. The HP bar has
 * the delayed white chaser so a big hit reads as a big hit, and the XP bar
 * spans the bottom because it is the one element the player actually watches.
 *
 * Updated from the world every frame, but only writes to the DOM when a value
 * actually changes — layout thrash in a 60fps loop is not free.
 */
import { ELEMENTS, ENEMIES, ITEMS, WEAPONS, itemCardSprite, weaponCardSprite } from '../content'
import type { World } from '../sim/world'
import { clear, el } from './dom'
import { frameOf, spriteEl } from './sprite'

/**
 * Which art a weapon slot draws.
 *
 * THE KEY COMES FROM CONTENT, NEVER FROM THE ID. `weapon.<id>` looks like it
 * would work and resolves for only five of the sixteen — the atlas still carries
 * the pre-rename ids (`axe`, `chiliShot`, `eggToss`), and every ranged weapon
 * draws a gun from a different family entirely (`gun.shotgun.0`). Eleven slots
 * would have quietly fallen back to a text caption, which is the thing this
 * change exists to remove.
 *
 * `weaponCardSprite` answers it now, in content, because the offer cards ask the
 * same question and answering it in two places is how the two drift apart. It
 * is also where the Harpoon Gun's exception lives: its `gun.pistol.*` family is
 * three pixels by two at T1, so the slot drew a blank rectangle at every tier.
 *
 * Verified: all 64 weapon-tier icons resolve in the packed atlas.
 */
function weaponArtKey(id: string, tier: number): string | null {
  const key = weaponCardSprite(id, tier)
  return key && frameOf(key) ? key : null
}

/**
 * The one item id whose `element` matches, or `null` for `'none'`.
 *
 * Nine items, one family (items.json `_familyNote`) and each names a
 * DIFFERENT element, so this is always exactly one match — not a lookup
 * table because a tenth Load should not need a second place to register.
 *
 * Exported so `tests/` can check the HUD's Load label against content
 * without a DOM: this repo has no jsdom/happy-dom dependency (the
 * dependency cap in CLAUDE.md), so the HUD's actual markup is checked by
 * screenshot tools (`npm run scene`, `npm run cards`), and this is the pure
 * piece of that markup's logic a plain test CAN reach.
 */
export function loadItemFor(element: string): string | null {
  if (element === 'none') return null
  for (const id in ITEMS) if ((ITEMS[id] as { element?: string }).element === element) return id
  return null
}

export class Hud {
  private readonly root: HTMLElement
  private readonly hpFill: HTMLElement
  private readonly hpChase: HTMLElement
  private readonly hpText: HTMLElement
  private readonly armour: HTMLElement
  /** Last armour value rendered; the pips are only rebuilt when it changes. */
  private armourShown = -1
  private readonly waveN: HTMLElement
  private readonly waveTimer: HTMLElement
  private readonly feed: HTMLElement
  private readonly xpFill: HTMLElement
  private readonly levelText: HTMLElement
  private readonly weapons: HTMLElement
  /** The active Load, beside the weapon ring — see `Player.element`. */
  private readonly load: HTMLElement
  private readonly ability: HTMLElement
  private readonly bossBar: HTMLElement
  private readonly bossFill: HTMLElement
  private readonly bossName: HTMLElement

  private lastHp = -1
  private lastWave = -1
  private lastFeed = -1
  private lastLevel = -1
  private lastSlotSig = ''
  private lastBossName = ''
  /** `<element>:<stacks>` — rebuilds the Load slot only when either changes. */
  private lastLoadSig = ''

  constructor(parent: HTMLElement) {
    this.hpChase = el('div', { class: 'hud-hp-chase' })
    this.hpFill = el('div', { class: 'hud-hp-fill' })
    this.hpText = el('div', { class: 'hud-hp-text' })
    this.armour = el('div', { class: 'hud-armour' })
    this.waveN = el('div', { class: 'hud-wave-n' })
    this.waveTimer = el('div', { class: 'hud-wave-timer' })
    this.feed = el('div', { class: 'hud-feed' })
    this.xpFill = el('div', { class: 'hud-xp-fill' })
    this.levelText = el('div', { class: 'hud-level' })
    this.weapons = el('div', { class: 'hud-weapons' })
    this.load = el('div', { class: 'hud-slot hud-load' })
    this.load.style.display = 'none'
    this.ability = el('div', { class: 'hud-ability' })
    // §9: pinned to the top of the screen, not floating over the sprite. A bar
    // over a boss that crosses the whole arena would spend the fight behind
    // him, which is exactly when you need to read it.
    this.bossFill = el('div', { class: 'hud-boss-fill' })
    this.bossName = el('div', { class: 'hud-boss-name' })
    this.bossBar = el('div', { class: 'hud-boss' }, [this.bossFill, this.bossName])
    this.bossBar.style.display = 'none'

    this.root = el('div', { class: 'hud' }, [
      el('div', { class: 'hud-hp' }, [this.hpChase, this.hpFill, this.hpText]),
      this.armour,
      el('div', { class: 'hud-wave' }, [this.waveN, this.waveTimer]),
      this.feed,
      el('div', { class: 'hud-weapon-row' }, [this.weapons, this.load]),
      this.ability,
      this.levelText,
      el('div', { class: 'hud-xp' }, [this.xpFill]),
      this.bossBar,
    ])
    parent.appendChild(this.root)
  }

  update(world: World): void {
    // Armour, as the same diamond the rarity plate uses for a pip. Rebuilt only
    // when the number changes — the HUD writes to the DOM on change, never per
    // frame, and eight divs a frame would be eight divs a frame.
    const armour = Math.max(0, Math.round(world.player.stats.armor))
    if (armour !== this.armourShown) {
      this.armourShown = armour
      this.armour.replaceChildren(
        ...Array.from({ length: Math.min(12, armour) }, () =>
          el('span', { class: 'hud-armour-pip' })),
      )
    }

    const boss = world.findBoss()
    if (boss) {
      const pct = Math.max(0, Math.min(1, boss.hp / boss.maxHp))
      this.bossBar.style.display = ''
      this.bossFill.style.width = `${(pct * 100).toFixed(1)}%`
      const name = ENEMIES[boss.typeId]?.name ?? 'BOSS'
      if (this.lastBossName !== name) {
        this.bossName.textContent = name
        this.lastBossName = name
      }
    } else if (this.lastBossName !== '') {
      this.bossBar.style.display = 'none'
      this.lastBossName = ''
    }

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

    /*
       The slots carry the weapon's ART, per §12: "bottom-centre weapon ring,
       128px slots, cooldown wipe + tier chip". They used to carry its NAME, so
       six weapons read as six words and the wipe — the one thing that shows a
       weapon firing — drained down a text chip.
       The art key is part of the signature, not just id and tier. Screens are
       built before the atlas resolves (HANDOFF rule 4), so a slot built early
       would draw an empty window and, keyed on id alone, would never rebuild
       when the art landed. Keying on what actually resolved means it does.
    */
    const sig = p.weapons.map((w) => `${w.id}${w.tier}${weaponArtKey(w.id, w.tier) ?? '-'}`).join(',')
    if (sig !== this.lastSlotSig) {
      clear(this.weapons)
      for (const slot of p.weapons) {
        const key = weaponArtKey(slot.id, slot.tier)
        const art = key ? spriteEl(key, 60) : null
        const name = WEAPONS[slot.id]?.name ?? slot.id
        const window_ = el('div', { class: 'hud-slot-art' })
        // No art is a caption in the window rather than an empty box.
        if (art) window_.appendChild(art)
        else window_.appendChild(el('span', { class: 'hud-slot-art-fallback', text: name }))

        this.weapons.appendChild(
          el('div', { class: 'hud-slot', data: { id: slot.id } }, [
            window_,
            el('span', { class: 'hud-slot-name', text: name }),
            el('span', { class: 'hud-slot-cd' }),
            el('span', { class: 'hud-slot-tier', text: String(slot.tier) }),
          ]),
        )
      }
      this.lastSlotSig = sig
    }

    /*
       The active Load, beside the weapon ring rather than folded into it: a
       Load is not a weapon slot, it converts every one of them, and the
       owner's own words after a run were that it "was not apparent" a Load
       was doing anything at all. Icon + name, in the same panel language as
       a weapon slot (`.hud-slot`), so it reads as the SAME kind of thing a
       weapon slot is rather than a new HUD element to learn. The stack chip
       reuses `.hud-slot-tier` for the same reason `describeItem`'s "n/max"
       reuses the footer counter instead of inventing a second one.
    */
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
        const art = key && frameOf(key) ? spriteEl(key, 60) : null
        const name = ELEMENTS[p.element]?.name ?? p.element
        const window_ = el('div', { class: 'hud-slot-art' })
        if (art) window_.appendChild(art)
        else window_.appendChild(el('span', { class: 'hud-slot-art-fallback', text: name }))
        const maxStacks = itemId ? (ITEMS[itemId] as { maxStacks?: number }).maxStacks : undefined
        this.load.append(
          window_,
          el('span', { class: 'hud-slot-name', text: name }),
          ...(typeof maxStacks === 'number' && maxStacks > 1
            ? [el('span', { class: 'hud-slot-tier', text: `${p.loadStacks}/${maxStacks}` })]
            : []),
        )
      }
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
