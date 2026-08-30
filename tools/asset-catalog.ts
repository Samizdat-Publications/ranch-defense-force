/**
 * What a SCENE can draw, written to a file in the repo.
 *
 *     npm run catalog
 *
 * NOT the same thing as `docs/PIXELLAB_INVENTORY.md`, and the difference is the
 * point. That one lists what the PixelLab ACCOUNT holds -- uuids, prompts, a
 * review backlog -- and answers "have we already generated this?". It is
 * useless to anyone composing a scene, because none of it can be drawn: a uuid
 * is not an atlas key.
 *
 * This one reads `public/atlas.json`, which is what actually shipped, and lists
 * every frame key a scene can call `spriteEl()` with, grouped the way a person
 * thinks about a farm rather than the way the packer thinks about a manifest.
 * It also says which of them can MOVE, because that is the question a designer
 * asks second and there was previously no way to answer it short of reading the
 * packer.
 *
 * Committed, so Claude Design and any future session can read it without an API
 * key and without running anything. Regenerate after `npm run atlas`.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { decodePng, encodePng, blankImage, type Image } from './png.ts'

interface Frame { x: number; y: number; w: number; h: number; ox: number; oy: number }
interface Atlas {
  frames: Record<string, Frame>
  clipLengths: Record<string, Record<string, number>>
  dirSets: Record<string, string[]>
}

const atlas = JSON.parse(readFileSync('public/atlas.json', 'utf8')) as Atlas
const sheet = decodePng(readFileSync('public/atlas.png'))
const keys = Object.keys(atlas.frames)

/**
 * The owner's own animals, which are not a category so much as a cast.
 *
 * Kept as an explicit list because they are the emotional centre of any scene
 * and a prefix rule would bury them among two hundred props. Order is the order
 * the owner described them in.
 */
const CAST: [string, string][] = [
  ['fjordPony', 'white thick Fjord pony, blonde mane'],
  ['arabian', 'Arabian, brown with a golden mane'],
  ['blackMule', 'the black charge mule'],
  ['beigeMule', 'the beige charge mule'],
  ['rosie', 'Rosie — small brown-and-white mule/donkey'],
  ['wiz', 'Wiz — black cat, GREEN eyes'],
  ['ouiji', 'Ouiji — black cat, YELLOW-GREEN eyes'],
  ['tabbyCat', 'the brown tabby'],
  ['siameseCat', 'the white siamese'],
  ['joy', 'Joy — tan-and-white bulldog, the level-up companion'],
  ['brahmaHen', 'light Brahma, feathered feet'],
  ['beardedHen', 'bearded Ameraucana, slate blue'],
  ['buffHen', 'buff Orpington — the big one'],
  ['bantamHen', 'bantam — the small one'],
  ['silkieHen', 'Silkie — all puffy fur'],
  ['polishHen', 'Polish crested — the enormous head puff'],
  ['leghornHen', 'white Leghorn, big floppy comb'],
  ['barredHen', 'barred Plymouth Rock'],
  ['farmRooster', 'the rooster, green-black sickle tail'],
  ['chick', 'the yellow chick'],
]

