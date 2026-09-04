/**
 * The home screen: the Whitacre place at dusk, and who you take out into it.
 *
 * The design asks for a place rather than a list. The two backdrops live in
 * `scene.ts` — layer-for-layer ports of Design's own runtime scenes in
 * `docs/reference/` — and this file owns only what is printed on top of them.
 *
 * Class cards are a card object of their own. A locked class is a packet
 * somebody nailed shut, with the acre price branded on the top board — not a
 * black silhouette. You should be able to see what is up there from your first
 * run, which is the whole reason the Bunkhouse has a ladder worth climbing.
 */
import { CLASSES, CLASS_IDS, WEAPONS } from '../content'
import { clear, el } from './dom'
import { spriteEl } from './sprite'
import { BLEED, DOOR, SOIL_H, SURFACE_SCENES, buildScene, buildSoil, type SceneKind } from './scene'

/** The three places, in the order the selector lists them. */
const SCENE_PICK: readonly { id: SceneKind; label: string }[] = [
  { id: 'yard', label: 'YARD' },
  { id: 'field', label: 'FIELD' },
  { id: 'lab', label: 'LAB' },
]

/**
 * Every state the home screen's sequence passes through, named for a dev
 * picker rather than for the sequence's own `Phase` union -- a surface scene
 * splits into two entries here (calm/blighted) where the sequence carries that
 * as a second axis, because the point of this list is "jump straight there
 * and hold", not "describe the state machine".
 *
 * `barn` is not a `Phase` at all -- the Homestead is a different `Screen`
 * (`HomesteadScreen`), reached through `onHomestead`, never through this
 * screen's own column. Listed here anyway because the owner's ask was every
 * home-screen STATE, and the barn is one, even though jumping to it means
 * leaving this screen rather than holding a phase on it.
 */
type DevSceneId = 'yard-calm' | 'yard-blight' | 'field-calm' | 'field-blight'
  | 'flash' | 'down' | 'lab' | 'barn'

const DEV_SCENE_PICK: readonly { id: DevSceneId; label: string }[] = [
  { id: 'yard-calm', label: 'YARD CALM' },
  { id: 'yard-blight', label: 'YARD BLIGHT' },
  { id: 'field-calm', label: 'FIELD CALM' },
  { id: 'field-blight', label: 'FIELD BLIGHT' },
  { id: 'flash', label: 'FLASH' },
  { id: 'down', label: 'DESCENT' },
  { id: 'lab', label: 'LAB' },
  { id: 'barn', label: 'HOMESTEAD' },
]

/**
 * THE STORY THE TITLE SCREEN TELLS ITSELF WHILE YOU CHOOSE.
 *
 * The screen used to pick one of three backdrops per page load and sit on it.
 * Three good pictures, no connection between them, and the lab — which is the
 * whole reveal of the place — arriving one load in three with no explanation of
 * why there is a laboratory in a farm game.
 *
 * It runs as a sequence now, and the sequence IS the pitch:
 *
 *     calm  →  lightning  →  the blight  →  down through the ground  →  the lab
 *     →  back up into the other field  →  and again.
 *
 * Every number below is milliseconds and every one of them was chosen for how
 * long a thing needs to be looked at, not for symmetry:
 *
 * - `calm` is long enough to read the title block and the selected class before
 *   anything happens. Shorter and the strike feels like a loading glitch.
 * - `flash` matches the `y-lightning` keyframe in home.css exactly. If you
 *   change one, change the other; the blight lands on the last strike and a
 *   mismatch shows as the farm turning while the sky is still white.
 * - `blight` is the longest hold in the loop. It is the only frame that says
 *   what the game is about, and every animal in it has changed — that needs
 *   finding, not glancing at.
 * - `pan` matches the `.home-column` transition in home.css, same warning.
 * - `lab` is longer than the blight hold because there is more in it: three
 *   patrols, four tanks, the vats, and a lift you can walk into.
 */
const BEAT = {
  calm: 4600,
  flash: 640,
  blight: 7000,
  pan: 3000,
  lab: 8000,
} as const

/** Where the sequence is. `down`/`up` are the two halves of the descent. */
type Phase = 'calm' | 'flash' | 'blight' | 'down' | 'lab' | 'up'

/** localStorage keys. Both are read at construction and nowhere else. */
const KEY_SCENE = 'rdf.homeScene'
/** Debug only: hold the screen at one phase so a tool can photograph it. */
const KEY_PHASE = 'rdf.homePhase'

