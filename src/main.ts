/**
 * Boot, canvas sizing, and the scene switch.
 *
 * The game is one of five states: menu, playing, level-up, shop, results.
 * Level-up and shop freeze the sim by setting `world.paused` rather than
 * stopping the loop — the renderer keeps drawing the frozen field behind the
 * cards, which is what makes a level-up feel like a beat in the run instead of
 * a context switch.
 */
import './ui/style.css'
import { Loop } from './core/loop'
import { Input } from './core/input'
import { Audio, type SfxName, type MusicLayer } from './core/audio'
import { Rng, seedFromString } from './core/rng'
import { World } from './sim/world'
import { OfferPool, type Offer } from './sim/offers'
import { Renderer } from './render/renderer'
import { Atlas } from './core/atlas'
import { Hud } from './ui/hud'
import { LevelUpScreen } from './ui/levelup'
import { ShopScreen } from './ui/shop'
import { ResultsScreen } from './ui/results'
import { MenuScreen } from './ui/menu'
import { PauseScreen } from './ui/pause'
import { DevOverlay } from './ui/dev'
import { WAVES } from './content'

type State = 'menu' | 'playing' | 'levelup' | 'shop' | 'results' | 'paused'

const canvas = document.getElementById('game') as HTMLCanvasElement
const uiRoot = document.getElementById('ui') as HTMLElement

const audio = new Audio()
// Browsers refuse to start an AudioContext before a gesture, so unlock on the
// first one of any kind rather than asking the player to press something.
for (const ev of ['pointerdown', 'keydown']) {
  window.addEventListener(ev, () => audio.unlock(), { once: false })
}

const input = new Input()
input.attach()

let world: World | null = null
let renderer: Renderer | null = null
/** Null until the atlas resolves, and stays null if it fails — the game then
 *  renders the M0-M3 coloured squares rather than not rendering at all. */
let atlas: Atlas | null = null
let offers: OfferPool | null = null
let hud: Hud | null = null
let state: State = 'menu'
/** Level-ups can arrive several at once from one gem; queue them. */
let pendingLevelUps = 0
let currentClassId = 'hand'
/** Shake RNG, separate from the sim's so camera jitter never perturbs a
 *  seeded run — the whole point of the seed is that the sim replays exactly. */
const shakeRng = new Rng(0xc0ffee)
const shakeRand = (): number => shakeRng.next()

const levelUp = new LevelUpScreen(uiRoot)
const shop = new ShopScreen(uiRoot)
const results = new ResultsScreen(uiRoot)
const menu = new MenuScreen(uiRoot, (classId, seed) => startRun(classId, seed))
const pause = new PauseScreen(uiRoot)

const dev = new DevOverlay(uiRoot, {
  skipWave: () => {
    if (world && state === 'playing') world.spawner.waveTime = WAVES.waveDuration
  },
  spawn: (typeId, count) => {
    if (!world) return
    for (let i = 0; i < count; i++) {
      const a = world.rng.range(0, Math.PI * 2)
      const d = world.rng.range(240, 420)
      world.spawnEnemy(typeId, world.player.x + Math.cos(a) * d, world.player.y + Math.sin(a) * d, false)
    }
  },
  killAll: () => {
    if (!world) return
    for (let i = world.enemies.live - 1; i >= 0; i--) world.enemies.free(i)
  },
  restartWithSeed: (seed) => startRun(currentClassId, seed),
})

function resize(): void {
  const dpr = Math.min(2, window.devicePixelRatio || 1)
  const w = Math.floor(window.innerWidth * dpr)
  const h = Math.floor(window.innerHeight * dpr)
  canvas.style.width = `${window.innerWidth}px`
  canvas.style.height = `${window.innerHeight}px`
  renderer?.resize(w, h)
}
window.addEventListener('resize', resize)

function startRun(classId: string, seedText: string): void {
  currentClassId = classId
  const seed = seedText ? seedFromString(seedText) : (Math.floor(Date.now() * 0.001) ^ 0x9e3779b9) >>> 0

  hud?.destroy()
  world = new World(seed, classId)
  offers = new OfferPool(world.rng)
  renderer = new Renderer(canvas, world, atlas)
  hud = new Hud(uiRoot)
  resize()
  renderer.camera.snapTo(world.player.x, world.player.y)

  world.events = {
    onSound: (name) => audio.play(name as SfxName),
    onLevelUp: (levels) => {
      audio.play('levelUp')
      pendingLevelUps += levels
    },
    onWaveComplete: (wave) => {
      if ((WAVES.shopAfterWaves as number[]).includes(wave)) queueShop()
      if (wave >= WAVES.waveCount) finishRun(true)
      // Layers follow the run's shape rather than a timer.
      void audio.setLayer((wave >= 11 ? 'combat' : 'field') as MusicLayer)
    },
    onBossWave: () => { void audio.setLayer('boss' as MusicLayer) },
    onPlayerDeath: () => finishRun(false),
  }

  menu.close()
  results.close()
  pause.close()
  audio.unlock()
  audio.preload()
  void audio.setLayer('field' as MusicLayer)
  state = 'playing'
}

