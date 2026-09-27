/**
 * Enemy steering, keyed by the `behaviour` string in enemies.json.
 *
 * Each function sets `e.vx`/`e.vy` for the tick. It must not move the enemy -
 * integration and separation happen once, in the world, after every enemy has
 * steered (tick order step 4).
 *
 * These are working implementations, not the finished designs; M5 is where each
 * enemy earns the lesson §8 says it teaches.
 */
import type { Enemy } from '../sim/entities'
import { ENEMIES } from '../content'
import type { World } from '../sim/world'

/** Smallest positive `attackT`: "the attack starts now", not "no attack". */
const EPSILON = 1e-6

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
      // Start the attack pose on the TELL, which is the moment the player has
      // to read. Triggered here rather than inferred from `s0` outside, so the
      // state numbering stays private to this behaviour; the world advances and
      // ends the clip.
      e.attackT = EPSILON
      // The tell on the ground: the lane it will run, body-wide and exactly
      // as long as the charge. Round 19 could not tell where to stand.
      world.addTelegraph(e.x, e.y, e.facing, dist + 140, 0, e.t0, e.radius * 2)
    }
  } else if (e.s0 === 1) {
    e.vx = 0
    e.vy = 0
    e.t0 -= dt
    if (e.t0 <= 0) {
      e.s0 = 2
    // Boss only: the charge brings the herd once he is hurt (§9).
    world.tryStampedePublic(e)
      // Lock the lane at wind-up end - turning mid-charge would remove the
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
 * The Duster (§9): the crop duster itself, flown by nobody.
 *
 * It flies. Everything below follows from that: it never stops, it cannot turn
 * on the spot, and it banks round in an arc at the end of every pass.
 *
 * Phase 1, the Pattern, is the whole idea: a fixed agricultural back-and-forth,
 * lane by lane down the field, spraying as it goes. It **never chases**. The
 * danger is entirely of your own making: the field fills with lanes you cannot
 * stand in, and it is up to you not to be in them.
 *
 * Phase 2 breaks the pattern: it comes round and makes strafing runs straight
 * through where you are standing, overshoots, banks, and comes again, while the
 * rows burn inward and the corn sends farmhands.
 *
 * Steering is a heading with a turn rate, so every change of course is an arc.
 * Scratch: s0 phase, s1 lane direction (phase 1) / overshoot timer (phase 2),
 * t0 spray timer, t1 summon timer, a0 lane y.
 */
const duster: EnemyBehaviour = ({ world, e, dt, playerX, playerY }) => {
  const def = ENEMIES[e.typeId]
  const sp = (def?.special ?? {}) as Record<string, number | string>
  const num = (k: string, d: number): number =>
    typeof sp[k] === 'number' ? (sp[k] as number) : d

  // --- phase -------------------------------------------------------------
  if (e.s0 === 0 && e.hp <= e.maxHp * (num('phase2BelowPct', 50) / 100)) {
    e.s0 = 1
    e.s1 = 0
    world.addShake(0.9)
    world.beginArenaBurn(num('shrinkSeconds', 90), num('shrinkToFraction', 0.34))
  }

  let tx: number
  let ty: number
  let speed: number
  let turn: number
  if (e.s0 === 0) {
    // The Pattern: fly to the far end of the lane, then the next lane down.
    if (e.s1 === 0) {
      e.s1 = e.x < world.arenaW / 2 ? 1 : -1
      e.a0 = Math.max(120, Math.min(world.arenaH - 120, e.y))
    }
    const margin = num('laneMargin', 170)
    tx = e.s1 > 0 ? world.arenaW - margin : margin
    ty = e.a0
    if ((e.s1 > 0 && e.x >= tx) || (e.s1 < 0 && e.x <= tx)) {
      e.s1 = -e.s1
      e.a0 += num('laneStep', 150)
      if (e.a0 > world.arenaH - 120) e.a0 = 120
    }
    speed = num('patrolSpeed', 120)
    turn = num('turnRate', 1.5)
  } else {
    // Strafing runs: straight at where you are, past you, round, again.
    if (e.s1 > 0) {
      // Overshooting: hold the heading until the timer runs out.
      e.s1 -= dt
      tx = e.x + Math.cos(e.facing) * 100
      ty = e.y + Math.sin(e.facing) * 100
    } else {
      tx = playerX
      ty = playerY
      const dx = playerX - e.x
      const dy = playerY - e.y
      // Passed over you (you are behind it, and close): overshoot, then turn.
      if (dx * Math.cos(e.facing) + dy * Math.sin(e.facing) < 0 && dx * dx + dy * dy < 160 * 160) {
        e.s1 = num('overshootSeconds', 0.9)
      }
    }
    speed = num('strafeSpeed', 165)
    turn = num('strafeTurnRate', 2.1)

    // Farmhands pour from the corn for the rest of the fight.
    e.t1 -= dt
    if (e.t1 <= 0) {
      e.t1 = num('summonEvery', 3.5)
      world.summonFor(e, String(sp.summons ?? 'farmhand'), num('summonCount', 2))
    }
  }

  // Turn toward the target at a limited rate, then fly the heading.
  const want = Math.atan2(ty - e.y, tx - e.x)
  let diff = want - e.facing
  while (diff > Math.PI) diff -= Math.PI * 2
  while (diff < -Math.PI) diff += Math.PI * 2
  const maxTurn = turn * dt
  e.facing += Math.max(-maxTurn, Math.min(maxTurn, diff))
  if (e.facing > Math.PI) e.facing -= Math.PI * 2
  else if (e.facing < -Math.PI) e.facing += Math.PI * 2
  e.vx = Math.cos(e.facing) * speed
  e.vy = Math.sin(e.facing) * speed

  // --- the spray -----------------------------------------------------------
  // Laid from the booms in both phases. This is the thing that actually kills you.
  e.t0 -= dt
  if (e.t0 <= 0) {
    e.t0 = num('gasEvery', 0.5)
    world.dropGasStrip(
      e.x - Math.cos(e.facing) * 30,
      e.y - Math.sin(e.facing) * 30,
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
