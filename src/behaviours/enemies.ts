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

export const ENEMY_BEHAVIOURS: Record<string, EnemyBehaviour> = {
  chase,
  erratic,
  flank,
  laneFly,
  kiteAndSpray,
  charge,
}
