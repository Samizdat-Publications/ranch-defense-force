/**
 * Write the ledger's verdicts back onto the PixelLab account as tags.
 *
 *     npm run tag                       # dry run — prints, changes nothing
 *     npm run tag -- --write
 *     npm run tag -- --write --only=retired
 *
 * `--write` needs a key: `PIXELLAB_API_KEY` if set, else `.mcp.json` (see
 * `tools/pixellab-key.ts`). Override with `PIXELLAB_API_KEY=... npm run tag -- --write`.
 *
 * ## Why the account needs to carry this and not just the repo
 *
 * `docs/PIXELLAB_LEDGER.md` is in the repo, which is exactly where a session
 * that is about to generate something is NOT looking — it is looking at the
 * PixelLab web UI, or at `list_objects`, deciding whether the thing it wants
 * already exists. So the verdict has to be visible from that side too, and a
 * tag is the only thing the account carries that a human reads.
 *
 * After a run, `list_objects(tags="rdf-retired")` is every asset this project
 * has decided against and why; `tags="rdf-open"` is the queue of questions;
 * `tags="rdf-surplus"` is everything that is a second roll of something already
 * on screen. The next `npm run inventory` groups the committed inventory by
 * those same tags, so the two documents agree without either one being edited.
 *
 * ## It reads the ledger's own output, not its own copy of the rules
 *
 * `docs/pixellab-ledger.json` is written by `npm run ledger` from the family
 * table in `tools/pixellab-ledger.ts`. A tagger with its own idea of what is
 * wired is precisely how the account and the repo drift apart again, which is
 * the drift this whole audit exists to end. Run `npm run ledger` first; this
 * refuses to run against a sidecar older than the inventory it was built from.
 *
 * ## What it will not do
 *
 * It never REMOVES a tag it does not own. The account's own vocabulary —
 * `rdf-crop-corn`, `rdf-scene-barn`, `wired-carry-drumGun` — is how the
 * inventory groups itself, and those tags predate this tool and outlive it.
 * Only the seven verdict tags below are managed, and PATCH replaces the whole
 * set, so every run rebuilds `kept + verdict` and nothing else is disturbed.
 */
import { readFileSync } from 'node:fs'
import { pixellabKey } from './pixellab-key.ts'

const args = process.argv.slice(2).filter((a) => a !== '--')
const write = args.includes('--write')
const only = args.find((a) => a.startsWith('--only='))?.slice(7)

interface Row { id: string; verdict: string; where: string }
interface Sidecar { taken: string; objects: Row[]; characters: Row[] }

let ledger: Sidecar
try {
  ledger = JSON.parse(readFileSync('docs/pixellab-ledger.json', 'utf8')) as Sidecar
} catch {
  console.error('docs/pixellab-ledger.json is missing — run `npm run ledger` first')
  process.exit(1)
}
const inv = JSON.parse(readFileSync('docs/pixellab-inventory.json', 'utf8')) as
  { taken: string; objects: { id: string; tags?: string[] }[]; characters: { id: string; tags?: string[] }[] }
if (inv.taken !== ledger.taken) {
  console.error(
    `the ledger was built from a ${ledger.taken} snapshot and the inventory is now ${inv.taken}\n`
    + 'run `npm run ledger` again before tagging',
  )
  process.exit(1)
}

/** The tags this tool owns. Anything else on an asset is left exactly alone. */
const MANAGED = /^rdf-(wired|packed-unused|surplus|unclaimed|review|retired|open)$|^ledger-/

/**
 * A tag safe for the account's own vocabulary: lower case, hyphens, short.
 *
 * PixelLab caps a tag at 50 characters and the reason is the useful half, so
 * the slug keeps the FRONT of the sentence — "packed weapon icon no weapon owns
 * it" survives, the paragraph about the upgrade roster does not, and the full
 * text is one lookup away in the ledger.
 */
function slug(s: string): string {
  const head = s.replace(/^OPEN:\s*/, '').split(/[—;(]|\s--\s|,\s/)[0] ?? s
  return `ledger-${head}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+/g, '-')
    .slice(0, 50).replace(/-+$/, '')
}

let key: string | undefined
if (write) {
  try {
    key = pixellabKey()
  } catch (e) {
    console.error(`${(e as Error).message}\n\na dry run needs no key, a write does`)
    process.exit(1)
  }
}

async function patch(kind: 'objects' | 'characters', id: string, tags: string[]): Promise<boolean> {
  const r = await fetch(`https://api.pixellab.ai/v2/${kind}/${id}/tags`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ tags }),
  })
  if (!r.ok) console.error(`  ${id}: HTTP ${r.status} ${await r.text().catch(() => '')}`)
  return r.ok
}

const counts: Record<string, number> = {}
let changed = 0
let failed = 0
const jobs: { kind: 'objects' | 'characters'; id: string; want: string[] }[] = []

for (const kind of ['objects', 'characters'] as const) {
  const byId = new Map(inv[kind].map((a) => [a.id, a.tags ?? []]))
  for (const row of ledger[kind]) {
    counts[row.verdict] = (counts[row.verdict] ?? 0) + 1
    if (only && row.verdict !== only) continue
    const existing = byId.get(row.id) ?? []
    const kept = existing.filter((t) => !MANAGED.test(t))
    /*
       Two tags, not one. The verdict is what you FILTER on and it is a closed
       vocabulary of seven; the reason is what you read once the filter has
       found the thing, and it is prose. Folding them into one tag would make
       `list_objects(tags="rdf-retired")` impossible, which is the entire query
       this tool exists to make answerable.
    */
    const want = [...kept, `rdf-${row.verdict}`, slug(row.where)]
    const same = want.length === existing.length && want.every((t) => existing.includes(t))
    if (same) continue
    changed++
    if (!write) {
      if (changed <= 20) console.log(`  ${row.id.slice(0, 8)}  ${existing.join(',') || '(none)'}  ->  ${want.join(',')}`)
      continue
    }
    jobs.push({ kind, id: row.id, want })
  }
}

/*
   Eight at a time. A thousand PATCHes one after another is four minutes of
   round trips for work the server does instantly, and a thousand at once is a
   rate limit. Eight is what `art/pixellab-queue.json` already records as the
   account's concurrency for generation jobs, so it is a number this project
   has evidence for rather than one picked here.
*/
const LANES = 8
let next = 0
await Promise.all(Array.from({ length: LANES }, async () => {
  for (let i = next++; i < jobs.length; i = next++) {
    const j = jobs[i]!
    if (!await patch(j.kind, j.id, j.want)) failed++
    if (i % 100 === 0) console.log(`  ${i}/${jobs.length}`)
  }
}))

console.log(`\nverdicts: ${Object.entries(counts).map(([k, n]) => `${k} ${n}`).join(', ')}`)
if (!write) {
  console.log(`\n${changed} asset(s) would be retagged. Dry run — nothing was written.`)
  console.log('re-run with --write (and PIXELLAB_API_KEY set) to apply.')
} else {
  console.log(`\n${changed - failed} asset(s) retagged${failed ? `, ${failed} FAILED` : ''}.`)
  console.log('run `npm run inventory` to refresh the committed inventory against the new tags.')
}
if (failed) process.exitCode = 1
