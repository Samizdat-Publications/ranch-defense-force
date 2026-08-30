/**
 * Turn stills that are already in this repo into animation loops.
 *
 *   PIXELLAB_API_KEY=... npm run animate -- <jobs.json> [outDir] [concurrency]
 *
 * `jobs.json` is `[{ "key": "node.oreGold", "file": "assets/.../x.png",
 * "action": "the crystal veins pulsing" , "frames": 8 }]`.
 *
 * WHY THIS EXISTS, when `npm run anim` already pulls animation frames: that one
 * downloads a job someone already ran in the web UI. This one submits, so a
 * whole field's worth of loops is one command instead of forty trips through a
 * browser.
 *
 * `/animate-with-text-v3` costs ONE generation for a small frame and takes any
 * still — it does not need a PixelLab object id, so every sprite already sitting
 * in `assets/` is eligible. That is the whole reason the "bring the map alive"
 * pass is affordable: the art is bought, only the motion is new.
 *
 * It KEEPS YOUR INPUT AS FRAME 0, so `frame_count: 8` returns nine images. The
 * repo has been caught by that before; the frame count written into the atlas
 * manifest must be the real one, and a stepped strip is what happens when it is
 * not.
 *
 * Already-downloaded keys are skipped, so a re-run after a timeout does not pay
 * twice.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'

const args = process.argv.slice(2).filter((a) => a !== '--')
const [jobsPath, outDir = 'assets/pixellab/anim', concArg] = args
if (!jobsPath) {
  console.error('usage: npm run animate -- <jobs.json> [outDir] [concurrency]')
  process.exit(1)
}

const key = process.env.PIXELLAB_API_KEY
if (!key) throw new Error('PIXELLAB_API_KEY is not set')
const H = { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }
const BASE = 'https://api.pixellab.ai/v2'

interface Job { key: string; file: string; action: string; frames?: number }
const jobs = JSON.parse(readFileSync(jobsPath, 'utf8')) as Job[]
const concurrency = Number(concArg ?? 4)

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

const balance = async (): Promise<number> => {
  const r = await fetch(`${BASE}/balance`, { headers: H })
  return ((await r.json()) as { credits: { usd: number } }).credits.usd
}

/** Frame 0 is the input, so a job asking for N returns N+1 images. */
async function run(j: Job): Promise<number> {
  const dir = `${outDir}/${j.key}`
  if (existsSync(`${dir}/frame_000.png`)) {
    console.log(`  ${j.key}: already on disk, skipped`)
    return 0
  }
  const b64 = readFileSync(j.file).toString('base64')
  const res = await fetch(`${BASE}/animate-with-text-v3`, {
    method: 'POST',
    headers: H,
    body: JSON.stringify({
      first_frame: { type: 'base64', base64: b64 },
      action: j.action,
      frame_count: j.frames ?? 8,
      no_background: true,
    }),
  })
  if (!res.ok) {
    console.log(`  ${j.key}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`)
    return 0
  }
  const body = await res.json() as {
    images?: { base64: string }[]
    background_job_id?: string
  }

  let images = body.images
  // Async variants hand back a job id; poll it the way every other tool here does.
  if (!images && body.background_job_id) {
    for (let t = 0; t < 60; t++) {
      await sleep(6000)
      const r = await fetch(`${BASE}/background-jobs/${body.background_job_id}`, { headers: H })
      if (!r.ok) continue
      // The payload lives under `last_response`, NOT at the top level. Reading
      // the top level only made a completed job look empty and threw away a
      // generation that had already been paid for.
      const o = await r.json() as {
        status?: string
        images?: { base64: string }[]
        last_response?: { images?: { base64: string }[]; [k: string]: unknown }
      }
      const got = o.images ?? o.last_response?.images
      if (got?.length) { images = got; break }
      const st = (o.status ?? '').toLowerCase()
      if (st === 'completed') {
        console.log(`  ${j.key}: completed but no images; keys were ${Object.keys(o.last_response ?? o).join(',')}`)
        return 0
      }
      if (st && !['queued', 'running', 'pending', 'processing', 'in_progress'].includes(st)) {
        console.log(`  ${j.key}: status ${st}`)
        return 0
      }
    }
  }
  if (!images?.length) { console.log(`  ${j.key}: no frames returned`); return 0 }

  mkdirSync(dir, { recursive: true })
  images.forEach((im, i) => {
    const raw = im.base64.replace(/^data:image\/png;base64,/, '')
    writeFileSync(`${dir}/frame_${String(i).padStart(3, '0')}.png`, Buffer.from(raw, 'base64'))
  })
  console.log(`  ${j.key}: ${images.length} frames -> ${dir}`)
  return images.length
}

const start = await balance()
console.log(`balance $${start.toFixed(4)}; ${jobs.length} clips queued -> ${outDir}`)

let done = 0
for (let i = 0; i < jobs.length; i += concurrency) {
  const batch = jobs.slice(i, i + concurrency)
  const got = await Promise.all(batch.map(run))
  done += got.filter((n) => n > 0).length
}

const end = await balance()
console.log(`\n${done}/${jobs.length} clips; spent $${(start - end).toFixed(4)}; balance $${end.toFixed(4)}`)
