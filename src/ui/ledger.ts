/**
 * The ledger: a run's owned upgrades, read the way docs/UPGRADE_ROSTER.md §5
 * says a card itself should be read — stacks as n/N, a merge's mods named
 * per slot, a class card by name. Part 1 of batch 5's UI work asks for this
 * "readable from the pause screen and the shop"; one data builder here means
 * the two screens cannot drift into two different ledgers the way the shop
 * and the level-up screen once drifted into two different cards.
 *
 * Pure data, no DOM — `pause.ts` renders it in `.psheet-*` chrome and
 * `shop.ts` in `.pshop-*` chrome, because §7's panel language keeps the two
 * screens visually distinct even while they agree on what a ledger is.
 */
import { ITEMS, WEAPONS, type ItemDef } from '../content'
import type { Player } from '../sim/player'
import { stackLabel } from '../sim/offers'

export interface LedgerWeaponRow {
  id: string
  name: string
  tier: number
  /** Weapon-upgrade card names this slot has taken (H12), by display name. */
  mods: string[]
}

export interface LedgerItemRow {
  id: string
  name: string
  /** `3/5`, `ONE ONLY`, or `4/4 · LAST` — the same footer the card prints. */
  stack: string
}

export interface Ledger {
  weapons: LedgerWeaponRow[]
  /** Class cards this run owns, in the order the roster declares them. */
  classCards: string[]
  /** Everything else: stat cards, loads, on-hit/on-kill, allies, body,
   *  ledger cards, and the two tool upgrades. Weapon mods and class cards
   *  are pulled out into their own sections above rather than listed twice. */
  items: LedgerItemRow[]
}

/**
 * H12's reverse lookup: a weapon slot stores the short mod id
 * (`'chokeTube'`), not the item id that granted it. Built once at module
 * load, the same way `player.ts`'s `ITEM_MODS` flattens `items.json` once
 * rather than per read.
 */
const MOD_NAMES: Record<string, string> = {}
for (const [, def] of Object.entries(ITEMS) as [string, ItemDef][]) {
  if (typeof def.weaponMod === 'string') MOD_NAMES[def.weaponMod] = def.name
}

export function buildLedger(player: Player): Ledger {
  const weapons: LedgerWeaponRow[] = player.weapons.map((slot) => ({
    id: slot.id,
    name: WEAPONS[slot.id]?.name ?? slot.id,
    tier: slot.tier,
    mods: slot.mods.map((m) => MOD_NAMES[m] ?? m),
  }))

  const classCards: string[] = []
  const itemCounts = new Map<string, number>()
  for (const owned of player.items) {
    itemCounts.set(owned.id, (itemCounts.get(owned.id) ?? 0) + (owned.boosted ? 2 : 1))
  }

  const items: LedgerItemRow[] = []
  for (const [id] of itemCounts) {
    const def = ITEMS[id] as ItemDef | undefined
    if (!def) continue
    // Weapon-upgrade cards are already named on their weapon's row above.
    if (typeof def.weaponMod === 'string') continue
    if (typeof def.requiresClass === 'string') {
      classCards.push(def.name)
      continue
    }
    const max = typeof def.maxStacks === 'number' ? def.maxStacks : 0
    items.push({
      id,
      name: def.name,
      stack: stackLabel(max > 0 ? { n: player.itemCount(id), max } : null),
    })
  }

  return { weapons, classCards, items }
}
