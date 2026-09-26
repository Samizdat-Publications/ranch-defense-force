# Brief to Claude Design — the home screen scene

**Read `docs/DESIGN_STATE.md` first.** This is a focused brief about one screen.

Everything else from your package is in and working: the card, the rarity plate,
the roster, the pause sheet, the results sheet, the HUD. This is the one that
does not read right, and I want your call rather than more guessing from me.

## What I built, and where I already know I went wrong

`Yard Scene.dc.html` and `Field Scene.dc.html` are implemented as a **1920×1080
stage scaled to cover the window**, with the printed matter (title, class rail,
seed field, buttons) floating over it behind a dark vertical scrim.

My first attempt placed the buildings by *percentage of the window*, which was
wrong: on a 1129px-wide window a 480px barn became 43% of the screen instead of
25%, and the silo grew to 896px tall. That is fixed. **Do not design around
those screenshots if you saw them.**

What is still wrong, and I think is a composition question rather than a bug:

1. **The foreground is empty.** Both scenes have a large flat expanse of ground
   or crop across the bottom third with nothing in it. The mockups fill that
   band; my placements do not, because I chose them from a grep of your CSS
   rather than by reading the composition.
2. **The field's crop bands are enormous.** I have three bands at 2×, 3× and 4×
   a 32px tile. At 4× on a 1080-tall stage the nearest band is a wall of wheat
   taking the bottom 40% of the screen. Either my sizes are wrong or the bands
   are meant to sit much lower and be mostly cropped.
3. **Buildings hug the edges and get cut.** The barn, house and silo all clip
   against the frame in a way that looks accidental rather than composed —
   except the silo, which you explicitly wanted cropped.

## What I need from you

### 1. Actual placements, as numbers

The most useful thing you can send is a table, in 1920×1080 stage coordinates:

```
sprite        x     y     zoom   layer
barn          196   148   1      back
house         430   320   1      back
silo          1664  192   2      front
...
```

I will use those literally. I currently have nine placements in the yard and
four in the field that I picked by eye from the mockup's inline styles, and
every one of them is a guess.

Same for the field's crop bands: **tile, on-screen tile size in pixels, y
position, scroll seconds per loop.** I have wheat at 64/96/128px and I am fairly
sure that is too big.

### 2. What happens on a window that is not 16:9

The stage is 1920×1080 and the window is whatever the player has. Right now I
scale to **cover**, so a taller window crops the left and right and a wider one
crops top and bottom. On a 1129×1153 window that eats most of the sky and both
end buildings.

Pick one:

- **(a) Cover and crop**, as now — and tell me a *safe rectangle* inside the
  1920×1080 frame that must always stay visible, so I can bias the scale to
  protect it.
- **(b) Letterbox** — never crop, accept bars.
- **(c) Reflow** — you give me a second set of placements for a portrait-ish
  window and I switch at a breakpoint.

If (a), the safe rectangle is the thing I most need. Everything else follows
from it.

### 3. Where the printed matter is allowed to sit

The title, six class cards, seed field and two buttons currently float over the
scene with a dark scrim behind them so the text stays legible. **The mockups
show the scene and the class rail but never together**, so I do not know if the
scrim is right.

Is there meant to be a **clear band** in the composition — sky above, ground
below — that the printed matter sits inside without needing to be darkened? If
so, give me its y-range on the 1920×1080 frame and I will place the rail there
and drop the scrim.

### 4. Six class cards do not fit

Below about 1300px they do not fit on one row. I made the rail scroll
horizontally with a compact card (96px art window, blurb clamped to three
lines), which leaves a visible scrollbar and clips the first and last card.

Shrink to fit, wrap to two rows, or keep the scroll with a nicer affordance —
your call, it is a composition decision and I should not be making it.

### 5. One thing I want to check I understood

