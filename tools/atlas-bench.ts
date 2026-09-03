/**
 * Does sampling a 4096x8192 atlas cost more than sampling a small one?
 *
 *     node node_modules/vite-node/vite-node.mjs tools/atlas-bench.ts
 *     RDF_BENCH_SWRAST=1 ... tools/atlas-bench.ts tools/play/perf-bench-sw.md
 *
 * ## Why this exists, and why it is not the game
 *
 * The handoff nominates the atlas as the reason the owner sees ~2fps: one
 * 4096x8192 image, ~134MB decoded, plus a second canvas the same size for the
 * hit flash, and every sprite is a `drawImage` off one of them. A CPU profile
 * cannot answer that — the cost, if it exists, is in the compositor and the
 * driver, not in JS.
 *
 * So this measures ONLY that: N random 32x64 blits per frame onto a 1600x900
 * `alpha:false` canvas, from five different sources, in the same headed Chrome
 * every other tool in this repo drives. No sim, no renderer, nothing else
 * moving. If the big atlas is expensive, (a) and (d) are slower than (b) and
 * (c) by a margin bigger than the run-to-run spread; if they are not, the
 * atlas is exonerated on this hardware and the next hypothesis is somebody
 * else's.
 *
 *   a  the REAL public/atlas.png, 4096x8192, as an <img>
 *   b  a 2048x2048 crop of it, round-tripped through toBlob -> <img>
 *   c  a 1024x1024 crop, same
 *   d  a 4096x8192 <canvas> holding the white silhouette — exactly what
 *      `src/core/atlas.ts` builds for the hit flash
 *   e  alternating a/d every draw: what the flash path actually does, and the
 *      case where source switching could defeat whatever caching exists
 *   f  the SAME 4096x8192 atlas as (a), but every source rect taken from one
 *      1024x1024 window of it. (a) minus (f) is the cost of reading all over a
 *      big texture; (f) minus (c) is the cost of the texture merely being big.
 *      Without this the bench cannot tell those two apart, and they call for
 *      completely different fixes — repack for locality, or shrink.
 *
 * ## Two things that would silently ruin the numbers, and what is done instead
 *
 * **The page is served from the vite origin, not a `data:` URL.** Cropping the
 * atlas onto a canvas and calling `toBlob` needs an untainted canvas, and an
 * `<img>` fetched over http into a document with an opaque origin taints it.
 * So vite serves `public/`, and a playwright route fulfils one made-up path on
 * that same origin with this page. Nothing is written into the project.
 *
 * **No `getImageData` to "flush" the GPU.** It is the obvious way to turn
 * queued GPU work into measurable wall time, and it is a trap: Chrome watches
 * readback frequency and will drop an accelerated canvas to software, which is
 * the very thing being measured. Frame time under rAF is used instead, at two
 * loads — one (600) near what the game issues, one (4000) chosen to sit well
 * past the vsync ceiling so the display refresh cannot flatten the result.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { chromium } from 'playwright'
import { startVite, stopVite } from './harness.ts'

const out = process.argv[2] ?? 'tools/play/perf-bench.md'
const PORT = 5199
const REPEATS = Number(process.env.RDF_BENCH_REPEATS ?? 3)
const LOADS = (process.env.RDF_BENCH_LOADS ?? '600,4000').split(',').map(Number)
const CONDS = ['a', 'b', 'c', 'd', 'e', 'f']
const LABEL: Record<string, string> = {
  a: 'atlas.png 4096x8192 img',
  b: '2048x2048 crop img',
  c: '1024x1024 crop img',
  d: 'flash canvas 4096x8192',
  e: 'alternating img/canvas',
  f: 'atlas.png, reads inside one 1024 window',
}

const PAGE = [
  '<!doctype html><meta charset=utf-8><title>atlas bench</title>',
  '<style>html,body{margin:0;background:#111}</style>',
  '<canvas id=c width=1600 height=900></canvas>',
  '<script>',
  "const ctx = document.getElementById('c').getContext('2d', { alpha: false });",
  'ctx.imageSmoothingEnabled = false;',
  'const src = {};',
  'function loadImage(url) {',
  '  return new Promise((res, rej) => {',
  '    const i = new Image();',
  '    i.onload = () => res(i);',
  "    i.onerror = () => rej(new Error('load ' + url));",
  '    i.src = url;',
  '  });',
  '}',
  '/* A crop of the real atlas, round-tripped through a blob so the browser',
  '   holds it as a decoded <img> exactly like the real one -- not as a canvas,',
  "   which is a different kind of source and is condition (d)'s job. */",
  'async function crop(img, size) {',
  "  const cv = document.createElement('canvas');",
  '  cv.width = size; cv.height = size;',
  "  cv.getContext('2d').drawImage(img, 0, 0, size, size, 0, 0, size, size);",
  "  const blob = await new Promise((r) => cv.toBlob(r, 'image/png'));",
  '  return loadImage(URL.createObjectURL(blob));',
  '}',
  'window.__setup = async () => {',
  "  const atlas = await loadImage('/atlas.png');",
  '  src.a = atlas;',
  '  src.b = await crop(atlas, 2048);',
  '  src.c = await crop(atlas, 1024);',
  '  /* Byte-for-byte what src/core/atlas.ts builds at load for the hit flash. */',
  "  const flash = document.createElement('canvas');",
  '  flash.width = atlas.naturalWidth; flash.height = atlas.naturalHeight;',
  "  const fx = flash.getContext('2d');",
  '  fx.drawImage(atlas, 0, 0);',
  "  fx.globalCompositeOperation = 'source-in';",
  "  fx.fillStyle = '#ffffff';",
  '  fx.fillRect(0, 0, flash.width, flash.height);',
  '  src.d = flash;',
  '  return { w: atlas.naturalWidth, h: atlas.naturalHeight };',
  '};',
  '/* Precomputed coordinates: Math.random() in the inner loop would be measured',
  '   as part of the blit, and at 4000 draws a frame that is not nothing. */',
  'function coords(sw, sh, n, winX, winY, win) {',
  '  const a = new Int32Array(n * 4);',
  '  for (let i = 0; i < n; i++) {',
  '    a[i * 4] = win ? winX + ((Math.random() * (win - 32)) | 0) : (Math.random() * (sw - 32)) | 0;',
  '    a[i * 4 + 1] = win ? winY + ((Math.random() * (win - 64)) | 0) : (Math.random() * (sh - 64)) | 0;',
  '    a[i * 4 + 2] = (Math.random() * (1600 - 32)) | 0;',
  '    a[i * 4 + 3] = (Math.random() * (900 - 64)) | 0;',
  '  }',
  '  return a;',
  '}',
  'window.__run = (cond, n, warmMs, runMs) => new Promise((resolve) => {',
  "  const primary = (cond === 'e' || cond === 'f') ? src.a : src[cond];",
  "  const secondary = cond === 'e' ? src.d : null;",
  '  const sw = primary.naturalWidth || primary.width;',
  '  const sh = primary.naturalHeight || primary.height;',
  "  const win = cond === 'f' ? 1024 : 0;",
  '  const co = coords(sw, sh, 4096, win ? ((sw - win) / 2) | 0 : 0, win ? ((sh - win) / 2) | 0 : 0, win);',
  '  const frames = []; const draws = [];',
  '  let last = performance.now(); const t0 = last; let k = 0;',
  '  const step = (t) => {',
  '    const dt = t - last; last = t;',
  '    const d0 = performance.now();',
  '    for (let i = 0; i < n; i++) {',
  '      const j = ((k + i) & 4095) * 4;',
  '      const s = secondary && (i & 1) ? secondary : primary;',
  '      ctx.drawImage(s, co[j], co[j + 1], 32, 64, co[j + 2], co[j + 3], 32, 64);',
  '    }',
  '    k = (k + n) & 4095;',
  '    const d1 = performance.now();',
  '    if (t - t0 > warmMs) { frames.push(dt); draws.push(d1 - d0); }',
  '    if (t - t0 > warmMs + runMs) {',
  '      const q = (arr, p) => {',
  '        const s2 = [...arr].sort((x, y) => x - y);',
  '        return s2[Math.min(s2.length - 1, Math.floor(s2.length * p))] || 0;',
  '      };',
  '      resolve({',
  '        n: frames.length,',
  '        frameMedian: +q(frames, 0.5).toFixed(2),',
  '        frameP95: +q(frames, 0.95).toFixed(2),',
  '        fps: +(1000 / (q(frames, 0.5) || 1)).toFixed(1),',
  '        drawMedian: +q(draws, 0.5).toFixed(2),',
  '        drawP95: +q(draws, 0.95).toFixed(2),',
  '      });',
  '      return;',
  '    }',
  '    requestAnimationFrame(step);',
  '  };',
  '  requestAnimationFrame(step);',
  '});',
  '</script>',
].join('\n')

