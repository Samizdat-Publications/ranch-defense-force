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
  makeDamageNumber, makeEnemy, makeHazard, makeParticle, makePickup, makeProjectile,
  type DamageNumber, type Enemy, type Hazard, type Particle, type Pickup, type Projectile,
} from './entities'
import { Player } from './player'
import { Spawner } from './spawner'
import { resolveDamage, waveIncome, waveScalar } from './formulas'
import { ENEMIES, ITEMS, TUNING, WAVES, WEAPONS, type StatMods } from '../content'
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

  // Run stats for the results screen.
  kills = 0
  damageDealt = 0
  wavesCleared = 0

  events: WorldEvents = {}

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
    this.collideEnemiesWithPlayer(dt)
    this.updateHazards(dt)

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
        this.spawnEnemy(req.typeId, this.spawnPoint.x, this.spawnPoint.y, req.elite)
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
      this.events.onWaveComplete?.(wasWave, income)
      // Wave boundaries sweep up everything on the ground (§11).
      this.magnetiseAll()
      const next = wasWave + 1
      s.beginWave(next)
      const bossId = (WAVES.bossWaves as Record<string, string>)[String(next)]
      if (bossId) this.events.onBossWave?.(bossId)
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

      e.x += e.vx * scale * dt + e.kx * dt
      e.y += e.vy * scale * dt + e.ky * dt

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
    for (const slot of p.weapons) {
      const def = WEAPONS[slot.id]
      if (!def) continue
      // §7: each tier is base damage x1.6.
      const tierScale = Math.pow(1.6, slot.tier - 1)
      ctx.slot = slot
      ctx.def = def
      ctx.tier = slot.tier
      ctx.damage = def.base * tierScale

      const sustain = SUSTAIN[def.behaviour]
      if (sustain && def.cooldown === 0) {
        sustain(ctx)
        continue
      }

      slot.cooldownLeft -= dt * p.stats.attackSpeedMultiplier
      if (slot.cooldownLeft <= 0) {
        const fire = FIRE[def.behaviour]
        if (fire) fire(ctx)
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
        }
        this.projectiles.free(i)
        continue
      }
      if (p.attached) continue

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
        const speed = 210
        p.vx = (dx / d) * speed
        p.vy = (dy / d) * speed
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
            this.splitShards(p, p.t1)
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

  private splitShards(p: Projectile, count: number): void {
    for (let i = 0; i < count; i++) {
      const s = this.spawnProjectile()
      if (!s) return
      const a = (i / count) * Math.PI * 2
      s.weaponId = p.weaponId
      s.type = 'ranged'
      s.behaviour = 'stream'
      s.attached = false
      s.x = p.x
      s.y = p.y
      s.px = s.x
      s.py = s.y
      s.vx = Math.cos(a) * 280
      s.vy = Math.sin(a) * 280
      s.radius = 5
      s.damage = p.damage * 0.5
      s.life = 0.7
      s.pierce = 0
      s.knockback = 20
      s.hitStamp = -1
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

        // Attached hitboxes sweep across many ticks; stamping stops one swing
        // hitting the same enemy sixty times.
        if (p.attached && e.t1 === p.hitStamp && p.hitStamp !== 0) continue

        const dx = e.x - p.x
        const dy = e.y - p.y
        const want = e.radius + p.radius
        if (dx * dx + dy * dy > want * want) continue

        if (p.attached) e.t1 = p.hitStamp
        this.applyHit(j, p)
        if (!p.attached) {
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
    this.damageEnemy(enemyIndex, p.damage, type, isCrit)

    if (!e.active || e.dying > 0) return
    if (p.knockback > 0 && !e.knockbackImmune) {
      const dx = e.x - p.x
      const dy = e.y - p.y
      const d = Math.hypot(dx, dy) || 1
      e.kx += (dx / d) * p.knockback
      e.ky += (dy / d) * p.knockback
    }
    // Watering can carries its slow in t0.
    if (p.behaviour === 'rotatingJet' && p.t0 > 0) e.stun = Math.max(e.stun, 0)
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

  private updateHazards(dt: number): void {
    for (let i = this.hazards.live - 1; i >= 0; i--) {
      const h = this.hazards.items[i]
      h.life -= dt
      if (h.growth > 0) h.radius += h.growth * dt
      if (h.life <= 0) {
        this.hazards.free(i)
        continue
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
      this.player.feed += Math.round(g.value * (1 + this.player.stats.harvestPct / 100))
    } else {
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
      p.abilityActive = (a.duration as number) ?? 2.5
      p.rooted = true
    } else if (a.id === 'bolt') {
      const dist = (a.dashDistance as number) ?? 180
      p.invuln = (a.iFrames as number) ?? 0.35
      p.x = Math.max(0, Math.min(this.arenaW, p.x + Math.cos(p.facing) * dist))
      p.y = Math.max(0, Math.min(this.arenaH, p.y + Math.sin(p.facing) * dist))
      this.burstParticles(p.px, p.py, 10, 0xd9c9a3)
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
    return e
  }

  spawnProjectile(): Projectile | null {
    return this.projectiles.acquire()
  }

  spawnHazard(): Hazard | null {
    return this.hazards.acquire()
  }

  /**
   * The one place enemy damage is applied. Everything — weapons, hazards,
   * reflect, boss attacks — comes through here so the formula lives once.
   */
  damageEnemy(index: number, amount: number, type: 'melee' | 'ranged' | 'utility', isCrit: boolean): void {
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
    )

    e.hp -= dmg
    e.flash = C.hitFlashSeconds
    this.damageDealt += dmg
    this.addDamageNumber(e.x, e.y - e.radius, dmg, isCrit)
    this.bleed(e.x, e.y, isCrit ? 5 : 3)

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
        h.dps = 0 // hurts the player, not enemies; player damage in M5
        h.slowPct = 0
        h.pullForce = 0
        h.tickAcc = 0
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
        h.slowPct = 0
        h.pullForce = 0
        h.tickAcc = 0
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

    this.bleed(e.x, e.y, e.typeId === 'rooster' ? 2 : 10)
    // No death frames needed — spin and scale to zero (§10 step 4).
    e.dying = C.deathSpinSeconds
    e.vx = 0
    e.vy = 0
  }

  damagePlayer(amount: number): void {
    const p = this.player
    if (p.invuln > 0 || !p.alive) return
    if (this.rng.chance(p.stats.dodge)) return

    let dmg = amount * (1 - p.passiveDamageReduction)
    // Straw Hat: enemies close in deal less.
    if (this.specialItems.auraReduction > 0) {
      dmg *= 1 - this.specialItems.auraReduction / 100
    }
    dmg = dmg * (1 - p.stats.armor / (p.stats.armor + C.armorConstant))

    p.hp -= Math.max(1, dmg)
    p.invuln = P.invulnSecondsAfterHit
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
    for (const id of this.player.items) {
      const def = ITEMS[id]
      if (!def?.special) continue
      if (def.special === 'reflect') {
        this.specialItems.reflect += (def.reflectDamage as number) ?? 0
      } else if (def.special === 'auraDamageReduction') {
        this.specialItems.auraRadius = (def.radius as number) ?? 60
        this.specialItems.auraReduction += (def.reductionPct as number) ?? 0
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

  findFurthestEnemyWithin(x: number, y: number, maxRange: number): number {
    let best = -1
    let bestD2 = 0
    const max2 = maxRange * maxRange
    for (let i = 0; i < this.enemies.live; i++) {
      const e = this.enemies.items[i]
      if (e.dying > 0) continue
      const dx = e.x - x
      const dy = e.y - y
      const d2 = dx * dx + dy * dy
      if (d2 <= max2 && d2 > bestD2) {
        bestD2 = d2
        best = i
      }
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