function stored(key: string): string {
  try { return localStorage.getItem(key) ?? '' } catch { return '' }
}

function store(key: string, value: string): void {
  try { localStorage.setItem(key, value) } catch { /* private mode */ }
}



export class MenuScreen {
  private readonly root: HTMLElement
  private readonly stageEl: HTMLElement
  private readonly uiEl: HTMLElement
  private readonly seedInput: HTMLInputElement
  private selected = CLASS_IDS[0]
  private unlocked = new Set<string>(CLASS_IDS.filter((id) => CLASSES[id]?.unlocked === true))
  private prices = new Map<string, number>()
  private acres = 0

  /** The surface scene this cycle is built on. Never `lab`. */
  private surface: SceneKind
  /** What is actually in front of the camera right now, `lab` included. */
  private showing: SceneKind
  /** True once somebody has picked a scene by hand. Stops the sequence dead. */
  private held = false
  private phase: Phase = 'calm'
  private timer: ReturnType<typeof setTimeout> | null = null

  /** The three live layers: the tall strip, and the whitener over it. */
  private readonly column: HTMLElement
  private readonly surfaceSlot: HTMLElement
  private readonly soilSlot: HTMLElement
  private readonly labSlot: HTMLElement
  private readonly flashEl: HTMLElement

  /** The Homestead button, so the sequence can move it without a re-render. */
  private doorEl: HTMLElement | null = null
  private doorTimer: ReturnType<typeof setTimeout> | null = null
  /** The reduced-motion fade's half-way timer. See `descend`. */
  private cutTimer: ReturnType<typeof setTimeout> | null = null
  private readonly pickBtns = new Map<SceneKind, HTMLButtonElement>()
  /** The dev-only state picker's buttons, and which one was last pressed. */
  private readonly devPickBtns = new Map<DevSceneId, HTMLButtonElement>()
  private devHeld: DevSceneId | null = null

  constructor(
    parent: HTMLElement,
    private readonly onStart: (classId: string, seed: string) => void,
    private readonly onHomestead?: () => void,
  ) {
    /*
       WHERE THE SEQUENCE STARTS.

       The stored key used to be the LAST scene, and the screen mounted the next
       one along, which is why `tools/scene-shot.ts` has to write the scene
       BEFORE the one it wants. It is the scene to open ON now — a manual pick
       persists and the next load begins there. The sequence still runs from it,
       because holding is a decision about this session and not a preference.

       The lab is not a valid start: the sequence descends into it and coming up
       from a place you never went down to has nothing above it.
    */
    const last = stored(KEY_SCENE) as SceneKind
    this.surface = SURFACE_SCENES.includes(last) ? last : SURFACE_SCENES[0]
    this.showing = last === 'lab' ? 'lab' : this.surface

    this.seedInput = el('input', { class: 'home-seed-input' })
    this.seedInput.placeholder = 'random'

    this.surfaceSlot = el('div', { class: 'home-slot is-surface' }, [buildScene(this.surface)])
    this.labSlot = el('div', { class: 'home-slot is-lab' }, [buildScene('lab')])
    this.soilSlot = el('div', { class: 'home-slot is-soil' }, [buildSoil()])
    this.column = el('div', { class: 'home-column' }, [
      this.surfaceSlot,
      this.soilSlot,
      this.labSlot,
    ])
    this.flashEl = el('div', { class: 'home-flash' })
    this.stageEl = el('div', { class: 'home-scene' }, [this.column, this.flashEl])
    // The UI lives INSIDE the stage's coordinate space and scales with it.
    // That is the whole reason this design needs no breakpoints: every number
    // in the mockup is a 1920x1080 stage pixel, interface included. Building
    // the scene to the design and then laying my own responsive UI over it is
    // exactly the mistake that made the first attempt look nothing like it.
    this.uiEl = el('div', { class: 'home-ui' })

    this.root = el('div', { class: 'screen home' }, [
      el('div', { class: 'home-stagewrap' }, [this.stageEl, this.uiEl]),
    ])
    this.root.style.setProperty('--soil', `${SOIL_H}px`)
    this.root.style.display = 'none'
    parent.appendChild(this.root)
    this.markScene()
    this.renderUi()
    this.fitScene()
    window.addEventListener('resize', () => this.fitScene())
    this.begin()
  }

  /** Does the machine say stop moving things? Asked, not assumed. */
  private get calmed(): boolean {
    return typeof matchMedia === 'function'
      && matchMedia('(prefers-reduced-motion: reduce)').matches
  }

