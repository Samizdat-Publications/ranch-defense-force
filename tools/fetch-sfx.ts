/**
 * Generates sound effects with ElevenLabs and writes them to `public/audio/`.
 *
 *   ELEVENLABS_API_KEY=... npm run sfx            # only what is missing
 *   ELEVENLABS_API_KEY=... npm run sfx -- --force # regenerate everything
 *
 * Only the effects marked `"source": "elevenlabs"` in `src/content/audio.json`
 * are fetched. The rest stay synthesised on purpose — an XP pickup and a
 * level-up flourish are not real-world sounds, and a realistic recording of one
 * would fight the pixel art rather than serve it.
 *
 * ElevenLabs is here rather than Gemini because it has a purpose-built
 * text-to-sound-effects endpoint and Gemini does not. Gemini keeps the music,
 * where Lyria is the right tool. Two providers, each doing the thing it is
 * actually for.
 *
 * Nothing generated here is required: every effect keeps its synth spec, and
 * the engine falls back per sound. A missing key means a fully audible game.
 */
import { writeFileSync, mkdirSync, existsSync } from 'node:fs'
import audio from '../src/content/audio.json' with { type: 'json' }

const ENDPOINT = 'https://api.elevenlabs.io/v1/sound-generation'
const OUT_DIR = 'public/audio'
/**
 * Higher than the 0.3 default. These are utilitarian game sounds with precise
 * briefs — "no music", "no tail" — and variety is worth less here than getting
 * the thing that was asked for.
 */
const PROMPT_INFLUENCE = 0.7

const force = process.argv.includes('--force')
const key = process.env.ELEVENLABS_API_KEY

interface SfxSpec {
  source?: string
  file?: string
  prompt?: string
  durationSeconds?: number
}

async function generate(name: string, spec: SfxSpec): Promise<void> {
  const path = `${OUT_DIR}/${spec.file}`
  if (!force && existsSync(path)) {
    console.log(`  ${name.padEnd(12)} already present, skipping (--force to redo)`)
    return
  }

  process.stdout.write(`  ${name.padEnd(12)} generating... `)
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'xi-api-key': key as string },
    body: JSON.stringify({
      text: spec.prompt,
      // The API floor is 0.5s; several of these want to be 70ms, so the file
      // carries trailing silence. Harmless — playback is one-shot.
      duration_seconds: Math.max(0.5, spec.durationSeconds ?? 0.5),
      prompt_influence: PROMPT_INFLUENCE,
    }),
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`${res.status} ${res.statusText}\n${body.slice(0, 500)}`)
  }

  const bytes = Buffer.from(await res.arrayBuffer())
  mkdirSync(OUT_DIR, { recursive: true })
  writeFileSync(path, bytes)
  console.log(`${(bytes.length / 1024).toFixed(0)}KB -> ${path}`)
}

async function main(): Promise<void> {
  const specs = Object.entries(audio.sfx as Record<string, SfxSpec>)
    .filter(([, s]) => s.source === 'elevenlabs' && s.prompt && s.file)

  if (!key) {
    console.error(
      '\nELEVENLABS_API_KEY is not set.\n\n' +
      '  ELEVENLABS_API_KEY=your-key npm run sfx\n\n' +
      `This would generate ${specs.length} effects; the other ` +
      `${Object.keys(audio.sfx).length - specs.length} are synthesised and need nothing.\n` +
      'The game is fully audible without this — every effect has a synth\n' +
      'fallback, so this is an upgrade rather than a dependency.\n',
    )
    process.exit(1)
  }

  console.log(`generating ${specs.length} sound effects with ElevenLabs:`)
  for (const [name, spec] of specs) {
    await generate(name, spec)
  }
  console.log('\ndone. The game prefers these over synthesis on next load.')
}

main().catch((e: Error) => {
  console.error(`\nsfx generation failed: ${e.message}\n`)
  process.exit(1)
})
