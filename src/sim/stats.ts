/**
 * Single-pass stat resolution (§5, CLAUDE.md non-negotiable).
 *
 * Sources are: the class stat block, every owned passive item, and any
 * permanent Feed Store ranks. All of them contribute to one additive sum per
 * key, resolved in one pass. There is no multiplicative stacking anywhere, so
 * a +8% boot is worth the same whether it is your first or your fifth.
 *
 * Derived values (actual move speed in px/s, actual pickup radius) are computed
 * from that sum against the base constants in tuning.json — also once.
 */
import { STAT_KEYS, TUNING, type StatBlock, type StatMods } from '../content'
import { cappedAttackSpeed, cappedDodge } from './formulas'

const P = TUNING.player

export function emptyStats(): StatBlock {
  return {
    maxHp: 0, hpRegen: 0, armor: 0, dodgePct: 0, lifestealPct: 0,
    moveSpeedPct: 0, pickupRadiusPct: 0, luck: 0, harvestPct: 0,
    damagePct: 0, meleePct: 0, rangedPct: 0, attackSpeedPct: 0,
    critChancePct: 0, critDamagePct: 0, rangePct: 0, projectileCount: 0,
    xpPct: 0,
  }
}

/** Values the sim actually reads, derived from the summed block. */
export interface DerivedStats extends StatBlock {
  moveSpeed: number
  pickupRadius: number
  critChance: number
  attackSpeedMultiplier: number
  dodge: number
}

/**
 * Sum every source into one block, then derive. `into` is reused across calls
 * so a resolve during play allocates nothing.
 */
export function resolveStats(
  sources: readonly StatMods[],
  into: DerivedStats,
): DerivedStats {
  for (const key of STAT_KEYS) into[key] = 0

  // Baseline the class does not mention.
  into.critChancePct = P.baseCritChancePct
  into.critDamagePct = P.baseCritDamagePct

  for (const src of sources) {
    for (const key of STAT_KEYS) {
      const v = src[key]
      if (v !== undefined) into[key] += v
    }
  }

  into.moveSpeed = P.baseMoveSpeed * (1 + into.moveSpeedPct / 100)
  into.pickupRadius = P.basePickupRadius * (1 + into.pickupRadiusPct / 100)
  into.critChance = Math.max(0, into.critChancePct) / 100
  into.attackSpeedMultiplier = 1 + cappedAttackSpeed(into.attackSpeedPct) / 100
  into.dodge = cappedDodge(into.dodgePct) / 100

  // A build can stack enough negative max HP to go non-positive; one HP is the
  // floor or the run ends on the item pickup itself.
  if (into.maxHp < 1) into.maxHp = 1
  if (into.moveSpeed < 20) into.moveSpeed = 20
  return into
}

export function emptyDerived(): DerivedStats {
  return {
    ...emptyStats(),
    moveSpeed: P.baseMoveSpeed,
    pickupRadius: P.basePickupRadius,
    critChance: 0,
    attackSpeedMultiplier: 1,
    dodge: 0,
  }
}

/**
 * What a card would change, for the "+12% attack speed → 1.24/s" line the UI
 * has to print (§12). Returns only keys whose value actually moves.
 */
export function previewDelta(
  current: readonly StatMods[],
  addition: StatMods,
  scratchA: DerivedStats,
  scratchB: DerivedStats,
): { key: keyof StatBlock; from: number; to: number }[] {
  resolveStats(current, scratchA)
  const withNew = [...current, addition]
  resolveStats(withNew, scratchB)

  const out: { key: keyof StatBlock; from: number; to: number }[] = []
  for (const key of STAT_KEYS) {
    if (scratchA[key] !== scratchB[key]) {
      out.push({ key, from: scratchA[key], to: scratchB[key] })
    }
  }
  return out
}
