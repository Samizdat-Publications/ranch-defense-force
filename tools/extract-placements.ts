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

/*
   A TAG STACK, not a regex sweep, because the artboard nests.

   Design's "muller" -- a bird or a cat that wanders a few steps and comes back
   -- is a WRAPPER div carrying `left`, `top`, a `--leg` travel distance and a
   `mull-path` animation, holding children pinned with `inset:0` that are the
   actual sprites. A flat scan reads those children, finds no `left`, and emits
   NaN: 20 of the yard's 52 placements came out that way on the first run, and a
   NaN in a generated table is worse than no table.

   So walk the document as a tree. A sprite's position is the sum of its own
   offset and every ancestor's, and `inset:0` means "take the wrapper's box".
   That is what makes these stage-space coordinates rather than per-parent ones,
   which is what `src/ui/scene.ts` needs.
*/
interface Frame { left: number; top: number; w: number; h: number; anim?: string; leg?: string }

function frameOf(style: string): Frame {
  const inset = /(?:^|;)\s*inset:\s*0/.test(style)
  return {
    left: inset ? 0 : (px(style, 'left') || 0),
    top: inset ? 0 : (px(style, 'top') || 0),
    w: px(style, 'width'),
    h: px(style, 'height'),
    anim: val(style, 'animation'),
    leg: val(style, '--leg'),
  }
}

function extract(html: string): Placement[] {
  const out: Placement[] = []
  const stack: Frame[] = []
  const token = /<(div|img)\b([^>]*?)(\/?)>|<\/div>/g
  for (let m = token.exec(html); m; m = token.exec(html)) {
    if (m[0] === '</div>') { stack.pop(); continue }
    const [, tag, attrs, selfClose] = m
    const style = /style="([^"]*)"/.exec(attrs)?.[1] ?? ''
    const f = frameOf(style)
    const x = stack.reduce((a, p) => a + p.left, 0) + f.left
    const y = stack.reduce((a, p) => a + p.top, 0) + f.top
    // `inset:0` gives no size of its own; inherit the nearest sized ancestor.
    const inherited = [...stack].reverse().find((p) => !Number.isNaN(p.w))
    const w = Number.isNaN(f.w) ? (inherited?.w ?? NaN) : f.w
    const h = Number.isNaN(f.h) ? (inherited?.h ?? NaN) : f.h

    const src = tag === 'img'
      ? /src="([^"]+)"/.exec(attrs)?.[1]
      : /background-image:\s*url\(([^)]+)\)/.exec(style)?.[1]
    if (src) {
      const { kind, key } = resolve(src)
      // The wrapper's animation is the TRAVEL; the child's is the gait.
      const wrap = [...stack].reverse().find((p) => p.anim?.includes('mull-path'))
      out.push({
        kind, key, x, y, w, h,
        anim: [f.anim, wrap ? `via ${wrap.anim} leg ${wrap.leg ?? '?'}` : ''].filter(Boolean).join(' + ')
          || undefined,
        opacity: val(style, 'opacity'),
        filter: val(style, 'filter'),
      })
    }
    // <img> is void and never opens a level.
    if (tag === 'div' && !selfClose) stack.push({ ...f, w, h })
  }
  return out
}

const files = process.argv.slice(2).filter((a) => a.endsWith('.dc.html'))
if (!files.length) { console.error('usage: npm run placements -- <artboard.dc.html> ...'); process.exit(1) }

let md = `# Scene placements — generated, do not hand-edit\n\n`
  + `Written by \`npm run placements\` straight out of the Claude Design artboards.\n`
  + `All numbers are in **1920x1080 stage space**, top-left origin. Layer = DOM order\n`
  + `(higher paints later), which is the order \`src/ui/scene.ts\` must build in.\n\n`
  + `\`still\` is an atlas key drawn once. \`strip\` is \`sheet.clip.direction\` — a\n`
  + `packed animation, drawn by \`stripActor\`/\`clipActor\` rather than as an image.\n`

for (const file of files) {
  const rows = extract(readFileSync(file, 'utf8'))
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
