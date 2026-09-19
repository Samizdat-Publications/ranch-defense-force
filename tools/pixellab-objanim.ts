/**
 * Add animations to OBJECTS that already exist on the account.
 *
 *     npm run objanim -- <jobs.json> [--list]
 *
 * The key comes from `PIXELLAB_API_KEY` if set, else from `.mcp.json` (see
 * `tools/pixellab-key.ts`).
 *
 * `jobs.json` is an array of:
 *   { "object": "<uuid>", "name": "crow", "clip": "death",
 *     "action": "collapsing into a heap of feathers",
 *     "directions": ["south", ...],      // optional, defaults to all eight
 *     "group": "<uuid>",                 // optional, to EXTEND an existing clip
 *     "frames": 8, "replace": false }
 *
 * ## The sibling of `npm run charanim`, and why it is a separate file
 *
 * Characters and objects animate through MIRROR-IMAGE endpoints:
 *
 *     character   POST /v2/animate-character
 *     object      POST /v2/objects/{object_id}/animations
 *
 * Using the wrong one does not fail cleanly. `POST /v2/characters/{id}/
 * animations` EXISTS and answers OPTIONS with `allow: DELETE`, so it returns
 * 405 — which reads as a bad request body on a good endpoint and sends you
 * debugging the wrong file. Both were found by reading `/v2/openapi.json`,
 * which the same key can fetch. Ask the API rather than guessing at it.
 *
 * ## Why this matters more than it looks
 *
 * An object id lives on PixelLab's servers and **dies with the subscription**.
 * The PNGs already downloaded are ours forever; the ability to derive a NEW
 * animation from an object already paid for is not. Every clip taken off a live
 * id is a clip that can never be taken later.
 *
 * ## Two behaviours worth knowing before trusting a batch
 *
 * **Do not thread a group id from a submission that has not finished.** The
 * group does not exist server-side until its first direction lands, and a
 * second call naming it 404s. Submit every direction of a NEW clip in ONE call;
 * use `group` only to extend a clip that already has frames.
 *
 * **`replace: true` does not reliably take on more than one direction per
 * request.** Regenerating two directions of one clip needed two calls. If a
 * replacement looks like it did not happen, that is why — check before assuming
 * the job is still running.
 */
import { readFileSync } from 'node:fs'
import { pixellabKey } from './pixellab-key.ts'

const args = process.argv.slice(2).filter((a) => a !== '--')
const jobsPath = args.find((a) => !a.startsWith('--'))
const listOnly = args.includes('--list')
if (!jobsPath) {
  console.error('usage: npm run objanim -- <jobs.json> [--list]')
  process.exit(1)
}

const key = pixellabKey()
const H = { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }
const BASE = 'https://api.pixellab.ai/v2'

interface Job {
  object: string
  name: string
  clip: string
  action?: string
  directions?: string[]
  group?: string
  frames?: number
  replace?: boolean
}

/** Compass order the animals rig uses; `pixellabObjects` maps all eight. */
const DIRECTIONS = [
  'south', 'south-west', 'west', 'north-west',
  'north', 'north-east', 'east', 'south-east',
]

const jobs = JSON.parse(readFileSync(jobsPath, 'utf8')) as Job[]
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

if (listOnly) {
  let n = 0
  for (const j of jobs) {
    const dirs = j.directions ?? DIRECTIONS
    console.log(`  ${j.name}.${j.clip}  x${dirs.length}${j.group ? '  (extends)' : ''}${j.replace ? '  (replace)' : ''}`)
    n += dirs.length
  }
  console.log(`${jobs.length} clips, ${n} directions = ${n} generations`)
  process.exit(0)
}

async function submit(j: Job): Promise<boolean> {
  const dirs = j.directions ?? DIRECTIONS
  const body: Record<string, unknown> = {
    mode: 'v3',
    directions: dirs,
    frame_count: j.frames ?? 8,
  }
  // An EXTENSION names its group and inherits the description; a NEW clip must
  // carry one.
  if (j.group) body.animation_group_id = j.group
  if (j.action) body.animation_description = j.action
  if (j.clip) body.display_name = j.clip
  if (j.replace) body.replace_existing = true

  for (let attempt = 0; attempt < 40; attempt++) {
    const res = await fetch(`${BASE}/objects/${j.object}/animations`, {
      method: 'POST', headers: H, body: JSON.stringify(body),
    })
    if (res.ok) {
      const o = await res.json() as { animation_group_id?: string }
      console.log(`  ${j.name}.${j.clip} (${dirs.length} dirs) -> group ${(o.animation_group_id ?? '?').slice(0, 8)}`)
      return true
    }
    const text = (await res.text()).slice(0, 180)
    // The account-wide ten-job ceiling. Not a failure: wait it out, because
    // giving up leaves a gap indistinguishable from a clip nobody asked for.
    if (res.status === 429) { await sleep(15000); continue }
    console.log(`  ${j.name}.${j.clip}: HTTP ${res.status} ${text}`)
    return false
  }
  console.log(`  ${j.name}.${j.clip}: gave up at the concurrency ceiling`)
  return false
}

let ok = 0
console.log(`${jobs.length} clips queued`)
for (const j of jobs) {
  if (await submit(j)) ok++
  await sleep(2500)
}
console.log(`${ok}/${jobs.length} submitted`)
console.log('jobs run server-side; pull them with: npm run object -- <object-id> <name>')
