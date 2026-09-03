/**
 * Trace a real run at the GPU/compositor level, not the JS level.
 *
 *     node node_modules/vite-node/vite-node.mjs tools/play-trace.ts [class] [seconds] [outDir] [seed]
 *
 * ## Why this exists
 *
 * `tools/play.ts` with `RDF_PROFILE=1` samples the JS stack, and that profile
 * says the main thread is over half idle. That answers "which function" and
 * cannot answer "where did the frame go" — the frame can be spent entirely
 * outside JS, in raster, in an image upload, in the GPU process, and a CPU
 * profile shows exactly none of it.
 *
 * So this is the same run, driven the same way, with a chrome trace over it.
 * The question it exists to settle is the thrash hypothesis in NOTES: is a
 * decoded image being evicted and re-uploaded every frame? That shows up as
 * per-frame `GpuImageDecodeCache` / decode / upload events, and nowhere else.
 *
 * A trimmed copy of `play.ts` on purpose: it holds the keyboard down and takes
 * level-ups so the world keeps moving, and does nothing else — no screenshots,
 * no per-second world reads, no fps probe. Every one of those is main-thread
 * work that lands IN the trace and would be reported as the game's own cost.
 *
 * Summary to stdout and `<outDir>/perf-trace.md`. The raw trace is written
 * only with `RDF_TRACE_RAW=1`: 25s of these categories is **737MB**, the repo
 * lives inside a OneDrive folder, and a file that size appearing in it is a
 * sync storm rather than a measurement. The summary answers the question; the
 * raw file is for when it does not.
 *
 * The trace is streamed to disk and aggregated as it arrives, never held whole.
 * Measured: 25s of blink+cc+gpu is a few million events, and
 * `JSON.stringify(events)` on it dies with `RangeError: Invalid string length`
 * — V8's string cap, hit before any node heap limit, so `--max-old-space-size`
 * does not save it.
 */
import { createWriteStream, mkdirSync, writeFileSync } from 'node:fs'
import { startVite, launchBrowser, stopVite } from './harness.ts'

const classId = process.argv[2] ?? 'hand'
const seconds = Number(process.argv[3] ?? 25)
const outDir = process.argv[4] ?? 'tools/play/trace'
const seed = process.argv[5] ?? 'harvest'
const PORT = 5197
/** Seconds of play before tracing starts, so waves and enemies exist. */
const WARMUP = Number(process.env.RDF_TRACE_WARMUP ?? 60)
/** Keep the raw trace. Off by default — see the header; it is 737MB for 25s. */
const RAW = process.env.RDF_TRACE_RAW === '1'

interface TraceEvent {
  name: string
  cat: string
  ph: string
  ts: number
  dur?: number
  pid: number
  tid: number
  args?: Record<string, unknown>
}

mkdirSync(outDir, { recursive: true })
const server = await startVite(PORT)
const browser = await launchBrowser({ headed: true })

