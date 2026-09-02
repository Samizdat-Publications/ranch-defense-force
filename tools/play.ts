/**
 * Play a real run, in a real browser, and report what happened.
 *
 *     npm run play -- [class] [seconds] [outDir] [seed]
 *     npm run play -- hand 240 tools/play "harvest"
 *
 * ## Why this exists
 *
 * Balance on this game has never been played. Every number in `enemies.json`
 * for the base cast is interpolated, and the handoff has said so for several
 * sessions: "Do not tune alone." That is still true -- this does not replace
 * playing it. What it replaces is the part nobody could do at all: watching a
 * run advance through the ACTUAL renderer and reporting where it went.
 *
 * `npm run shot` cannot do that. It drives `tools/draw-world.ts`, a deliberate
 * second implementation of the renderer, so it proves the sim agrees with a
 * copy of the drawing rules -- never that the game on screen agrees with
 * either.
 *
 * ## What it drives
 *
 * `window.rdf` (dev builds, `src/main.ts`) exposes the live world, the
 * renderer and `startRun`, all as getters so the handle never goes stale.
 * Starting through it rather than by clicking a card means the class and seed
 * are stated rather than hoped for.
 *
 * Input is REAL keyboard events, because `src/core/input.ts` samples `e.code`
 * off `keydown`/`keyup` and nothing else reads key state. Movement is a slow
 * orbit: a bullet-heaven is played by kiting, and a player standing still
 * measures the wrong game. Level-ups take the first offer through the
 * number-key path the game already routes (`levelUp.handleDigit`), and the
 * shop is left by its own button.
 *
 * Everything reported is read off `rdf.world`, so it is the sim's own count
 * and not a guess from pixels.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { startVite, launchBrowser, stopVite } from './harness.ts'

const classId = process.argv[2] ?? 'hand'
const seconds = Number(process.argv[3] ?? 180)
const outDir = process.argv[4] ?? 'tools/play'
const seed = process.argv[5] ?? 'playtest'
const PORT = 5198

/** Sampled once a second off the live world. */
interface Sample {
  t: number
  wave: number
  hp: number
  maxHp: number
  level: number
  alive: number
  kills: number
  cleared: number
  feed: number
  elapsed: number
  fps: number
  levelUp: boolean
  shop: boolean
  results: boolean
  paused: boolean
  over: boolean
}

mkdirSync(outDir, { recursive: true })
const server = await startVite(PORT)
const browser = await launchBrowser({ headed: process.env.RDF_HEADLESS !== '1' })

