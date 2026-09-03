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
import { HomesteadScreen } from './ui/homestead'
import { DevOverlay } from './ui/dev'
import { setSpriteAtlas, installRarityTheme } from './ui/sprite'
import { WAVES, RARITY } from './content'
import { load as loadSave, save as writeSave, type Save } from './sim/save'
import {
  metaStats, unlockedWeapons, unlockedItems, bankRun, unlockedClasses, bunkhouseOffers,
} from './sim/meta'

type State = 'menu' | 'playing' | 'levelup' | 'shop' | 'results' | 'paused' | 'homestead'

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
/** The Homestead save, held in memory and written back on every change. */
let profile: Save = loadSave()
/** County Fair tier for the next run. */
let currentTier = 1
/** Shake RNG, separate from the sim's so camera jitter never perturbs a
 *  seeded run — the whole point of the seed is that the sim replays exactly. */
const shakeRng = new Rng(0xc0ffee)
const shakeRand = (): number => shakeRng.next()

const levelUp = new LevelUpScreen(uiRoot)
const shop = new ShopScreen(uiRoot)
const results = new ResultsScreen(uiRoot)
const menu = new MenuScreen(uiRoot, (classId, seed) => startRun(classId, seed), () => openHomestead())
const pause = new PauseScreen(uiRoot)
const homestead = new HomesteadScreen(uiRoot)

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
  // Purchases become run modifiers here and nowhere else, so the save never
  // holds a derived number that balance changes could invalidate.
  const m = metaStats(profile)
  world = new World(seed, classId, {
    maxHp: m.maxHp,
    moveSpeedPct: m.moveSpeedPct,
    armor: m.armor,
    harvestPct: m.harvestPct,
    luck: m.luck,
  }, currentTier)
  offers = new OfferPool(world.rng)
  offers.setUnlocked([...unlockedWeapons(profile), ...unlockedItems(profile)])
  renderer = new Renderer(canvas, world, atlas)
  hud = new Hud(uiRoot)
  resize()
  renderer.camera.snapTo(world.player.x, world.player.y)

  // A handle on the live run, dev builds only, so what is actually on screen can
  // be inspected from the console. Headless tools can be made to agree with
  // themselves and still disagree with the browser; this is how that gets
  // caught instead of argued about.
  // NOTE: `window.rdf` is built ONCE, at the bottom of this file. It used to be
  // rebuilt here on every `startRun` as well, and the two definitions did not
  // carry the same keys — so `rdf.screens` existed only after a run had begun
  // and `rdf.startRun` only before one had. Which handle you got depended on
  // what you had already done, which is a miserable thing to debug from a
  // console. Everything below is a getter, so one object stays live.

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
    // A descent is the same run in a new room: the sim has already swapped the
    // map and kept the player's build, so all that is left up here is to rebuild
    // what the renderer baked off the old one.
    onDescend: () => {
      renderer?.onMapChanged()
      audio.play('waveStart' as SfxName)
    },
    onPlayerDeath: () => finishRun(false),
  }

  menu.close()
  results.close()
  pause.close()
  homestead.close()
  audio.unlock()
  audio.preload()
  void audio.setLayer('field' as MusicLayer)
  state = 'playing'
}

/**
 * The Homestead, reachable from the results screen and the menu.
 *
 * Closes every other screen first: this is a scene switch, not an overlay, and
 * a results panel left visible behind it reads as the game having hung.
 */
/** Acre price per locked class, for the brand on a nailed packet. */
function classPrices(): Map<string, number> {
  return new Map(bunkhouseOffers(profile).map((o) => [o.id, o.cost]))
}

function openHomestead(): void {
  results.close()
  menu.close()
  pause.close()
  state = 'homestead'
  homestead.open(
    profile,
    currentTier,
    (t) => { currentTier = t },
    () => {
      homestead.close()
      state = 'menu'
      // A class bought in the Bunkhouse must be pickable the moment you leave it.
      menu.setUnlocked(unlockedClasses(profile), classPrices(), profile.acres)
      menu.open()
    },
  )
}

function queueShop(): void {
  if (!world || !offers) return
  // The arena clears when the shop opens (§3) — survivors do not carry through
  // a shop, only through a wave boundary.
  for (let i = world.enemies.live - 1; i >= 0; i--) world.enemies.free(i)
  state = 'shop'
  audio.play('shopOpen')
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
  audio.play('purchase')
  if (offer.kind === 'weapon') world.player.addWeapon(offer.id, offer.tierJump)
  else {
    world.player.addItem(offer.id, offer.boosted)
    world.refreshSpecialItems()
  }
}

