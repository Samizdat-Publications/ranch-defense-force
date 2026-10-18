/**
 * Landing-page media for the showcase site, captured by script (never by hand).
 *
 *     node tools/showcase/film.mjs [--url https://.../] [--only hero,early,...] [--out DIR]
 *
 * Frame-by-frame: the game's own bot (src/dev/autopilot.ts, via rdf.fastForward)
 * steps the sim two ticks (1/30 s), rdf.renderNow() draws one frame, and a 1280x720
 * screenshot is saved. ffmpeg then stitches the frames at 30 fps, so the footage is
 * smooth whatever the machine can do in real time. The sim, the renderer and the HUD
 * are the real ones; only the bot's health is topped up on late waves (invulnerable),
 * the same staging the photo tour uses (tools/tour.ts).
 *
 * Needs Google Chrome installed (headed, GPU-backed WebGL2) and ffmpeg on PATH.
 * Frames go to --out/frames/<shot>/ ; encoded clips and stills go to --out.
 */
import { mkdirSync, rmSync, existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { chromium } from 'playwright'

const arg = (n, d) => {
  const i = process.argv.indexOf(`--${n}`)
  return i >= 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : d
}
const URL_ = arg('url', 'https://samizdat-publications.github.io/ranch-defense-force/')
const OUT = arg('out', 'site/media')
const FRAMES_DIR = arg('frames', `${OUT}/_frames`)
const only = arg('only', '') ? new Set(arg('only', '').split(',')) : null
const FPS = 30
const WAVE = 40 // seconds per wave (src/content/waves.json)
const waveStart = (n) => (n - 1) * WAVE

// Each shot: sim seconds to fast-forward before the camera rolls, then how long it rolls.
const SHOTS = [
  { name: 'early', prep: 3, secs: 9, invuln: false, hp: null, cardWait: 5500 },
  { name: 'hero', prep: waveStart(8) + 14, secs: 10, invuln: true, hp: 0.8 },
  { name: 'dusk', prep: waveStart(16) + 14, secs: 9, invuln: true, hp: 0.65 },
  { name: 'night', prep: waveStart(22) + 20, secs: 10, invuln: true, hp: 0.5 },
]

const ff = (page, s, invuln) => page.evaluate(`window.rdf.fastForward(${s}, ${JSON.stringify({ invulnerable: invuln })})`)

async function newPage(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 })
  const page = await ctx.newPage()
  const errs = []
  page.on('pageerror', (e) => errs.push(String(e)))
  await page.goto(`${URL_}?tour=1`, { waitUntil: 'domcontentloaded', timeout: 180_000 })
  await page.waitForFunction('!!window.rdf', null, { timeout: 60_000 })
  await page.evaluate('document.fonts ? document.fonts.ready : Promise.resolve()')
  await page.waitForFunction('window.rdf.atlas != null', null, { timeout: 60_000 })
  return { ctx, page, errs }
}

async function dismissLevelUps(page) {
  for (let i = 0; i < 6; i++) {
    const picked = await page.evaluate(`(() => {
      const root = document.querySelector('.screen.levelup')
      if (!root || getComputedStyle(root).display === 'none' || root.offsetParent === null) return false
      const card = root.querySelector('.pcard'); if (!card) return false
      card.click(); window.rdf.hold(true); return true })()`)
    if (!picked) return
    await page.waitForTimeout(200)
  }
}

