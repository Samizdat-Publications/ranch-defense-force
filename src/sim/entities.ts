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
  /**
   * Which ATLAS SHEET draws this one, as opposed to which enemy it is.
   *
   * Almost always the same string as `typeId`, and separate from it because a
   * flock of ten identical hens reads as one hen drawn ten times. An enemy type
   * may declare `sheets` in enemies.json and every spawn takes the next one in
   * the list, so the flock is visibly mixed while remaining, to the sim, a
   * single enemy with a single stat block.
   *
   * The three SPRITE lookups in both renderers read this. The stat lookups --
   * `drawScale`, `deathSeconds`, the behaviour table -- must keep reading
   * `typeId`, or a variant sheet would silently become a different enemy.
   */
  sheetId: string
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
  /**
   * Seconds until this enemy may flash again.
   *
   * Without it the flash is not a flash. It was re-armed on every hit, and at
   * late-wave fire rates an enemy is hit more often than once per 60ms, so it
   * never expired -- wave 15 rendered most of the crowd as solid white
   * silhouettes and the wave-12 boss was invisible for the whole fight.
   */
  flashLock: number
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
  /**
   * Seconds elapsed in the current attack, 0 when not attacking. Drives the
   * attack clip.
   *
   * A RENDER-FACING flag on purpose. The behaviours encode their own state in
   * the `t0`/`s0` scratch — `charge` uses `s0` for "0 approach, 1 winding up,
   * 2 charging, 3 staggered" — and that encoding is private to each behaviour.
   * A renderer that decoded it would break the moment a behaviour renumbered
   * its states, silently and only in the art. So the behaviour says "I am
   * attacking" and the renderer never learns why.
   */
  attackT: number
  /**
   * Seconds left on the recoil clip -- the "I have just been hit" pose.
   *
   * Separate from `flash`, which is the white blink, because the two want
   * different lengths: a blink reads at 60ms and a recoil animation does not.
   * It is armed by the SAME refractory as the flash though, so a burning enemy
   * recoils once rather than every damage tick, which is the failure the flash
   * itself shipped with.
   */
  hitT: number
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
  /** Salt Circle latch: 1 while standing on the ring, so it bites once per crossing. */
  saltMark: number
  /** Trip Wire latch (batch 3, H8): the same one-bite-per-crossing shape as
   *  `saltMark`, kept as its own field because a run can own both at once and
   *  a shared latch would let one hazard silently arm or disarm the other. */
  wireMark: number
  /** Windbreak (batch 3, body): seconds until this enemy may again deal and
   *  take the enemy-into-enemy collision damage. Rate-limits a knocked-back
   *  enemy from re-triggering the collision every tick it overlaps another. */
  collideCd: number
  /** Whether the last damage this enemy took was melee. Drives the Reaper's re-swing. */
  lastHitMelee: boolean
  slowLife: number
  /**
   * Which weapon's hit landed last, by id. `''` for a hit that carries none
   * (a chain, a burst, a corpse split) — see `applyHit`. Batch 2's Straw
   * Chopper is the only reader today: a per-weapon "this weapon's kills do
   * X" card needs to know whose kill it was, and nothing before it did.
   */
  lastHitWeaponId: string
}