  /**
   * Start the loop, or park on one frame because a tool asked for it.
   *
   * `rdf.homePhase` is the whole reason a blighted farm or a mid-descent frame
   * can be photographed at all. Timing a screenshot against a 640ms flash or a
   * 3s pan is a race nobody wins; naming the state and holding it is not.
   */
  private begin(): void {
    const want = stored(KEY_PHASE) as Phase | ''
    if (!want) {
      /*
         A persisted `lab` means the last hand on the selector picked the lab.
         The sequence cannot START there — there is nothing above a place you
         never descended into — so it starts at the lab's HOLD and carries on
         upward, which is also the reading that makes "persist the pick" mean
         something: you left underground, you come back underground.
      */
      if (this.showing === 'lab') {
        this.settle('lab', false)
        this.phase = 'lab'
        this.timer = setTimeout(() => this.step('up'), BEAT.lab)
        return
      }
      this.step('calm')
      return
    }
    this.held = true
    if (want === 'blight') { this.dress(true); this.phase = 'blight'; return }
    if (want === 'flash') { this.flashEl.classList.add('is-held'); this.phase = 'flash'; return }
    if (want === 'lab') { this.settle('lab', false); this.phase = 'lab'; return }
    if (want === 'down') {
      // Parked halfway down, with the soil filling the frame. The transition is
      // suppressed so this is a POSITION rather than an animation caught early.
      this.dress(true)
      this.column.style.transition = 'none'
      this.column.style.transform = `translateY(${-(1080 + SOIL_H) / 2}px)`
      // Still pointing at the farm, which is where it really is halfway down.
      this.setDoor(this.surface)
      this.phase = 'down'
      return
    }
    this.phase = 'calm'
  }

  /* ------------------------------------------------------------- sequence */

  /**
   * One beat, then the next. A chain of timeouts, not a frame loop.
   *
   * Every step ends by scheduling the one after it, and every scheduled step
   * checks `held` on the way in — so a manual pick or a close stops the machine
   * at the next boundary without having to hunt down a pending timer, and a
   * timer that does fire after a pick does nothing.
   */
  private step(next: Phase): void {
    if (this.held) return
    this.phase = next
    const after = (ms: number, then: Phase): void => {
      this.clearTimer()
      this.timer = setTimeout(() => this.step(then), ms)
    }
    switch (next) {
      case 'calm':
        this.settle(this.surface, false)
        // Reduced motion skips the strike entirely — see the note in home.css.
        after(BEAT.calm, this.calmed ? 'blight' : 'flash')
        return
      case 'flash':
        this.strike()
        // The farm turns on the LAST strike, not after it: the blight is dressed
        // 60ms before the keyframe's final fall, so the white lifts off a
        // changed yard. Dress it after and you watch the swap happen.
        this.clearTimer()
        this.timer = setTimeout(() => this.dress(true), BEAT.flash - 200)
        after(BEAT.flash, 'blight')
        return
      case 'blight':
        this.dress(true)
        after(BEAT.blight, 'down')
        return
      case 'down':
        this.descend(true)
        after(this.calmed ? 520 : BEAT.pan, 'lab')
        return
      case 'lab':
        this.showing = 'lab'
        this.markScene()
        this.fitScene()
        this.paintPick()
        after(BEAT.lab, 'up')
        return
      case 'up': {
        /*
           Up into the OTHER field, calm.

           The surface scene is rebuilt while the camera is underground, so the
           farm you rise into is a different one and it is well again. That is
           the loop's whole shape: the yard is lost, and then you come back up
           into the field as if it never happened.
        */
        const other = SURFACE_SCENES[(SURFACE_SCENES.indexOf(this.surface) + 1) % SURFACE_SCENES.length]
        this.surface = other
        store(KEY_SCENE, other)
        this.surfaceSlot.replaceChildren(buildScene(other))
        this.descend(false)
        after(this.calmed ? 520 : BEAT.pan, 'calm')
        return
      }
    }
  }

  /**
   * Cancel the pending BEAT only.
   *
   * Deliberately not the door's timer: `after()` calls this on every step, and
   * the door's move is scheduled by the step that is still in flight. Clearing
   * both here left the Homestead button in the dirt for the whole descent —
   * the exact thing the delay exists to prevent.
   */
  private clearTimer(): void {
    if (this.timer !== null) { clearTimeout(this.timer); this.timer = null }
  }

