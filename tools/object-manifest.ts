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

  /*
     The owner's own animals, generated from life.
     ------------------------------------------------------------------
     These are the CLEAN versions -- the farm as it is, for the title scene
     and the fenced yard. Their corrupted twins are separate objects and pack
     under their own ids; a state is a different object to PixelLab and must be
     a different sheet here, or the twin would overwrite the animal.

     Downloaded directory names are camelCase here where every entry above is
     snake_case, because these were downloaded with `npm run object -- <id>
     <name>` under the id the game will address them by. The map exists so the
     two can differ; it is not required that they match.
  */
  fjordPony: 'fjordPony',
  arabian: 'arabian',
  blackMule: 'blackMule',
  beigeMule: 'beigeMule',
  rosie: 'rosie',
  wiz: 'wiz',
  ouiji: 'ouiji',
  tabbyCat: 'tabbyCat',
  siameseCat: 'siameseCat',
  joy: 'joy',
  brahmaHen: 'brahmaHen',
  beardedHen: 'beardedHen',
  buffHen: 'buffHen',
  bantamHen: 'bantamHen',
  silkieHen: 'silkieHen',
  polishHen: 'polishHen',
  leghornHen: 'leghornHen',
  barredHen: 'barredHen',
  farmRooster: 'farmRooster',
  chick: 'chick',

  /*
     The corrupted twins.
     ------------------------------------------------------------------
     Made with `create_object_state` rather than as new objects, so each one is
     provably the SAME animal gone wrong rather than a different animal that
     happens to be grey. That relationship is the whole point: the title screen
     wants a clean farm that turns, and a transition only lands if the barn on
     the far side is the barn you were just looking at.

     The chick has no twin, deliberately. A rotting baby chick is a tonal call
     that belongs to the owner, not to whoever was generating art at the time;
     it is one command away if they want it.
  */
  fjordPonyBlight: 'fjordPonyBlight',
  arabianBlight: 'arabianBlight',
  blackMuleBlight: 'blackMuleBlight',
  beigeMuleBlight: 'beigeMuleBlight',
  rosieBlight: 'rosieBlight',
  wizBlight: 'wizBlight',
  ouijiBlight: 'ouijiBlight',
  tabbyCatBlight: 'tabbyCatBlight',
  siameseCatBlight: 'siameseCatBlight',
  joyBlight: 'joyBlight',
  brahmaHenBlight: 'brahmaHenBlight',
  beardedHenBlight: 'beardedHenBlight',
  buffHenBlight: 'buffHenBlight',
  bantamHenBlight: 'bantamHenBlight',
  silkieHenBlight: 'silkieHenBlight',
  polishHenBlight: 'polishHenBlight',
  leghornHenBlight: 'leghornHenBlight',
  barredHenBlight: 'barredHenBlight',
  farmRoosterBlight: 'farmRoosterBlight',
}

const DEATH = /^(buckling|toppling|folding|dropping|stumbling|collapsing)/

/**
 * Ambient clips -- the animals being animals rather than fighting.
 *
 * These exist for the title screen: a yard where twenty animals stand perfectly
 * still is a diorama, not a farm. They are named for what they are because the
 * fallback below is `attack`, and without this a grazing pony would pack as an
 * attack clip -- silently, and then play when something got close to it.
 *
 * It also keeps them from colliding. Two clips that classify the same kind are
 * resolved by "whichever has all eight directions wins", so an ambient clip
 * generated at three directions would simply be dropped in favour of a combat
 * one. Distinct names mean both survive.
 */
const AMBIENT: Record<string, string> = {
  grazing: 'graze',
  pecking: 'peck',
  crowing: 'crow',
  sitting: 'sit',
  scratching: 'scratch',
  preening: 'preen',
  sniffing: 'sniff',
  drinking: 'drink',
  resting: 'rest',
  standing: 'idleLoop',
}

/*
   Combat states the renderer selects between, keyed on their opening verb.

   `hit` and `walkHurt` are what make damage legible: a thing that takes a blow
   should flinch, and a thing that is nearly dead should look it. Both are
   OPTIONAL everywhere -- the renderer falls through to the next clip when one
   is absent -- so the roster can gain them one animal at a time.

   `staggering` and `limping` are listed for walkHurt because that is how the
   injured walk gets described when it is generated; `reeling`, `recoiling` and
   `flinching` all mean the recoil. Getting one of these wrong is silent: the
   clip packs under the wrong name and simply never plays.
*/
const HURT_WALK = /^(limping|staggering|hobbling|dragging)/
const HIT = /^(reeling|recoiling|flinching|jerking|snapping_back|taking)/

