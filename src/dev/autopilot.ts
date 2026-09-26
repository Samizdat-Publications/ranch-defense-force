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
/** The distance it fights from: closer than this it backs off, further it
 *  closes in. A bot that only ever ran outran the crowd, and the photographs
 *  of wave 7 showed one enemy on screen with seventy alive (critic round 7). */
const STANDOFF = 150
/** Nothing inside this radius means it is safe to go shopping for pickups. */
const GREED_SAFE = 150
/** How hard a pickup pulls, against 1 for "away from the crowd". A person
 *  playing walks into their gems; a bot that never does leaves the field a
 *  carpet of them, and the photographs show a game nobody plays. */
const GREED_PULL = 1.4
/** A gentle pull toward the middle of the arena, so kiting circles the field
 *  rather than pinning itself against a fence (and the camera with it). */
const CENTRE_PULL = 0.35

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
        const push = Math.max(-1, Math.min(1, (STANDOFF - d) / STANDOFF))
        moveX = awayX * push + strafeX * strafe * 0.8
        moveY = awayY * push + strafeY * strafe * 0.8
      }
    }

    // Greed: walk to the nearest pickup when nothing is about to land a hit.
    let nearest = Infinity
    for (let i = 0; i < n; i++) {
      const e = world.enemies.items[i]
      const d = Math.hypot(e.x - p.x, e.y - p.y)
      if (d < nearest) nearest = d
    }
    if (nearest > GREED_SAFE && world.pickups.live > 0) {
      let best = -1
      let bestD = Infinity
      for (let i = 0; i < world.pickups.live; i++) {
        const g = world.pickups.items[i]
        const d = Math.hypot(g.x - p.x, g.y - p.y)
        if (d < bestD) { bestD = d; best = i }
      }
      if (best >= 0) {
        const g = world.pickups.items[best]
        const d = bestD || 1
        const k = GREED_PULL * Math.min(1, (nearest - GREED_SAFE) / GREED_SAFE)
        moveX += ((g.x - p.x) / d) * k
        moveY += ((g.y - p.y) / d) * k
      }
    }
    {
      const dx = world.arenaW / 2 - p.x
      const dy = world.arenaH / 2 - p.y
      const d = Math.hypot(dx, dy)
      if (d > 1) {
        const k = CENTRE_PULL * Math.min(1, d / (Math.min(world.arenaW, world.arenaH) * 0.5))
        moveX += (dx / d) * k
        moveY += (dy / d) * k
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
