/**
 * Fill in the directions an object's animations are missing, until they are not.
 *
 *     npm run objfill -- <object-id>:<localName> [more...] [--rounds N] [--list]
 *
 * e.g. npm run objfill -- 7323925e-...:bossSow dd904910-...:bossCombine
 *
 * The key comes from `PIXELLAB_API_KEY` if set, else from `.mcp.json`.
 *
 * ## Why a loop, and not one careful request
 *
 * A request for eight directions does not reliably produce eight. The API
 * accepts it, reports the object `completed` with no pending jobs, and simply
 * has fewer directions than were asked for — and the ones missing are
 * overwhelmingly the EAST side (`east`, `north-east`, `south-east`). Measured
 * across the duck, the crow, the duster and four bosses in session 25: every
 * batch came back short, and re-asking for exactly the gap closed part of it
 * each time. Three rounds is typical, one is never enough.
 *
 * Nothing surfaces this. `status: completed` is true — the jobs it ran did
 * finish — so a caller that trusts the status ships a boss that vanishes when
 * it turns east. **Count the directions; do not trust the status.**
 *
 * ## How it decides what is missing
 *
 * From the FILES ON DISK, not from the API. Two groups can carry the same
 * description (a killed batch that was re-run before `objanim` learned to skip
 * duplicates), they slug to one folder on download, and the frames merge there.
 * Disk is therefore the only place the real union exists. Each round
 * re-downloads before re-measuring.
 *
 * Fills extend the group that already has the most directions for that
 * description; since the download merges by slug, extending any of them
 * completes the union.
 */
import { readdirSync, existsSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { pixellabKey } from './pixellab-key.ts'

const argv = process.argv.slice(2).filter((a) => a !== '--')
const listOnly = argv.includes('--list')
const roundsArg = argv.findIndex((a) => a === '--rounds')
const ROUNDS = roundsArg >= 0 ? Number(argv[roundsArg + 1]) : 4
const targets = argv
  .filter((a) => a.includes(':'))
  .map((a) => { const [id, name] = a.split(':'); return { id, name } })

if (targets.length === 0) {
  console.error('usage: npm run objfill -- <object-id>:<localName> [...] [--rounds N] [--list]')
  process.exit(1)
}

const H = { Authorization: `Bearer ${pixellabKey()}`, 'Content-Type': 'application/json' }
const BASE = 'https://api.pixellab.ai/v2'
const ALL = ['south', 'south-west', 'west', 'north-west', 'north', 'north-east', 'east', 'south-east']
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

const slug = (d: string): string =>
  d.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 42)

function download(id: string, name: string): void {
  /*
     `npm run object` is the one place that knows how to unpack an object zip.

     Through a SHELL string, not execFileSync: on Windows `npx` is `npx.cmd` and
     execFileSync will not find a bare `npx` on PATH. The arguments here are ids
     and local names this tool generated, never user text.
  */
  execSync(`npx vite-node tools/pixellab-object.ts -- ${id} ${name}`, { stdio: 'ignore' })
}

/** Directions present ON DISK for each animation folder of a downloaded object. */
function onDisk(name: string): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>()
  const dir = `assets/pixellab/object/${name}/animations`
  if (!existsSync(dir)) return out
  for (const clip of readdirSync(dir)) out.set(clip, new Set(readdirSync(`${dir}/${clip}`)))
  return out
}

interface Group { gid: string; desc: string; n: number }

async function groupsOf(id: string): Promise<Group[]> {
  const r = await fetch(`${BASE}/objects/${id}`, { headers: H })
  if (!r.ok) return []
  const j = await r.json() as { animations?: { animation_group_id: string; description?: string; directions?: unknown[] }[] }
  return (j.animations ?? []).map((g) => ({
    gid: g.animation_group_id,
    desc: String(g.description ?? ''),
    n: (g.directions ?? []).length,
  }))
}

let anyLeft = false
for (let round = 1; round <= ROUNDS; round++) {
  let submitted = 0
  let complete = 0
  let incomplete = 0
  console.log(`\n===== round ${round} =====`)

  for (const { id, name } of targets) {
    if (!listOnly) download(id, name)
    const disk = onDisk(name)
    const groups = await groupsOf(id)

    // Best group per description — the one with the most directions.
    const best = new Map<string, Group>()
    for (const g of groups) {
      const cur = best.get(g.desc)
      if (!cur || g.n > cur.n) best.set(g.desc, g)
    }

    for (const [desc, g] of best) {
      const s = slug(desc)
      const folder = [...disk.keys()].find((k) => k.startsWith(s.slice(0, 28)))
      const have = folder ? disk.get(folder)! : new Set<string>()
      const missing = ALL.filter((d) => !have.has(d))
      if (missing.length === 0) { complete++; continue }
      incomplete++
      console.log(`  ${name}/${s.slice(0, 30)}: missing ${missing.length} (${missing.join(',')})`)
      if (listOnly) continue

      for (let attempt = 0; attempt < 40; attempt++) {
        const res = await fetch(`${BASE}/objects/${id}/animations`, {
          method: 'POST', headers: H,
          body: JSON.stringify({
            mode: 'v3',
            animation_group_id: g.gid,
            directions: missing,
            frame_count: 8,
          }),
        })
        if (res.ok) { submitted++; break }
        if (res.status === 429) { await sleep(15000); continue }
        console.log(`    submit failed: HTTP ${res.status} ${(await res.text()).slice(0, 120)}`)
        break
      }
      await sleep(2000)
    }
  }

  console.log(`  complete ${complete}, incomplete ${incomplete}, submitted ${submitted}`)
  anyLeft = incomplete > 0
  if (listOnly || !anyLeft) break
  if (round < ROUNDS) {
    // Generation is minutes per direction; re-measuring sooner only re-submits
    // work that is already running.
    console.log('  waiting for generation before the next round...')
    await sleep(6 * 60 * 1000)
  }
}

console.log(anyLeft
  ? '\nstill incomplete — re-run; each round closes part of the gap'
  : '\nall clips are 8/8')
