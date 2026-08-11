/**
 * Weapon behaviours: string key -> function, referenced from weapons.json
 * (architecture §2 — behaviour that can't be data is a named function the JSON
 * points at by name).
 *
 * Two tables:
 *  - FIRE     runs when a weapon's cooldown reaches zero.
 *  - SUSTAIN  runs every tick, for weapons whose projectiles are positioned by
 *             the weapon rather than integrating their own velocity (orbits,
 *             auras). These have `cooldown: 0` in the JSON.
 *
 * Tier riders (T2/T3/T4 in weapons.json) land in M5. What is live now is the
 * per-tier damage scaling from §7, applied by the caller before it gets here.
 */
import type { WeaponDef } from '../content'
import type { Player, WeaponSlot } from '../sim/player'
import type { World } from '../sim/world'

export interface FireContext {
  world: World
  player: Player
  slot: WeaponSlot
  def: WeaponDef
  tier: number
  /** Base damage after tier scaling, before crit and armor. */
  damage: number
  dt: number
}

export type WeaponBehaviour = (ctx: FireContext) => void

const num = (def: WeaponDef, key: string, fallback: number): number => {
  const v = def[key]
  return typeof v === 'number' ? v : fallback
}

/** Melee arc in front of the player. One attached hitbox, brief life. */
const arcSwing: WeaponBehaviour = ({ world, player, def, damage }) => {
  const range = num(def, 'range', 78) * (1 + world.player.stats.rangePct / 100)
  const p = world.spawnProjectile()
  if (!p) return
  p.weaponId = 'arcSwing'
  p.type = 'melee'
  p.behaviour = 'arcSwing'
  p.attached = true
  p.x = player.x + Math.cos(player.facing) * range * 0.5
  p.y = player.y + Math.sin(player.facing) * range * 0.5
  p.px = p.x
  p.py = p.y
  p.radius = range * 0.5
  p.damage = damage
  p.life = 0.12
  p.pierce = 999
  p.knockback = num(def, 'knockback', 190)
  p.angle = player.facing
  p.hitStamp = world.tick
}

/** Blades circling the player. Damage scales with move speed (§7). */
const orbit: WeaponBehaviour = ({ world, player, slot, def, damage, dt, tier }) => {
  const blades = tier >= 3 ? 2 : 1
  const radius = num(def, 'orbitRadius', 74) * (tier >= 2 ? 1.25 : 1)
  const speed = num(def, 'orbitSpeed', 3)
  slot.t0 += speed * dt

  const speedBonus = def.scalesWithMoveSpeed === true
    ? 1 + player.velocityFraction * 0.5
    : 1

  for (let b = 0; b < blades; b++) {
    const angle = slot.t0 + (b * Math.PI * 2) / blades
    let p = world.findAttached('axe', b)
    if (!p) {
      p = world.spawnProjectile()
      if (!p) continue
      p.weaponId = 'axe'
      p.type = 'orbit'
      p.behaviour = 'orbit'
      p.attached = true
      p.pierce = 999
      p.t1 = b
      p.hitStamp = -1
    }
    p.life = 0.1 // refreshed every tick; lapses the moment the weapon stops
    p.angle = angle
    p.orbitRadius = radius
    p.radius = 16
    p.damage = damage * speedBonus
    p.px = p.x
    p.py = p.y
    p.x = player.x + Math.cos(angle) * radius
    p.y = player.y + Math.sin(angle) * radius
  }
}

/** Rotating jet: a short-lived wedge that sweeps, slowing what it touches. */
const rotatingJet: WeaponBehaviour = ({ world, player, slot, def, damage }) => {
  const radius = num(def, 'radius', 130) * (1 + player.stats.rangePct / 100)
  slot.t0 += 0.9
  const p = world.spawnProjectile()
  if (!p) return
  p.weaponId = 'wateringCan'
  p.type = 'aura'
  p.behaviour = 'rotatingJet'
  p.attached = true
  p.angle = slot.t0
  p.x = player.x + Math.cos(slot.t0) * radius * 0.5
  p.y = player.y + Math.sin(slot.t0) * radius * 0.5
  p.px = p.x
  p.py = p.y
  p.radius = radius * 0.45
  p.damage = damage
  p.life = 0.1
  p.pierce = 999
  p.knockback = 0
  p.t0 = num(def, 'slowPct', 30)
  p.hitStamp = world.tick
}

