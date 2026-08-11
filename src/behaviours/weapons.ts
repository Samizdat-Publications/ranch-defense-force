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
 * Every tier rider named in weapons.json fires from here (M5). The rider text
 * in the JSON is what the level-up and shop cards show, and each one is
 * implemented directly below the behaviour it belongs to — if a card promises
 * it, this file does it. The magnitudes are all JSON too; nothing here invents
 * a number.
 *
 * A rider that needs to outlive the shot itself (a burn, a stun, a mark) rides
 * on the projectile's payload fields and is applied by `World.applyHit`, so a
 * behaviour never has to reach into an enemy it has not hit yet.
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

/**
 * Melee arc in front of the player. One attached hitbox, brief life.
 *
 * T2 widens the arc, T3 makes it land a second time, T4 stuns.
 */
const arcSwing: WeaponBehaviour = ({ world, player, def, damage, tier }) => {
  const widen = tier >= 2 ? num(def, 't2ArcMultiplier', 1.3) : 1
  const range = num(def, 'range', 78) * (1 + world.player.stats.rangePct / 100) * widen
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
  p.pierce = 999
  p.hitsLeft = 999
  p.knockback = num(def, 'knockback', 190)
  p.angle = player.facing
  p.hitStamp = world.tick

  // T3 "hits twice": the swing lingers and re-arms once part-way through, so
  // everything still inside the arc takes a second, separate hit. Two
  // simultaneous hitboxes would also read as double damage but would land on
  // the same frame; a real delay is what makes it look like a second swing.
  const delay = num(def, 't3SecondHitDelay', 0.13)
  p.t1 = tier >= 3 ? 1 : 0
  p.t0 = delay
  p.life = tier >= 3 ? delay * 2 : 0.12

  if (tier >= 4) p.stunOnHit = num(def, 't4StunSeconds', 0.4)
}

/**
 * Blades circling the player. Damage scales with move speed (§7).
 *
 * T2 widens the orbit, T3 adds a second blade, T4 "blades pierce" — the blade
 * cuts through rather than being turned by what it hits, which in an orbit
 * means it comes round to bite again twice as fast.
 */
