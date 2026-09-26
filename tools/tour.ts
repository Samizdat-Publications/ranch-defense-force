/**
 * Deterministic photo tour: boots the REAL game in Chrome, fast-forwards a
 * fixed list of scenarios with `src/dev/autopilot.ts`, and saves what the
 * player's own camera would have seen at each one.
 *
 *     npm run tour -- [--only name,name] [--out dir] [--viewport 1600x900]
 *                      [--url http://localhost:5180] [--class hand] [--seed tour] [--headless]
 *
 * ## Why fast-forward rather than play
 *
 * These screenshots go to a reviewer after every milestone, so they have to
 * be the same picture every time they are asked for. `tools/play.ts` plays a
 * run with real keyboard input over real wall-clock seconds, which is the
 * right tool for "does this feel right" and the wrong one for "the board
 * agrees with the last time we looked" — two runs of it never spawn the same
 * crowd at the same second. `rdf.fastForward` (src/main.ts) steps the sim
 * directly with the autopilot's inputs, so the same scenario list always
 * lands on the same tick.
 *
 * ## Headed by default, on THIS machine
 *
 * `rdf.hold(true)`/`rdf.renderNow()` mean rAF starvation (`tools/harness.ts`'s
 * reason to prefer headed for a tool that has to WATCH the game run) does not
 * apply here, so headless Chromium with SwiftShader (its software WebGL2
 * implementation, `--use-angle=swiftshader --enable-unsafe-swiftshader`) was
 * the first design. Measured on the box this project actually runs on:
 * `page.screenshot()` intermittently exceeded a 30s timeout under SwiftShader
 * while several other sessions' browsers were sharing the machine, and the
 * installed, GPU-backed Chrome did not. Headed installed Chrome is therefore
 * the default; `--headless` opts back into SwiftShader for a machine where a
 * window cannot pop up, falling back to headed if that machine cannot get a
 * WebGL2 context at all.
 */
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { chromium, type Browser, type Page } from 'playwright'
import { startVite, stopVite } from './harness.ts'
import { WAVES } from '../src/content/index.ts'

// ---------------------------------------------------------------- args ---

function argVal(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : fallback
}

const onlyArg = argVal('only', '')
const only = onlyArg ? new Set(onlyArg.split(',').map((s) => s.trim()).filter(Boolean)) : null
const outDir = argVal('out', 'screenshots/tour')
const viewportArg = argVal('viewport', '1600x900')
const viewportMatch = /^(\d+)x(\d+)$/.exec(viewportArg)
if (!viewportMatch) throw new Error(`bad --viewport '${viewportArg}' -- expected WIDTHxHEIGHT`)
const VW = Number(viewportMatch[1])
const VH = Number(viewportMatch[2])
const explicitUrl = argVal('url', '')
const classId = argVal('class', 'hand')
const seed = argVal('seed', 'tour')
const PORT = 5199

mkdirSync(outDir, { recursive: true })

// ------------------------------------------------------- wave arithmetic --

const WAVE_DURATION = WAVES.waveDuration as number
const WAVE_COUNT = WAVES.waveCount as number
const SHOP_AFTER = (WAVES.shopAfterWaves as number[]).slice().sort((a, b) => a - b)
const BOSS_WAVE_NUMBERS = Object.keys(WAVES.bossWaves as Record<string, string>)
  .map(Number).sort((a, b) => a - b)
const FIRST_BOSS_WAVE = BOSS_WAVE_NUMBERS[0]
const FINAL_BOSS_WAVE = BOSS_WAVE_NUMBERS[BOSS_WAVE_NUMBERS.length - 1]
const FIRST_SHOP_WAVE = SHOP_AFTER[0]

/** Seconds into the run when wave `n` begins -- wave 1 starts at t=0 and each
 *  wave runs `WAVE_DURATION` seconds, per `src/sim/spawner.ts`'s `beginWave`. */
function waveStart(n: number): number {
  return (n - 1) * WAVE_DURATION
}

// ------------------------------------------------------------- browser ---

const SWIFTSHADER_ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
/** Stop Chromium throttling a backgrounded/occluded window -- irrelevant to
 *  the sim itself (`rdf.hold`/`rdf.renderNow` sidestep rAF entirely) but a
 *  headed window can still end up behind something on a shared desktop. */
const HEADED_ARGS = [
  '--disable-background-timer-throttling',
  '--disable-backgrounding-occluded-windows',
  '--disable-renderer-backgrounding',
  '--disable-features=CalculateNativeWinOcclusion',
]
const wantHeadless = process.argv.includes('--headless')

