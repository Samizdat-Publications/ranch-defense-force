/**
 * Play a real run in a real browser and photograph the frame a CONDITION holds.
 *
 *     npm run catch -- <class> <seed> <out.png> "<predicate>" [afterTick]
 *     npm run catch -- hand harvest tools/play/thrust/mid-thrust.png \
 *       "(() => { const s = w.player.weapons.find(x => x.id === 'pitchfork'); \
 *          return s && s.firedAt > 0 && w.tick - s.firedAt >= 4 && w.tick - s.firedAt <= 6 })()"
 *
 * `npm run play` photographs on a wave change or every thirty seconds, which is
 * the right rule for watching a run and the wrong one for looking at a 0.16s
 * animation: the pitchfork's thrust is nine ticks long inside a 0.7s cooldown,
 * and catching one by waiting is hopeless. This polls `window.rdf.world` and
 * shoots the first frame the predicate is true on.
 *
 * The predicate is evaluated in the page with `w` bound to the live world, so
 * it asks the SIM whether the moment has arrived rather than guessing from
 * pixels -- the same discipline `npm run play` reports by.
 *
 * `afterTick` skips the opening seconds, where the field is empty and every
 * weapon fires on tick zero. Movement is a slow left-right shuffle so the
 * player does not end the run pinned against an arena wall, where half the
 * effect is drawn off the edge of the world.
 */
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { startVite, launchBrowser, stopVite } from './harness.ts'

const a = process.argv.slice(2).filter((v) => v !== '--')
const classId = a[0] ?? 'hand'
const seed = a[1] ?? 'catch'
const out = a[2] ?? 'tools/play/catch.png'
const predicate = a[3] ?? 'true'
const afterTick = Number(a[4] ?? 600)
const PORT = 5201

mkdirSync(dirname(out), { recursive: true })
const server = await startVite(PORT)
const browser = await launchBrowser({ headed: process.env.RDF_HEADLESS !== '1' })
try {
  const page = await browser.newPage()
  await page.setViewportSize({ width: 1600, height: 900 })
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  await page.waitForFunction('window.rdf && window.rdf.screens', null, { timeout: 120_000 })
  // Passed as SOURCE, not as a closure: `window` has no type in the tools
  // tsconfig (lib ES2022, no DOM), and `tools/play.ts` reaches into the page
  // the same way for the same reason.
  await page.evaluate(`window.rdf.startRun(${JSON.stringify(classId)}, ${JSON.stringify(seed)})`)

  let key = 'KeyD'
  await page.keyboard.down(key)
  let caught = -1
  for (let i = 0; i < 9000; i++) {
    const hit = await page.evaluate(
      `(() => { const w = window.rdf.world;`
      + ` if (!w || w.tick < ${afterTick}) return -1;`
      + ` return (${predicate}) ? w.tick : -1 })()`,
    ) as number
    if (hit >= 0) { caught = hit; await page.screenshot({ path: out }); break }
    if (i > 0 && i % 60 === 0) {
      await page.keyboard.up(key)
      key = key === 'KeyD' ? 'KeyA' : 'KeyD'
      await page.keyboard.down(key)
    }
    await page.waitForTimeout(2)
  }
  await page.keyboard.up(key)
  console.log(caught >= 0 ? `caught at tick ${caught} -> ${out}` : 'never caught')
  if (caught < 0) process.exitCode = 1
} finally {
  await browser.close()
  stopVite(server)
}
