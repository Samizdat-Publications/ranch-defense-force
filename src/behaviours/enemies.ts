/**
 * Enemy steering, keyed by the `behaviour` string in enemies.json.
 *
 * Each function sets `e.vx`/`e.vy` for the tick. It must not move the enemy —
 * integration and separation happen once, in the world, after every enemy has
 * steered (tick order step 4).
 *
 * These are working implementations, not the finished designs; M5 is where each
 * enemy earns the lesson §8 says it teaches.
 */
import type { Enemy } from '../sim/entities'
import { ENEMIES } from '../content'
import type { World } from '../sim/world'

export interface SteerContext {
  world: World
  e: Enemy
  /** Index into the enemy pool, for behaviours that need to damage or query. */
  index: number
  dt: number
  playerX: number
  playerY: number
}

export type EnemyBehaviour = (ctx: SteerContext) => void

function toward(e: Enemy, x: number, y: number, speed: number): void {
  const dx = x - e.x
  const dy = y - e.y
  const d = Math.hypot(dx, dy) || 1
  e.vx = (dx / d) * speed
  e.vy = (dy / d) * speed
  e.facing = Math.atan2(dy, dx)
}

/** Straight at the player. The chaff. */
const chase: EnemyBehaviour = ({ e, playerX, playerY }) => {
  toward(e, playerX, playerY, e.speed)
}

/**
 * Fast and erratic: heads at the player but reroutes on a timer, so it is hard
 * to lead a shot onto and trivially caught by anything wide.
 */
const erratic: EnemyBehaviour = ({ world, e, dt, playerX, playerY }) => {
  e.t0 -= dt
  if (e.t0 <= 0) {
    e.t0 = world.rng.range(0.25, 0.6)
    e.s0 = world.rng.range(-1.1, 1.1)
  }
  const dx = playerX - e.x
  const dy = playerY - e.y
  const base = Math.atan2(dy, dx)
  const angle = base + e.s0
  e.vx = Math.cos(angle) * e.speed
  e.vy = Math.sin(angle) * e.speed
  e.facing = angle
}

/**
 * Approaches off-axis rather than beelining, so packs arrive from the side and
 * behind. Teaches: check behind you.
 */
const flank: EnemyBehaviour = ({ world, e, dt, playerX, playerY }) => {
  if (e.s1 === 0) e.s1 = world.rng.chance(0.5) ? 1 : -1
  const dx = playerX - e.x
  const dy = playerY - e.y
  const dist = Math.hypot(dx, dy) || 1
  const base = Math.atan2(dy, dx)
  // Wide approach far out, collapsing to a direct line inside 120px.
  const offset = (Math.min(1, dist / 320) * 1.15) * e.s1
  const angle = base + offset
  e.vx = Math.cos(angle) * e.speed
  e.vy = Math.sin(angle) * e.speed
  e.facing = base

  // The bark: a one-second tell, then a second pack is queued.
  e.t0 -= dt
  if (e.t0 <= 0 && e.s0 === 0 && dist < 420) {
    e.s0 = 1
    e.t0 = 1
    world.queueBark(e.x, e.y)
  }
}

/**
 * Flies a straight lane past the player and loops back. Never turns to track,
 * so standing out of the lane is always correct.
 */
const laneFly: EnemyBehaviour = ({ e, dt, playerX, playerY }) => {
  if (e.s0 === 0) {
    // Lock the lane on first tick: aim through the player and keep going.
    const dx = playerX - e.x
    const dy = playerY - e.y
    const d = Math.hypot(dx, dy) || 1
    e.s0 = dx / d
    e.s1 = dy / d
    e.facing = Math.atan2(e.s1, e.s0)
  }
  e.t0 += dt
  if (e.t0 > 3.2) {
    // Loop back through for another pass.
    e.t0 = 0
    e.s0 = -e.s0
    e.s1 = -e.s1
    e.facing = Math.atan2(e.s1, e.s0)
  }
  e.vx = e.s0 * e.speed
  e.vy = e.s1 * e.speed
}

/**
 * The only ranged enemy. Holds at range and sprays a telegraphed cone; backs
 * off if the player closes. Teaches: priority targeting.
 */
const kiteAndSpray: EnemyBehaviour = ({ world, e, index, dt, playerX, playerY }) => {
  const hold = 260
  const dx = playerX - e.x
  const dy = playerY - e.y
  const dist = Math.hypot(dx, dy) || 1
  e.facing = Math.atan2(dy, dx)

  if (dist < hold * 0.8) {
    e.vx = (-dx / dist) * e.speed
    e.vy = (-dy / dist) * e.speed
  } else if (dist > hold * 1.25) {
    e.vx = (dx / dist) * e.speed
    e.vy = (dy / dist) * e.speed
  } else {
    e.vx = 0
    e.vy = 0
  }

  e.t0 -= dt
  if (e.t0 <= 0) {
    if (e.s0 === 0) {
      // Wind-up: the tell. Stand still while it charges.
      e.s0 = 1
      e.t0 = 0.8
      e.vx = 0
      e.vy = 0
      world.addTelegraph(e.x, e.y, e.facing, 200, 45, 0.8)
    } else {
      e.s0 = 0
      e.t0 = world.rng.range(2.2, 3.4)
      world.coneAttack(e.x, e.y, e.facing, 200, 45, e.damage, index)
    }
  }
}

