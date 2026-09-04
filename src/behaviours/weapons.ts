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
import { hasMod, type Player, type WeaponSlot } from '../sim/player'
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
const arcSwing: WeaponBehaviour = ({ world, player, slot, def, damage, tier }) => {
  /*
     Batch 2. `arcSwing` is shared by the Pitchfork, the Post Hole Auger and
     the Combine Head, and every mod id below is unique to one of them — the
     gate that gets a card onto a slot in the first place means a Combine
     Head slot can never carry `longHaft`, so checking all nine here costs a
     run that owns none of them nine cheap array scans and never a false hit.

     `slot.t0` is free scratch for this behaviour (arcSwing uses `p.t0`/`p.t1`
     for its own T3 re-arm, never the slot's) — Ash Handle and Down Pressure
     both count swings on it. The two can never share a physical slot (one
     weapon is the Pitchfork, the other the Post Hole Auger), so there is no
     contention. Down Pressure counts swings rather than tracking one specific
     enemy across several: the engine has no per-enemy scratch to key a streak
     on, and "every 5th swing locks up whatever it lands on" is the honest
     reading of that constraint, not a shortcut taken quietly.
  */
  const longHaft = hasMod(slot, 'longHaft')
  const threeTine = hasMod(slot, 'threeTine')
  const ashHandle = hasMod(slot, 'ashHandle')
  const carbideTeeth = hasMod(slot, 'carbideTeeth')
  const downPressure = hasMod(slot, 'downPressure')
  const widerTable = hasMod(slot, 'widerTable')
  const concaveAdjust = hasMod(slot, 'concaveAdjust')

  const widen = (tier >= 2 ? num(def, 't2ArcMultiplier', 1.3) : 1)
    * (threeTine ? num(def, 'threeTineArcMul', 1.4) : 1)
    * (widerTable ? num(def, 'widerTableArcMul', 1.15) : 1)
  const range = num(def, 'range', 78) * (1 + world.player.stats.rangePct / 100) * widen
    * (longHaft ? 1 + num(def, 'longHaftRangePct', 25) / 100 : 1)
  const swingDamage = damage
    * (carbideTeeth ? 1 + num(def, 'carbideTeethDamagePct', 35) / 100 : 1)
    * (concaveAdjust ? 1 + num(def, 'concaveAdjustDamagePct', 25) / 100 : 1)

  const p = world.spawnProjectile()
  if (!p) return
  p.weaponId = slot.id
  p.type = 'melee'
  p.behaviour = 'arcSwing'
  p.attached = true
  p.x = player.x + Math.cos(player.facing) * range * 0.5
  p.y = player.y + Math.sin(player.facing) * range * 0.5
  p.px = p.x
  p.py = p.y
  p.radius = range * 0.5
  p.damage = swingDamage
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

  let stun = tier >= 4 ? num(def, 't4StunSeconds', 0.4) : 0
  if (ashHandle) {
    slot.t0 = (slot.t0 + 1) % num(def, 'ashHandleStunEvery', 4)
    if (slot.t0 === 0) stun = Math.max(stun, num(def, 'ashHandleStunSeconds', 0.6))
  }
  if (downPressure) {
    slot.t0 = (slot.t0 + 1) % num(def, 'downPressureHits', 5)
    if (slot.t0 === 0) stun = Math.max(stun, num(def, 'downPressureStunSeconds', 0.8))
  }
  if (stun > 0) p.stunOnHit = stun

  // Straw Chopper (Combine Head epic): its kills leave burning stubble. Read
  // in `killEnemy`, which already carries `p.weaponId` for exactly this.
}

/**
 * Blades circling the player. Damage scales with move speed (§7).
 *
 * T2 widens the orbit, T3 adds a second blade, T4 "blades pierce" — the blade
 * cuts through rather than being turned by what it hits, which in an orbit
 * means it comes round to bite again twice as fast.
 */