  /** Stop the sequence where it stands. Called on a pick and on close. */
  private stopSequence(): void {
    this.held = true
    this.clearTimer()
  }

  /** Three white strikes over the SCENE. Restarted by re-adding the class. */
  private strike(): void {
    this.flashEl.classList.remove('is-striking')
    // Read a layout property so the removal commits before the re-add; without
    // it the class never leaves the element and the animation never restarts.
    void this.flashEl.offsetWidth
    this.flashEl.classList.add('is-striking')
  }

  /** Rebuild the surface scene, well or blighted, without touching the lab. */
  private dress(blight: boolean): void {
    this.surfaceSlot.replaceChildren(buildScene(this.surface, blight))
  }

  /**
   * Put the camera somewhere with no travel at all.
   *
   * The transition is killed, the class flipped, a layout property read to
   * commit it, and the transition restored. Without the read the browser
   * coalesces all three into one style recalculation, sees only "transition is
   * back on, class changed", and animates — which is how "settle on the calm
   * yard" became a three-second climb out of the ground on every page load.
   */
  private jump(down: boolean): void {
    this.column.style.transition = 'none'
    this.column.style.transform = ''
    this.column.classList.toggle('is-down', down)
    void this.column.offsetWidth
    this.column.style.transition = ''
  }

  /** Put the camera on a scene with no travel. */
  private settle(kind: SceneKind, blight: boolean): void {
    this.cut()
    if (kind === 'lab') {
      this.jump(true)
      this.showing = 'lab'
    } else {
      this.dress(blight)
      this.jump(false)
      this.showing = kind
    }
    this.markScene()
    this.setDoor(this.showing)
    this.fitScene()
    this.paintPick()
  }

  /**
   * Travel the column: down into the lab, or back up to the surface.
   *
   * REDUCED MOTION GETS THE JOURNEY AS A FADE, NOT AS A JUMP. `.home-column`'s
   * transition is switched off under the query, so flipping the class on its
   * own would TELEPORT the camera — a bigger visual event than the pan it
   * replaces, and the opposite of what the request means. The scene dips to
   * nothing, the column moves while there is nothing to see, and it comes back.
   * The 220ms is the `.home-scene` transition in home.css; `step()` allows 520
   * for the pair, which is why that beat is not the same number as the pan.
   */
  private descend(down: boolean): void {
    if (this.calmed) {
      this.cut()
      this.stageEl.classList.add('is-cutting')
      this.cutTimer = setTimeout(() => {
        this.cutTimer = null
        this.move(down)
        this.stageEl.classList.remove('is-cutting')
      }, 240)
      return
    }
    this.move(down)
  }

  /**
   * Drop any fade in flight, and make sure the scene is visible again.
   *
   * Both halves matter: cancelling the timer without clearing the class leaves
   * the screen dipped to nothing for good, which is what a manual pick landing
   * mid-fade would otherwise do.
   */
  private cut(): void {
    if (this.cutTimer !== null) { clearTimeout(this.cutTimer); this.cutTimer = null }
    this.stageEl.classList.remove('is-cutting')
  }

  /** The camera move itself, with whatever transition is in force. */
  private move(down: boolean): void {
    this.column.style.transition = ''
    this.column.style.transform = ''
    this.column.classList.toggle('is-down', down)
    this.showing = down ? 'lab' : this.surface
    this.markScene()
    this.setDoor(this.showing, this.calmed ? 0 : Math.max(0, BEAT.pan - 900))
    this.fitScene()
    this.paintPick()
  }

  /**
   * A hand on the selector. Jump there, with the transition that fits, and stay.
   *
   * Surface to lab is the descent and lab to surface is the climb, because
   * those are the only two moves the column can make and cutting between them
   * would throw away the one idea the sequence has. Surface to surface is a
   * swap: there is no journey between the yard and the field, they are the same
   * farm from two places in it.
   */
  private pick(kind: SceneKind): void {
    this.stopSequence()
    this.flashEl.classList.remove('is-striking', 'is-held')
    store(KEY_SCENE, kind)
    if (kind === 'lab') {
      if (this.showing !== 'lab') this.descend(true)
      return
    }
    if (this.surface !== kind) {
      this.surface = kind
      this.surfaceSlot.replaceChildren(buildScene(kind))
    } else {
      this.dress(false)
    }
    if (this.showing === 'lab') this.descend(false)
    else this.settle(kind, false)
  }