/**
 * WHAT SIZE TO DRAW IT AT. This table is the most useful thing in this file.
 *
 * THE SOURCE ART IS NOT TO SCALE, and nothing about the atlas says so. Every
 * animal is authored on the game's 32x64 grid because in the game every entity
 * IS a grid cell -- so `wiz` (a cat) is 16x42, `brahmaHen` is 26x43, `joy` (a
 * bulldog) is 29x42, `blackMule` is 28x63 and `hand` (a grown man) is 30x52.
 * Five things within a few pixels of each other that are nothing like the same
 * size in life. Drawn at 1:1 in a scene they make a lineup of identical
 * silhouettes, and that is exactly what the first title screens came out as: a
 * bulldog the size of a pony and hens the size of cats.
 *
 * The buildings are on a THIRD scale with no relation to either family:
 * `ranch.barn` is 400px wide, `ranch.coop` 128 and `ranch.windmill` 128 -- a
 * chicken coop drawn at a third of a barn, and a windmill drawn the same as the
 * coop when it should be taller than the barn is wide.
 *
 * So the numbers below are NOT canvas sizes. They are derived from what the
 * thing actually is, against one stated reference:
 *
 *     A GROWN PERSON IS 64 PIXELS TALL.  =>  36.6 px per metre.
 *
 * A barn is about 12m wide, so 440. A round bale is 1.5m, so 55. A cat is
 * about 25cm at the shoulder, which would be 9px and unreadable, so the small
 * animals are deliberately drawn ABOVE life scale -- readability wins over
 * arithmetic, and the numbers here are the stylised ones to actually use.
 * What matters is that they are CONSISTENT: a hen is smaller than a dog is
 * smaller than a pony is smaller than a barn, always, in every scene.
 *
 * Pass the number to `spriteEl(key, size)`. For the cast it is a HEIGHT; for
 * buildings and vehicles, whichever dimension the entry names.
 */
const SCENE_SCALE: Record<string, number> = {
  // --- the cast, by height ---------------------------------------------
  arabian: 104, blackMule: 100, beigeMule: 100, fjordPony: 96, rosie: 76,
  farmRooster: 46, joy: 40, brahmaHen: 40, buffHen: 40, leghornHen: 36,
  wiz: 36, ouiji: 36, tabbyCat: 36, siameseCat: 36,
  beardedHen: 34, barredHen: 34, polishHen: 34, silkieHen: 30,
  bantamHen: 26, chick: 16,
  // The playable classes, and the reference every other number is against.
  hand: 64, vet: 64, widow: 64, drifter: 64, kid: 64, agronomist: 64,
  // --- buildings and vehicles, by WIDTH unless noted --------------------
  'ranch.barn': 440,
  'ranch.farmhouse': 330,
  'ranch.bunkhouse': 256,
  'ranch.biplane': 293,
  'ranch.silo': 146,        // ...and ~440 TALL. A silo is as tall as a barn is wide.
  'ranch.windmill': 100,    // ...and ~366 TALL. Taller than the barn. Never draw it square.
  'ranch.tractor': 146,
  'ranch.tractorRed': 128,
  'ranch.hayWagon': 146,
  'ranch.coop': 92,
  'ranch.coopBroken': 80,
  'ranch.waterTrough': 73,
  'ranch.fenceRail': 73,
  'ranch.fenceRailBroken': 73,
  'ranch.well': 55,
  'ranch.wellStone': 55,
  'ranch.roundBale': 55,
  'ranch.roundBaleRotted': 55,
  'ranch.squareBales': 37,
  'ranch.feedBin': 37,
  'ranch.fencePost': 20,
  'ranch.fenceCorner': 20,
  'ranch.feedBucket': 13,
}

/** Frame keys grouped by their dotted prefix. */
const byPrefix = new Map<string, string[]>()
for (const k of keys) {
  const p = k.split('.')[0]
  const list = byPrefix.get(p) ?? []
  list.push(k)
  byPrefix.set(p, list)
}

/** A sheet's clips, or null when it is a plain single sprite. */
function clipsFor(id: string): Record<string, number> | null {
  const c = atlas.clipLengths[id]
  return c && Object.keys(c).length ? c : null
}

function sizeOf(key: string): string {
  const f = atlas.frames[key]
  return f ? `${f.w}x${f.h}` : '?'
}

/* ------------------------------------------------------------ contact sheets */

mkdirSync('docs/catalog', { recursive: true })

/**
 * A labelled grid of sprites, so the catalog can be LOOKED AT.
 *
 * A designer choosing between sixteen oil drums cannot do it from a list of
 * sixteen names, and the whole reason this project keeps rediscovering its own
 * art is that the art was only ever described in prose. Every sheet written
 * here is one image a reader can open.
 */