const orbit: WeaponBehaviour = ({ world, player, slot, def, damage, dt, tier }) => {
  const blades = tier >= 3 ? 2 : 1

  // The orbit tightens as you slow down.
  //
  // At the design's 74px the blade sweeps a ring the enemies are never in:
  // chasers press to about 25px from the player, and a blade orbiting at 74
  // passes 49px clear of them, so a standing player's axe hit almost nothing.
  // Sprinting, the same radius is right — it cuts through the trail of pursuers
  // strung out behind you. Interpolating on `velocityFraction` keeps the wide
  // sweep the design drew and closes the blade to where enemies actually are
  // when you stop, so the axe is a real pick for The Hand as well as The Kid
  // without being strictly better for either. It also reads: the blades visibly
  // draw in when you plant your feet.
  // T2's "+25% radius" widens the sweep, not the floor. The floor is geometry —
  // it is the distance at which the blade still reaches enemies pressed against
  // you — and scaling it pushed a T2 axe back out of contact, so the rider made
  // a standing player's axe worse than no rider at all.
  const wide = num(def, 'orbitRadius', 74) * (tier >= 2 ? num(def, 't2RadiusMultiplier', 1.25) : 1)
  const tight = num(def, 'orbitRadiusMin', 42)
  const radius = tight + (wide - tight) * player.velocityFraction
  const speed = num(def, 'orbitSpeed', 3)
  const interval = num(def, 'hitInterval', 0.35)
    * (tier >= 4 ? num(def, 't4IntervalMultiplier', 0.5) : 1)
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
      // Stamped from the tick, never a constant. A fixed stamp of -1 collided
      // with the value `spawnEnemy` leaves in `e.t1`, and the "already hit by
      // this stamp" guard was therefore true before the blade touched anything
      // — the axe dealt no damage at all in any run.
      p.hitStamp = world.tick
      p.rearm = 0
    }
    // Re-arm on an interval: without this a blade hits each enemy once and
    // never again, because the stamp never changes.
    p.rearm -= dt
    if (p.rearm <= 0) {
      p.rearm = interval
      p.hitStamp = world.tick
      // A blade cuts everything in its path on a pass; the interval, not a hit
      // budget, is what stops it grinding one enemy every tick.
      p.hitsLeft = 999
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

/**
 * Rotating jet: a short-lived wedge that sweeps, slowing what it touches.
 *
 * T2 slows harder, T3 washes gas clouds out of the air, T4 reaches further.
 */
const rotatingJet: WeaponBehaviour = ({ world, player, slot, def, damage, tier, dt }) => {
  const reach = tier >= 4 ? num(def, 't4RadiusMultiplier', 1.4) : 1
  const radius = num(def, 'radius', 130) * (1 + player.stats.rangePct / 100) * reach
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
  p.hitsLeft = 999
  p.knockback = 0
  p.hitStamp = world.tick
  // The slow was previously written into scratch and then read by a line that
  // resolved to a no-op, so the can's headline effect never applied.
  p.slowOnHit = num(def, 'slowPct', 30) * (tier >= 2 ? num(def, 't2SlowMultiplier', 1.5) : 1)
  p.slowSeconds = num(def, 'slowSeconds', 1.2)

  // T3 "washes gas clouds away": shrink any gas the jet is standing in. It
  // dies when it runs out of radius, which is also how it stops being a threat.
  if (tier >= 3) {
    world.shrinkHazards('gas', p.x, p.y, radius, num(def, 't3GasWashPerSecond', 70) * dt)
  }
}

/**
 * Hooks the furthest enemy in range and drags it back toward the player.
 *
 * T2 hurts more on landing, T3 drags three at once, T4 leaves them vulnerable.
 */
const hookFurthest: WeaponBehaviour = ({ world, player, def, damage, tier }) => {
  const range = num(def, 'range', 420)
  const wanted = tier >= 3 ? num(def, 't3Targets', 3) : 1
  const drag = num(def, 'dragSpeed', 340)
  const landing = tier >= 2 ? 1 + num(def, 't2LandingDamageMultiplier', 0.8) : 1

  for (let n = 0; n < wanted; n++) {
    // Re-queried each time: the previous hook killed or moved its target, and
    // the furthest enemy now is a different one.
    const idx = world.findFurthestEnemyWithin(player.x, player.y, range, n)
    if (idx < 0) return
    const e = world.enemies.items[idx]
    const dx = player.x - e.x
    const dy = player.y - e.y
    const d = Math.hypot(dx, dy) || 1

    if (tier >= 4) world.applyMark(e, num(def, 't4MarkPct', 25), num(def, 't4MarkSeconds', 4))
    // Marked before the damage, so the hook's own hit already benefits.
    world.damageEnemy(idx, damage * landing, 'utility', false)
    if (!e.active || e.dying > 0) continue
    e.kx += (dx / d) * drag
    e.ky += (dy / d) * drag
  }
}

/**
 * Fast inaccurate stream at the nearest enemy.
 *
 * T2 tightens the spread, T3 adds projectiles, T4 pierces.
 */
const stream: WeaponBehaviour = ({ world, player, def, damage, tier }) => {
  const target = world.findNearestEnemy(player.x, player.y, 900)
  const baseAngle = target >= 0
    ? Math.atan2(world.enemies.items[target].y - player.y, world.enemies.items[target].x - player.x)
    : player.facing

  const tighten = tier >= 2 ? num(def, 't2SpreadMultiplier', 0.8) : 1
  const spread = (num(def, 'spreadDegrees', 14) * tighten * Math.PI) / 180
  const extra = tier >= 3 ? num(def, 't3BonusProjectiles', 2) : 0
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
    p.pierce = tier >= 4 ? num(def, 't4Pierce', 1) : 0
    p.knockback = 20
    p.hitStamp = -1
  }
}

