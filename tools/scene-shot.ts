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
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const kind = process.argv[2] ?? 'yard'
const out = process.argv[3] ?? `tools/scene-${kind}.png`
const settle = Number(process.argv[4] ?? 1200)
/**
 * Which beat of the home screen's sequence to photograph.
 *
 * `calm` is the default and is what this tool always used to shoot, because it
 * was all there was. The screen now runs a loop — calm, three strikes, the
 * blight, a three-second descent through the ground into the lab — and TIMING a
 * screenshot against a 640ms flash is a race nobody wins. So `MenuScreen` reads
 * `rdf.homePhase`, parks on the named state and stops; this writes it.
 *
 *     npm run scene -- yard tools/play/home/blight.png 1400 blight
 *     npm run scene -- yard tools/play/home/soil.png   1400 down
 */
const phase = process.argv[5] ?? ''
/**
 * `scene` frames the backdrop alone; `page` frames the whole window.
 *
 * The default is the scene, which is right for judging a composition and wrong
 * for judging the interface over it — the class rail, the print panel and the
 * scene picker are in `.home-ui`, a sibling, and a `.home-scene` screenshot has
 * never contained a single pixel of them.
 */
const frame = process.argv[6] ?? 'scene'
const PORT = 5199

/*
   Spawn vite's own entry with THIS node, not `npx`.

   `spawn('npx', ...)` is not portable: on Windows the executable is `npx.cmd`
   and a bare `npx` fails with ENOENT before vite is ever reached, which is how
   this tool broke the moment the project moved off the cloud sandbox. Adding
   `shell: true` would fix the lookup and buy a quoting problem instead -- the
   repo lives under `OneDrive/Documents/Claude/Ranch Defense Force`, and that
   space is exactly what a shell would split on.

   Resolving the module means no shell, no PATH lookup and no quoting: one
   argv array handed straight to the node already running.
*/
const viteBin = fileURLToPath(new URL('../node_modules/vite/bin/vite.js', import.meta.url))
const server = spawn(process.execPath, [viteBin, '--port', String(PORT), '--strictPort'], {
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
      `${store}/${d}/chrome-win/chrome.exe`,
      `${store}/${d}/chrome-mac/Chromium.app/Contents/MacOS/Chromium`,
    ])
  : []
const exe = candidates.find((c) => existsSync(c))
const browser = await chromium.launch(exe ? { executablePath: exe } : {})
try {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 })

  /*
     Ask for the scene, and for the beat of the sequence, we were told to shoot.

     `kind` used to name the output file and nothing else -- it could not choose
     what rendered, because `MenuScreen` picked its backdrop by CYCLING off
     `localStorage['rdf.homeScene']` and a fresh browser profile has no such
     key. Every shot this tool ever took was the same scene, whatever it was
     asked for. That is the "the home screen renders the FIELD scene" defect in
     NOTES -- not a bug in the scene, a bug in what the camera was pointed at.

     The key holds the scene to OPEN ON now rather than the previous one, so
     there is no off-by-one to compensate for; `rdf.homePhase` parks the
     sequence on a named state so a flash or a mid-descent frame can be
     photographed at all.
  */
  const KINDS = ['yard', 'field', 'lab']
  if (!KINDS.includes(kind)) {
    throw new Error(`unknown scene '${kind}' — expected one of ${KINDS.join(', ')}`)
  }
  const PHASES = ['', 'calm', 'flash', 'blight', 'down', 'lab']
  if (!PHASES.includes(phase)) {
    throw new Error(`unknown phase '${phase}' — expected one of ${PHASES.slice(1).join(', ')}`)
  }
  await page.addInitScript(
    `try {
       localStorage.setItem('rdf.homeScene', ${JSON.stringify(kind)});
       ${phase
      ? `localStorage.setItem('rdf.homePhase', ${JSON.stringify(phase)});`
      : `localStorage.removeItem('rdf.homePhase');`}
     } catch {}`,
  )
  const problems: string[] = []
  page.on('console', (m) => { if (m.type() === 'error') problems.push(m.text()) })
  page.on('pageerror', (e) => problems.push(String(e)))
  page.on('requestfailed', (r) => problems.push(`${r.failure()?.errorText} ${r.url()}`))

  /*
     Wait for the SCENE, not for the network to go quiet.

     `waitUntil: 'networkidle'` timed out at 30s here every time. It is the
     wrong question twice over: vite dev holds an HMR socket open, and a cold
     start on this checkout has to transform the module graph and serve a 12MB
     atlas off OneDrive-backed storage -- so "no requests for 500ms" can be
     minutes away, and says nothing about whether the scene has mounted.

     Waiting on the element answers the actual question and is faster in the
     normal case.
  */
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120_000 })

  /*
     `.scene, #scene, [data-scene]` matched NOTHING and never had -- the scene
     root is `home-yard is-<kind>` (see `buildScene`) inside a `.home-scene`
     stage. The old code fell back to `body` without saying so, so every shot
     was a whole-page screenshot presented as a scene shot. Report what was
     actually framed instead of falling back in silence.
  */
  const SCENE = '.home-scene, .phome-scene, .home-yard'
  await page.waitForSelector(SCENE, { timeout: 120_000 })
  // Now let the loops run so a walk is caught mid-stride rather than frame 0.
  await page.waitForTimeout(settle)

  const stage = page.locator(SCENE).first()
  const framed = (await stage.count()) > 0
  const target = frame === 'page' ? page.locator('body') : (framed ? stage : page.locator('body'))
  /*
     WHICH SCENE IS IN FRONT OF THE CAMERA IS NO LONGER "the only one built".

     All three live in one tall column -- surface, soil, lab -- and the shot is
     of whichever the column is translated to. So report the surface slot's
     class AND whether the column has descended, rather than reading the first
     `.home-yard` in the document and calling it the answer. Under the old check
     every lab shot would have been reported as the yard, correctly framed and
     wrongly described, which is exactly the class of mistake this tool exists
     to stop.
  */
  const surfaceClass = await page.locator('.home-slot.is-surface .home-yard').first()
    .getAttribute('class')
  const down = ((await page.locator('.home-column.is-down').count()) > 0)
  const shot = down ? 'lab' : (surfaceClass ?? '')
  await target.screenshot({ path: out })

  // Counted through locators rather than `page.evaluate`: the callback would run
  // in the browser but is type-checked HERE, and tools/tsconfig has no DOM lib
  // -- correctly, since everything else in tools/ is a Node script.
  const imgs = await page.locator('img').count()
  const divs = await page.locator('div').count()
  console.log(`${kind}${phase ? ` (${phase})` : ''} -> ${out}   (${imgs} img, ${divs} div)`)
  console.log(`framed: ${frame === 'page' ? 'body (whole window)' : (framed ? SCENE : 'body (FALLBACK -- scene root not found)')}`)
  console.log(`surface slot: ${surfaceClass ?? '(none)'}   column: ${down ? 'descended (lab)' : 'up (surface)'}`)
  if (!shot.includes(kind === 'lab' ? 'lab' : `is-${kind}`)) {
    console.log(`WARNING: asked for '${kind}' and got '${shot}'`)
  }
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