function contactSheet(out: string, names: string[], scale: number, cols: number): void {
  if (!names.length) return
  const cells = names.map((n) => atlas.frames[n]).filter(Boolean)
  if (!cells.length) return
  const cw = Math.max(...cells.map((f) => f.w)) * scale + 6
  const ch = Math.max(...cells.map((f) => f.h)) * scale + 6
  const rows = Math.ceil(cells.length / cols)
  const img: Image = blankImage(cw * cols, ch * rows)
  for (let i = 0; i < img.data.length; i += 4) {
    img.data[i] = 74; img.data[i + 1] = 74; img.data[i + 2] = 82; img.data[i + 3] = 255
  }
  cells.forEach((f, n) => {
    const ox = (n % cols) * cw + 3
    const oy = ((n / cols) | 0) * ch + 3
    for (let y = 0; y < f.h * scale; y++) {
      for (let x = 0; x < f.w * scale; x++) {
        const s = ((f.y + ((y / scale) | 0)) * sheet.width + f.x + ((x / scale) | 0)) * 4
        const a = sheet.data[s + 3] / 255
        if (a <= 0) continue
        const d = ((oy + y) * img.width + ox + x) * 4
        for (let c = 0; c < 3; c++) {
          img.data[d + c] = sheet.data[s + c] * a + img.data[d + c] * (1 - a)
        }
      }
    }
  })
  writeFileSync(`docs/catalog/${out}.png`, encodePng(img))
}

const castClean = CAST.map(([id]) => `${id}.idle.down.0`).filter((k) => atlas.frames[k])
const castBlight = CAST.map(([id]) => `${id}Blight.idle.down.0`).filter((k) => atlas.frames[k])
contactSheet('cast-clean', castClean, 3, 5)
contactSheet('cast-blighted', castBlight, 3, 5)
contactSheet('scene', (byPrefix.get('scene') ?? []).sort(), 2, 8)
contactSheet('ranch', (byPrefix.get('ranch') ?? []).sort(), 1, 6)
contactSheet('props', (byPrefix.get('prop') ?? []).sort(), 3, 8)
contactSheet('crops', (byPrefix.get('crop') ?? []).sort(), 3, 8)
contactSheet('nodes', (byPrefix.get('node') ?? []).sort(), 3, 8)
contactSheet('cave', (byPrefix.get('cave') ?? []).sort(), 2, 6)
contactSheet('items', (byPrefix.get('item') ?? []).sort(), 3, 10)

/* ----------------------------------------------------------------- the page */

