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
import { Player, hasMod } from './player'
import { tierHpMultiplier } from './meta'
import { Spawner } from './spawner'
import { resolveDamage, waveIncome, waveScalar, waveHpScalar } from './formulas'
import {
  BREAKABLES, BREAKABLE_CLASSES, ELEMENTS, ENEMIES, FIELD_GEAR_POOL, ITEMS, MAPS,
  NODES, TUNING, WAVES, WEAPONS, carryMuzzleOffset, elementStat, pickMapId, swingStyleOf,
  type BreakableClass, type DropRow, type MapDef, type NodeVariant, type StatMods,
} from '../content'
import { FIRE, SUSTAIN, type FireContext } from '../behaviours/weapons'

/**
 * Scratch for `carryMuzzleOffset`. Module-level and reused, because the only
 * caller is on the path a gun takes when it fires and the hot loop allocates
 * nothing. Read on the line after it is written and never held.
 */
const MUZZLE = { x: 0, y: 0 }
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
  /** The magnet power-up started; the argument is how long it runs. */
  onMagnet?: (seconds: number) => void
  /** A gear card was picked up off the field, by item id. */
  onGear?: (itemId: string) => void
  /**
   * The player walked through the level exit. The argument is the map they
   * arrived on -- `descendTo` has already run by the time this fires, so the
   * presentation layer's job is to re-bake and say where they are, not to
   * decide anything.
   */
  onDescend?: (mapId: string, depth: number) => void
}

export class World {
  readonly rng: Rng
  /**
   * The stream that decides which SKIN a breakable wears, and nothing else.
   *
   * Separate from `rng` for the same reason the renderer's fog, overhead,
   * scenery and decal streams are separate from it: nothing decorative may
   * move a spawn. Seeded off the run's own seed so it still replays, XORed
   * with a constant of its own so it is not a copy of the main stream.
   */
  readonly skinRng: Rng
  readonly seed: number
  readonly player = new Player()
  readonly spawner: Spawner

  /**
   * Seconds left on the magnet power-up.
   *
   * Public so the HUD can show the window closing. A power-up whose only tell
   * is that pickups behave oddly is a power-up the player never learns they
   * have.
   */
  magnetSeconds = 0

  /**
   * How many enemies have been spawned this run, ever.
   *
   * Only used to cycle cosmetic sheet variants, so it deliberately never
   * resets and deliberately never touches the RNG.
   */
  private spawnSeq = 0

  /**
   * The map this run is being played on, and the arena it brings with it.
   *
   * Both are assigned in the constructor rather than initialised here, because
   * the map is chosen off the RNG and a field initialiser runs before the
   * constructor body — the arena has to exist before the spatial grid is sized
   * from it, and the map has to be picked before the arena exists.
   */
  /**
   * NOT readonly, because a run can descend. `descendTo` swaps both.
   *
   * The ARENA stays readonly, and that is the constraint that makes descending
   * cheap rather than a rewrite: the spatial grid, the camera and every canvas
   * the renderer bakes are sized from it once. Levels in one facility are rooms
   * in one building and can share a footprint, so a descent chain is required
   * to hold its arena constant and `descendTo` refuses a map that would change
   * it. `tests/maps.test.ts` asserts the chain rather than trusting the guard.
   */
  mapId: string
  map: MapDef
  readonly arenaW: number
  readonly arenaH: number

  /**
   * How many levels down. 0 on the surface, and the number the player is shown.
   *
   * A named layer is a set; LEVEL 7 is a meter -- where you are, how far you
   * came, and that there is a LEVEL 8. See docs/SUBTERRANEAN.md.
   */
  depth = 0

  /**
   * The way down, once it has opened. Null until this map's `exit.afterWave` is
   * cleared, and null again the moment it is used.
   *
   * Sim-side rather than render-side, unlike the scenery and the ceiling,
   * because unlike those it is a thing the player can REACH. Anything with a
   * proximity test belongs in the sim.
   */
  exit: { x: number; y: number; frame: string; radius: number } | null = null

  readonly enemies: Pool<Enemy>
  readonly projectiles: Pool<Projectile>
  readonly pickups: Pool<Pickup>
  readonly damageNumbers: Pool<DamageNumber>
  readonly particles: Pool<Particle>
  readonly hazards: Pool<Hazard>
  readonly props: Pool<Prop>
  /**
   * Destructible scenery, in a pool of its OWN.
   *
   * Same struct as a harvest node and a different population, deliberately.
   * The one rule that makes both mechanics work is that weapons break these and
   * never those, and tools work those and never these; two pools make that rule
   * something the type of the loop enforces rather than something every future
   * loop has to remember. Sharing `props` with a boolean would have put the
   * whole design one missing `if` away from the bug the harvest comment above
   * `updateProps` describes.
   */
  readonly breakables: Pool<Prop>
  readonly effects: Pool<Effect>

  private readonly grid: SpatialGrid
  private readonly gx: Float64Array
  private readonly gy: Float64Array
  private readonly queryOut: Int32Array
  /**
   * A SECOND grid-query scratch, for the one query that damages while it
   * iterates — The Drifter's Light Out. `damageEnemy` can reach `areaDamage`
   * through the Threshing Floor chain and the Reaper's re-swing, and both
   * overwrite `queryOut` mid-loop.
   */
  private readonly dashOut: Int32Array
  /** The telegraph ring drawn under a planted Claymore, so detonating can take
   *  it off the field instead of leaving a marker over a crater. */
  private mineMarker: Telegraph | null = null

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
  /** Bosses killed this run. Worth 25 acres each at the Homestead. */
  bossKills = 0
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
  /** Seconds until this map vents its next ambient hazard. Maps without a
   *  `hazards` block never touch it. */
  private ambientHazardIn = 0

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
  /**
   * Item specials, flattened once per build change rather than read per hit.
   *
   * Every field is a number or a flag the hot loop can branch on cheaply. The
   * alternative — walking `player.items` inside the collision pass — is a
   * per-enemy-per-frame allocation-free-but-still-O(n) scan for something that
   * only changes when a card is taken.
   */
  private specialItems = {
    reflect: 0,
    auraRadius: 0,
    auraReduction: 0,
    /** postDriver: multiplies every stun the player applies. */
    stunMultiplier: 1,
    /** secondCutting: the scythe's second blade, as a damage fraction. */
    scytheSecondBlade: 0,
    /** threshingFloor: a kill splashes to neighbours. */
    chainRadius: 0,
    chainDamageMultiplier: 0,
    /** cropDuster: a gas trail behind the player. */
    trailGasDps: 0,
    trailGasRadius: 0,
    /** cattleProd: touching you stuns, once per enemy per cooldown. */
    touchStunSeconds: 0,
    touchStunCooldown: 0,
    /** ironLung: gas does nothing at all. */
    gasImmune: false,
    /** reapersOwn: melee pierces everything and kills re-swing. */
    reswingDamageMultiplier: 0,
    /** saltCircle: a ring that hurts and slows what crosses it. */
    saltRingRadius: 0,
    saltRingDamage: 0,
    saltRingSlowPct: 0,
    /** sundayBest: feeds `shieldHp` below (H9, batch 3) — see that field's
     *  doc comment for the generalisation from a one-hit counter-attack to a
     *  numeric shield pool Fence Row also pays into. */

    // --- docs/UPGRADE_ROSTER.md batch 1 ----------------------------------
    // Every field below is flattened here for the same reason the block above
    // exists: a hot loop must branch on a number, not walk `player.items`.
    // `anyOnHitRider` is §8's "early-out on a single cached boolean", so a run
    // that owns none of these pays exactly one compare per hit.

    /** True when any of the on-hit riders below is live. */
    anyOnHitRider: false,
    /** H1 — chain. Fence Charge; Live Wire joins it in batch 2. */
    chainCount: 0,
    chainRange: 0,
    chainMul: 0,
    /** H2 — ricochet. Ricochet Plate. */
    ricochetCount: 0,
    ricochetRange: 0,
    ricochetMul: 0,
    /** H3 — split on kill. Split Shot. */
    splitCount: 0,
    splitMul: 0,
    /** H4 — homing. Burr Load; Match Barrel joins it in batch 2. */
    homingRate: 0,
    /** H5 — burst. Moonshine Jug on a hit, Last Rites on a marked kill. */
    burstChance: 0,
    burstRadius: 0,
    burstMul: 0,
    markedBurstPct: 0,
    markedBurstRadius: 0,
    /** H6 — hazards. The Kerosene Load leaves one where a hit lands... */
    hitHazardKind: '' as HazardKind | '',
    hitHazardRadius: 0,
    hitHazardSeconds: 0,
    hitHazardDps: 0,
    /** ...the Tar Load where a kill lands... */
    loadKillHazardKind: '' as HazardKind | '',
    loadKillHazardRadius: 0,
    loadKillHazardSeconds: 0,
    loadKillHazardSlowPct: 0,
    /** ...and Rot Underfoot on a fraction of kills. */
    killPoolChance: 0,
    killPoolKind: '' as HazardKind | '',
    killPoolRadius: 0,
    killPoolSeconds: 0,
    killPoolDps: 0,
    /** H11 — what a kill pays out. Feed the Birds, Blood Meal, Font Water,
     *  Broody Hen. */
    killDropChance: 0,
    killDropValue: 0,
    killHeal: 0,
    killSpawnEvery: 0,
    killSpawnDamage: 0,
    killSpawnSeconds: 0,
    killSpawnMax: 0,
    killSpawnSprite: '',
    /** No hook at all — fields the sim already read (§8's list of 19). */
    extraPierce: 0,
    projectileRadiusPct: 0,
    critMarkPct: 0,
    critMarkSeconds: 0,
    /** Second Pass / Deep Soak, summed into the same additive term the
     *  Agronomist's Cultivar already uses. Nothing multiplies. */
    loadDamagePct: 0,
    loadBonusSeconds: 0,
    /** Hot As It Comes: every slick on the field, whoever laid it. */
    slickDamagePct: 0,
    /** Cross-Contamination: two statuses or more is worse than either. */
    crossMarkPct: 0,

    // --- docs/UPGRADE_ROSTER.md batch 3 -----------------------------------
    // Allies & Placeables (H8), the shield/revive layer (H9/H10), and the
    // three Body cards that need no new hook at all.

    /** H8 — Scarecrow Post. One flat per-turret payload; `turretCount` (below)
     *  is how many turrets `updateTurrets` maintains, not a damage multiplier —
     *  the same "count grows, magnitude does not" shape `killSpawnMax` uses. */
    turretDamage: 0,
    turretCooldown: 0,
    turretRange: 0,
    turretLife: 0,
    turretCount: 0,
    /** H8 — Bear Trap. `trapMax` is live traps, not copies of the card. */
    trapDamage: 0,
    trapStunSeconds: 0,
    trapSpawnSeconds: 0,
    trapMax: 0,
    /** H8 — Hen Coop. `coopCount` is how many coops `updateCoop` maintains. */
    henDamage: 0,
    henCooldown: 0,
    coopCount: 0,
    /** H8 — Trip Wire. Damage sums per stack; range and stun are set, not
     *  summed, for the same reason a radius or a duration never is. */
    wireDamage: 0,
    wireStunSeconds: 0,
    wireMaxRange: 0,
    /** Yard Goose: a second, independent chase-and-bite minion. */
    gooseDamage: 0,
    gooseKnockback: 0,
    gooseCooldown: 0,
    hasGoose: false,
    /** Littermate: a second Barn Dog at reduced damage. Read by
     *  `minionHunt` in `behaviours/weapons.ts` beside its own `hasMod` checks. */
    hasLittermate: false,
    littermateDamagePct: 0,
    /** H9 — the shield. Generalises `firstHitShield` (Sunday Best), which now
     *  feeds the same pool Fence Row does rather than special-casing a single
     *  counter-attacked hit. Capacity only; the live amount is `playerShield`,
     *  a World field below that (like `shieldReady` before it) is deliberately
     *  NOT reset here — see `refreshSpecialItems`'s closing top-up. */
    shieldHp: 0,
    /** H10 — Second Wind. `revives` is the capacity `player.revivesLeft` is
     *  topped up toward; see the field's own doc comment on `Player`. */
    revives: 0,
    reviveHpPct: 0,
    reviveClearRadius: 0,
    /** Hobnails: anything that touches the player is slowed. */
    touchSlowPct: 0,
    touchSlowSeconds: 0,
    /** Oilcloth: hazards do less to the player, capped at 80% in the switch
     *  below so four stacks cannot zero hazard damage out entirely. */
    hazardReductionPct: 0,
    /** Windbreak: player-applied knockback is stronger, and a hard-thrown
     *  enemy that collides with a neighbour hurts both. */
    knockbackBonusPct: 0,
    collideDamage: 0,

    // --- docs/UPGRADE_ROSTER.md batch 5 -----------------------------------
    /** Ledger Book: `interestOn`'s cap and rate, read by `ShopScreen.open`
     *  through the `interestFor` getter below rather than the pure formula —
     *  an owned item is per-run state, not a content constant. */
    interestCapBonus: 0,
    interestPctBonus: 0,
    /** Early Bird: every feed pickup, whatever kind, is worth this much more.
     *  Applied once at the single collection site rather than at every
     *  spawn site, the same way `harvestPct` already is. */
    feedBonusFlat: 0,
  }

  /** Broody Hen's kill counter. Every Nth kill hatches one. */
  private hatchAcc = 0

  /**
   * H9 (docs/UPGRADE_ROSTER.md batch 3): the shield's CURRENT amount.
   *
   * `specialItems.shieldHp` above is the CAPACITY; this is what is actually
   * left to absorb. Deliberately not reset in `refreshSpecialItems` — like
   * `shieldReady` before it, it persists across a build change and is only
   * topped back up there and on wave complete, never zeroed by owning a new
   * item. Read by `tests/specials.test.ts` through the getter below.
   */
  private playerShield = 0
  get shield(): number { return this.playerShield }
  /**
   * Ledger Book (batch 5): interest on the feed a shop visit opens with,
   * `formulas.ts`'s `interestOn` plus this run's `interestCapBonus`/
   * `interestPctBonus`. A per-run item is per-run state, not a content
   * constant, so `ShopScreen.open` reads it through here rather than calling
   * the pure formula directly the way it did before this card existed.
   */
  interestFor(feed: number): number {
    const s = this.specialItems
    return Math.min(
      WAVES.economy.interestCap + s.interestCapBonus,
      Math.floor((feed * (WAVES.economy.interestPct + s.interestPctBonus)) / 100),
    )
  }
  /** Windbreak (batch 3, body): the multiplier every PLAYER-applied knockback
   *  goes through. 1 for a run that does not own it, so every existing
   *  `e.kx += (dx/d) * knockback` call site multiplies by exactly the number
   *  it always did. */
  private get knockbackMul(): number { return 1 + this.specialItems.knockbackBonusPct / 100 }
  /** Blood Up (Barn Dog epic): kills THIS wave, capped by `bloodUpMaxPct`
   *  divided by `bloodUpPerKillPct`, reset at every wave boundary below. */
  private bloodUpKillsThisWave = 0
  /** Public read of the above — `minionHunt` (a different module) reads it
   *  the same way `orbit` already reads `scytheSecondBlade`. */
  get bloodUpKills(): number { return this.bloodUpKillsThisWave }
  /** Littermate (docs/UPGRADE_ROSTER.md batch 3): read by `minionHunt` in
   *  `behaviours/weapons.ts`, the same module and the same reason as
   *  `bloodUpKills` above — a per-tick weapon behaviour reads world state
   *  through a getter rather than reaching into `specialItems` directly. */
  get hasLittermate(): boolean { return this.specialItems.hasLittermate }
  get littermateDamagePct(): number { return this.specialItems.littermateDamagePct }
  /** Seconds until the gas trail drops its next puddle. */
  private trailAcc = 0
  /** Guard so a chained kill cannot chain again. */
  private chaining = false

  // --- docs/UPGRADE_ROSTER.md batch 3, H8 — per-stack placeable timers ----
  // One cooldown per STACK SLOT, not per card: `updateTurrets` etc. index
  // into these by the stack's position (0..maxStacks-1), exactly the way
  // `updateBull`/`findAttached` already key a persistent minion by weapon id
  // and `hatchChick` counts live chicks before hatching another. Sized to
  // each card's own `maxStacks` — Scarecrow Post's 3, Hen Coop's 2.
  private turretCd = new Float64Array(3)
  private coopCd = new Float64Array(2)
  private trapCd = 0