function kindOf(slug: string): string {
  if (HURT_WALK.test(slug)) return 'walkHurt'
  if (HIT.test(slug)) return 'hit'
  if (slug.startsWith('walking')) return 'walk'
  if (DEATH.test(slug)) return 'death'
  const first = slug.split('_')[0].toLowerCase()
  if (AMBIENT[first]) return AMBIENT[first]
  return 'attack'
}

const sheets: Record<string, unknown> = {}
const report: string[] = []

for (const [dir, id] of Object.entries(WANTED)) {
  const animDir = `${ROOT}/${dir}/animations`
  const probe = `${ROOT}/${dir}/rotations/south.png`
  if (!existsSync(probe)) { report.push(`SKIP ${dir}: no rotations/`); continue }

  // Cell size is per-animal and uniform within it; read it, do not assume.
  const cell = decodePng(readFileSync(probe)).width

  const clips: Record<string, { slug: string; frames: number; dirs?: string[] }> = {}

  /*
     An object with no animations is still worth packing. The eight rotations
     ARE a sheet, and that is all a fence-line animal standing in the title
     scene needs. Skipping it -- which is what this did before -- meant the
     only way to get an animal into the atlas was to buy it a walk cycle first.

     `clips` is left EMPTY, not given a synthetic `idle`. build-atlas.ts packs
     `<id>.idle.<dir>.0` from `rotations/` for every sheet in this group
     already, before it looks at clips at all; naming an idle here would send
     that same rotation through the animation loop as well, hunting for
     `animations//south/frame_000.png`, and the miss is an error, not a skip.
  */
  if (!existsSync(animDir)) {
    const present = DIRS.filter((d) => existsSync(`${ROOT}/${dir}/rotations/${d}.png`))
    if (present.length < 8) report.push(`  ${id}: WARNING only ${present.length}/8 rotations`)
    sheets[id] = { dir, cell, clips: {} }
    report.push(`${id.padEnd(18)} cell ${String(cell).padEnd(3)} idle:1f (rotations only, no clips)`)
    continue
  }

  for (const slug of readdirSync(animDir)) {
    if (!statSync(`${animDir}/${slug}`).isDirectory()) continue
    const present = DIRS.filter((d) => existsSync(`${animDir}/${slug}/${d}`))
    /*
       The MINIMUM frame count across the directions present, not the first
       one's.

       An object downloaded while its animation was still generating has
       directions at different lengths, and trusting the first one makes the
       manifest promise frames that are not on disk -- which the packer then
       reports as a wall of ENOENT rather than as "this download was early".
       Taking the minimum packs a short but complete clip instead.
    */
    const frames = present.length
      ? Math.min(...present.map((d) => readdirSync(`${animDir}/${slug}/${d}`).filter((f) => f.endsWith('.png')).length))
      : 0
    const kind = kindOf(slug)
    const existing = clips[kind]
    // All eight directions beats a partial clip, whatever arrived first.
    if (existing && present.length < 8) { report.push(`  ${id}: ignoring partial ${kind} "${slug}" (${present.length}/8)`); continue }
    if (existing) report.push(`  ${id}: replacing partial ${kind} with "${slug}" (${present.length}/8)`)
    /*
       AMBIENT CLIPS ARE DELIBERATELY PARTIAL, and must not be warned about.

       A grazing pony is only ever seen from the few facings a scene actually
       uses, so buying eight directions of it buys five nobody looks at. The
       directions that DO exist are recorded on the clip so the packer knows
       what to expect rather than erroring on the absent ones.

       A combat clip missing a direction is still a defect -- that is an enemy
       that vanishes when it turns -- so the warning is kept for those.
    */
    const combat = kind === 'walk' || kind === 'attack' || kind === 'death'
    if (present.length < 8 && combat) {
      report.push(`  ${id}: WARNING ${kind} "${slug}" has only ${present.length}/8 directions`)
    }
    clips[kind] = present.length < 8 ? { slug, frames, dirs: present } : { slug, frames }
  }
  sheets[id] = { dir, cell, clips }
  report.push(`${id.padEnd(18)} cell ${String(cell).padEnd(3)} ${Object.entries(clips).map(([k, v]) => `${k}:${v.frames}f`).join(' ')}`)
}

// The eight idle frames build-atlas.ts packs from `rotations/` are counted
// here too. Leaving them out made a rotations-only animal report as zero
// frames, which reads as "packed nothing" for a sheet that packs eight.
const total = Object.values(sheets).reduce<number>((n, s) => {
  const sh = s as { clips: Record<string, { frames: number }> }
  return n + 8 + Object.values(sh.clips).reduce((m, c) => m + c.frames * 8, 0)
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
