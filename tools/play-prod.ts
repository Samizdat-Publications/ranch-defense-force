/**
 * Play the game the way the OWNER plays it, and count frames.
 *
 *     node node_modules/vite-node/vite-node.mjs tools/play-prod.ts <url> [seconds] [out.md]
 *     RDF_COVER=1 ... tools/play-prod.ts <url> 60 tools/play/perf-covered.md
 *
 * ## Why this is not `tools/play.ts`
 *
 * `play.ts` drives `window.rdf`, which only a dev build exposes, and it sets a
 * 1600x900 viewport at deviceScaleFactor 1. The owner plays the DEPLOYED build
 * in a normal window on a normal Windows laptop, where `devicePixelRatio` is
 * usually 1.25 or 1.5 — and `src/main.ts` sizes the canvas backing store by
 * dpr (capped at 2), so the owner's canvas is a quarter again bigger in each
 * axis than every measurement this repo has taken. A production-only or
 * dpr-only cost would be invisible to all of them.
 *
 * So this one takes a URL, starts the run by CLICKING (a `.hero` card selects,
 * a second click on the selected card takes the field — `src/ui/menu.ts`),
 * holds a movement key, and reports frames per second measured in the page.
 * It works against the live site and against a local dev server, and the point
 * is running it against both.
 *
 * ## The occlusion control
 *
 * `RDF_COVER=1` launches a SECOND Chrome window over the left half of the
 * first, part way through, and keeps measuring. NOTES records 2fps as the
 * exact signature of a covered window and the owner played split-screen, so
 * what partial occlusion does on this machine is worth a number rather than an
 * assumption. Window geometry comes from `--window-position`/`--window-size`,
 * which is the only handle playwright gives on where a window lands.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { chromium, type Browser } from 'playwright'
import { startVite, stopVite } from './harness.ts'

/* Pass `dev` instead of a URL to start vite and measure the local dev build
   through the SAME clicking path, so dev and production differ in nothing but
   the build. */
const arg = process.argv[2] ?? 'https://samizdat-publications.github.io/ranch-defense-force/'
const PORT = 5196
const server = arg === 'dev' ? await startVite(PORT) : null
const url = server ? `http://localhost:${PORT}/` : arg
const seconds = Number(process.argv[3] ?? 75)
const out = process.argv[4] ?? 'tools/play/perf-prod.md'
const DPR = Number(process.env.RDF_DPR ?? 1.25)
const COVER = process.env.RDF_COVER === '1'
/** Seconds of play before the covering window appears. */
const COVER_AT = Number(process.env.RDF_COVER_AT ?? 30)
/* How much of the game window the covering window hides. The default hides the
   left half; `RDF_COVER_SIZE=1920,1080` hides all of it, which is the control
   that says whether the 2fps signature reproduces at all. */
const COVER_SIZE = process.env.RDF_COVER_SIZE ?? '980,1040'

const args = [
  '--disable-background-timer-throttling',
  '--disable-backgrounding-occluded-windows',
  '--disable-renderer-backgrounding',
  '--disable-features=CalculateNativeWinOcclusion',
  '--window-position=0,0',
  '--window-size=1920,1080',
]
/*
   The occlusion run must NOT carry the anti-throttling flags.

   Three of the four exist to stop Chrome throttling a backgrounded or occluded
   renderer, which is precisely the thing being measured. Leaving them on would
   have this run report that covering a window costs nothing, and that answer
   would be an artefact of the harness.
*/
const playArgs = COVER ? args.slice(4) : args

