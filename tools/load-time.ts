/**
 * How long the app takes to come up, and how long the ART takes after that.
 *
 *     node node_modules/vite-node/vite-node.mjs tools/load-time.ts [repeats]
 *
 * ## Why this exists
 *
 * `tools/play.ts` notes that page load can block for "tens of seconds — a 12MB
 * atlas", and the atlas was split into pages partly on the strength of that.
 * A claim like that is worth a number rather than a memory, and the number has
 * to separate two things the same page load conflates:
 *
 * - **boot** — `goto` until `window.rdf` exists. That is module evaluation and
 *   the first paint of the menu. The atlas is NOT on this path: `main.ts`
 *   kicks `Atlas.load` off and does not await it, deliberately, so a slow or
 *   missing atlas costs the art and not the game.
 * - **art** — `goto` until `rdf.atlas` is non-null, i.e. every page image has
 *   decoded and its white-silhouette flash copy has been built. This is the
 *   one the atlas size can move.
 *
 * Each repeat runs in a FRESH browser context, so nothing is served from a
 * warm HTTP cache and the decode happens for real every time. Dev server, not
 * a production build: that is what every other measurement in this repo used,
 * and mixing the two would not be comparable.
 */
import { startVite, launchBrowser, stopVite } from './harness.ts'

const repeats = Number(process.argv[2] ?? 5)
const PORT = 5199

const server = await startVite(PORT)
const browser = await launchBrowser({ headed: process.env.RDF_HEADLESS !== '1' })

interface Row { boot: number; art: number }
const rows: Row[] = []

try {
  for (let i = 0; i < repeats; i++) {
    const ctx = await browser.newContext({
      viewport: { width: 1600, height: 900 },
      deviceScaleFactor: 1,
    })
    const page = await ctx.newPage()
    page.setDefaultNavigationTimeout(180_000)
    const t0 = Date.now()
    await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'commit' })
    // Strings, not closures, for the same reason play.ts uses them: this file
    // typechecks under tools/tsconfig.json, which has no DOM lib.
    await page.waitForFunction('window.rdf', null, { timeout: 180_000 })
    const boot = Date.now() - t0
    await page.waitForFunction('window.rdf.atlas', null, { timeout: 180_000 })
    const art = Date.now() - t0
    rows.push({ boot, art })
    console.log(`run ${i + 1}: boot ${boot}ms, art ready ${art}ms`)
    await ctx.close()
  }
} finally {
  await browser.close()
  stopVite(server)
}

const med = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)] ?? 0
}
const boots = rows.map((r) => r.boot)
const arts = rows.map((r) => r.art)
console.log(
  `\nboot      median ${med(boots)}ms  (${Math.min(...boots)}-${Math.max(...boots)})\n`
  + `art ready median ${med(arts)}ms  (${Math.min(...arts)}-${Math.max(...arts)})`,
)