interface Cell {
  n: number
  frameMedian: number
  frameP95: number
  fps: number
  drawMedian: number
  drawP95: number
}
interface Row extends Cell { cond: string; load: number; rep: number }

mkdirSync(out.replace(/\/[^/]+$/, ''), { recursive: true })
const server = await startVite(PORT)
/*
   Launched here rather than through `harness.launchBrowser` because one run of
   this bench needs `--disable-gpu` and the harness takes no extra args. The
   pattern is otherwise copied from it verbatim, `channel: 'chrome'` included:
   playwright's bundled chromium is permission-denied on this box and fails
   with `spawn UNKNOWN`, and headless composites on demand.
*/
const args = [
  '--disable-background-timer-throttling',
  '--disable-backgrounding-occluded-windows',
  '--disable-renderer-backgrounding',
  '--disable-features=CalculateNativeWinOcclusion',
]
const swrast = process.env.RDF_BENCH_SWRAST === '1'
if (swrast) args.push('--disable-gpu')
const browser = await chromium.launch({ channel: 'chrome', args, headless: false })

const rows: Row[] = []

try {
  const page = await browser.newPage({
    viewport: { width: 1600, height: 940 },
    deviceScaleFactor: 1,
  })
  const errs: string[] = []
  page.on('pageerror', (e) => errs.push(String(e)))
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()) })
  // One made-up path on the vite origin, so the atlas is same-origin and the
  // crop canvases stay untainted. Nothing is written into the project.
  await page.route('**/__bench.html', (r) => r.fulfill({
    status: 200,
    contentType: 'text/html; charset=utf-8',
    body: PAGE,
  }))
  await page.goto(`http://localhost:${PORT}/__bench.html`, { waitUntil: 'load', timeout: 120_000 })
  await page.bringToFront()

  const size = await page.evaluate('window.__setup()') as { w: number; h: number }
  console.log(`atlas ${size.w}x${size.h}${swrast ? '  [--disable-gpu]' : ''}`)

  for (let rep = 1; rep <= REPEATS; rep++) {
    for (const load of LOADS) {
      for (const cond of CONDS) {
        await page.bringToFront()
        const r = await page.evaluate(
          `window.__run(${JSON.stringify(cond)}, ${load}, 1000, 3000)`,
        ) as Cell
        rows.push({ cond, load, rep, ...r })
        console.log(`  rep${rep} n=${load} ${cond}  frame ${r.frameMedian}ms `
          + `p95 ${r.frameP95}ms (${r.fps}fps)  draw ${r.drawMedian}ms`)
      }
    }
  }

  const med = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0
  const lines = [
    `# Atlas source microbenchmark${swrast ? ' — SOFTWARE RASTER (--disable-gpu)' : ''}`,
    '',
    `${REPEATS} repeats, 1s warmup + 3s measured per cell, 1600x900 alpha:false`,
    `canvas, imageSmoothingEnabled=false, random 32x64 sub-rects. Atlas ${size.w}x${size.h}.`,
    '',
  ]
  for (const load of LOADS) {
    lines.push(
      `## ${load} draws per frame`,
      '',
      '| source | frame ms (median of reps) | spread across reps | p95 ms | fps | JS in draw loop |',
      '|---|---|---|---|---|---|',
    )
    for (const cond of CONDS) {
      const r = rows.filter((x) => x.cond === cond && x.load === load)
      const fs = r.map((x) => x.frameMedian)
      lines.push(
        `| ${cond} — ${LABEL[cond]} | ${med(fs).toFixed(2)} | `
        + `${Math.min(...fs).toFixed(2)}–${Math.max(...fs).toFixed(2)} | `
        + `${med(r.map((x) => x.frameP95)).toFixed(2)} | `
        + `${med(r.map((x) => x.fps)).toFixed(0)} | `
        + `${med(r.map((x) => x.drawMedian)).toFixed(2)} |`,
      )
    }
    lines.push('')
  }
  lines.push(
    '## Every cell',
    '',
    '| rep | load | source | frame med | frame p95 | fps | draw med | draw p95 |',
    '|---|---|---|---|---|---|---|---|',
    ...rows.map((r) => `| ${r.rep} | ${r.load} | ${r.cond} | ${r.frameMedian} | `
      + `${r.frameP95} | ${r.fps} | ${r.drawMedian} | ${r.drawP95} |`),
    '',
  )
  if (errs.length) lines.push('## Page errors', '', ...[...new Set(errs)].map((e) => `- ${e}`), '')
  writeFileSync(out, lines.join('\n'))
  writeFileSync(out.replace(/\.md$/, '.json'), JSON.stringify(rows))
  console.log(`-> ${out}`)
} finally {
  await browser.close()
  stopVite(server)
}