export function makeEnemy(): Enemy {
  return {
    active: false, typeId: '', sheetId: '', x: 0, y: 0, px: 0, py: 0, vx: 0, vy: 0,
    kx: 0, ky: 0, hp: 1, maxHp: 1, speed: 0, damage: 0, radius: 10, xp: 1,
    behaviour: 'chase', elite: false, flash: 0, flashLock: 0, stun: 0, facing: 0,
    t0: 0, t1: 0, s0: 0, s1: 0, touchCd: 0, knockbackImmune: false, attackT: 0, hitT: 0,
    dying: 0, hpBuffPct: 0, anim: 0, travelled: 0,
    burnDps: 0, burnLife: 0, burnAcc: 0, burnGen: 0,
    bleedDps: 0, bleedLife: 0, bleedAcc: 0,
    markPct: 0, markLife: 0, slowPct: 0, slowLife: 0, saltMark: 0, lastHitMelee: false,
    lastHitWeaponId: '', wireMark: 0, collideCd: 0,
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
  /**
   * `'placeable'` (docs/UPGRADE_ROSTER.md batch 3, H8): a turret, trap or coop
   * planted at a fixed point. Like `'minion'`, an `attached` one is exempt from
   * `collideProjectiles`' pierce-based free — its own update loop manages its
   * life — but UNLIKE `'minion'` it is NOT exempt when it is not attached,
   * so a coop's hen (moving, not attached) is freed on its first hit the same
   * way any ordinary shot is. That single distinction is why the type exists
   * separately from `'minion'` rather than reusing it.
   */
  type: 'melee' | 'ranged' | 'orbit' | 'aura' | 'utility' | 'minion' | 'placeable'
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
  /**
   * H2 (docs/UPGRADE_ROSTER.md §8): ricochets this round has already taken.
   *
   * Its own field rather than the `t0`/`t1` scratch, for the reason stated at
   * the top of the payload block: the scratch means a different thing per
   * behaviour, and `bounceSplit` is already using both of them for its bounce
   * count and its shard budget. A rider sharing that would be a bug waiting
   * for the next weapon — which is exactly what the payload fields exist to
   * avoid.
   */
  ricochets: number

  // --- docs/UPGRADE_ROSTER.md batch 2, H12 (per-weapon, not player-wide) ---
  // H1 and H4 already exist as PLAYER-WIDE fields on `World`'s `specialItems`
  // (Fence Charge's chain, Burr Load's homing) because those cards apply to
  // every shot the player owns. A weapon-upgrade card is scoped to the ONE
  // weapon that granted it — Live Wire's chain is the Drum Gun's shards only,
  // Match Barrel's homing is the Varmint Rifle's own round — so it rides the
  // PROJECTILE instead: set once at spawn by the behaviour that owns it, read
  // once by the same generic call sites the player-wide fields already use.
  /** H4 — Match Barrel. Zero for every projectile that is not one. */
  homingRate: number
  /** H1 — Live Wire. Zero for every projectile that is not a Drum Gun shard
   *  carrying it. */
  chainCount: number
  chainRange: number
  chainMul: number
  /**
   * Backpack Tank (Chem Sprayer epic): the LOAD this shot stamps on lasts
   * this many times as long. Read once, in `World.applyElementTo`, where
   * every other weapon's shot already picks up the player's element — 1 for
   * every projectile that is not the Chem Sprayer's jet with the card taken,
   * so this is arithmetically identical to the line it multiplies onto for
   * every other weapon.
   */
  loadDurationMul: number
}

export function makeProjectile(): Projectile {
  return {
    active: false, weaponId: '', x: 0, y: 0, px: 0, py: 0, vx: 0, vy: 0,
    damage: 0, radius: 6, life: 0, pierce: 0, hitStamp: -1, isCrit: false,
    behaviour: 'stream', attached: false, angle: 0, angularVelocity: 0,
    orbitRadius: 0, knockback: 0, type: 'ranged', t0: 0, t1: 0,
    hitsLeft: 999, rearm: 0, stunOnHit: 0, burnDps: 0, burnSeconds: 0,
    bleedDps: 0, bleedSeconds: 0, markPct: 0, markSeconds: 0,
    slowOnHit: 0, slowSeconds: 0, ricochets: 0,
    homingRate: 0, chainCount: 0, chainRange: 0, chainMul: 0, loadDurationMul: 1,
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
  /** Atlas frame key, e.g. `crop.pumpkin` or `node.oreGold`. */
  sprite: string
  /** Which harvest kind this is — `rock`, `tree` or `crop`. Decides which tool
   *  works it and therefore how fast it comes apart. */
  kind: string
  x: number
  y: number
  hp: number
  maxHp: number
  radius: number
  feed: number
  /** XP granted on break, paid out as gems so the player collects it. */
  xp: number
  flash: number
  /** Counts down after the killing blow, for the pop. */
  dying: number
  /** Seconds left on the "being worked" shake. Purely cosmetic, but it is the
   *  only feedback that a node you are standing next to is actually coming
   *  apart, which matters when the tool fires on its own. */
  working: number
  /**
   * Seconds the player has been stood on this node, ramping its harvest rate.
   *
   * Without it, proximity harvesting quietly rewards running: sweeping past
   * twenty nodes at base rate beats working one, so the mechanic meant to give
   * a stationary player something to do paid the kiter more. The ramp makes
   * committing to a seam the efficient play, which is both the Deep Rock read
   * and what The Hand's whole identity needs.
   */
  dwell: number
  /**
   * Name of the drop table rolled when this breaks, or `''` for a harvest node.
   *
   * Harvest nodes pay out every time, from `feed` and `xp` above -- that is the
   * economy the tools buy into. A BREAKABLE pays out from a weighted table that
   * is usually empty, which is a different promise and deliberately a different
   * field: nothing reads both.
   */
  drops: string
}

export function makeProp(): Prop {
  return {
    active: false, sprite: 'crop.corn', kind: 'crop', x: 0, y: 0, hp: 1, maxHp: 1,
    radius: 11, feed: 1, xp: 0, flash: 0, dying: 0, working: 0, dwell: 0, drops: '',
  }
}

/**
 * `magnet` and `gear` are DROPS, not currency: they are collected the same way
 * but resolve to an effect and an item rather than to a number. `collect` must
 * therefore switch on the kind exhaustively -- it used to fall through to heal
 * for anything that was not xp or feed, and a magnet landing in that branch
 * would silently have healed the player instead.
 */
export type PickupKind = 'xp' | 'feed' | 'heal' | 'magnet' | 'gear'

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
  /** For `gear`: which item id this hands over. Empty for every other kind. */
  itemId: string
}

export function makePickup(): Pickup {
  return {
    active: false, kind: 'xp', x: 0, y: 0, px: 0, py: 0, vx: 0, vy: 0,
    value: 1, magnetised: false, speed: 0, bob: 0, itemId: '',
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
  /**
   * How much this hazard slows the PLAYER, 0-100. Separate from `slowPct`,
   * which has only ever slowed enemies — the Watering Can's rind slick is a
   * player tool and must keep behaving exactly as it did. Only the map's own
   * ambient hazards set this.
   */
  playerSlowPct: number
  pullForce: number
  /**
   * Batch 2, Spoiled Feed: a `lure` hazard can mark whatever it pulls, 0 for
   * every hazard this weapon did not make — which is every hazard that
   * existed before this card, so this is arithmetically identical for them.
   */
  markPct: number
  markSeconds: number
  /** Accumulates so damage-over-time applies in whole points, not fractions
   *  that round to zero every tick. */
  tickAcc: number
  playerAcc: number
  /**
   * Atlas frame drawn under the hazard's circle, or '' for none.
   *
   * A string on a pooled struct rather than a lookup, because the alternative
   * is the render layer asking the map what kind of hazard this is on every
   * hazard every frame. Assigned once at spawn from content; the hot loop only
   * ever reads it. Weapon-made hazards leave it empty and keep the plain circle
   * they have always had — art here marks the ones the MAP put down.
   */
  sprite: string
}

export function makeHazard(): Hazard {
  return {
    active: false, kind: 'slow', x: 0, y: 0, radius: 0, growth: 0,
    life: 0, maxLife: 1, dps: 0, playerDps: 0, slowPct: 0, playerSlowPct: 0,
    pullForce: 0, markPct: 0, markSeconds: 0, tickAcc: 0, playerAcc: 0, sprite: '',
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
