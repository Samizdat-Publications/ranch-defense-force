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

export interface OwnedItem {
  id: string
  /** Doubled magnitude — the level-up screen's boosted pick. */
  boosted: boolean
}

/**
 * H13 (docs/UPGRADE_ROSTER.md batch 4): additive overlays a class card grants
 * on top of the numbers its OWN class's passive/ability already reads off
 * `def.passive`/`def.ability` — a cap, a rate, a duration, a radius, a refund.
 * Never a multiplier: every field here is summed onto the base number at the
 * point the passive reads it, exactly once, the same rule `resolveStats`
 * already enforces for the stat block.
 *
 * A flat, fully-keyed object rather than a map, so `resolveClassBonus` never
 * allocates and every read is a property access — the same shape `stats`
 * already is. Zero for every class but the one that owns a card naming that
 * field, so a run with no class cards pays flat zeros, not branches.
 */
export interface ClassBonus {
  // The Hand / Braced
  bracedStillDelayDelta: number
  bracedDrMaxBonus: number
  bracedCapSlowPct: number
  bracedCapSlowSeconds: number
  // The Kid / Momentum
  momentumDmgMaxBonus: number
  momentumRatePctBonus: number
  momentumDecayPctPerSec: number
  boltTrailSeconds: number
  boltTrailDps: number
  // The Widow / Grit
  gritImmediatePctDelta: number
  gritWoundSecondsDelta: number
  gritKillClosePctBonus: number
  gritFullCloseHeal: number
  // The Veteran / Overwatch
  overwatchFarDistanceDelta: number
  overwatchFarDamagePctBonus: number
  overwatchNearDamagePctDelta: number
  // The Agronomist / Cultivar
  cultivarDotDurationPctBonus: number
  cultivarDotDamagePctBonus: number
  cultivarSpreadCount: number
  cultivarSpreadRadius: number
  // The Drifter / Hot Streak
  hotStreakWindowBonus: number
  hotStreakMaxStacksBonus: number
  hotStreakKeepPctOnHit: number
}

const CLASS_BONUS_KEYS = [
  'bracedStillDelayDelta', 'bracedDrMaxBonus', 'bracedCapSlowPct', 'bracedCapSlowSeconds',
  'momentumDmgMaxBonus', 'momentumRatePctBonus', 'momentumDecayPctPerSec', 'boltTrailSeconds', 'boltTrailDps',
  'gritImmediatePctDelta', 'gritWoundSecondsDelta', 'gritKillClosePctBonus', 'gritFullCloseHeal',
  'overwatchFarDistanceDelta', 'overwatchFarDamagePctBonus', 'overwatchNearDamagePctDelta',
  'cultivarDotDurationPctBonus', 'cultivarDotDamagePctBonus', 'cultivarSpreadCount', 'cultivarSpreadRadius',
  'hotStreakWindowBonus', 'hotStreakMaxStacksBonus', 'hotStreakKeepPctOnHit',
] as const satisfies readonly (keyof ClassBonus)[]

function emptyClassBonus(): ClassBonus {
  const o = {} as ClassBonus
  for (const k of CLASS_BONUS_KEYS) o[k] = 0
  return o
}

export interface WeaponSlot {
  id: string
  /** 1-4. Each tier is base damage x1.6 plus its rider from weapons.json. */
  tier: number
  cooldownLeft: number
  /** Per-weapon scratch: orbit angle, minion index, and so on. */
  t0: number
  /**
   * H12 (docs/UPGRADE_ROSTER.md §8): the weapon-upgrade cards this slot has
   * taken, by short id — `'chokeTube'`, not the item id that granted it.
   *
   * A per-slot list rather than a player-wide flag because the same short id
   * is scoped to the weapon that owns it: `hasMod(slot, 'chokeTube')` only
   * ever asks the Scattergun's own slot. `addItem` is the only writer — see
   * its `weaponMod`/`requiresWeapon` handling — and every behaviour reads it
   * beside the `tier >= n` checks that already gate the built-in riders, so a
   * run with no upgrades pays one array scan of length zero per read.
   */
  mods: string[]

  // --- what the carried loadout draws from --------------------------------
  // The sim owns these because targeting is a simulation decision; the
  // renderer reads them and never works out who a weapon is pointing at.

