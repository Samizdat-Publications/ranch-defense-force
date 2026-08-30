/**
 * The player: movement, health, the owned build, and the two class passives.
 *
 * Stats are resolved once whenever the build changes (level-up, shop purchase),
 * never per tick — `resolve()` is the only place `resolveStats` is called.
 */
import { CLASSES, NODES, TUNING, type ClassDef, type StatMods } from '../content'
import { emptyDerived, resolveStats, type DerivedStats } from './stats'
import { xpToNext } from './formulas'

const P = TUNING.player
/** The arc the carried weapons fan across. See `layOutWeaponRing`. */
const RING_SPREAD_DEGREES = (TUNING.fx as unknown as Record<string, number>).weaponRingSpreadDegrees

export interface OwnedItem {
  id: string
  /** Doubled magnitude — the level-up screen's boosted pick. */
  boosted: boolean
}

export interface WeaponSlot {
  id: string
  /** 1-4. Each tier is base damage x1.6 plus its rider from weapons.json. */
  tier: number
  cooldownLeft: number
  /** Per-weapon scratch: orbit angle, minion index, and so on. */
  t0: number

  // --- what the weapon ring around the player draws from -----------------
  // The sim owns these because targeting is a simulation decision; the
  // renderer reads them and never works out who a weapon is pointing at.

  /** Where this weapon is pointing, radians. */
  aimAngle: number
  /** Seconds of firing kick left, counted down by the weapon pass. Drives the
   *  visible recoil, which is most of what makes a full ring read as six
   *  weapons working rather than one player with a lot of icons. */
  recoil: number
  /** Position in the ring, radians, assigned on pickup so weapons do not all
   *  shuffle round when one is added. */
  ringAngle: number
}

export const MAX_WEAPON_SLOTS = 6

/**
 * Highest index into a tool's tier list in nodes.json.
 *
 * The `_`-prefixed filter is not cosmetic. This project documents inside its
 * JSON, so a `_note` sitting beside the real entries is normal and expected —
 * and a bare string has no `.tiers`, which crashed this at module load and took
 * three test files down with it. Anything walking a content map has to skip
 * them.
 */
