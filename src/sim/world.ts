/**
 * The simulation. Owns every pool, the grid, the player and the spawner, and
 * runs the tick order from CLAUDE.md in exactly that sequence.
 *
 * Nothing in here imports from `render/` or `ui/` — the world raises events and
 * exposes read-only state, and the presentation layers read it. That boundary
 * is a non-negotiable, and it is what makes the sim testable headlessly.
 */
import { Pool } from '../core/pool'
import { Rng } from '../core/rng'
import { SpatialGrid } from '../core/spatial'
import {
  makeDamageNumber, makeEffect, makeEnemy, makeHazard, makeParticle, makePickup, makeProjectile, makeProp,
  type DamageNumber, type Effect, type Enemy, type Hazard, type HazardKind,
  type Particle, type Pickup, type Projectile,
  type Prop,
} from './entities'
import { Player } from './player'
import { Spawner } from './spawner'
import { resolveDamage, waveIncome, waveScalar } from './formulas'
import { ELEMENTS, ENEMIES, ITEMS, NODES, TUNING, WAVES, WEAPONS, type StatMods } from '../content'
import { FIRE, SUSTAIN, type FireContext } from '../behaviours/weapons'
import { ENEMY_BEHAVIOURS, type SteerContext } from '../behaviours/enemies'

const T = TUNING
const P = T.player
const C = T.combat
/** Minimum seconds between bark-summoned packs, across the whole field. */
const BARK_INTERVAL = 6

export interface Telegraph {
  x: number
  y: number
  angle: number
  range: number
  spread: number
  life: number
  maxLife: number
}

export interface WorldEvents {
  /** A sound the presentation layer may play. The sim never touches audio
   *  itself — same boundary that keeps it headless and testable. */
  onSound?: (name: string) => void
  onLevelUp?: (levels: number) => void
  onWaveComplete?: (wave: number, income: number) => void
  onPlayerDeath?: () => void
  onBossWave?: (bossId: string) => void
}

export class World {
  readonly rng: Rng
  readonly seed: number
  readonly player = new Player()
  readonly spawner: Spawner

  readonly arenaW = WAVES.arena.width
  readonly arenaH = WAVES.arena.height

  readonly enemies: Pool<Enemy>
  readonly projectiles: Pool<Projectile>
  readonly pickups: Pool<Pickup>
  readonly damageNumbers: Pool<DamageNumber>
  readonly particles: Pool<Particle>
  readonly hazards: Pool<Hazard>
  readonly props: Pool<Prop>
  readonly effects: Pool<Effect>

  private readonly grid: SpatialGrid
  private readonly gx: Float64Array
  private readonly gy: Float64Array
  private readonly queryOut: Int32Array

  /** Monotonic tick counter; projectiles stamp it to avoid double-hits. */
  tick = 0
  elapsed = 0
  /** Frozen while > 0 — crit hitstop and the level-up/shop pause. */
  hitstop = 0
  paused = false
  over = false

  shake = 0
  readonly telegraphs: Telegraph[] = []
  /** Blood pixels that landed this tick, drained by the decal layer. */
  readonly stains: number[] = []

  // Run stats for the results screen, and for the balance harness — knowing
  // *what* killed a run is most of knowing whether the run is fair.
  kills = 0
  damageDealt = 0
  damageTakenFromContact = 0
  damageTakenFromHazards = 0
  wavesCleared = 0
  cropsHarvested = 0

  events: WorldEvents = {}

  /** Raise a sound intent. Cheap enough to call from anywhere in the tick. */
  private sound(name: string): void {
    this.events.onSound?.(name)
  }

  /**
   * Fractional accumulators for the rate-limited cosmetic effects.
   *
   * Deliberately not RNG rolls. An effect must never touch `this.rng` — a
   * cosmetic decision that consumed the sim's stream would mean the number of
   * sparks drawn changed where the next enemy spawned, and the seed-replay
   * guarantee would be hostage to the art. Accumulating the rate gives the exact
   * same frequency, spread evenly across hits rather than clumped by tick.
   */
  /** Set when a boss spawns; purely informational for the UI. */
  bossIndexHint: string | null = null

  /**
   * The Duster's closing arena (§9). `arenaBurnInset` is how far the fire has
   * eaten in from every edge; standing outside the remaining rectangle burns.
   *
   * The only undodgeable pressure in the fight, and slow enough to plan around
   * — ninety seconds to take the field down to a third.
   */
  arenaBurnInset = 0
  private arenaBurnTarget = 0
  private arenaBurnSeconds = 0
  private arenaBurnDps = 0
  private arenaBurnAcc = 0

  private sparkAcc = 0
  private muzzleAcc = 0

  private readonly spawnPoint = { x: 0, y: 0 }
  private readonly barkQueue: { x: number; y: number }[] = []
  private barkCooldown = 0
  private specialItems = { reflect: 0, auraRadius: 0, auraReduction: 0 }

  constructor(seed: number, classId: string, metaMods: StatMods = {}) {
    this.seed = seed
    this.rng = new Rng(seed)
    this.spawner = new Spawner(this.rng)

    this.enemies = new Pool(T.pools.enemies, makeEnemy)
    this.projectiles = new Pool(T.pools.projectiles, makeProjectile)
    this.pickups = new Pool(T.pools.pickups, makePickup)
    this.damageNumbers = new Pool(T.pools.damageNumbers, makeDamageNumber)
    this.particles = new Pool(T.pools.particles, makeParticle)
    this.hazards = new Pool(T.pools.hazards, makeHazard)
    this.props = new Pool(T.pools.props, makeProp)
    this.effects = new Pool(T.pools.effects, makeEffect)

    this.grid = new SpatialGrid(this.arenaW, this.arenaH, T.pools.enemies)
    this.gx = new Float64Array(T.pools.enemies)
    this.gy = new Float64Array(T.pools.enemies)
    this.queryOut = new Int32Array(512)

    this.player.init(classId, metaMods)
    this.player.x = this.arenaW / 2
    this.player.y = this.arenaH / 2
    this.player.px = this.player.x
    this.player.py = this.player.y
    this.refreshSpecialItems()
    this.scatterField()
  }

  /**
   * Scatter harvestable crops across the field, away from the player's feet so
   * the opening seconds are not spent standing inside one.
   */
  /**
   * Scatter one kind of harvestable node across the field.
   *
   * Variants are drawn by weight, so a run's field is mostly plain rock with
   * the occasional gold seam rather than an even spread — the point of ore is
   * that spotting it is worth something.
   */
  private scatterNodes(kind: string, count: number): void {
    const def = NODES.kinds[kind]
    if (!def) return
    const field = NODES.field
    const cap = field.max[kind] ?? 0
    const pad = 80

    let live = 0
    for (let i = 0; i < this.props.live; i++) if (this.props.items[i].kind === kind) live++

    let totalWeight = 0
    for (const v of def.variants) totalWeight += v.weight

    for (let i = 0; i < count; i++) {
      if (live >= cap) return
      let x = 0
      let y = 0
      // A handful of attempts, then give up on this one rather than loop.
      for (let attempt = 0; attempt < 8; attempt++) {
        x = this.rng.range(pad, this.arenaW - pad)
        y = this.rng.range(pad, this.arenaH - pad)
        if (Math.hypot(x - this.player.x, y - this.player.y) >= field.minDistanceFromPlayer) break
      }

      let roll = this.rng.next() * totalWeight
      let variant = def.variants[def.variants.length - 1]
      for (const v of def.variants) {
        roll -= v.weight
        if (roll <= 0) { variant = v; break }
      }

      const p = this.props.acquire()
      if (!p) return
      p.kind = kind
      p.sprite = variant.sprite
      p.x = x
      p.y = y
      p.maxHp = variant.hp + def.hpPerWave * (this.spawner?.wave ?? 1)
      p.hp = p.maxHp
      p.radius = def.radius
      p.feed = variant.feed
      p.xp = variant.xp
      p.flash = 0
      p.dying = 0
      p.working = 0
      p.dwell = 0
      live++
    }
  }

  /** Lay out the whole field at the start of a run. */
  private scatterField(): void {
    for (const [kind, n] of Object.entries(NODES.field.initial)) this.scatterNodes(kind, n)
  }

  // ---------------------------------------------------------------- tick

  step(dt: number, moveX: number, moveY: number, abilityPressed: boolean): void {
    if (this.paused || this.over) return

    if (this.hitstop > 0) {
      // Hitstop freezes the simulation but not its clock, so cooldowns and
      // wave timers stay honest.
      this.hitstop -= dt
      return
    }

    this.tick++
    this.elapsed += dt

    // 2. player
    this.player.move(moveX, moveY, dt, this.arenaW, this.arenaH)
    this.player.updatePassive(dt)
    this.player.regen(dt)
    if (abilityPressed) this.tryAbility()
    this.updateAbility(dt)

    // 3. spawner
    this.updateSpawner(dt)

    // 4. enemy steering + separation
    this.steerEnemies(dt)

    // 5. grid
    this.rebuildGrid()

    // 6. weapons
    this.updateWeapons(dt)

    // 7. projectiles
    this.integrateProjectiles(dt)

    // 8-9. collisions, damage, deaths, drops
    this.collideProjectiles()
    this.updateProps(dt)
    this.harvestNearby(dt)
    this.collideEnemiesWithPlayer(dt)
    this.updateHazards(dt)
    this.updateStatuses(dt)
    this.updateArenaBurn(dt)

    // 10. pickups
    this.updatePickups(dt)

    // 11. vfx
    this.updateVfx(dt)

    // 12. despawn is folded into each pass above (swap-pop on free)

    if (!this.player.alive && !this.over) {
      this.over = true
      this.events.onPlayerDeath?.()
    }
  }