function findBundledChromium(): string | undefined {
  const store = process.env.PLAYWRIGHT_BROWSERS_PATH ?? ''
  if (!store) return undefined
  const candidates = readdirSync(store)
    .filter((d) => d.startsWith('chromium'))
    .flatMap((d) => [
      `${store}/${d}/chrome-linux/chrome`,
      `${store}/${d}/chrome-linux/headless_shell`,
      `${store}/${d}/chrome-win/chrome.exe`,
      `${store}/${d}/chrome-mac/Chromium.app/Contents/MacOS/Chromium`,
    ])
  return candidates.find((c) => existsSync(c))
}

/**
 * Headed, installed Chrome by default -- see the header comment for why.
 * `--headless` opts into SwiftShader-backed headless Chromium instead, for a
 * machine where a window popping up is the problem rather than a fix; that
 * path still falls back to headed if headless cannot get a WebGL2 context at
 * all, checked with a throwaway page rather than assumed, since a
 * silently-square renderer would still "succeed" and photograph nothing
 * worth reviewing.
 */
async function launchForTour(): Promise<{ browser: Browser; headless: boolean }> {
  if (wantHeadless) {
    const exe = findBundledChromium()
    try {
      const browser = await chromium.launch(
        exe
          ? { executablePath: exe, args: SWIFTSHADER_ARGS, headless: true }
          : { args: SWIFTSHADER_ARGS, headless: true },
      )
      const probe = await browser.newPage()
      const ok = await probe.evaluate(
        "!!document.createElement('canvas').getContext('webgl2', { antialias: false })",
      ) as boolean
      await probe.close()
      if (ok) return { browser, headless: true }
      await browser.close()
      console.log('headless Chromium has no WebGL2 context even with SwiftShader -- falling back to headed Chrome')
    } catch (err) {
      console.log(`headless Chromium launch failed (${String(err)}) -- falling back to headed Chrome`)
    }
  }
  const browser = await chromium.launch({ channel: 'chrome', args: HEADED_ARGS, headless: false })
  return { browser, headless: false }
}

// ------------------------------------------------------------ helpers ----

async function waitReady(page: Page): Promise<void> {
  await page.waitForFunction('!!window.rdf', null, { timeout: 60_000 })
  await page.evaluate('document.fonts ? document.fonts.ready : Promise.resolve()')
  // The menu redraws once the atlas resolves (`main.ts`'s `Atlas.load().then`),
  // so waiting on it is what stops "title" from photographing coloured squares.
  await page.waitForFunction('window.rdf.atlas != null', null, { timeout: 60_000 })
}

function startRunJs(): string {
  return `window.rdf.startRun(${JSON.stringify(classId)}, ${JSON.stringify(seed)})`
}

/**
 * `rdf.fastForward`, called from Node. Passed as a STRING, like every other
 * `page.evaluate` call in this file: `tools/tsconfig` has no DOM lib, rightly,
 * since everything else here is a Node script, so a callback referencing
 * `window` would be type-checked in the wrong environment (see the same note
 * in `tools/play.ts` and `tools/scene-shot.ts`). Returns the summary object.
 */
async function ff(page: Page, seconds: number, invulnerable = false): Promise<unknown> {
  return page.evaluate(`window.rdf.fastForward(${seconds}, ${JSON.stringify({ invulnerable })})`)
}

/** Step half a second at a time until a boss is on the field, then three seconds more. */
async function untilBoss(page: Page): Promise<void> {
  for (let i = 0; i < 60; i++) {
    if (await page.evaluate('window.rdf.bossUp()')) break
    await ff(page, 0.5, true)
  }
  // Long enough to be past its entrance, short enough that a strong build
  // has not already killed it (a 3 s wait photographed an empty field).
  await ff(page, 1.2, true)
  // Then stand it inside the fence, facing the player (see rdf.stageBoss).
  await page.evaluate('window.rdf.stageBoss()')
}

/** Photograph the run at a representative health (see `rdf.stageHp`). */
async function stageHp(page: Page, frac: number): Promise<void> {
  await page.evaluate(`window.rdf.stageHp(${frac})`)
}

/** Freeze the loop, draw one frame synchronously, and save it. */
async function freezeAndShoot(page: Page, file: string): Promise<void> {
  await page.evaluate('window.rdf.hold(true); window.rdf.renderNow();')
  await page.waitForTimeout(200)
  // A generous timeout, not the 30s default: this machine runs several other
  // sessions' browsers alongside this one, and a software-rendered (SwiftShader)
  // capture under that contention is measurably slower than a GPU-backed one.
  await page.screenshot({ path: `${outDir}/${file}`, timeout: 60_000 })
}

