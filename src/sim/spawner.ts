/**
 * Spawn director (§8). Waves have a threat *budget*, not a spawn list: the
 * director picks affordable groups from the roster unlocked at the current wave
 * and spends the budget down across the wave's 40 seconds, weighted toward a
 * heavier final quarter.
 *
 * The pressure ceiling is the load-bearing part. Because waves never stop, a
 * player who falls behind would otherwise compound into an unwinnable screen by
 * wave 15 and the run would be decided long before it ended. Above 380 live
 * enemies the director simply withholds.
 */
import { ENEMIES, ENEMY_IDS, WAVES, type EnemyDef } from '../content'
import { threatBudget } from './formulas'
import type { Rng } from '../core/rng'

const spawnCfg = WAVES.spawn

export interface SpawnRequest {
  typeId: string
  count: number
  /**
   * Whether this wave can produce elites at all. The per-enemy roll happens in
   * the world, NOT here — see the note at the assignment below.
   */
  eliteEligible: boolean
}

export class Spawner {
  wave = 1
  waveTime = 0
  /** Threat left to spend this wave. */
  budget = 0
  private spent = 0
  /** Seconds until the next spawn attempt. */
  private nextIn = 0
  /** Reusable output; the world drains it each tick. Never reallocated. */
  readonly pending: SpawnRequest[] = []

  private readonly available: string[] = []
  private readonly weights: number[] = []

  constructor(private readonly rng: Rng) {
    this.beginWave(1)
  }

  beginWave(n: number): void {
    this.wave = n
    this.waveTime = 0
    this.budget = threatBudget(n)
    this.spent = 0
    this.nextIn = 0.4
  }

  /**
   * Advance the wave clock and queue spawns. `liveCount` gates on the pressure
   * ceiling; the caller applies whatever it drains from `pending`.
   */
  update(dt: number, liveCount: number): void {
    this.pending.length = 0
    this.waveTime += dt
    if (liveCount >= WAVES.pressureCeiling) return

    this.nextIn -= dt
    if (this.nextIn > 0) return

    const duration = WAVES.waveDuration
    const progress = Math.min(1, this.waveTime / duration)
    // Bias spend toward the last quarter so a wave builds rather than arriving
    // flat, without ever exceeding the budget.
    const bias = progress > 0.75 ? spawnCfg.finalQuarterBias : 1
    const targetSpend = this.budget * progress * bias
    if (this.spent >= Math.min(this.budget, targetSpend)) {
      this.nextIn = 0.3
      return
    }

    this.refreshRoster()
    if (this.available.length === 0) {
      this.nextIn = 0.5
      return
    }

    const idx = this.rng.weightedIndex(this.weights)
    const typeId = this.available[idx]
    const def = ENEMIES[typeId]
    const count = Math.max(1, def.groupSize)
    const cost = def.threatCost * count

    // Eligibility only. The chance roll used to live here, on the group — one
    // 10% success turned every member of a group of three to six into an elite
    // at once, which is a squad of 4x-health enemies arriving together rather
    // than the sprinkle §8 describes. "One in ten" is one in ten *enemies*, so
    // the world rolls it per spawn.
    const eliteEligible = this.wave % WAVES.eliteEveryNWaves === 0

    this.pending.push({ typeId, count, eliteEligible })
    this.spent += cost
    // Groups arrive on a rhythm that tightens as the wave escalates.
    this.nextIn = this.rng.range(0.5, 1.5) / bias
  }

  /** Everything unlocked at this wave, weighted so cheap chaff stays common. */
  private refreshRoster(): void {
    this.available.length = 0
    this.weights.length = 0
    for (const id of ENEMY_IDS) {
      const def: EnemyDef = ENEMIES[id]
      if (def.firstWave > this.wave) continue
      this.available.push(id)
      // Cheaper enemies appear more often; the 1/sqrt keeps heavies rare
      // without making them vanish once the budget grows.
      this.weights.push(1 / Math.sqrt(def.threatCost))
    }
  }

  /** True once the wave clock has run out. */
  get waveComplete(): boolean {
    return this.waveTime >= WAVES.waveDuration
  }

  get waveRemaining(): number {
    return Math.max(0, WAVES.waveDuration - this.waveTime)
  }

  /**
   * A spawn point on an arena edge, at least `minDistanceFromPlayer` away.
   * Falls back to the furthest of a few candidates rather than looping forever
   * when the player is cornered.
   */
  pickSpawnPoint(
    playerX: number,
    playerY: number,
    arenaW: number,
    arenaH: number,
    out: { x: number; y: number },
  ): void {
    const min = spawnCfg.minDistanceFromPlayer
    let bestX = 0
    let bestY = 0
    let bestDist = -1
    for (let attempt = 0; attempt < 8; attempt++) {
      const edge = this.rng.int(0, 3)
      let x = 0
      let y = 0
      if (edge === 0) {
        x = this.rng.range(0, arenaW)
        y = 8
      } else if (edge === 1) {
        x = this.rng.range(0, arenaW)
        y = arenaH - 8
      } else if (edge === 2) {
        x = 8
        y = this.rng.range(0, arenaH)
      } else {
        x = arenaW - 8
        y = this.rng.range(0, arenaH)
      }
      const d = Math.hypot(x - playerX, y - playerY)
      if (d >= min) {
        out.x = x
        out.y = y
        return
      }
      if (d > bestDist) {
        bestDist = d
        bestX = x
        bestY = y
      }
    }
    out.x = bestX
    out.y = bestY
  }
}