mkdirSync(out.replace(/\/[^/]+$/, ''), { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', args: playArgs, headless: false })
let cover: Browser | null = null

interface Sample {
  t: number; fps: number; frames: number; over33: number
  visible: string; heapMb: number; wave: number; alive: number
}

try {
  const page = await browser.newPage({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: DPR,
  })
  const problems: string[] = []
  page.on('console', (m) => { if (m.type() === 'error') problems.push(m.text()) })
  page.on('pageerror', (e) => problems.push(String(e)))
  page.on('response', (r) => { if (r.status() >= 400) problems.push(`HTTP ${r.status()} ${r.url()}`) })

  // The same recorder play.ts installs, before app code, so frame zero counts.
  await page.addInitScript(`
    window.__spikes = []; window.__frames = 0;
    let last = performance.now();
    const tick = (t) => {
      const d = t - last; last = t; window.__frames++;
      if (d > 33) window.__spikes.push([Math.round(t), Math.round(d)]);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  `)

  await page.goto(url, { waitUntil: 'load', timeout: 180_000 })
  await page.bringToFront()
  // The atlas is 12MB and the title screen waits on it, then the card rail
  // deals itself in with an animation. Clicking during the deal fails with
  // "element is not visible" -- measured, and it is why the wait is generous.
  await page.waitForSelector('.hero', { state: 'visible', timeout: 180_000 })
  await page.waitForTimeout(6000)

  /* `menu.ts` calls onStart only when the clicked card is the SELECTED one, so
     an unselected card needs two clicks and the already-selected first card
     needs one. Click, check, click again if the home screen is still up. */
  const card = page.locator('.hero:not(.is-locked)').first()
  await card.click({ timeout: 30_000 })
  await page.waitForTimeout(800)
  const homeUp = async () => page.evaluate(
    `!!document.querySelector('.screen.home') && getComputedStyle(document.querySelector('.screen.home')).display !== 'none'`,
  ) as Promise<boolean>
  if (await homeUp()) { await card.click({ timeout: 30_000 }); await page.waitForTimeout(800) }
  await page.waitForTimeout(1500)
  const started = !(await homeUp())
  await page.keyboard.down('d')

  const samples: Sample[] = []
  let lastFrames = await page.evaluate('window.__frames') as number
  let lastSpikes = await page.evaluate('window.__spikes.length') as number
  let covered = false
  const t0 = Date.now()
  for (let t = 0; t < seconds; t += 5) {
    if (COVER && !covered && t >= COVER_AT) {
      cover = await chromium.launch({
        channel: 'chrome',
        headless: false,
        args: ['--window-position=0,0', `--window-size=${COVER_SIZE}`, '--no-first-run'],
      })
      const cp = await cover.newPage()
      await cp.goto('about:blank')
      await cp.bringToFront()
      covered = true
    }
    // Kite rather than walk into a wall; the arena clamps and a pinned player
    // stops generating collisions, which is a different game to measure.
    const key = ['d', 's', 'a', 'w'][Math.floor(t / 10) % 4]
    await page.keyboard.up('d').catch(() => {})
    await page.keyboard.up('s').catch(() => {})
    await page.keyboard.up('a').catch(() => {})
    await page.keyboard.up('w').catch(() => {})
    await page.keyboard.down(key)
    await page.waitForTimeout(5000)
    /* A production build has no `window.rdf`, so wave and enemy count come back
       as -1 there. Without them the dev/prod comparison is not a comparison:
       240fps with the level-up card up and 240fps at 40 enemies are the same
       number and different games. Reported so a reader can tell. */
    const [frames, spikes, vis, heap, wave, alive] = await page.evaluate(`(() => {
      const w = window.rdf && window.rdf.world;
      return [
        window.__frames,
        window.__spikes.length,
        document.visibilityState,
        performance.memory ? performance.memory.usedJSHeapSize : 0,
        w && w.spawner ? w.spawner.wave : -1,
        w ? w.enemies.live : -1,
      ];
    })()`) as [number, number, string, number, number, number]
    samples.push({
      t: Math.round((Date.now() - t0) / 1000),
      fps: +((frames - lastFrames) / 5).toFixed(1),
      frames: frames - lastFrames,
      over33: spikes - lastSpikes,
      visible: vis,
      heapMb: +(heap / 1048576).toFixed(1),
      wave,
      alive,
    })
    lastFrames = frames
    lastSpikes = spikes
    // Clear a level-up card if one is up; the sim freezes behind it.
    await page.keyboard.press('1').catch(() => {})
  }
  await page.keyboard.up('d').catch(() => {})

  const fps = samples.map((s) => s.fps)
  const sorted = [...fps].sort((a, b) => a - b)
  const lines = [
    `# Play-by-clicking — ${url}`,
    '',
    `${seconds}s, viewport 1920x1080 at deviceScaleFactor ${DPR} (canvas backing `
    + `${Math.round(1920 * DPR)}x${Math.round(1080 * DPR)}). Run started: ${started ? 'yes' : 'NO — no canvas found'}.`,
    COVER
      ? `A second Chrome window (${COVER_SIZE}) covered the game window from t=${COVER_AT}s. `
        + 'The anti-throttling flags were NOT passed for this run.'
      : 'Window fronted and unobstructed. Anti-throttling flags on, as every other tool here.',
    '',
    `Median fps **${sorted[sorted.length >> 1]}**, min ${Math.min(...fps)}, max ${Math.max(...fps)}.`,
    '',
    '| t | fps | frames in 5s | frames over 33ms | wave | alive | visibility | heap MB |',
    '|---|---|---|---|---|---|---|---|',
    ...samples.map((s) => `| ${s.t}s | ${s.fps} | ${s.frames} | ${s.over33} | `
      + `${s.wave < 0 ? '-' : s.wave} | ${s.alive < 0 ? '-' : s.alive} | ${s.visible} | ${s.heapMb} |`),
    '',
    '## Console',
    '',
    problems.length ? [...new Set(problems)].slice(0, 12).map((p) => `- ${p}`).join('\n') : 'clean',
    '',
  ]
  writeFileSync(out, lines.join('\n'))
  console.log(lines.join('\n'))
} finally {
  if (cover) await cover.close()
  await browser.close()
  if (server) stopVite(server)
}