  /**
   * @param tier County Fair difficulty tier, 1-based. Scales enemy HP and the
   *             acre payout; see `meta.ts`. Defaults to 1 so every existing
   *             caller — tests, tools, the headless painter — is unaffected.
   */
  constructor(
    seed: number, classId: string, metaMods: StatMods = {}, readonly tier = 1,
    forceMapId?: string,
  ) {
    this.seed = seed
    this.rng = new Rng(seed)
    this.skinRng = new Rng(seed ^ 0x5b1_5a17)

    // THE FIRST DRAW OFF THE RUN'S RNG. Exactly one `next()`, before anything
    // else touches the stream — see the `_rngNote` in maps.json. Moving this
    // later does not just change which map you get, it reseats every draw after
    // it, and every recorded seed replays as a different run.
    //
    // `forceMapId` overrides the RESULT and never the DRAW. The `next()` above
    // is spent either way, so a forced run and a rolled one from the same seed
    // sit at the identical stream position and everything after them matches.
    // This is what makes a weight-0 map reachable at all: `pickMapId` can never
    // return one, so a preview map, and the level system that will place a run
    // on a chosen floor rather than a rolled one, both need this door.
    const rolled = pickMapId(this.rng.next())
    this.mapId = forceMapId && MAPS[forceMapId] ? forceMapId : rolled
    this.map = MAPS[this.mapId]
    this.arenaW = this.map.arena.width
    this.arenaH = this.map.arena.height

    this.spawner = new Spawner(this.rng, this.map)

    this.enemies = new Pool(T.pools.enemies, makeEnemy)
    this.projectiles = new Pool(T.pools.projectiles, makeProjectile)
    this.pickups = new Pool(T.pools.pickups, makePickup)
    this.damageNumbers = new Pool(T.pools.damageNumbers, makeDamageNumber)
    this.particles = new Pool(T.pools.particles, makeParticle)
    this.hazards = new Pool(T.pools.hazards, makeHazard)
    this.props = new Pool(T.pools.props, makeProp)
    this.breakables = new Pool(T.pools.breakables, makeProp)
    this.effects = new Pool(T.pools.effects, makeEffect)

    this.grid = new SpatialGrid(this.arenaW, this.arenaH, T.pools.enemies)
    this.gx = new Float64Array(T.pools.enemies)
    this.gy = new Float64Array(T.pools.enemies)
    this.queryOut = new Int32Array(512)
    this.dashOut = new Int32Array(512)

    this.player.init(classId, metaMods)
    this.player.x = this.arenaW / 2
    this.player.y = this.arenaH / 2
    this.player.px = this.player.x
    this.player.py = this.player.y
    this.refreshSpecialItems()
    this.scatterField()
    this.scatterBreakables(BREAKABLES.field.initial)
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
  /**
   * This map's draw weight for a node variant.
   *
   * Biome variants (salt rock, scrap heap, bone heap, ash stump) are declared
   * in nodes.json at weight 0 and raised here by whichever map wants them, so
   * the numbers stay in one file and a map that says nothing gets exactly the
   * field the game always had.
   */
  /**
   * How far in from the arena rectangle anything standing on the ground must
   * stay: the wall band, or 0 on every map whose edge is a fence.
   *
   * Added to each scatterer's own pad rather than replacing it, and it does NOT
   * change the RNG stream -- `rng.range(lo, hi)` costs exactly one draw whatever
   * the bounds are, so a surface map (inset 0) draws the identical numbers it
   * always did and its seeded replays are untouched.
   */
  private get edgeInset(): number {
    return this.map.boundary?.inset ?? 0
  }

  private variantWeight(v: NodeVariant): number {
    return this.map.nodes.variantWeights?.[v.sprite] ?? v.weight
  }

  private scatterNodes(kind: string, count: number): void {
    const def = NODES.kinds[kind]
    if (!def) return
    const field = NODES.field
    const cap = this.map.nodes.max[kind] ?? field.max[kind] ?? 0
    // Held off the wall band as well as the arena edge: a tree growing out of
    // a concrete wall is the same class of mistake as a plough on a bunker floor.
    const pad = 80 + this.edgeInset

    let live = 0
    for (let i = 0; i < this.props.live; i++) if (this.props.items[i].kind === kind) live++

    let totalWeight = 0
    for (const v of def.variants) totalWeight += this.variantWeight(v)
    if (totalWeight <= 0) return

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

      // Skip weight-0 variants rather than relying on the running total to
      // step past them, and seed the fallback with the FIRST variant rather
      // than the last.
      //
      // Biome variants sit at weight 0 in nodes.json until a map asks, and they
      // are at the END of the array, so the previous `variants[length - 1]`
      // fallback pointed straight at one. This is defensive, not a bug fix:
      // `roll` is `next() * totalWeight` and `next()` is [0, 1), so with the
      // integer weights every map uses today the loop always breaks on the last
      // weighted entry and the fallback cannot fire. It is deliberately NOT
      // covered by a test — the two versions only diverge when float error
      // across the subtractions exceeds the gap to `totalWeight`, which needs
      // `next()` to land in the last ~1e-16 of its range, and a test that
      // sampled for that would pass under both. Kept because maps.json is a
      // content file and `"weight": 2.5` is one edit away from making the
      // arithmetic argument stop holding.
      let roll = this.rng.next() * totalWeight
      let variant = def.variants[0]
      for (const v of def.variants) {
        const w = this.variantWeight(v)
        if (w <= 0) continue
        variant = v
        roll -= w
        if (roll <= 0) break
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

  /**
   * Scatter destructible scenery through the playable interior.
   *
   * Deliberately not the peripheral band the renderer decorates: that band is
   * outside where a fight happens, and a breakable nobody can reach pays out
   * nothing. The renderer keeps the fixtures -- scarecrow, plough, fence,
   * grave marker -- out there as wallpaper, and the containers live in here
   * where a stray shot finds them.
   */
  /**
   * Unseal the way down, once this level's wave has been cleared.
   *
   * ON THE WALL, and specifically on the TOP edge, which is the one the camera
   * looks at the inner face of. A door in the middle of a field is a prop; a
   * door in a wall is an exit, and that is the second reason the wall band
   * exists at all. The horizontal position is drawn from the run's RNG so two
   * runs of the same level do not put it in the same place -- but it is drawn
   * ONCE, here, and only on a map that declares an exit, so no surface map
   * spends a draw and no recorded seed moves.
   */
  private openExitIfDue(clearedWave: number): void {
    const cfg = this.map.exit
    if (!cfg || this.exit || clearedWave < cfg.afterWave) return
    const band = this.map.boundary?.band ?? 0
    // Kept clear of the corners, where a door would read as a mistake.
    const x = this.rng.range(band + 120, this.arenaW - band - 120)
    this.exit = { x, y: band, frame: cfg.sprite, radius: cfg.radius }
    this.sound('waveStart')
  }

  /**
   * Walk through it.
   *
   * Checked after the player has moved and before anything else looks at the
   * field, so arriving on the next level is not preceded by a frame of being
   * hit by enemies that no longer exist.
   */
  private checkExit(): void {
    const e = this.exit
    if (!e) return
    const dx = this.player.x - e.x
    const dy = this.player.y - e.y
    if (dx * dx + dy * dy > e.radius * e.radius) return
    const next = this.map.exit?.nextMap
    if (!next || !MAPS[next]) return
    this.descendTo(next)
    this.events.onDescend?.(this.mapId, this.depth)
  }

  /**
   * Go down a level: the same run, in a new room.
   *
   * NOT a new World. A descent must keep the player's build, level, weapons and
   * wave -- that is the whole point of going deeper rather than starting again
   * -- and every one of those lives on this object. Rebuilding would mean
   * copying them across one by one, which is a list that silently grows every
   * time the player gains a field.
   *
   * **The arena cannot change**, and that is what makes this cheap instead of a
   * rewrite: the spatial grid, the camera and every canvas the renderer bakes
   * are sized from it once, at construction. Levels of one facility are rooms
   * in one building, so sharing a footprint costs the design nothing. A map
   * that would change it is refused here and the run simply stays put -- a
   * level that will not load must not also break the one you are standing in.
   */
  descendTo(mapId: string): boolean {
    const next = MAPS[mapId]
    if (!next) return false
    if (next.arena.width !== this.arenaW || next.arena.height !== this.arenaH) return false

    this.mapId = mapId
    this.map = next
    this.depth++
    this.exit = null

    // Everything standing in the old room stays there. `clear` returns the
    // whole pool at once rather than freeing one index at a time, which is both
    // faster and the only version that cannot leave a half-emptied pool behind
    // if it is ever changed.
    this.enemies.clear()
    this.projectiles.clear()
    this.pickups.clear()
    this.hazards.clear()
    this.props.clear()
    this.breakables.clear()
    this.particles.clear()
    this.damageNumbers.clear()
    this.effects.clear()

    this.spawner.map = next

    // Arriving in the middle of the new room, not wherever the door was.
    this.player.x = this.arenaW / 2
    this.player.y = this.arenaH / 2
    this.player.px = this.player.x
    this.player.py = this.player.y

    this.scatterField()
    this.scatterBreakables(BREAKABLES.field.initial)
    return true
  }

  private scatterBreakables(count: number): void {
    const f = BREAKABLES.field
    if (this.breakables.live >= f.max) return

    // This map's say over which classes stand on it and what they wear.
    const over = this.map.breakables
    const weightOf = (id: string, c: BreakableClass): number =>
      over?.weights?.[id] ?? c.weight

    let totalWeight = 0
    for (const [id, c] of BREAKABLE_CLASSES) totalWeight += weightOf(id, c)
    if (totalWeight <= 0) return

    for (let i = 0; i < count; i++) {
      if (this.breakables.live >= f.max) return

      let x = 0
      let y = 0
      for (let attempt = 0; attempt < 8; attempt++) {
        const pad = f.edgePad + this.edgeInset
        x = this.rng.range(pad, this.arenaW - pad)
        y = this.rng.range(pad, this.arenaH - pad)
        if (Math.hypot(x - this.player.x, y - this.player.y) >= f.minDistanceFromPlayer) break
      }

      let roll = this.rng.next() * totalWeight
      let cls: BreakableClass = BREAKABLE_CLASSES[0][1]
      let clsId = BREAKABLE_CLASSES[0][0]
      for (const [id, c] of BREAKABLE_CLASSES) {
        const w = weightOf(id, c)
        if (w <= 0) continue
        cls = c
        clsId = id
        roll -= w
        if (roll <= 0) break
      }

      /*
         Which skin this one wears, OFF A STREAM OF ITS OWN.

         A second draw, deliberately, rather than deriving the variant from the
         position the way the prop animation phase does. Position-derived would
         be free, but two breakables that happen to land on the same parity
         would always agree, and the whole reason a class carries sixteen skins
         is that a field of forty should not show the same barrel twice in a
         row.

         `skinRng`, not `this.rng`, and that is the correction the 2026-09-03
         audit forced. Which PNG a barrel wears is decorative, and the rule this
         repo states everywhere else -- the fog, the overhead layer, the scenery
         band and the decals all run their own seeded streams -- is that nothing
         decorative may move a spawn. This draw was in the sim stream, and it
         was invisible only because every class happened to carry exactly ONE
         skin, so the branch never fired. Giving `trough` and `hayBaleRot` a
         second skin fired it, shifted every downstream draw in the game, and
         turned the 24-seed clear-rate acceptance test red at 10 of 24 -- from
         a change that cannot make anything harder. Off its own stream the sim
         is bit-identical to before, and adding a skin stays free forever.

         The map's list wins over the class's, so a map can run the scorched
         drums while another runs the painted ones off one class.
      */
      const skins = over?.sprites?.[clsId] ?? cls.sprites
      const sprite = skins.length > 1
        ? skins[this.skinRng.int(0, skins.length - 1)]
        : skins[0]

      const b = this.breakables.acquire()
      if (!b) return
      b.kind = 'breakable'
      b.sprite = sprite
      b.x = x
      b.y = y
      b.maxHp = cls.hp
      b.hp = cls.hp
      b.radius = cls.radius
      b.feed = 0
      b.xp = 0
      b.flash = 0
      b.dying = 0
      b.working = 0
      b.dwell = 0
      b.drops = cls.drops
    }
  }

  /**
   * Projectiles against breakables.
   *
   * A direct scan, not the spatial grid: the grid indexes enemies, and there
   * are tens of these against hundreds of those. It also runs only for
   * projectiles that are already alive this tick, so the cost is bounded by the
   * projectile pool rather than by the arena.
   *
   * **Pierce is never spent here.** See breakables.json `_pierceNote` -- a
   * bullet that a crate eats is damage the crowd did not take, and scenery that
   * taxes your DPS is scenery a player learns to resent.
   */
  private collideProjectilesWithBreakables(): void {
    if (this.breakables.live === 0) return
    for (let i = this.projectiles.live - 1; i >= 0; i--) {
      const p = this.projectiles.items[i]
      if (p.pierce === -1) continue
      if (p.behaviour === 'tracer') continue
      for (let j = this.breakables.live - 1; j >= 0; j--) {
        const b = this.breakables.items[j]
        if (b.dying > 0) continue
        const dx = b.x - p.x
        const dy = b.y - p.y
        const want = b.radius + p.radius
        if (dx * dx + dy * dy > want * want) continue
        b.hp -= p.damage
        b.flash = C.hitFlashSeconds
        if (b.hp <= 0) this.breakOpen(j)
        break
      }
    }
  }

  /** Timers only -- the flash and the break animation. */
  private updateBreakables(dt: number): void {
    for (let i = this.breakables.live - 1; i >= 0; i--) {
      const b = this.breakables.items[i]
      if (b.flash > 0) b.flash -= dt
      if (b.dying > 0) {
        b.dying -= dt
        if (b.dying <= 0) this.breakables.free(i)
      }
    }
  }

  /**
   * Roll a breakable's drop table and pay it out.
   *
   * One RNG draw for the row, and a second only if the row carries a range.
   * Rolling the value unconditionally would cost a draw on every `nothing`,
   * which is most of them, and would shift every downstream draw in the run for
   * no visible effect.
   */
  private breakOpen(index: number): void {
    const b = this.breakables.items[index]
    b.dying = C.deathSpinSeconds
    this.sound('nodeBreak')
    this.burstParticles(b.x, b.y, 12, 0xc9a97a)

    const table: DropRow[] | undefined = BREAKABLES.dropTables[b.drops]
    if (!table) return
    let total = 0
    for (const r of table) total += r.weight
    if (total <= 0) return

    let roll = this.rng.next() * total
    let row: DropRow = table[0]
    for (const r of table) {
      if (r.weight <= 0) continue
      row = r
      roll -= r.weight
      if (roll <= 0) break
    }
    if (row.kind === 'nothing') return

    if (row.kind === 'gear') { this.dropGear(b.x, b.y); return }

    const value = row.min !== undefined && row.max !== undefined
      ? Math.round(this.rng.range(row.min, row.max))
      : 1
    const g = this.pickups.acquire()
    if (!g) return
    g.kind = row.kind
    g.x = b.x
    g.y = b.y
    g.px = g.x
    g.py = g.y
    g.value = value
    g.magnetised = false
    g.speed = 0
    g.bob = 0
    g.itemId = ''
  }

  /**
   * Drop one item card on the ground.
   *
   * Eligibility is checked HERE rather than at collection: an item the player
   * cannot take (already at `maxStacks`) must never become a pickup, because a
   * reward that does nothing when you walk over it reads as a bug. If nothing
   * is eligible -- a late run holding every stack -- the drop degrades to feed
   * rather than to nothing, since the roll already promised something.
   */
  private dropGear(x: number, y: number): void {
    let count = 0
    for (const id of FIELD_GEAR_POOL) if (this.player.canTakeItem(id)) count++

    const g = this.pickups.acquire()
    if (!g) return
    g.x = x
    g.y = y
    g.px = x
    g.py = y
    g.magnetised = false
    g.speed = 0
    g.bob = 0

    if (count === 0) {
      g.kind = 'feed'
      g.value = 6
      g.itemId = ''
      return
    }

    let pick = this.rng.int(0, count - 1)
    let chosen = ''
    for (const id of FIELD_GEAR_POOL) {
      if (!this.player.canTakeItem(id)) continue
      if (pick === 0) { chosen = id; break }
      pick--
    }
    g.kind = 'gear'
    g.value = 0
    g.itemId = chosen
  }

  /** Lay out the whole field at the start of a run. */
  private scatterField(): void {
    for (const [kind, n] of Object.entries(this.map.nodes.initial)) this.scatterNodes(kind, n)
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
    this.player.move(
      moveX, moveY, dt, this.arenaW, this.arenaH, this.playerHazardSlow(),
      // The wall band, if this map has one. Zero on every surface map, which is
      // what keeps their replays byte-identical.
      this.map.boundary?.inset ?? 0,
    )
    this.checkExit()
    this.player.updatePassive(dt)
    this.player.regen(dt)
    if (abilityPressed) this.tryAbility()
    this.updateAbility(dt)

    this.updatePlayerSpecials(dt)
    this.updateBull(dt)
    // docs/UPGRADE_ROSTER.md batch 3, H8 — every early-out on its own count
    // field, so a run owning none of these pays five cheap compares.
    if (this.specialItems.turretCount > 0) this.updateTurrets(dt)
    if (this.specialItems.trapMax > 0) this.updateBearTraps(dt)
    if (this.specialItems.coopCount > 0) this.updateCoop(dt)
    if (this.specialItems.wireDamage > 0) this.updateTripWire()
    if (this.specialItems.hasGoose) this.updateGoose(dt)

    // 3. spawner — the wave director, then the map's own. Ambient hazards are
    // spawning, so they belong in this step rather than with the vfx at 11:
    // they damage, they block ground, and an enemy steering next tick has to
    // see one that appeared this tick.
    this.updateSpawner(dt)
    this.updateAmbientHazards(dt)

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
    this.collideProjectilesWithBreakables()
    this.updateProps(dt)
    this.updateBreakables(dt)
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
      // H9: the shield refills to full capacity every wave. "Start each wave
      // with a shield" is Fence Row's own words, and Sunday Best's capacity
      // now lives in the same pool.
      if (this.specialItems.shieldHp > 0) this.playerShield = this.specialItems.shieldHp
      this.bloodUpKillsThisWave = 0
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
      for (const [kind, n] of Object.entries(this.map.nodes.regrowPerWave)) this.scatterNodes(kind, n)
      this.scatterBreakables(BREAKABLES.field.regrowPerWave)
      this.openExitIfDue(wasWave)
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
      if (e.flashLock > 0) e.flashLock -= dt
      if (e.touchCd > 0) e.touchCd -= dt
      if (e.collideCd > 0) e.collideCd -= dt
      /*
         Advance the attack pose, and end it.

         One place, so a behaviour only ever has to say "attack starts now" and
         never has to know the clip length. It runs ONCE and stops rather than
         looping: an enemy stuck in a repeating lunge reads as broken, and the
         walk is the right thing to fall back to.
      */
      if (e.attackT > 0) {
        e.attackT += dt
        if (e.attackT >= C.attackClipSeconds) e.attackT = 0
      }
      // The recoil counts DOWN, unlike the attack, because the renderer wants
      // "how much is left" to drive a clip that plays once and stops.
      if (e.hitT > 0) e.hitT -= dt

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
          // Spoiled Feed: whatever this lure is pulling takes more from
          // everything. 0 for every lure but the Bait Drum's own with the
          // card taken.
          if (hz.markPct > 0) this.applyMark(e, hz.markPct, hz.markSeconds)
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
    // Windbreak (batch 3, body): "an enemy thrown into another does 12 to
    // both". Read once, outside the per-enemy loop, so a run that does not
    // own the card pays a single compare rather than one per enemy.
    const collideDamage = this.specialItems.collideDamage
    for (let i = this.enemies.live - 1; i >= 0; i--) {
      const e = this.enemies.items[i]
      if (e.dying > 0) continue
      const def = ENEMIES[e.typeId]
      if (def?.separation === false) continue

      const n = this.grid.query(e.x, e.y, e.radius * 2, this.queryOut)
      let pushX = 0
      let pushY = 0
      // A hard knockback velocity, not merely "overlapping" — an ordinary
      // crowd standing shoulder to shoulder must not deal this every tick.
      const thrown = collideDamage > 0 && e.collideCd <= 0
        && e.kx * e.kx + e.ky * e.ky > C.windbreakThrownSpeed * C.windbreakThrownSpeed
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
        if (thrown && o.dying <= 0 && o.collideCd <= 0) {
          this.damageEnemy(i, collideDamage, 'melee', false)
          this.damageEnemy(j, collideDamage, 'melee', false)
          e.collideCd = C.windbreakCollideCooldown
          o.collideCd = C.windbreakCollideCooldown
        }
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
    // Every weapon aims at whatever the loadout would shoot. Resolved once per
    // tick for the whole loadout rather than per weapon: they all target the
    // nearest enemy, and twelve separate nearest-enemy scans a tick would be
    // twelve scans to reach the same answer.
    const aimTarget = this.findNearestEnemy(p.x, p.y, 900)
    // Breakables are a FALLBACK target and never a competing one: the scan for
    // one runs only after the enemy scan comes back empty. Letting them into
    // the normal target set would have the guns turn away from a live wave to
    // shoot a barrel, which is the weapons-damage-nodes bug in a new hat. As a
    // fallback it costs the player nothing and fills exactly the dead seconds
    // the harvest ramp was built for -- between waves, and the opening run-up.
    const breakTarget = aimTarget >= 0 ? -1 : this.findNearestBreakable(p.x, p.y, 900)
    let loadoutAim = p.facing
    if (aimTarget >= 0) {
      const e = this.enemies.items[aimTarget]
      loadoutAim = Math.atan2(e.y - p.y, e.x - p.x)
    } else if (breakTarget >= 0) {
      const b = this.breakables.items[breakTarget]
      loadoutAim = Math.atan2(b.y - p.y, b.x - p.x)
    }

    for (const slot of p.weapons) {
      const def = WEAPONS[slot.id]
      if (!def) continue
      // §7: each tier is base damage x1.6. The multiplier is `tuning.merge`
      // now rather than a literal, because the merge CARD has to print the
      // before → after it produces and two copies of a balance constant are
      // two copies of a balance constant even when they agree today.
      const tierScale = Math.pow(T.merge.tierDamageMultiplier, slot.tier - 1)
      ctx.slot = slot
      ctx.def = def
      ctx.tier = slot.tier
      ctx.damage = def.base * tierScale

      if (slot.recoil > 0) slot.recoil -= dt
      // Melee swings where you face; everything else points at the target.
      slot.aimAngle = def.type === 'melee' ? p.facing : loadoutAim

      const sustain = SUSTAIN[def.behaviour]
      if (sustain && def.cooldown === 0) {
        sustain(ctx)
        continue
      }

      /*
         Batch 2, Post Hole Auger: Two Speed is a per-weapon attack-speed
         upgrade, and attack speed is applied as a DEPLETION RATE on
         `cooldownLeft` rather than a scale on the refill (see below) — so
         this weapon's own rate gets its own extra multiplier rather than
         touching the player-wide `attackSpeedMultiplier`. 1 for every other
         weapon and every run that has not taken the card.
      */
      const twoSpeedMul = hasMod(slot, 'twoSpeed')
        ? 1 + (typeof def.twoSpeedAttackSpeedPct === 'number' ? def.twoSpeedAttackSpeedPct : 40) / 100
        : 1
      slot.cooldownLeft -= dt * p.stats.attackSpeedMultiplier * twoSpeedMul
      if (slot.cooldownLeft <= 0) {
        const fire = FIRE[def.behaviour]
        const before = this.projectiles.live
        if (fire) fire(ctx)
        slot.recoil = T.fx.weaponRecoilSeconds
        // Which weapon is in his HANDS is decided here and nowhere else. The
        // renderer only reads the stamp; see WeaponSlot.firedAt.
        slot.firedAt = this.tick

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
        // The crescent is a SWING. A thrust weapon gets none of it -- not the
        // crescent here and not the swept clip the renderer would otherwise
        // stretch across the hitbox -- because between them they were drawing a
        // sword and a bite on a tool that stabs. See `swingStyleOf`.
        if (def.behaviour === 'arcSwing' && swingStyleOf(slot.id) !== 'thrust') {
          this.playFx('slash', p.x + Math.cos(p.facing) * 30, p.y + Math.sin(p.facing) * 30, p.facing)
        } else if (def.type === 'ranged') {
          this.muzzleAcc += T.fx.muzzleChance
          if (this.muzzleAcc >= 1) {
            this.muzzleAcc -= 1
            // Out of the barrel of the gun he is holding, along the line the
            // shot actually took. It used to be sixteen pixels along `facing`,
            // which is the way he is WALKING: a weapon that auto-targets is
            // firing sideways most of the time, and the flash was going the
            // other way. Pure decoration -- see `carryMuzzleOffset`.
            carryMuzzleOffset(p.classId, slot.id, p.facing, slot.aimAngle, MUZZLE)
            this.playFx('muzzle', p.x + MUZZLE.x, p.y + MUZZLE.y, slot.aimAngle)
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
          // Batch 2, Grenade Launcher: Willie Pete and Rifled Cup both fire on
          // this same detonation. Neither is tier-gated, so both are read off
          // the slot's own mods rather than `p.t1`/`p.t0`.
          const glDef = WEAPONS[p.weaponId]
          const glSlot = this.player.weapons.find((w) => w.id === p.weaponId)
          if (glSlot && hasMod(glSlot, 'williePete')) {
            const radius = typeof glDef?.williePeteRadius === 'number' ? glDef.williePeteRadius : 60
            const seconds = typeof glDef?.williePeteSeconds === 'number' ? glDef.williePeteSeconds : 3
            const dps = typeof glDef?.williePeteDps === 'number' ? glDef.williePeteDps : 12
            const h = this.spawnHazard()
            if (h) {
              h.kind = 'damage'
              h.x = p.x
              h.y = p.y
              h.radius = radius
              h.growth = 0
              h.maxLife = seconds
              h.life = seconds
              h.dps = dps
              h.playerDps = 0
              h.slowPct = 0
              h.playerSlowPct = 0
              h.pullForce = 0
            }
          }
          // Rifled Cup: relaunches once, at 60%, toward whatever is nearest
          // the blast. `p.ricochets` is otherwise unused by this behaviour —
          // set on the RELAUNCHED shell so it cannot bounce a second time.
          if (glSlot && hasMod(glSlot, 'rifledCup') && p.ricochets === 0) {
            const rifledTarget = this.findNearestEnemy(p.x, p.y, 260)
            if (rifledTarget >= 0) {
              const te = this.enemies.items[rifledTarget]
              const s2 = this.spawnProjectile()
              if (s2) {
                const mul = typeof glDef?.rifledCupMul === 'number' ? glDef.rifledCupMul : 0.6
                const d = Math.hypot(te.x - p.x, te.y - p.y) || 1
                const flight = Math.min(0.6, d / 420)
                s2.weaponId = p.weaponId
                s2.type = 'ranged'
                s2.behaviour = 'arcLob'
                s2.attached = false
                s2.x = p.x
                s2.y = p.y
                s2.px = s2.x
                s2.py = s2.y
                s2.vx = ((te.x - p.x) / d) * (d / flight)
                s2.vy = ((te.y - p.y) / d) * (d / flight)
                s2.radius = 7
                s2.damage = p.damage * mul
                s2.life = flight
                s2.pierce = -1
                s2.t0 = p.t0
                s2.t1 = p.t1
                s2.knockback = 60
                s2.hitStamp = -1
                s2.ricochets = 1 // spent: this one detonates without bouncing again
              }
            }
          }
        }
        // Batch 2, Crow Bell: Tolls Twice's delayed second peal.
        if (p.behaviour === 'tollsTwice') {
          this.areaDamage(p.x, p.y, p.t0, p.damage, 'melee', 60)
          this.playFx('shockwave', p.x, p.y, 0, p.t0 / 55, 0, 0, true)
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
          // The re-arm draws the same crescent the first swing did, so a thrust
          // weapon skips it here too -- its second jab is the streak coming
          // back, drawn from the projectile's own life.
          if (swingStyleOf(p.weaponId) !== 'thrust') this.playFx('slash', p.x, p.y, p.angle)
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

      /*
         H4 — Burr Load steers the round onto the nearest enemy.

         In the integrate step, per §8, and rate-limited by an ANGLE rather
         than by a lerp toward the target: a lerp makes a fast round turn
         faster than a slow one, so the same card would be worth twice as much
         on the Scattergun as on the Grenade Launcher for no stated reason.
         Turning `homingRate` degrees a second is the same promise whatever it
         is bolted to, and it is the promise the card prints.
      */
      /*
         Batch 2: Match Barrel rides the same steering with its OWN rate,
         set once at spawn on the round itself (`p.homingRate`) rather than on
         `specialItems` — Burr Load's rate is player-wide (every ranged shot),
         Match Barrel's is one weapon's own round. The higher of the two wins
         rather than summing them, which keeps this arithmetically identical
         to the line it replaces for every run that owns neither or only one.
      */
      const homingRate = Math.max(this.specialItems.homingRate, p.homingRate)
      if (homingRate > 0 && p.type === 'ranged' && !p.attached) {
        const target = this.findNearestEnemy(p.x, p.y, 420)
        if (target >= 0) {
          const e = this.enemies.items[target]
          const want = Math.atan2(e.y - p.y, e.x - p.x)
          const have = Math.atan2(p.vy, p.vx)
          let d = want - have
          while (d > Math.PI) d -= Math.PI * 2
          while (d < -Math.PI) d += Math.PI * 2
          const step = (homingRate * Math.PI) / 180 * dt
          const a = have + Math.max(-step, Math.min(step, d))
          const speed = Math.hypot(p.vx, p.vy)
          p.vx = Math.cos(a) * speed
          p.vy = Math.sin(a) * speed
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
    // Batch 2, Drum Gun: Frangible adds shards and hits harder per shard;
    // Live Wire gives every shard its own one-hop chain (H1, per-projectile —
    // see `applyOnHitRiders`). Both read off the SLOT rather than the def,
    // because they are cards taken, not numbers a tier grants.
    const slot = this.player.weapons.find((w) => w.id === p.weaponId)
    const frangible = slot ? hasMod(slot, 'frangible') : false
    const liveWire = slot ? hasMod(slot, 'liveWire') : false
    const bonusShards = frangible && typeof shardDef?.frangibleBonusShards === 'number'
      ? shardDef.frangibleBonusShards : frangible ? 2 : 0
    const total = count + bonusShards
    const frangibleMul = frangible && typeof shardDef?.frangibleDamageMul === 'number'
      ? shardDef.frangibleDamageMul : frangible ? 1.25 : 1
    const mul = (typeof shardDef?.shardDamageMultiplier === 'number'
      ? shardDef.shardDamageMultiplier
      : 0.55) * frangibleMul
    for (let i = 0; i < total; i++) {
      const s = this.spawnProjectile()
      if (!s) return
      const a = (i / total) * Math.PI * 2
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
      if (liveWire) {
        s.chainCount = 1
        s.chainRange = typeof shardDef?.liveWireChainRange === 'number'
          ? shardDef.liveWireChainRange : 130
        s.chainMul = typeof shardDef?.liveWireChainMul === 'number'
          ? shardDef.liveWireChainMul : 0.4
      }
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
      if (p.behaviour === 'tracer') continue // purely visual; damage already dealt

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
          // The Reaper's Own: melee cuts clean through everything, and what it
          // kills it keeps cutting. Ranged is untouched — a legendary that made
          // every bullet infinitely piercing would end the game.
          const reaper = this.specialItems.reswingDamageMultiplier > 0
            && (p.type === 'melee' || p.type === 'orbit')
          if (reaper) {
            // no-op: never spent
          } else if (p.pierce > 0) {
            p.pierce--
          } else {
            this.projectiles.free(i)
            break
          }
        } else if (p.behaviour === 'trapField' && p.hitsLeft <= 0) {
          // Bear Trap (batch 3, H8): `attached` exempts it from the block
          // above, so its own one-shot consumption is spelled out here —
          // triggered and spent in the same tick it bites.
          this.projectiles.free(i)
          break
        }
      }
    }
  }

  private applyHit(enemyIndex: number, p: Projectile): void {
    const e = this.enemies.items[enemyIndex]
    const type = p.type === 'melee' || p.type === 'orbit' ? 'melee' : 'ranged'

    /*
       A weapon may name its own impact, and one does: the pitchfork sparks
       where a TINE lands rather than at the middle of whatever it hit.

       Placed on the enemy's near edge, on the line back to the swing's centre,
       because that is the face the tines went into. It is not rate-limited the
       way the shared spark is -- a fork hits at most a handful of things per
       jab and stops, where a stream weapon hits continuously.

       Decoration, and provably so: `playFx` draws no random numbers, acquires
       from a pool that drops silently when full, and touches nothing the sim
       reads back. A fixed seed reports the same quantities with it and without.
    */
    const hitFx = (WEAPONS[p.weaponId] as { hitFx?: string } | undefined)?.hitFx
    if (hitFx) {
      const dx = p.x - e.x
      const dy = p.y - e.y
      const d = Math.hypot(dx, dy) || 1
      this.playFx(
        hitFx as keyof typeof T.fx & string,
        e.x + (dx / d) * e.radius,
        e.y + (dy / d) * e.radius,
        Math.atan2(-dy, -dx),
        T.fx.jab.sparkScale,
      )
    }

    const isCrit = this.rng.chance(this.player.stats.critChance)
    // Batch 2: which weapon actually landed this, for the one card that asks
    // ("Straw Chopper: its kills leave..."). Chain hits, hazard ticks and
    // corpse splits go through `damageEnemy` directly rather than here, so
    // this is deliberately "the last WEAPON that hit it", not "the last
    // damage of any kind" — which is exactly what a per-weapon card wants.
    e.lastHitWeaponId = p.weaponId

    // Statuses land BEFORE the damage, so a killing blow still leaves them on
    // the corpse. Applying them after meant a chili shot that killed outright
    // never lit what it killed, and the T3 "burn spreads on death" rider could
    // therefore never fire at all. A mark works the same way: the hit that
    // applies it should benefit from it.
    if (p.stunOnHit > 0 && !e.knockbackImmune) {
      // Post Driver multiplies every stun the player lands, wherever it comes from.
      e.stun = Math.max(e.stun, p.stunOnHit * this.specialItems.stunMultiplier)
    }
    /*
       The Agronomist's Cultivar rides HERE, at the point the status is handed
       from a projectile to an enemy, and not inside `applyBurn`/`applyBleed`.

       Those are also the entry points for effects the player did not apply --
       the Chili Shot's death-spread re-applies a burn that was already boosted
       once -- and boosting there would compound a status with itself every
       time it changed hands. Scaling the payload as it leaves the projectile
       boosts each application exactly once.

       Locals, not writes back onto `p`: a projectile is pooled and pierces,
       so multiplying its own fields would compound per enemy hit and then
       leak into whatever the slot is reused for.

       The multipliers are 1 and the cap 100 for every other class, and every
       `slowOnHit` in content is under 100, so this is arithmetically identical
       for the other five and their seeds still replay.
    */
    /*
       Second Pass and Deep Soak join HERE, in the same two terms Cultivar
       already uses, and they join them ADDITIVELY: `loadDamagePct` is summed
       into the multiplier rather than multiplied by it, and `loadBonusSeconds`
       is a flat term added after. Both are zero for a run that owns neither,
       so this is arithmetically the line it replaces.
    */
    const sp = this.specialItems
    const dotDmg = this.player.dotDamageMul + sp.loadDamagePct / 100
    const dotLife = this.player.dotDurationMul
    const dotAdd = sp.loadBonusSeconds
    if (p.burnDps > 0) this.applyBurn(e, p.burnDps * dotDmg, p.burnSeconds * dotLife + dotAdd)
    if (p.bleedDps > 0) this.applyBleed(e, p.bleedDps * dotDmg, p.bleedSeconds * dotLife + dotAdd)
    if (p.markPct > 0) this.applyMark(e, p.markPct, p.markSeconds + dotAdd)
    // Weak Seam: a crit marks. §8's list of nineteen — `markPct` is a field the
    // Harpoon's T4 rider already writes, so a crit build and a status build
    // become the same build with no new debuff invented.
    if (isCrit && sp.critMarkPct > 0) {
      this.applyMark(e, sp.critMarkPct, sp.critMarkSeconds + dotAdd)
    }
    if (p.slowOnHit > 0) {
      const slow = Math.min(this.player.slowCapPct, p.slowOnHit * dotDmg)
      const slowLife = p.slowSeconds * dotLife + dotAdd
      if (slow > e.slowPct) e.slowPct = slow
      if (slowLife > e.slowLife) e.slowLife = slowLife
    }

    this.damageEnemy(enemyIndex, p.damage, type, isCrit)
    if (p.burnDps > 0) this.igniteSlicksNear(p.x, p.y)
    // H1/H2/H5/H6 — one call, one cached boolean, nothing allocated (§8).
    // Batch 2's Live Wire rides the same call site with its own per-shard
    // chain (see `applyOnHitRiders`), so the gate also opens on THAT — still
    // one compare for a run that owns neither.
    if (sp.anyOnHitRider || p.chainCount > 0) this.applyOnHitRiders(enemyIndex, p)

    if (!e.active || e.dying > 0) return
    if (p.knockback > 0 && !e.knockbackImmune) {
      const dx = e.x - p.x
      const dy = e.y - p.y
      const d = Math.hypot(dx, dy) || 1
      const kb = p.knockback * this.knockbackMul
      e.kx += (dx / d) * kb
      e.ky += (dy / d) * kb
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

      const sp = this.specialItems

      // Sunday Best used to be special-cased here — the wave's first hit,
      // refunded and countered outright. H9 (batch 3) folds it into
      // `damagePlayer`'s shield absorption instead, so contact damage always
      // goes through the one call below now.
      this.damagePlayer(e.damage * waveScalar(this.spawner.wave))
      e.touchCd = P.contactDamageInterval
      // The chasers have no attack STATE — they damage by touching. The hit is
      // the only attack moment they have, so it is what plays the pose.
      if (e.attackT <= 0) e.attackT = 1e-6

      // Barbed Wire reflects onto whatever touched you.
      if (sp.reflect > 0) this.damageEnemy(j, sp.reflect, 'melee', false)

      // Cattle Prod: touching you stuns. `touchCd` already rate-limits contact
      // damage per enemy, so the stun rides the same gate rather than needing a
      // second per-enemy timer.
      if (sp.touchStunSeconds > 0) {
        e.stun = Math.max(e.stun, sp.touchStunSeconds)
        e.touchCd = Math.max(e.touchCd, sp.touchStunCooldown)
      }

      // Hobnails (batch 3, body): anything that touches the player is slowed.
      // Rides the same status fields a hazard's slow already uses.
      if (sp.touchSlowPct > 0) {
        e.slowPct = Math.max(e.slowPct, sp.touchSlowPct)
        e.slowLife = Math.max(e.slowLife, sp.touchSlowSeconds)
      }

      /*
         H13 — Anchor Stone (The Hand, epic): at Braced's cap, anything that
         reaches him is slowed. §6 writes this as a 90px aura; it rides the
         touch loop instead of a second grid query, the same simplification
         Straw Hat's "enemies within 60px" already makes here — contact
         damage only ever fires from something already touching him, so for
         a class whose whole identity is standing still and letting the
         crowd arrive, "on touch" and "in a small ring around him" are the
         same enemies. Rides the same status fields Hobnails does; the two
         cannot both be owned (different classes), so `Math.max` is
         defensive rather than load-bearing.
      */
      const cb = pl.classBonus
      if (cb.bracedCapSlowPct > 0 && pl.bracedAtCap) {
        e.slowPct = Math.max(e.slowPct, cb.bracedCapSlowPct)
        e.slowLife = Math.max(e.slowLife, cb.bracedCapSlowSeconds)
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

  /**
   * The worst slow the player is standing in, 0-1.
   *
   * Max rather than sum: two overlapping sumps are one sump as far as being
   * stuck in them goes, and stacking them would let a map reach a total stop.
   */
  private playerHazardSlow(): number {
    let worst = 0
    for (let i = 0; i < this.hazards.live; i++) {
      const h = this.hazards.items[i]
      if (h.playerSlowPct <= 0) continue
      if (Math.hypot(this.player.x - h.x, this.player.y - h.y) > h.radius) continue
      const s = h.playerSlowPct / 100
      if (s > worst) worst = s
    }
    return worst
  }

  /**
   * Vent the map's own hazards.
   *
   * These differ from every other hazard in the game in that they hurt BOTH
   * sides — `dps` and `playerDps` are separate numbers in maps.json and both
   * are usually non-zero. That is the point of putting hazards on the map
   * rather than on a weapon: a burning patch on The Burn is somewhere you can
   * drag a hog to die, not only somewhere you must not stand. A map that makes
   * them pure punishment is one edit away, and is not what any of the five do.
   */
  private updateAmbientHazards(dt: number): void {
    const cfg = this.map.hazards
    if (!cfg) return
    if (this.spawner.wave < cfg.fromWave) return

    this.ambientHazardIn -= dt
    if (this.ambientHazardIn > 0) return
    this.ambientHazardIn = cfg.everySeconds

    // Count only the map's own; a Watering Can slick must not starve the field
    // of the hazards the map is supposed to be venting.
    let live = 0
    for (let i = 0; i < this.hazards.live; i++) {
      if (this.hazards.items[i].sprite === cfg.sprite) live++
    }
    if (live >= cfg.maxLive) return

    // In a RING around the player, not anywhere on the field.
    //
    // Scattering uniformly over the arena was the first version and it made the
    // hazards invisible: the view is about 520x330 and the arena is nearer four
    // million square pixels, so a handful of live hazards spread evenly were
    // essentially never on screen and never walked into. They were a tax rolled
    // somewhere over the horizon. The annulus puts them just past the edge of
    // sight and within a short walk, which is the only arrangement where "this
    // map vents gas" is a thing the player can learn rather than suffer.
    //
    // Angle-and-distance rather than rejection sampling in a box: two draws,
    // always succeeds, and costs the RNG stream a fixed amount however full the
    // arena is. The clamp keeps it inside the fence; a hazard shoved back
    // against a wall is still on ground the player uses.
    const angle = this.rng.range(0, Math.PI * 2)
    const dist = this.rng.range(cfg.minDistanceFromPlayer, cfg.maxDistanceFromPlayer)
    const lo = cfg.radius + this.edgeInset
    let x = this.player.x + Math.cos(angle) * dist
    let y = this.player.y + Math.sin(angle) * dist
    if (x < lo) x = lo
    else if (x > this.arenaW - lo) x = this.arenaW - lo
    if (y < lo) y = lo
    else if (y > this.arenaH - lo) y = this.arenaH - lo

    const h = this.spawnHazard()
    if (!h) return
    h.kind = cfg.kind
    h.x = x
    h.y = y
    h.radius = cfg.radius
    h.growth = cfg.growth
    h.life = cfg.life
    h.maxLife = cfg.life
    h.dps = cfg.dps
    h.playerDps = cfg.playerDps
    h.slowPct = cfg.slowPct
    h.playerSlowPct = cfg.playerSlowPct
    h.sprite = cfg.sprite ?? ''
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
      // Iron Lung makes gas inert. Checked here rather than at spawn so the
      // cloud still exists, still renders, and still hurts enemies caught in it
      // — the card removes the threat, not the object.
      const inert = this.specialItems.gasImmune && h.kind === 'gas'
      if (h.playerDps > 0 && this.player.alive && !inert) {
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
        /*
           Hot As It Comes: "every slick on the field burns twice as hot."

           Applied HERE, at the tick, rather than at each spawn site — which is
           what makes one card worth six sources (tar puddles, kerosene
           splashes, the Chem Sprayer's gas, the Grenade Launcher's rind, the
           Crop Duster's trail, Rot Underfoot's pools) with no new hook. It
           scales `dps` and never `playerDps`, so the enemy's own acid pools
           and gas clouds — which carry no `dps` at all — are untouched.

           A payload scalar at the point of application, exactly where
           `dotDamageMul` lives. It is not a stat and does not go near
           `resolveStats`.
        */
        h.tickAcc += h.dps * (1 + this.specialItems.slickDamagePct / 100) * dt
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
    // The magnet power-up widens the radius rather than magnetising everything
    // every tick: a permanent sweep for its duration would collect a gem the
    // instant it spawned anywhere on the map, which is not a power-up, it is
    // the end of pickups. A big radius still leaves the greed curve intact.
    if (this.magnetSeconds > 0) this.magnetSeconds -= dt
    const magnetR = this.magnetSeconds > 0
      ? pl.stats.pickupRadius * BREAKABLES.magnet.radiusMultiplier
      : pl.stats.pickupRadius
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

  /**
   * Switched exhaustively on the kind, not `xp / feed / else`.
   *
   * The old `else` meant heal, which was true while heal was the only third
   * kind. A magnet or a gear card arriving in that branch would silently have
   * healed the player for `value` instead -- zero, in the gear case -- and the
   * pickup would have looked like it did nothing.
   */
  private collect(g: Pickup): void {
    switch (g.kind) {
      case 'xp': {
        // H15: xpPct is additive with harvestPct, which already scaled XP
        // pickups — Seed Corn's whole card is this one line.
        const gained = g.value *
          (1 + (this.player.stats.harvestPct + this.player.stats.xpPct) / 100)
        const levels = this.player.gainXp(gained)
        if (levels > 0) this.events.onLevelUp?.(levels)
        return
      }
      case 'feed':
        this.sound('pickupFeed')
        // Early Bird (batch 5): every feed pickup, whatever spawned it, is
        // worth more — added flat, after the harvest scaling, the same way
        // `killHeal` is a flat add after a percentage elsewhere in this file.
        this.player.feed += Math.round(g.value * (1 + this.player.stats.harvestPct / 100))
          + this.specialItems.feedBonusFlat
        return
      case 'heal':
        this.sound('pickupHeal')
        this.player.hp = Math.min(this.player.stats.maxHp, this.player.hp + g.value)
        return
      case 'magnet':
        this.sound('pickupFeed')
        // Both halves of what the magnet promises: sweep what is already down,
        // then hold the radius open so what drops during the window follows.
        this.magnetiseAll()
        this.magnetSeconds = BREAKABLES.magnet.seconds
        this.events.onMagnet?.(BREAKABLES.magnet.seconds)
        return
      case 'gear':
        // Eligibility was settled when it dropped, so this cannot no-op. A
        // second check here would be the wrong place for it -- by now the
        // player has walked to it, and refusing at the last step is worse than
        // never having offered.
        this.sound('pickupFeed')
        if (g.itemId) {
          this.player.addItem(g.itemId)
          this.refreshSpecialItems()
          this.events.onGear?.(g.itemId)
        }
        return
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
    for (const [id, t] of this.player.weaponFlash) {
      const left = t - dt
      if (left <= 0) this.player.weaponFlash.delete(id)
      else this.player.weaponFlash.set(id, left)
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
    // Class pass: any class's successful press counts, cheap enough that a
    // per-class gate to skip it would cost more than just always doing it.
    // Only The Hand's Braced ever reads it (see the note on `updatePassive`).
    p.sinceAbility = 0

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
      /*
         H13 — Dust Devil (The Kid, epic): the blinding dust trail catches.
         One pooled hazard centred on the dash rather than a segment swept
         along it — the pool this rides already exists (`spawnHazard`, the
         same one Hold the Line's ward and every slick uses), a second
         travelling hazard per dash would not — and the trail IS the blind
         cloud, which sits roughly where the dash crossed, not at one end
         of it. Radius covers half the dash so a pursuer following the
         blind trail is in it, not chasing behind it.
      */
      if (p.classBonus.boltTrailDps > 0) {
        const h = this.spawnHazard()
        if (h) {
          h.kind = 'acid'
          h.x = (p.px + p.x) / 2
          h.y = (p.py + p.y) / 2
          h.radius = Math.max(40, dist / 2)
          h.life = p.classBonus.boltTrailSeconds
          h.maxLife = p.classBonus.boltTrailSeconds
          h.dps = p.classBonus.boltTrailDps
        }
      }
    } else if (a.id === 'holdTheLine') {
      this.plantWard(a)
    } else if (a.id === 'claymore') {
      this.plantMine(a)
    } else if (a.id === 'fieldSample') {
      this.throwFlask(a)
    } else if (a.id === 'lightOut') {
      this.harpoonDash(a)
    } else {
      /*
         No branch for this id: the ability in classes.json is not implemented.

         Hand the cooldown back rather than charging for it. A dead button that
         also claims to be recharging is the failure this project shipped for a
         milestone -- four classes with `digIn` or `bolt` bolted on precisely
         because an unimplemented id gives the player a button that silently
         does nothing. Refunding makes it silently do nothing *instantly*,
         which is the same for the player and visible to a test.
      */
      p.abilityCooldown = 0
    }
  }

  /**
   * The Widow's Hold the Line: a ward at her feet that slows what walks into
   * it and pays her for what dies in it.
   *
   * The slow is a real `slow` hazard rather than bespoke code, so it renders
   * with the slop puddles and is applied by the same line in `steerEnemies`
   * that has always applied one. Only the kill payout needs the player to
   * remember where the ward is, and that is four numbers, not an entity.
   *
   * She is NOT rooted by it. Dig In roots because absorbing is the whole trade;
   * a ward you cannot leave is a worse Dig In rather than a different ability.
   */
  private plantWard(a: Record<string, unknown>): void {
    const p = this.player
    const radius = (a.radius as number) ?? 160
    const seconds = (a.duration as number) ?? 4
    p.wardX = p.x
    p.wardY = p.y
    p.wardRadius = radius
    p.wardLife = seconds
    p.wardHealPerKill = (a.healPerKill as number) ?? 0
    p.abilityActive = seconds

    const h = this.spawnHazard()
    if (h) {
      h.kind = 'slow'
      h.x = p.x
      h.y = p.y
      h.radius = radius
      h.life = seconds
      h.maxLife = seconds
      h.slowPct = (a.slowPct as number) ?? 45
    }
    this.sound('digIn')
    this.playFx('shockwave', p.x, p.y, 0, radius / 55, 0, 0, true)
  }

  /**
   * The Veteran's Claymore: plant, arm, then blow on the first thing that comes
   * near or when the fuse runs out.
   *
   * A ring rather than the cone the brief asked for. Every piece of reach in
   * this game is circle-vs-circle against the hash grid, and a cone would mean
   * a second geometry on the damage path for one ability -- and would face the
   * wrong way half the time, because a mine you walk away from has no facing
   * that means anything by the time it goes off.
   */
  private plantMine(a: Record<string, unknown>): void {
    const p = this.player
    // The fuse is shorter than the cooldown so two can never coexist. If a
    // future tune breaks that, the standing one goes off rather than vanishing.
    if (p.mineLife > 0) this.detonateMine()
    p.mineX = p.x
    p.mineY = p.y
    p.mineArm = (a.armSeconds as number) ?? 0.8
    p.mineLife = (a.fuseSeconds as number) ?? 6
    this.sound('baitDrop')
    // A full-circle telegraph is how the game already says "this ground is
    // about to hurt", and it is the only marker the mine gets.
    this.addTelegraph(p.x, p.y, 0, (a.triggerRadius as number) ?? 90, 360, p.mineLife)
    this.mineMarker = this.telegraphs[this.telegraphs.length - 1]
  }

  private updateMine(dt: number): void {
    const p = this.player
    const a = p.def.ability
    p.mineLife -= dt
    if (p.mineLife <= 0) {
      this.detonateMine()
      return
    }
    if (p.mineArm > 0) {
      p.mineArm -= dt
      return
    }
    const trigger = (a.triggerRadius as number) ?? 90
    const n = this.grid.query(p.mineX, p.mineY, trigger, this.queryOut)
    for (let k = 0; k < n; k++) {
      const j = this.queryOut[k]
      if (j >= this.enemies.live) continue
      const e = this.enemies.items[j]
      if (e.dying > 0) continue
      const dx = e.x - p.mineX
      const dy = e.y - p.mineY
      if (dx * dx + dy * dy <= trigger * trigger) {
        // `areaDamage` reuses `queryOut`, so nothing may read it after this.
        this.detonateMine()
        return
      }
    }
  }

  private detonateMine(): void {
    const p = this.player
    const a = p.def.ability
    p.mineLife = 0
    p.mineArm = 0
    if (this.mineMarker) {
      const i = this.telegraphs.indexOf(this.mineMarker)
      if (i >= 0) this.telegraphs.splice(i, 1)
      this.mineMarker = null
    }
    const radius = (a.blastRadius as number) ?? 150
    this.playFx('explosion', p.mineX, p.mineY, 0, radius / 90)
    this.sound('explosion')
    this.addShake(0.4)
    this.areaDamage(
      p.mineX, p.mineY, radius,
      (a.damage as number) ?? 60,
      'ranged',
      (a.knockback as number) ?? 320,
      (a.stunSeconds as number) ?? 1.2,
    )
  }

  /**
   * The Agronomist's Field Sample: a flask lobbed a fixed distance that leaves
   * a lasting slick carrying whatever element she is running.
   *
   * Deliberately not a dash. She is the one class whose answer to a crowd is to
   * change the ground it is standing on, and giving her an escape button would
   * make her a slower Drifter with better loot.
   */
  private throwFlask(a: Record<string, unknown>): void {
    const p = this.player
    const dist = (a.throwDistance as number) ?? 190
    const radius = (a.radius as number) ?? 110
    const lo = radius * 0.5
    const x = Math.max(lo, Math.min(this.arenaW - lo, p.x + Math.cos(p.facing) * dist))
    const y = Math.max(lo, Math.min(this.arenaH - lo, p.y + Math.sin(p.facing) * dist))
    const seconds = ((a.seconds as number) ?? 6) * p.dotDurationMul

    const h = this.spawnHazard()
    if (h) {
      const el = ELEMENTS[p.element]
      const scale = (a.elementDpsScale as number) ?? 1.6
      const dps = ((el?.burnDps ?? 0) + (el?.bleedDps ?? 0)) * scale * p.dotDamageMul
      // No element, or a purely defensive one, and the slick is what it is on
      // its own: ground that holds a crowd still. An element that BITES turns
      // it into ground that kills, which is the whole shape of her build.
      if (dps > 0) {
        h.kind = 'acid'
        h.dps = dps
      } else {
        h.kind = 'slow'
        h.slowPct = Math.min(
          p.slowCapPct,
          Math.max((a.slowPct as number) ?? 40, el?.slowOnHit ?? 0) * p.dotDamageMul,
        )
      }
      h.x = x
      h.y = y
      h.radius = radius
      h.life = seconds
      h.maxLife = seconds
    }
    this.sound('acidSizzle')
    this.playFx('gas', x, y, 0, radius / 90)
  }

  /**
   * The Drifter's Light Out: a dash that is a weapon.
   *
   * The Kid's Bolt is an escape — i-frames and a blinding trail. This crosses
   * the same distance and charges everything on the line for it, and the
   * cooldown comes back for each thing that dies on the way through, so it is
   * the one ability in the game that is cheaper the more committed you are.
   */
  private harpoonDash(a: Record<string, unknown>): void {
    const p = this.player
    const dist = (a.dashDistance as number) ?? 220
    const lineRadius = (a.lineRadius as number) ?? 34
    const x0 = p.x
    const y0 = p.y
    p.invuln = (a.iFrames as number) ?? 0.35
    p.x = Math.max(0, Math.min(this.arenaW, p.x + Math.cos(p.facing) * dist))
    p.y = Math.max(0, Math.min(this.arenaH, p.y + Math.sin(p.facing) * dist))
    this.sound('shootHarpoon')
    this.burstParticles(x0, y0, 12, 0xd9c9a3)
    this.playFx('dust', x0, y0, p.facing, 1, 0, 0, true)

    const sx = p.x - x0
    const sy = p.y - y0
    const len2 = sx * sx + sy * sy
    const before = this.kills
    /*
       One query over a circle that covers the whole swept line, then an exact
       point-to-SEGMENT test per candidate. Sampling the line at intervals and
       calling `areaDamage` at each would hit the enemies in the overlaps twice.

       `dashOut` and not `queryOut`: this loop calls `damageEnemy`, which can
       reach `areaDamage` through the Threshing Floor chain and the Reaper
       re-swing, and both of those query the grid into `queryOut`. Iterating a
       scratch array something downstream overwrites is a bug that only shows up
       once the player owns a particular legendary.
    */
    const midX = (x0 + p.x) / 2
    const midY = (y0 + p.y) / 2
    const n = this.grid.query(midX, midY, Math.sqrt(len2) / 2 + lineRadius, this.dashOut)
    for (let k = 0; k < n; k++) {
      const j = this.dashOut[k]
      if (j >= this.enemies.live) continue
      const e = this.enemies.items[j]
      if (e.dying > 0) continue
      // Closest point on the segment, clamped to its ends.
      const t = len2 > 0
        ? Math.max(0, Math.min(1, ((e.x - x0) * sx + (e.y - y0) * sy) / len2))
        : 0
      const cx = x0 + sx * t
      const cy = y0 + sy * t
      const dx = e.x - cx
      const dy = e.y - cy
      const reach = lineRadius + e.radius
      if (dx * dx + dy * dy > reach * reach) continue
      this.damageEnemy(j, (a.damage as number) ?? 45, 'melee', this.rng.chance(p.stats.critChance))
      if (!e.active || e.dying > 0 || e.knockbackImmune) continue
      // Shoved off the line rather than along it — the point is that he goes
      // through the crowd, so the crowd has to end up either side of him.
      const d = Math.hypot(dx, dy) || 1
      const kb = ((a.knockback as number) ?? 300) * this.knockbackMul
      e.kx += (dx / d) * kb
      e.ky += (dy / d) * kb
    }

    const refund = ((a.cooldownRefundPerKill as number) ?? 0) * (this.kills - before)
    if (refund > 0) p.abilityCooldown = Math.max(0, p.abilityCooldown - refund)
  }

  private updateAbility(dt: number): void {
    const p = this.player
    // The ward and the mine outlive `abilityActive` — the mine deliberately, so
    // it is a thing left on the ground rather than a channel — so both tick
    // before the early return below.
    if (p.wardLife > 0) {
      p.wardLife -= dt
      if (p.wardLife <= 0) p.wardLife = 0
    }
    if (p.mineLife > 0) this.updateMine(dt)
    if (p.abilityActive <= 0) return
    p.abilityActive -= dt
    if (p.abilityActive <= 0) {
      p.rooted = false
      const a = p.def.ability
      if (a.id === 'digIn') {
        const radius = (a.pulseRadius as number) ?? 140
        const kb = ((a.pulseKnockback as number) ?? 260) * this.knockbackMul
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

    // HP rides its own steeper curve; contact damage stays linear. See formulas.
    const scalar = waveHpScalar(this.spawner.wave)
    e.typeId = typeId
    /*
       Cycle the sheet where the type declares variants.

       A COUNTER, not an RNG draw. Two reasons. It costs nothing, where a third
       `next()` per spawn would reseat every draw after it and invalidate every
       recorded seed for a change that is purely cosmetic. And a cycle actually
       mixes a flock better than a roll does: ten rolls of ten will hand you the
       same hen twice about as often as not, which is the exact complaint this
       is here to answer.
    */
    const sheets = def.sheets
    e.sheetId = sheets && sheets.length > 0
      ? sheets[this.spawnSeq++ % sheets.length]
      : typeId
    e.x = x
    e.y = y
    e.px = x
    e.py = y
    e.vx = 0
    e.vy = 0
    e.kx = 0
    e.ky = 0
    // Tier is a flat multiplier on top of the wave curve, never compounded
    // into it: Tier 3 is "everything has 50% more HP", not a different curve.
    e.maxHp = def.hp * scalar * (elite ? WAVES.elite.hpMultiplier : 1) * tierHpMultiplier(this.tier)
    e.hp = e.maxHp
    e.speed = def.speed
    e.damage = def.damage
    e.radius = def.radius
    e.xp = def.xp
    e.behaviour = def.behaviour
    e.elite = elite
    e.flash = 0
    e.flashLock = 0
    e.stun = 0
    e.facing = 0
    e.t0 = 0
    e.t1 = -1
    e.s0 = 0
    e.s1 = 0
    e.touchCd = 0
    e.knockbackImmune = def.knockbackImmune === true
    e.dying = 0
    e.attackT = 0
    e.hitT = 0
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
    p.ricochets = 0
    p.t0 = 0
    p.t1 = 0
    // Batch 2, H1/H4 per-projectile overrides (see entities.ts) — zero unless
    // the behaviour that just spawned this round sets one.
    p.homingRate = 0
    p.chainCount = 0
    p.chainRange = 0
    p.chainMul = 0
    p.loadDurationMul = 1
    return p
  }

  /**
   * Put the player's element on every projectile spawned since `fromIndex`.
   *
   * The element swaps the whole bullet rather than tinting one — a fire build
   * fires actual fireballs, an acid build fires acid — and carries the lasting
   * damage on the payload fields the tier riders already use, so it needed no
   * new damage plumbing.
   *
   * Every number is read through `elementStat`, which folds in
   * `player.loadStacks` (`elements.json` `_stackNote`): a second Tracer Rounds
   * used to re-assert `element = 'fire'` over itself and do nothing, which is
   * the "what does buying fire 5 times do" complaint. `elementStat` returns
   * exactly `base` when there is no `<field>PerStack` to add, so this reads
   * identically for the six Loads that can only ever be at stack 1.
   */
  private applyElementTo(fromIndex: number): void {
    const el = ELEMENTS[this.player.element]
    const s = this.specialItems
    const stacks = this.player.loadStacks
    if (el && this.player.element !== 'none') {
      const burnDps = elementStat(el, 'burnDps', stacks)
      const burnSeconds = elementStat(el, 'burnSeconds', stacks)
      const bleedDps = elementStat(el, 'bleedDps', stacks)
      const bleedSeconds = elementStat(el, 'bleedSeconds', stacks)
      const slowOnHit = elementStat(el, 'slowOnHit', stacks)
      const slowSeconds = elementStat(el, 'slowSeconds', stacks)
      const mark = elementStat(el, 'markPct', stacks)
      const markSeconds = elementStat(el, 'markSeconds', stacks)
      const kb = elementStat(el, 'knockback', stacks)
      for (let i = fromIndex; i < this.projectiles.live; i++) {
        const p = this.projectiles.items[i]
        // Backpack Tank: this ONE shot's load lasts longer. 1 for every shot
        // that is not the Chem Sprayer's jet with the card taken.
        const durMul = p.loadDurationMul
        if (burnDps) { p.burnDps = Math.max(p.burnDps, burnDps); p.burnSeconds = Math.max(p.burnSeconds, burnSeconds * durMul) }
        if (bleedDps) { p.bleedDps = Math.max(p.bleedDps, bleedDps); p.bleedSeconds = Math.max(p.bleedSeconds, bleedSeconds * durMul) }
        if (slowOnHit) { p.slowOnHit = Math.max(p.slowOnHit, slowOnHit); p.slowSeconds = Math.max(p.slowSeconds, slowSeconds * durMul) }
        // Rock Salt and Quicklime carry no damage of their own: they open the
        // target up. Same payload field the Harpoon's T4 rider already uses.
        if (mark) { p.markPct = Math.max(p.markPct, mark); p.markSeconds = Math.max(p.markSeconds, markSeconds * durMul) }
        // Font Water buys space instead of doing damage over time.
        if (kb) p.knockback = Math.max(p.knockback, kb)
      }
    }
    // Through and Through and Broad Side are on the §8 list of nineteen cards
    // that needed no hook at all: they are numbers the projectile already has.
    // Applied HERE, in the same walk the element uses, rather than in each of
    // the eight ranged behaviours.
    if (s.extraPierce > 0 || s.projectileRadiusPct > 0) {
      for (let i = fromIndex; i < this.projectiles.live; i++) {
        const p = this.projectiles.items[i]
        // A melee sweep and an orbit use `pierce: 999` as "never spent" and an
        // attached hitbox uses -1; adding to either would mean nothing or
        // break it. Only a real bullet has a pierce budget to raise.
        if (!p.attached && p.pierce >= 0 && p.pierce < 900) p.pierce += s.extraPierce
        if (s.projectileRadiusPct > 0) p.radius *= 1 + s.projectileRadiusPct / 100
      }
    }
  }

  /**
   * H1, H2, H5, H6 — everything a hit does BEYOND its own damage.
   *
   * One call at the end of `applyHit`, guarded by a single cached boolean so a
   * run that owns none of these pays one compare (§8). Nothing here allocates:
   * the chain and the ricochet reuse `this.queryOut`, the burst is one
   * `areaDamage`, and the kerosene slick is one `spawnHazard` off the pool that
   * already exists.
   *
   * `chaining` is the same re-entry guard the Threshing Floor and the Reaper's
   * re-swing share, and for the same reason: a chained hit that could chain
   * again turns one dense wave into a screen clear.
   */
  private applyOnHitRiders(enemyIndex: number, p: Projectile): void {
    const s = this.specialItems
    if (this.chaining) return
    const e = this.enemies.items[enemyIndex]
    const ox = e.x
    const oy = e.y

    // H1 — Fence Charge arcs to its neighbours, player-wide. Batch 2's Live
    // Wire is the same arc scoped to one weapon's own shard, carried on the
    // projectile rather than `specialItems` (see entities.ts) — the higher of
    // the two counts and ranges wins rather than summing, so a run with both
    // gets the bigger chain rather than two separate ones stacking.
    const chainCount = Math.max(s.chainCount, p.chainCount)
    if (chainCount > 0 && p.type !== 'melee' && p.type !== 'orbit') {
      const chainRange = Math.max(s.chainRange, p.chainRange)
      const chainMul = p.chainCount > s.chainCount ? p.chainMul : s.chainMul
      this.chaining = true
      let left = chainCount
      const n = this.grid.query(ox, oy, chainRange, this.queryOut)
      for (let k = 0; k < n && left > 0; k++) {
        const j = this.queryOut[k]
        if (j >= this.enemies.live || j === enemyIndex) continue
        const other = this.enemies.items[j]
        if (other.dying > 0) continue
        if (Math.hypot(other.x - ox, other.y - oy) > chainRange) continue
        left--
        this.damageEnemy(j, p.damage * chainMul, 'ranged', false)
      }
      this.playFx('shock', ox, oy)
      this.chaining = false
    }

    // H5 — the Moonshine Jug goes up on a fraction of hits.
    if (s.burstChance > 0 && this.rng.chance(s.burstChance / 100)) {
      this.chaining = true
      this.areaDamage(ox, oy, s.burstRadius, p.damage * s.burstMul, 'ranged', 40)
      this.playFx('explosion', ox, oy, 0, s.burstRadius / 60)
      this.chaining = false
    }

    // H6 — the Kerosene Load leaves burning ground where the shot landed.
    if (s.hitHazardKind !== '' && p.type !== 'melee' && p.type !== 'orbit') {
      this.dropRiderHazard(
        s.hitHazardKind, ox, oy, s.hitHazardRadius, s.hitHazardSeconds, s.hitHazardDps, 0,
      )
    }

    // H2 — the Ricochet Plate sends the round on rather than freeing it. The
    // projectile is RETARGETED, not respawned: it keeps its own payload, its
    // element and its pierce budget, and the pool never sees a new slot.
    if (s.ricochetCount > 0 && !p.attached && p.type === 'ranged' && p.ricochets < s.ricochetCount) {
      const j = this.findNearestEnemyExcept(ox, oy, s.ricochetRange, enemyIndex)
      if (j >= 0) {
        const other = this.enemies.items[j]
        const dx = other.x - p.x
        const dy = other.y - p.y
        const d = Math.hypot(dx, dy) || 1
        const speed = Math.hypot(p.vx, p.vy) || 320
        p.vx = (dx / d) * speed
        p.vy = (dy / d) * speed
        p.ricochets++
        p.damage *= s.ricochetMul
        p.pierce++ // spent again by the collision pass on the way out
        p.life = Math.max(p.life, 0.5)
      }
    }
  }

  /**
   * H3 — Split Shot. What it kills, it comes out of.
   *
   * Rounds go out on a fixed fan rather than at random angles: the split is
   * not a draw, so it costs the seeded stream nothing and two runs from one
   * seed still agree about where every bullet went.
   */
  private splitFromCorpse(x: number, y: number, count: number, damage: number): void {
    for (let i = 0; i < count; i++) {
      const s = this.spawnProjectile()
      if (!s) return
      const a = (i / count) * Math.PI * 2
      s.weaponId = ''
      s.type = 'ranged'
      s.behaviour = 'stream'
      s.attached = false
      s.x = x
      s.y = y
      s.px = x
      s.py = y
      s.vx = Math.cos(a) * 300
      s.vy = Math.sin(a) * 300
      s.radius = 5
      s.damage = damage
      s.life = 0.7
      s.pierce = 0
      s.knockback = 20
      s.hitStamp = -1
    }
  }

  /**
   * H11 — Broody Hen. Every twelfth kill hatches a chick.
   *
   * A chick is a MINION, on the path the Barn Dog and the Whitacre Bull
   * already fly: pooled as a projectile, steered by `minionHunt` in the
   * integrate step, rate-limited by the same bite stamp. It is not a placeable
   * (H8, batch 3) and it needed no new pool and no new steering. It dies on a
   * timer rather than on contact, and `killSpawnMax` — one per copy of the
   * card — is enforced by counting the live ones before hatching another.
   */
  private hatchChick(x: number, y: number): void {
    const s = this.specialItems
    let live = 0
    for (let i = 0; i < this.projectiles.live; i++) {
      if (this.projectiles.items[i].weaponId === 'broodyHen') live++
    }
    if (live >= s.killSpawnMax) return
    const p = this.spawnProjectile()
    if (!p) return
    p.weaponId = 'broodyHen'
    p.type = 'minion'
    p.behaviour = 'minionHunt'
    p.attached = false
    p.x = x
    p.y = y
    p.px = x
    p.py = y
    p.t1 = live
    p.radius = 9
    p.pierce = 999
    p.damage = s.killSpawnDamage
    p.life = s.killSpawnSeconds
    p.angularVelocity = 210
    p.t0 = 400
    p.knockback = 10
    p.hitStamp = this.tick
    p.rearm = 0
  }

  /** One pooled hazard, for the riders that lay ground. Never allocates. */
  private dropRiderHazard(
    kind: HazardKind, x: number, y: number,
    radius: number, seconds: number, dps: number, slowPct: number,
  ): void {
    const h = this.spawnHazard()
    if (!h) return
    h.kind = kind
    h.x = x
    h.y = y
    h.radius = radius
    h.growth = 0
    h.maxLife = seconds
    h.life = seconds
    h.dps = dps
    h.playerDps = 0
    h.slowPct = slowPct
    h.playerSlowPct = 0
    h.pullForce = 0
  }

  /** How many statuses this enemy is carrying. Cross-Contamination's gate. */
  private statusCount(e: Enemy): number {
    let n = 0
    if (e.burnLife > 0) n++
    if (e.bleedLife > 0) n++
    if (e.slowLife > 0) n++
    if (e.markLife > 0) n++
    if (e.stun > 0) n++
    return n
  }

  /** Nearest live enemy that is not `skip`, or -1. For the ricochet. */
  private findNearestEnemyExcept(x: number, y: number, maxRange: number, skip: number): number {
    let best = -1
    let bestD2 = maxRange * maxRange
    for (let i = 0; i < this.enemies.live; i++) {
      if (i === skip) continue
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
    h.playerSlowPct = 0
    h.pullForce = 0
    h.markPct = 0
    h.markSeconds = 0
    h.sprite = ''
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
    // Recorded so `killEnemy` knows whether a blade or a bullet finished it —
    // the Reaper re-swings on melee kills only.
    e.lastHitMelee = type === 'melee'

    const typePct = type === 'melee' ? s.meleePct : type === 'ranged' ? s.rangedPct : 0
    /*
       The Veteran's Overwatch joins the same additive percentage sum as
       everything else, which is the only place a PER-TARGET percentage can go
       without breaking the single-pass rule. `overwatchPct` returns 0 on its
       first compare for every other class.
    */
    const pl = this.player
    const dmg = resolveDamage(
      amount,
      s.damagePct + pl.passiveDamagePct + pl.overwatchPct(e.x - pl.x, e.y - pl.y),
      typePct,
      0,
      isCrit,
      s.critDamagePct,
      0,
      1,
      /*
         Cross-Contamination joins the mark's own term ADDITIVELY, which is the
         only place a per-target percentage can go without breaking the
         single-pass rule — the same argument Overwatch is written up with
         eight lines above. Zero for every run that does not own it.

         "Two or more statuses" is counted here rather than latched on the
         enemy, because a status can expire between the tick that applied it
         and the tick that reads it, and a latched flag would then be a lie
         about the enemy's current state.
      */
      (e.markLife > 0 ? e.markPct : 0)
        + (this.specialItems.crossMarkPct > 0 && this.statusCount(e) >= 2
          ? this.specialItems.crossMarkPct : 0),
    )

    e.hp -= dmg
    this.damageDealt += dmg
    if (!fromDot) {
      // The white flash is a HIT report, so damage-over-time must not raise it:
      // a burn ticks several times a second per enemy and would hold the sprite
      // white permanently. Same reasoning as the spark rate limit below, which
      // was already here -- the flash was simply missed when that was written.
      //
      // The refractory is the other half. Even direct hits arrive faster than
      // 60ms once a build is up, so re-arming on every one made the flash a
      // solid fill rather than a blink. Locking it for a beat afterwards caps
      // the duty cycle, so a crowd reads as sprites being hit instead of as a
      // wall of white.
      if (e.flashLock <= 0) {
        e.flash = C.hitFlashSeconds
        e.flashLock = C.hitFlashSeconds + C.hitFlashRefractorySeconds
        // The recoil rides the SAME gate. It is a longer clip than the blink,
        // so left ungated it would be re-armed before it finished and the
        // enemy would appear frozen in the first frame of a flinch forever --
        // the flash bug again, in an animation instead of a colour.
        e.hitT = C.hitClipSeconds
      }

      this.addDamageNumber(e.x, e.y - e.radius, dmg, isCrit)
      this.bleed(e.x, e.y, isCrit ? 5 : 3)

      // A crit always announces itself; ordinary hits spark at a fixed rate, so
      // a late wave reads as combat rather than as a wall of white.
      if (isCrit) {
        this.playFx(this.elementalFx('bigImpact'), e.x, e.y - e.radius * 0.4)
        this.sound('crit')
      } else {
        this.sparkAcc += T.fx.hitSparkChance
        if (this.sparkAcc >= 1) {
          this.sparkAcc -= 1
          // The impact reads as the element too, not just the bullet.
          const impact = ELEMENTS[this.player.element]?.impact ?? 'arrowImpact'
          this.playFx(this.elementalFx(impact), e.x, e.y - e.radius * 0.4)
          this.sound('hit')
        }
      }
    }

    if (s.lifestealPct > 0) {
      /*
         Class pass (this session): The Drifter's lifesteal now scales with
         his OWN Hot Streak rather than being a flat percentage of every hit —
         see `_lifestealGateNote` on the class. Everyone else keeps `scale`
         at 1, byte-identical to the old unconditional line.

         The cause it fixes: `lifestealPct` reads every point of damage that
         reaches this function, weapon fire and a standing aura's DoT ticks
         alike, so a stationary build (a Smudge Pot, chip-finishing whatever
         wanders into it) farmed near-full healing off ticks Hot Streak was
         never meant to be paid for. Hot Streak's own rule is "any hit at all
         ends it", so `pl.streak` is lowest exactly when a passive, standing
         build is taking the most contact damage — the moment it needs
         healing most — while a build that is actually dodging keeps its
         streak up and its lifesteal with it. Ties his sustain to the same
         mechanic his damage and speed already scale with, rather than
         leaving it the one flat stat on his sheet.
      */
      const pas = pl.def.passive
      const scale = pas.id === 'hotStreak'
        ? pl.streak / ((pas.maxStacks as number) ?? 12)
        : 1
      if (scale > 0) {
        this.player.hp = Math.min(
          this.player.stats.maxHp,
          this.player.hp + (dmg * s.lifestealPct * scale) / 100,
        )
      }
    }

    // Hitstop on crits only — on chaff it reads as lag (§11).
    if (isCrit) this.hitstop = C.hitstopSecondsOnCrit

    if (e.hp <= 0) this.killEnemy(index)
  }

  private killEnemy(index: number): void {
    const e = this.enemies.items[index]
    this.kills++
    // Every kill-driven class effect — Grit closing a wound, Hot Streak
    // stacking, a ward paying out — hangs off this one call, so the chain and
    // re-swing kills below feed them exactly as an ordinary kill does.
    this.player.onKill(e.x, e.y)
    const def = ENEMIES[e.typeId]

    // Blood Up (Barn Dog epic): every kill this wave counts, regardless of
    // what killed it — the dog is faster because the FIELD is bloody, not
    // because it personally made the kill.
    const bdSlot = this.player.weapons.find((w) => w.id === 'barnDog')
    if (bdSlot && hasMod(bdSlot, 'bloodUp')) this.bloodUpKillsThisWave++

    // The Reaper's Own: "what it kills, it keeps cutting." A melee kill swings
    // again through the same space for a fraction. Guarded by `chaining` too,
    // so a re-swing kill cannot re-swing — the same runaway the chain guard
    // exists to stop, and they share it because they are the same shape.
    const reap = this.specialItems.reswingDamageMultiplier
    if (reap > 0 && !this.chaining && e.lastHitMelee) {
      this.chaining = true
      this.areaDamage(e.x, e.y, 70, e.maxHp * reap, 'melee', 60)
      this.playFx('slash', e.x, e.y)
      this.chaining = false
    }

    // Threshing Floor: what dies in reach takes the next one with it. Splash is
    // NOT recursive — a chained kill does not chain again, or one dense wave
    // would cascade into a screen clear and the card would be a nuke rather
    // than a rider. Same reasoning as the Chili Shot's `burnGen` cap below.
    const chain = this.specialItems
    if (chain.chainRadius > 0 && chain.chainDamageMultiplier > 0 && !this.chaining) {
      this.chaining = true
      this.areaDamage(
        e.x, e.y, chain.chainRadius,
        e.maxHp * chain.chainDamageMultiplier, 'ranged', 0,
      )
      this.playFx('explosion', e.x, e.y)
      this.chaining = false
    }

    /*
       docs/UPGRADE_ROSTER.md batch 1, on the kill.

       Everything here is inside the SAME `chaining` re-entry guard the Reaper
       and the Threshing Floor share above, and for the same reason: a kill
       effect that can cause a kill that causes it again is a screen clear
       wearing a rider's clothes. The guard is one boolean and it is shared on
       purpose — these are all the same shape.
    */
    const b1 = this.specialItems
    if (!this.chaining) {
      this.chaining = true

      // H5 — Last Rites. A MARKED enemy that dies comes apart. The gate is the
      // mark, which is what ties it to Rock Salt, Quicklime and Weak Seam: three
      // different routes to the same condition, which is what a tag is for.
      if (b1.markedBurstPct > 0 && e.markLife > 0) {
        this.areaDamage(e.x, e.y, b1.markedBurstRadius, e.maxHp * (b1.markedBurstPct / 100), 'ranged', 0)
        this.playFx('explosion', e.x, e.y, 0, b1.markedBurstRadius / 70)
      }

      // H3 — Split Shot. Reuses the shard path the Drum Gun already flies, so
      // the split is pooled projectiles and not a new concept.
      if (b1.splitCount > 0 && !e.lastHitMelee) {
        this.splitFromCorpse(e.x, e.y, b1.splitCount, e.maxHp * b1.splitMul)
      }

      // H6 — the Tar Load leaves a slick where it kills, Rot Underfoot leaves
      // an acid pool on a fraction of kills. One `spawnHazard` each, off the
      // pool that already exists.
      if (b1.loadKillHazardKind !== '') {
        this.dropRiderHazard(
          b1.loadKillHazardKind, e.x, e.y, b1.loadKillHazardRadius,
          b1.loadKillHazardSeconds, 0, b1.loadKillHazardSlowPct,
        )
      }
      if (b1.killPoolChance > 0 && this.rng.chance(Math.min(1, b1.killPoolChance / 100))) {
        this.dropRiderHazard(
          b1.killPoolKind === '' ? 'acid' : b1.killPoolKind, e.x, e.y,
          b1.killPoolRadius, b1.killPoolSeconds, b1.killPoolDps, 0,
        )
      }

      // Batch 2, Straw Chopper: the Combine Head's OWN kills leave stubble
      // burning behind them. Gated on `lastHitWeaponId` rather than a
      // player-wide flag — a different weapon's kill must not trigger it.
      if (e.lastHitWeaponId === 'combineHead') {
        const chSlot = this.player.weapons.find((w) => w.id === 'combineHead')
        if (chSlot && hasMod(chSlot, 'strawChopper')) {
          const chDef = WEAPONS.combineHead
          this.dropRiderHazard(
            'damage', e.x, e.y,
            typeof chDef?.strawChopperRadius === 'number' ? chDef.strawChopperRadius : 40,
            typeof chDef?.strawChopperSeconds === 'number' ? chDef.strawChopperSeconds : 3,
            typeof chDef?.strawChopperDps === 'number' ? chDef.strawChopperDps : 10,
            0,
          )
        }
      }

      /*
         H13 — Volunteer Strain (The Agronomist, epic): a kill that dies
         carrying 2+ statuses spreads them to nearby survivors. `>= 2` is
         hardcoded rather than a content field for the same reason
         Cross-Contamination's own gate above is — it is the card's own
         stated trigger, not a tunable magnitude. Reuses `queryOut`; nothing
         between this query and the end of its loop reads it again, the same
         discipline `areaDamage` and the blocks above already keep.
      */
      const cb = this.player.classBonus
      if (cb.cultivarSpreadCount > 0 && this.statusCount(e) >= 2) {
        const n = this.grid.query(e.x, e.y, cb.cultivarSpreadRadius, this.queryOut)
        let spread = 0
        for (let k = 0; k < n && spread < cb.cultivarSpreadCount; k++) {
          const j = this.queryOut[k]
          if (j === index || j >= this.enemies.live) continue
          const t = this.enemies.items[j]
          if (t.dying > 0) continue
          if (e.burnLife > 0) {
            t.burnDps = Math.max(t.burnDps, e.burnDps)
            t.burnLife = Math.max(t.burnLife, e.burnLife)
          }
          if (e.bleedLife > 0) {
            t.bleedDps = Math.max(t.bleedDps, e.bleedDps)
            t.bleedLife = Math.max(t.bleedLife, e.bleedLife)
          }
          if (e.slowLife > 0) {
            t.slowPct = Math.max(t.slowPct, e.slowPct)
            t.slowLife = Math.max(t.slowLife, e.slowLife)
          }
          if (e.markLife > 0) {
            t.markPct = Math.max(t.markPct, e.markPct)
            t.markLife = Math.max(t.markLife, e.markLife)
          }
          spread++
        }
      }

      this.chaining = false
    }

    // H11 — what a kill pays out. Outside the guard: none of these can kill,
    // so none of them can recurse.
    if (b1.killHeal > 0 && this.player.alive) {
      this.player.hp = Math.min(this.player.stats.maxHp, this.player.hp + b1.killHeal)
    }
    if (b1.killDropChance > 0 && this.rng.chance(Math.min(1, b1.killDropChance / 100))) {
      const tok = this.pickups.acquire()
      if (tok) {
        tok.kind = 'feed'
        tok.x = e.x
        tok.y = e.y
        tok.px = tok.x
        tok.py = tok.y
        tok.value = b1.killDropValue
        tok.magnetised = false
        tok.speed = 0
        tok.bob = 0
      }
    }
    if (b1.killSpawnEvery > 0) {
      this.hatchAcc++
      if (this.hatchAcc >= b1.killSpawnEvery) {
        this.hatchAcc = 0
        this.hatchChick(e.x, e.y)
      }
    }

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

    const isBoss = ENEMIES[e.typeId]?.boss === true
    if (isBoss) this.bossKills++
    this.sound(isBoss ? 'bossDeath' : 'enemyDeath')
    this.bleed(e.x, e.y, e.typeId === 'rooster' ? 2 : 10)
    /*
       How long the corpse stays before its slot is freed.

       The default is the 0.2s spin-and-scale-to-zero that stood in for death
       art (§10 step 4). The generated animals HAVE death art now — nine frames
       in eight directions each — and it cannot read in 200ms, so those species
       carry their own `deathSeconds` in content.

       It is per-enemy rather than global on purpose: a bullet-heaven kills
       hundreds of things a run, and holding every corpse for half a second is a
       change to how cluttered the screen gets and to how hard the enemy pool is
       pushed. Species with real death art earn the extra time; a rooster that
       still pops does not need it.
    */
    e.dying = (ENEMIES[e.typeId] as { deathSeconds?: number } | undefined)?.deathSeconds
      ?? C.deathSpinSeconds
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
    // Oilcloth (batch 3, body): hazards specifically do less. Contact damage
    // is untouched — the card's own words are "hazards", not "everything".
    if (environmental && this.specialItems.hazardReductionPct > 0) {
      dmg *= 1 - this.specialItems.hazardReductionPct / 100
    }
    dmg = dmg * (1 - p.stats.armor / (p.stats.armor + C.armorConstant))

    const taken = Math.max(environmental ? 0 : 1, dmg)
    /*
       Grit splits the blow: part lands now, the rest is banked as a wound that
       bleeds off over seconds and that killing cancels. `takeWound` returns the
       amount unchanged for every other class, so this line is arithmetically
       what it always was for the other five.

       The BOOKKEEPING is deliberately not split. `damageTakenFromContact` is a
       measure of what the field threw at the player, not of what the health bar
       eventually lost, and the balance harness reads it to compare classes —
       netting a wound the player then cancelled would make The Widow look like
       she was being hit less rather than paying for it differently.

       H9 (batch 3) joins the same philosophy: `taken` below still measures
       what the field threw, and the shield absorbs out of a separate `landed`
       variable — the amount that actually reaches `takeWound` and the health
       bar. A shielded hit still counts as damage taken for the balance
       harness; it just never costs HP.
    */
    let landed = taken
    if (this.playerShield > 0 && landed > 0) {
      const absorbed = Math.min(this.playerShield, landed)
      this.playerShield -= absorbed
      landed -= absorbed
    }
    p.hp -= p.takeWound(landed)
    if (landed > 0) p.onHurt()
    if (!environmental) this.sound('playerHurt')
    if (environmental) this.damageTakenFromHazards += taken
    else {
      this.damageTakenFromContact += taken
      p.invuln = P.invulnSecondsAfterHit
    }
    this.addShake(T.camera.traumaPlayerHit)

    /*
       H10 — Second Wind. Checked after the hit lands rather than before it is
       computed, so a revive is spent on the actual killing blow and not on a
       hit that the shield or armour would have survived anyway.
    */
    if (p.hp <= 0 && p.revivesLeft > 0) {
      p.revivesLeft--
      p.hp = Math.max(1, p.stats.maxHp * (this.specialItems.reviveHpPct / 100))
      this.areaDamage(
        p.x, p.y, this.specialItems.reviveClearRadius, C.reviveClearDamage,
        'melee', C.reviveClearKnockback, C.reviveClearStunSeconds,
      )
      this.playFx('bigImpact', p.x, p.y - 12)
      this.sound('crit')
      this.addShake(T.camera.traumaPlayerHit * 2)
    }
  }

  areaDamage(
    x: number, y: number, radius: number, amount: number,
    type: 'melee' | 'ranged', knockback: number, stun = 0,
    // Batch 2, Cracked Bell: an AoE that also slows. Defaulted to 0 so every
    // existing call site — there were none that needed it before this card —
    // is arithmetically unchanged.
    slowPct = 0, slowSeconds = 0,
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
        // Windbreak (batch 3): every AoE the player's own weapons and items
        // cause routes through here, so the bonus applies once, centrally,
        // rather than at each of `areaDamage`'s callers.
        const kb = knockback * this.knockbackMul
        e.kx += (dx / d) * kb
        e.ky += (dy / d) * kb
      }
      if (stun > 0 && e.active) e.stun = Math.max(e.stun, stun * this.specialItems.stunMultiplier)
      if (slowPct > 0 && e.active) {
        if (slowPct > e.slowPct) e.slowPct = slowPct
        if (slowSeconds > e.slowLife) e.slowLife = slowSeconds
      }
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
  /**
   * The element-coloured variant of an FX clip, or the clip itself under None.
   *
   * "Adding a fire upgrade or an acid bullet upgrade changed nothing" was half
   * about the bullet and half about this: Fire swapped to a bigger impact, but
   * Acid and Frost both left the same orange spark, so two of the three
   * elements changed nothing at the moment of contact — the moment you are
   * actually looking at. Every impact clip is packed in all three colours, so
   * the suffix always resolves.
   */
  elementalFx(clip: string): keyof typeof T.fx & string {
    const el = this.player.element
    return (el === 'none' ? clip : `${clip}.${el}`) as keyof typeof T.fx & string
  }

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
  /**
   * The two specials that act on the world every tick rather than on an event.
   *
   * Both are rate-limited rather than continuous: a gas puddle every 0.35s
   * instead of one per frame, and a salt ring that only bites an enemy on the
   * frame it crosses the line. Continuous versions of either would allocate
   * hazards at 60Hz and melt the pool.
   */
  private updatePlayerSpecials(dt: number): void {
    const sp = this.specialItems
    const pl = this.player

    if (sp.trailGasDps > 0) {
      this.trailAcc -= dt
      if (this.trailAcc <= 0) {
        this.trailAcc = 0.35
        this.dropGasStrip(pl.x, pl.y, sp.trailGasRadius, 2.4, sp.trailGasDps)
      }
    }

    if (sp.saltRingRadius > 0 && sp.saltRingDamage > 0) {
      const r = sp.saltRingRadius
      const inner = r - 14
      for (let i = 0; i < this.enemies.live; i++) {
        const e = this.enemies.items[i]
        if (e.dying > 0) continue
        const dx = e.x - pl.x
        const dy = e.y - pl.y
        const d2 = dx * dx + dy * dy
        const onLine = d2 <= r * r && d2 >= inner * inner
        // `saltMark` latches so an enemy loitering on the line is hit once per
        // crossing, not once per frame. "Nothing crosses it twice."
        if (onLine && e.saltMark <= 0) {
          e.saltMark = 1
          this.damageEnemy(i, sp.saltRingDamage, 'ranged', false)
          if (sp.saltRingSlowPct > 0) e.slowPct = Math.max(e.slowPct, sp.saltRingSlowPct)
          this.playFx('arrowImpact', e.x, e.y - e.radius * 0.4)
        } else if (!onLine && e.saltMark > 0) {
          e.saltMark = 0
        }
      }
    }
  }

  /** Second Cutting's extra blade damage fraction; 0 when not owned. */
  get scytheSecondBlade(): number { return this.specialItems.scytheSecondBlade }

  /**
   * The Whitacre Bull: a permanent minion that charges on a cooldown.
   *
   * Kept as a projectile of type `minion`, exactly like the Barn Dog, rather
   * than as an enemy on the player's side — the minion path already has
   * steering, a bite rate-limit and pooled lifetime, and an "enemy that is
   * friendly" would need every one of those written again with the factions
   * inverted.
   */
  private updateBull(dt: number): void {
    const def = ITEMS.whitacreBull as unknown as Record<string, unknown> | undefined
    const owned = this.player.items.find((o) => o.id === 'whitacreBull')
    if (!def || !owned) return

    let p = this.findAttached('whitacreBull', 0)
    if (!p) {
      p = this.spawnProjectile()
      if (!p) return
      p.weaponId = 'whitacreBull'
      p.type = 'minion'
      p.behaviour = 'minionHunt'
      p.attached = false
      p.x = this.player.x
      p.y = this.player.y
      p.px = p.x
      p.py = p.y
      p.t1 = 0
      p.radius = 20
      p.pierce = 999
      p.hitStamp = this.tick
      p.rearm = 0
    }
    const charge = typeof def.chargeDamage === 'number' ? def.chargeDamage : 90
    const cd = typeof def.chargeCooldown === 'number' ? def.chargeCooldown : 9
    p.life = 1.2
    p.damage = charge * (owned.boosted ? 2 : 1)
    // Same fields the Barn Dog uses: `angularVelocity` is the steer-toward
    // speed and `t0` the leash. A bull is slower than a dog and ranges wider.
    p.angularVelocity = 190
    p.t0 = 520
    p.knockback = 220
    // The charge IS the bite interval. A bull that hits for 90 once every nine
    // seconds is a charge, and it costs no new steering code or state machine.
    p.rearm = Math.max(p.rearm, 0)
    if (p.rearm <= 0) {
      p.rearm = cd
      p.hitStamp = this.tick
      p.hitsLeft = 1
    } else {
      p.rearm -= dt
    }
  }

  /**
   * H8 (docs/UPGRADE_ROSTER.md batch 3) — Scarecrow Post.
   *
   * One `attached` `'placeable'` projectile per stack, keyed by
   * `findAttached('scarecrowPost', i)` exactly the way the Bull is keyed by
   * its own weapon id. `pierce = -1` opts it OUT of `collideProjectiles`
   * entirely (the same escape hatch `arcLob` uses to detonate on expiry
   * rather than on contact) — its damage is a deliberate `areaDamage` pulse
   * on its own cooldown, not a touch hitbox, because 190px is a RANGE, not a
   * post's physical size. `turretLife` (25s) is not refreshed after spawn, so
   * a turret times out and the next call replants a fresh one at wherever the
   * player then is — "one per stack" that follows the fight instead of being
   * abandoned behind it.
   */
  private updateTurrets(dt: number): void {
    const s = this.specialItems
    const count = Math.min(s.turretCount, this.turretCd.length)
    for (let i = 0; i < count; i++) {
      let p = this.findAttached('scarecrowPost', i)
      if (!p) {
        p = this.spawnProjectile()
        if (!p) continue
        p.weaponId = 'scarecrowPost'
        p.type = 'placeable'
        p.behaviour = 'turret'
        p.attached = true
        p.x = this.player.x
        p.y = this.player.y
        p.px = p.x
        p.py = p.y
        p.t1 = i
        p.radius = 16
        p.pierce = -1
        p.knockback = 0
        p.life = s.turretLife
        this.turretCd[i] = 0
      }
      this.turretCd[i] -= dt
      if (this.turretCd[i] <= 0) {
        this.turretCd[i] = s.turretCooldown
        this.areaDamage(p.x, p.y, s.turretRange, s.turretDamage, 'ranged', 30)
        this.playFx('arrowImpact', p.x, p.y, 0, 0.6)
      }
    }
  }

  /**
   * H8 — Bear Trap.
   *
   * Traps are consumed rather than persistent: each is `attached` (so it
   * never moves and `collideProjectiles`' pierce-based free never applies to
   * it) but carries a real `hitStamp` and `hitsLeft: 1`, so the FIRST enemy
   * that overlaps it triggers `applyHit` exactly once — `collideProjectiles`
   * itself frees it the same tick (see the `trapField` branch added there).
   * `trapMax` counts live traps, not copies of the card, so a run with two
   * stacks still only ever has two traps on the ground — one more than a run
   * with one — waiting to be stepped on.
   */
  private updateBearTraps(dt: number): void {
    const s = this.specialItems
    this.trapCd -= dt
    if (this.trapCd > 0) return
    let live = 0
    for (let i = 0; i < this.projectiles.live; i++) {
      if (this.projectiles.items[i].weaponId === 'bearTrap') live++
    }
    if (live >= s.trapMax) return
    this.trapCd = s.trapSpawnSeconds
    const p = this.spawnProjectile()
    if (!p) return
    p.weaponId = 'bearTrap'
    p.type = 'placeable'
    p.behaviour = 'trapField'
    p.attached = true
    // Dropped a short walk from the player, never underfoot — the hand that
    // just set it should not be the first thing that finds it.
    const a = this.rng.range(0, Math.PI * 2)
    const d = this.rng.range(40, 90)
    p.x = this.player.x + Math.cos(a) * d
    p.y = this.player.y + Math.sin(a) * d
    p.px = p.x
    p.py = p.y
    p.radius = 14
    p.damage = s.trapDamage
    p.stunOnHit = s.trapStunSeconds
    p.hitStamp = this.tick
    p.hitsLeft = 1
    p.pierce = 0
    p.knockback = 0
    p.life = 999 // freed by the trigger (collideProjectiles), not by time
  }

  /**
   * H8 — Hen Coop.
   *
   * The coop itself is a permanent `attached` `'placeable'` base, one per
   * stack, that pays no damage of its own (`pierce = -1`, same reasoning as
   * the Scarecrow Post) and instead spawns a hen on its own cooldown. The hen
   * is a SEPARATE, unattached projectile — `spawnHen` below — so `henCoop`
   * names two different live shapes and `findAttached` must never confuse
   * them; the hen's `t1 = -1` guarantees it can never match a coop-base key
   * (0 or 1), which `findAttached` searches by weaponId AND t1 together.
   */
  private updateCoop(dt: number): void {
    const s = this.specialItems
    const count = Math.min(s.coopCount, this.coopCd.length)
    for (let i = 0; i < count; i++) {
      let p = this.findAttached('henCoop', i)
      if (!p) {
        p = this.spawnProjectile()
        if (!p) continue
        p.weaponId = 'henCoop'
        p.type = 'placeable'
        p.behaviour = 'coopBase'
        p.attached = true
        p.x = this.player.x
        p.y = this.player.y
        p.px = p.x
        p.py = p.y
        p.t1 = i
        p.radius = 16
        p.pierce = -1
        p.knockback = 0
        p.life = 1e6 // permanent, like the coop it represents
        this.coopCd[i] = 0
      }
      this.coopCd[i] -= dt
      if (this.coopCd[i] <= 0) {
        this.coopCd[i] = s.henCooldown
        this.spawnHen(p.x, p.y)
      }
    }
  }

  /** The Hen Coop's own payout: a hen that dies on its first contact. Type
   *  `'placeable'` rather than `'minion'` is what MAKES it die on contact —
   *  see the doc comment on `Projectile.type` in entities.ts. */
  private spawnHen(x: number, y: number): void {
    const s = this.specialItems
    const p = this.spawnProjectile()
    if (!p) return
    p.weaponId = 'henCoop'
    p.type = 'placeable'
    p.behaviour = 'minionHunt'
    p.attached = false
    p.x = x
    p.y = y
    p.px = x
    p.py = y
    p.t1 = -1
    p.radius = 8
    p.pierce = 0
    p.hitStamp = -1
    p.damage = s.henDamage
    p.knockback = 20
    p.angularVelocity = 260
    p.t0 = 900 // leash: generous, so a hen sent out does not snap back mid-flight
    p.life = 8
  }

  /**
   * H8 — Trip Wire.
   *
   * Not a projectile at all: a taut line has no natural circular hitbox, so
   * this is a direct per-tick crossing check between the player and the
   * nearest harvestable prop — the same shape Salt Circle's ring already
   * uses (`updatePlayerSpecials`), generalised from a circle's boundary to a
   * line segment. `wireMark` latches per enemy so standing on the line bites
   * once per crossing, not once per frame; it is its OWN field on `Enemy`
   * rather than reusing `saltMark`, because a run can own both hazards at
   * once and a shared latch would let one silently arm or disarm the other.
   */
  private updateTripWire(): void {
    const s = this.specialItems
    const pl = this.player
    let best = -1
    let bestD2 = s.wireMaxRange * s.wireMaxRange
    for (let i = 0; i < this.props.live; i++) {
      const pr = this.props.items[i]
      if (pr.dying > 0) continue
      const dx = pr.x - pl.x
      const dy = pr.y - pl.y
      const d2 = dx * dx + dy * dy
      if (d2 < bestD2) { bestD2 = d2; best = i }
    }
    if (best < 0) return
    const pr = this.props.items[best]
    const x0 = pl.x
    const y0 = pl.y
    const sx = pr.x - x0
    const sy = pr.y - y0
    const len2 = sx * sx + sy * sy
    const bandR = 10
    const n = this.grid.query(
      x0 + sx / 2, y0 + sy / 2, Math.sqrt(len2) / 2 + bandR, this.queryOut,
    )
    for (let k = 0; k < n; k++) {
      const j = this.queryOut[k]
      if (j >= this.enemies.live) continue
      const e = this.enemies.items[j]
      if (e.dying > 0) continue
      const t = len2 > 0
        ? Math.max(0, Math.min(1, ((e.x - x0) * sx + (e.y - y0) * sy) / len2))
        : 0
      const cx = x0 + sx * t
      const cy = y0 + sy * t
      const dx = e.x - cx
      const dy = e.y - cy
      const reach = bandR + e.radius
      const onLine = dx * dx + dy * dy <= reach * reach
      if (onLine && e.wireMark <= 0) {
        e.wireMark = 1
        this.damageEnemy(j, s.wireDamage, 'melee', false)
        if (!e.knockbackImmune) e.stun = Math.max(e.stun, s.wireStunSeconds)
        this.playFx('arrowImpact', e.x, e.y - e.radius * 0.4)
      } else if (!onLine && e.wireMark > 0) {
        e.wireMark = 0
      }
    }
  }

  /**
   * Yard Goose: a second, independent chase-and-bite minion on the Bull's own
   * pattern — see `updateBull`'s doc comment for why a friendly rides the
   * minion path rather than an inverted enemy. Its bite cadence is subject to
   * the same generic `minionHunt` re-arm the Bull already lives with (the
   * integrate step's own steering block re-arms any unattached `minionHunt`
   * projectile off `WEAPONS[p.weaponId]?.biteInterval`, which is `undefined`
   * for an item-granted minion and falls back to 0.5s) — noted, not fixed
   * here, because fixing it touches the Bull and the Dog too and is out of
   * this batch's scope.
   */
  private updateGoose(dt: number): void {
    const s = this.specialItems
    let p = this.findAttached('yardGoose', 0)
    if (!p) {
      p = this.spawnProjectile()
      if (!p) return
      p.weaponId = 'yardGoose'
      p.type = 'minion'
      p.behaviour = 'minionHunt'
      p.attached = false
      p.x = this.player.x
      p.y = this.player.y
      p.px = p.x
      p.py = p.y
      p.t1 = 0
      p.radius = 10
      p.pierce = 999
      p.hitStamp = this.tick
      p.rearm = 0
    }
    p.life = 1.2
    p.damage = s.gooseDamage
    p.angularVelocity = 220
    p.t0 = 420
    p.knockback = s.gooseKnockback
    p.rearm = Math.max(p.rearm, 0)
    if (p.rearm <= 0) {
      p.rearm = s.gooseCooldown
      p.hitStamp = this.tick
      p.hitsLeft = 999
    } else {
      p.rearm -= dt
    }
  }

  refreshSpecialItems(): void {
    const s = this.specialItems
    s.reflect = 0
    s.auraRadius = 0
    s.auraReduction = 0
    s.stunMultiplier = 1
    s.scytheSecondBlade = 0
    s.chainRadius = 0
    s.chainDamageMultiplier = 0
    s.trailGasDps = 0
    s.trailGasRadius = 0
    s.touchStunSeconds = 0
    s.touchStunCooldown = 0
    s.gasImmune = false
    s.reswingDamageMultiplier = 0
    s.saltRingRadius = 0
    s.saltRingDamage = 0
    s.saltRingSlowPct = 0

    s.anyOnHitRider = false
    s.chainCount = 0; s.chainRange = 0; s.chainMul = 0
    s.ricochetCount = 0; s.ricochetRange = 0; s.ricochetMul = 0
    s.splitCount = 0; s.splitMul = 0
    s.homingRate = 0
    s.burstChance = 0; s.burstRadius = 0; s.burstMul = 0
    s.markedBurstPct = 0; s.markedBurstRadius = 0
    s.hitHazardKind = ''; s.hitHazardRadius = 0; s.hitHazardSeconds = 0; s.hitHazardDps = 0
    s.loadKillHazardKind = ''; s.loadKillHazardRadius = 0
    s.loadKillHazardSeconds = 0; s.loadKillHazardSlowPct = 0
    s.killPoolChance = 0; s.killPoolKind = ''; s.killPoolRadius = 0
    s.killPoolSeconds = 0; s.killPoolDps = 0
    s.killDropChance = 0; s.killDropValue = 0; s.killHeal = 0
    s.killSpawnEvery = 0; s.killSpawnDamage = 0; s.killSpawnSeconds = 0
    s.killSpawnMax = 0; s.killSpawnSprite = ''
    s.extraPierce = 0; s.projectileRadiusPct = 0
    s.critMarkPct = 0; s.critMarkSeconds = 0
    s.loadDamagePct = 0; s.loadBonusSeconds = 0
    s.slickDamagePct = 0; s.crossMarkPct = 0

    // --- batch 3 -----------------------------------------------------------
    s.turretDamage = 0; s.turretCooldown = 0; s.turretRange = 0
    s.turretLife = 0; s.turretCount = 0
    s.trapDamage = 0; s.trapStunSeconds = 0; s.trapSpawnSeconds = 0; s.trapMax = 0
    s.henDamage = 0; s.henCooldown = 0; s.coopCount = 0
    s.wireDamage = 0; s.wireStunSeconds = 0; s.wireMaxRange = 0
    s.gooseDamage = 0; s.gooseKnockback = 0; s.gooseCooldown = 0; s.hasGoose = false
    s.hasLittermate = false; s.littermateDamagePct = 0
    s.shieldHp = 0
    s.revives = 0; s.reviveHpPct = 0; s.reviveClearRadius = 0
    s.touchSlowPct = 0; s.touchSlowSeconds = 0
    s.hazardReductionPct = 0
    s.knockbackBonusPct = 0; s.collideDamage = 0

    // --- batch 5 -------------------------------------------------------
    s.interestCapBonus = 0; s.interestPctBonus = 0
    s.feedBonusFlat = 0

    const num = (d: Record<string, unknown>, k: string, f = 0): number =>
      typeof d[k] === 'number' ? (d[k] as number) : f

    /*
       The ACTIVE Load's own riders, read off `elements.json` and not off the
       item that granted it.

       A Load is exclusive — taking one replaces the last — but the ITEM stays
       in `player.items` forever. Reading a chain or a corpse-slick off the
       item would keep it firing long after its Load had been swapped away, so
       the six new Loads carry their riders on the element and exactly one
       Load's worth is ever live. See `elements.json` `_riderNote`.
    */
    const load = ELEMENTS[this.player.element] as Record<string, unknown> | undefined
    if (load) {
      s.chainCount = num(load, 'chainCount')
      s.chainRange = num(load, 'chainRange', 120)
      s.chainMul = num(load, 'chainMul', 0.45)
      s.hitHazardKind = (load.hitHazardKind as HazardKind | undefined) ?? ''
      s.hitHazardRadius = num(load, 'hitHazardRadius', 34)
      s.hitHazardSeconds = num(load, 'hitHazardSeconds', 3)
      s.hitHazardDps = num(load, 'hitHazardDps', 10)
      s.loadKillHazardKind = (load.killHazardKind as HazardKind | undefined) ?? ''
      s.loadKillHazardRadius = num(load, 'killHazardRadius', 46)
      s.loadKillHazardSeconds = num(load, 'killHazardSeconds', 4)
      s.loadKillHazardSlowPct = num(load, 'killHazardSlowPct', 40)
      s.killHeal += num(load, 'killHeal')
    }

    for (const owned of this.player.items) {
      const def = ITEMS[owned.id] as unknown as Record<string, unknown> | undefined
      if (!def?.special) continue
      // A boosted copy is the rarity roll paying out, so it doubles the payload
      // — but never a duration or a radius, which would stack into nonsense.
      const mult = owned.boosted ? 2 : 1
      switch (def.special) {
        case 'reflect': s.reflect += num(def, 'reflectDamage') * mult; break
        case 'auraDamageReduction':
          s.auraRadius = num(def, 'radius', 60)
          s.auraReduction += num(def, 'reductionPct') * mult
          break
        case 'stunMultiplier':
          s.stunMultiplier = Math.max(s.stunMultiplier, num(def, 'stunMultiplier', 1))
          break
        case 'scytheSecondBlade':
          s.scytheSecondBlade = num(def, 'bladeDamageMultiplier') * mult
          break
        case 'chainOnKill':
          s.chainRadius = num(def, 'chainRadius')
          s.chainDamageMultiplier += num(def, 'chainDamageMultiplier') * mult
          break
        case 'trailGas':
          s.trailGasDps += num(def, 'dps') * mult
          s.trailGasRadius = num(def, 'radius', 70)
          break
        case 'touchStun':
          s.touchStunSeconds = num(def, 'stunSeconds')
          s.touchStunCooldown = num(def, 'perEnemyCooldown', 8)
          break
        case 'gasImmune': s.gasImmune = true; break
        case 'pierceAllAndReswing':
          s.reswingDamageMultiplier = num(def, 'reswingDamageMultiplier') * mult
          break
        case 'saltRing':
          s.saltRingRadius = num(def, 'radius', 160)
          s.saltRingDamage += num(def, 'damage') * mult
          s.saltRingSlowPct = num(def, 'slowPct')
          break
        case 'firstHitShield':
          // Sunday Best. H9's generalisation: it used to block and counter
          // the wave's first hit outright; now it is 200 points of the same
          // shield pool Fence Row pays into, refilled every wave complete.
          s.shieldHp += num(def, 'returnDamage') * mult
          break

        // --- batch 1. Radii, ranges and durations are set rather than
        // summed, exactly as the block above does it: a boosted copy doubles
        // a payload and never a distance or a time, which stack into nonsense.
        case 'ricochet':
          s.ricochetCount += num(def, 'ricochetCount', 1) * mult
          s.ricochetRange = num(def, 'ricochetRange', 150)
          s.ricochetMul = num(def, 'ricochetMul', 0.6)
          break
        case 'splitOnKill':
          s.splitCount += num(def, 'splitCount', 2) * mult
          s.splitMul = num(def, 'splitMul', 0.45)
          break
        case 'homing':
          s.homingRate += num(def, 'homingRate', 100) * mult
          break
        case 'burstOnHit':
          s.burstChance += num(def, 'burstChance', 15) * mult
          s.burstRadius = num(def, 'burstRadius', 52)
          s.burstMul = num(def, 'burstMul', 0.55)
          break
        case 'markedBurst':
          s.markedBurstPct += num(def, 'burstPct', 40) * mult
          s.markedBurstRadius = num(def, 'burstRadius', 70)
          break
        case 'killPool':
          s.killPoolChance += num(def, 'killPoolChance', 25) * mult
          s.killPoolKind = (def.killPoolKind as HazardKind | undefined) ?? 'acid'
          s.killPoolRadius = num(def, 'killPoolRadius', 42)
          s.killPoolSeconds = num(def, 'killPoolSeconds', 3)
          s.killPoolDps = num(def, 'killPoolDps', 14)
          break
        case 'killDrop':
          s.killDropChance += num(def, 'killDropChance', 15) * mult
          s.killDropValue = num(def, 'killDropValue', 1)
          break
        case 'killHeal':
          s.killHeal += num(def, 'killHeal', 1.2) * mult
          break
        case 'killHatch':
          // Every stack is one more live chick, not a faster hatch: two hens
          // that each halved the interval would be four times the chicks.
          s.killSpawnEvery = num(def, 'killSpawnEvery', 12)
          s.killSpawnDamage = num(def, 'chickDamage', 9)
          s.killSpawnSeconds = num(def, 'chickSeconds', 8)
          s.killSpawnMax += mult
          s.killSpawnSprite = typeof def.minionSprite === 'string' ? def.minionSprite : ''
          break
        case 'extraPierce':
          s.extraPierce += num(def, 'extraPierce', 1) * mult
          break
        case 'projectileRadius':
          s.projectileRadiusPct += num(def, 'projectileRadiusPct', 12) * mult
          break
        case 'critMark':
          s.critMarkPct += num(def, 'critMarkPct', 20) * mult
          s.critMarkSeconds = num(def, 'critMarkSeconds', 3)
          break
        case 'loadPotency':
          s.loadDamagePct += num(def, 'dotDamagePct', 25) * mult
          break
        case 'loadDuration':
          s.loadBonusSeconds += num(def, 'loadBonusSeconds', 1.5) * mult
          break
        case 'slickPotency':
          s.slickDamagePct += num(def, 'slickDamagePct', 100) * mult
          break
        case 'crossContamination':
          s.crossMarkPct += num(def, 'crossMarkPct', 30) * mult
          break

        // --- batch 3 (docs/UPGRADE_ROSTER.md), H8: Allies & Placeables -----
        // Damage/cooldown/range fields are SET, not summed — one turret's own
        // payload never changes with the number of turrets. `*Count`/`*Max`
        // sum `mult` exactly like `killSpawnMax` above: a boosted copy is one
        // more live instance, never a stronger one.
        case 'turret':
          s.turretDamage = num(def, 'turretDamage', 9)
          s.turretCooldown = num(def, 'turretCooldown', 1.2)
          s.turretRange = num(def, 'turretRange', 190)
          s.turretLife = num(def, 'turretLife', 25)
          s.turretCount += mult
          break
        case 'trapField':
          s.trapDamage = num(def, 'trapDamage', 45)
          s.trapStunSeconds = num(def, 'trapStunSeconds', 1.5)
          s.trapSpawnSeconds = num(def, 'trapSpawnSeconds', 5)
          s.trapMax += mult
          break
        case 'coop':
          s.henDamage = num(def, 'henDamage', 7)
          s.henCooldown = num(def, 'henCooldown', 6)
          s.coopCount += mult
          break
        // Trip Wire's damage is the one payload in this group that DOES sum:
        // each stack is a redundant strand on the same wire, so more stacks
        // means a harder crossing rather than a second wire (§6's table gives
        // it no count to grow).
        case 'tripWireRider':
          s.wireDamage += num(def, 'wireDamagePer', 28) * mult
          s.wireStunSeconds = num(def, 'wireStunSeconds', 0.5)
          s.wireMaxRange = num(def, 'wireMaxRange', 260)
          break
        case 'gooseMinion':
          s.gooseDamage = num(def, 'gooseDamage', 14)
          s.gooseKnockback = num(def, 'gooseKnockback', 180)
          s.gooseCooldown = num(def, 'gooseCooldown', 0.6)
          s.hasGoose = true
          break
        // Littermate is a flag read by `minionHunt` in behaviours/weapons.ts,
        // beside its own `hasMod` checks — no state lives here to flatten
        // beyond "is it owned", the same shape `gasImmune` already has.
        case 'secondDog':
          s.hasLittermate = true
          s.littermateDamagePct = num(def, 'littermateDamagePct', 80)
          break

        // H9 — the shield. Fence Row sums into the same capacity Sunday
        // Best's `firstHitShield` case (above) now feeds.
        case 'shieldPerWave':
          s.shieldHp += num(def, 'shieldAmount', 25) * mult
          break
        // H10 — Second Wind. `revives` sums (a boosted copy is two charges);
        // `player.revivesLeft` is topped up from it once, after this loop,
        // alongside the shield — see the comment there.
        case 'revive':
          s.revives += mult
          s.reviveHpPct = num(def, 'reviveHpPct', 40)
          s.reviveClearRadius = num(def, 'reviveClearRadius', 200)
          break

        // Body cards with no new hook beyond a flattened field — §8's list.
        case 'touchSlow':
          s.touchSlowPct += num(def, 'touchSlowPct', 35) * mult
          s.touchSlowSeconds = num(def, 'touchSlowSeconds', 1)
          break
        case 'hazardResist':
          s.hazardReductionPct = Math.min(
            80, s.hazardReductionPct + num(def, 'hazardReductionPct', 40) * mult,
          )
          break
        case 'windbreak':
          s.knockbackBonusPct += num(def, 'knockbackBonusPct', 40) * mult
          s.collideDamage = num(def, 'collideDamage', 12)
          break

        // --- batch 5 (docs/UPGRADE_ROSTER.md), Field & Ledger --------------
        // Ledger Book: interest cap and rate, summed per stack like every
        // other flat bonus here. `interestFor` below is what actually reads
        // these; `formulas.ts`'s `interestOn` stays the content-documented
        // base for a run that owns none of it.
        case 'ledgerInterest':
          s.interestCapBonus += num(def, 'interestCapBonus', 6) * mult
          s.interestPctBonus += num(def, 'interestPctBonus', 1.5) * mult
          break
        // Early Bird: every feed pickup is worth more, whatever spawned it —
        // read once at the single collection site in `collect()`.
        case 'feedBonus':
          s.feedBonusFlat += num(def, 'feedBonusPerStack', 1) * mult
          break

        default: break // bullMinion is spawned, not flattened; see summonFor
      }
    }

    // §8: one cached boolean, so a run owning none of these pays a single
    // compare per hit rather than eleven.
    s.anyOnHitRider = s.chainCount > 0 || s.ricochetCount > 0 || s.burstChance > 0
      || s.hitHazardKind !== ''

    /*
       H9/H10: topped UP, never assigned outright, and never reset in the loop
       above — both persist across a build change exactly the way
       `shieldReady` did before this batch. A shield or a revive spent earlier
       this run comes back the moment the run buys anything else, gated only
       by the run actually owning the card (`shieldHp`/`revives` are 0 for a
       run that does not, so `Math.max` is a no-op for the other five sixths
       of the roster and every run that owns neither of these two cards).
    */
    if (s.shieldHp > 0) this.playerShield = Math.max(this.playerShield, s.shieldHp)
    if (s.revives > 0) this.player.revivesLeft = Math.max(this.player.revivesLeft, s.revives)
  }

  // ------------------------------------------------------------- queries

  /** Nearest breakable, or -1. Only ever called when no enemy is in range. */
  findNearestBreakable(x: number, y: number, maxRange: number): number {
    let best = -1
    let bestD2 = maxRange * maxRange
    for (let i = 0; i < this.breakables.live; i++) {
      const b = this.breakables.items[i]
      if (b.dying > 0) continue
      const dx = b.x - x
      const dy = b.y - y
      const d2 = dx * dx + dy * dy
      if (d2 < bestD2) {
        bestD2 = d2
        best = i
      }
    }
    return best
  }

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