function queueShop(): void {
  if (!world || !offers) return
  // The arena clears when the shop opens (§3) — survivors do not carry through
  // a shop, only through a wave boundary.
  for (let i = world.enemies.live - 1; i >= 0; i--) world.enemies.free(i)
  state = 'shop'
  world.paused = true
  shop.open(
    world,
    offers,
    (offer) => applyOffer(offer),
    () => {
      if (!world) return
      world.paused = false
      state = 'playing'
    },
  )
}

function applyOffer(offer: Offer): void {
  if (!world) return
  if (offer.kind === 'weapon') world.player.addWeapon(offer.id, offer.tierJump)
  else {
    world.player.addItem(offer.id, offer.boosted)
    world.refreshSpecialItems()
  }
}

function finishRun(cleared: boolean): void {
  if (!world) return
  state = 'results'
  world.paused = true
  results.open(
    world,
    cleared,
    () => startRun(currentClassId, ''),
    () => {
      state = 'menu'
      menu.open()
    },
  )
}

function openLevelUpIfPending(): void {
  if (!world || !offers) return
  if (pendingLevelUps <= 0 || state !== 'playing') return
  pendingLevelUps--
  state = 'levelup'
  world.paused = true
  levelUp.open(world, offers, (offer) => {
    applyOffer(offer)
    if (!world) return
    world.paused = false
    state = 'playing'
    // Another level may have been queued by the same gem.
    openLevelUpIfPending()
  })
}

const loop = new Loop(
  (dt) => {
    input.sample()

    // Pause is only reachable from play, and only leaves back to play. A
    // level-up or shop is already a pause with a decision attached, and
    // stacking a second freeze on top of one of those is how you get a screen
    // nobody can dismiss.
    if (input.pausePressed && world) {
      if (state === 'playing') {
        state = 'paused'
        world.paused = true
        pause.open(
          world,
          audio,
          () => {
            if (!world) return
            world.paused = false
            state = 'playing'
          },
          () => finishRun(false),
        )
      } else if (state === 'paused') {
        pause.close()
      }
    }

    if (state === 'levelup' && input.digitPressed > 0) {
      levelUp.handleDigit(input.digitPressed)
    }

    if (world && state === 'playing') {
      world.step(dt, input.moveX, input.moveY, input.abilityPressed)
      openLevelUpIfPending()
    }
  },
  (alpha) => {
    if (renderer && world) {
      renderer.draw(alpha, shakeRand)
      hud?.update(world)
      dev.update(loop, world, renderer)
    }
  },
)

resize()
menu.open()
loop.start()

// The atlas loads in the background. The menu is up while it does, and a
// failure is logged and survived rather than thrown — a missing atlas costs
// you the art, not the game.
Atlas.load(import.meta.env.BASE_URL)
  .then((a) => {
    atlas = a
    if (world) {
      // A run already started against no atlas: rebuild the renderer so it
      // picks up the art rather than staying square for the rest of the run.
      renderer = new Renderer(canvas, world, atlas)
      resize()
      renderer.camera.snapTo(world.player.x, world.player.y)
    }
  })
  .catch((err) => {
    console.warn('atlas unavailable, falling back to coloured squares:', err)
  })

// Expose for console poking during development. Not referenced by the game.
// `openLevelUp`/`openShop` exist so the card screens can be inspected without
// grinding to a level-up first — the same reason the dev overlay has a
// wave-skip key.
Object.assign(window as unknown as Record<string, unknown>, {
  rdf: {
    get world() { return world },
    get renderer() { return renderer },
    get offers() { return offers },
    startRun,
    openLevelUp: () => {
      pendingLevelUps++
      openLevelUpIfPending()
    },
    openShop: () => queueShop(),
    openPause: () => {
      if (!world || state !== 'playing') return
      state = 'paused'
      world.paused = true
      pause.open(
        world,
        audio,
        () => { if (world) { world.paused = false; state = 'playing' } },
        () => finishRun(false),
      )
    },
  },
})
