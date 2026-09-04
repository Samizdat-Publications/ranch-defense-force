/**
 * Generates sprites with PixelLab and writes them into `assets/pixellab/`.
 *
 *   npm run pixellab            # only what is missing
 *   npm run pixellab -- --force # regenerate everything
 *   npm run pixellab -- --only cow_bell,lantern
 *   npm run pixellab -- --list  # what would be generated, free, no key needed
 *
 * The key comes from `PIXELLAB_API_KEY` if set, else from `.mcp.json` (see
 * `tools/pixellab-key.ts`). Override with `PIXELLAB_API_KEY=... npm run pixellab`,
 * or on PowerShell: `$env:PIXELLAB_API_KEY="..."; npm run pixellab`.
 *
 * Every request goes through **one style anchor** — `limezu_style_256.png`, a
 * 4x4 sheet of real LimeZu icons. That single control is most of the quality:
 * the same prompt without it comes back cold blue-grey, and with it comes back
 * warm and in the pack's palette. Do not rebuild the anchor casually; the
 * cohesion of everything generated so far depends on it.
 *
 * The recipe, from docs/PIXELLAB.md and followed exactly:
 *   - tool: generate-with-style-v2 (the Pro style-reference tool)
 *   - the style image carries palette, outline weight, shading and colour count
 *   - the description is THE SUBJECT ONLY, in plain words. Nothing about
 *     palette, outline, "no text" or view angle — a long style suffix actively
 *     fights the anchor.
 *
 * Cost is real money: Pro tools are 20 generations each against a 2,000/month
 * budget, so this refuses to re-spend on a sprite that already exists unless
 * asked. `--list` is free and tells you what a run would cost.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import subjects from '../art/pixellab-queue.json' with { type: 'json' }
import { pixellabKey } from './pixellab-key.ts'

const BASE = 'https://api.pixellab.ai/v2'
const ANCHOR = 'assets/pixellab/limezu_style_256.png'
const SHEET_DIR = 'assets/pixellab/sheets'
/** Pro tools cost this many generations per call. */
const PRO_COST = 20

interface Subject {
  /** snake_case, the object's plain name. No prompt text, no timestamps. */
  name: string
  /** The subject only. See the recipe above. */
  description: string
  /** What this is for, so a future pass knows why it was spent. */
  serves?: string
  done?: boolean
}

const args = process.argv.slice(2)
const force = args.includes('--force')
const listOnly = args.includes('--list')
const onlyArg = args.indexOf('--only')
const only = onlyArg >= 0 && args[onlyArg + 1]
  ? new Set(args[onlyArg + 1].split(','))
  : null

// Resolved lazily and allowed to be absent here: `--list` needs no key at
// all, so the failure (if any) is reported in `main`, after that check.
let key: string | undefined
try {
  key = pixellabKey()
} catch {
  key = undefined
}

const queue = (subjects as unknown as { subjects: Subject[] }).subjects
  // `_`-prefixed entries are planning notes in the queue, not subjects. Same
  // rule as every other content file; it has bitten this project twice.
  .filter((s) => !s.name.startsWith('_'))
  .filter((s) => !only || only.has(s.name))
  .filter((s) => force || !existsSync(`${SHEET_DIR}/${s.name}.png`))

function anchorPayload(): { base64: string; width: number; height: number } {
  const bytes = readFileSync(ANCHOR)
  // The anchor is a known 256x256 sheet; read the IHDR rather than trusting a
  // constant, so swapping the anchor for a different size still works.
  const width = bytes.readUInt32BE(16)
  const height = bytes.readUInt32BE(20)
  return { base64: bytes.toString('base64'), width, height }
}