  // ------------------------------------------------------------- systems

  private updateSpawner(dt: number): void {
    const s = this.spawner
    const wasWave = s.wave
    s.update(dt, this.enemies.live)

    for (const req of s.pending) {
      for (let i = 0; i < req.count; i++) {
        s.pickSpawnPoint(this.player.x, this.player.y, this.arenaW, this.arenaH, this.spawnPoint)
        // Rolled per enemy rather than per group. Rolling once for the group
        // and handing the result to every member meant a single success spawned
        // three to six elites shoulder to shoulder — the balance harness found
        // 2.6 of them alive at the average death, and wave 5, the first elite
        // wave, was killing more runs than any other.
        const elite = req.eliteEligible && this.rng.chance(WAVES.elite.chance)
        this.spawnEnemy(req.typeId, this.spawnPoint.x, this.spawnPoint.y, elite)
      }
    }

    // Barks queued by flanking dogs summon a second pack — the tell paying off.
    //
    // Two guards, both load-bearing. The summoned dogs are marked as having
    // already barked, or every pack summons a pack and the roster grows 4^n
    // until the pool saturates. And barks respect the pressure ceiling, which
    // the spawner enforces on itself but which nothing else was checking.
    this.barkCooldown -= dt
    while (this.barkQueue.length > 0) {
      const b = this.barkQueue.pop()!
      if (this.barkCooldown > 0 || this.enemies.live >= WAVES.pressureCeiling) continue
      this.barkCooldown = BARK_INTERVAL
      const def = ENEMIES.feralDog
      for (let i = 0; i < def.groupSize; i++) {
        const a = this.rng.range(0, Math.PI * 2)
        const dog = this.spawnEnemy('feralDog', b.x + Math.cos(a) * 260, b.y + Math.sin(a) * 260, false)
        if (dog) dog.s0 = 1 // already barked: this pack does not summon another
      }
    }

    if (s.waveComplete) {
      const income = waveIncome(wasWave)
      this.player.feed += income
      this.wavesCleared = wasWave
      // Wave boundaries sweep up everything on the ground (§11).
      this.magnetiseAll()
      const next = wasWave + 1
      // Advance before raising the event: a shop opened from the handler reads
      // the wave number, and it should see the wave it is standing between,
      // not the one that just ended.
      this.sound('waveStart')
      s.beginWave(next)
      // The field grows back a little each wave, so a player who cleared it
      // early is not permanently out of crops to harvest.
      for (const [kind, n] of Object.entries(NODES.field.regrowPerWave)) this.scatterNodes(kind, n)
      this.events.onWaveComplete?.(wasWave, income)
      const bossId = (WAVES.bossWaves as Record<string, string>)[String(next)]
      if (bossId) {
        this.spawnBoss(bossId)
        this.events.onBossWave?.(bossId)
      }
    }
  }

  private steerEnemies(dt: number): void {
    const ctx: SteerContext = {
      world: this, e: null as unknown as Enemy, index: 0, dt,
      playerX: this.player.x, playerY: this.player.y,
    }
    for (let i = this.enemies.live - 1; i >= 0; i--) {
      const e = this.enemies.items[i]
      if (e.dying > 0) {
        e.dying -= dt
        if (e.dying <= 0) this.enemies.free(i)
        continue
      }
      e.px = e.x
      e.py = e.y

      if (e.stun > 0) {
        e.stun -= dt
        e.vx = 0
        e.vy = 0
      } else {
        const fn = ENEMY_BEHAVIOURS[e.behaviour] ?? ENEMY_BEHAVIOURS.chase
        ctx.e = e
        ctx.index = i
        fn(ctx)
      }

      if (e.flash > 0) e.flash -= dt
      if (e.touchCd > 0) e.touchCd -= dt

      // Hazard effects on movement, applied before integration.
      let slow = 0
      if (e.slowLife > 0) {
        e.slowLife -= dt
        if (e.slowLife <= 0) e.slowPct = 0
        else slow = e.slowPct / 100
      }
      for (let h = 0; h < this.hazards.live; h++) {
        const hz = this.hazards.items[h]
        const d = Math.hypot(hz.x - e.x, hz.y - e.y)
        if (d > hz.radius) continue
        if (hz.kind === 'slow') slow = Math.max(slow, hz.slowPct / 100)
        if (hz.kind === 'lure' && d > 4) {
          e.vx += ((hz.x - e.x) / d) * hz.pullForce
          e.vy += ((hz.y - e.y) / d) * hz.pullForce
        }
      }
      const scale = 1 - slow

      const mx = e.vx * scale * dt + e.kx * dt
      const my = e.vy * scale * dt + e.ky * dt
      e.x += mx
      e.y += my
      e.anim += dt
      e.travelled += Math.hypot(mx, my)

      // Knockback decays exponentially so a hit reads as a shove, not a launch.
      const decay = Math.max(0, 1 - C.knockbackDecay * dt)
      e.kx *= decay
      e.ky *= decay

      if (e.x < 0) e.x = 0
      else if (e.x > this.arenaW) e.x = this.arenaW
      if (e.y < 0) e.y = 0
      else if (e.y > this.arenaH) e.y = this.arenaH
    }

    this.separateEnemies()
  }

  /**
   * Cheap separation so a pile never fully occludes the player (§11). Uses the
   * previous tick's grid, which is a frame stale and entirely good enough —
   * rebuilding here would double the grid cost for no visible gain.
   */
  private separateEnemies(): void {
    for (let i = this.enemies.live - 1; i >= 0; i--) {
      const e = this.enemies.items[i]
      if (e.dying > 0) continue
      const def = ENEMIES[e.typeId]
      if (def?.separation === false) continue

      const n = this.grid.query(e.x, e.y, e.radius * 2, this.queryOut)
      let pushX = 0
      let pushY = 0
      for (let k = 0; k < n; k++) {
        const j = this.queryOut[k]
        if (j === i || j >= this.enemies.live) continue
        const o = this.enemies.items[j]
        const dx = e.x - o.x
        const dy = e.y - o.y
        const want = e.radius + o.radius
        const d2 = dx * dx + dy * dy
        if (d2 > want * want || d2 < 0.0001) continue
        const d = Math.sqrt(d2)
        const overlap = (want - d) / d
        pushX += dx * overlap * 0.5
        pushY += dy * overlap * 0.5
      }
      e.x += pushX
      e.y += pushY
    }
  }

  private rebuildGrid(): void {
    const n = this.enemies.live
    for (let i = 0; i < n; i++) {
      this.gx[i] = this.enemies.items[i].x
      this.gy[i] = this.enemies.items[i].y
    }
    this.grid.rebuild(this.gx, this.gy, n)
  }

  private updateWeapons(dt: number): void {
    const p = this.player
    const ctx: FireContext = {
      world: this, player: p, slot: null as never, def: null as never,
      tier: 1, damage: 0, dt,
    }
    // The ring aims at whatever the weapons would shoot. Resolved once per
    // tick for the whole ring rather than per weapon: they all target the
    // nearest enemy, and twelve separate nearest-enemy scans a tick would be
    // twelve scans to reach the same answer.
    const aimTarget = this.findNearestEnemy(p.x, p.y, 900)
    const ringAim = aimTarget >= 0
      ? Math.atan2(this.enemies.items[aimTarget].y - p.y, this.enemies.items[aimTarget].x - p.x)
      : p.facing

    for (const slot of p.weapons) {
      const def = WEAPONS[slot.id]
      if (!def) continue
      // §7: each tier is base damage x1.6.
      const tierScale = Math.pow(1.6, slot.tier - 1)
      ctx.slot = slot
      ctx.def = def
      ctx.tier = slot.tier
      ctx.damage = def.base * tierScale

      if (slot.recoil > 0) slot.recoil -= dt
      // Melee swings where you face; everything else points at the target.
      slot.aimAngle = def.type === 'melee' ? p.facing : ringAim

      const sustain = SUSTAIN[def.behaviour]
      if (sustain && def.cooldown === 0) {
        sustain(ctx)
        continue
      }

      slot.cooldownLeft -= dt * p.stats.attackSpeedMultiplier
      if (slot.cooldownLeft <= 0) {
        const fire = FIRE[def.behaviour]
        const before = this.projectiles.live
        if (fire) fire(ctx)
        slot.recoil = T.fx.weaponRecoilSeconds

        // Stamp the element onto whatever that shot just produced. Done here,
        // once, rather than in each of the twelve behaviours: a behaviour
        // should not have to know elements exist, and any weapon added later
        // gets them for free.
        if (def.type === 'ranged') this.applyElementTo(before)
        // One hook for every weapon, rather than the same two lines in eight
        // behaviours. A swing gets its arc; anything that throws something gets
        // a flash at the muzzle, rate-limited because six weapons at +200%
        // attack speed is a lot of flashes.
        // Each weapon names its own voice in weapons.json. Routing by cooldown
        // meant six weapons shared two sounds and you could not hear what your
        // build was doing.
        this.sound(typeof def.sound === 'string' ? def.sound : 'shootLight')
        if (def.behaviour === 'arcSwing') {
          this.playFx('slash', p.x + Math.cos(p.facing) * 30, p.y + Math.sin(p.facing) * 30, p.facing)
        } else if (def.type === 'ranged') {
          this.muzzleAcc += T.fx.muzzleChance
          if (this.muzzleAcc >= 1) {
            this.muzzleAcc -= 1
            this.playFx('muzzle', p.x + Math.cos(p.facing) * 16, p.y + Math.sin(p.facing) * 16, p.facing)
          }
        }
        slot.cooldownLeft += Math.max(0.05, def.cooldown)
      }
      if (sustain && def.cooldown > 0) sustain(ctx)
    }
  }