async function shot(browser, s) {
  const { ctx, page, errs } = await newPage(browser)
  const dir = `${FRAMES_DIR}/${s.name}`
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  await page.evaluate(`window.rdf.startRun('hand', 'showcase'); window.rdf.hold(true)`)
  // Prep in half-minute strides so a stray level-up screen never stalls the bot.
  let left = s.prep
  while (left > 0) {
    const step = Math.min(left, 20)
    await ff(page, step, s.invuln)
    await dismissLevelUps(page)
    left -= step
  }
  if (s.hp) await page.evaluate(`window.rdf.stageHp(${s.hp})`)
  // Let the HUD and the wave card draw a few live frames of the moment before rolling.
  await page.evaluate('window.rdf.renderNow()')
  // The wave card animates in wall-clock time; let it clear before the camera rolls.
  await page.waitForTimeout(s.cardWait ?? 400)
  const n = s.secs * FPS
  const per = 1 / FPS
  const t0 = Date.now()
  let info = null
  for (let i = 0; i < n; i++) {
    info = await ff(page, per, s.invuln)
    if (s.invuln && i % 15 === 0) await page.evaluate(`window.rdf.stageHp(Math.max(${s.hp}, window.rdf.world.player.hp / window.rdf.world.player.stats.maxHp))`)
    await page.evaluate('window.rdf.renderNow()')
    await page.screenshot({ path: `${dir}/f${String(i).padStart(4, '0')}.jpg`, type: 'jpeg', quality: 95 })
    if (i % 60 === 0) await dismissLevelUps(page)
  }
  console.log(`${s.name}: ${n} frames in ${((Date.now() - t0) / 1000).toFixed(0)}s`, JSON.stringify(info), errs.length ? `PAGE ERRORS: ${errs.join(' | ')}` : '')
  await ctx.close()
  // Encode: H.264, yuv420p, faststart, no audio, light de-banding via crf 20.
  const r = spawnSync('ffmpeg', ['-y', '-v', 'error', '-framerate', String(FPS), '-i', `${dir}/f%04d.jpg`,
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '25', '-maxrate', '5M', '-bufsize', '10M', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an',
    `${OUT}/${s.name}.mp4`], { stdio: 'inherit' })
  if (r.status !== 0) throw new Error('ffmpeg failed')
  spawnSync('ffmpeg', ['-y', '-v', 'error', '-i', `${dir}/f0030.jpg`, '-q:v', '3', `${OUT}/${s.name}.jpg`], { stdio: 'inherit' })
}

// ---- stills (1280x720 JPG): title, homestead, and the two staged boss shots like tools/tour.ts ----
const FIRST_BOSS_WAVE = 12 // Prize Bull
const FINAL_BOSS_WAVE = 25 // the Duster
async function untilBoss(page) {
  for (let i = 0; i < 60; i++) {
    if (await page.evaluate('window.rdf.bossUp()')) break
    await ff(page, 0.5, true)
  }
  for (let i = 0; i < 14; i++) { await page.evaluate('window.rdf.stageBoss(1)'); await ff(page, 0.2, true) }
  await page.evaluate('window.rdf.stageBoss(0.62)')
  await page.waitForTimeout(120)
  await page.evaluate('window.rdf.hold(true)')
  await page.waitForTimeout(3800)
}
async function still(browser, name, run) {
  const { ctx, page, errs } = await newPage(browser)
  await run(page)
  await dismissLevelUps(page)
  await page.evaluate('window.rdf.hold(true); window.rdf.renderNow();')
  await page.waitForTimeout(250)
  await page.screenshot({ path: `${OUT}/${name}.jpg`, type: 'jpeg', quality: 93 })
  console.log(`still ${name}`, errs.length ? `PAGE ERRORS: ${errs.join(' | ')}` : '')
  await ctx.close()
}
const STILLS = [
  ['shot-title', async (page) => { await page.waitForTimeout(3500) }],
  ['shot-homestead', async (page) => { await page.evaluate('window.rdf.openHomestead()'); await page.waitForTimeout(900) }],
  ['shot-bull', async (page) => {
    await page.evaluate(`window.rdf.startRun('hand','showcase'); window.rdf.hold(true)`)
    for (let t = waveStart(FIRST_BOSS_WAVE) - 1; t > 0; t -= 20) { await ff(page, Math.min(20, t), true); await dismissLevelUps(page) }
    await untilBoss(page)
    await page.evaluate('window.rdf.stageHp(0.64); window.rdf.frameBoss()')
  }],
  ['shot-duster', async (page) => {
    await page.evaluate(`window.rdf.startRun('hand','showcase'); window.rdf.hold(true)`)
    for (let t = waveStart(FINAL_BOSS_WAVE) - 1; t > 0; t -= 20) { await ff(page, Math.min(20, t), true); await dismissLevelUps(page) }
    await untilBoss(page)
    await page.evaluate('window.rdf.stageHp(0.4); window.rdf.frameBoss()')
  }],
]

mkdirSync(OUT, { recursive: true })
const browser = await chromium.launch({
  channel: 'chrome', headless: false,
  args: ['--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--disable-features=CalculateNativeWinOcclusion'],
})
try {
  for (const s of SHOTS) if (!only || only.has(s.name)) await shot(browser, s)
  for (const [n, run] of STILLS) if (!only || only.has(n)) await still(browser, n, run)
} finally {
  await browser.close()
}