  /**
   * The dev picker: jump straight to any state the sequence carries and hold
   * there, no different from a manual scene pick except that it also reaches
   * the two graded (blighted) surfaces and the mid-descent frame directly,
   * neither of which the shipping selector exposes.
   *
   * Only reachable through `.home-dev-pick`, which CSS shows only under
   * `body[data-dev='on']` -- see the note on that element in `renderUi`. This
   * method itself has no visibility gate of its own; it does not need one,
   * because nothing calls it unless the button was clickable.
   */
  private devJump(id: DevSceneId): void {
    this.devHeld = id
    if (id === 'barn') { this.onHomestead?.(); this.paintDevPick(); return }
    this.stopSequence()
    this.flashEl.classList.remove('is-striking', 'is-held')
    switch (id) {
      /*
         `settle()`'s own `dress()` rebuilds off `this.surface`, not off the
         kind it was passed -- see `pick()`, which sets `this.surface` first
         for exactly this reason. Skipping that step here would show "FIELD"
         picked while quietly redressing whichever surface was already up.
      */
      case 'yard-calm': this.surface = 'yard'; this.settle('yard', false); break
      case 'yard-blight': this.surface = 'yard'; this.settle('yard', true); break
      case 'field-calm': this.surface = 'field'; this.settle('field', false); break
      case 'field-blight': this.surface = 'field'; this.settle('field', true); break
      case 'lab': this.settle('lab', false); break
      case 'flash':
        this.settle(this.surface, false)
        this.strike()
        this.flashEl.classList.add('is-held')
        this.phase = 'flash'
        break
      case 'down':
        /*
           The same frozen halfway position `begin()` parks on for
           `rdf.homePhase === 'down'` -- see that method for why the transition
           is killed rather than let run and caught mid-flight.
        */
        this.jump(false)
        this.dress(true)
        this.column.style.transition = 'none'
        this.column.style.transform = `translateY(${-(1080 + SOIL_H) / 2}px)`
        this.showing = this.surface
        this.markScene()
        this.setDoor(this.surface)
        this.fitScene()
        this.phase = 'down'
        break
    }
    this.paintDevPick()
  }

  /** Brand the dev state last jumped to, same idea as `paintPick`. */
  private paintDevPick(): void {
    for (const [id, btn] of this.devPickBtns) btn.classList.toggle('is-on', id === this.devHeld)
  }

  /** The `is-*` class the bleed and the tests read off the root. */
  private markScene(): void {
    this.root.classList.toggle('is-field', this.showing === 'field')
    this.root.classList.toggle('is-lab', this.showing === 'lab')
  }

  /**
   * Point the Homestead button at whichever way in is on screen.
   *
   * Held as a field rather than looked up because the sequence moves it while
   * the interface is otherwise untouched — the print, the cards and the seed
   * box must not be rebuilt three times a minute just so one button can follow
   * the camera. `DOOR` derives all three positions from where the barn and the
   * lift actually are, so this never carries a coordinate of its own.
   */
  private setDoor(kind: SceneKind, delayMs = 0): void {
    if (this.doorTimer !== null) { clearTimeout(this.doorTimer); this.doorTimer = null }
    const move = (): void => {
      if (!this.doorEl) return
      const { x, y } = DOOR[kind]
      this.doorEl.style.left = `${x}px`
      this.doorEl.style.top = `${y}px`
    }
    /*
       During a descent the move is DELAYED rather than immediate.

       The button is in stage space and the scenes are in column space, so a
       button that moves when the camera starts spends two seconds of the three
       hanging in the middle of the dirt with "0 acres banked" under it. Held
       until the lab is nearly in frame, its 900ms glide lands as the room does
       and it reads as the same button following the camera — which is what it
       is. It stays clickable the whole way; only where it points changes.
    */
    if (delayMs > 0) this.doorTimer = setTimeout(move, delayMs)
    else move()
  }

  /** Brand the place you are standing in. */
  private paintPick(): void {
    for (const [id, btn] of this.pickBtns) btn.classList.toggle('is-on', id === this.showing)
  }