  private integrateProjectiles(dt: number): void {
    for (let i = this.projectiles.live - 1; i >= 0; i--) {
      const p = this.projectiles.items[i]
      p.life -= dt
      if (p.life <= 0) {
        if (p.behaviour === 'arcLob') {
          this.areaDamage(p.x, p.y, p.t0, p.damage, 'ranged', 60)
          this.burstParticles(p.x, p.y, 6, 0x6ab04c)
          this.playFx('explosion', p.x, p.y, 0, p.t0 / 60)
          // T3 "leaves a slippery rind": t1 carries the radius, 0 when untiered.
          if (p.t1 > 0) this.leaveRind(p.x, p.y, p.t1, p.weaponId)
        }
        this.projectiles.free(i)
        continue
      }
      if (p.attached) {
        // T3 shovel "hits twice": the swing re-arms once part-way through its
        // life, so everything still inside the arc takes a second hit.
        if (p.behaviour === 'arcSwing' && p.t1 > 0 && p.life <= p.t0) {
          p.t1--
          p.hitStamp = this.tick
          p.hitsLeft = 999
          this.playFx('slash', p.x, p.y, p.angle)
        }
        continue
      }

      p.px = p.x
      p.py = p.y

      if (p.behaviour === 'minionHunt') {
        // The dog steers itself toward the nearest small enemy, leashed to the
        // player so it never wanders off the screen.
        const target = this.findNearestEnemy(p.x, p.y, 420)
        let tx = this.player.x
        let ty = this.player.y
        if (target >= 0) {
          tx = this.enemies.items[target].x
          ty = this.enemies.items[target].y
        }
        const leashD = Math.hypot(p.x - this.player.x, p.y - this.player.y)
        if (leashD > p.t0) {
          tx = this.player.x
          ty = this.player.y
        }
        const dx = tx - p.x
        const dy = ty - p.y
        const d = Math.hypot(dx, dy) || 1
        // Set from the weapon (angularVelocity is the dog's speed slot), so the
        // T2 rider is a different target speed rather than a multiplier applied
        // to the current one — the latter compounds every tick.
        const speed = p.angularVelocity > 0 ? p.angularVelocity : 210
        p.vx = (dx / d) * speed
        p.vy = (dy / d) * speed

        // Bite on a timer rather than every tick of contact, so a faster dog
        // wins by reaching more enemies instead of losing by dwelling less.
        p.rearm -= dt
        if (p.rearm <= 0) {
          const dogDef = WEAPONS[p.weaponId]
          p.rearm = typeof dogDef?.biteInterval === 'number' ? dogDef.biteInterval : 0.5
          p.hitStamp = this.tick
          p.hitsLeft = 999
        }
      }

      p.x += p.vx * dt
      p.y += p.vy * dt

      if (p.behaviour === 'bounceSplit') {
        let bounced = false
        if (p.x < 0 || p.x > this.arenaW) {
          p.vx = -p.vx
          p.x = Math.max(0, Math.min(this.arenaW, p.x))
          bounced = true
        }
        if (p.y < 0 || p.y > this.arenaH) {
          p.vy = -p.vy
          p.y = Math.max(0, Math.min(this.arenaH, p.y))
          bounced = true
        }
        if (bounced) {
          p.t0--
          if (p.t0 <= 0) {
            const w = WEAPONS[p.weaponId]
            const slot = this.player.weapons.find((s2) => s2.id === p.weaponId)
            const shardBounces = (slot?.tier ?? 1) >= 4
              ? (typeof w?.t4ShardBounces === 'number' ? w.t4ShardBounces : 1)
              : 0
            this.splitShards(p, p.t1, shardBounces)
            this.projectiles.free(i)
            continue
          }
        }
      } else if (p.behaviour !== 'minionHunt') {
        if (p.x < -40 || p.x > this.arenaW + 40 || p.y < -40 || p.y > this.arenaH + 40) {
          this.projectiles.free(i)
        }
      }
    }
  }

  /**
   * Break a projectile into a ring of shards.
   *
   * `bounces` is the egg's T4 rider: shards that bounce keep the bounceSplit
   * behaviour with a bounce budget, and split into nothing when it runs out, so
   * the rider cannot recurse into an unbounded shower.
   */
  private splitShards(p: Projectile, count: number, bounces = 0): void {
    const shardDef = WEAPONS[p.weaponId]
    const mul = typeof shardDef?.shardDamageMultiplier === 'number'
      ? shardDef.shardDamageMultiplier
      : 0.55
    for (let i = 0; i < count; i++) {
      const s = this.spawnProjectile()
      if (!s) return
      const a = (i / count) * Math.PI * 2
      s.weaponId = p.weaponId
      s.type = 'ranged'
      s.behaviour = bounces > 0 ? 'bounceSplit' : 'stream'
      s.attached = false
      s.x = p.x
      s.y = p.y
      s.px = s.x
      s.py = s.y
      s.vx = Math.cos(a) * 280
      s.vy = Math.sin(a) * 280
      s.radius = 5
      s.damage = p.damage * mul
      s.life = bounces > 0 ? 1.4 : 0.7
      s.pierce = 0
      s.knockback = 20
      s.hitStamp = -1
      s.t0 = bounces
      s.t1 = 0 // a bouncing shard splits into nothing: no recursion
    }
  }

  /**
   * The melon's T3 rind: a small slick where a melon landed.
   *
   * Separate from `throwPuddle` because it is a rider on a different weapon and
   * a shared helper would have to take every puddle parameter to serve both.
   */
  private leaveRind(x: number, y: number, radius: number, weaponId: string): void {
    const w = WEAPONS[weaponId]
    const h = this.spawnHazard()
    if (!h) return
    h.kind = 'slow'
    h.x = x
    h.y = y
    h.radius = radius
    h.growth = 0
    h.maxLife = typeof w?.t3RindSeconds === 'number' ? w.t3RindSeconds : 4
    h.life = h.maxLife
    h.slowPct = typeof w?.t3RindSlowPct === 'number' ? w.t3RindSlowPct : 40
    h.dps = 0
    h.pullForce = 0
    h.tickAcc = 0
  }

  /**
   * Shrink hazards of a kind that overlap a point — the watering can's T3
   * washing gas out of the air. A cloud that runs out of radius is removed by
   * the hazard pass on its next tick.
   */
  shrinkHazards(kind: HazardKind, x: number, y: number, radius: number, amount: number): void {
    for (let i = this.hazards.live - 1; i >= 0; i--) {
      const h = this.hazards.items[i]
      if (h.kind !== kind) continue
      if (Math.hypot(h.x - x, h.y - y) > radius + h.radius) continue
      h.radius -= amount
      // Stop it growing back: a gas cloud expands, and washing it would
      // otherwise be a losing race against its own growth.
      h.growth = 0
      if (h.radius <= 4) this.hazards.free(i)
    }
  }

  private collideProjectiles(): void {
    for (let i = this.projectiles.live - 1; i >= 0; i--) {
      const p = this.projectiles.items[i]
      if (p.pierce === -1) continue // detonates on expiry, not on contact

      const n = this.grid.query(p.x, p.y, p.radius + 24, this.queryOut)
      for (let k = 0; k < n; k++) {
        const j = this.queryOut[k]
        if (j >= this.enemies.live) continue
        const e = this.enemies.items[j]
        if (e.dying > 0) continue

        // Hitboxes that persist across many ticks stamp what they hit, so one
        // swing does not land sixty times. Keyed on the stamp rather than on
        // `attached` because the barn dog is unattached and needs it too: it
        // overlaps its target for many ticks, and without a stamp its damage
        // was a function of how long it dwelt, which made the T2 speed rider
        // strictly worse than no rider at all.
        const stamped = p.hitStamp !== -1
        if (stamped && e.t1 === p.hitStamp) continue

        const dx = e.x - p.x
        const dy = e.y - p.y
        const want = e.radius + p.radius
        if (dx * dx + dy * dy > want * want) continue

        if (stamped) {
          if (p.hitsLeft <= 0) continue
          p.hitsLeft--
          e.t1 = p.hitStamp
        }
        this.applyHit(j, p)
        // Minions are never spent by hitting; they are refreshed by the weapon.
        if (!p.attached && p.type !== 'minion') {
          if (p.pierce > 0) {
            p.pierce--
          } else {
            this.projectiles.free(i)
            break
          }
        }
      }
    }
  }