const TOOL_TIER_CAP = Math.max(
  0,
  Math.min(
    ...Object.entries(NODES.tools)
      .filter(([k, v]) => !k.startsWith('_') && Array.isArray(v?.tiers))
      .map(([, t]) => t.tiers.length),
  ) - 1,
)

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

  /**
   * Harvest tool tiers, indexed into `nodes.json` -> tools -> tiers.
   *
   * Deliberately NOT weapon slots. Everyone digs and everyone chops; the tools
   * upgrade on their own ladder so mining never costs you a weapon, which is
   * the whole reason harvesting can be a real activity rather than a tax.
   */
  pickaxeTier = 0
  axeTier = 0

  /**
   * The elemental modifier on every ranged weapon, or 'none'.
   *
   * One element at a time on purpose. Letting them stack would turn a build
   * choice into a checklist, and the whole point is that picking fire means
   * not picking frost.
   */
  element = 'none'

  init(classId: string, metaMods: StatMods = {}): void {
    this.classId = classId
    this.def = CLASSES[classId]
    this.metaMods = metaMods
    this.weapons = [{
      id: this.def.startingWeapon, tier: 1, cooldownLeft: 0, t0: 0,
      aimAngle: 0, recoil: 0, ringAngle: -Math.PI / 2,
    }]
    this.items = []
    this.pickaxeTier = 0
    this.axeTier = 0
    this.element = 'none'
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

  /** How many copies of `id` this run already holds. */
  itemCount(id: string): number {
    let n = 0
    for (const it of this.items) if (it.id === id) n++
    return n
  }

  /**
   * Whether another copy may be taken.
   *
   * `maxStacks` is declared per item; absent means unlimited, which is how the
   * roster behaved before the field existed.
   */
  canTakeItem(id: string): boolean {
    const max = (ITEMS[id] as { maxStacks?: number } | undefined)?.maxStacks
    return typeof max !== 'number' || this.itemCount(id) < max
  }

  addItem(id: string, boosted = false): void {
    this.items.push({ id, boosted })

    // Tool upgrades are a tier step, not a stat. They live in items.json so
    // they flow through the same offer pool and shop as everything else, but a
    // tier cannot be expressed as a percentage in the stat block, so it is
    // applied here. Boosted offers step twice, matching the double-magnitude
    // rule the level-up screen uses for everything else.
    const def = ITEMS[id] as { toolUpgrade?: string; element?: string } | undefined

    // An element replaces whatever was on the weapons before.
    if (def?.element) this.element = def.element

    if (def?.toolUpgrade) {
      const steps = boosted ? 2 : 1
      const cap = TOOL_TIER_CAP
      if (def.toolUpgrade === 'pickaxe') this.pickaxeTier = Math.min(cap, this.pickaxeTier + steps)
      else if (def.toolUpgrade === 'axe') this.axeTier = Math.min(cap, this.axeTier + steps)
    }

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
      // A merge changes the art too, so it gets the same announcement.
      this.weaponFlash.set(id, 2.5)
      return true
    }
    if (this.weapons.length >= MAX_WEAPON_SLOTS) return false
    this.weapons.push({
      id, tier: 1, cooldownLeft: 0, t0: 0,
      aimAngle: 0, recoil: 0, ringAngle: 0,
    })
    this.layOutWeaponRing()
    // The ring is a readout, and a seventh icon appearing in a ring of six is
    // easy to miss entirely — which is exactly what happened in play.
    this.weaponFlash.set(id, 2.5)
    return true
  }

  /**
   * Space the weapons evenly around the full circle.
   *
   * Recomputed whenever the set changes rather than derived from the index at
   * draw time, so the ring is stable state the renderer just reads — and so a
   * sixth weapon spreads the other five apart instead of appearing on top of
   * one of them.
   */
  /** Seconds of "this one is new" highlight left on each ring slot. */
  weaponFlash = new Map<string, number>()

  /**
   * Where each weapon is CARRIED, as an angle from the player's centre.
   *
   * They used to be spaced evenly around a full circle, and that is what made
   * the ring read as an ORBIT — a thing travelling around the character — where
   * the reference (Brotato) reads as gear held at his sides. A circle of evenly
   * spaced objects is the visual signature of orbiting, and no amount of art
   * fixes it.
   *
   * So they fan across an ARC centred on the way he faces, leaving a gap behind
   * his head. Same weapons, same radius, same aiming; the emptiness at the top
   * is what tells you these are being carried rather than circling.
   *
   * Angles only. Whether a weapon then draws in front of him or behind him is
   * the renderer's `liftY`/depth split, not this.
   */
  private layOutWeaponRing(): void {
    const n = this.weapons.length
    const spread = ((RING_SPREAD_DEGREES ?? 250) * Math.PI) / 180
    // PI/2 is down in screen space: in front of the character.
    const centre = Math.PI / 2
    for (let i = 0; i < n; i++) {
      const t = n === 1 ? 0.5 : i / (n - 1)
      this.weapons[i].ringAngle = centre - spread / 2 + t * spread
    }
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
  /**
   * @param slow 0-1, from any map hazard the player is standing in. Defaults to
   *             0, so every caller that predates map hazards is unchanged.
   *             `velocityFraction` stays measured against the UNSLOWED move
   *             speed on purpose — The Kid's damage scales with it, and a Kid
   *             bogged down in an oil sump should read as slow, because it is.
   */
  /**
   * @param inset extra pixels the clamp is pulled in by, on top of
   *              `arena.edgePadding`. This is the wall band: on a map whose
   *              edge is a solid wall the player must stop at its inner face,
   *              not at the arena rectangle. DEFAULTS TO 0 so every surface map
   *              -- and every seeded replay of one -- clamps exactly where it
   *              always did.
   */
  move(
    moveX: number, moveY: number, dt: number, arenaW: number, arenaH: number,
    slow = 0, inset = 0,
  ): void {
    this.px = this.x
    this.py = this.y

    if (this.rooted) {
      this.vx = 0
      this.vy = 0
    } else {
      const speed = this.stats.moveSpeed * (1 - slow)
      this.vx = moveX * speed
      this.vy = moveY * speed
      this.x += this.vx * dt
      this.y += this.vy * dt
      this.travelled += Math.hypot(this.vx, this.vy) * dt
    }
    this.anim += dt

    const pad = TUNING.arena.edgePadding + inset
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
