/**
 * Batch driver for PixelLab's `/v2/map-objects` endpoint.
 *
 *   npm run mapobject -- <jobs.json> <outDir> [concurrency]
 *
 * The key comes from `PIXELLAB_API_KEY` if set, else from `.mcp.json` (see
 * `tools/pixellab-key.ts`). Override with `PIXELLAB_API_KEY=... npm run mapobject -- ...`.
 *
 * **Needs a live key.** The subscription this project used was cancelled after
 * session 15, so this script cannot run again without a new one. It is kept
 * because it is the cheap path and the next person will want it: `/map-objects`
 * costs **1 generation** per call and takes any aspect ratio from 32 to 400px,
 * where `create-1-direction-object` costs **20** and only takes a square. That
 * is a 20x difference for art of the same quality, and session 13 paid the 20
 * before anyone measured it. See docs/PIXELLAB.md.
 *
 * `jobs.json` is an array of:
 *   { name, description, width, height, detail?, shading?, guidance?, n? }
 * `n` is how many separate calls to make for that subject — each is its own
 * generation and its own candidate, because at sizes above ~128px the endpoint
 * returns a single image rather than a grid of candidates.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { pixellabKey } from './pixellab-key.ts'

const BASE = 'https://api.pixellab.ai/v2'
const key = pixellabKey()
const H = { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }

const jobsPath = process.argv[2]
const outDir = process.argv[3] ?? 'assets/pixellab/mapobj'
const concurrency = Number(process.argv[4] ?? 6)
if (!jobsPath) throw new Error('usage: npm run mapobject -- <jobs.json> <outDir> [concurrency]')
mkdirSync(outDir, { recursive: true })

interface Job {
  name: string
  description: string
  width: number
  height: number
  detail?: string
  shading?: string
  guidance?: number
  n?: number
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
const balance = async (): Promise<number> => {
  const r = await fetch(`${BASE}/balance`, { headers: H })
  const j = await r.json() as { subscription: { generations: number } }
  return j.subscription.generations
}

/**
 * The house camera. ART_STYLE.md is explicit that this must be passed and not
 * omitted: the tileset endpoint defaults to HIGH top-down, so leaving it off is
 * how half the ground came back looking down at the tops of everything.
 */
const VIEW = 'low top-down'

async function submit(j: Job, i: number): Promise<{ name: string; id: string } | null> {
  const res = await fetch(`${BASE}/map-objects`, {
    method: 'POST',
    headers: H,
    body: JSON.stringify({
      description: j.description,
      image_size: { width: j.width, height: j.height },
      view: VIEW,
      outline: 'single color outline',
      shading: j.shading ?? 'basic shading',
      detail: j.detail ?? 'medium detail',
      text_guidance_scale: j.guidance ?? 10,
    }),
  })
  const label = (j.n ?? 1) > 1 ? `${j.name}_${i}` : j.name
  if (!res.ok) {
    console.log(`  ${label}: HTTP ${res.status} ${(await res.text()).slice(0, 160)}`)
    return null
  }
  const b = await res.json() as { object_id?: string }
  if (!b.object_id) { console.log(`  ${label}: no object_id`); return null }
  return { name: label, id: b.object_id }
}

async function collect(m: { name: string; id: string }): Promise<boolean> {
  for (let t = 0; t < 60; t++) {
    await sleep(7000)
    const r = await fetch(`${BASE}/map-objects/${m.id}`, { headers: H })
    if (!r.ok) continue
    const o = await r.json() as { status?: string; download_url?: string }
    const st = (o.status ?? '').toLowerCase()
    if (st === 'completed' && o.download_url) {
      const d = await fetch(o.download_url)
      writeFileSync(`${outDir}/${m.name}.png`, Buffer.from(await d.arrayBuffer()))
      return true
    }
    if (st && !['queued', 'running', 'pending', 'processing', 'review', 'in_progress'].includes(st)) {
      console.log(`  ${m.name}: status ${st}`)
      return false
    }
  }
  console.log(`  ${m.name}: timed out`)
  return false
}

const jobs = (JSON.parse(readFileSync(jobsPath, 'utf8')) as Job[])
  // `_`-prefixed entries are notes, not subjects. Same rule as every other
  // content file in this repo; it has bitten the project more than once.
  .filter((j) => !j.name.startsWith('_'))

// Expand `n` into individual calls, and skip anything already on disk so a
// re-run after a timeout does not pay twice for the same art.
const calls: { job: Job; i: number }[] = []
for (const j of jobs) {
  for (let i = 0; i < (j.n ?? 1); i++) {
    const label = (j.n ?? 1) > 1 ? `${j.name}_${i}` : j.name
    if (existsSync(`${outDir}/${label}.png`)) continue
    calls.push({ job: j, i })
  }
}

const start = await balance()
console.log(`balance ${start}; ${calls.length} calls queued -> ${outDir}`)

let saved = 0
for (let c = 0; c < calls.length; c += concurrency) {
  const slice = calls.slice(c, c + concurrency)
  const made = (await Promise.all(slice.map((x) => submit(x.job, x.i)))).filter((x): x is { name: string; id: string } => !!x)
  const got = await Promise.all(made.map(collect))
  saved += got.filter(Boolean).length
  console.log(`  [${Math.min(c + concurrency, calls.length)}/${calls.length}] saved ${saved}`)
}

const end = await balance()
console.log(`saved ${saved} images; spent ${start - end}; balance ${end}`)
