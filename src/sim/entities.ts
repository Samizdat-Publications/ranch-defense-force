/**
 * Pooled entity shapes. These are plain mutable structs — every field is
 * present from construction so the JIT keeps one hidden class per pool and
 * `acquire()` never allocates. Nothing here is ever `new`ed during play.
 *
 * `px`/`py` hold the previous tick's position; the renderer interpolates
 * between those and the current position using the loop's alpha, which is what
 * lets a 60Hz simulation look smooth on a 144Hz display.
 */

export interface Enemy {
  active: boolean
  typeId: string
  x: number
  y: number
  px: number
  py: number
  vx: number
  vy: number
  /** Knockback velocity, decayed separately from steering so a knocked-back
   *  enemy still tries to walk back at you. */
  kx: number
  ky: number
  hp: number
  maxHp: number
  speed: number
  damage: number
  radius: number
  xp: number
  behaviour: string
  elite: boolean
  /** Seconds of white flash left. */
  flash: number
  /** Seconds of stun left; steering is skipped while > 0. */
  stun: number
  /** Facing, radians. Drives the lean transform later. */
  facing: number
  /** Per-behaviour scratch — meaning depends on `behaviour`. */
  t0: number
  t1: number
  s0: number
  s1: number
  /** Contact damage cooldown so touching the player isn't 60 hits a second. */
  touchCd: number
  knockbackImmune: boolean
  /** Set on death, counted down by the vfx pass before the slot is freed. */
  dying: number
  hpBuffPct: number
  /** Seconds since spawn, for animation phase. Kept out of the t0/s0 scratch
   *  because behaviours own those and would clobber it. */
  anim: number
  /** Distance travelled, which drives bob and step timing — a sprite that bobs
   *  with distance rather than time stops looking like it is treadmilling. */
  travelled: number

  // --- status effects (M5) ---------------------------------------------
  // Kept as their own fields rather than in the t0/s0 scratch: behaviours own
  // that scratch and would clobber a burn the moment an enemy changed state.

  /** Damage per second while `burnLife > 0`. */
  burnDps: number
  burnLife: number
  /** Fractional damage carried between ticks, so 4 dps at 60Hz is not 60 zeroes. */
  burnAcc: number
  /** Who lit it, so a spreading burn cannot re-light its own source forever. */
  burnGen: number

  /** Bleed: the same shape as burn, but it does not spread and it stacks from
   *  a different source, so a dog bite and a chili are readable apart. */
  bleedDps: number
  bleedLife: number
  bleedAcc: number

  /** Vulnerability mark: extra percent damage taken while `markLife > 0`. */
  markPct: number
  markLife: number

  /** Movement slow, as a percent, while `slowLife > 0`. Stacks with the
   *  standing-in-a-puddle slow by taking the larger of the two. */
  slowPct: number
  slowLife: number
}

export function makeEnemy(): Enemy {
  return {
    active: false, typeId: '', x: 0, y: 0, px: 0, py: 0, vx: 0, vy: 0,
    kx: 0, ky: 0, hp: 1, maxHp: 1, speed: 0, damage: 0, radius: 10, xp: 1,
    behaviour: 'chase', elite: false, flash: 0, stun: 0, facing: 0,
    t0: 0, t1: 0, s0: 0, s1: 0, touchCd: 0, knockbackImmune: false,
    dying: 0, hpBuffPct: 0, anim: 0, travelled: 0,
    burnDps: 0, burnLife: 0, burnAcc: 0, burnGen: 0,
    bleedDps: 0, bleedLife: 0, bleedAcc: 0,
    markPct: 0, markLife: 0, slowPct: 0, slowLife: 0,
  }
}

export interface Projectile {
  active: boolean
  weaponId: string
  x: number
  y: number
  px: number
  py: number
  vx: number
  vy: number
  damage: number
  radius: number
  /** Seconds before it despawns on its own. */
  life: number
  /** Remaining enemies it can pass through. -1 for melee sweeps that hit each
   *  enemy at most once via `hitStamp`. */
  pierce: number
  /** Tick number the projectile last hit something, used to avoid re-hitting
   *  the same enemy on consecutive ticks. */
  hitStamp: number
  isCrit: boolean
  behaviour: string
  /** True for melee arcs and auras: they are positioned by the weapon each
   *  tick rather than integrating their own velocity. */
  attached: boolean
  angle: number
  angularVelocity: number
  orbitRadius: number
  knockback: number
  type: 'melee' | 'ranged' | 'orbit' | 'aura' | 'utility' | 'minion'
  t0: number
  t1: number

  // --- what a hit applies, beyond damage (M5) ---------------------------
  // Dedicated fields rather than more t0/t1 scratch: the scratch already means
  // a different thing per behaviour, and a rider that had to share it with
  // splash radius would be a bug waiting for the next weapon.

  /** How many enemies this attached hitbox may still hit in the current
   *  window. Re-armed by the weapon; ignored by unattached projectiles, which
   *  use `pierce`. */
  hitsLeft: number
  /** Seconds until this hitbox re-arms and may hit its targets again. */
  rearm: number
  /** Seconds of stun a hit applies. */
  stunOnHit: number
  burnDps: number
  burnSeconds: number
  bleedDps: number
  bleedSeconds: number
  /** Vulnerability the hit leaves on the target. */
  markPct: number
  markSeconds: number
  /** Movement slow the hit applies. */
  slowOnHit: number
  slowSeconds: number
}