async function poll(jobId: string): Promise<string[]> {
  // The docs ask for 5-10s between polls. A Pro generation takes tens of
  // seconds; hammering it just burns rate limit.
  for (let attempt = 0; attempt < 120; attempt++) {
    await new Promise((r) => setTimeout(r, 6000))
    const res = await fetch(`${BASE}/background-jobs/${jobId}`, {
      headers: { Authorization: `Bearer ${key as string}` },
    })
    if (!res.ok) throw new Error(`poll ${res.status}: ${(await res.text()).slice(0, 300)}`)
    const body = await res.json() as {
      status: string
      last_response?: { images?: { base64: string }[]; image?: { base64: string } }
      error?: string
    }
    if (body.status === 'failed') throw new Error(body.error ?? 'job failed')
    if (body.status !== 'completed') continue
    const r = body.last_response
    if (r?.images?.length) return r.images.map((i) => i.base64)
    if (r?.image) return [r.image.base64]
    throw new Error('completed with no image in last_response')
  }
  throw new Error('timed out after 12 minutes')
}

async function generate(s: Subject): Promise<void> {
  const anchor = anchorPayload()
  process.stdout.write(`  ${s.name.padEnd(18)} generating... `)

  const res = await fetch(`${BASE}/generate-with-style-v2`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key as string}`,
    },
    body: JSON.stringify({
      style_images: [{
        ...anchor,
        // The instruction rides on the style image, not the description.
        instruction: 'use this art style, palette, outline weight, shading and colour count',
      }],
      description: s.description,
      remove_background: true,
    }),
  })

  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText}\n${(await res.text()).slice(0, 500)}`)
  }

  const { background_job_id: jobId } = await res.json() as { background_job_id: string }
  const images = await poll(jobId)
  mkdirSync(SHEET_DIR, { recursive: true })
  const out = `${SHEET_DIR}/${s.name}.png`
  writeFileSync(out, Buffer.from(images[0], 'base64'))
  console.log(`${(Buffer.from(images[0], 'base64').length / 1024).toFixed(0)}KB -> ${out}`)
}

async function main(): Promise<void> {
  if (queue.length === 0) {
    console.log('nothing to generate — every subject already has a sheet.')
    console.log('use --force to re-roll, or add subjects to art/pixellab-queue.json')
    return
  }

  console.log(
    `${queue.length} subject(s), ${queue.length * PRO_COST} generations `
    + `of a 2,000/month budget:\n`,
  )
  for (const s of queue) {
    console.log(`  ${s.name.padEnd(18)} ${s.description}`)
    if (s.serves) console.log(`  ${''.padEnd(18)} serves: ${s.serves}`)
  }

  if (listOnly) {
    console.log('\n--list: nothing generated, nothing spent.')
    return
  }

  if (!key) {
    console.error(
      '\nno PixelLab API key found (checked PIXELLAB_API_KEY and .mcp.json — '
      + 'see tools/pixellab-key.ts).\n\n'
      + '  PowerShell:  $env:PIXELLAB_API_KEY="your-key"; npm run pixellab\n'
      + '  bash/zsh:    PIXELLAB_API_KEY=your-key npm run pixellab\n\n'
      + 'NOTE: the bash form is a PARSE ERROR in PowerShell. That is what\n'
      + '"is not recognized as the name of a cmdlet" means. Use the $env: form.\n\n'
      + 'The key is on your PixelLab account page. It must NOT be committed.\n',
    )
    process.exit(1)
  }

  console.log('')
  for (const s of queue) {
    try {
      await generate(s)
    } catch (e) {
      console.error(`\n  ${s.name}: ${(e as Error).message}\n`)
    }
  }

  console.log(
    `\ndone. Sheets are 4x4 grids of 16 variations — pick a cell, trim it to\n`
    + `content bounds, save it under assets/pixellab/picked/, then add it to\n`
    + `art/sprites.json and run npm run atlas. Keep the other fifteen cells:\n`
    + `they are free variants and are already paid for.`,
  )
}

main().catch((e: Error) => {
  console.error(`\npixellab failed: ${e.message}\n`)
  process.exit(1)
})