  private applyHit(enemyIndex: number, p: Projectile): void {
    const e = this.enemies.items[enemyIndex]
    const type = p.type === 'melee' || p.type === 'orbit' ? 'melee' : 'ranged'
    const isCrit = this.rng.chance(this.player.stats.critChance)

    // Statuses land BEFORE the damage, so a killing blow still leaves them on
    // the corpse. Applying them after meant a chili shot that killed outright
    // never lit what it killed, and the T3 "burn spreads on death" rider could
    // therefore never fire at all. A mark works the same way: the hit that
    // applies it should benefit from it.
    if (p.stunOnHit > 0 && !e.knockbackImmune) e.stun = Math.max(e.stun, p.stunOnHit)
    if (p.burnDps > 0) this.applyBurn(e, p.burnDps, p.burnSeconds)
    if (p.bleedDps > 0) this.applyBleed(e, p.bleedDps, p.bleedSeconds)
    if (p.markPct > 0) this.applyMark(e, p.markPct, p.markSeconds)
    if (p.slowOnHit > 0) {
      if (p.slowOnHit > e.slowPct) e.slowPct = p.slowOnHit
      if (p.slowSeconds > e.slowLife) e.slowLife = p.slowSeconds
    }

    this.damageEnemy(enemyIndex, p.damage, type, isCrit)
    if (p.burnDps > 0) this.igniteSlicksNear(p.x, p.y)

    if (!e.active || e.dying > 0) return
    if (p.knockback > 0 && !e.knockbackImmune) {
      const dx = e.x - p.x
      const dy = e.y - p.y
      const d = Math.hypot(dx, dy) || 1
      e.kx += (dx / d) * p.knockback
      e.ky += (dy / d) * p.knockback
    }
  }

  /**
   * Crops take damage from anything that hits them. They are static and few
   * (tens, against hundreds of enemies), so a direct scan is cheaper than
   * maintaining a second grid for them.
   */
  /**
   * Proximity harvesting — the pickaxe and the axe working on their own.
   *
   * This is the Deep Rock Galactic: Survivor model rather than the old one.
   * Before, a crop only broke when a stray bullet happened to clip it, which
   * made harvesting invisible chip damage you never chose. Now standing near a
   * node works it continuously, so where you plant yourself is the decision and
   * the tools never compete with a weapon slot for it.
   *
   * Every node in range is worked at once, which is what makes a cluster worth
   * walking into and gives a stationary player something to be doing.
   */
  private harvestNearby(dt: number): void {
    const pl = this.player
    if (!pl.alive) return
    const reach = T.harvest.radius * (1 + pl.stats.harvestPct / 100)

    const h = T.harvest
    for (let i = this.props.live - 1; i >= 0; i--) {
      const n = this.props.items[i]
      if (n.dying > 0) continue
      const dx = n.x - pl.x
      const dy = n.y - pl.y
      const want = reach + n.radius
      if (dx * dx + dy * dy > want * want) {
        // Walk away and the ramp bleeds off, faster than it built.
        if (n.dwell > 0) n.dwell = Math.max(0, n.dwell - dt * h.dwellDecayRate)
        continue
      }

      const dps = this.toolDpsFor(n.kind)
      if (dps <= 0) continue

      // Committing to a seam beats sweeping past it. Base rate on arrival,
      // ramping to dwellMultiplier over dwellSeconds of standing there.
      n.dwell = Math.min(h.dwellSeconds, n.dwell + dt)
      const ramp = 1 + (n.dwell / h.dwellSeconds) * (h.dwellMultiplier - 1)
      n.hp -= dps * ramp * dt
      n.working = h.workingSeconds
      this.sound(n.kind === 'rock' ? 'mine' : 'chop')
      if (n.hp <= 0) {
        this.harvest(n)
        // `harvest` marks it dying; the prop pass frees the slot.
      }
    }
  }

  /**
   * How fast the player works a node of this kind, given the tool that suits it
   * and that tool's current tier.
   */
  private toolDpsFor(kind: string): number {
    const pl = this.player
    for (const [toolId, tool] of Object.entries(NODES.tools)) {
      // Skip documentation keys — see TOOL_TIER_CAP in player.ts.
      if (toolId.startsWith('_') || !Array.isArray(tool?.tiers)) continue
      if (tool.worksKind !== kind && tool.alsoWorks !== kind) continue
      const tierIndex = toolId === 'pickaxe' ? pl.pickaxeTier : pl.axeTier
      const tier = tool.tiers[Math.min(tierIndex, tool.tiers.length - 1)]
      return tier ? tier.dps : 0
    }
    return 0
  }

  /**
   * Node timers only — flash, the working shake, and the break animation.
   *
   * Weapons deliberately do NOT damage nodes any more. They used to, and it
   * quietly defeated the whole harvesting design: a shovel swing carries more
   * damage than a wooden pickaxe does in five seconds, so every node was broken
   * incidentally by whatever was shooting past it and the pickaxe ladder bought
   * nothing. Measured at 0.28s to break a rock on every tool tier, wood through
   * diamond, because the tool was never the thing breaking it.
   *
   * Harvesting is the tools' job and only the tools' job. That is what makes
   * where you stand a decision and what gives the upgrades something to buy.
   */
  private updateProps(dt: number): void {
    for (let i = this.props.live - 1; i >= 0; i--) {
      const c = this.props.items[i]
      if (c.flash > 0) c.flash -= dt
      if (c.working > 0) c.working -= dt
      if (c.dying > 0) {
        c.dying -= dt
        if (c.dying <= 0) this.props.free(i)
      }
    }
  }

  private harvest(c: Prop): void {
    this.cropsHarvested++
    this.sound(c.kind === 'tree' ? 'treeFall' : 'nodeBreak')

    if (c.feed > 0) {
      const f = this.pickups.acquire()
      if (f) {
        f.kind = 'feed'
        f.x = c.x
        f.y = c.y
        f.px = f.x
        f.py = f.y
        f.value = c.feed
        f.magnetised = false
        f.speed = 0
        f.bob = 0
      }
    }

    // XP comes out as several small gems rather than one big one: a scatter
    // reads as a payout, and the magnet sweeps them up anyway.
    const gems = Math.min(8, Math.max(0, Math.round(c.xp / 3)))
    const per = gems > 0 ? c.xp / gems : 0
    for (let i = 0; i < gems; i++) {
      const g = this.pickups.acquire()
      if (!g) break
      g.kind = 'xp'
      g.x = c.x + this.rng.range(-10, 10)
      g.y = c.y + this.rng.range(-10, 10)
      g.px = g.x
      g.py = g.y
      g.value = per
      g.magnetised = false
      g.speed = 0
      g.bob = this.rng.range(0, 6)
    }

    // Rock shatters pale and cold, wood and crop break green.
    this.burstParticles(c.x, c.y, 10, c.kind === 'rock' ? 0xbfbacb : 0x9ec96b)
    if (c.kind === 'rock') this.playFx('arrowImpact', c.x, c.y, 0, 0.8)
    c.dying = C.deathSpinSeconds
  }

  private collideEnemiesWithPlayer(dt: number): void {
    const pl = this.player
    if (!pl.alive) return
    const n = this.grid.query(pl.x, pl.y, pl.radius + 40, this.queryOut)
    for (let k = 0; k < n; k++) {
      const j = this.queryOut[k]
      if (j >= this.enemies.live) continue
      const e = this.enemies.items[j]
      if (e.dying > 0 || e.touchCd > 0) continue
      const dx = e.x - pl.x
      const dy = e.y - pl.y
      const want = e.radius + pl.radius
      if (dx * dx + dy * dy > want * want) continue

      this.damagePlayer(e.damage * waveScalar(this.spawner.wave))
      e.touchCd = P.contactDamageInterval

      // Barbed Wire reflects onto whatever touched you.
      if (this.specialItems.reflect > 0) {
        this.damageEnemy(j, this.specialItems.reflect, 'melee', false)
      }
    }
    void dt
  }

  /**
   * Fire turns a slop slick into a fire that kills.
   *
   * The best kind of build interaction: two things the player already chose,
   * doing something neither does alone. A Chem Sprayer puddle is a slow; light
   * it and the same puddle is a killing field for the rest of its life.
   */
  private igniteSlicksNear(x: number, y: number): void {
    const el = ELEMENTS[this.player.element]
    if (!el?.ignitesSlicks) return
    for (let i = 0; i < this.hazards.live; i++) {
      const h = this.hazards.items[i]
      if (h.kind !== 'slow' || h.dps > 0) continue
      if (Math.hypot(h.x - x, h.y - y) > h.radius) continue
      h.dps = el.slickDps ?? 12
      this.sound('igniteFire')
      this.playFx('explosion', h.x, h.y, 0, h.radius / 60)
    }
  }