try {
  const page = await browser.newPage({
    viewport: { width: 1600, height: 900 },
    deviceScaleFactor: 1,
  })
  const problems: string[] = []
  page.on('console', (m) => { if (m.type() === 'error') problems.push(m.text()) })
  page.on('pageerror', (e) => problems.push(String(e)))
  page.on('requestfailed', (r) => problems.push(`${r.failure()?.errorText} ${r.url()}`))
  // A bare "404 (Not Found)" console line names nothing. Catch the response so
  // the report says WHICH url -- the last handoff spent an unexplained 404 as
  // an open question for want of exactly this.
  page.on('response', (r) => {
    if (r.status() >= 400) problems.push(`HTTP ${r.status()} ${r.url()}`)
  })

  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  // The atlas resolves asynchronously and `rdf` is assigned at module bottom.
  await page.waitForFunction('window.rdf && window.rdf.screens', null, { timeout: 120_000 })

  /*
     Confirm rAF actually ticks before playing.

     A hidden browser pane does not fire one, and the failure is silent and
     total: the sim sits at wave 1, every key looks ignored, and it reads as a
     broken game rather than a stopped clock. Better to say so in one line than
     to hand back a flat timeline and let someone debug the game instead.
  */
  const COUNT_RAF = `new Promise((res) => {
    let n = 0; const t0 = performance.now();
    const f = () => { n++; performance.now() - t0 < 500 ? requestAnimationFrame(f) : res(n) };
    requestAnimationFrame(f);
  })`
  /*
     A COVERED window is throttled just like a hidden one.

     Chrome throttles rAF for an occluded window, and a freshly launched one
     can come up behind whatever the owner already has open -- measured at 1
     tick per 500ms in exactly that case, against 46/s when the window was on
     top. So raise it and re-measure rather than failing on the first reading;
     the run is worthless either way, but this is recoverable and worth
     recovering automatically.
  */
  let ticks = await page.evaluate(COUNT_RAF) as number
  for (let attempt = 0; ticks < 5 && attempt < 3; attempt++) {
    await page.bringToFront()
    await page.waitForTimeout(600)
    ticks = await page.evaluate(COUNT_RAF) as number
  }
  if (ticks < 5) {
    throw new Error(
      `rAF is not running (${ticks} ticks in 500ms) -- the sim cannot advance. `
      + 'The browser window is hidden, minimised or fully covered; Chrome throttles '
      + 'rAF for an occluded window and this game only advances on a presented frame.',
    )
  }

  await page.evaluate(`window.rdf.startRun(${JSON.stringify(classId)}, ${JSON.stringify(seed)})`)
  await page.waitForTimeout(500)

  /*
     Read the run's own numbers rather than the pixels.

     Passed as a STRING on purpose: `tools/tsconfig` has no DOM lib -- rightly,
     since everything else in tools/ is a Node script -- so a callback here
     would be type-checked in the wrong environment. `scene-shot.ts` makes the
     same choice for the same reason.
  */
  const READ = `(() => {
    const w = window.rdf.world; if (!w) return null;
    const sc = window.rdf.screens;
    return JSON.stringify({
      levelUp: sc.levelUp.visible, shop: sc.shop.visible,
      results: sc.results.visible, paused: !!w.paused, over: !!w.over,
      wave: w.spawner ? w.spawner.wave : 0,
      hp: Math.round(w.player.hp), maxHp: Math.round(w.player.stats.maxHp),
      level: w.player.level, feed: Math.round(w.player.feed),
      alive: w.enemies.live, kills: w.kills, cleared: w.wavesCleared,
      elapsed: Math.round(w.elapsed)
    });
  })()`

  const samples: Sample[] = []
  const events: string[] = []
  const shots: string[] = []
  // A slow orbit rather than a straight line: a bullet-heaven is played by
  // kiting, and a stationary player measures a game nobody plays.
  const ORBIT = ['d', 's', 'a', 'w']
  let held = ''
  let lastShot = -1e9
  let lastWave = 0

  for (let t = 0; t < seconds; t++) {
    const want = ORBIT[Math.floor(t / 3) % ORBIT.length]
    if (want !== held) {
      if (held) await page.keyboard.up(held)
      await page.keyboard.down(want)
      held = want
    }
    await page.waitForTimeout(1000)

    const fps = (await page.evaluate(COUNT_RAF) as number) * 2
    const raw = await page.evaluate(READ) as string | null
    if (!raw) { events.push(`t=${t}s  world is gone -- run ended`); break }
    const s = { t, fps, ...JSON.parse(raw) } as Sample
    samples.push(s)

    /*
       A card screen freezes the sim, so missing one stalls the entire run.

       Detected through `rdf.screens.*.visible`, NOT by sniffing class names.
       The level-up screen's root class is exactly `screen` -- no identifying
       name at all -- so a `className.includes('levelup')` test is always false.
       That cost a whole 6-minute run: the player hit level 2 at t=70s, the
       screen opened, and the next 290 samples were byte-identical. The flat
       timeline looked like a hung game and was a hung TEST.

       Keys stay real: `main.ts` routes `input.digitPressed` into
       `levelUp.handleDigit` inside the frame loop, which keeps running while
       the world is paused, so this exercises the path a player uses.
    */
    if (s.levelUp) {
      await page.keyboard.press('1')
      events.push(`t=${t}s  level ${s.level} -- took offer 1`)
      await page.waitForTimeout(400)
    } else if (s.shop) {
      const back = page.getByText('BACK TO THE FIELD').first()
      if (await back.count()) await back.click()
      events.push(`t=${t}s  shop after wave ${s.wave - 1} -- left with ${s.feed} feed`)
      await page.waitForTimeout(400)
    } else if (s.results || s.over) {
      /*
         `over` beats the results screen by a frame or two.

         `World.step` returns immediately on `this.over`, which is set the tick
         the player stops being alive -- but `finishRun` has to get through a
         frame before the results screen reports itself visible. Watching only
         the screen means the sim clock has already stopped while nothing looks
         open, which reads exactly like a hang. It was reported as one.
      */
      events.push(
        `t=${t}s  RUN OVER -- died on wave ${s.wave} at level ${s.level}, `
        + `${s.kills} kills, ${s.feed} feed banked`,
      )
      break
    }

    /*
       A world that stops moving while no screen is open is a stall, not play.
       Say so at once rather than filling the report with identical rows.
    */
    /*
       A world that stops moving while no screen is open is a stall -- but say
       WHICH stall. A throttled window and a stuck sim look identical in the
       numbers and have nothing to do with each other, and guessing between
       them is how an afternoon goes into debugging the wrong one. The frame
       rate is measured in the same sample, so the report can just say.
    */
    const prev = samples[samples.length - 2]
    if (prev && prev.elapsed === s.elapsed && !s.paused && !s.over) {
      events.push(
        s.fps < 10
          ? `t=${t}s  THROTTLED -- ${s.fps}fps, sim clock stuck at ${s.elapsed}s. `
            + 'The browser window is covered or minimised, not the game stalling.'
          : `t=${t}s  STALLED -- sim clock stuck at ${s.elapsed}s at ${s.fps}fps, no screen open`,
      )
      // A covered window is recoverable; raise it and give it one more second.
      if (s.fps < 10) { await page.bringToFront(); await page.waitForTimeout(1000); continue }
      break
    }

    const changed = s.wave !== lastWave
    if (changed) {
      events.push(`t=${t}s  wave ${s.wave} begins -- ${s.hp}/${s.maxHp} hp, level ${s.level}`)
      lastWave = s.wave
    }
    // Photograph on a wave change, or every 30s, whichever comes first.
    if (changed || t - lastShot >= 30) {
      const f = `${outDir}/t${String(t).padStart(4, '0')}-w${s.wave}.png`
      await page.screenshot({ path: f })
      shots.push(f)
      lastShot = t
    }
  }
  if (held) await page.keyboard.up(held)

  const last = samples[samples.length - 1]
  const lines = [
    `# Playthrough -- ${classId}, seed "${seed}", ${seconds}s requested`,
    '',
    `Ran ${samples.length}s of wall clock. rAF ticking at ~${ticks * 2}/s.`,
    '',
    '## Timeline',
    '',
    ...events.map((e) => `- ${e}`),
    '',
    '## Samples',
    '',
    '| t | fps | wave | hp | level | alive | kills | feed |',
    '|---|---|---|---|---|---|---|---|',
    ...samples
      .filter((s) => s.t % 10 === 0 || s === last)
      .map((s) => `| ${s.t}s | ${s.fps} | ${s.wave} | ${s.hp}/${s.maxHp} | ${s.level} | ${s.alive} | ${s.kills} | ${s.feed} |`),
    '',
    '## Shots',
    '',
    ...shots.map((f) => `- \`${f}\``),
    '',
    '## Console',
    '',
    problems.length
      ? [...new Set(problems)].slice(0, 15).map((p) => `- ${p}`).join('\n')
      : 'no console errors, no failed requests',
    '',
  ]
  const report = `${outDir}/REPORT.md`
  writeFileSync(report, lines.join('\n'))

  console.log(
    `${classId} seed "${seed}" -> wave ${last?.wave ?? 0}, level ${last?.level ?? 0}, `
    + `${last?.hp ?? 0}/${last?.maxHp ?? 0} hp`,
  )
  console.log(`${samples.length} samples, ${shots.length} shots -> ${report}`)
  for (const e of events) console.log(`  ${e}`)
  if (problems.length) {
    console.log(`\n${problems.length} console/network problem(s):`)
    for (const p of [...new Set(problems)].slice(0, 8)) console.log(`  ${p}`)
  }
} finally {
  await browser.close()
  stopVite(server)
}