/** Hooks the furthest enemy in range and drags it back toward the player. */
const hookFurthest: WeaponBehaviour = ({ world, player, def, damage }) => {
  const range = num(def, 'range', 420)
  const idx = world.findFurthestEnemyWithin(player.x, player.y, range)
  if (idx < 0) return
  const e = world.enemies.items[idx]
  world.damageEnemy(idx, damage, 'utility', false)
  if (!e.active) return
  const dx = player.x - e.x
  const dy = player.y - e.y
  const d = Math.hypot(dx, dy) || 1
  const drag = num(def, 'dragSpeed', 340)
  e.kx += (dx / d) * drag
  e.ky += (dy / d) * drag
}

/** Fast inaccurate stream at the nearest enemy. */
const stream: WeaponBehaviour = ({ world, player, def, damage, tier }) => {
  const target = world.findNearestEnemy(player.x, player.y, 900)
  const baseAngle = target >= 0
    ? Math.atan2(world.enemies.items[target].y - player.y, world.enemies.items[target].x - player.x)
    : player.facing

  const spread = (num(def, 'spreadDegrees', 14) * (tier >= 2 ? 0.8 : 1) * Math.PI) / 180
  const extra = tier >= 3 ? 2 : 0
  const count = 1 + extra + Math.floor(player.stats.projectileCount)
  const speed = num(def, 'projectileSpeed', 420)

  for (let i = 0; i < count; i++) {
    const p = world.spawnProjectile()
    if (!p) return
    const angle = baseAngle + world.rng.range(-spread, spread)
    p.weaponId = 'seedSpitter'
    p.type = 'ranged'
    p.behaviour = 'stream'
    p.attached = false
    p.x = player.x
    p.y = player.y
    p.px = p.x
    p.py = p.y
    p.vx = Math.cos(angle) * speed
    p.vy = Math.sin(angle) * speed
    p.radius = 5
    p.damage = damage
    p.life = 1.4
    p.pierce = tier >= 4 ? 1 : 0
    p.knockback = 20
    p.hitStamp = -1
  }
}

/** Arcs to the target and splashes on arrival. */
const arcLob: WeaponBehaviour = ({ world, player, def, damage }) => {
  const target = world.findNearestEnemy(player.x, player.y, 520)
  if (target < 0) return
  const e = world.enemies.items[target]
  const p = world.spawnProjectile()
  if (!p) return
  const dx = e.x - player.x
  const dy = e.y - player.y
  const d = Math.hypot(dx, dy) || 1
  const flight = Math.min(0.9, d / 420)

  p.weaponId = 'melonLob'
  p.type = 'ranged'
  p.behaviour = 'arcLob'
  p.attached = false
  p.x = player.x
  p.y = player.y
  p.px = p.x
  p.py = p.y
  p.vx = dx / flight
  p.vy = dy / flight
  p.radius = 7
  p.damage = damage
  p.life = flight
  p.pierce = -1 // detonates on expiry rather than on contact
  p.t0 = num(def, 'splashRadius', 50)
  p.knockback = 60
  p.hitStamp = -1
}

/** Pierces, and burns what it passes through. */
const pierceShot: WeaponBehaviour = ({ world, player, def, damage, tier }) => {
  const target = world.findNearestEnemy(player.x, player.y, 700)
  const angle = target >= 0
    ? Math.atan2(world.enemies.items[target].y - player.y, world.enemies.items[target].x - player.x)
    : player.facing
  const p = world.spawnProjectile()
  if (!p) return
  p.weaponId = 'chiliShot'
  p.type = 'ranged'
  p.behaviour = 'pierceShot'
  p.attached = false
  p.x = player.x
  p.y = player.y
  p.px = p.x
  p.py = p.y
  p.vx = Math.cos(angle) * 380
  p.vy = Math.sin(angle) * 380
  p.radius = 6
  p.damage = damage
  p.life = 1.6
  p.pierce = tier >= 4 ? 4 : num(def, 'pierce', 2)
  p.knockback = 10
  p.hitStamp = -1
}

/** Bounces off the arena bounds, splitting on the last bounce. */
const bounceSplit: WeaponBehaviour = ({ world, player, def, damage, tier }) => {
  const target = world.findNearestEnemy(player.x, player.y, 600)
  const angle = target >= 0
    ? Math.atan2(world.enemies.items[target].y - player.y, world.enemies.items[target].x - player.x)
    : player.facing
  const p = world.spawnProjectile()
  if (!p) return
  p.weaponId = 'eggToss'
  p.type = 'ranged'
  p.behaviour = 'bounceSplit'
  p.attached = false
  p.x = player.x
  p.y = player.y
  p.px = p.x
  p.py = p.y
  p.vx = Math.cos(angle) * 330
  p.vy = Math.sin(angle) * 330
  p.radius = 6
  p.damage = damage
  p.life = 2.4
  p.pierce = 0
  p.t0 = num(def, 'bounces', 2) + (tier >= 2 ? 1 : 0)
  p.t1 = tier >= 3 ? 4 : 2 // shards on the final bounce
  p.knockback = 30
  p.hitStamp = -1
}