export function makeProjectile(): Projectile {
  return {
    active: false, weaponId: '', x: 0, y: 0, px: 0, py: 0, vx: 0, vy: 0,
    damage: 0, radius: 6, life: 0, pierce: 0, hitStamp: -1, isCrit: false,
    behaviour: 'stream', attached: false, angle: 0, angularVelocity: 0,
    orbitRadius: 0, knockback: 0, type: 'ranged', t0: 0, t1: 0,
    hitsLeft: 999, rearm: 0, stunOnHit: 0, burnDps: 0, burnSeconds: 0,
    bleedDps: 0, bleedSeconds: 0, markPct: 0, markSeconds: 0,
    slowOnHit: 0, slowSeconds: 0,
  }
}

/**
 * Harvestable crops standing in the field. They do not move or fight — they
 * soak a couple of hits and pay out feed, which gives a player with spare
 * seconds something to do with them and turns "the wave is thin right now"
 * into an economic decision rather than dead time.
 */
export interface Prop {
  active: boolean
  /** Atlas frame key, e.g. `crop.pumpkin`. */
  sprite: string
  x: number
  y: number
  hp: number
  maxHp: number
  radius: number
  feed: number
  flash: number
  /** Counts down after the killing blow, for the pop. */
  dying: number
}

export function makeProp(): Prop {
  return {
    active: false, sprite: 'crop.corn', x: 0, y: 0, hp: 1, maxHp: 1,
    radius: 11, feed: 1, flash: 0, dying: 0,
  }
}

export type PickupKind = 'xp' | 'feed' | 'heal'

export interface Pickup {
  active: boolean
  kind: PickupKind
  x: number
  y: number
  px: number
  py: number
  vx: number
  vy: number
  value: number
  /** Once magnetised it accelerates rather than lerping — the greed curve. */
  magnetised: boolean
  speed: number
  bob: number
}

export function makePickup(): Pickup {
  return {
    active: false, kind: 'xp', x: 0, y: 0, px: 0, py: 0, vx: 0, vy: 0,
    value: 1, magnetised: false, speed: 0, bob: 0,
  }
}

/**
 * Ground effects with a duration: slop puddles, grain lures, and later acid
 * pools and gas clouds. They tick damage or apply a movement modifier to
 * anything standing inside, and render below sprites.
 */
export type HazardKind = 'slow' | 'lure' | 'damage' | 'gas' | 'acid'

export interface Hazard {
  active: boolean
  kind: HazardKind
  x: number
  y: number
  radius: number
  /** Radius growth per second — gas clouds expand. */
  growth: number
  life: number
  maxLife: number
  /** Damage per second to ENEMIES standing inside. */
  dps: number
  /** Damage per second to the PLAYER standing inside. Separate from `dps`
   *  because acid and gas hurt you and not the things that made them, while a
   *  slop puddle is the other way round. */
  playerDps: number
  slowPct: number
  pullForce: number
  /** Accumulates so damage-over-time applies in whole points, not fractions
   *  that round to zero every tick. */
  tickAcc: number
  playerAcc: number
}

export function makeHazard(): Hazard {
  return {
    active: false, kind: 'slow', x: 0, y: 0, radius: 0, growth: 0,
    life: 0, maxLife: 1, dps: 0, playerDps: 0, slowPct: 0, pullForce: 0,
    tickAcc: 0, playerAcc: 0,
  }
}

export interface DamageNumber {
  active: boolean
  x: number
  y: number
  vy: number
  life: number
  maxLife: number
  value: number
  crit: boolean
}

export function makeDamageNumber(): DamageNumber {
  return { active: false, x: 0, y: 0, vy: 0, life: 0, maxLife: 0.5, value: 0, crit: false }
}

export interface Particle {
  active: boolean
  x: number
  y: number
  vx: number
  vy: number
  life: number
  maxLife: number
  colour: number
  size: number
  /** Blood settles and stamps a decal; sparks just fade. */
  stains: boolean
}

export function makeParticle(): Particle {
  return {
    active: false, x: 0, y: 0, vx: 0, vy: 0, life: 0, maxLife: 0.4,
    colour: 0, size: 2, stains: false,
  }
}

/**
 * One playing FX clip — a hit spark, a muzzle flash, an explosion.
 *
 * These are pure decoration: nothing reads an effect back, so the sim can drop
 * one on the floor when the pool is full without changing the run. That is also
 * why they carry no previous position — an effect lasts a few frames at a fixed
 * point and interpolating it would buy nothing.
 */
export interface Effect {
  active: boolean
  /** Atlas clip name, without the `fx.` prefix or frame index. */
  clip: string
  x: number
  y: number
  /** Drift, so a spark on a moving target does not hang in the air behind it. */
  vx: number
  vy: number
  life: number
  maxLife: number
  /** Radians. Directional clips (muzzle, slash) point along this. */
  rotation: number
  scale: number
  /** Drawn under the sprite layer rather than over it — for ground effects
   *  like the dash dust, which should not cover the player's feet. */
  under: boolean
}

export function makeEffect(): Effect {
  return {
    active: false, clip: '', x: 0, y: 0, vx: 0, vy: 0, life: 0, maxLife: 0.3,
    rotation: 0, scale: 1, under: false,
  }
}
