/**
 * Photograph a title screen from the REAL app, in a real browser.
 *
 *     npm run scene -- [kind] [out.png] [ms]
 *
 * kind defaults to `yard`; `ms` is how long to let the animations run before
 * the shutter, so a walk cycle is caught mid-stride rather than on frame 0.
 *
 * ## Why this exists
 *
 * Every scene failure this project has had came from the same place: nobody
 * could look. `npm run shot` photographs the SIM through `tools/draw-world.ts`,
 * which is canvas and knows nothing about the title screen — the scenes are
 * DOM, built by `src/ui/scene.ts`, and until now the only way to see one was to
 * open a browser by hand. So the owner was the sole pair of eyes on it, and
 * every round trip cost a screenshot and a message. "Everything is floating on
 * the horizon" and "Joy is in the black silhouette where you can't see her"
 * were both caught that way, late, by a human.
 *
 * This drives the actual dev server with the actual code. It is not a
 * re-implementation of the scene, and that is the point — a second renderer
 * that agrees with itself proves nothing.
 *
 * Chromium is pre-installed in this environment; `playwright` is a dev-only
 * dependency and ships nothing. See NOTES.md for the dependency reason.
 */
import { spawn } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { chromium } from 'playwright'

const kind = process.argv[2] ?? 'yard'
const out = process.argv[3] ?? `tools/scene-${kind}.png`
const settle = Number(process.argv[4] ?? 1200)
const PORT = 5199

const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
  stdio: ['ignore', 'pipe', 'pipe'],
})
const url = `http://localhost:${PORT}/`

/** Wait for vite to say it is listening rather than sleeping a guessed amount. */
await new Promise<void>((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('vite did not start in 30s')), 30_000)
  const onData = (b: Buffer) => {
    if (b.toString().includes('ready in') || b.toString().includes('Local:')) {
      clearTimeout(timer); resolve()
    }
  }
  server.stdout.on('data', onData)
  server.stderr.on('data', onData)
})

/*
   Find the pre-installed Chromium rather than pin a path.

   `PLAYWRIGHT_BROWSERS_PATH` points at a store whose directories carry the
   BUILD number this environment shipped (`chromium-1194`), and the npm
   playwright expects whatever build IT was published against. When those differ
   playwright reports "executable doesn't exist" and downloading is disabled, so
   resolve by looking rather than by convention.
*/
const store = process.env.PLAYWRIGHT_BROWSERS_PATH ?? ''
const candidates = store
  ? readdirSync(store)
    .filter((d) => d.startsWith('chromium'))
    .flatMap((d) => [
      `${store}/${d}/chrome-linux/chrome`,
      `${store}/${d}/chrome-linux/headless_shell`,
    ])
  : []
const exe = candidates.find((c) => existsSync(c))
const browser = await chromium.launch(exe ? { executablePath: exe } : {})
try {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 })
  const problems: string[] = []
  page.on('console', (m) => { if (m.type() === 'error') problems.push(m.text()) })
  page.on('pageerror', (e) => problems.push(String(e)))
  page.on('requestfailed', (r) => problems.push(`${r.failure()?.errorText} ${r.url()}`))

  await page.goto(url, { waitUntil: 'networkidle' })
  // The scene mounts on the title screen; give the atlas a beat, then let the
  // loops run so a walk is caught mid-stride.
  await page.waitForTimeout(settle)

  const stage = page.locator('.scene, #scene, [data-scene]').first()
  const target = (await stage.count()) ? stage : page.locator('body')
  await target.screenshot({ path: out })

  // Counted through locators rather than `page.evaluate`: the callback would run
  // in the browser but is type-checked HERE, and tools/tsconfig has no DOM lib
  // -- correctly, since everything else in tools/ is a Node script.
  const imgs = await page.locator('img').count()
  const divs = await page.locator('div').count()
  console.log(`${kind} -> ${out}   (${imgs} img, ${divs} div)`)
  if (problems.length) {
    console.log(`\n${problems.length} console/network problem(s):`)
    for (const p of [...new Set(problems)].slice(0, 12)) console.log(`  ${p}`)
  } else {
    console.log('no console errors, no failed requests')
  }
} finally {
  await browser.close()
  server.kill('SIGTERM')
}
