/**
 * Turn a Claude Design artboard into a placement table.
 *
 *     npm run placements -- <artboard.dc.html> [more...]
 *
 * Writes `docs/mockups/PLACEMENTS.md`, one section per artboard.
 *
 * **Why this is a tool and not a careful read.** A scene is fifty-odd sprites
 * with a left, a top, a size, a filter and an animation each. Transcribing that
 * by hand is a hundred chances to fat-finger a number, and every one of them is
 * invisible — a sprite eight pixels off looks fine on its own and wrong only in
 * company. Worse, a hand-typed table goes stale the first time Design
 * re-exports, and then two documents disagree with no way to tell which is
 * right. `PLACEMENTS.md` already said it was "extracted from the mockup source
 * rather than typed by hand"; this is the extractor that makes that true.
 *
 * The artboards are reference documents, NOT code to lift: `docs/mockups/
 * README.md` is explicit that the inline styles, the `<x-dc>` machinery and
 * `support.js` never ship. What crosses over is the NUMBERS, and this reads
 * them out so `src/ui/scene.ts` can be written against measurements.
 *
 * Design references art three ways, and all three resolve to something the game
 * already has:
 *
 *     assets/pixellab/<group>/<name>.png   ->  atlas key `<group>.<name>`
 *     art/strips/<sheet>.<clip>.<dir>.png  ->  clip actor, sheet+clip+direction
 *     docs/mockups/art/scene/<name>.png    ->  atlas key `scene.<camelCase>`
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { basename } from 'node:path'

interface Placement {
  kind: 'still' | 'strip'
  key: string
  x: number; y: number; w: number; h: number
  anim?: string
  opacity?: string
  filter?: string
}

const camel = (s: string) => s.replace(/[_-](\w)/g, (_, c: string) => c.toUpperCase())

/** Resolve one of Design's three path shapes to what the game calls it. */
function resolve(path: string): { kind: 'still' | 'strip'; key: string } {
  const clean = path.replace(/^['"]|['"]$/g, '')
  let m = /^art\/strips\/(.+)\.png$/.exec(clean)
  if (m) return { kind: 'strip', key: m[1] }
  m = /^assets\/pixellab\/([^/]+)\/([^/]+)\.png$/.exec(clean)
  if (m) return { kind: 'still', key: `${m[1]}.${m[2]}` }
  m = /^docs\/mockups\/art\/scene\/([^/]+)\.png$/.exec(clean)
  if (m) return { kind: 'still', key: `scene.${camel(m[1])}` }
  return { kind: 'still', key: `?? ${clean}` }
}

const px = (style: string, prop: string): number => {
  const m = new RegExp(`(?:^|;)\\s*${prop}:\\s*(-?[\\d.]+)px`).exec(style)
  return m ? Number(m[1]) : NaN
}
const val = (style: string, prop: string): string | undefined => {
  const m = new RegExp(`(?:^|;)\\s*${prop}:\\s*([^;"]+)`).exec(style)
  return m ? m[1].trim() : undefined
}

function extract(html: string): Placement[] {
  const out: Placement[] = []
  // <img src="..." style="...">
  for (const m of html.matchAll(/<img\s+src="([^"]+)"\s+style="([^"]*)"/g)) {
    const { kind, key } = resolve(m[1])
    const s = m[2]
    out.push({
      kind, key, x: px(s, 'left'), y: px(s, 'top'), w: px(s, 'width'), h: px(s, 'height'),
      anim: val(s, 'animation'), opacity: val(s, 'opacity'), filter: val(s, 'filter'),
    })
  }
  // <div style="...background-image:url('...')...">  -- the animated strips
  for (const m of html.matchAll(/<div\s+style="([^"]*background-image:\s*url\(([^)]+)\)[^"]*)"/g)) {
    const s = m[1]
    const { kind, key } = resolve(m[2])
    out.push({
      kind, key, x: px(s, 'left'), y: px(s, 'top'), w: px(s, 'width'), h: px(s, 'height'),
      anim: val(s, 'animation'), opacity: val(s, 'opacity'), filter: val(s, 'filter'),
    })
  }
  // Paint order is DOM order, and the two passes above break it. Restore it by
  // where each match started in the source.
  return out
}

function orderedExtract(html: string): Placement[] {
  const marks: { at: number; p: Placement }[] = []
  for (const m of html.matchAll(/<img\s+src="([^"]+)"\s+style="([^"]*)"/g)) {
    const { kind, key } = resolve(m[1]); const s = m[2]
    marks.push({ at: m.index, p: { kind, key, x: px(s,'left'), y: px(s,'top'), w: px(s,'width'),
      h: px(s,'height'), anim: val(s,'animation'), opacity: val(s,'opacity'), filter: val(s,'filter') } })
  }
  for (const m of html.matchAll(/<div\s+style="([^"]*background-image:\s*url\(([^)]+)\)[^"]*)"/g)) {
    const s = m[1]; const { kind, key } = resolve(m[2])
    marks.push({ at: m.index, p: { kind, key, x: px(s,'left'), y: px(s,'top'), w: px(s,'width'),
      h: px(s,'height'), anim: val(s,'animation'), opacity: val(s,'opacity'), filter: val(s,'filter') } })
  }
  return marks.sort((a, b) => a.at - b.at).map((m) => m.p)
}
void extract

const files = process.argv.slice(2).filter((a) => a.endsWith('.dc.html'))
if (!files.length) { console.error('usage: npm run placements -- <artboard.dc.html> ...'); process.exit(1) }

let md = `# Scene placements — generated, do not hand-edit\n\n`
  + `Written by \`npm run placements\` straight out of the Claude Design artboards.\n`
  + `All numbers are in **1920x1080 stage space**, top-left origin. Layer = DOM order\n`
  + `(higher paints later), which is the order \`src/ui/scene.ts\` must build in.\n\n`
  + `\`still\` is an atlas key drawn once. \`strip\` is \`sheet.clip.direction\` — a\n`
  + `packed animation, drawn by \`stripActor\`/\`clipActor\` rather than as an image.\n`

for (const file of files) {
  const rows = orderedExtract(readFileSync(file, 'utf8'))
  md += `\n## ${basename(file, '.dc.html')}\n\n`
    + `${rows.length} placements.\n\n`
    + `| # | kind | key | x | y | w | h | animation | tint |\n|---|---|---|---|---|---|---|---|---|\n`
  rows.forEach((p, i) => {
    const tint = [p.opacity ? `op ${p.opacity}` : '', p.filter ?? ''].filter(Boolean).join(' · ')
    md += `| ${i + 1} | ${p.kind} | \`${p.key}\` | ${p.x} | ${p.y} | ${p.w} | ${p.h} `
      + `| ${p.anim ?? '—'} | ${tint || '—'} |\n`
  })
  const unresolved = rows.filter((p) => p.key.startsWith('??'))
  console.log(`${basename(file)}: ${rows.length} placements`
    + (unresolved.length ? `  (${unresolved.length} UNRESOLVED: ${unresolved.map((u) => u.key).join(', ')})` : ''))
}
writeFileSync('docs/mockups/PLACEMENTS.md', md)
console.log('-> docs/mockups/PLACEMENTS.md')
