/**
 * The player: movement, health, the owned build, and the two class passives.
 *
 * Stats are resolved once whenever the build changes (level-up, shop purchase),
 * never per tick — `resolve()` is the only place `resolveStats` is called.
 */
import { CLASSES, TUNING, type ClassDef, type StatMods } from '../content'
import { emptyDerived, resolveStats, type DerivedStats } from './stats'
import { xpToNext } from './formulas'

const P = TUNING.player

export interface OwnedItem {
  id: string
  /** Doubled magnitude — the level-up screen's boosted pick. */
  boosted: boolean
}

export interface WeaponSlot {
  id: string
  /** 1-4. Each tier is base damage x1.6 plus a rider (riders land in M5). */
  tier: number
  cooldownLeft: number
  /** Per-weapon scratch: orbit angle, minion index, and so on. */
  t0: number
}

export const MAX_WEAPON_SLOTS = 6

export class Player {
  classId = 'hand'
  def!: ClassDef

  x = 0
  y = 0
  px = 0
  py = 0
  vx = 0
  vy = 0
  facing = 0
  radius = P.baseRadius

  /** Animation phase and distance travelled — the renderer's only inputs for
   *  choosing a walk frame and a bob offset. */
  anim = 0
  travelled = 0

  hp = 1
  invuln = 0
  /** Seconds since the player last moved — The Hand's Braced passive. */
  stillFor = 0
  /** Current speed as a fraction of max — The Kid's Momentum passive. */
  velocityFraction = 0

  level = 1
  xp = 0
  xpNeeded = xpToNext(1)
  feed = 0

  abilityCooldown = 0
  abilityActive = 0
  /** Set while Dig In holds the player in place. */
  rooted = false

  weapons: WeaponSlot[] = []
  /** Owned passives. A boosted copy came off the level-up screen's guaranteed
   *  uncommon slot and counts double. */
  items: OwnedItem[] = []

  readonly stats: DerivedStats = emptyDerived()
  /** Sources fed to the resolver. Index 0 is always the class block. */
  private readonly sources: StatMods[] = []
  /** Permanent Feed Store bonuses, applied for the whole run. */
  metaMods: StatMods = {}

  /** Damage bonus from the active class passive, as a percentage. Recomputed
   *  each tick and folded in at damage time, not into the stat block — it
   *  changes every frame and the resolver is not for per-tick values. */
  passiveDamagePct = 0
  /** Damage reduction from the active class passive, 0..1. */
  passiveDamageReduction = 0

  init(classId: string, metaMods: StatMods = {}): void {
    this.classId = classId
    this.def = CLASSES[classId]
    this.metaMods = metaMods
    this.weapons = [{ id: this.def.startingWeapon, tier: 1, cooldownLeft: 0, t0: 0 }]
    this.items = []
    this.level = 1
    this.xp = 0
    this.xpNeeded = xpToNext(1)
    this.feed = 0
    this.abilityCooldown = 0
    this.abilityActive = 0
    this.rooted = false
    this.invuln = 0
    this.stillFor = 0
    this.resolve()
    this.hp = this.stats.maxHp
  }

  /** Rebuild the stat block. Called on build changes only. */
  resolve(): void {
    this.sources.length = 0
    this.sources.push(this.def.stats)
    this.sources.push(this.metaMods)
    for (const owned of this.items) {
      const item = ITEM_MODS[owned.id]
      if (!item) continue
      // A boosted copy is worth two — pushed twice rather than scaled, so the
      // resolver stays a pure additive sum and nothing multiplies.
      this.sources.push(item)
      if (owned.boosted) this.sources.push(item)
    }
    const before = this.stats.maxHp
    resolveStats(this.sources, this.stats)
    // Gaining max HP heals by the same amount, so a Feed Sack is never a
    // downgrade in the moment; losing it clamps instead.
    const gained = this.stats.maxHp - before
    if (gained > 0) this.hp += gained
    if (this.hp > this.stats.maxHp) this.hp = this.stats.maxHp
  }

  /** The stat sources, for the UI's delta preview. */
  get statSources(): readonly StatMods[] {
    return this.sources
  }

  addItem(id: string, boosted = false): void {
    this.items.push({ id, boosted })
    this.resolve()
  }

  /** Ids only, for the results screen and anything that just wants names. */
  get itemIds(): string[] {
    return this.items.map((i) => i.id)
  }