/**
 * Arcs to the target and splashes on arrival.
 *
 * T2 splashes wider, T3 leaves a slippery rind, T4 splits into three melons.
 */
const arcLob: WeaponBehaviour = ({ world, player, def, damage, tier }) => {
  const target = world.findNearestEnemy(player.x, player.y, 520)
  if (target < 0) return
  const e = world.enemies.items[target]

  const splash = num(def, 'splashRadius', 50) * (tier >= 2 ? num(def, 't2SplashMultiplier', 1.3) : 1)
  const shots = tier >= 4 ? num(def, 't4Splits', 3) : 1
  const shotDamage = shots > 1 ? damage * num(def, 't4SplitDamageMultiplier', 0.5) : damage

  for (let i = 0; i < shots; i++) {
    const p = world.spawnProjectile()
    if (!p) return
    // Fan the extra melons so three do not land in one hole.
    const fan = shots > 1 ? (i - (shots - 1) / 2) * 0.22 : 0
    const dx = e.x - player.x
    const dy = e.y - player.y
    const baseAngle = Math.atan2(dy, dx) + fan
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
    p.vx = (Math.cos(baseAngle) * d) / flight
    p.vy = (Math.sin(baseAngle) * d) / flight
    p.radius = 7
    p.damage = shotDamage
    p.life = flight
    p.pierce = -1 // detonates on expiry rather than on contact
    p.t0 = splash
    // T3: the world leaves a rind where this lands. t1 carries the radius so
    // the detonation does not have to look the weapon def back up.
    p.t1 = tier >= 3 ? num(def, 't3RindRadius', 70) : 0
    p.knockback = 60
    p.hitStamp = -1
  }
}

/**
 * Pierces, and burns what it passes through.
 *
 * The burn itself is new — `burnDps`/`burnDuration` were declared in the JSON
 * but nothing applied them, so the weapon's own headline did not fire either.
 * T2 burns longer, T3 spreads the burn when a burning enemy dies, T4 pierces
 * more.
 */
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
  p.pierce = tier >= 4 ? num(def, 't4Pierce', 4) : num(def, 'pierce', 2)
  p.knockback = 10
  p.hitStamp = -1
  p.burnDps = num(def, 'burnDps', 4)
  p.burnSeconds = num(def, 'burnDuration', 3) + (tier >= 2 ? num(def, 't2BurnBonusSeconds', 2) : 0)
}

/**
 * Bounces off the arena bounds, splitting on the last bounce.
 *
 * T2 adds a bounce, T3 splits into four, T4 lets the shards bounce too.
 */
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
  p.t0 = num(def, 'bounces', 2) + (tier >= 2 ? num(def, 't2BonusBounces', 1) : 0)
  p.t1 = tier >= 3 ? num(def, 't3Shards', 4) : 2 // shards on the final bounce
  p.knockback = 30
  p.hitStamp = -1
}

/**
 * Lands a slick that halves movement speed.
 *
 * T2 lasts longer, T3 makes the slick damage, T4 widens it.
 */
const throwPuddle: WeaponBehaviour = ({ world, player, def, damage, tier }) => {
  const target = world.findNearestEnemy(player.x, player.y, 480)
  const tx = target >= 0 ? world.enemies.items[target].x : player.x + Math.cos(player.facing) * 160
  const ty = target >= 0 ? world.enemies.items[target].y : player.y + Math.sin(player.facing) * 160

  const h = world.spawnHazard()
  if (!h) return
  h.kind = 'slow'
  h.x = tx
  h.y = ty
  h.radius = num(def, 'puddleRadius', 90) * (tier >= 4 ? num(def, 't4RadiusMultiplier', 1.6) : 1)
  h.growth = 0
  h.maxLife = num(def, 'puddleDuration', 5) + (tier >= 2 ? num(def, 't2BonusSeconds', 2) : 0)
  h.life = h.maxLife
  h.slowPct = num(def, 'slowPct', 50)
  h.dps = tier >= 3 ? damage * num(def, 't3DamageMultiplier', 0.25) : 0
  h.pullForce = 0
  h.tickAcc = 0

  world.areaDamage(tx, ty, h.radius, damage, 'ranged', 40)
}