const L: string[] = []
L.push('# Asset catalog — what a scene can draw')
L.push('')
L.push('**Generated by `npm run catalog`. Do not hand-edit.**')
L.push('')
L.push(`${keys.length} frame keys in \`public/atlas.png\`.`)
L.push('')
L.push('This is not `docs/PIXELLAB_INVENTORY.md`. That one lists what the PixelLab')
L.push('account holds and answers *"have we already generated this?"*. **This one lists')
L.push('what is packed and drawable**, and answers *"what can I put on screen?"* — a')
L.push('uuid is not an atlas key, and a scene can only draw atlas keys.')
L.push('')
L.push('## READ THIS FIRST — the art is not to scale')
L.push('')
L.push('**Never draw a sprite at its source size.** Every animal is authored on the')
L.push("game's 32x64 grid, because in the game every entity IS a grid cell. So:")
L.push('')
L.push('| | source | | source |')
L.push('|---|---|---|---|')
L.push('| `wiz` — a cat | 16x42 | `hand` — a grown man | 30x52 |')
L.push('| `brahmaHen` — a hen | 26x43 | `blackMule` — a mule | 28x63 |')
L.push('| `joy` — a bulldog | 29x42 | `fjordPony` — a pony | 25x53 |')
L.push('')
L.push('Six things within a few pixels of each other that are nothing like the same')
L.push('size in life. Drawn 1:1 they are a row of identical silhouettes — which is')
L.push('exactly what the first title screens came out as, with a bulldog the size of')
L.push('a pony. The buildings are on a THIRD scale again: `ranch.barn` is 400px wide')
L.push('and `ranch.windmill` 128, when a windmill is taller than a barn is wide.')
L.push('')
L.push('So **every table below has a `draw at` column**, derived from what the thing')
L.push('actually is against one reference:')
L.push('')
L.push('> **A grown person is 64px tall.** That is 36.6px per metre.')
L.push('')
L.push('Small animals sit deliberately above life scale — a cat at true scale is 9px')
L.push('and unreadable — but the ORDER is always right: hen < dog < pony < barn. Use')
L.push('the `draw at` number and the scene composes itself.')
L.push('')
L.push('Two that are not square and are usually drawn wrong:')
L.push('')
L.push('- `ranch.silo` — **146 wide, 440 tall.** As tall as the barn is wide.')
L.push('- `ranch.windmill` — **100 wide, 366 tall.** Taller than the barn. Never square.')
L.push('')
L.push('## How to draw one — USE THESE TWO, not `spriteEl`')
L.push('')
L.push('```ts')
L.push("sceneSprite('ranch.barn', 440)                        // exact height, on the ground")
L.push("sceneSprite('rosie', 76, { facing: 'downRight' })     // any of the eight facings")
L.push("groundActor('fjordPony', 'walk', 'left', x, footY, 96, '1.1s')   // ANIMATED")
L.push('```')
L.push('')
L.push('`sceneSprite` and `groundActor` (both from `src/ui/scene.ts`) do two things')
L.push('`spriteEl` and `clipActor` deliberately do not, and both were bugs in the')
L.push('first title screens:')
L.push('')
L.push('**1. They hit the height you ask for.** `spriteEl` snaps to whole-pixel zoom,')
L.push('which is right for a card and wrong here: every animal is authored on the')
L.push('32x64 grid, so integer zoom pins them all to 1x and they all render at about')
L.push('fifty pixels *whatever box you pass*. `spriteEl(\'joy\', 40)` and')
L.push("`spriteEl('fjordPony', 96)` come back 40px and 53px tall — a bulldog nearly")
L.push('as tall as a pony, and no better numbers fix it because the numbers were')
L.push('being ignored. `sceneSprite` scales fractionally and hits the number exactly.')
L.push('')
L.push('**2. They put things on the ground.** Every sprite gets a soft contact')
L.push('shadow, and `groundActor` positions by the FEET (`footY`), not the top.')
L.push('*"Everything is in the air"* was the note the first screens came back with,')
L.push('and one ellipse is the whole fix — the eye reads ground contact from the')
L.push('shadow before it reads placement. `footY` is also the depth in a scene like')
L.push('this, so `groundActor` sets `z-index` from it and back-to-front sorting is')
L.push('free.')
L.push('')
L.push('`spriteEl` and `clipActor` are still correct for CARDS, where every sprite')
L.push('sits in its own fixed window and pixel purity is what matters.')
L.push('')
L.push('`clipActor` composes the strip at runtime from frames already in the atlas,')
L.push('so any clip listed below can be animated with no new art and no atlas growth.')
L.push('Ask `clipsOf(sheet)` at runtime for the same table printed here.')
L.push('')
L.push('**Eight facings** on every animal sheet: `down`, `downLeft`, `left`, `upLeft`,')
L.push('`up`, `upRight`, `right`, `downRight`. Use them. A yard where every animal')
L.push('faces the camera is a lineup, not a farm.')
L.push('')

L.push('## The cast — the owner\'s own farm')
L.push('')
L.push('![clean](catalog/cast-clean.png)')
L.push('')
L.push('![blighted](catalog/cast-blighted.png)')
L.push('')
L.push('Nineteen have a blighted twin made as a *state* of the same object, so the')
L.push('twin is provably the same animal gone wrong — same pose, same size, same')
L.push('canvas. A cross-fade between `x.idle.down.0` and `xBlight.idle.down.0` lands')
L.push('with nothing to re-register. That is what makes the corruption cut cheap.')
L.push('')
L.push('| clean | blighted | **draw at** | source | animated clips | who |')
L.push('|---|---|---|---|---|---|')
for (const [id, who] of CAST) {
  const clips = clipsFor(id)
  const moving = clips
    ? Object.entries(clips).filter(([, n]) => n > 1).map(([c, n]) => `${c} (${n}f)`).join(', ')
    : ''
  const twin = atlas.frames[`${id}Blight.idle.down.0`] ? `\`${id}Blight\`` : '—'
  const draw = SCENE_SCALE[id] ? `**${SCENE_SCALE[id]}px tall**` : '—'
  L.push(`| \`${id}\` | ${twin} | ${draw} | ${sizeOf(`${id}.idle.down.0`)} | ${moving || '*static*'} | ${who} |`)
}
L.push('')