  private updateHazards(dt: number): void {
    for (let i = this.hazards.live - 1; i >= 0; i--) {
      const h = this.hazards.items[i]
      h.life -= dt
      if (h.growth > 0) h.radius += h.growth * dt
      if (h.life <= 0) {
        // Grain Lure T3 "detonates for 60": a lure carries its blast in `dps`,
        // which it otherwise does not use, and spends it as it expires.
        if (h.kind === 'lure' && h.dps > 0) {
          this.areaDamage(h.x, h.y, h.radius, h.dps, 'ranged', 200)
          this.playFx('explosion', h.x, h.y, 0, h.radius / 50)
          this.addShake(0.3)
        }
        this.hazards.free(i)
        continue
      }
      // Hazards that hurt the player. Acid pools and gas clouds spawned and
      // rendered but were harmless before this — the pools were the enemy's
      // whole point and they were decoration.
      if (h.playerDps > 0 && this.player.alive) {
        const pd = Math.hypot(this.player.x - h.x, this.player.y - h.y)
        if (pd <= h.radius) {
          h.playerAcc += h.playerDps * dt
          if (h.playerAcc >= 1) {
            const dmg = Math.floor(h.playerAcc)
            h.playerAcc -= dmg
            this.damagePlayer(dmg, 'hazard')
          }
        } else {
          h.playerAcc = 0
        }
      }

      if (h.dps > 0) {
        h.tickAcc += h.dps * dt
        if (h.tickAcc >= 1) {
          const dmg = Math.floor(h.tickAcc)
          h.tickAcc -= dmg
          const n = this.grid.query(h.x, h.y, h.radius, this.queryOut)
          for (let k = 0; k < n; k++) {
            const j = this.queryOut[k]
            if (j >= this.enemies.live) continue
            const e = this.enemies.items[j]
            if (Math.hypot(e.x - h.x, e.y - h.y) <= h.radius) {
              this.damageEnemy(j, dmg, 'ranged', false)
            }
          }
        }
      }
    }
  }

  /**
   * Damage-over-time and timed marks on enemies (M5).
   *
   * Runs inside step 9 (damage resolve), after direct hits, so a burn tick can
   * finish something a hit left at 1hp and the kill still routes through
   * `killEnemy` with its drops and on-death special.
   *
   * Reverse-iterated: a tick can kill, and `damageEnemy` swap-pops the slot.
   */
  private updateStatuses(dt: number): void {
    for (let i = this.enemies.live - 1; i >= 0; i--) {
      const e = this.enemies.items[i]
      if (!e.active || e.dying > 0) continue

      if (e.markLife > 0) {
        e.markLife -= dt
        if (e.markLife <= 0) e.markPct = 0
      }

      // Whole points only. 4 dps at 60Hz is 0.066 a tick, and rounding that per
      // tick is sixty zeroes — the accumulator is what makes a burn do damage.
      if (e.burnLife > 0) {
        e.burnLife -= dt
        e.burnAcc += e.burnDps * dt
        if (e.burnAcc >= 1) {
          const dmg = Math.floor(e.burnAcc)
          e.burnAcc -= dmg
          this.damageEnemy(i, dmg, 'ranged', false, true)
          if (!e.active || e.dying > 0) continue
        }
        if (e.burnLife <= 0) {
          e.burnDps = 0
          e.burnAcc = 0
        }
      }

      if (e.bleedLife > 0) {
        e.bleedLife -= dt
        e.bleedAcc += e.bleedDps * dt
        if (e.bleedAcc >= 1) {
          const dmg = Math.floor(e.bleedAcc)
          e.bleedAcc -= dmg
          this.damageEnemy(i, dmg, 'melee', false, true)
          if (!e.active || e.dying > 0) continue
        }
        if (e.bleedLife <= 0) {
          e.bleedDps = 0
          e.bleedAcc = 0
        }
      }
    }
  }

  /**
   * Light an enemy on fire. Refreshes rather than stacks: the strongest source
   * wins and the duration resets, so six chili shots are a hotter fire and not
   * six independent bookkeeping entries.
   *
   * `gen` marks which spread wave lit it, so a T3 chain cannot bounce back and
   * forth between two corpses forever.
   */
  applyBurn(e: Enemy, dps: number, duration: number, gen = 0): void {
    if (!e.active || e.dying > 0) return
    if (dps > e.burnDps) e.burnDps = dps
    if (duration > e.burnLife) e.burnLife = duration
    if (gen > e.burnGen) e.burnGen = gen
  }

  applyBleed(e: Enemy, dps: number, duration: number): void {
    if (!e.active || e.dying > 0) return
    if (dps > e.bleedDps) e.bleedDps = dps
    if (duration > e.bleedLife) e.bleedLife = duration
  }

  /** Mark an enemy to take extra damage for a while. */
  applyMark(e: Enemy, pct: number, duration: number): void {
    if (!e.active || e.dying > 0) return
    if (pct > e.markPct) e.markPct = pct
    if (duration > e.markLife) e.markLife = duration
  }

  private updatePickups(dt: number): void {
    const pl = this.player
    const magnetR = pl.stats.pickupRadius
    const collectR = T.pickups.collectRadius

    for (let i = this.pickups.live - 1; i >= 0; i--) {
      const g = this.pickups.items[i]
      g.px = g.x
      g.py = g.y
      const dx = pl.x - g.x
      const dy = pl.y - g.y
      const d = Math.hypot(dx, dy) || 1

      if (!g.magnetised && d <= magnetR) {
        g.magnetised = true
        g.speed = T.pickups.magnetInitialSpeed
      }

      if (g.magnetised) {
        // Accelerating, not lerping — the greed curve (§11).
        g.speed += T.pickups.magnetAcceleration * dt
        g.x += (dx / d) * g.speed * dt
        g.y += (dy / d) * g.speed * dt
        if (d <= collectR) {
          this.collect(g)
          this.pickups.free(i)
          continue
        }
      } else {
        g.bob += dt
      }
    }
  }

  private collect(g: Pickup): void {
    if (g.kind === 'xp') {
      const gained = g.value * (1 + this.player.stats.harvestPct / 100)
      const levels = this.player.gainXp(gained)
      if (levels > 0) this.events.onLevelUp?.(levels)
    } else if (g.kind === 'feed') {
      this.sound('pickupFeed')
      this.player.feed += Math.round(g.value * (1 + this.player.stats.harvestPct / 100))
    } else {
      this.sound('pickupHeal')
      this.player.hp = Math.min(this.player.stats.maxHp, this.player.hp + g.value)
    }
  }

  private updateVfx(dt: number): void {
    for (let i = this.damageNumbers.live - 1; i >= 0; i--) {
      const d = this.damageNumbers.items[i]
      d.life -= dt
      d.y += d.vy * dt
      d.vy *= 0.94
      if (d.life <= 0) this.damageNumbers.free(i)
    }
    for (let i = this.particles.live - 1; i >= 0; i--) {
      const p = this.particles.items[i]
      p.life -= dt
      p.x += p.vx * dt
      p.y += p.vy * dt
      p.vy += 380 * dt
      p.vx *= 0.96
      if (p.life <= 0) {
        if (p.stains) {
          // Landed blood stamps a permanent decal; the render layer drains
          // this and the pixel costs nothing per frame thereafter.
          this.stains.push(p.x, p.y, p.colour)
        }
        this.particles.free(i)
      }
    }
    for (let i = this.effects.live - 1; i >= 0; i--) {
      const e = this.effects.items[i]
      e.life -= dt
      e.x += e.vx * dt
      e.y += e.vy * dt
      e.vx *= 0.90
      e.vy *= 0.90
      if (e.life <= 0) this.effects.free(i)
    }
    for (let i = this.telegraphs.length - 1; i >= 0; i--) {
      const t = this.telegraphs[i]
      t.life -= dt
      if (t.life <= 0) this.telegraphs.splice(i, 1)
    }
    if (this.shake > 0) {
      this.shake -= T.camera.traumaDecayPerSecond * dt
      if (this.shake < 0) this.shake = 0
    }
  }

  // -------------------------------------------------------------- ability

  private tryAbility(): void {
    const p = this.player
    if (p.abilityCooldown > 0 || p.abilityActive > 0) return
    const a = p.def.ability
    p.abilityCooldown = a.cooldown

    if (a.id === 'digIn') {
      this.sound('digIn')
      p.abilityActive = (a.duration as number) ?? 2.5
      p.rooted = true
    } else if (a.id === 'bolt') {
      const dist = (a.dashDistance as number) ?? 180
      p.invuln = (a.iFrames as number) ?? 0.35
      p.x = Math.max(0, Math.min(this.arenaW, p.x + Math.cos(p.facing) * dist))
      p.y = Math.max(0, Math.min(this.arenaH, p.y + Math.sin(p.facing) * dist))
      this.sound('dash')
      this.burstParticles(p.px, p.py, 10, 0xd9c9a3)
      // Under the sprites: the dash trail is on the ground, not in the air.
      this.playFx('dust', p.px, p.py, p.facing, 1, 0, 0, true)
    }
  }

