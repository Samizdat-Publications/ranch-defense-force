import { readFileSync } from 'node:fs'
import { decodePng } from './png.ts'

const atlas = JSON.parse(readFileSync('public/atlas.json', 'utf8'))
const names = process.argv.slice(2).filter((v) => v !== '--')
for (const name of names) {
  const f = atlas.frames[name]
  if (!f) { console.log(name, 'MISSING'); continue }
  const pageFile = `public/atlas-${f.page}.png`
  const img = decodePng(readFileSync(pageFile))
  let minX = f.w; let minY = f.h; let maxX = -1; let maxY = -1
  for (let y = 0; y < f.h; y++) {
    for (let x = 0; x < f.w; x++) {
      const sx = f.x + x; const sy = f.y + y
      const idx = (sy * img.width + sx) * 4
      const a = img.data[idx + 3]
      if (a > 10) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }
  console.log(
    name, 'canvas', `${f.w}x${f.h}`, 'contentBBox', `x:${minX}-${maxX} y:${minY}-${maxY}`,
    'contentW', maxX - minX + 1, 'contentH', maxY - minY + 1,
    'bottomGap', f.h - 1 - maxY, 'topGap', minY,
  )
}