/**
 * Lines up, charges straight, overshoots and staggers. The stagger window is
 * the reward for baiting it.
 */
const charge: EnemyBehaviour = ({ world, e, dt, playerX, playerY }) => {
  // s0: 0 approach, 1 winding up, 2 charging, 3 staggered
  const chargeSpeed = 260
  const dx = playerX - e.x
  const dy = playerY - e.y
  const dist = Math.hypot(dx, dy) || 1

  if (e.s0 === 0) {
    toward(e, playerX, playerY, e.speed)
    if (dist < 340) {
      e.s0 = 1
      e.t0 = 1
      e.facing = Math.atan2(dy, dx)
    }
  } else if (e.s0 === 1) {
    e.vx = 0
    e.vy = 0
    e.t0 -= dt
    if (e.t0 <= 0) {
      e.s0 = 2
    // Boss only: the charge brings the herd once he is hurt (§9).
    world.tryStampedePublic(e)
      // Lock the lane at wind-up end — turning mid-charge would remove the
      // whole point of the tell.
      e.s1 = e.facing
      e.t0 = (dist + 140) / chargeSpeed
    }
  } else if (e.s0 === 2) {
    e.vx = Math.cos(e.s1) * chargeSpeed
    e.vy = Math.sin(e.s1) * chargeSpeed
    e.t0 -= dt
    if (e.t0 <= 0) {
      e.s0 = 3
      e.t0 = 1.5
      world.addShake(0.25)
    }
  } else {
    e.vx = 0
    e.vy = 0
    e.t0 -= dt
    if (e.t0 <= 0) e.s0 = 0
  }
  void world
}

/**
 * The Duster (§9).
 *
 * Phase 1 is the whole idea: it drives a fixed agricultural back-and-forth and
 * **never chases**. The danger is entirely of your own making — the arena fills
 * with lanes you cannot be in, and it is up to you not to be in them. A boss
 * that ignores you is a harder design problem than one that hunts you, and it
 * is the reason this fight is not just the Bull with more health.
 *
 * Phase 2 breaks the pattern: it turns, finds you, and comes on slowly, still
 * dragging its strip. Meanwhile the rows burn inward and the arena closes.
 *
 * Scratch: s0 phase, s1 lane direction, t0 gas timer, t1 summon timer.
 */
const duster: EnemyBehaviour = ({ world, e, dt, playerX, playerY }) => {
  const def = ENEMIES[e.typeId]
  const sp = (def?.special ?? {}) as Record<string, number | string>
  const num = (k: string, d: number): number =>
    typeof sp[k] === 'number' ? (sp[k] as number) : d

  // --- phase -------------------------------------------------------------
  if (e.s0 === 0 && e.hp <= e.maxHp * (num('phase2BelowPct', 50) / 100)) {
    e.s0 = 1
    world.addShake(0.9)
    world.beginArenaBurn(num('shrinkSeconds', 90), num('shrinkToFraction', 0.34))
  }

  if (e.s0 === 0) {
    // The Pattern. Drive to the far side, drop a lane, come back. It does not
    // know the player exists.
    if (e.s1 === 0) e.s1 = 1
    const speed = num('patrolSpeed', 54)
    const margin = 90
    const targetX = e.s1 > 0 ? world.arenaW - margin : margin
    const dx = targetX - e.x
    if (Math.abs(dx) < speed * dt * 2) {
      // End of the run: step down a lane and turn around.
      e.s1 = -e.s1
      e.y += num('laneStep', 150)
      if (e.y > world.arenaH - margin) e.y = margin
      e.vx = 0
      e.vy = 0
    } else {
      e.vx = Math.sign(dx) * speed
      e.vy = 0
    }
  } else {
    // Off the Rails. Comes for you, slowly, still dragging the strip.
    const dx = playerX - e.x
    const dy = playerY - e.y
    const d = Math.hypot(dx, dy) || 1
    const speed = num('chaseSpeed', 38)
    e.vx = (dx / d) * speed
    e.vy = (dy / d) * speed

    // Farmhands pour from the corn for the rest of the fight.
    e.t1 -= dt
    if (e.t1 <= 0) {
      e.t1 = num('summonEvery', 3.5)
      world.summonFor(e, String(sp.summons ?? 'farmhand'), num('summonCount', 2))
    }
  }

  if (e.vx !== 0 || e.vy !== 0) e.facing = Math.atan2(e.vy, e.vx)

  // --- the strip ---------------------------------------------------------
  // Laid in both phases. This is the thing that actually kills you.
  e.t0 -= dt
  if (e.t0 <= 0) {
    e.t0 = num('gasEvery', 0.5)
    world.dropGasStrip(
      e.x - Math.cos(e.facing) * 40,
      e.y - Math.sin(e.facing) * 40,
      num('gasRadius', 44),
      num('gasSeconds', 7),
      num('gasDps', 9),
    )
  }
}

export const ENEMY_BEHAVIOURS: Record<string, EnemyBehaviour> = {
  duster,
  chase,
  erratic,
  flank,
  laneFly,
  kiteAndSpray,
  charge,
}