// ----------------------------------------------------------- scenarios ---

interface Scenario {
  name: string
  file: string
  /** Drives the page to the state to photograph; returns whatever summary is
   *  worth recording (a `fastForward` result, or `null`). */
  run: (page: Page) => Promise<unknown>
}

const SCENARIOS: Scenario[] = [
  {
    name: 'title',
    file: '01-title.png',
    run: async (page) => {
      // The title is a live diorama at sundown; give it a few seconds to fade
      // its type in and settle the camera before the shutter.
      await page.waitForTimeout(3500)
      return null
    },
  },
  {
    name: 'homestead',
    file: '02-homestead.png',
    run: async (page) => {
      await page.evaluate('window.rdf.openHomestead();')
      await page.waitForTimeout(700)
      return null
    },
  },
  {
    name: 'run-start',
    file: '03-run-start.png',
    run: async (page) => {
      await page.evaluate(startRunJs())
      return ff(page, 4)
    },
  },
  {
    name: 'run-early',
    file: '04-run-early.png',
    run: async (page) => {
      await page.evaluate(startRunJs())
      return ff(page, 45)
    },
  },
  {
    name: 'run-mid',
    file: '05-run-mid.png',
    run: async (page) => {
      await page.evaluate(startRunJs())
      const s = await ff(page, waveStart(7) + 30)
      await stageHp(page, 0.78)
      return s
    },
  },
  {
    name: 'boss-bull',
    file: '06-boss-bull.png',
    run: async (page) => {
      await page.evaluate(startRunJs())
      // Invulnerable: a boss fight is exactly where an autopilot bot playing
      // its first ever wave-12 crowd is least likely to survive on its own.
      const s = await ff(page, waveStart(FIRST_BOSS_WAVE) - 1, true)
      await untilBoss(page)
      await stageHp(page, 0.64)
      await page.evaluate('window.rdf.frameBoss()')
      return s
    },
  },
  {
    name: 'run-late',
    file: '07-run-late.png',
    run: async (page) => {
      await page.evaluate(startRunJs())
      const s = await ff(page, waveStart(17) + 32, true)
      await stageHp(page, 0.52)
      return s
    },
  },
  {
    name: 'run-night',
    file: '08-run-night.png',
    run: async (page) => {
      await page.evaluate(startRunJs())
      const s = await ff(page, waveStart(22) + 32, true)
      await stageHp(page, 0.41)
      return s
    },
  },
  {
    name: 'boss-final',
    file: '09-boss-final.png',
    run: async (page) => {
      await page.evaluate(startRunJs())
      const s = await ff(page, waveStart(FINAL_BOSS_WAVE) - 1, true)
      await untilBoss(page)
      await stageHp(page, 0.33)
      await page.evaluate('window.rdf.frameBoss()')
      return s
    },
  },
  {
    name: 'levelup',
    file: '10-levelup.png',
    run: async (page) => {
      await page.evaluate(startRunJs())
      const summary = await ff(page, waveStart(7) + 10)
      // Forces a board open regardless of whether one happened to be pending
      // -- `rdf.openLevelUp` exists precisely so this does not depend on luck.
      await page.evaluate('window.rdf.openLevelUp();')
      await page.waitForTimeout(700)
      return summary
    },
  },
  {
    name: 'shop',
    file: '11-shop.png',
    run: async (page) => {
      await page.evaluate(startRunJs())
      // Stop just short of wave 5 completing, so the run's OWN headless shop
      // resolution (`resolveShopHeadless` in src/main.ts) has not fired yet
      // and the real shop screen can be opened and photographed instead.
      const summary = await ff(page, waveStart(FIRST_SHOP_WAVE) - 5)
      await page.evaluate('window.rdf.openShop();')
      await page.waitForTimeout(700)
      return summary
    },
  },
  {
    name: 'pause',
    file: '12-pause.png',
    run: async (page) => {
      await page.evaluate(startRunJs())
      const summary = await ff(page, 20)
      await page.evaluate('window.rdf.openPause();')
      await page.waitForTimeout(500)
      return summary
    },
  },
  {
    name: 'results-lose',
    file: '13-results-lose.png',
    run: async (page) => {
      await page.evaluate(startRunJs())
      const summary = await ff(page, 10)
      // Lethal damage through the sim's own `damagePlayer`, looped a few times
      // in case a dodge roll or a stray i-frame eats the first hit, then one
      // more tick (`fastForward`'s own step) so `World.step`'s end-of-tick
      // death check fires `onPlayerDeath` -> `finishRun(false)` exactly as it
      // would for a player who ran out of hp mid-game.
      await page.evaluate(`
        for (let i = 0; i < 5 && window.rdf.world.player.alive; i++) {
          window.rdf.world.damagePlayer(1e6, 'contact');
        }
      `)
      await ff(page, 1 / 60)
      await page.waitForTimeout(700)
      return summary
    },
  },
  {
    name: 'results-win',
    file: '14-results-win.png',
    run: async (page) => {
      await page.evaluate(startRunJs())
      const summary = await ff(page, waveStart(WAVE_COUNT) + 10, true)
      // The run only ends when the Duster dies; end it as a clear so the
      // screen photographed is the one a winning player sees.
      await page.evaluate('if (window.rdf.world && !window.rdf.world.paused) window.rdf.finishRun(true)')
      await page.waitForTimeout(900)
      return summary
    },
  },
]