  private updateAbility(dt: number): void {
    const p = this.player
    if (p.abilityActive <= 0) return
    p.abilityActive -= dt
    if (p.abilityActive <= 0) {
      p.rooted = false
      const a = p.def.ability
      if (a.id === 'digIn') {
        const radius = (a.pulseRadius as number) ?? 140
        const kb = (a.pulseKnockback as number) ?? 260
        // Scaled to the real pulse radius so what you see is what it hits.
        this.playFx('shockwave', p.x, p.y, 0, radius / 55, 0, 0, true)
        const n = this.grid.query(p.x, p.y, radius, this.queryOut)
        for (let k = 0; k < n; k++) {
          const j = this.queryOut[k]
          if (j >= this.enemies.live) continue
          const e = this.enemies.items[j]
          const dx = e.x - p.x
          const dy = e.y - p.y
          const d = Math.hypot(dx, dy) || 1
          if (d > radius) continue
          if (!e.knockbackImmune) {
            e.kx += (dx / d) * kb
            e.ky += (dy / d) * kb
          }
        }
        this.addShake(0.35)
      }
    }
  }

  // ---------------------------------------------------------------- api

  /**
   * Put a boss on the field at the edge of the arena.
   *
   * Bosses do not come out of the spawner: they cost no threat, ignore the
   * pressure ceiling and there is exactly one, so routing them through the wave
   * budget would only give the budget a chance to refuse them.
   */
  /**
   * Start the rows burning inward. Idempotent — a second call does not restart
   * a burn already under way.
   */
  beginArenaBurn(seconds: number, toFraction: number): void {
    if (this.arenaBurnSeconds > 0) return
    this.arenaBurnSeconds = seconds
    // Shrink the SHORTER axis to the requested fraction; insetting both edges
    // by that much keeps the remaining field the right shape rather than a slot.
    const shorter = Math.min(this.arenaW, this.arenaH)
    this.arenaBurnTarget = (shorter * (1 - toFraction)) / 2
    const bossDef = ENEMIES.duster?.special as Record<string, number> | undefined
    this.arenaBurnDps = bossDef?.shrinkDps ?? 18
  }

  /** Whether a point is inside the part of the field that has not burned. */
  insideArena(x: number, y: number): boolean {
    const i = this.arenaBurnInset
    return x >= i && y >= i && x <= this.arenaW - i && y <= this.arenaH - i
  }

  private updateArenaBurn(dt: number): void {
    if (this.arenaBurnSeconds <= 0 || this.arenaBurnInset >= this.arenaBurnTarget) {
      if (this.arenaBurnInset <= 0) return
    } else {
      this.arenaBurnInset = Math.min(
        this.arenaBurnTarget,
        this.arenaBurnInset + (this.arenaBurnTarget / this.arenaBurnSeconds) * dt,
      )
    }
    if (!this.player.alive) return
    if (this.insideArena(this.player.x, this.player.y)) {
      this.arenaBurnAcc = 0
      return
    }
    // Standing in the fire. Environmental, so it neither grants nor is blocked
    // by mercy invulnerability.
    this.arenaBurnAcc += this.arenaBurnDps * dt
    if (this.arenaBurnAcc >= 1) {
      const dmg = Math.floor(this.arenaBurnAcc)
      this.arenaBurnAcc -= dmg
      this.damagePlayer(dmg, 'hazard')
    }
  }

  /** A length of the Duster's gas strip. */
  dropGasStrip(x: number, y: number, radius: number, seconds: number, dps: number): void {
    const h = this.spawnHazard()
    if (!h) return
    h.kind = 'gas'
    h.x = x
    h.y = y
    h.radius = radius
    h.growth = 0
    h.maxLife = seconds
    h.life = seconds
    h.dps = 0
    h.playerDps = dps
  }

  /** Pour enemies out around a boss, respecting the pressure ceiling. */
  summonFor(e: Enemy, typeId: string, count: number): void {
    for (let i = 0; i < count; i++) {
      if (this.enemies.live >= WAVES.pressureCeiling) return
      const a = this.rng.range(0, Math.PI * 2)
      this.spawnEnemy(
        typeId,
        Math.max(20, Math.min(this.arenaW - 20, e.x + Math.cos(a) * 260)),
        Math.max(20, Math.min(this.arenaH - 20, e.y + Math.sin(a) * 260)),
        false,
      )
    }
  }

  spawnBoss(bossId: string): Enemy | null {
    const def = ENEMIES[bossId]
    if (!def) return null
    // Come in from the far side, so the fight opens with him crossing to you.
    const a = this.rng.range(0, Math.PI * 2)
    const e = this.spawnEnemy(
      bossId,
      Math.max(60, Math.min(this.arenaW - 60, this.player.x + Math.cos(a) * 420)),
      Math.max(60, Math.min(this.arenaH - 60, this.player.y + Math.sin(a) * 420)),
      false,
    )
    if (e) {
      this.bossIndexHint = bossId
      this.sound('bossTell')
      this.addShake(0.8)
    }
    return e
  }

  /** The live boss, or null. Read by the HUD for its health bar. */
  findBoss(): Enemy | null {
    for (let i = 0; i < this.enemies.live; i++) {
      const e = this.enemies.items[i]
      if (e.active && e.dying <= 0 && ENEMIES[e.typeId]?.boss === true) return e
    }
    return null
  }

  /**
   * §9's Stampede: below half health every charge brings hogs with it, in the
   * same lane. Fired from the boss's own charge, not on a timer, so it reads as
   * his doing rather than as ambient spawning.
   */
  tryStampedePublic(e: Enemy): void {
    this.tryStampede(e)
  }

  private tryStampede(e: Enemy): void {
    const def = ENEMIES[e.typeId]
    const sp = def?.special as Record<string, unknown> | undefined
    if (!sp?.stampedeBelowPct) return
    if (e.hp > e.maxHp * ((sp.stampedeBelowPct as number) / 100)) return
    if (this.enemies.live >= WAVES.pressureCeiling) return
    const count = (sp.stampedeCount as number) ?? 4
    const typeId = (sp.stampedeSummons as string) ?? 'sickHog'
    for (let i = 0; i < count; i++) {
      const spread = (i - (count - 1) / 2) * 34
      this.spawnEnemy(
        typeId,
        e.x - Math.cos(e.facing) * 60 + Math.cos(e.facing + Math.PI / 2) * spread,
        e.y - Math.sin(e.facing) * 60 + Math.sin(e.facing + Math.PI / 2) * spread,
        false,
      )
    }
  }

  spawnEnemy(typeId: string, x: number, y: number, elite: boolean): Enemy | null {
    const def = ENEMIES[typeId]
    if (!def) return null
    const e = this.enemies.acquire()
    if (!e) return null

    const scalar = waveScalar(this.spawner.wave)
    e.typeId = typeId
    e.x = x
    e.y = y
    e.px = x
    e.py = y
    e.vx = 0
    e.vy = 0
    e.kx = 0
    e.ky = 0
    e.maxHp = def.hp * scalar * (elite ? WAVES.elite.hpMultiplier : 1)
    e.hp = e.maxHp
    e.speed = def.speed
    e.damage = def.damage
    e.radius = def.radius
    e.xp = def.xp
    e.behaviour = def.behaviour
    e.elite = elite
    e.flash = 0
    e.stun = 0
    e.facing = 0
    e.t0 = 0
    e.t1 = -1
    e.s0 = 0
    e.s1 = 0
    e.touchCd = 0
    e.knockbackImmune = def.knockbackImmune === true
    e.dying = 0
    e.hpBuffPct = 0
    e.burnDps = 0
    e.burnLife = 0
    e.burnAcc = 0
    e.burnGen = 0
    e.bleedDps = 0
    e.bleedLife = 0
    e.bleedAcc = 0
    e.markPct = 0
    e.markLife = 0
    // Stagger the animation phase so a group of ten does not walk in lockstep.
    e.anim = this.rng.range(0, 2)
    e.travelled = this.rng.range(0, 40)
    return e
  }

  /**
   * Pooled, so a slot arrives carrying whatever the last projectile left in it.
   * The rider payload is cleared here rather than in each behaviour: a weapon
   * that does not burn should never inherit a burn from the chili shot that
   * used the slot before it, and relying on twelve behaviours to each remember
   * that is how it would eventually happen.
   */
  spawnProjectile(): Projectile | null {
    const p = this.projectiles.acquire()
    if (!p) return null
    p.hitsLeft = 999
    p.rearm = 0
    p.stunOnHit = 0
    p.burnDps = 0
    p.burnSeconds = 0
    p.bleedDps = 0
    p.bleedSeconds = 0
    p.markPct = 0
    p.markSeconds = 0
    p.slowOnHit = 0
    p.slowSeconds = 0
    p.t0 = 0
    p.t1 = 0
    return p
  }