/** Lands a slick that halves movement speed. */
const throwPuddle: WeaponBehaviour = ({ world, player, def, damage, tier }) => {
  const target = world.findNearestEnemy(player.x, player.y, 480)
  const tx = target >= 0 ? world.enemies.items[target].x : player.x + Math.cos(player.facing) * 160
  const ty = target >= 0 ? world.enemies.items[target].y : player.y + Math.sin(player.facing) * 160

  const h = world.spawnHazard()
  if (!h) return
  h.kind = 'slow'
  h.x = tx
  h.y = ty
  h.radius = num(def, 'puddleRadius', 90) * (tier >= 4 ? 1.6 : 1)
  h.growth = 0
  h.maxLife = num(def, 'puddleDuration', 5) + (tier >= 2 ? 2 : 0)
  h.life = h.maxLife
  h.slowPct = num(def, 'slowPct', 50)
  h.dps = tier >= 3 ? damage * 0.25 : 0
  h.pullForce = 0
  h.tickAcc = 0

  world.areaDamage(tx, ty, h.radius, damage, 'ranged', 40)
}

/** Overhead slam: instant AoE at the player, stuns. */
const slam: WeaponBehaviour = ({ world, player, def, damage, tier }) => {
  const radius = num(def, 'radius', 68) * (1 + player.stats.rangePct / 100)
  const stun = num(def, 'stunDuration', 0.6) * (tier >= 2 ? 1.5 : 1)
  world.areaDamage(player.x, player.y, radius, damage, 'melee', 120, stun)
  world.addShake(0.18)
  if (tier >= 3) {
    // Shockwave ring: a second, wider, weaker pulse.
    world.areaDamage(player.x, player.y, radius * 2, damage * 0.4, 'melee', tier >= 4 ? 220 : 60)
  }
}

/** Drops a sack that pulls enemies toward it. Enables every AoE build. */
const lure: WeaponBehaviour = ({ world, player, def, damage, tier }) => {
  const h = world.spawnHazard()
  if (!h) return
  const dist = 150
  h.kind = 'lure'
  h.x = player.x + Math.cos(player.facing) * dist
  h.y = player.y + Math.sin(player.facing) * dist
  h.radius = num(def, 'pullRadius', 260) * (tier >= 4 ? 1.8 : 1)
  h.growth = 0
  h.maxLife = num(def, 'duration', 4) + (tier >= 2 ? 2 : 0)
  h.life = h.maxLife
  h.pullForce = num(def, 'pullForce', 150)
  h.slowPct = 0
  h.dps = 0
  h.tickAcc = 0
  // T3 detonates when it expires; the world handles that on hazard death.
  h.kind = tier >= 3 ? 'lure' : 'lure'
  void damage
}

/** An autonomous dog that hunts the nearest small enemy. */
const minionHunt: WeaponBehaviour = ({ world, player, def, damage, tier }) => {
  const wanted = tier >= 3 ? 2 : 1
  for (let i = 0; i < wanted; i++) {
    let p = world.findAttached('barnDog', i)
    if (!p) {
      p = world.spawnProjectile()
      if (!p) return
      p.weaponId = 'barnDog'
      p.type = 'minion'
      p.behaviour = 'minionHunt'
      p.attached = false
      p.x = player.x
      p.y = player.y
      p.px = p.x
      p.py = p.y
      p.t1 = i
      p.radius = 12
      p.pierce = 999
      p.hitStamp = -1
    }
    p.life = 1.2 // refreshed each fire; the dog persists while the weapon does
    p.damage = damage
    p.t0 = num(def, 'leashRadius', 420)
    p.knockback = 40
    p.vx *= tier >= 2 ? 1.5 : 1
    p.vy *= tier >= 2 ? 1.5 : 1
  }
}

/** Weapons whose projectiles are repositioned every tick rather than fired. */
export const SUSTAIN: Record<string, WeaponBehaviour> = {
  orbit,
  minionHunt,
}

export const FIRE: Record<string, WeaponBehaviour> = {
  arcSwing,
  rotatingJet,
  hookFurthest,
  stream,
  arcLob,
  pierceShot,
  bounceSplit,
  throwPuddle,
  slam,
  lure,
  orbit,
  minionHunt,
}