// --------------------------------------------------------------- main ----

interface ReportEntry {
  scenario: string
  file: string
  summary: unknown
  consoleErrors: string[]
  pageErrors: string[]
  wallMs: number
}

async function main(): Promise<void> {
  // Our own server never hot-reloads; see vite.config.ts.
  process.env.RDF_NO_HMR = '1'
  let vite: Awaited<ReturnType<typeof startVite>> | null = null
  let url = explicitUrl
  if (!url) {
    vite = await startVite(PORT)
    url = `http://localhost:${PORT}/`
  }
  // `?tour` (read by `src/ui/dev.ts`) hides the dev overlay and the home
  // screen's dev state picker, which is CSS-gated on the same flag.
  const tourUrl = url.includes('?') ? `${url}&tour=1` : `${url}?tour=1`

  const { browser, headless } = await launchForTour()
  // Warm the dev server: its first page load compiles every module and can
  // take well over a minute cold, which used to time out the first scenario.
  {
    const warm = await browser.newPage()
    await warm.goto(tourUrl, { waitUntil: 'domcontentloaded', timeout: 300_000 }).catch(() => {})
    await warm.waitForFunction('window.rdf && window.rdf.atlas != null', null, { timeout: 300_000 }).catch(() => {})
    await warm.close()
  }
  console.log(`chromium: ${headless ? 'headless (SwiftShader)' : 'headed (installed Chrome)'}, url ${tourUrl}`)

  const report: ReportEntry[] = []
  try {
    for (const scenario of SCENARIOS) {
      if (only && !only.has(scenario.name)) continue
      const started = Date.now()
      // A fresh incognito context per scenario, not just a fresh page: they
      // share an origin, so `localStorage` (the home screen's scene/phase
      // keys) would otherwise leak from one scenario into the next.
      const context = await browser.newContext({
        viewport: { width: VW, height: VH },
        deviceScaleFactor: 1,
      })
      const page = await context.newPage()
      const consoleErrors: string[] = []
      const pageErrors: string[] = []
      page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()) })
      page.on('pageerror', (e) => pageErrors.push(String(e)))

      let summary: unknown = null
      try {
        await page.goto(tourUrl, { waitUntil: 'domcontentloaded', timeout: 180_000 })
        await waitReady(page)
        summary = await scenario.run(page)
        await freezeAndShoot(page, scenario.file)
        console.log(`${scenario.name.padEnd(12)} -> ${scenario.file}  ${JSON.stringify(summary)}`)
      } catch (err) {
        pageErrors.push(`SCENARIO FAILED: ${String(err)}`)
        console.error(`${scenario.name.padEnd(12)} FAILED: ${String(err)}`)
      } finally {
        await context.close()
      }

      report.push({
        scenario: scenario.name,
        file: scenario.file,
        summary,
        consoleErrors: [...new Set(consoleErrors)],
        pageErrors: [...new Set(pageErrors)],
        wallMs: Date.now() - started,
      })
    }
  } finally {
    await browser.close()
    if (vite) stopVite(vite)
  }

  writeFileSync(`${outDir}/report.json`, JSON.stringify(report, null, 2))
  const failed = report.filter((r) => r.pageErrors.some((e) => e.startsWith('SCENARIO FAILED')))
  console.log(`\n${report.length} scenario(s), ${failed.length} failed -> ${outDir}/report.json`)
  if (failed.length > 0) process.exitCode = 1
}

await main()