  /** Where this weapon is pointing, radians. */
  aimAngle: number
  /** Seconds of firing kick left, counted down by the weapon pass. Drives the
   *  visible recoil, which is most of what makes a loadout read as several
   *  weapons working rather than one player wearing a lot of objects. */
  recoil: number
  /**
   * The world tick this weapon last fired on, or -1 if it never has.
   *
   * This is what decides which weapon is IN HIS HANDS: the most recent firer
   * is held, everything else hangs off a body anchor. A tick stamp rather than
   * a seconds stamp, and set in the sim rather than inferred in the renderer,
   * because the answer has to be identical in the game, in `npm run shot` and
   * in a replay of the same seed. `recoil` cannot stand in for it — it expires
   * after 0.12s and would hand the loadout back and forth between weapons
   * between shots.
   */
  firedAt: number
}

export const MAX_WEAPON_SLOTS = 6

/**
 * H12: whether a weapon slot has taken a given upgrade.
 *
 * A standalone function rather than a method so `behaviours/weapons.ts` reads
 * it the same way it already reads `tier >= n` — beside the number, not
 * through the player. `slot.mods` is empty for every run that owns none of
 * the 48+3 cards, so this is one array scan of length zero.
 */
export function hasMod(slot: WeaponSlot, id: string): boolean {
  return slot.mods.indexOf(id) !== -1
}

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
   * Move-speed bonus from the active class passive, as a percentage.
   *
   * Percent rather than px/s, and read by `move` alongside
   * `stats.moveSpeedPct` in ONE additive sum. Multiplying it onto the already
   * derived `stats.moveSpeed` would be a second multiply on the same quantity,
   * which is exactly the stacking CLAUDE.md forbids.
   */
  passiveMoveSpeedPct = 0
  /**
   * H13: whether Braced is sitting at its own cap RIGHT NOW. False for every
   * class but The Hand, and false for him until `stillFor` has carried the
   * reduction all the way to `drMax` (+ `classBonus.bracedDrMaxBonus`).
   * Anchor Stone reads this in `World.collideEnemiesWithPlayer` rather than
   * recomputing the threshold a second time — one boolean, set where the
   * cap is already being computed.
   */
  bracedAtCap = false
  /**
   * Class pass (this session): seconds since the last successful `tryAbility`
   * call, ANY class — set in `World.tryAbility`, not per-class, because it
   * costs nothing to maintain for the five classes that never read it and a
   * per-class branch to skip it would be the more expensive thing.
   *
   * Only The Hand's Braced reads it (`abilityGraceSeconds`/`drMaxStale` in
   * classes.json), and only he initialises it non-zero: everyone else starts
   * at 0 and it is simply never compared against anything. Starting The Hand
   * at a value already past his own grace window means `idle`/`idle-buy` —
   * which press nothing, ever — get no free head start from a field that
   * happens to default low.
   */
  sinceAbility = 0

  /**
   * H13: the current class's cards, summed. Recomputed in `resolve()` —
   * never per tick — from every owned item's `ItemDef.classBonus` block,
   * exactly the way `stats` is recomputed from `ItemDef.mods`. See the
   * `ClassBonus` doc comment above.
   */
  readonly classBonus: ClassBonus = emptyClassBonus()

  /**
   * The Kid's Momentum, as actually displayed — distinct from the raw value
   * `velocityFraction` implies this tick. Equal to it for every run without
   * Following Wind, which reads straight through and decays instantly to
   * zero on stop exactly as it always has. With the card, this eases toward
   * the raw value instead of snapping to it, at `classBonus.momentumDecayPctPerSec`
   * per second — the raw value is a ceiling it decays DOWN toward, never
   * a floor it is pulled up to, so accelerating is still instant.
   */
  private momentumEcho = 0

  // ---------------------------------------------------------- class state
  // Four field groups, one per unlockable class. They are plain numbers on
  // the player rather than entities because each is singular — one wound, one
  // streak, one ward, one mine — and a pooled entity for a thing there is only
  // ever one of buys nothing and costs a free-list.

  /**
   * The Widow's Grit: damage held back from blows already taken, still to
   * land. `woundRate` is fixed each time the wound grows so the whole
   * outstanding amount always drains in `woundSeconds` from the latest blow.
   */
  wound = 0
  woundRate = 0

  /** The Drifter's Hot Streak: kills inside the current window, and how long
   *  that window has left. */
  streak = 0
  streakLife = 0

  /** The Widow's ward — Hold the Line. `wardLife > 0` means one is standing. */
  wardX = 0
  wardY = 0
  wardRadius = 0
  wardLife = 0
  wardHealPerKill = 0

  /** The Veteran's Claymore. `mineLife` is the fuse, `mineArm` the arming
   *  delay; both zero when nothing is planted. */
  mineX = 0
  mineY = 0
  mineLife = 0
  mineArm = 0

  /**
   * The Agronomist's Cultivar, as multipliers on the statuses SHE applies.
   *
   * They are 1 (and the cap 100) for every other class, so `applyHit`
   * multiplies by one rather than branching on the class — the hot path stays
   * one shape whoever is playing.
   */
  dotDamageMul = 1
  dotDurationMul = 1
  slowCapPct = 100

  /**
   * The Veteran's Overwatch, unpacked at `init` into squared distances.
   *
   * Cached rather than read off `def.passive` per hit because unlike every
   * other passive this one is evaluated PER TARGET, several hundred times a
   * second in a late wave. Both percentages zero means the passive is not this
   * class's, and `overwatchPct` leaves on the first compare.
   */
  private owFar2 = 0
  private owNear2 = 0
  private owFarPct = 0
  private owNearPct = 0

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

  /**
   * How many copies of the ACTIVE load the run holds — `tracerRounds` x3
   * reads 3, not "3 items that each independently do nothing".
   *
   * Derived, not assigned: it is a straight count of `this.items` whose
   * `ITEMS[id].element` matches `this.element`, recomputed in `addItem`
   * whenever an element card lands. Switching load — taking `coldRounds`
   * while Fire is active — does NOT clear the fire copies out of `items`
   * (the simpler of the two choices §Part 2 asked for: supersede, don't
   * refund) so this can go back UP on its own if the run ever returns to a
   * load it already invested in, which is the one place "simpler" and
   * "free" turned out to be the same answer.
   */
  loadStacks = 0

  /**
   * H10 (docs/UPGRADE_ROSTER.md batch 3): Second Wind's remaining charges.
   *
   * Set from `World.specialItems.revives` in `refreshSpecialItems`, which
   * tops it UP (never down) rather than assigning outright — the same
   * re-arm-on-any-purchase shape `firstHitShield`'s `shieldReady` already had,
   * kept deliberately rather than fought: a spent revive comes back the next
   * time the run buys anything, which is generous but consistent with the
   * precedent this batch's H9 refactor generalises.
   */
  revivesLeft = 0

  init(classId: string, metaMods: StatMods = {}): void {
    this.classId = classId
    this.def = CLASSES[classId]
    this.metaMods = metaMods
    this.weapons = [{
      id: this.def.startingWeapon, tier: 1, cooldownLeft: 0, t0: 0,
      aimAngle: 0, recoil: 0, firedAt: -1, mods: [],
    }]
    this.items = []
    this.pickaxeTier = 0
    this.axeTier = 0
    this.element = 'none'
    this.loadStacks = 0
    this.level = 1
    this.xp = 0
    this.xpNeeded = xpToNext(1)
    this.feed = 0
    this.abilityCooldown = 0
    this.abilityActive = 0
    this.rooted = false
    this.invuln = 0
    this.stillFor = 0
    this.revivesLeft = 0

    this.wound = 0
    this.woundRate = 0
    this.streak = 0
    this.streakLife = 0
    this.passiveMoveSpeedPct = 0
    this.wardLife = 0
    this.wardRadius = 0
    this.wardHealPerKill = 0
    this.mineLife = 0
    this.mineArm = 0
    this.momentumEcho = 0
    // Class pass: starts already past the grace window (rather than 0, which
    // would hand every class a few free seconds at full Braced ceiling before
    // its first ability press) — harmless for the five classes that never
    // compare it to anything.
    this.sinceAbility = ((this.def.passive.abilityGraceSeconds as number) ?? 0) + 1

    // `resolve()` below rebuilds `classBonus` off `this.items` (empty here)
    // and then unpacks the two hot-path passive caches (Overwatch, Cultivar)
    // off `def.passive` + `classBonus` together — see `unpackPassiveCache`.
    this.resolve()
    this.hp = this.stats.maxHp
  }

  /**
   * The Veteran's Overwatch, as a damage percentage against ONE target.
   *
   * Per-target, so it can live neither in the resolved stat block nor in
   * `passiveDamagePct` — both are a single number for the whole tick. It joins
   * the same additive sum inside `resolveDamage` that every other percentage
   * joins, which is what keeps the single-pass rule intact: nothing multiplies.
   *
   * Squared distances, so no `hypot` on the damage path.
   */
  overwatchPct(dx: number, dy: number): number {
    if (this.owFarPct === 0 && this.owNearPct === 0) return 0
    const d2 = dx * dx + dy * dy
    if (d2 >= this.owFar2) return this.owFarPct
    if (d2 <= this.owNear2) return this.owNearPct
    return 0
  }

  /**
   * Split an incoming blow under The Widow's Grit. Returns what lands NOW;
   * whatever is held back is banked as a wound and bleeds off in
   * `updatePassive`.
   *
   * Returns the amount unchanged for every other class, so `damagePlayer` calls
   * it unconditionally and its arithmetic is byte-identical for the classes
   * that do not have Grit.
   */
  takeWound(amount: number): number {
    const p = this.def.passive
    if (p.id !== 'grit') return amount
    // H13: Set Jaw lowers `immediatePct` — less lands at once, more is held
    // back as a wound to fight through. A pure delta on the class's own
    // number, additive like every overlay here.
    const immediatePct = ((p.immediatePct as number) ?? 100) + this.classBonus.gritImmediatePctDelta
    const now = amount * (immediatePct / 100)
    const held = amount - now
    if (held > 0) {
      this.wound += held
      // H13: Long Mourning lengthens the bleed-off.
      const secs = ((p.woundSeconds as number) ?? 5) + this.classBonus.gritWoundSecondsDelta
      this.woundRate = secs > 0 ? this.wound / secs : this.wound
    }
    return now
  }

  /** Anything that actually took HP off. The Drifter's streak dies here. */
  onHurt(): void {
    if (this.def.passive.id !== 'hotStreak') return
    /*
       H13: Cut and Run. A hit takes only a fraction of the streak rather than
       all of it — `hotStreakKeepPctOnHit` is what SURVIVES, 0 for every run
       without the card, which is the original "one hit ends all of it"
       unchanged. What survives keeps whatever life it had left rather than
       resetting it, so the card is purely "a hit costs less streak", not "a
       hit is free".
    */
    const keepPct = this.classBonus.hotStreakKeepPctOnHit
    this.streak = keepPct > 0 ? Math.floor(this.streak * (keepPct / 100)) : 0
    if (this.streak <= 0) {
      this.streak = 0
      this.streakLife = 0
    }
  }

  /**
   * One enemy just died at (x, y).
   *
   * Both kill-driven passives and The Widow's ward read it, so `killEnemy`
   * makes exactly one call and the class logic stays on the class.
   */
  onKill(x: number, y: number): void {
    const p = this.def.passive
    const cb = this.classBonus
    if (p.id === 'grit') {
      // Closing the wound IS the heal: it is damage that now never lands.
      // Self-limiting by construction — no wound, no reward for the kill —
      // which is what makes Grit pay for fighting through a hit rather than
      // for killing in general.
      if (this.wound > 0) {
        // H13: Black Dress raises how much of the wound one kill closes, and
        // adds a real heal on top of the kill that closes it fully.
        const closePct = ((p.killClosePct as number) ?? 0) + cb.gritKillClosePctBonus
        this.wound -= this.wound * (closePct / 100)
        if (this.wound < 0.001) {
          this.wound = 0
          this.woundRate = 0
          if (cb.gritFullCloseHeal > 0) {
            this.hp = Math.min(this.stats.maxHp, this.hp + cb.gritFullCloseHeal)
          }
        }
      }
    } else if (p.id === 'hotStreak') {
      // H13: Nothing To Lose raises the cap; Long Season lengthens the window.
      const max = ((p.maxStacks as number) ?? 10) + cb.hotStreakMaxStacksBonus
      if (this.streak < max) this.streak++
      this.streakLife = ((p.windowSeconds as number) ?? 3) + cb.hotStreakWindowBonus
    }

    if (this.wardLife > 0 && this.wardHealPerKill > 0) {
      const dx = x - this.wardX
      const dy = y - this.wardY
      if (dx * dx + dy * dy <= this.wardRadius * this.wardRadius) {
        this.hp = Math.min(this.stats.maxHp, this.hp + this.wardHealPerKill)
      }
    }
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

    this.resolveClassBonus()
    this.unpackPassiveCache()
  }

  /**
   * H13: rebuild `classBonus` from every owned item's `ItemDef.classBonus`
   * block. A fixed key list rather than `Object.entries` on each item's
   * bonus object, so this allocates nothing — only ever runs on a build
   * change, same as `resolve()` itself, but the discipline is free and it
   * keeps this the same shape as the hot-path reads that follow it.
   */
  private resolveClassBonus(): void {
    const cb = this.classBonus
    for (const k of CLASS_BONUS_KEYS) cb[k] = 0
    for (const owned of this.items) {
      const def = ITEMS[owned.id] as { classBonus?: Partial<ClassBonus> } | undefined
      const bonus = def?.classBonus
      if (!bonus) continue
      const mult = owned.boosted ? 2 : 1
      for (const k of CLASS_BONUS_KEYS) {
        const v = bonus[k]
        if (typeof v === 'number') cb[k] += v * mult
      }
    }
  }

  /**
   * Unpack the two passives whose parameters are read on a hot path
   * (Overwatch per-target, Cultivar per-status-application) into their
   * cached form — off `def.passive` AND `classBonus` together, so a class
   * card taken mid-run (Range Card, Cold Bore, Enfilade, Field Trial,
   * Selective Breeding) is live the instant `resolve()` runs, not only at
   * `init`. Every other class's cache stays the all-zero/all-one it always
   * was, since `classBonus`'s fields for a passive that is not this class's
   * are never set by any card that can be owned.
   */
  private unpackPassiveCache(): void {
    this.owFar2 = 0
    this.owNear2 = 0
    this.owFarPct = 0
    this.owNearPct = 0
    this.dotDamageMul = 1
    this.dotDurationMul = 1
    this.slowCapPct = 100
    const pas = this.def.passive
    const cb = this.classBonus
    if (pas.id === 'overwatch') {
      // H13: Range Card pulls the far band in; Cold Bore raises its bonus;
      // Enfilade zeroes the near penalty (its own delta cancels -20 to 0).
      const far = ((pas.farDistance as number) ?? 220) + cb.overwatchFarDistanceDelta
      const near = (pas.nearDistance as number) ?? 110
      this.owFar2 = far * far
      this.owNear2 = near * near
      this.owFarPct = ((pas.farDamagePct as number) ?? 0) + cb.overwatchFarDamagePctBonus
      this.owNearPct = ((pas.nearDamagePct as number) ?? 0) + cb.overwatchNearDamagePctDelta
    } else if (pas.id === 'cultivar') {
      // H13: Field Trial and Selective Breeding raise the duration/damage
      // multipliers Cultivar already applies at the point a status leaves a
      // projectile (World.applyHit) — additive on the PERCENTAGE, then
      // folded into the multiplier once, here, exactly as the base numbers
      // already were.
      const dmgPct = ((pas.dotDamagePct as number) ?? 0) + cb.cultivarDotDamagePctBonus
      const durPct = ((pas.dotDurationPct as number) ?? 0) + cb.cultivarDotDurationPctBonus
      this.dotDamageMul = 1 + dmgPct / 100
      this.dotDurationMul = 1 + durPct / 100
      this.slowCapPct = (pas.slowCapPct as number) ?? 100
    }
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
    const def = ITEMS[id] as
      { toolUpgrade?: string; element?: string; weaponMod?: string; requiresWeapon?: string }
      | undefined

    /*
       An element/Load replaces whatever was on the weapons before — one
       active Load, exclusive, same as it always was. What changed: the run's
       investment in a Load now actually MEANS something when you take the
       same one again. `loadStacks` is a plain count of every item this run
       owns whose `element` matches whichever one just became active, so
       Tracer Rounds x3 reads as 3 and not as three separately-inert cards.
       It is recomputed rather than incremented so switching Loads and
       switching back resumes at whatever depth was already bought — the
       "refund or supersede, pick the simpler" call landed on supersede: nothing
       is ever removed from `items`, so nothing needs refunding.
    */
    if (def?.element) {
      this.element = def.element
      this.loadStacks = this.items.filter(
        (it) => (ITEMS[it.id] as { element?: string } | undefined)?.element === def.element,
      ).length
    }

    if (def?.toolUpgrade) {
      const steps = boosted ? 2 : 1
      const cap = TOOL_TIER_CAP
      if (def.toolUpgrade === 'pickaxe') this.pickaxeTier = Math.min(cap, this.pickaxeTier + steps)
      else if (def.toolUpgrade === 'axe') this.axeTier = Math.min(cap, this.axeTier + steps)
    }

    /*
       H12 (docs/UPGRADE_ROSTER.md §8): a weapon-upgrade card attaches to the
       WEAPON's slot rather than the stat resolver. `requiresWeapon` is the
       same gate `OfferPool.gateOpen` already reads to keep the card off the
       board until the weapon is owned; `weaponMod` is the short id the
       behaviour reads back with `hasMod`. Every one of the 48+3 cards has
       `maxStacks: 1`, so this can only ever push the id once per run — the
       `indexOf` guard is defensive, not load-bearing.
    */
    if (typeof def?.weaponMod === 'string' && typeof def?.requiresWeapon === 'string') {
      const slot = this.weapons.find((w) => w.id === def.requiresWeapon)
      if (slot && slot.mods.indexOf(def.weaponMod) === -1) slot.mods.push(def.weaponMod)
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
      aimAngle: 0, recoil: 0, firedAt: -1, mods: [],
    })
    // The loadout is a readout, and one more object on an already-equipped man
    // is easy to miss entirely — which is exactly what happened in play.
    this.weaponFlash.set(id, 2.5)
    return true
  }

  /**
   * Seconds of "this one is new" highlight left on each carried weapon.
   *
   * Keyed by weapon id rather than by slot index because a merge changes a
   * weapon without adding one, and that is just as much news as a pickup is.
   */
  weaponFlash = new Map<string, number>()

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

  /**
   * The id of the lowest-tier owned weapon, or `null` with none carried.
   *
   * §7.5's `swap` offer trades this one away — "your lowest-tier weapon" — so
   * a run that filled its slots with the wrong thing in wave 2 has recourse
   * without touching a slot it has since built around. Ties go to pickup
   * order, which is the same tie-break the loadout's own hand slot uses.
   */
  lowestTierWeaponId(): string | null {
    if (this.weapons.length === 0) return null
    let best = this.weapons[0]
    for (const w of this.weapons) if (w.tier < best.tier) best = w
    return best.id
  }

  /** Drop a weapon outright — the half of a swap that is not `addWeapon`. */
  removeWeapon(id: string): void {
    const i = this.weapons.findIndex((w) => w.id === id)
    if (i >= 0) this.weapons.splice(i, 1)
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

    /*
       Top speed for this tick, with any passive bonus folded into the SAME
       additive percentage sum the resolver used. Deriving it again here rather
       than scaling `stats.moveSpeed` is the difference between one pass and
       two multiplies.

       When the bonus is zero this is the resolved value by definition, so every
       class without a per-tick speed passive — which is five of the six, and
       both of the classes whose seeds are already banked — takes the identical
       branch and replays byte for byte.
    */
    const bonus = this.passiveMoveSpeedPct
    const topSpeed = bonus !== 0
      ? Math.max(20, P.baseMoveSpeed * (1 + (this.stats.moveSpeedPct + bonus) / 100))
      : this.stats.moveSpeed

    if (this.rooted) {
      this.vx = 0
      this.vy = 0
    } else {
      const speed = topSpeed * (1 - slow)
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
    this.velocityFraction = topSpeed > 0
      ? Math.hypot(this.vx, this.vy) / topSpeed
      : 0

    if (this.invuln > 0) this.invuln -= dt
    if (this.abilityCooldown > 0) this.abilityCooldown -= dt
    this.sinceAbility += dt
  }

  /** Class passives, recomputed every tick (§6). */
  updatePassive(dt: number): void {
    this.passiveDamagePct = 0
    this.passiveDamageReduction = 0
    this.passiveMoveSpeedPct = 0
    this.bracedAtCap = false

    const p = this.def.passive
    if (p.id === 'grit') {
      /*
         The Widow's wound bleeding off.

         It is applied HERE rather than in `regen` because it is the mirror of
         regen and wants the same place in the tick: the whole of a blow is
         accounted for the instant it lands, and the schedule on which it
         actually reaches the health bar is the class. A player who kills
         through it never pays; a player who runs pays all of it.
      */
      if (this.wound > 0 && this.hp > 0) {
        const d = Math.min(this.wound, this.woundRate * dt)
        this.wound -= d
        this.hp -= d
        if (this.wound < 0.001) {
          this.wound = 0
          this.woundRate = 0
        }
      }
    } else if (p.id === 'hotStreak') {
      // The whole streak expires together rather than a stack at a time: it is
      // a window on the last kill, so one more kill renews all of it. Decaying
      // singly would make the ceiling unreachable at any honest kill rate.
      if (this.streakLife > 0) {
        this.streakLife -= dt
        if (this.streakLife <= 0) {
          this.streakLife = 0
          this.streak = 0
        }
      }
      if (this.streak > 0) {
        this.passiveDamagePct = this.streak * ((p.damagePctPerStack as number) ?? 0)
        this.passiveMoveSpeedPct = this.streak * ((p.moveSpeedPctPerStack as number) ?? 0)
      }
    } else if (p.id === 'braced') {
      // H13: Set Feet pulls the onset in (a negative delta); Deep Rooted
      // raises the ceiling past today's base 45%.
      const delay = Math.max(0, ((p.stillDelay as number) ?? 1) + this.classBonus.bracedStillDelayDelta)
      const perSec = (p.drPerSec as number) ?? 6
      const fullMax = ((p.drMax as number) ?? 30) + this.classBonus.bracedDrMaxBonus
      /*
         Class pass (this session): Braced needs INPUT now, not just
         idleness — see `_inputNote` in classes.json. Standing still is still
         the trigger (his identity, untouched), but the CEILING it can reach
         depends on whether Dig In has actually been pressed recently:
         `sinceAbility` counts seconds since the last successful `tryAbility`
         call (any class, set in World; only Hand reads it) and resets to 0
         there. Within `abilityGraceSeconds` of a press the ceiling is the
         full `drMax`; past it, it drops to `drMaxStale`. A rooted player who
         never presses the button — `idle` and `idle-buy` press nothing, ever
         — sits at the lower ceiling for the whole run. A brawler pressing on
         anything close to Dig In's own 14s cooldown never sees the drop: the
         grace window is wider than the cooldown on purpose.
      */
      const grace = (p.abilityGraceSeconds as number) ?? Infinity
      const staleMax = (p.drMaxStale as number) ?? fullMax
      const max = this.sinceAbility <= grace ? fullMax : staleMax
      if (this.stillFor >= delay) {
        const dr = Math.min(max, (this.stillFor - delay) * perSec)
        this.passiveDamageReduction = dr / 100
        // Whatever ceiling is active right now, not always the full 45 —
        // Anchor Stone (`cb.bracedCapSlowPct`) reads this to mean "he cannot
        // bank any more reduction", which is equally true at the stale cap.
        this.bracedAtCap = dr >= max
      }
    } else if (p.id === 'momentum') {
      /*
         H13: Long Stride raises the cap AND the rate together.

         `dmgPerVelocityPct` (0.5) and `dmgMax` (50) are authored so full
         velocity (velocityFraction 1) lands EXACTLY on the cap — 100% * 0.5
         = 50 — which means a cap-only bonus is arithmetically inert: raw
         damage can never exceed 100% * rate under ordinary movement, so
         raising `dmgMax` alone with the rate untouched never moves anything
         a player can reach. Long Stride's own `momentumRatePctBonus` moves
         the number that is actually load-bearing (0.5 -> 0.7, so full speed
         now lands on 70); `momentumDmgMaxBonus` still raises the ceiling
         alongside it so the two stay in lockstep rather than one silently
         outrunning the other.
      */
      const per = ((p.dmgPerVelocityPct as number) ?? 0.5) + this.classBonus.momentumRatePctBonus
      const max = ((p.dmgMax as number) ?? 50) + this.classBonus.momentumDmgMaxBonus
      const raw = Math.min(max, this.velocityFraction * 100 * per)
      /*
         Following Wind: Momentum eases toward `raw` instead of snapping to
         it, at `momentumDecayPctPerSec` per second, whenever `raw` has
         DROPPED below where the echo already is — i.e. only while slowing
         or stopped. `momentumDecayPctPerSec` is 0 for every run without the
         card, so `raw < momentumEcho` is the only branch that could differ
         and it is never taken: the echo snaps to `raw` every tick exactly as
         `passiveDamagePct` always did. Accelerating is always instant either
         way — the echo is a ceiling `raw` decays down toward, never a floor
         it is pulled up to.
      */
      const decay = this.classBonus.momentumDecayPctPerSec
      if (decay > 0 && raw < this.momentumEcho) {
        this.momentumEcho = Math.max(raw, this.momentumEcho - decay * dt)
      } else {
        this.momentumEcho = raw
      }
      this.passiveDamagePct = this.momentumEcho
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