  /**
   * Put the player's element on every projectile spawned since `fromIndex`.
   *
   * The element swaps the whole bullet rather than tinting one — a fire build
   * fires actual fireballs, an acid build fires acid — and carries the lasting
   * damage on the payload fields the tier riders already use, so it needed no
   * new damage plumbing.
   */
  private applyElementTo(fromIndex: number): void {
    const el = ELEMENTS[this.player.element]
    if (!el || this.player.element === 'none') return
    for (let i = fromIndex; i < this.projectiles.live; i++) {
      const p = this.projectiles.items[i]
      if (el.burnDps) { p.burnDps = Math.max(p.burnDps, el.burnDps); p.burnSeconds = Math.max(p.burnSeconds, el.burnSeconds ?? 0) }
      if (el.bleedDps) { p.bleedDps = Math.max(p.bleedDps, el.bleedDps); p.bleedSeconds = Math.max(p.bleedSeconds, el.bleedSeconds ?? 0) }
      if (el.slowOnHit) { p.slowOnHit = Math.max(p.slowOnHit, el.slowOnHit); p.slowSeconds = Math.max(p.slowSeconds, el.slowSeconds ?? 0) }
    }
  }

  /** Pooled like projectiles, so the rider fields are cleared on the way out. */
  spawnHazard(): Hazard | null {
    const h = this.hazards.acquire()
    if (!h) return null
    h.playerDps = 0
    h.playerAcc = 0
    h.tickAcc = 0
    h.growth = 0
    h.dps = 0
    h.slowPct = 0
    h.pullForce = 0
    return h
  }

  /**
   * The one place enemy damage is applied. Everything — weapons, hazards,
   * reflect, boss attacks — comes through here so the formula lives once.
   *
   * `fromDot` marks a damage-over-time tick. It still kills, drops and counts,
   * but it draws no number and no spark: a burn ticks several times a second
   * per enemy, and forty burning enemies would empty the 64-slot damage-number
   * pool every frame and bury the hits that the player actually aimed.
   */
  damageEnemy(
    index: number,
    amount: number,
    type: 'melee' | 'ranged' | 'utility',
    isCrit: boolean,
    fromDot = false,
  ): void {
    const e = this.enemies.items[index]
    if (!e.active || e.dying > 0) return
    const s = this.player.stats

    const typePct = type === 'melee' ? s.meleePct : type === 'ranged' ? s.rangedPct : 0
    const dmg = resolveDamage(
      amount,
      s.damagePct + this.player.passiveDamagePct,
      typePct,
      0,
      isCrit,
      s.critDamagePct,
      0,
      1,
      e.markLife > 0 ? e.markPct : 0,
    )

    e.hp -= dmg
    e.flash = C.hitFlashSeconds
    this.damageDealt += dmg
    if (!fromDot) {
      this.addDamageNumber(e.x, e.y - e.radius, dmg, isCrit)
      this.bleed(e.x, e.y, isCrit ? 5 : 3)

      // A crit always announces itself; ordinary hits spark at a fixed rate, so
      // a late wave reads as combat rather than as a wall of white.
      if (isCrit) {
        this.playFx('bigImpact', e.x, e.y - e.radius * 0.4)
      this.sound('crit')
      } else {
        this.sparkAcc += T.fx.hitSparkChance
        if (this.sparkAcc >= 1) {
          this.sparkAcc -= 1
          // The impact reads as the element too, not just the bullet.
          const impact = (ELEMENTS[this.player.element]?.impact ?? 'arrowImpact') as
            keyof typeof T.fx & string
          this.playFx(impact, e.x, e.y - e.radius * 0.4)
        this.sound('hit')
        }
      }
    }

    if (s.lifestealPct > 0) {
      this.player.hp = Math.min(
        this.player.stats.maxHp,
        this.player.hp + (dmg * s.lifestealPct) / 100,
      )
    }

    // Hitstop on crits only — on chaff it reads as lag (§11).
    if (isCrit) this.hitstop = C.hitstopSecondsOnCrit

    if (e.hp <= 0) this.killEnemy(index)
  }

  private killEnemy(index: number): void {
    const e = this.enemies.items[index]
    this.kills++
    const def = ENEMIES[e.typeId]

    // Chili Shot T3 "burn spreads on death": a burning corpse lights its
    // neighbours. `burnGen` caps the chain — a spread fire cannot spread again,
    // or one lit enemy in a dense wave would set the whole field alight in a
    // few frames and the rider would be a screen clear rather than a rider.
    if (e.burnLife > 0 && e.burnGen === 0) {
      const chili = this.player.weapons.find(
        (s2) => typeof WEAPONS[s2.id]?.t3SpreadRadius === 'number',
      )
      if (chili && chili.tier >= 3) {
        const w = WEAPONS[chili.id]
        const radius = typeof w?.t3SpreadRadius === 'number' ? w.t3SpreadRadius : 90
        const mul = typeof w?.t3SpreadDamageMultiplier === 'number' ? w.t3SpreadDamageMultiplier : 0.6
        const n = this.grid.query(e.x, e.y, radius, this.queryOut)
        for (let k = 0; k < n; k++) {
          const j = this.queryOut[k]
          if (j >= this.enemies.live || j === index) continue
          const other = this.enemies.items[j]
          if (other.dying > 0) continue
          if (Math.hypot(other.x - e.x, other.y - e.y) > radius) continue
          this.applyBurn(other, e.burnDps * mul, e.burnLife, 1)
        }
        this.playFx('explosion', e.x, e.y, 0, radius / 90)
      }
    }

    // On-death specials from enemies.json.
    const special = def?.special as Record<string, unknown> | undefined
    if (special?.onDeath === 'acidPool') {
      const h = this.spawnHazard()
      if (h) {
        h.kind = 'acid'
        h.x = e.x
        h.y = e.y
        h.radius = (special.poolRadius as number) ?? 60
        h.growth = 0
        h.maxLife = (special.poolDuration as number) ?? 5
        h.life = h.maxLife
        h.dps = 0 // acid hurts you, not the things that spilled it
        h.playerDps = (special.poolDps as number) ?? 8
        h.slowPct = 0
        h.pullForce = 0
        h.tickAcc = 0
        this.sound('explosion')
        this.playFx('explosion', e.x, e.y, 0, 0.7)
      }
    } else if (special?.onDeath === 'gasBurst') {
      const h = this.spawnHazard()
      if (h) {
        h.kind = 'gas'
        h.x = e.x
        h.y = e.y
        h.radius = (special.cloudRadius as number) ?? 90
        h.growth = (special.cloudGrowth as number) ?? 30
        h.maxLife = (special.cloudDuration as number) ?? 6
        h.life = h.maxLife
        h.dps = 0
        h.playerDps = (special.cloudDps as number) ?? 10
        h.slowPct = 0
        h.pullForce = 0
        h.tickAcc = 0
        this.playFx('gas', e.x, e.y, 0, 1.4)
      }
    }

    // Drops.
    const xpCount = Math.max(1, Math.round(e.xp))
    for (let i = 0; i < xpCount; i++) {
      const g = this.pickups.acquire()
      if (!g) break
      g.kind = 'xp'
      g.x = e.x + this.rng.range(-8, 8)
      g.y = e.y + this.rng.range(-8, 8)
      g.px = g.x
      g.py = g.y
      g.value = 1
      g.magnetised = false
      g.speed = 0
      g.bob = this.rng.range(0, 6)
    }
    // Seed packs: a small steady feed trickle that is not tied to standing
    // still, so a player kited round the field all wave still earns something.
    if (this.rng.chance(NODES.mobDrops.seedPackChance)) {
      const sp = this.pickups.acquire()
      if (sp) {
        sp.kind = 'feed'
        sp.x = e.x + this.rng.range(-6, 6)
        sp.y = e.y + this.rng.range(-6, 6)
        sp.px = sp.x
        sp.py = sp.y
        sp.value = NODES.mobDrops.seedPackFeed
        sp.magnetised = false
        sp.speed = 0
        sp.bob = 0
      }
    }

    if (e.elite || this.rng.chance(0.04)) {
      const f = this.pickups.acquire()
      if (f) {
        f.kind = 'feed'
        f.x = e.x
        f.y = e.y
        f.px = f.x
        f.py = f.y
        f.value = e.elite ? 5 : 1
        f.magnetised = false
        f.speed = 0
        f.bob = 0
      }
    }

    this.sound(ENEMIES[e.typeId]?.boss === true ? 'bossDeath' : 'enemyDeath')
    this.bleed(e.x, e.y, e.typeId === 'rooster' ? 2 : 10)
    // No death frames needed — spin and scale to zero (§10 step 4).
    e.dying = C.deathSpinSeconds
    e.vx = 0
    e.vy = 0
  }