You describe these as the home screen's two interchangeable backdrops. The owner
has been calling them **loading screens**. If they are meant to be *both* — a
backdrop behind the class picker AND a screen shown while the atlas loads — say
so, because a loading screen has no printed matter over it and would be composed
differently. Right now I only use them as the class-picker backdrop.

## Constraints that have not changed

- **32×32 art, integer zoom only.** Where the field mockup draws distant
  buildings at half scale I placed them at 1× further up the frame instead,
  because a 0.5× pixel sprite is a blurry pixel sprite. If you would rather have
  smaller buildings, they need smaller crops, not a fractional zoom.
- **Anything tiled or stepped must be packed untrimmed.** Already handled, but it
  is why the crop bands and walk strips work at all — a trimmed 32px tile packs
  to 26px and every repeat gaps.
- No new runtime dependencies. CSS animation only, nothing per-frame in JS.

## What is already working, so you know what not to redo

- Both scenes render, with the buildings, the walkers on stepped strips, the
  drifting cloud layers, the sun, the crop parallax and the porch-light flicker.
- The scene picks yard or field per page load.
- The class cards, the nailed-shut locked variant with the acre price branded on
  the board, the deal animation and the rarity plate are all in and correct.

It is the composition I need, not the mechanism.

---

# Still wanted from Design (added session 16)

Two open items. Neither is started; both are composition work, which is why
they are here rather than in NOTES.

## 1. The yard scene still runs on LimeZu buildings

The generated barn, farmhouse, silo and oak are **on disk and committed** at
`assets/pixellab/yard_picked/` and are referenced by **nothing** — `grep -c
yard_picked art/sprites.json` returns 0. `scene.barn`, `scene.house` and
`scene.silo` still point at `assets/scene/*.png`, which is the purchased pack.

This is §1 of `docs/NEXT_SESSION.md` and it is not a generation job — the art
exists. It is a placement job, and it needs placement work because **the
generated buildings are a different size to the ones the coordinates were
written for**: barn is 400x224 where the pack's was 480, silo 224x400 where the
pack's was 448. The API capped at 400px. Design's scene coordinates are the
top-left of each sprite's FULL box, so every one of them wants a nudge rather
than a rescale, and `scene` is packed `noTrim` precisely so that stays true.
Integer zoom only.

Also unchanged: `SceneKind` is still `'yard' | 'field'`. Two scenes, as
delivered.

## 2. The lightning cut — daytime farm to infected night

The owner's ask, for later. On the title screen: the yard opens as a **clean,
healthy, daytime farm** — nothing wrong with it, no blight, no cursed cast.
Then a **lightning flash**, and on the other side of it the same yard is the
**infected night version** the game actually takes place in.

Worth saying what makes this cheap or expensive before it gets specced:

- The scene is already a stack of placed `<img>` layers on a 1920x1080 stage
  scaled as one unit, with drifting clouds, a sun and a porch-light flicker.
  A day and a night palette over the same placements is a CSS problem, not a
  new scene.
- What it would need in art is a **clean variant of the props that are visibly
  cursed** — the walkers, the rot, the blighted crops. If the day version is
  the same sprites with a warm filter, the flash lands on nothing.
- The flash itself must be CSS animation only. The existing constraint holds:
  no new runtime dependencies, nothing per-frame in JS.
- One accessibility note to design around rather than discover: a full-screen
  white flash is the classic photosensitivity trigger. It wants a ceiling on
  luminance and a `prefers-reduced-motion` path that cross-fades instead.

Sequencing: this depends on item 1. Rebuilding the yard on the generated cast
and then re-lighting it twice is one job done once; doing it in the other order
is the placement pass done twice.

---

# Added session 18 — the owner's own farm, clean and blighted

Twenty animals were generated from the owner's description of their real farm,
and nineteen of them have a corrupted twin. They are packed and addressable
now; nothing places them yet, which is the job.