const orbit: WeaponBehaviour = ({ world, player, slot, def, damage, dt, tier }) => {
  // Second Cutting grants an extra blade at any tier, and a weaker one — so it
  // is a real upgrade for a T1 scythe and a smaller one for a T3 that already
  // has two. `extraBladeDamage` is the world's flattened item state, read here
  // rather than the item being special-cased inside the world.
  const extra = world.scytheSecondBlade > 0 ? 1 : 0
  const blades = (tier >= 3 ? 2 : 1) + extra

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
  // Batch 2, Scythe: Whetted Edge tightens the hit interval further; Long
  // Snath widens the sweep, additively on top of T2's own widen (both scale
  // off the SAME floor-to-ceiling interpolation, so a standing player still
  // gets the geometry floor and a sprinting one gets both bonuses); Reverse
  // Snath rewards standing still, which reads as the opposite of the
  // weapon's own move-speed scaling and gives the class that plants its feet
  // a reason to run this weapon too.
  const longSnath = hasMod(slot, 'longSnath')
  const reverseSnath = hasMod(slot, 'reverseSnath')
  const wide = num(def, 'orbitRadius', 74)
    * (tier >= 2 ? num(def, 't2RadiusMultiplier', 1.25) : 1)
    * (longSnath ? 1 + num(def, 'longSnathRadiusPct', 30) / 100 : 1)
  const tight = num(def, 'orbitRadiusMin', 42)
  const radius = tight + (wide - tight) * player.velocityFraction
  const speed = num(def, 'orbitSpeed', 3)
  const interval = num(def, 'hitInterval', 0.35)
    * (tier >= 4 ? num(def, 't4IntervalMultiplier', 0.5) : 1)
    * (hasMod(slot, 'whettedEdge') ? num(def, 'whettedEdgeIntervalMul', 0.75) : 1)
  slot.t0 += speed * dt

  const speedBonus = (def.scalesWithMoveSpeed === true
    ? 1 + player.velocityFraction * 0.5
    : 1)
    * (reverseSnath
      ? 1 + (1 - player.velocityFraction) * num(def, 'reverseSnathDamagePct', 40) / 100
      : 1)

  for (let b = 0; b < blades; b++) {
    // The granted blade hits for a fraction, so two scythes is not two scythes.
    const bladeScale = extra > 0 && b === blades - 1 ? world.scytheSecondBlade : 1
    const angle = slot.t0 + (b * Math.PI * 2) / blades
    let p = world.findAttached(slot.id, b)
    if (!p) {
      p = world.spawnProjectile()
      if (!p) continue
      p.weaponId = slot.id
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
    p.damage = damage * speedBonus * bladeScale
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
  // Batch 2, Chem Sprayer: Wide Nozzle and Concentrate are opposite trades on
  // the same reach; Backpack Tank does not touch the jet itself at all — it
  // doubles the LOAD it applies, so it is a payload change, not a geometry
  // one.
  const wideNozzle = hasMod(slot, 'wideNozzle')
  const concentrate = hasMod(slot, 'concentrate')
  const backpackTank = hasMod(slot, 'backpackTank')
  const reach = (tier >= 4 ? num(def, 't4RadiusMultiplier', 1.4) : 1)
    * (wideNozzle ? num(def, 'wideNozzleRadiusMul', 1.3) : 1)
    * (concentrate ? num(def, 'concentrateRadiusMul', 0.8) : 1)
  const radius = num(def, 'radius', 130) * (1 + player.stats.rangePct / 100) * reach
  const jetDamage = concentrate ? damage * num(def, 'concentrateDamageMul', 1.8) : damage
  slot.t0 += 0.9
  const p = world.spawnProjectile()
  if (!p) return
  p.weaponId = slot.id
  p.type = 'aura'
  p.behaviour = 'rotatingJet'
  p.attached = true
  p.angle = slot.t0
  p.x = player.x + Math.cos(slot.t0) * radius * 0.5
  p.y = player.y + Math.sin(slot.t0) * radius * 0.5
  p.px = p.x
  p.py = p.y
  p.radius = radius * 0.45
  p.damage = jetDamage
  p.life = 0.1
  p.pierce = 999
  p.hitsLeft = 999
  p.knockback = 0
  p.hitStamp = world.tick
  // Backpack Tank: the load this jet stamps on lasts twice as long. The load
  // itself is applied a moment later, in `World.applyElementTo`, off
  // `p.loadDurationMul` — see that call site.
  p.loadDurationMul = backpackTank ? num(def, 'backpackTankDurationMul', 2) : 1
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
const hookFurthest: WeaponBehaviour = ({ world, player, slot, def, damage, tier }) => {
  const range = num(def, 'range', 420)
  /*
     `projectileCount` was a declared stat that only ONE behaviour read.

     `stream` (the Scattergun) has always added it to its pellet count and
     nothing else in the game looked at it, which made it a stat that silently
     did nothing for five weapons out of sixteen. Reading it here is a bug fix
     with a measured motive: at T1 the Harpoon Gun hooks exactly one enemy
     every 1.8s, and at the FURTHEST one in range, so it does not even answer
     the thing about to touch you. The Drifter starts with it and, on 24 seeds
     with everything else about him held still, cleared 4/24 with the harpoon
     against 13/24 with the Scattergun. The class was not the trap; the weapon
     was.

     Nothing else in the game grants `projectileCount` -- no item, no Feed Store
     rank -- so every existing build resolves it at 0 and this is arithmetically
     the line it replaces. It is the class stat block that pays for extra hooks.
  */
  // Batch 2, Harpoon Gun: Twin Line is a flat target bonus beside T3's own;
  // Barbed Head and Winch both ride the per-target loop below — a bleed left
  // on the way in, a stun left on the way home.
  const barbedHead = hasMod(slot, 'barbedHead')
  const winch = hasMod(slot, 'winch')
  const wanted = (tier >= 3 ? num(def, 't3Targets', 3) : 1)
    + (hasMod(slot, 'twinLine') ? num(def, 'twinLineBonusTargets', 1) : 0)
    + Math.floor(player.stats.projectileCount)
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

    // A visible line. hookFurthest resolves instantly, so without this the
    // Harpoon Gun fired nothing at all and looked broken next to the Scattergun.
    const shot = world.spawnProjectile()
    if (shot) {
      shot.weaponId = slot.id
      shot.type = 'ranged'
      shot.behaviour = 'tracer'
      shot.attached = false
      shot.x = player.x
      shot.y = player.y
      shot.px = shot.x
      shot.py = shot.y
      const ang = Math.atan2(e.y - player.y, e.x - player.x)
      shot.vx = Math.cos(ang) * 900
      shot.vy = Math.sin(ang) * 900
      shot.radius = 4
      shot.damage = 0            // cosmetic: the hook already did the damage
      shot.pierce = 999
      shot.life = Math.min(0.4, d / 900)
      shot.hitStamp = -1
    }

    if (tier >= 4) world.applyMark(e, num(def, 't4MarkPct', 25), num(def, 't4MarkSeconds', 4))
    if (barbedHead) {
      world.applyBleed(e, num(def, 'barbedHeadBleedDps', 8), num(def, 'barbedHeadBleedSeconds', 4))
    }
    // Marked and bled before the damage, so the hook's own hit already benefits.
    world.damageEnemy(idx, damage * landing, 'utility', false)
    if (!e.active || e.dying > 0) continue
    e.kx += (dx / d) * drag
    e.ky += (dy / d) * drag
    // Winch: the target lands stunned rather than merely dragged.
    if (winch && !e.knockbackImmune) {
      e.stun = Math.max(e.stun, num(def, 'winchStunSeconds', 0.8))
    }
  }
}

/**
 * Fast inaccurate stream at the nearest enemy.
 *
 * T2 tightens the spread, T3 adds projectiles, T4 pierces.
 */
const stream: WeaponBehaviour = ({ world, player, slot, def, damage, tier }) => {
  const target = world.findNearestEnemy(player.x, player.y, 900)
  const baseAngle = target >= 0
    ? Math.atan2(world.enemies.items[target].y - player.y, world.enemies.items[target].x - player.x)
    : player.facing

  // Batch 2, Scattergun: Choke Tube tightens further on top of T2's own
  // choke; Buck & Ball adds pellets at a per-pellet discount; Cut Shell gives
  // the whole spray a pierce and a real shove.
  const chokeTube = hasMod(slot, 'chokeTube')
  const buckBall = hasMod(slot, 'buckBall')
  const cutShell = hasMod(slot, 'cutShell')

  const tighten = (tier >= 2 ? num(def, 't2SpreadMultiplier', 0.8) : 1)
    * (chokeTube ? num(def, 'chokeTubeSpreadMul', 0.55) : 1)
  const spread = (num(def, 'spreadDegrees', 14) * tighten * Math.PI) / 180
  const extra = (tier >= 3 ? num(def, 't3BonusProjectiles', 2) : 0)
    + (buckBall ? num(def, 'buckBallBonusPellets', 2) : 0)
  const count = 1 + extra + Math.floor(player.stats.projectileCount)
  const speed = num(def, 'projectileSpeed', 420)
  const pelletDamage = buckBall ? damage * num(def, 'buckBallDamageMul', 0.85) : damage
  const pierce = cutShell
    ? Math.max(tier >= 4 ? num(def, 't4Pierce', 1) : 0, num(def, 'cutShellPierce', 1))
    : (tier >= 4 ? num(def, 't4Pierce', 1) : 0)
  const knockback = cutShell ? num(def, 'cutShellKnockback', 90) : 20

  for (let i = 0; i < count; i++) {
    const p = world.spawnProjectile()
    if (!p) return
    const angle = baseAngle + world.rng.range(-spread, spread)
    p.weaponId = slot.id
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
    p.damage = pelletDamage
    p.life = 1.4
    p.pierce = pierce
    p.knockback = knockback
    p.hitStamp = -1
  }
}

/**
 * Arcs to the target and splashes on arrival.
 *
 * T2 splashes wider, T3 leaves a slippery rind, T4 splits into three melons.
 */
const arcLob: WeaponBehaviour = ({ world, player, slot, def, damage, tier }) => {
  const target = world.findNearestEnemy(player.x, player.y, 520)
  if (target < 0) return
  const e = world.enemies.items[target]

  // Batch 2, Grenade Launcher: Thin Casing is a plain splash multiplier;
  // Willie Pete and Rifled Cup fire on DETONATION, which for this weapon
  // happens on expiry rather than on contact — see the `arcLob` branch of
  // `World.integrateProjectiles`, the one place that already reads this
  // weapon's T3 rind off `p.t1`.
  const splash = num(def, 'splashRadius', 50)
    * (tier >= 2 ? num(def, 't2SplashMultiplier', 1.3) : 1)
    * (hasMod(slot, 'thinCasing') ? num(def, 'thinCasingSplashMul', 1.35) : 1)
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

    p.weaponId = slot.id
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
const pierceShot: WeaponBehaviour = ({ world, player, slot, def, damage, tier }) => {
  const target = world.findNearestEnemy(player.x, player.y, 700)
  const angle = target >= 0
    ? Math.atan2(world.enemies.items[target].y - player.y, world.enemies.items[target].x - player.x)
    : player.facing

  // Batch 2, Varmint Rifle: Match Barrel is a faster round that steers onto
  // whatever it was aimed at (H4, per-shot rather than the player-wide homing
  // Burr Load grants); Hot Load just ticks harder; Set Trigger fires a second
  // round immediately behind the first, at a discount.
  const matchBarrel = hasMod(slot, 'matchBarrel')
  const hotLoad = hasMod(slot, 'hotLoad')
  const shots = hasMod(slot, 'setTrigger') ? 2 : 1
  const speed = 380 * (matchBarrel ? num(def, 'matchBarrelSpeedMul', 1.6) : 1)
  const burnDps = num(def, 'burnDps', 4) * (hotLoad ? num(def, 'hotLoadBurnMul', 1.8) : 1)
  const burnSeconds = num(def, 'burnDuration', 3) + (tier >= 2 ? num(def, 't2BurnBonusSeconds', 2) : 0)

  for (let i = 0; i < shots; i++) {
    const p = world.spawnProjectile()
    if (!p) return
    p.weaponId = slot.id
    p.type = 'ranged'
    p.behaviour = 'pierceShot'
    p.attached = false
    p.x = player.x
    p.y = player.y
    p.px = p.x
    p.py = p.y
    p.vx = Math.cos(angle) * speed
    p.vy = Math.sin(angle) * speed
    p.radius = 6
    p.damage = i === 0 ? damage : damage * num(def, 'setTriggerSecondMul', 0.6)
    p.life = 1.6
    p.pierce = tier >= 4 ? num(def, 't4Pierce', 4) : num(def, 'pierce', 2)
    p.knockback = 10
    p.hitStamp = -1
    p.burnDps = burnDps
    p.burnSeconds = burnSeconds
    if (matchBarrel) p.homingRate = num(def, 'matchBarrelHomingRate', 60)
  }
}

/**
 * Bounces off the arena bounds, splitting on the last bounce.
 *
 * T2 adds a bounce, T3 splits into four, T4 lets the shards bounce too.
 */
const bounceSplit: WeaponBehaviour = ({ world, player, slot, def, damage, tier }) => {
  const target = world.findNearestEnemy(player.x, player.y, 600)
  const angle = target >= 0
    ? Math.atan2(world.enemies.items[target].y - player.y, world.enemies.items[target].x - player.x)
    : player.facing
  const p = world.spawnProjectile()
  if (!p) return
  p.weaponId = slot.id
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
  // Batch 2, Drum Gun: Wax Wads is a flat bonus on top of T2's own bounce;
  // Frangible and Live Wire ride the shard-spawning end and are read in
  // `World.splitShards`, which already looks the slot up for T4's bounce.
  p.t0 = num(def, 'bounces', 2) + (tier >= 2 ? num(def, 't2BonusBounces', 1) : 0)
    + (hasMod(slot, 'waxWads') ? num(def, 'waxWadsBonusBounces', 2) : 0)
  p.t1 = tier >= 3 ? num(def, 't3Shards', 4) : 2 // shards on the final bounce
  p.knockback = 30
  p.hitStamp = -1
}

/**
 * Lands a slick that halves movement speed.
 *
 * T2 lasts longer, T3 makes the slick damage, T4 widens it.
 */
const throwPuddle: WeaponBehaviour = ({ world, player, slot, def, damage, tier }) => {
  const target = world.findNearestEnemy(player.x, player.y, 480)
  const tx = target >= 0 ? world.enemies.items[target].x : player.x + Math.cos(player.facing) * 160
  const ty = target >= 0 ? world.enemies.items[target].y : player.y + Math.sin(player.facing) * 160

  // A visible throw. throwPuddle spawns a hazard directly, so the Tar Bomb
  // produced a puddle out of thin air with nothing leaving the barrel.
  const lob = world.spawnProjectile()
  if (lob) {
    lob.weaponId = slot.id
    lob.type = 'ranged'
    lob.behaviour = 'tracer'
    lob.attached = false
    lob.x = player.x
    lob.y = player.y
    lob.px = lob.x
    lob.py = lob.y
    const d = Math.hypot(tx - player.x, ty - player.y) || 1
    lob.vx = ((tx - player.x) / d) * 520
    lob.vy = ((ty - player.y) / d) * 520
    lob.radius = 5
    lob.damage = 0
    lob.pierce = 999
    lob.life = Math.min(0.5, d / 520)
    lob.hitStamp = -1
  }

  /*
     Batch 2. `throwPuddle` is shared by the Tar Bomb and the Seed Drill, and
     — as with `arcSwing` — every mod id below belongs to exactly one of them,
     so checking all six costs the other weapon nothing.

     Tar Bomb: Thin Cut and Heavy Cut are plain multipliers on the puddle's
     own numbers; Sump Oil gives it a burn that does not need a fire Load —
     it takes the LARGER of its own dps and whatever T3 already ticks, so a
     T3+Sump Oil puddle is not double-counted.

     Seed Drill: Deep Set is a flat duration bonus; Volunteer Corn a tick-rate
     multiplier, folded into `dps` since the hazard pass already reads dps as
     a rate; Broadcast throws a second patch, fanned beside the first rather
     than stacked on it.
  */
  const thinCut = hasMod(slot, 'thinCut')
  const heavyCut = hasMod(slot, 'heavyCut')
  const sumpOil = hasMod(slot, 'sumpOil')
  const deepSet = hasMod(slot, 'deepSet')
  const volunteerCorn = hasMod(slot, 'volunteerCorn')
  const broadcast = hasMod(slot, 'broadcast')

  const radius = num(def, 'puddleRadius', 90)
    * (tier >= 4 ? num(def, 't4RadiusMultiplier', 1.6) : 1)
    * (thinCut ? num(def, 'thinCutRadiusMul', 1.4) : 1)
  const maxLife = num(def, 'puddleDuration', 5)
    + (tier >= 2 ? num(def, 't2BonusSeconds', 2) : 0)
    + (deepSet ? num(def, 'deepSetBonusSeconds', 4) : 0)
  const slowPct = heavyCut ? num(def, 'heavyCutSlowPct', 70) : num(def, 'slowPct', 50)
  const tierDps = tier >= 3 ? damage * num(def, 't3DamageMultiplier', 0.25) : 0
  const dps = Math.max(tierDps, sumpOil ? num(def, 'sumpOilDps', 10) : 0)
    * (volunteerCorn ? num(def, 'volunteerCornTickMul', 1.5) : 1)

  const patches = broadcast ? num(def, 'broadcastPatches', 2) : 1
  for (let i = 0; i < patches; i++) {
    const fan = patches > 1 ? (i - (patches - 1) / 2) * radius * 0.9 : 0
    const h = world.spawnHazard()
    if (!h) break
    h.kind = 'slow'
    h.x = tx + fan
    h.y = ty
    h.radius = radius
    h.growth = 0
    h.maxLife = maxLife
    h.life = h.maxLife
    h.slowPct = slowPct
    h.dps = dps
    h.pullForce = 0
    h.tickAcc = 0
  }

  world.areaDamage(tx, ty, radius, damage, 'ranged', 40)
}

/**
 * Overhead slam: instant AoE at the player, stuns.
 *
 * T2 stuns longer, T3 adds a shockwave ring, T4 makes the ring shove.
 */
const slam: WeaponBehaviour = ({ world, player, slot, def, damage, tier }) => {
  /*
     Batch 2. `slam` is shared by the Sledge and the Crow Bell, mod ids again
     unique to one weapon each. Long Handle, Dead Blow and Drop Forged are the
     Sledge's; Heavier Clapper, Cracked Bell and Tolls Twice are the Crow
     Bell's, and read as "the peal" rather than "the slam" — the Crow Bell's
     own blurb calls its hit a ring, so Tolls Twice repeats the PRIMARY pulse,
     not only T3's extra ring, and Cracked Bell's slow rides both.
  */
  const longHandle = hasMod(slot, 'longHandle')
  const deadBlow = hasMod(slot, 'deadBlow')
  const dropForged = hasMod(slot, 'dropForged')
  const heavierClapper = hasMod(slot, 'heavierClapper')
  const crackedBell = hasMod(slot, 'crackedBell')
  const tollsTwice = hasMod(slot, 'tollsTwice')

  const radius = num(def, 'radius', 68) * (1 + player.stats.rangePct / 100)
    * (longHandle ? num(def, 'longHandleRadiusMul', 1.3) : 1)
  const stun = num(def, 'stunDuration', 0.6)
    * (tier >= 2 ? num(def, 't2StunMultiplier', 1.5) : 1)
    * (deadBlow ? num(def, 'deadBlowStunMul', 1.6) : 1)
  const slamDamage = heavierClapper ? damage * (1 + num(def, 'heavierClapperDamagePct', 45) / 100) : damage
  const slowPct = crackedBell ? num(def, 'crackedBellSlowPct', 30) : 0
  const slowSeconds = crackedBell ? num(def, 'crackedBellSlowSeconds', 2) : 0

  world.areaDamage(player.x, player.y, radius, slamDamage, 'melee', 120, stun, slowPct, slowSeconds)
  world.addShake(0.18)
  world.playFx('shockwave', player.x, player.y, 0, radius / 55, 0, 0, true)

  if (tollsTwice) {
    // A second peal, 0.5s later at 60% — an attached hitbox with `pierce: -1`
    // so it detonates on expiry rather than on contact, the same trick
    // `arcLob` already uses. See the `tollsTwice` branch of
    // `World.integrateProjectiles`.
    const p = world.spawnProjectile()
    if (p) {
      p.weaponId = slot.id
      p.type = 'melee'
      p.behaviour = 'tollsTwice'
      p.attached = false
      p.x = player.x
      p.y = player.y
      p.px = p.x
      p.py = p.y
      p.vx = 0
      p.vy = 0
      p.radius = 1
      p.damage = slamDamage * num(def, 'tollsTwiceMul', 0.6)
      p.pierce = -1
      p.life = num(def, 'tollsTwiceDelay', 0.5)
      p.t0 = radius
      p.t1 = 0
      p.hitStamp = -1
    }
  }

  if (tier >= 3) {
    // Shockwave ring: a second, wider, weaker pulse.
    const ringRadius = radius * num(def, 't3RingRadiusMultiplier', 2)
    const ringKnockback = tier >= 4 ? num(def, 't4RingKnockback', 220) : 60
    world.areaDamage(
      player.x, player.y, ringRadius,
      slamDamage * num(def, 't3RingDamageMultiplier', 0.4),
      'melee', ringKnockback, 0, slowPct, slowSeconds,
    )
    world.playFx('shockwave', player.x, player.y, 0, ringRadius / 55, 0, 0, true)
  }

  if (dropForged) {
    // Drop Forged: the ground itself cracks. No damage — a fissure, not a
    // hazard the sledge is scoring, exactly the shape the puddle riders use.
    const h = world.spawnHazard()
    if (h) {
      h.kind = 'slow'
      h.x = player.x
      h.y = player.y
      h.radius = radius
      h.growth = 0
      h.maxLife = num(def, 'dropForgedSeconds', 3)
      h.life = h.maxLife
      h.slowPct = num(def, 'dropForgedSlowPct', 40)
      h.dps = 0
      h.pullForce = 0
      h.tickAcc = 0
    }
  }
}

/**
 * Drops a sack that pulls enemies toward it. Enables every AoE build.
 *
 * T2 lasts longer, T3 detonates when it expires, T4 reaches further. The
 * detonation is carried on the hazard's `dps` slot being zero and its `growth`
 * slot holding the blast — see `World.detonateLure`, which fires on expiry.
 */
const lure: WeaponBehaviour = ({ world, player, slot, def, tier }) => {
  const h = world.spawnHazard()
  if (!h) return
  const dist = 150
  h.kind = 'lure'
  h.x = player.x + Math.cos(player.facing) * dist
  h.y = player.y + Math.sin(player.facing) * dist
  // Batch 2, Bait Drum: Sweet Feed widens the pull; Spoiled Feed marks
  // whatever it catches (read in the lure's own pull tick, `World`'s enemy
  // update); Blasting Cap only matters once T3 has given it a detonation to
  // scale.
  h.radius = num(def, 'pullRadius', 260)
    * (tier >= 4 ? num(def, 't4RadiusMultiplier', 1.8) : 1)
    * (hasMod(slot, 'sweetFeed') ? num(def, 'sweetFeedRadiusMul', 1.4) : 1)
  h.growth = 0
  h.maxLife = num(def, 'duration', 4) + (tier >= 2 ? num(def, 't2BonusSeconds', 2) : 0)
  h.life = h.maxLife
  h.pullForce = num(def, 'pullForce', 150)
  h.slowPct = 0
  // T3 "detonates for 60": the blast rides in `dps`, which a lure otherwise
  // does not use, and the hazard pass fires it when the sack expires.
  h.dps = (tier >= 3 ? num(def, 't3DetonationDamage', 60) : 0)
    * (hasMod(slot, 'blastingCap') ? num(def, 'blastingCapDetonationMul', 1.8) : 1)
  h.tickAcc = 0
  if (hasMod(slot, 'spoiledFeed')) {
    h.markPct = num(def, 'spoiledFeedDamageTakenPct', 20)
    h.markSeconds = h.maxLife
  }
}

/**
 * An autonomous dog that hunts the nearest small enemy.
 *
 * T2 makes it faster, T3 brings a second dog, T4 makes its bite bleed.
 */
const minionHunt: WeaponBehaviour = ({ world, player, slot, def, damage, tier }) => {
  // Batch 2, Barn Dog: Slip Lead widens the leash; Cattle Bred is a flat bite
  // bonus; Blood Up scales with kills THIS WAVE (`World.bloodUpKills`, reset
  // at every wave boundary), capped at `bloodUpMaxPct`.
  const cattleBred = hasMod(slot, 'cattleBred')
  const slipLead = hasMod(slot, 'slipLead')
  const bloodUp = hasMod(slot, 'bloodUp')
  const bloodUpMul = bloodUp
    ? 1 + Math.min(
      num(def, 'bloodUpMaxPct', 90),
      world.bloodUpKills * num(def, 'bloodUpPerKillPct', 15),
    ) / 100
    : 1
  const wanted = tier >= 3 ? 2 : 1
  for (let i = 0; i < wanted; i++) {
    let p = world.findAttached(slot.id, i)
    if (!p) {
      p = world.spawnProjectile()
      if (!p) return
      p.weaponId = slot.id
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
    p.damage = cattleBred ? damage * (1 + num(def, 'cattleBredBitePct', 40) / 100) : damage
    // Speed is a target the world steers toward, not a multiplier applied to
    // the current velocity. The previous form multiplied `vx` by 1.5 every
    // tick this ran, which compounds — a T2 dog accelerated without limit.
    p.angularVelocity = num(def, 'dogSpeed', 240)
      * (tier >= 2 ? num(def, 't2SpeedMultiplier', 1.5) : 1)
      * bloodUpMul
    p.t0 = num(def, 'leashRadius', 420) * (slipLead ? 1 + num(def, 'slipLeadRadiusPct', 50) / 100 : 1)
    p.knockback = 40
    if (tier >= 4) {
      p.bleedDps = num(def, 't4BleedDps', 6)
      p.bleedSeconds = num(def, 't4BleedSeconds', 3)
    }
  }
}

/**
 * A damaging ring that stays on you — the genre's other constant, next to the
 * orbit. The owner asked for it in as many words: "some type of floating ring
 * around you that causes damage in a radius around you and powers up with
 * larger size area/circle or more damage."
 *
 * SUSTAIN, `cooldown: 0`: **one** attached projectile, repositioned every tick
 * and re-armed on an interval, exactly as the Scythe's blades are. It is not
 * a stream of pulses — a weapon that spawned a hitbox per tick would put sixty
 * projectiles a second through the pool for one ring — and it is not a hazard,
 * because a hazard does not move with you and the whole point is that it does.
 *
 * The interval is what stops it grinding one enemy every frame: `hitInterval`
 * seconds between passes, `damage` per pass, so the number on the card is a
 * DPS and the number in the sim is a bite. The Chem Sprayer proved the
 * `type: 'aura'` path years before this — `renderer.ts:drawArcs` already
 * strokes a soft ring for it and `applyHit` already resolves it as ranged —
 * so the ring needed no renderer change and no new projectile type.
 *
 * T2 widens it, T3 hits harder and shoves on every pass, T4 slows what is
 * standing in it.
 */
const sustainAura: WeaponBehaviour = ({ world, player, slot, def, damage, dt, tier }) => {
  // Batch 2, Smudge Pot: Bigger Batch and Old Rags are plain multipliers,
  // same shape as the tier riders either side of them; Damper Plate gives an
  // early ring the slow T4 already has, at a lower, tier-independent number,
  // so it does not simply become T4's rider for free once you tier up.
  const biggerBatch = hasMod(slot, 'biggerBatch')
  const oldRags = hasMod(slot, 'oldRags')
  const damperPlate = hasMod(slot, 'damperPlate')
  const grow = (tier >= 2 ? num(def, 't2RadiusMultiplier', 1.3) : 1)
    * (biggerBatch ? num(def, 'biggerBatchRadiusMul', 1.25) : 1)
  const wide = tier >= 4 ? num(def, 't4RadiusMultiplier', 1.25) : 1
  const radius = num(def, 'radius', 96)
    * (1 + player.stats.rangePct / 100) * grow * wide
  const interval = num(def, 'hitInterval', 0.5)
  const burn = (tier >= 3 ? num(def, 't3DamageMultiplier', 1.6) : 1)
    * (oldRags ? num(def, 'oldRagsDamageMul', 1.5) : 1)

  let p = world.findAttached(slot.id, 0)
  if (!p) {
    p = world.spawnProjectile()
    if (!p) return
    p.weaponId = slot.id
    p.type = 'aura'
    p.behaviour = 'sustainAura'
    p.attached = true
    p.pierce = 999
    p.t1 = 0
    // A real stamp from the tick, never a constant: -1 collides with the value
    // `spawnEnemy` leaves in `e.t1`, and the "already hit by this stamp" guard
    // is then true before the ring has touched anything. That is the bug the
    // orbit shipped with and it is written up above; this does not repeat it.
    p.hitStamp = world.tick
    p.rearm = 0
  }

  p.rearm -= dt
  if (p.rearm <= 0) {
    p.rearm = interval
    p.hitStamp = world.tick
    p.hitsLeft = 999
    // T3's shove rides the pass rather than being continuous — a knockback
    // applied sixty times a second is a wall, not a pulse.
    p.knockback = tier >= 3 ? num(def, 't3Knockback', 110) : 0
  } else {
    p.knockback = 0
  }

  p.life = 0.1 // refreshed every tick; lapses the moment the weapon stops
  p.radius = radius
  p.damage = damage * burn * interval
  // T4 "the dust settles on them": the ring slows what is standing in it.
  // Damper Plate gives an early ring the same rider at a smaller number,
  // independent of tier — the larger of the two wins rather than summing.
  p.slowOnHit = Math.max(
    tier >= 4 ? num(def, 't4SlowPct', 35) : 0,
    damperPlate ? num(def, 'damperPlateSlowPct', 25) : 0,
  )
  p.slowSeconds = Math.max(
    num(def, 't4SlowSeconds', 1.2),
    damperPlate ? num(def, 'damperPlateSlowSeconds', 1) : 0,
  )
  p.px = p.x
  p.py = p.y
  p.x = player.x
  p.y = player.y
}

/** Weapons whose projectiles are repositioned every tick rather than fired. */
export const SUSTAIN: Record<string, WeaponBehaviour> = {
  orbit,
  minionHunt,
  sustainAura,
}

export const FIRE: Record<string, WeaponBehaviour> = {
  arcSwing,
  sustainAura,
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