  /** Everything printed, in stage coordinates. */
  private renderUi(): void {
    clear(this.uiEl)
    this.pickBtns.clear()
    this.devPickBtns.clear()
    const def = CLASSES[this.selected]
    const { x: doorX, y: doorY } = DOOR[this.showing]

    const title = el('div', { class: 'home-title-block' }, [
      el('div', { class: 'home-eyebrow', text: 'THE WHITACRE PLACE · 1987' }),
      el('h1', { class: 'home-title' }, [
        el('span', { text: 'Ranch' }), el('br'),
        el('span', { text: 'Defense' }), el('br'),
        el('span', { text: 'Force' }),
      ]),
      el('div', { class: 'home-tagline' }, [
        el('span', { class: 'home-tagrule' }),
        el('span', { text: 'Work the field until the light goes.' }),
      ]),
    ])

    const playing = el('div', { class: 'home-playing' }, [
      el('div', { class: 'home-playing-label', text: 'YOU ARE PLAYING' }),
      el('div', { class: 'home-playing-name', text: def?.name ?? '' }),
      el('div', { class: 'home-playing-blurb', text: def?.blurb ?? '' }),
      el('div', { class: 'home-playing-rule' }),
      el('div', { class: 'home-playing-rows' }, [
        row('PASSIVE', def?.cardPassive ?? def?.passive.desc ?? ''),
        row('ABILITY', def?.ability.name ?? ''),
        row('STARTS', WEAPONS[def?.startingWeapon ?? '']?.name ?? def?.startingWeapon ?? ''),
      ]),
    ])

    const seedBox = el('div', { class: 'home-seedbox' }, [
      el('div', { class: 'home-seed-field' }, [
        el('div', { class: 'home-seed-label', text: 'SEED' }),
        this.seedInput,
      ]),
      el('button', {
        class: 'home-seed-new',
        text: 'NEW',
        onClick: () => { this.seedInput.value = '' },
      }),
    ])

    const door = el('div', { class: 'home-door' }, [
      el('button', {
        class: 'home-door-btn',
        text: 'THE HOMESTEAD',
        onClick: () => this.onHomestead?.(),
      }),
      el('div', { class: 'home-door-note', text: `${this.acres} acres banked` }),
    ])
    door.style.left = `${doorX}px`
    door.style.top = `${doorY}px`
    this.doorEl = door

    const rail = el('div', { class: 'home-rail' })
    CLASS_IDS.forEach((id, i) => {
      const c = this.heroCard(id, i)
      if (c) rail.append(c)
    })

    const foot = el('div', { class: 'home-footbar' }, [
      el('span', { text: '24 WAVES · TWO BOSSES · WEAPONS FIRE THEMSELVES' }),
      el('span', { text: 'ART BY LIMEZU · MUSIC BY ABSTRACTION' }),
    ])

    /*
       The scene selector, top right, and it SHIPS.

       Its predecessor was a dev-only `SCENE: YARD` button that cycled, gated on
       `import.meta.env.DEV` because Design called it a reviewer control. That
       was right when the scenes were three interchangeable backdrops. They are
       a place, the same place gone wrong, and the room under it now, and a
       player who wants to look at one of those should be able to.
    */
    const pick = el('div', { class: 'home-scene-pick' }, [
      el('div', { class: 'home-scene-pick-label', text: 'SCENE' }),
    ])
    for (const { id, label } of SCENE_PICK) {
      const btn = el('button', { text: label, onClick: () => this.pick(id) }) as HTMLButtonElement
      this.pickBtns.set(id, btn)
      pick.append(btn)
    }

    /*
       The dev state picker. Every state the sequence carries, one click to
       hold on it -- built for inspecting the blighted surfaces and the
       mid-descent frame, neither of which the shipping selector above can
       reach, without waiting out the loop or hand-editing localStorage.
       `npm run scene` accepts the same eight ids -- see tools/scene-shot.ts.

       SHOWN ONLY WHEN THE DEV OVERLAY IS VISIBLE, and that gate is CSS, not
       JS: `.home-dev-pick` is `display:none` in home-ui.css and
       `body[data-dev='on'] .home-dev-pick { display:flex }` is the only rule
       that turns it on. `dev.ts` writes `data-dev` on F1/backtick and starts
       hidden in production (`DevOverlay.visible = import.meta.env.DEV`), so
       this panel is built every load, costs nothing while hidden, and is one
       keypress away rather than a rebuild away -- which is the "turn it off
       later" the owner asked for: production ships with it present but dark,
       and F1 is the switch.
    */
    const devPick = el('div', { class: 'home-dev-pick' }, [
      el('div', { class: 'home-scene-pick-label', text: 'DEV: STATE' }),
    ])
    for (const { id, label } of DEV_SCENE_PICK) {
      const btn = el('button', { text: label, onClick: () => this.devJump(id) }) as HTMLButtonElement
      this.devPickBtns.set(id, btn)
      devPick.append(btn)
    }

    this.uiEl.append(title, playing, seedBox, door, rail, foot, pick, devPick)
    this.paintPick()
    this.paintDevPick()
  }