function finishRun(cleared: boolean): void {
  if (!world) return
  audio.play(cleared ? 'victory' : 'gameOver')
  void audio.setLayer(null)
  state = 'results'
  world.paused = true
  // Bank before opening, so the screen shows the acres that were actually
  // credited rather than a second, separately-computed number.
  const earned = bankRun(
    profile,
    { wavesCleared: world.wavesCleared, bossKills: world.bossKills, tier: currentTier, cleared },
    world.seed,
    currentClassId,
  )
  writeSave(profile)

  results.open(
    world,
    cleared,
    earned,
    () => startRun(currentClassId, ''),
    () => {
      state = 'menu'
      menu.setUnlocked(unlockedClasses(profile), classPrices(), profile.acres)
      menu.open()
    },
    () => openHomestead(),
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

/**
 * Shout if a UI layer that has controls cannot receive a click.
 *
 * `#ui` is `pointer-events: none` and every layer opts back in. Three screens
 * have now shipped unreachable behind that: the shop and level-up cards (a
 * blanket `#ui > *` rule beat `.hud`), the pause screen (found by hit-testing
 * only because someone thought to), and the results screen, whose root is
 * `.results-wrap` and so never matched `#ui > .screen` at all. A finished run
 * could not be left.
 *
 * Types and tests pass through all of it, because a dead button is a computed
 * style rather than an error. This is the cheap check that is not.
 *
 * Dev only, and it never throws: a false positive must not cost the game.
 */
function assertUiLayersClickable(): void {
  if (!import.meta.env.DEV) return
  for (const layer of Array.from(uiRoot.children)) {
    const controls = layer.querySelectorAll('button, input, select, [role="button"]').length
    if (controls === 0) continue
    if (getComputedStyle(layer).pointerEvents !== 'none') continue
    console.error(
      `[rdf] UI layer .${String((layer as HTMLElement).className).split(' ').join('.')} has ` +
      `${controls} control(s) but computes pointer-events:none — every click on it will fall ` +
      `through to the canvas. Give the layer \`pointer-events: auto\`.`,
    )
  }
}

/*
   Run it when a layer actually appears, not just at boot.

   Screens are built empty and filled on open, so at boot the results layer has
   no buttons to count — checking once would have missed the exact bug this
   exists for. A MutationObserver on `#ui` fires when a screen is shown or
   populated, which is precisely the moment the question is worth asking.

   ## Why it is filtered and throttled, and not just observed

   The first version watched `subtree: true, attributes: true` and re-checked on
   a microtask. The HUD LIVES IN `#ui` AND WRITES STYLES EVERY FRAME — hp bar
   width, xp fill, cooldown sweeps — so every frame fired the observer, and the
   check calls `getComputedStyle`, which forces a synchronous style recalc. The
   game was paying a full style flush per frame for a dev assertion.

   Measured, in a CPU profile of a real run: `assertUiLayersClickable` 4.05s of
   self time plus 2.54s inside `querySelectorAll`, against roughly 28s of
   non-idle JS — about a QUARTER of everything the game did, and second only to
   `drawImage`. It surfaced as 100-400ms frame spikes in bursts, which the owner
   reported as a stutter every 6-10 seconds.

   Two changes, neither of which weakens the guard:

   - Only mutations that can change the answer count. The check reads
     `uiRoot.children` — a layer's computed `pointer-events` and how many
     controls sit under it. So a `childList` change anywhere matters (controls
     appear), but an ATTRIBUTE change only matters on a layer itself. The HUD
     restyling its own innards cannot make a layer unclickable.
   - A timer, not a microtask. A burst of DOM churn now costs one check instead
     of one per frame. This reports a dead button 200ms later than it used to,
     into `console.error`, which is not a deadline anybody is keeping.
*/
if (import.meta.env.DEV) {
  let timer = 0
  new MutationObserver((records) => {
    const worth = records.some((r) => (
      r.type === 'childList'
      || (r.target as HTMLElement | null)?.parentElement === uiRoot
    ))
    if (!worth || timer) return
    timer = window.setTimeout(() => { timer = 0; assertUiLayersClickable() }, 200)
  }).observe(uiRoot, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class'] })
}

installRarityTheme(RARITY)
resize()
// The boot menu must reflect the save too, or the very first screen of a
// session hands out every paid class for free.
menu.setUnlocked(unlockedClasses(profile), classPrices(), profile.acres)
menu.open()
loop.start()

// The atlas loads in the background. The menu is up while it does, and a
// failure is logged and survived rather than thrown — a missing atlas costs
// you the art, not the game.
Atlas.load(import.meta.env.BASE_URL)
  .then((a) => {
    atlas = a
    // The card screens draw from the same atlas via CSS. The atlas is paged and
    // each sprite takes its own page's url off `a`; this argument is only the
    // fallback for an atlas that reports no pages at all, so it names a file
    // that exists rather than the single `atlas.png` there no longer is.
    setSpriteAtlas(a, `${import.meta.env.BASE_URL}atlas-0.png`)
    // Screens built at module load asked the atlas for sprites before it
    // existed and got null for every one of them — the home screen's yard came
    // up empty and its class cards came up as text. Anything that draws sprites
    // has to be rebuilt once the art is actually here.
    menu.setUnlocked(unlockedClasses(profile), classPrices(), profile.acres)
    // The Homestead mounts the same yard, and it was built at module load too.
    homestead.refreshScene()
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
    // Getters, not values. A plain object captures whatever the module locals
    // held at construction, and every later `startRun` leaves the console
    // holding a dead world — which reads as "the game is broken" rather than
    // "the handle is stale".
    get world() { return world },
    get renderer() { return renderer },
    get atlas() { return atlas },
    get offers() { return offers },
    get profile() { return profile },
    startRun,
    openHomestead,
    // The screens themselves, so a UI change can be driven without waiting for
    // a rAF-driven game loop that a headless pane may never run.
    screens: { levelUp, shop, results, menu, pause, homestead },
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
