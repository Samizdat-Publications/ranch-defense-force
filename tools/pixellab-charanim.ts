/**
 * Add template animations to characters that already exist on the account.
 *
 *     npm run charanim -- <jobs.json> [--list]
 *
 * The key comes from `PIXELLAB_API_KEY` if set, else from `.mcp.json` (see
 * `tools/pixellab-key.ts`).
 *
 * `jobs.json` is `[{ "character": "<uuid>", "name": "baseHazmat",
 * "clip": "death", "template": "falling-back-death" }]`. `name` and `clip` are
 * only used for reporting; the API is keyed entirely off `character`.
 *
 * ## Why this exists, when the MCP already has `animate_character`
 *
 * Thirty clips across ten characters is a hundred and twenty jobs, and the
 * account allows TEN concurrent. Driven by hand that is thirty round trips with
 * a wait in each; driven here it is one command that submits, backs off on 429
 * and reports what landed.
 *
 * ## What this is FOR, which is the part worth remembering
 *
 * A character id lives on PixelLab's servers and **dies with the subscription**.
 * The PNGs already downloaded are ours forever; the ability to derive a NEW
 * animation from a character we already paid for is not. So the last useful
 * thing to do on an account that is closing is not to invent new subjects, it
 * is to take every derivation off the ids already there. This is that tool.
 *
 * It only SUBMITS. `npm run character -- <id> <name>` is what pulls the result
 * down and cuts it onto the game's grid, and it already scans every animation
 * in a download rather than just `walk`, so a clip added here needs no change
 * there — only a manifest entry, which that tool prints for you.
 */
import { readFileSync } from 'node:fs'
import { pixellabKey } from './pixellab-key.ts'

const args = process.argv.slice(2).filter((a) => a !== '--')
const jobsPath = args.find((a) => !a.startsWith('--'))
const listOnly = args.includes('--list')
if (!jobsPath) {
  console.error('usage: npm run charanim -- <jobs.json> [--list]')
  process.exit(1)
}

const key = pixellabKey()
const H = { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }
const BASE = 'https://api.pixellab.ai/v2'

interface Job {
  character: string
  name: string
  clip: string
  template: string
  directions?: string[]
}

/**
 * Four, not eight.
 *
 * `pixellabStrips` in `art/sprites.json` maps exactly south/north/west/east and
 * its `_directionNote` says so: eight were generated for the cast and four are
 * used, because the renderer only ever asks for four. Generating eight here
 * would double the bill for frames nothing reads.
 */
const DIRECTIONS = ['south', 'north', 'west', 'east']

const jobs = JSON.parse(readFileSync(jobsPath, 'utf8')) as Job[]
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/**
 * Credits only, deliberately.
 *
 * `/v2/balance` reports the USD pot; the monthly GENERATION allowance is not on
 * it under any name this tool can rely on, and an earlier version printed
 * `generations 0` from a field that does not exist — which reads as "the
 * account is empty" when it is nothing of the sort. Report the number that is
 * really there and say nothing about the one that is not.
 */
const balance = async (): Promise<number> => {
  const r = await fetch(`${BASE}/balance`, { headers: H })
  const b = await r.json() as { credits?: { usd?: number } }
  return b.credits?.usd ?? 0
}

if (listOnly) {
  let n = 0
  for (const j of jobs) {
    const dirs = j.directions ?? DIRECTIONS
    console.log(`  ${j.name}.${j.clip}  <- ${j.template}  x${dirs.length}`)
    n += dirs.length
  }
  console.log(`${jobs.length} clips, ${n} directions = ${n} generations`)
  process.exit(0)
}

/**
 * Submit one clip.
 *
 * A 429 here is the account-wide ten-job ceiling and NOT a failure — the right
 * response is to wait and try the same clip again, because giving up on it
 * leaves a gap that looks identical to a clip nobody asked for.
 */
async function submit(j: Job): Promise<boolean> {
  const dirs = j.directions ?? DIRECTIONS
  for (let attempt = 0; attempt < 40; attempt++) {
    /*
       `POST /v2/animate-character`, NOT `/v2/characters/{id}/animations`.

       That second path exists and answers OPTIONS with `allow: DELETE`, so
       posting to it returns 405 rather than 404 — which reads as "wrong verb on
       the right endpoint" and sent the first version of this tool looking for a
       bug in its own body. The endpoints were found by asking the API:
       `/v2/openapi.json` is readable with the same key.

       `mode: 'template'` is auto-detected from `template_animation_id` being
       present, and is set anyway so the request says what it means.
    */
    const res = await fetch(`${BASE}/animate-character`, {
      method: 'POST',
      headers: H,
      body: JSON.stringify({
        character_id: j.character,
        mode: 'template',
        template_animation_id: j.template,
        directions: dirs,
      }),
    })
    if (res.ok) {
      console.log(`  ${j.name}.${j.clip} <- ${j.template} (${dirs.length} dirs) submitted`)
      return true
    }
    const text = (await res.text()).slice(0, 160)
    if (res.status === 429) {
      await sleep(15000)
      continue
    }
    console.log(`  ${j.name}.${j.clip}: HTTP ${res.status} ${text}`)
    return false
  }
  console.log(`  ${j.name}.${j.clip}: gave up after 40 attempts at the concurrency ceiling`)
  return false
}

const before = await balance()
console.log(`credits $${before.toFixed(4)}; ${jobs.length} clips queued`)

let ok = 0
for (const j of jobs) {
  if (await submit(j)) ok++
  // Paced deliberately. Each submission occupies `dirs.length` of the ten
  // concurrent slots, so firing them back to back only produces 429s that this
  // then has to sit out anyway.
  await sleep(2500)
}

const after = await balance()
console.log(`${ok}/${jobs.length} clips submitted`)
console.log(`credits $${before.toFixed(4)} -> $${after.toFixed(4)} (template mode bills the monthly generation allowance, not credits)`)
console.log('jobs run server-side; pull them with: npm run character -- <character-id> <name>')