L.push('## Ambient loops — the scenes live on these')

L.push('')
L.push('One-direction props that move on their own. A title screen is carried by the')
L.push('things that move without being looked at, and these are the whole point of')
L.push('the `sceneClips` block: they use the same keys as everything else, with the')
L.push('single direction spelled `down`.')
L.push('')
L.push('| sheet | clip | draw at | note |')
L.push('|---|---|---|---|')
L.push('| `windmill` | `spin` (9f) | **100 wide, 366 tall** | blades turning. NOT `ranch.windmill`, which is the static one |')
L.push('| `wheat` | `sway` (9f) | ~55 tall | a stand swaying in the breeze |')
L.push('| `scarecrow` | `sway` (9f) | ~90 tall | shifting and sagging in the wind |')
L.push('')
L.push('```ts')
L.push("groundActor('windmill', 'spin', 'down', x, footY, 366, '1.4s')")
L.push('```')
L.push('')
L.push('**Watch the name collision.** `ranch.windmill` and `ranch.scarecrow` are the')
L.push('STILL versions and they are what a scene gets if it asks for the `ranch.`')
L.push('key. The moving ones have no prefix.')
L.push('')

L.push('## Everything that can move')
L.push('')
L.push('Every sheet with a multi-frame clip. `clipActor(sheet, clip, dir, ...)`.')
L.push('')
L.push('| sheet | clips |')
L.push('|---|---|')
for (const [id, clips] of Object.entries(atlas.clipLengths).sort()) {
  const moving = Object.entries(clips).filter(([, n]) => n > 1)
  if (!moving.length) continue
  L.push(`| \`${id}\` | ${moving.map(([c, n]) => `${c} (${n}f)`).join(', ')} |`)
}
L.push('')

L.push('## Baked strips — for `actor()`')
L.push('')
L.push('Pre-baked horizontal strips from the LimeZu era. `clipActor` is the newer')
L.push('path and covers everything above; these still work.')
L.push('')
for (const k of keys.filter((k) => k.includes('Strip')).sort()) L.push(`- \`${k}\``)
L.push('')

const groups: [string, string, string][] = [
  ['ranch', 'THE RANCH — generated buildings, vehicles, fencing, feed. USE THESE.', 'ranch'],
  ['scene', 'LimeZu yard furniture — purchased art, being retired. Prefer `ranch.*`.', 'scene'],
  ['prop', 'Field props — many with 16 variants each', 'props'],
  ['crop', 'Crops, healthy and rotted', 'crops'],
  ['node', 'Harvest nodes — rocks, trees, seams', 'nodes'],
  ['cave', 'Cave and canopy art', 'cave'],
  ['item', 'Item card art', 'items'],
]
for (const [prefix, title, img] of groups) {
  const list = (byPrefix.get(prefix) ?? []).sort()
  if (!list.length) continue
  L.push(`## ${title} — ${list.length}`)
  L.push('')
  L.push(`![${prefix}](catalog/${img}.png)`)
  L.push('')
  L.push('| key | source | **draw at** |')
  L.push('|---|---|---|')
  for (const k of list) {
    const draw = SCENE_SCALE[k] ? `**${SCENE_SCALE[k]}px**` : ''
    L.push(`| \`${k}\` | ${sizeOf(k)} | ${draw} |`)
  }
  L.push('')
}

writeFileSync('docs/ASSET_CATALOG.md', L.join('\n') + '\n')
console.log(`${keys.length} frames catalogued -> docs/ASSET_CATALOG.md`)
console.log('contact sheets -> docs/catalog/*.png')
