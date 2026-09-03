/**
 * Assert that every blight counterpart the home screen names is really packed.
 *
 *     npm run blight
 *
 * ## Why this exists
 *
 * Session 21's lesson, twice over. A document saying art exists is not evidence
 * that it does — `DESIGN_BRIEF_HOMESCREEN.md` blocked on a barn that had been
 * generated and paid for sessions earlier — and the reverse is just as true: a
 * table of sheet names in `src/ui/scene.ts` is a claim, not a fact, and a
 * missing key there fails SILENTLY. `stripUrl` returns null, `patrolLayer`
 * returns null, the layer is skipped, and the blighted farm quietly has one
 * fewer animal in it than the calm one. Nothing errors and nothing logs.
 *
 * So the table is checked against `public/atlas.json`, by reading it, before
 * anybody trusts it.
 *
 * ## What "resolves" means here
 *
 * `blightStrip` in scene.ts falls back by clip: the same clip on the blighted
 * sheet, then the spare sheet, then `walk`, then `idle`. This walks the same
 * ladder and reports WHICH rung each actor lands on, because that is the
 * interesting part — `joyBlight` is idle-only, so the blighted Joy is a still,
 * and that is a design fact worth seeing rather than a failure.
 *
 * Exits non-zero if any actor resolves to nothing at all.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

type Atlas = {
  frames: Record<string, { x: number; y: number; w: number; h: number }>
  clipLengths: Record<string, Record<string, number>>
}

const atlasPath = fileURLToPath(new URL('../public/atlas.json', import.meta.url))
let atlas: Atlas
try {
  atlas = JSON.parse(readFileSync(atlasPath, 'utf8')) as Atlas
} catch {
  console.error(`no atlas at ${atlasPath} — run \`npm run atlas\` first`)
  process.exit(2)
}

/** Mirrors BLIGHT_SHEET in src/ui/scene.ts. Keep the two in step. */
const SHEET: Record<string, string> = {
  joy: 'joyBlight',
  tabbyCat: 'tabbyCatBlight',
  brahmaHen: 'brahmaHenBlight',
  leghornHen: 'leghornHenBlight',
  beardedHen: 'beardedHenBlight',
  silkieHen: 'silkieHenBlight',
  barredHen: 'barredHenBlight',
  polishHen: 'polishHenBlight',
  buffHen: 'buffHenBlight',
  bantamHen: 'bantamHenBlight',
  farmRooster: 'farmRoosterBlight',
  fjordPony: 'fjordPonyCursed',
  arabian: 'arabianCursed',
  blackMule: 'blackMuleBlight',
  beigeMule: 'beigeMuleBlight',
  rosie: 'rosieBlight',
  wiz: 'wizBlight',
  ouiji: 'ouijiBlight',
  siameseCat: 'siameseCatBlight',
}

/** Mirrors BLIGHT_SPARE. */
const SPARE: Record<string, string> = {
  farmRooster: 'infectedHen',
  brahmaHen: 'infectedHen',
  leghornHen: 'infectedHen',
  fjordPony: 'fjordPonyBlight',
}

/** Mirrors BLIGHT_STRIP: the field's baked strips and who they turn into. */
const STRIP: Record<string, { sheet: string; clip: string; dir: string }> = {
  'scene.farmerIdleBreatheStrip': { sheet: 'farmhand', clip: 'idle', dir: 'down' },
  'scene.farmer2IdleBreatheStrip': { sheet: 'bloatedFarmhand', clip: 'idle', dir: 'down' },
  'scene.farmerWalkStrip': { sheet: 'farmhand', clip: 'walk', dir: 'left' },
  'scene.chickenPeckStrip': { sheet: 'infectedHen', clip: 'idle', dir: 'down' },
  'scene.chickenWalkLeftStrip': { sheet: 'infectedHen', clip: 'walk', dir: 'left' },
}

/**
 * Every clip the two surface scenes actually ask for, sheet by sheet.
 *
 * Read out of `yard()` and `field()` rather than guessed. If a scene grows an
 * actor, add it here — the check is only as good as the list of things checked.
 */
const ASKED: readonly (readonly [string, string, string])[] = [
  ['brahmaHen', 'peck', 'downRight'],
  ['brahmaHen', 'peck', 'down'],
  ['leghornHen', 'walk', 'down'],
  ['beardedHen', 'walk', 'down'],
  ['silkieHen', 'walk', 'down'],
  ['barredHen', 'walk', 'down'], ['barredHen', 'walk', 'left'],
  ['polishHen', 'walk', 'down'], ['polishHen', 'walk', 'left'],
  ['farmRooster', 'walk', 'down'], ['farmRooster', 'walk', 'left'],
  ['tabbyCat', 'walk', 'left'],
  ['fjordPony', 'graze', 'downRight'], ['fjordPony', 'walk', 'left'],
  ['joy', 'sit', 'downRight'], ['joy', 'walk', 'right'], ['joy', 'walk', 'left'],
]

/** The scenery with no counterpart at all. These are expected to filter. */
const FILTERED = [
  'windmill', 'scarecrow', 'wheat',
  'ranch.*', 'scene.oak', 'scene.treeOak', 'scene.tractorLeft',
  'scene.wheat', 'scene.wheat2', 'scene.fencePicket', 'scene.hay',
  'scene.silo', 'scene.barn', 'scene.house', 'scene.scarecrowSwayStrip',
]

/** The soil column between the farm and the lab. Every key must resolve. */
const SOIL = [
  'terrain.soil', 'terrain.dirt', 'base.wallPipes',
  'cave.branches0', 'cave.branches1', 'cave.branches2',
  'cave.branches3', 'cave.branches4', 'cave.branches5',
  'node.rockBig', 'node.rockMedium', 'node.rockSmall',
]

function frames(sheet: string, clip: string, dir: string): number {
  const n = atlas.clipLengths[sheet]?.[clip]
  if (!n) return 0
  for (let i = 0; i < n; i++) if (!atlas.frames[`${sheet}.${clip}.${dir}.${i}`]) return 0
  return n
}

let bad = 0
console.log('actor                       clip        -> blighted as')
for (const [sheet, clip, dir] of ASKED) {
  const sheets = [SHEET[sheet], SPARE[sheet]].filter(Boolean)
  let hit = ''
  outer: for (const s of sheets) {
    for (const c of [clip, 'walk', 'idle']) {
      const n = frames(s, c, dir)
      if (n) { hit = `${s}.${c}.${dir}  (${n} frame${n === 1 ? '' : 's'})`; break outer }
    }
  }
  if (!hit) { hit = 'NOTHING'; bad++ }
  console.log(`${(sheet + '.' + dir).padEnd(28)}${clip.padEnd(12)}-> ${hit}`)
}

console.log('\nbaked field strip           -> blighted as')
for (const [name, m] of Object.entries(STRIP)) {
  const n = frames(m.sheet, m.clip, m.dir)
  if (!n) bad++
  console.log(`${name.padEnd(28)}-> ${n ? `${m.sheet}.${m.clip}.${m.dir}  (${n} frames)` : 'NOTHING'}`)
}

console.log('\nsoil column')
for (const k of SOIL) {
  const ok = !!atlas.frames[k]
  if (!ok) bad++
  console.log(`  ${k.padEnd(24)}${ok ? 'ok' : 'MISSING'}`)
}

console.log(`\nno counterpart, graded by filter instead: ${FILTERED.join(', ')}`)
if (bad) {
  console.error(`\n${bad} mapping(s) resolve to nothing — the blighted scene is missing actors.`)
  process.exit(1)
}
console.log('\nevery blight mapping resolves.')
