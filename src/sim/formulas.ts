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

/**
 * Enemy damage/HP scalar for wave n. Applied to contact damage and to `maxHp`
 * at spawn, so it is the one lever for how strong an enemy IS at a wave.
 *
 * ## The difficulty curve inverts, and this is why
 *
 * It is LINEAR -- 1.24 at wave 5, 1.96 at 17, 2.44 at 25 -- while player power
 * COMPOUNDS through levels, six weapon slots and merges to tier 4. The harness
 * has been reporting the consequence all along. Deaths over 64 baseline runs,
 * four pilots:
 *
 *     hand/kite     w5 w6 w8 w9
 *     hand/brawler  w5 w6 w6 w16
 *     kid/kite      w4 w4 w11 w11
 *     kid/brawler   w4 w6 w7 w11 w12 w12 w15 w16 w21
 *
 * **Almost every death is before wave 12.** Past that the game cannot kill
 * anyone: a watched run sat at 160/160 through waves 16 and 17 while killing
 * 851 things, on a build a bot assembled by taking offer 1 unread. The owner's
 * report is "too easy"; the shape behind it is hard EARLY, trivial LATE.
 *
 * ## Two fixes were measured and BOTH broke a guardrail
 *
 * Adding a quadratic term anchored at wave 1, so the already-lethal early game
 * is untouched and only the ceiling rises:
 *
 *     +0.004*n^2 on this scalar   deaths spread to w5..w23 CORRECTLY, but clear
 *                                 rate 75% -> 31% (hand/kite), 38% -> 13%
 *                                 (kid/brawler). Far under the acceptance bar.
 *     +0.002*n^2 on this scalar   acceptance bar HELD, but `treats both classes
 *                                 comparably` failed at a gap of 11 against a
 *                                 limit of 8, and `rewards build quality`
 *                                 inverted -- the smart pilot died before it
 *                                 could merge.
 *     +0.004*n^2 on HP ONLY,      `completes all 25 waves on most seeds` failed
 *     damage left linear          AND parity still failed.
 *
 * The middle row is the instructive one. Multiplying incoming DAMAGE rewards
 * flat damage reduction and punishes a low-HP dodger, so The Hand (30% DR while
 * braced) barely noticed while The Kid was shredded. Incoming damage is the
 * wrong lever for late pressure. Scaling HP alone instead makes the field fill
 * -- which is what the `threatBudget` note wants from the other direction -- but
 * time-to-kill rises faster than damage output and the run stops completing.
 *
 * That is three levers, all measured, all breaking something. It is the same
 * conclusion `threatBudget` reached: **the game has no headroom, and no single
 * multiplier buys any.** The honest fix is the one that note already named -- a
 * design change to `enemies.json`, HP and contact damage and threatCost moved
 * together, so the late game holds more, weaker bodies.
 *
 * It also needs a decision that is not a programmer's to make. `run.test.ts`
 * asserts "clears 25 waves on most seeds" and "neither class is a trap pick".
 * Those bars ENCODE the current difficulty target. A game the owner considers
 * appropriately hard may well clear on fewer than half of seeds, and until
 * somebody says so, every change that makes it harder reads as a regression.
 *
 * Do not reach for a bigger coefficient here. It has been tried three ways; the
 * numbers are above.
 */
export function waveScalar(wave: number): number {
  return 1 + 0.06 * (wave - 1)
}

/**
 * Enemy HP scalar for wave n. This is where the late game gets its teeth.
 *
 * Split from `waveScalar` because incoming DAMAGE is the wrong lever and that
 * was measured twice. Multiplying damage rewards flat damage reduction and
 * punishes a low-HP dodger: with `+0.003*n^2` on `waveScalar`, The Hand held at
 * 60% cleared while The Kid fell to 30% and a median wave of 8, dying at w4-w7.
 * HP costs both classes the same, because time-to-kill does not care about
 * mitigation.
 *
 * The coefficient is large because it multiplies a base that was cut to 55% by
 * the density pass in `enemies.json`. Against the ORIGINAL per-enemy hp:
 *
 *     wave              5     10    17    25
 *     was (linear)     1.24  1.54  1.96  2.44
 *     now (x0.55 base) 0.80  1.49  2.94  4.96
 *
 * So an early enemy is genuinely weaker than it used to be -- which is correct,
 * since almost every death in the baseline fell before wave 12 -- and a late one
 * is much tougher, while roughly 2.2x as many of them arrive. Early pressure
 * comes from numbers, late pressure from durability.
 */
export function waveHpScalar(wave: number): number {
  const n = wave - 1
  return 1 + 0.06 * n + 0.010 * n * n
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