Every one is an eight-direction sheet packed as `<id>.idle.<dir>.0`, where
`<dir>` is `down`, `downLeft`, `left`, `upLeft`, `up`, `upRight`, `right`,
`downRight`. `spriteEl()` takes those keys directly, so a scene layer is
`spriteEl('rosie.idle.downRight', 96)` and nothing new is needed to use them.

| clean | blighted twin | who it is |
|---|---|---|
| `fjordPony` | `fjordPonyBlight` | white thick Fjord pony, blonde mane |
| `arabian` | `arabianBlight` | Arabian, brown with a golden mane |
| `blackMule` | `blackMuleBlight` | the black charge mule |
| `beigeMule` | `beigeMuleBlight` | the beige charge mule |
| `rosie` | `rosieBlight` | Rosie, small brown-and-white mule/donkey |
| `wiz` | `wizBlight` | Wiz, black cat, **green** eyes |
| `ouiji` | `ouijiBlight` | Ouiji, black cat, **yellow-green** eyes |
| `tabbyCat` | `tabbyCatBlight` | the brown tabby |
| `siameseCat` | `siameseCatBlight` | the white siamese |
| `joy` | `joyBlight` | Joy, tan-and-white bulldog |
| `brahmaHen` | `brahmaHenBlight` | light Brahma, feathered feet |
| `beardedHen` | `beardedHenBlight` | bearded Ameraucana, slate blue |
| `buffHen` | `buffHenBlight` | buff Orpington, the big one |
| `bantamHen` | `bantamHenBlight` | bantam, the small one |
| `silkieHen` | `silkieHenBlight` | Silkie, all puffy fur |
| `polishHen` | `polishHenBlight` | Polish crested, the enormous head puff |
| `leghornHen` | `leghornHenBlight` | white Leghorn, big floppy comb |
| `barredHen` | `barredHenBlight` | barred Plymouth Rock |
| `farmRooster` | `farmRoosterBlight` | the rooster, green-black sickle tail |
| `chick` | *(none — see below)* | the yellow chick |

**Wiz and Ouiji are told apart by eye colour and nothing else.** They are both
black cats. If a scene shows only one, it does not matter which; if it shows
both, they should be far enough apart that the reader is not asked to compare
two near-identical sprites side by side.

**Joy is the companion, not just a resident.** The owner's call on seeing her:
she is the dog you get as a level-up pick, and the blighted ones are what you
fight. The mechanic already exists -- `weapon.barnDog` is a summon with walk and
attack clips -- so this is a content change rather than new code. Whichever
scene shows the yard should treat her as the animal with a name, not one of the
set.

**The chick has no blighted twin on purpose.** A rotting baby chick is a tonal
call that belongs to the owner rather than to whoever happened to be generating
art, and it is one command away if they want it.

## What this unblocks

The clean/blighted pairs were made with `create_object_state`, which produces a
variant of the *same* object rather than a new object that happens to be grey.
That is exactly the relationship §2's lightning cut needs: the animal on the far
side of the flash is provably the animal you were just looking at, in the same
pose, at the same size, on the same canvas. A cross-fade between the two keys
lands with no re-registration.

So §2 is no longer blocked on art for the cast. It is still blocked on §1 —
the buildings — and the sequencing note there still holds.

## The fenced yard the owner asked for

> "I want them all in our front scene in the fenced area with a chicken coop in
> it."

The scene already has `scene.coop` at (800, 478) and a stock pen at
(1596, 646) holding a LimeZu cow, calf and sheep. The ask is a yard that holds
*their* animals instead. Two notes for whoever places it:

- **The flock is ten different birds, not one bird ten times.** That was the
  explicit request. They differ in size as well as plumage — `chick` packs at
  34px and `buffHen` at 56px — so a row of them at one scale already reads as a
  real flock without any per-bird treatment.
- **Sizes vary by animal**, 34px to 68px, because each was generated at the
  size its subject wanted. `spriteEl` picks an integer zoom from the box you
  give it, so a uniform box gives non-uniform zooms. Pass `forceZoom` where a
  row needs to agree.
