/**
 * Write the `pixellabObjects` block of `art/sprites.json` by SCANNING the
 * downloaded objects, rather than by hand.
 *
 *     npm run objman            # print what it would write
 *     npm run objman -- --write # write it
 *
 * Why scan: PixelLab names an animation folder after its DESCRIPTION,
 * slugified and truncated to 48 characters —
 * "walking_with_a_heavy_dragging_stagger_head_swingi". That is per-animal,
 * unguessable, and a typo in it produces a missing-sprite coloured square
 * rather than an error. Reading it off disk is the only way it stays true when
 * an animal is regenerated.
 *
 * Clips are classified by their opening verb, because the descriptions were
 * written per species and share no other structure:
 *
 *   walking…                                        -> walk
 *   buckling / toppling / folding / dropping /
 *   stumbling / collapsing …                        -> death
 *   anything else (lunging, lowering, darting,
 *   flaring, rearing, kicking, charging …)          -> attack
 *
 * **Where an animal has more than one clip of a kind, the one with all eight
 * directions wins.** Two animals carry a half-finished walk from an earlier
 * session — bull_cursed's "a heavy lurching gait" and barn_dog_cursed2's "a
 * stiff lurching limp" — with only four directions each. Picking those would
 * silently give those two animals a walk that vanishes when they turn.
 */
import { readdirSync, readFileSync, writeFileSync, existsSync, statSync } from 'node:fs'
import { decodePng } from './png.ts'

const ROOT = 'assets/pixellab/object'
const DIRS = ['south', 'south-west', 'west', 'north-west', 'north', 'north-east', 'east', 'south-east']

/**
 * Downloaded object directory -> the atlas sheet id it packs under.
 *
 * **The id must be the ENEMY TYPE ID for anything replacing an enemy**, because
 * that is what the frame key is built from. Both renderers ask for
 * `${e.typeId}.${clip}.${dir}.${frame}` — `src/render/renderer.ts` and, with a
 * second copy of the same rules, `tools/draw-world.ts`. The `sheet` field in
 * `src/content/enemies.json` is NOT read by either of them; the `animals` group
 * in this manifest is likewise keyed by enemy type id, not by species.
 *
 * Getting this wrong is silent: the art packs perfectly, the game keeps drawing
 * the old sprite, and nothing errors. It cost one screenshot to catch.
 *
 * Where a generated animal takes an enemy's id, **the LimeZu entry for that id
 * must be deleted from the `animals` group** — two groups writing one key means
 * the later pass wins and which one that is depends on file order.
 */
const WANTED: Record<string, string> = {
  // Replacing an enemy: id is the enemy type id.
  barn_dog_cursed2: 'feralDog',
  infected_rooster_rotten: 'rooster',
  infected_hog_rotten: 'sickHog',
  infected_sheep_rotten: 'blownSheep',
  bull_cursed: 'prizeBull',
  // Not yet bound to an enemy or summon; packed under their own names so they
  // are available without claiming a key anything else draws.
  arabian_cursed: 'arabianCursed',
  donkey_cursed: 'donkeyCursed',
  draft_mule_cursed: 'draftMuleCursed',
  fjord_pony_cursed2: 'fjordPonyCursed',
  infected_hen_rotten: 'infectedHen',
  whitacre_bull: 'whitacreBull',
  barn_dog: 'barnDog',
}

const DEATH = /^(buckling|toppling|folding|dropping|stumbling|collapsing)/

function kindOf(slug: string): 'walk' | 'attack' | 'death' {
  if (slug.startsWith('walking')) return 'walk'
  if (DEATH.test(slug)) return 'death'
  return 'attack'
}

const sheets: Record<string, unknown> = {}
const report: string[] = []

for (const [dir, id] of Object.entries(WANTED)) {
  const animDir = `${ROOT}/${dir}/animations`
  if (!existsSync(animDir)) { report.push(`SKIP ${dir}: no animations/`); continue }

  // Cell size is per-animal and uniform within it; read it, do not assume.
  const probe = `${ROOT}/${dir}/rotations/south.png`
  const cell = decodePng(readFileSync(probe)).width

  const clips: Record<string, { slug: string; frames: number }> = {}
  for (const slug of readdirSync(animDir)) {
    if (!statSync(`${animDir}/${slug}`).isDirectory()) continue
    const present = DIRS.filter((d) => existsSync(`${animDir}/${slug}/${d}`))
    const frames = present.length ? readdirSync(`${animDir}/${slug}/${present[0]}`).filter((f) => f.endsWith('.png')).length : 0
    const kind = kindOf(slug)
    const existing = clips[kind]
    // All eight directions beats a partial clip, whatever arrived first.
    if (existing && present.length < 8) { report.push(`  ${id}: ignoring partial ${kind} "${slug}" (${present.length}/8)`); continue }
    if (existing) report.push(`  ${id}: replacing partial ${kind} with "${slug}" (${present.length}/8)`)
    if (present.length < 8) report.push(`  ${id}: WARNING ${kind} "${slug}" has only ${present.length}/8 directions`)
    clips[kind] = { slug, frames }
  }
  sheets[id] = { dir, cell, clips }
  report.push(`${id.padEnd(18)} cell ${String(cell).padEnd(3)} ${Object.entries(clips).map(([k, v]) => `${k}:${v.frames}f`).join(' ')}`)
}

const total = Object.values(sheets).reduce<number>((n, s) => {
  const sh = s as { clips: Record<string, { frames: number }> }
  return n + Object.values(sh.clips).reduce((m, c) => m + c.frames * 8, 0)
}, 0)

console.log(report.join('\n'))
console.log(`\n${Object.keys(sheets).length} animals, ${total} frames at eight directions`)

if (process.argv.includes('--write')) {
  const manifest = JSON.parse(readFileSync('art/sprites.json', 'utf8')) as Record<string, unknown>
  const prev = manifest.pixellabObjects as { _note?: string } | undefined
  manifest.pixellabObjects = {
    _note: 'Generated 8-direction animals — enemies and the two summons. Frame keys are id.clip.direction.frame, the same convention as every other sheet.',
    _generatedBy: 'tools/object-manifest.ts — run `npm run objman -- --write` after downloading or regenerating an animal. The clip slugs are PixelLab folder names (the description, slugified and truncated) and must never be typed by hand.',
    _base: 'assets/pixellab/object/',
    compassToDirection: {
      south: 'down', 'south-west': 'downLeft', west: 'left', 'north-west': 'upLeft',
      north: 'up', 'north-east': 'upRight', east: 'right', 'south-east': 'downRight',
    },
    sheets,
  }
  if (prev) console.log('(replacing the existing pixellabObjects block)')
  writeFileSync('art/sprites.json', JSON.stringify(manifest, null, 1) + '\n')
  console.log('art/sprites.json updated')
}