try {
  const page = await browser.newPage({
    viewport: { width: 1600, height: 900 },
    deviceScaleFactor: 1,
  })
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  await page.waitForFunction('window.rdf && window.rdf.screens', null, { timeout: 120_000 })
  await page.bringToFront()
  await page.evaluate(`window.rdf.startRun(${JSON.stringify(classId)}, ${JSON.stringify(seed)})`)

  /* Hold a direction and clear level-up cards; nothing else. A level-up screen
     freezes the sim, and a frozen sim traces an idle game. */
  const ORBIT = ['d', 's', 'a', 'w']
  let held = ''
  const drive = async (secs: number, t0: number) => {
    for (let t = 0; t < secs; t++) {
      const want = ORBIT[Math.floor((t0 + t) / 3) % ORBIT.length]
      if (want !== held) {
        if (held) await page.keyboard.up(held)
        await page.keyboard.down(want)
        held = want
      }
      await page.waitForTimeout(1000)
      const open = await page.evaluate(
        'window.rdf.screens.levelUp.visible ? 1 : (window.rdf.screens.shop.visible ? 2 : 0)',
      ) as number
      if (open === 1) await page.keyboard.press('1')
      else if (open === 2) {
        const back = page.getByText('BACK TO THE FIELD').first()
        if (await back.count()) await back.click()
      }
    }
  }
  await drive(WARMUP, 0)

  const cdp = await page.context().newCDPSession(page)
  const raw = RAW ? createWriteStream(`${outDir}/perf-trace.json`) : null
  raw?.write('[')
  let total = 0
  let lo = Infinity
  let hi = -Infinity
  const byName = new Map<string, { n: number; dur: number }>()
  const drawTs: number[] = []
  const decodes: [number, number][] = []
  cdp.on('Tracing.dataCollected', (e) => {
    /* Playwright types the payload as `{[key: string]: string}[]`, which a
       trace event is not — the real shape carries numbers and nested args. Via
       `unknown` because a direct assertion between the two is rejected. */
    for (const ev of (e as unknown as { value: TraceEvent[] }).value) {
      raw?.write((total ? ',' : '') + JSON.stringify(ev))
      total++
      /* Two names kept with their timestamps, because the interesting question
         is not how many of each there are but whether they coincide: does a
         frame go long BECAUSE an image is being decoded? Everything else is
         aggregated on the spot so the whole trace never sits in memory. */
      if (ev.name === 'DrawFrame') drawTs.push(ev.ts)
      else if (ev.name === 'Decode Image' && ev.dur) decodes.push([ev.ts, ev.dur])
      /* Metadata events carry ts=0. Including them made the first run of this
         tool report a 186959.8s trace and divide every count by it, which
         turned a 216fps game into "0.0 frames per second". */
      if (ev.ts > 0) {
        if (ev.ts < lo) lo = ev.ts
        if (ev.ts > hi) hi = ev.ts
      }
      const r = byName.get(ev.name) ?? { n: 0, dur: 0 }
      r.n++
      if (ev.ph === 'X' || ev.ph === 'x') r.dur += ev.dur ?? 0
      byName.set(ev.name, r)
    }
  })
  const done = new Promise<void>((res) => cdp.on('Tracing.tracingComplete', () => res()))

  await cdp.send('Tracing.start', {
    transferMode: 'ReportEvents',
    traceConfig: {
      recordMode: 'recordAsMuchAsPossible',
      includedCategories: [
        'disabled-by-default-gpu.service',
        'gpu',
        'cc',
        'viz',
        'blink',
        'devtools.timeline',
        'disabled-by-default-devtools.timeline',
        'disabled-by-default-devtools.timeline.frame',
      ],
    },
  })
  const stats = await page.evaluate(`(() => {
    const w = window.rdf.world;
    return { wave: w.spawner ? w.spawner.wave : 0, alive: w.enemies.live, level: w.player.level };
  })()`) as { wave: number; alive: number; level: number }
  await drive(seconds, WARMUP)
  await cdp.send('Tracing.end')
  await done
  if (held) await page.keyboard.up(held)

  raw?.end(']')

  /* Summarise by name. A 25s trace with blink+cc+gpu on is millions of events;
     nobody is reading that by hand and a top-by-total-duration table is what
     the question actually needs. */
  const span = (hi - lo) / 1e6
  /* Frames actually presented, from the compositor's own draw count — the
     denominator for anything asked "per frame". */
  const drawn = byName.get('DrawFrame')?.n ?? 0
  const countName = new Map<string, number>()
  for (const [n, r] of byName) countName.set(n, r.n)

  const topDur = [...byName.entries()].sort((a, b) => b[1].dur - a[1].dur).slice(0, 30)
  const frameish = ['PipelineReporter', 'DrawFrame', 'Graphics.Pipeline', 'BeginFrame',
    'Compositor::DrawFrame', 'ProxyImpl::ScheduledActionDraw']
  const decodeish = [...countName.entries()]
    .filter(([n]) => /decode|upload|Texture|texture|ImageCache|DecodeCache|Raster|raster/.test(n))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 30)

  /*
     Do the decodes cost frames?

     Counting decodes says they happen; it does not say the game notices. So
     bucket every inter-frame gap by whether a decode was in flight at the time
     and compare. If the two distributions match, the decode is worker-thread
     work the game pays nothing for; if the decoding one is worse, that is the
     hitch, named.
  */
  const decodeReport = (): string[] => {
    if (!decodes.length || drawTs.length < 3) return ['## Decode vs frame gaps', '', 'no decodes in this window', '']
    drawTs.sort((a, b) => a - b)
    const during: number[] = []
    const clear: number[] = []
    for (let i = 1; i < drawTs.length; i++) {
      const t = drawTs[i]
      const gap = (t - drawTs[i - 1]) / 1000
      const hot = decodes.some(([ds, dd]) => t >= ds && t <= ds + dd)
      ;(hot ? during : clear).push(gap)
    }
    const q = (xs: number[], p: number) => {
      const s2 = [...xs].sort((a, b) => a - b)
      return s2[Math.min(s2.length - 1, Math.floor(s2.length * p))] ?? 0
    }
    const spanS = (decodes.reduce((a, [, d]) => a + d, 0)) / 1e6
    return [
      '## Decode vs frame gaps',
      '',
      `${decodes.length} PNG decodes, median ${(q(decodes.map((d) => d[1]), 0.5) / 1000).toFixed(0)}ms each, `
      + `${spanS.toFixed(1)}s of decode inside a ${span.toFixed(1)}s window.`,
      '',
      '| frames presented | median gap ms | p95 gap ms | max gap ms |',
      '|---|---|---|---|',
      `| while a decode was in flight (${during.length}) | ${q(during, 0.5).toFixed(2)} | `
      + `${q(during, 0.95).toFixed(2)} | ${Math.max(0, ...during).toFixed(2)} |`,
      `| with no decode running (${clear.length}) | ${q(clear, 0.5).toFixed(2)} | `
      + `${q(clear, 0.95).toFixed(2)} | ${Math.max(0, ...clear).toFixed(2)} |`,
      '',
    ]
  }

  const lines = [
    `# GPU / compositor trace — ${classId}, seed "${seed}"`,
    '',
    `${total} events over ${span.toFixed(1)}s of trace, taken after ${WARMUP}s of play.`,
    `At trace start: wave ${stats.wave}, level ${stats.level}, ${stats.alive} enemies alive.`,
    '',
    '## Frame-ish counters (÷ trace seconds = frames per second)',
    '',
    '| event | count | per second |',
    '|---|---|---|',
    ...frameish
      .filter((n) => countName.has(n))
      .map((n) => `| ${n} | ${countName.get(n)} | ${((countName.get(n) ?? 0) / span).toFixed(1)} |`),
    '',
    '## Anything that decodes, uploads or rasters',
    '',
    'A decoded image evicted and re-uploaded every frame is the thrash hypothesis;',
    'it would show here at roughly the frame rate or a multiple of it.',
    '',
    '| event | count | per second |',
    '|---|---|---|',
    ...decodeish.map(([n, c]) => `| ${n} | ${c} | ${(c / span).toFixed(1)} |`),
    '',
    `Presented frames in the window: **${drawn}** (${(drawn / span).toFixed(0)}/s).`,
    'Divide any count above by that to get per-frame.',
    '',
    '## Top 30 by total duration',
    '',
    '| event | count | total ms | mean ms | ms per presented frame |',
    '|---|---|---|---|---|',
    ...topDur.map(([n, r]) => `| ${n} | ${r.n} | ${(r.dur / 1000).toFixed(1)} | `
      + `${(r.dur / 1000 / r.n).toFixed(3)} | ${(r.dur / 1000 / (drawn || 1)).toFixed(3)} |`),
    '',
    ...decodeReport(),
  ]
  writeFileSync(`${outDir}/perf-trace.md`, lines.join('\n'))
  console.log(lines.join('\n'))
} finally {
  await browser.close()
  stopVite(server)
}