/**
 * Overhead slam: instant AoE at the player, stuns.
 *
 * T2 stuns longer, T3 adds a shockwave ring, T4 makes the ring shove.
 */
const slam: WeaponBehaviour = ({ world, player, def, damage, tier }) => {
  const radius = num(def, 'radius', 68) * (1 + player.stats.rangePct / 100)
  const stun = num(def, 'stunDuration', 0.6) * (tier >= 2 ? num(def, 't2StunMultiplier', 1.5) : 1)
  world.areaDamage(player.x, player.y, radius, damage, 'melee', 120, stun)
  world.addShake(0.18)
  world.playFx('shock', player.x, player.y, 0, radius / 60, 0, 0, true)
  if (tier >= 3) {
    // Shockwave ring: a second, wider, weaker pulse.
    const ringRadius = radius * num(def, 't3RingRadiusMultiplier', 2)
    const ringKnockback = tier >= 4 ? num(def, 't4RingKnockback', 220) : 60
    world.areaDamage(
      player.x, player.y, ringRadius,
      damage * num(def, 't3RingDamageMultiplier', 0.4),
      'melee', ringKnockback,
    )
    world.playFx('shock', player.x, player.y, 0, ringRadius / 60, 0, 0, true)
  }
}

/**
 * Drops a sack that pulls enemies toward it. Enables every AoE build.
 *
 * T2 lasts longer, T3 detonates when it expires, T4 reaches further. The
 * detonation is carried on the hazard's `dps` slot being zero and its `growth`
 * slot holding the blast — see `World.detonateLure`, which fires on expiry.
 */
const lure: WeaponBehaviour = ({ world, player, def, tier }) => {
  const h = world.spawnHazard()
  if (!h) return
  const dist = 150
  h.kind = 'lure'
  h.x = player.x + Math.cos(player.facing) * dist
  h.y = player.y + Math.sin(player.facing) * dist
  h.radius = num(def, 'pullRadius', 260) * (tier >= 4 ? num(def, 't4RadiusMultiplier', 1.8) : 1)
  h.growth = 0
  h.maxLife = num(def, 'duration', 4) + (tier >= 2 ? num(def, 't2BonusSeconds', 2) : 0)
  h.life = h.maxLife
  h.pullForce = num(def, 'pullForce', 150)
  h.slowPct = 0
  // T3 "detonates for 60": the blast rides in `dps`, which a lure otherwise
  // does not use, and the hazard pass fires it when the sack expires.
  h.dps = tier >= 3 ? num(def, 't3DetonationDamage', 60) : 0
  h.tickAcc = 0
}

/**
 * An autonomous dog that hunts the nearest small enemy.
 *
 * T2 makes it faster, T3 brings a second dog, T4 makes its bite bleed.
 */
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
      // A real stamp, so the collision pass rate-limits its bite. -1 means
      // "hits every tick it is touching", which is what made a faster dog worse.
      p.hitStamp = world.tick
      p.rearm = 0
    }
    p.life = 1.2 // refreshed each fire; the dog persists while the weapon does
    p.damage = damage
    // Speed is a target the world steers toward, not a multiplier applied to
    // the current velocity. The previous form multiplied `vx` by 1.5 every
    // tick this ran, which compounds — a T2 dog accelerated without limit.
    p.angularVelocity = num(def, 'dogSpeed', 240)
      * (tier >= 2 ? num(def, 't2SpeedMultiplier', 1.5) : 1)
    p.t0 = num(def, 'leashRadius', 420)
    p.knockback = 40
    if (tier >= 4) {
      p.bleedDps = num(def, 't4BleedDps', 6)
      p.bleedSeconds = num(def, 't4BleedSeconds', 3)
    }
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
