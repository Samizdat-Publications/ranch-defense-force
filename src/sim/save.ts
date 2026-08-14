/**
 * The Homestead save: one versioned JSON blob in localStorage.
 *
 * Stores **purchases, never derived values** (§4). What a rank of Feed Store
 * grain is worth is a number in `meta.json` that will change; what the player
 * bought will not. Recomputing at run start means rebalancing the meta never
 * requires touching a save, and never silently makes an old save wrong.
 *
 * Every read goes through `load()`, which migrates, validates and clamps. A
 * corrupt or hand-edited blob yields a fresh save rather than an exception —
 * losing progress is bad, but a save that throws on boot means the game will
 * not start at all, which is worse and unrecoverable without devtools.
 */
import { META } from '../content'

/** Bumped whenever the shape changes. `migrate` must handle every older value. */
export const SAVE_VERSION = 2

export interface BestRun {
  wave: number
  seed: number
  classId: string
  tier: number
}

export interface Save {
  v: number
  acres: number
  /** Class ids bought at the Bunkhouse. The free ones are never listed. */
  unlockedClasses: string[]
  /** Weapon and item ids bought at the Seed Catalog. */
  unlockedPool: string[]
  /** Feed Store track id -> ranks owned, 0..META.feedStore.ranks. */
  feedStoreRanks: Record<string, number>
  /** Highest County Fair tier beaten. 0 means Tier 1 has never been cleared. */
  tierCleared: number
  bestRun: BestRun | null
  /** Tiers whose first-clear acre bonus has already been paid. */
  tiersPaid: number[]
}

const KEY = (META as unknown as { save?: { key?: string } }).save?.key ?? 'rdf.save'

export function emptySave(): Save {
  return {
    v: SAVE_VERSION,
    acres: 0,
    unlockedClasses: [],
    unlockedPool: [],
    feedStoreRanks: {},
    tierCleared: 0,
    bestRun: null,
    tiersPaid: [],
  }
}

function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
}

function asNumber(v: unknown, fallback = 0): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}

/**
 * Bring any older save forward to the current shape.
 *
 * Written as a chain of single-version steps rather than one big normaliser, so
 * a v1 save and a v4 save take the same path through v2 and v3 and there is
 * only ever one place to add the next step.
 */
function migrate(raw: Record<string, unknown>): Record<string, unknown> {
  let s = raw
  if (asNumber(s.v, 1) < 2) {
    // v1 had no `tiersPaid`; the first-clear bonus was recomputed from
    // `tierCleared`, which paid it again every time a save was reloaded.
    s = { ...s, tiersPaid: [], v: 2 }
  }
  return s
}

/** Clamp everything into range, whatever the blob claimed. */
function sanitise(s: Record<string, unknown>): Save {
  const maxRank = (META as unknown as { feedStore: { ranks: number } }).feedStore.ranks
  const ranksIn = (s.feedStoreRanks ?? {}) as Record<string, unknown>
  const feedStoreRanks: Record<string, number> = {}
  for (const [k, v] of Object.entries(ranksIn)) {
    const n = Math.floor(asNumber(v))
    if (n > 0) feedStoreRanks[k] = Math.min(maxRank, n)
  }

  const best = s.bestRun as Record<string, unknown> | null | undefined
  return {
    v: SAVE_VERSION,
    acres: Math.max(0, Math.floor(asNumber(s.acres))),
    unlockedClasses: [...new Set(asStringArray(s.unlockedClasses))],
    unlockedPool: [...new Set(asStringArray(s.unlockedPool))],
    feedStoreRanks,
    tierCleared: Math.max(0, Math.floor(asNumber(s.tierCleared))),
    bestRun: best && typeof best === 'object'
      ? {
        wave: Math.max(0, Math.floor(asNumber(best.wave))),
        seed: asNumber(best.seed),
        classId: typeof best.classId === 'string' ? best.classId : 'hand',
        tier: Math.max(1, Math.floor(asNumber(best.tier, 1))),
      }
      : null,
    tiersPaid: [...new Set(
      (Array.isArray(s.tiersPaid) ? s.tiersPaid : [])
        .filter((n): n is number => typeof n === 'number' && Number.isFinite(n))
        .map((n) => Math.floor(n)),
    )],
  }
}

/** Storage, or null where there is none (a headless test, a locked-down browser). */
function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    // Some browsers throw on access rather than returning null.
    return null
  }
}

export function load(): Save {
  const store = storage()
  if (!store) return emptySave()
  try {
    const text = store.getItem(KEY)
    if (!text) return emptySave()
    const parsed: unknown = JSON.parse(text)
    if (!parsed || typeof parsed !== 'object') return emptySave()
    return sanitise(migrate(parsed as Record<string, unknown>))
  } catch {
    // A corrupt blob costs the player their progress. Throwing here would cost
    // them the game, with no way back that does not involve devtools.
    return emptySave()
  }
}

export function save(s: Save): void {
  const store = storage()
  if (!store) return
  try {
    store.setItem(KEY, JSON.stringify(s))
  } catch {
    // Quota or private mode. Nothing useful to do, and it must not interrupt
    // the results screen the player is currently reading.
  }
}

/** Wipe. Used by the Homestead's reset and by tests. */
export function clearSave(): void {
  storage()?.removeItem(KEY)
}
