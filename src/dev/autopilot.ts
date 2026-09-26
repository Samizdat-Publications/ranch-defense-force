/**
 * A deterministic kiting bot, for `rdf.fastForward` (src/main.ts) and the
 * photo tour (tools/tour.ts). Pure logic, no DOM: it reads world state and
 * returns an input, the same shape `Input` (core/input.ts) samples off the
 * keyboard every tick.
 *
 * Steering mirrors tools/difficulty-probe.ts's "kite"/"space" pilots, copied
 * rather than imported: the probe is a measurement instrument and this is a
 * screenshot tool, and CLAUDE.md's rule against a bare Math.random applies to
 * both, so nothing here reads anything but world state and its own Rng.
 */
import type { World } from '../sim/world'
import type { Offer } from '../sim/offers'
import { STEP } from '../core/step'

export interface AutopilotInput {
  moveX: number
  moveY: number
  ability: boolean
}

/** Enemies inside this radius count as "close" for the ability trigger. */
const ABILITY_RANGE = 220
/** How many enemies the centroid weighs, at most, so a wave-25 crowd costs a
 *  bounded scan rather than one that grows with the pool. */
const MAX_WEIGHED = 80
/** Radians per second the strafe component rotates through. */
const STRAFE_RATE = 0.6
/** How far from an arena edge the pull-back starts. */
const EDGE_MARGIN = 160

export class Autopilot {
  private strafePhase = 0

  /**
   * One tick's input, off world state alone.
   *
   * Moves away from the weighted centroid of nearby enemies (closer enemies
   * weigh more, so a bot standing in a loose ring reacts to whoever is about
   * to land a hit, not to a far edge of the crowd), with a perpendicular
   * strafe riding on top so it circles rather than walking a straight line.
   * Pulls back from the arena edge on top of that, then presses the ability
   * whenever it is off cooldown and something is close enough to want it.
   */
  step(world: World): AutopilotInput {
    this.strafePhase += STEP * STRAFE_RATE
    const p = world.player

    let moveX = 0
    let moveY = 0
    let nearCount = 0

    const n = Math.min(world.enemies.live, MAX_WEIGHED)
    if (n > 0) {
      let cx = 0
      let cy = 0
      let totalWeight = 0
      for (let i = 0; i < n; i++) {
        const e = world.enemies.items[i]
        const d = Math.hypot(e.x - p.x, e.y - p.y)
        if (d < ABILITY_RANGE) nearCount++
        const w = 1 / Math.max(40, d)
        cx += e.x * w
        cy += e.y * w
        totalWeight += w
      }
      if (totalWeight > 0) {
        cx /= totalWeight
        cy /= totalWeight
        const dx = p.x - cx
        const dy = p.y - cy
        const d = Math.hypot(dx, dy) || 1
        const awayX = dx / d
        const awayY = dy / d
        // Perpendicular to "away", so adding it circles the centroid instead
        // of just backing off it.
        const strafeX = -awayY
        const strafeY = awayX
        const strafe = Math.sin(this.strafePhase)
        moveX = awayX + strafeX * strafe * 0.6
        moveY = awayY + strafeY * strafe * 0.6
      }
    }

    if (p.x < EDGE_MARGIN) moveX += (EDGE_MARGIN - p.x) / EDGE_MARGIN
    else if (p.x > world.arenaW - EDGE_MARGIN) moveX -= (p.x - (world.arenaW - EDGE_MARGIN)) / EDGE_MARGIN
    if (p.y < EDGE_MARGIN) moveY += (EDGE_MARGIN - p.y) / EDGE_MARGIN
    else if (p.y > world.arenaH - EDGE_MARGIN) moveY -= (p.y - (world.arenaH - EDGE_MARGIN)) / EDGE_MARGIN

    const m = Math.hypot(moveX, moveY)
    if (m > 0) { moveX /= m; moveY /= m }

    const abilityReady = p.abilityCooldown <= 0 && p.abilityActive <= 0
    return { moveX, moveY, ability: abilityReady && nearCount > 0 }
  }
}

/**
 * Offence-first offer picker, copied from `tools/difficulty-probe.ts`'s
 * `pickGreedy` rather than imported (that file documents its own reason not
 * to be refactored around). Merge what is owned, take a new weapon, take an
 * offensive stat, take a rider, else take whatever is first.
 */
export function pickGreedy(offers: readonly Offer[]): Offer | undefined {
  const merge = offers.find((o) => o.mergesTo !== null)
  if (merge) return merge
  const weapon = offers.find((o) => o.kind === 'weapon')
  if (weapon) return weapon
  const offence = offers.find((o) =>
    (o.mods.damagePct ?? 0) > 0 || (o.mods.attackSpeedPct ?? 0) > 0 || (o.mods.rangedPct ?? 0) > 0
    || (o.mods.critChancePct ?? 0) > 0 || (o.mods.projectileCount ?? 0) > 0 || (o.mods.meleePct ?? 0) > 0)
  if (offence) return offence
  const rider = offers.find((o) => o.category === 'onHit' || o.category === 'onKill' || o.category === 'rider')
  return rider ?? offers[0]
}
