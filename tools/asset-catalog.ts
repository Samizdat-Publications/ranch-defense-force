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
L.push('## How to draw one')
L.push('')
L.push('```ts')
L.push("spriteEl('scene.barn', 400)                    // key, box size")
L.push("spriteEl('rosie.idle.downRight', 96)           // any sheet, any facing")
L.push("clipActor('brahmaHen', 'peck', 'down', x, y, '1.4s', 2)   // ANIMATED")
L.push('```')
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
L.push('| clean | blighted | animated clips | who |')
L.push('|---|---|---|---|')
for (const [id, who] of CAST) {
  const clips = clipsFor(id)
  const moving = clips
    ? Object.entries(clips).filter(([, n]) => n > 1).map(([c, n]) => `${c} (${n}f)`).join(', ')
    : ''
  const twin = atlas.frames[`${id}Blight.idle.down.0`] ? `\`${id}Blight\`` : '—'
  L.push(`| \`${id}\` | ${twin} | ${moving || '*static*'} | ${who} |`)
}
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
  ['scene', 'Buildings and yard furniture', 'scene'],
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
  L.push('| key | size |')
  L.push('|---|---|')
  for (const k of list) L.push(`| \`${k}\` | ${sizeOf(k)} |`)
  L.push('')
}

writeFileSync('docs/ASSET_CATALOG.md', L.join('\n') + '\n')
console.log(`${keys.length} frames catalogued -> docs/ASSET_CATALOG.md`)
console.log('contact sheets -> docs/catalog/*.png')
