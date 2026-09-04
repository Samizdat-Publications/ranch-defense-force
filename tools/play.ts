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
/* How often to sample. Configurable so the sampler can be ruled IN or OUT as
   the cause of a periodic hitch -- if a spike period follows this value, the
   spikes are the measurement, not the game. */
const SAMPLE_MS = Number(process.env.RDF_SAMPLE_MS ?? 1000)

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
  wall: number
  fps: number
  levelUp: boolean
  shop: boolean
  /** Seconds left on the class ability's cooldown, and on its active window.
   *  Sampled so a run can PROVE the ability fired rather than assume it. */
  abilityCd: number
  abilityActive: number
  results: boolean
  paused: boolean
  over: boolean
  hitstop: number
  playerAlive: boolean
  tick: number
  pauseOpen: boolean
  waveTime: number
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

  /*
     Record every long frame, and the heap alongside it.

     The owner reported a stutter "roughly every 6-10 seconds". A periodic
     hitch with a stable period is a different animal from a slow frame: it
     points at something that happens on a schedule, and the usual suspect in a
     game with a zero-allocation rule is the garbage collector. So sample the
     heap next to the frame times -- a sawtooth that drops exactly when a spike
     lands is GC, and a spike with a flat heap is work.

     Installed before app code so frame zero is covered.
  */
  await page.addInitScript(`
    window.__spikes = []; window.__frames = 0; window.__heap = [];
    let last = performance.now();
    const tick = (t) => {
      const d = t - last; last = t; window.__frames++;
      if (d > 33) window.__spikes.push([Math.round(t), Math.round(d)]);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    setInterval(() => {
      const m = performance.memory;
      if (m) window.__heap.push([Math.round(performance.now()), m.usedJSHeapSize]);
    }, 250);
  `)

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
     Throw away everything recorded before the run.

     Page load blocks the main thread for tens of seconds and shows up as one
     absurd 52-60s "frame" that dominates the spike table and means nothing
     about play. Reset here so every number below is gameplay, and re-base the
     clock on the run.

     It is the MODULE GRAPH, not the art -- this comment used to blame "a 12MB
     atlas" and that was wrong. `tools/load-time.ts` measured it: the first
     load into a cold browser context takes ~81s and `rdf.atlas` resolves 7ms
     after `window.rdf` appears, because the atlas fetched and decoded in
     parallel while vite transformed. Every later load takes ~190ms to boot and
     ~700ms to art. The atlas is never awaited on the boot path anyway --
     `main.ts` fires `Atlas.load` and does not wait, deliberately.
  */
  /* `RDF_NO_OVERLAY=1` toggles the dev overlay off (F1) before measuring, so
     its per-frame text and graph work can be ruled in or out. */
  /*
     `RDF_PROFILE=1` takes a real CPU profile over the run.

     A/B-ing suspects stopped working: run-to-run variance is larger than any
     effect being tested (turning the dev overlay OFF measured WORSE than
     leaving it on, which says the runs differ, not that the overlay helps).
     Sampling the stack is the only thing that names a function instead of
     nominating one.
  */
  const cdp = process.env.RDF_PROFILE === '1'
    ? await page.context().newCDPSession(page)
    : null
  if (cdp) {
    await cdp.send('Profiler.enable')
    await cdp.send('Profiler.setSamplingInterval', { interval: 200 })
    await cdp.send('Profiler.start')
  }

  if (process.env.RDF_NO_OVERLAY === '1') {
    await page.keyboard.press('F1')
    await page.waitForTimeout(300)
  }
  await page.evaluate('window.__spikes.length = 0; window.__heap.length = 0; window.__t0 = performance.now();')

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
      hitstop: +(w.hitstop || 0).toFixed(2), playerAlive: !!w.player.alive,
      tick: w.tick, pauseOpen: !!sc.pause.isOpen, waveTime: +(w.spawner ? w.spawner.waveTime : 0).toFixed(1),
      alive: w.enemies.live, kills: w.kills, cleared: w.wavesCleared,
      elapsed: Math.round(w.elapsed),
      abilityCd: +(w.player.abilityCooldown || 0).toFixed(1),
      abilityActive: +(w.player.abilityActive || 0).toFixed(1)
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
  /** Card-screen photographs taken so far, and the cap on each kind. */
  let boards = 0
  let shopShots = 0
  const MAX_BOARD_SHOTS = 6
  let lastFps = ticks * 2
  let lastWave = 0
  const started = Date.now()

  for (let t = 0; t < seconds; t++) {
    const want = ORBIT[Math.floor(t / 3) % ORBIT.length]
    if (want !== held) {
      if (held) await page.keyboard.up(held)
      await page.keyboard.down(want)
      held = want
    }
    /*
       Press the ability every second.

       It used to be pressed never, which meant every playthrough report in
       this repo measured a class with its ability button unplugged -- fine
       while four of the six shared two archetypes, useless now that each has
       its own. Once a second is safely under every cooldown in classes.json
       (the shortest is 8s), and the press is real keyboard input into the same
       `e.code === 'Space'` latch a player uses. `abilityCd` in the sample is
       how the report then proves it fired.
    */
    await page.keyboard.press('Space')
    await page.waitForTimeout(SAMPLE_MS)

    /*
       The fps probe BLOCKS for 500ms, so paying it every second silently made
       each iteration ~1.6s and every `t=` in this report a lie -- a run said
       t=95s when 190s of wall clock had passed. Sample it every 10th tick and
       carry the last reading; the frame-time recorder in the page catches
       anything that happens in between anyway.
    */
    if (t % 10 === 0) lastFps = (await page.evaluate(COUNT_RAF) as number) * 2
    const fps = lastFps
    const raw = await page.evaluate(READ) as string | null
    if (!raw) { events.push(`t=${Math.round((Date.now() - started) / 1000)}s  world is gone -- run ended`); break }
    const wall = Math.round((Date.now() - started) / 1000)
    const s = { t, wall, fps, ...JSON.parse(raw) } as Sample
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
    /*
       Photograph the card screens BEFORE dismissing them.

       This tool could report that a level-up happened and never show one. The
       cards are most of what an upgrade change is — the delta line, the stack
       counter, what four cards look like side by side — and a run that closes
       every board before the shutter opens can only ever prove the run
       advanced. Capped so a long run does not write forty of them.
    */
    if (s.levelUp) {
      if (boards < MAX_BOARD_SHOTS) {
        // Let the deal land. card.ts staggers each card by 110ms, so a shot
        // fired the instant the screen opens catches two cards mid-fade and
        // reports a two-card board -- which is exactly what the first run of
        // this photographed.
        await page.waitForTimeout(700)
        const f = `${outDir}/board-${String(boards).padStart(2, '0')}-lv${s.level}.png`
        await page.screenshot({ path: f })
        shots.push(f)
        boards++
      }
      await page.keyboard.press('1')
      events.push(`t=${Math.round((Date.now() - started) / 1000)}s  level ${s.level} -- took offer 1`)
      await page.waitForTimeout(400)
    } else if (s.shop) {
      if (shopShots < MAX_BOARD_SHOTS) {
        await page.waitForTimeout(700)
        const f = `${outDir}/shop-${String(shopShots).padStart(2, '0')}-w${s.wave - 1}.png`
        await page.screenshot({ path: f })
        shots.push(f)
        shopShots++
      }
      const back = page.getByText('BACK TO THE FIELD').first()
      if (await back.count()) await back.click()
      events.push(`t=${Math.round((Date.now() - started) / 1000)}s  shop after wave ${s.wave - 1} -- left with ${s.feed} feed`)
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
        `t=${Math.round((Date.now() - started) / 1000)}s  RUN OVER -- died on wave ${s.wave} at level ${s.level}, `
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
    /*
       Compare TICK, not the clock.

       `elapsed` was rounded to whole seconds and compared across samples about
       a second apart, so two honest readings could round to the same integer
       and be reported as a frozen sim. It fired three times on a game that was
       running fine, and each one read like a hang worth chasing. `tick` is an
       exact integer that advances once per fixed step, so an unchanged tick
       means the step really did not run.
    */
    if (prev && prev.tick === s.tick && !s.paused && !s.over) {
      events.push(
        s.fps < 10
          ? `t=${Math.round((Date.now() - started) / 1000)}s  THROTTLED -- ${s.fps}fps, sim clock stuck at ${s.elapsed}s. `
            + 'The browser window is covered or minimised, not the game stalling.'
          : `t=${Math.round((Date.now() - started) / 1000)}s  STALLED -- sim clock stuck at ${s.elapsed}s `
            + `at ${s.fps}fps. tick=${s.tick} (was ${prev.tick}) hitstop=${s.hitstop} `
            + `playerAlive=${s.playerAlive} over=${s.over} paused=${s.paused} `
            + `pause=${s.pauseOpen} levelUp=${s.levelUp} shop=${s.shop} results=${s.results} `
            + `waveTime=${s.waveTime}`,
      )
      // A covered window is recoverable; raise it and give it one more second.
      if (s.fps < 10) { await page.bringToFront(); await page.waitForTimeout(1000); continue }
      break
    }

    const changed = s.wave !== lastWave
    if (changed) {
      events.push(`t=${Math.round((Date.now() - started) / 1000)}s  wave ${s.wave} begins -- ${s.hp}/${s.maxHp} hp, level ${s.level}`)
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
  /*
     How many times the ability actually went off.

     A rising cooldown between two samples can only mean it was pressed and
     accepted, so this counts firings rather than presses -- which is the claim
     worth making. Zero here on a run of any length means the ability id in
     classes.json has no branch in `tryAbility` and the button is dead.
  */
  let abilityFires = 0
  for (let i = 1; i < samples.length; i++) {
    if (samples[i].abilityCd > samples[i - 1].abilityCd) abilityFires++
  }
  const lines = [
    `# Playthrough -- ${classId}, seed "${seed}", ${seconds}s requested`,
    '',
    `Ran ${samples.length}s of wall clock. rAF ticking at ~${ticks * 2}/s.`,
    `Ability fired ${abilityFires}x (SPACE pressed once a second).`,
    '',
    '## Timeline',
    '',
    ...events.map((e) => `- ${e}`),
    '',
    '## Samples',
    '',
    '| wall | fps | wave | hp | level | alive | kills | feed |',
    '|---|---|---|---|---|---|---|---|',
    ...samples
      .filter((s) => s.t % 10 === 0 || s === last)
      .map((s) => `| ${s.wall}s | ${s.fps} | ${s.wave} | ${s.hp}/${s.maxHp} | ${s.level} | ${s.alive} | ${s.kills} | ${s.feed} |`),
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
  if (cdp) {
    const { profile } = await cdp.send('Profiler.stop') as {
      profile: {
        nodes: { id: number; callFrame: { functionName: string; url: string; lineNumber: number } }[]
        samples: number[]
        timeDeltas: number[]
      }
    }
    // Self time per call frame: the sample sits on the function actually
    // running, so summing the deltas against it is where the time went.
    const byId = new Map<number, number>()
    for (let i = 0; i < profile.samples.length; i++) {
      const id = profile.samples[i]
      byId.set(id, (byId.get(id) ?? 0) + (profile.timeDeltas[i] ?? 0))
    }
    const named = new Map<string, number>()
    for (const n of profile.nodes) {
      const us = byId.get(n.id)
      if (!us) continue
      const f = n.callFrame
      const where = f.url.replace(/^https?:\/\/[^/]+/, '')
      const key = `${f.functionName || '(anonymous)'}  ${where}:${f.lineNumber + 1}`
      named.set(key, (named.get(key) ?? 0) + us)
    }
    const total = [...named.values()].reduce((a, b) => a + b, 0) || 1
    const top = [...named.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25)
    lines.push(
      '## CPU profile',
      '',
      `${(total / 1e6).toFixed(1)}s of samples.`,
      '',
      '| self | % | function |',
      '|---|---|---|',
      ...top.map(([k, us]) => `| ${(us / 1e6).toFixed(2)}s | ${(us / total * 100).toFixed(1)}% | \`${k}\` |`),
      '',
    )
  }

  /* Frame-time spikes and the heap behind them. */
  const spikes = await page.evaluate('JSON.stringify(window.__spikes || [])') as string
  const heap = await page.evaluate('JSON.stringify(window.__heap || [])') as string
  const base = await page.evaluate('window.__t0 || 0') as number
  const sp = (JSON.parse(spikes) as [number, number][]).map(([t, d]) => [t - base, d] as [number, number])
  const hp = JSON.parse(heap) as [number, number][]
  const gaps: number[] = []
  for (let i = 1; i < sp.length; i++) gaps.push((sp[i][0] - sp[i - 1][0]) / 1000)
  const median = gaps.length
    ? [...gaps].sort((a, b) => a - b)[Math.floor(gaps.length / 2)]
    : 0
  const worst = [...sp].sort((a, b) => b[1] - a[1]).slice(0, 10)
  // Heap drops mean a collection ran. Their spacing is the GC period.
  const drops: number[] = []
  for (let i = 1; i < hp.length; i++) {
    if (hp[i][1] < hp[i - 1][1] * 0.85) drops.push(hp[i][0] / 1000)
  }
  const dropGaps: number[] = []
  for (let i = 1; i < drops.length; i++) dropGaps.push(drops[i] - drops[i - 1])

  // The whole series, so periodicity can be looked for offline rather than
  // guessed at from a top-ten table.
  writeFileSync(`${outDir}/spikes.json`, JSON.stringify({
    spikes: sp.map(([t, d]) => [+(t / 1000).toFixed(2), d]),
    events,
  }))

  lines.push(
    '## Frame spikes',
    '',
    `${sp.length} frames over 33ms. Median gap between them: **${median.toFixed(1)}s**.`,
    '',
    `Heap collections (a drop over 15%): ${drops.length}`
    + (dropGaps.length
      ? `, median **${[...dropGaps].sort((a, b) => a - b)[Math.floor(dropGaps.length / 2)].toFixed(1)}s** apart.`
      : '.'),
    '',
    '| at | frame ms |',
    '|---|---|',
    ...worst.map(([t, d]) => `| ${(t / 1000).toFixed(1)}s | ${d} |`),
    '',
  )

  const report = `${outDir}/REPORT.md`
  writeFileSync(report, lines.join('\n'))

  console.log(
    `${classId} seed "${seed}" -> wave ${last?.wave ?? 0}, level ${last?.level ?? 0}, `
    + `${last?.hp ?? 0}/${last?.maxHp ?? 0} hp, ability fired ${abilityFires}x`,
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