  /**
   * One class card, per `Class Card.dc.html`.
   *
   * Deliberately NOT the `pcard` the level-up and shop use. The design draws
   * this one as a different object — a keyword band, a figure window with a
   * horizon line, three read-off stat bars, a footer of ability and weapon —
   * and a card that is genuinely different should be a different component
   * rather than eight flags bolted onto the first one.
   */
  private heroCard(id: string, index: number): HTMLElement | null {
    const def = CLASSES[id]
    if (!def) return null
    const locked = !this.unlocked.has(id)
    const price = this.prices.get(id)
    const bars = def.bars ?? { body: 50, speed: 50, reach: 50 }
    const selected = id === this.selected

    const figure = el('div', { class: 'hero-window' })
    /*
       A PORTRAIT IF THERE IS ONE, the walking sprite if not.

       The class plates used to show `<id>.idle.down.0` at 3x — the same 32px
       figure that walks around the field, enlarged. It reads as a game sprite
       standing in a box rather than as a picture OF someone, which is what a
       class card wants.

       The portraits are derived from each class's own finished sprite via
       `character_to_portrait`, so a plate cannot drift from the character it
       names. Falling back keeps the screen working when the atlas has no
       portrait — a missing one costs the plate, not the menu.
    */
    /*
       ZOOM 1, down from 2, because the window is 68px now and not 120.

       The plates are 58-62 by 63-64 in the atlas. At zoom 2 that is a 128px
       bust bottom-anchored in a window two thirds its height, which crops the
       face rather than the shoulders. At zoom 1 the whole plate fits with four
       pixels of headroom and it is still on the whole-pixel grid — which is the
       only reason a smaller card did not cost the portraits anything.
    */
    const portrait = spriteEl(`portrait.${id}`, 4096, 1)
    const sprite = portrait ?? spriteEl(`${id}.idle.down.0`, 4096, 2)
    if (sprite) {
      sprite.classList.add('hero-figure')
      // A portrait is bottom-anchored; a full-body sprite is pulled up so its
      // legs crop out of the window. Different art, different rule — see the
      // note on `.hero-figure` in home-ui.css.
      if (portrait) sprite.classList.add('is-portrait')
      figure.append(sprite)
    }
    figure.append(el('div', { class: 'hero-horizon' }), el('div', { class: 'hero-shade' }))

    if (locked) {
      // A packet somebody nailed shut: two boards across the window, the figure
      // still visible in the gap, the acre price branded on the top board. Not
      // a black silhouette — you should be able to see there is somebody there.
      figure.append(
        el('div', { class: 'hero-board hero-board-top' }, [
          el('span', { class: 'hero-price', text: price ? `${price} ACRES` : 'LOCKED' }),
        ]),
        el('div', { class: 'hero-board hero-board-bottom' }),
      )
    }

    const card = el('div', {
      class: `hero${locked ? ' is-locked' : ''}${selected ? ' is-selected' : ''}`,
    }, [
      el('div', { class: 'hero-tab' }, [el('div', { class: 'hero-punch' })]),
      el('div', { class: 'hero-body' }, [
        el('div', { class: 'hero-tag', text: def.tag ?? '' }),
        figure,
        el('div', { class: 'hero-name', text: def.name }),
        el('div', { class: 'hero-rule' }),
        el('div', { class: 'hero-bars' }, [
          bar('BODY', bars.body), bar('SPEED', bars.speed), bar('REACH', bars.reach),
        ]),
        el('div', { class: 'hero-foot' }, [
          el('span', { text: (def.ability.name ?? '').toUpperCase() }),
          el('span', {
            text: (WEAPONS[def.startingWeapon]?.name ?? def.startingWeapon).toUpperCase(),
          }),
        ]),
      ]),
      selected && !locked ? el('div', { class: 'hero-taking', text: 'TAKING THE FIELD' }) : null,
    ])
    card.style.animationDelay = `${index * 90}ms`
    card.onclick = () => {
      // A locked card sends you where you can unlock it, rather than doing
      // nothing — a dead click on the most interesting card is a bad answer.
      if (locked) { this.onHomestead?.(); return }
      if (selected) { this.onStart(id, this.seedInput.value.trim()); return }
      this.selected = id
      this.renderUi()
    }
    return card
  }

