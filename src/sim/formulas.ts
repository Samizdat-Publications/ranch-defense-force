/**
 * Every formula from GAME_DESIGN.md §3, §5 and §8, in one place.
 *
 * The JSON carries these as strings (`"30 + 22*n + 1.4*n*n"`) for humans to
 * read; they are implemented here rather than parsed, so the strings are
 * documentation and these are the truth. If you change one, change both.
 */
import { WAVES, TUNING } from '../content'

const econ = WAVES.economy
const caps = TUNING.caps
const combat = TUNING.combat

/** XP needed to go from level L to L+1. ~34 levels over a full run. */
export function xpToNext(level: number): number {
  return Math.ceil(6 + 3 * level + 0.9 * Math.pow(level, 1.55))
}

/** Feed paid at the end of wave n. */
export function waveIncome(wave: number): number {
  return 6 + 3 * wave
}

/**
 * Threat points the spawn director may spend across wave n.
 *
 * UNCHANGED, AND THE ATTEMPT TO CHANGE IT IS THE POINT. The owner reported the
 * waves as far too slow — "I have to generate 100+ over and over" — and the
 * harness agreed: **19 enemies alive at the average death**, ~76 kills a wave,
 * which is one every half-second, the same rate they arrive at. The field never
 * builds.
 *
 * Raising it works and costs more than it buys. Measured over 8-run sweeps:
 *
 *   budget x2.3 + faster groups -> 46-65 alive, kills 1898 -> 4093,
 *                                  clear rate 88% -> 25-63%
 *   budget x1.3 + faster groups -> still under the acceptance bar
 *   budget UNCHANGED, groups alone at 1.8x -> still under it
 *
 * That last line is the finding: **the game has no headroom at all.** Spawn
 * rate alone, with the identical budget, drops `run.test.ts` below "clears 25
 * waves on most seeds". Density and player power are coupled, and the honest
 * fix is not a bigger number here — it is more enemies that are individually
 * weaker, which is a design change to enemies.json (HP, contact damage,
 * threatCost together) and wants the balance session it was deferred to.
 *
 * Do not raise this on its own. It has been tried; the numbers are above.
 */
export function threatBudget(wave: number): number {
  return 30 + 22 * wave + 1.4 * wave * wave
}

/** Enemy damage/HP scalar for wave n. */
export function waveScalar(wave: number): number {
  return 1 + 0.06 * (wave - 1)
}

/** Cost of the next reroll in a shop visit. */
export function shopRerollCost(rerollsThisShop: number): number {
  return 3 + 2 * rerollsThisShop
}

export const LEVEL_REROLL_COST = econ.levelReroll

/** Interest paid on unspent feed when a shop opens. */
export function interestOn(feed: number): number {
  return Math.min(econ.interestCap, Math.floor((feed * econ.interestPct) / 100))
}

/**
 * §5 damage pipeline. `typePct` is the melee/ranged bonus for this weapon's
 * type — the caller picks which, because only it knows the weapon.
 *
 * One pass: percentages are already summed additively by the resolver, so this
 * multiplies exactly once. No multiplicative stacking, ever (CLAUDE.md).
 */
export function resolveDamage(
  base: number,
  dmgPct: number,
  typePct: number,
  flatDmg: number,
  isCrit: boolean,
  critDamageBonusPct: number,
  targetArmor: number,
  scalar: number,
  /** Vulnerability on the target itself (M5 marks), in percent. It joins the
   *  same additive sum as every other percentage rather than multiplying on
   *  top — the single-pass rule is about the whole formula, not just the
   *  player's own stats. */
  targetVulnPct = 0,
): number {
  const raw = base * (1 + dmgPct / 100 + typePct / 100 + targetVulnPct / 100) + flatDmg
  const crit = isCrit ? raw * (combat.critMultiplierBase + critDamageBonusPct / 100) : raw
  const mitigated = crit * (1 - targetArmor / (targetArmor + combat.armorConstant))
  return Math.max(1, mitigated * scalar)
}

/** Dodge and attack speed are the only capped stats (§5). */
export function cappedDodge(pct: number): number {
  return Math.min(caps.dodgePct, Math.max(0, pct))
}

export function cappedAttackSpeed(pct: number): number {
  return Math.min(caps.attackSpeedPct, pct)
}

/** Acres paid out by a finished run (§4). */
export function acresEarned(
  wavesCleared: number,
  bossKills: number,
  firstTimeThisTier: boolean,
  tierMultiplier: number,
): number {
  const base = 2 * wavesCleared + 25 * bossKills + (firstTimeThisTier ? 10 : 0)
  return Math.floor(base * tierMultiplier)
}