  /**
   * Damage the player.
   *
   * `source` is not bookkeeping — it changes the rules. A blow you take from an
   * enemy grants half a second of mercy invulnerability so a crowd cannot
   * chain-hit you to death in three frames. Environmental damage must not, in
   * either direction:
   *
   *  - It must not *grant* i-frames. Acid ticks eight times a second, and each
   *    tick handing out 0.5s of invulnerability turned standing in a pool into
   *    immunity from everything else on the field. The acid zombie's whole
   *    purpose became a panic button.
   *  - It must not *be blocked by* them, or a pool would deal roughly a quarter
   *    of the damage-per-second its JSON says it does, because most of its ticks
   *    would land inside the mercy window it had just granted itself.
   *
   * Environmental damage also skips the dodge roll: you cannot sidestep a cloud
   * you are standing inside, and rolling for it several times a second would
   * churn the sim's RNG for nothing.
   */
  damagePlayer(amount: number, source: 'contact' | 'hazard' = 'contact'): void {
    const p = this.player
    if (!p.alive) return
    const environmental = source === 'hazard'
    if (!environmental) {
      if (p.invuln > 0) return
      if (this.rng.chance(p.stats.dodge)) return
    }

    let dmg = amount * (1 - p.passiveDamageReduction)
    // Straw Hat: enemies close in deal less.
    if (this.specialItems.auraReduction > 0) {
      dmg *= 1 - this.specialItems.auraReduction / 100
    }
    dmg = dmg * (1 - p.stats.armor / (p.stats.armor + C.armorConstant))

    const taken = Math.max(environmental ? 0 : 1, dmg)
    p.hp -= taken
    if (!environmental) this.sound('playerHurt')
    if (environmental) this.damageTakenFromHazards += taken
    else {
      this.damageTakenFromContact += taken
      p.invuln = P.invulnSecondsAfterHit
    }
    this.addShake(T.camera.traumaPlayerHit)
  }

  areaDamage(
    x: number, y: number, radius: number, amount: number,
    type: 'melee' | 'ranged', knockback: number, stun = 0,
  ): void {
    const n = this.grid.query(x, y, radius, this.queryOut)
    for (let k = 0; k < n; k++) {
      const j = this.queryOut[k]
      if (j >= this.enemies.live) continue
      const e = this.enemies.items[j]
      if (e.dying > 0) continue
      const dx = e.x - x
      const dy = e.y - y
      if (dx * dx + dy * dy > radius * radius) continue
      const isCrit = this.rng.chance(this.player.stats.critChance)
      this.damageEnemy(j, amount, type, isCrit)
      if (e.active && !e.knockbackImmune && knockback > 0) {
        const d = Math.hypot(dx, dy) || 1
        e.kx += (dx / d) * knockback
        e.ky += (dy / d) * knockback
      }
      if (stun > 0 && e.active) e.stun = Math.max(e.stun, stun)
    }
  }

  /** Enemy cone attack against the player (Masked Sprayer). */
  coneAttack(
    x: number, y: number, angle: number, range: number,
    spreadDeg: number, damage: number, sourceIndex: number,
  ): void {
    void sourceIndex
    const p = this.player
    const dx = p.x - x
    const dy = p.y - y
    const d = Math.hypot(dx, dy)
    if (d > range) return
    let diff = Math.atan2(dy, dx) - angle
    while (diff > Math.PI) diff -= Math.PI * 2
    while (diff < -Math.PI) diff += Math.PI * 2
    if (Math.abs(diff) <= ((spreadDeg / 2) * Math.PI) / 180) {
      this.damagePlayer(damage * waveScalar(this.spawner.wave))
    }
  }

  addTelegraph(x: number, y: number, angle: number, range: number, spread: number, life: number): void {
    this.telegraphs.push({ x, y, angle, range, spread, life, maxLife: life })
  }

  queueBark(x: number, y: number): void {
    if (this.barkQueue.length < 4) this.barkQueue.push({ x, y })
  }

  addShake(trauma: number): void {
    this.shake = Math.min(1, this.shake + trauma)
  }

  addDamageNumber(x: number, y: number, value: number, crit: boolean): void {
    // Cap simultaneous numbers; past the cap the oldest is recycled rather
    // than the new hit going unshown (§11).
    let d = this.damageNumbers.acquire()
    if (!d) {
      this.damageNumbers.free(0)
      d = this.damageNumbers.acquire()
      if (!d) return
    }
    d.x = x + this.rng.range(-4, 4)
    d.y = y
    d.vy = -60
    d.maxLife = 0.5
    d.life = 0.5
    d.value = value
    d.crit = crit
  }

  private bleed(x: number, y: number, count: number): void {
    for (let i = 0; i < count; i++) {
      const p = this.particles.acquire()
      if (!p) return
      p.x = x
      p.y = y
      p.vx = this.rng.range(-70, 70)
      p.vy = this.rng.range(-110, -20)
      p.maxLife = this.rng.range(0.25, 0.45)
      p.life = p.maxLife
      p.colour = 0xa02c2c
      p.size = 2
      p.stains = true
    }
  }

  burstParticles(x: number, y: number, count: number, colour: number): void {
    for (let i = 0; i < count; i++) {
      const p = this.particles.acquire()
      if (!p) return
      p.x = x
      p.y = y
      p.vx = this.rng.range(-90, 90)
      p.vy = this.rng.range(-90, 30)
      p.maxLife = this.rng.range(0.15, 0.3)
      p.life = p.maxLife
      p.colour = colour
      p.size = 2
      p.stains = false
    }
  }

  /**
   * Play a conformed FX clip at a point.
   *
   * Pure decoration — nothing reads an effect back, so a full pool drops the
   * request instead of growing. Deliberately takes no RNG: an effect must never
   * be able to shift the sim's RNG stream, or turning effects off would change
   * where enemies spawn and a seed would stop replaying. Any jitter an effect
   * wants comes from the caller, out of the roll it was already making.
   */
  playFx(
    clip: keyof typeof T.fx & string,
    x: number,
    y: number,
    rotation = 0,
    scaleMul = 1,
    vx = 0,
    vy = 0,
    under = false,
  ): void {
    const def = T.fx[clip] as { life: number; scale: number } | undefined
    if (!def) return
    const e = this.effects.acquire()
    if (!e) return
    e.clip = clip
    e.x = x
    e.y = y
    e.vx = vx
    e.vy = vy
    e.maxLife = def.life
    e.life = def.life
    e.rotation = rotation
    e.scale = def.scale * scaleMul
    e.under = under
  }

  private magnetiseAll(): void {
    for (let i = 0; i < this.pickups.live; i++) {
      const g = this.pickups.items[i]
      g.magnetised = true
      if (g.speed < T.pickups.magnetInitialSpeed) g.speed = T.pickups.magnetInitialSpeed
    }
  }

  /** Recompute the cached special-item effects. Called when items change. */
  refreshSpecialItems(): void {
    this.specialItems.reflect = 0
    this.specialItems.auraRadius = 0
    this.specialItems.auraReduction = 0
    for (const owned of this.player.items) {
      const def = ITEMS[owned.id]
      if (!def?.special) continue
      const mult = owned.boosted ? 2 : 1
      if (def.special === 'reflect') {
        this.specialItems.reflect += ((def.reflectDamage as number) ?? 0) * mult
      } else if (def.special === 'auraDamageReduction') {
        this.specialItems.auraRadius = (def.radius as number) ?? 60
        this.specialItems.auraReduction += ((def.reductionPct as number) ?? 0) * mult
      }
    }
  }

  // ------------------------------------------------------------- queries

  findNearestEnemy(x: number, y: number, maxRange: number): number {
    let best = -1
    let bestD2 = maxRange * maxRange
    for (let i = 0; i < this.enemies.live; i++) {
      const e = this.enemies.items[i]
      if (e.dying > 0) continue
      const dx = e.x - x
      const dy = e.y - y
      const d2 = dx * dx + dy * dy
      if (d2 < bestD2) {
        bestD2 = d2
        best = i
      }
    }
    return best
  }

  /**
   * The furthest enemy in range, or the `rank`-th furthest.
   *
   * The rank is the fishing rod's T3 "drags three": it hooks the three furthest
   * rather than the same one three times. Selection-scanning `rank` times is
   * fine at rank <= 3 and avoids sorting the whole live set to pick from the
   * top of it.
   */
  findFurthestEnemyWithin(x: number, y: number, maxRange: number, rank = 0): number {
    const max2 = maxRange * maxRange
    let cutoff = Infinity
    let best = -1
    for (let r = 0; r <= rank; r++) {
      best = -1
      let bestD2 = -1
      for (let i = 0; i < this.enemies.live; i++) {
        const e = this.enemies.items[i]
        if (e.dying > 0) continue
        const dx = e.x - x
        const dy = e.y - y
        const d2 = dx * dx + dy * dy
        if (d2 <= max2 && d2 < cutoff && d2 > bestD2) {
          bestD2 = d2
          best = i
        }
      }
      if (best < 0) return -1
      cutoff = bestD2
    }
    return best
  }

  /** Find an existing attached projectile belonging to a weapon, by slot key. */
  findAttached(weaponId: string, key: number): Projectile | null {
    for (let i = 0; i < this.projectiles.live; i++) {
      const p = this.projectiles.items[i]
      if (p.weaponId === weaponId && p.t1 === key) return p
    }
    return null
  }
}