  /**
   * Called by main from the save, before opening — and again once the atlas
   * resolves, because this screen is built at module load and every sprite it
   * asked for before then came back null.
   *
   * ALL THREE SLOTS ARE REBUILT, not just the one showing. Everything in the
   * column is live the whole time, so a slot left as the coloured squares of a
   * pre-atlas build shows the first time the camera reaches it — which is
   * exactly what happened to the soil: it was built once in the constructor,
   * every one of its roots, stones and its conduit came back null, and the
   * descent was three seconds of a brown gradient with nothing in it.
   */
  setUnlocked(ids: readonly string[], prices?: ReadonlyMap<string, number>, acres = 0): void {
    this.unlocked = new Set(ids)
    if (prices) this.prices = new Map(prices)
    this.acres = acres
    if (!this.unlocked.has(this.selected)) {
      this.selected = CLASS_IDS.find((id) => this.unlocked.has(id)) ?? CLASS_IDS[0]
    }
    this.surfaceSlot.replaceChildren(buildScene(this.surface, this.phase === 'blight'))
    this.soilSlot.replaceChildren(buildSoil())
    this.labSlot.replaceChildren(buildScene('lab'))
    this.renderUi()
    this.setDoor(this.showing)
  }

  open(): void {
    this.root.style.display = ''
    this.fitScene()
    /*
       Back to the calm farm, and running again — unless a hand stopped it,
       OR unless the machine is already running.

       `main.ts` calls this immediately after construction, on the same
       synchronous boot as `begin()` -- so on a normal start `begin()` has
       already called `step('calm')` and restarting it here is merely
       redundant. On a persisted `lab` start it is worse than redundant:
       `begin()` settled on the lab and scheduled its own `step('up')` timer
       to carry the loop back up out of it, and calling `step('calm')` here
       would abandon that scene (back to the surface, on a stray SECOND
       timer nothing ever clears) before the lab was on screen for even one
       frame. `this.timer !== null` is true whenever a beat is already
       scheduled -- from `begin()` on this exact boot, or from a still-live
       sequence on a screen that was never `close()`d -- and is the signal
       that there is nothing here to restart.
    */
    if (!this.held && this.timer === null) this.step('calm')
  }

  /**
   * Hidden, and the machine stops with it.
   *
   * A sequence that keeps rebuilding two scenes and swapping classes behind a
   * `display: none` screen is a hundred DOM nodes a second thrown away while
   * somebody is playing the actual game.
   */
  close(): void {
    this.root.style.display = 'none'
    this.clearTimer()
    this.cut()
    if (this.doorTimer !== null) { clearTimeout(this.doorTimer); this.doorTimer = null }
  }

  /**
   * Fit the 1920x1080 stage INSIDE the window.
   *
   * `contain`, not `cover`, and that is the design's call rather than a
   * preference: the composition is horizontal — barn right, print left — so
   * cropping the sides destroys exactly the relationship the scene is built on.
   * The leftover space is bled with the scene's own edge colours, which reads
   * as a wider window rather than as bars.
   */
  private fitScene(): void {
    // `clientWidth`, not `innerWidth`: the latter includes the scrollbar gutter
    // and rounds, which on a fractional device pixel ratio makes it the wrong
    // number by a fraction of a pixel. See the note on `#stage` in style.css.
    const doc = document.documentElement
    const s = Math.min(doc.clientWidth / 1920, doc.clientHeight / 1080)
    this.root.style.setProperty('--scene', String(s))
    const bleed = BLEED[this.showing]
    this.root.style.setProperty('--bleed-top', bleed.top)
    this.root.style.setProperty('--bleed-bottom', bleed.bottom)
  }
}

/** A label/value line in the "you are playing" panel. */
function row(label: string, value: string): HTMLElement {
  return el('div', { class: 'home-playing-row' }, [
    el('span', { class: 'home-playing-key', text: label }),
    el('span', { class: 'home-playing-val', text: value }),
  ])
}

/** One BODY/SPEED/REACH meter. */
function bar(label: string, pct: number): HTMLElement {
  const fill = el('div', { class: 'hero-bar-fill' })
  fill.style.width = `${Math.max(0, Math.min(100, pct))}%`
  return el('div', { class: 'hero-bar' }, [
    el('span', { class: 'hero-bar-label', text: label }),
    el('div', { class: 'hero-bar-track' }, [fill]),
  ])
}