  /**
   * Add a weapon, or merge it up a tier if already owned (§7). Returns false
   * only when the slots are full and the weapon is new.
   */
  addWeapon(id: string, tierJump = 1): boolean {
    const existing = this.weapons.find((w) => w.id === id)
    if (existing) {
      existing.tier = Math.min(4, existing.tier + tierJump)
      return true
    }
    if (this.weapons.length >= MAX_WEAPON_SLOTS) return false
    this.weapons.push({ id, tier: 1, cooldownLeft: 0, t0: 0 })
    return true
  }

  hasWeapon(id: string): boolean {
    return this.weapons.some((w) => w.id === id)
  }

  weaponAtMaxTier(id: string): boolean {
    const w = this.weapons.find((s) => s.id === id)
    return w !== undefined && w.tier >= 4
  }

  /** True when a new weapon could not be taken — used to filter the card pool. */
  get slotsFull(): boolean {
    return this.weapons.length >= MAX_WEAPON_SLOTS
  }

  gainXp(amount: number): number {
    let levels = 0
    this.xp += amount
    while (this.xp >= this.xpNeeded) {
      this.xp -= this.xpNeeded
      this.level++
      this.xpNeeded = xpToNext(this.level)
      levels++
    }
    return levels
  }

  /**
   * Movement, clamped to the arena (tick order step 2). `moveX/moveY` come
   * straight off the sampled input and are already normalised.
   */
  move(moveX: number, moveY: number, dt: number, arenaW: number, arenaH: number): void {
    this.px = this.x
    this.py = this.y

    if (this.rooted) {
      this.vx = 0
      this.vy = 0
    } else {
      const speed = this.stats.moveSpeed
      this.vx = moveX * speed
      this.vy = moveY * speed
      this.x += this.vx * dt
      this.y += this.vy * dt
      this.travelled += Math.hypot(this.vx, this.vy) * dt
    }
    this.anim += dt

    const pad = TUNING.arena.edgePadding
    if (this.x < pad) this.x = pad
    else if (this.x > arenaW - pad) this.x = arenaW - pad
    if (this.y < pad) this.y = pad
    else if (this.y > arenaH - pad) this.y = arenaH - pad

    const moving = moveX !== 0 || moveY !== 0
    if (moving) {
      this.facing = Math.atan2(this.vy, this.vx)
      this.stillFor = 0
    } else {
      this.stillFor += dt
    }
    this.velocityFraction = this.stats.moveSpeed > 0
      ? Math.hypot(this.vx, this.vy) / this.stats.moveSpeed
      : 0

    if (this.invuln > 0) this.invuln -= dt
    if (this.abilityCooldown > 0) this.abilityCooldown -= dt
  }

  /** Class passives, recomputed every tick (§6). */
  updatePassive(dt: number): void {
    void dt
    this.passiveDamagePct = 0
    this.passiveDamageReduction = 0

    const p = this.def.passive
    if (p.id === 'braced') {
      const delay = (p.stillDelay as number) ?? 1
      const perSec = (p.drPerSec as number) ?? 6
      const max = (p.drMax as number) ?? 30
      if (this.stillFor >= delay) {
        const dr = Math.min(max, (this.stillFor - delay) * perSec)
        this.passiveDamageReduction = dr / 100
      }
    } else if (p.id === 'momentum') {
      const per = (p.dmgPerVelocityPct as number) ?? 0.5
      const max = (p.dmgMax as number) ?? 50
      this.passiveDamagePct = Math.min(max, this.velocityFraction * 100 * per)
    }

    if (this.abilityActive > 0) {
      const a = this.def.ability
      if (a.id === 'digIn') {
        const reduction = ((a.damageReductionPct as number) ?? 70) / 100
        // The ability's reduction replaces the passive's rather than stacking —
        // no multiplicative stacking anywhere (CLAUDE.md).
        this.passiveDamageReduction = Math.max(this.passiveDamageReduction, reduction)
      }
    }
  }

  regen(dt: number): void {
    if (this.hp <= 0) return
    if (this.stats.hpRegen > 0 && this.hp < this.stats.maxHp) {
      this.hp = Math.min(this.stats.maxHp, this.hp + this.stats.hpRegen * dt)
    }
  }

  get alive(): boolean {
    return this.hp > 0
  }
}

/**
 * Item stat mods, flattened once at module load. Items with a `special` and no
 * `mods` contribute nothing here — their behaviour lives in the sim.
 */
import { ITEMS } from '../content'
const ITEM_MODS: Record<string, StatMods> = {}
for (const [id, def] of Object.entries(ITEMS)) ITEM_MODS[id] = def.mods ?? {}
