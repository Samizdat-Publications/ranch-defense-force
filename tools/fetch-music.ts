/**
 * Generates the three music layers with Lyria 3 and writes them to
 * `public/audio/`.
 *
 *   GEMINI_API_KEY=... npm run music          # only what is missing
 *   GEMINI_API_KEY=... npm run music -- --force   # regenerate everything
 *
 * Offline, like the atlas. The game never calls this — a network round trip
 * inside a game loop is not a soundtrack, it is a stutter. The prompts live in
 * `src/content/audio.json` and are the source of truth for the score: tune the
 * prose there and re-run, do not edit the audio.
 *
 * Sound EFFECTS are not here on purpose. Gemini has Lyria for music and TTS for
 * speech and no sound-effects model — verified against the API docs. Asking a
 * music model for a 90ms shotgun report gets you a short piece of music about a
 * shotgun. Effects are synthesised in `src/core/audio.ts` instead.
 */
import { writeFileSync, mkdirSync, existsSync } from 'node:fs'
import audio from '../src/content/audio.json' with { type: 'json' }

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/interactions'
/** Clip always returns 30 seconds, which is the right length for a loop. */
const MODEL = 'lyria-3-clip-preview'
const OUT_DIR = 'public/audio'

const force = process.argv.includes('--force')
const key = process.env.GEMINI_API_KEY

/** Pull the first audio block out of a response, whatever it is nested in. */
function findAudio(payload: unknown): string | null {
  const seen = new Set<unknown>()
  const walk = (node: unknown): string | null => {
    if (!node || typeof node !== 'object' || seen.has(node)) return null
    seen.add(node)
    const obj = node as Record<string, unknown>
    // An audio block carries base64 in `data`, either directly or under `audio`.
    if (obj.type === 'audio') {
      const a = obj.audio as { data?: string } | undefined
      const data = a?.data ?? (obj.data as string | undefined)
      if (typeof data === 'string' && data.length > 0) return data
    }
    for (const v of Object.values(obj)) {
      if (Array.isArray(v)) {
        for (const item of v) {
          const hit = walk(item)
          if (hit) return hit
        }
      } else {
        const hit = walk(v)
        if (hit) return hit
      }
    }
    return null
  }
  return walk(payload)
}

async function generate(name: string, prompt: string, file: string): Promise<void> {
  const path = `${OUT_DIR}/${file}`
  if (!force && existsSync(path)) {
    console.log(`  ${name.padEnd(8)} already present, skipping (use --force to redo)`)
    return
  }

  process.stdout.write(`  ${name.padEnd(8)} generating... `)
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key as string },
    body: JSON.stringify({ model: MODEL, input: prompt }),
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(
      `${res.status} ${res.statusText}\n${body.slice(0, 600)}\n\n` +
      `If this is a 404 on the model, Lyria may not be enabled for this key — ` +
      `it is a preview model and access is gated separately from ordinary Gemini.`,
    )
  }

  const payload: unknown = await res.json()
  const b64 = findAudio(payload)
  if (!b64) {
    throw new Error(
      `no audio block in the response for "${name}". Response shape was:\n` +
      `${JSON.stringify(payload, null, 2).slice(0, 800)}`,
    )
  }

  const bytes = Buffer.from(b64, 'base64')
  mkdirSync(OUT_DIR, { recursive: true })
  writeFileSync(path, bytes)
  console.log(`${(bytes.length / 1024).toFixed(0)}KB -> ${path}`)
}

async function main(): Promise<void> {
  if (!key) {
    console.error(
      '\nGEMINI_API_KEY is not set.\n\n' +
      '  PowerShell:  $env:GEMINI_API_KEY=\"your-key\"; npm run music\n' +
      '  cmd.exe:     set GEMINI_API_KEY=your-key && npm run music\n' +
      '  bash/zsh:    GEMINI_API_KEY=your-key npm run music\n\n' +
      'NOTE: the bash form is a PARSE ERROR in PowerShell. That is what\n' +
      '"is not recognized as the name of a cmdlet" means. Use the $env: form.\n\n' +
      'The three prompts live in src/content/audio.json under music.layers.\n' +
      'Nothing else is needed — sound effects are synthesised at runtime and do\n' +
      'not come from this tool.\n',
    )
    process.exit(1)
  }

  const layers = Object.entries(audio.music.layers) as [string, { file: string; prompt: string }][]
  console.log(`generating ${layers.length} music layers with ${MODEL}:`)
  for (const [name, layer] of layers) {
    await generate(name, layer.prompt, layer.file)
  }
  console.log('\ndone. The game picks these up on next load; no rebuild needed.')
}

main().catch((e: Error) => {
  console.error(`\nmusic generation failed: ${e.message}\n`)
  process.exit(1)
})
