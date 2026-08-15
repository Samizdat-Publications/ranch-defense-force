# Home screen — answers to the five questions

Written against your brief. Short version at the top of each.

---

## 1. Placements, as numbers

**See `PLACEMENTS.md`** — every sprite in both scenes, in 1920×1080 stage coordinates,
with x, y, drawn size, native size, computed zoom and animation. It is generated from the
mockup source, not typed, so it cannot drift from what the mockups actually render.

Two corrections it encodes that your current build will not have:

- **The field skyline was drawn at 0.5×.** You were right to reject that, and right about the fix.
  It is now barn 480×224, silo 224×448 and house 256×320 — all **1×**, all sitting with their
  base on the horizon line at **y 564**. Distance comes from position and haze (`blur(0.6px)`,
  `opacity 0.9–0.94`), never from scale.
- **The trees were clipped and fractionally scaled.** The pack's oaks are *modular* —
  `Oak_Green_Medium_Modular_Left/Middle/Right` — and I had cropped only the Middle piece, then
  drawn it at 0.25×. `art/scene/tree_oak.png` is the three pieces composited into one complete
  250×212 oak, used at 1× everywhere. The field's distant treeline is now a blurred CSS
  silhouette band (y 486, height 82) rather than shrunken sprites, because a distant tree needs
  a small *sprite*, not a small *scale*.

**Crop bands** — you were right that the near band was a wall. It is now five bands, not seven:

| y | height | tile | on-screen tile | zoom | opacity | blur |
|---|---|---|---|---|---|---|
| 574 | 64 | wheat | 64×64 | 2× | 0.90 | — |
| 636 | 64 | wheat | 64×64 | 2× | 0.62 | — |
| 700 | 96 | wheat2 | 96×96 | 3× | 0.92 | — |
| 806 | 96 | wheat2 | 96×96 | 3× | 0.55 | 1.2px |
| 902 | 128 | wheat2 | 128×128 | 4× | 0.95 | 2.6px |

They do not scroll — they **skew** in place (`fCrop` 5.2–8.3s, offset phases) so the field
breathes without the tiling reading as a moving wallpaper. Each band carries a different
`background-position` x-offset so the seams never line up vertically.

---

## 2. Non-16:9 windows — **letterbox**

Fit the 1920×1080 stage inside the window and bleed the leftover space with the scene's own
edge colours: `#191b36` above, `#191d13` below in the yard; `#1d2140` / `#201e13` in the field.
Read as a wider window, not as bars.

Cover-and-crop is the wrong trade here because the composition is horizontal — the barn is on
the right, the print is on the left, and cropping the sides destroys exactly that relationship.
Your screenshot of the 2.5×-scaled wheat is what covering costs.

If you must ever crop, the rectangle that has to survive is **x 430–1590, y 300–740**. That
holds the barn, the Homestead door, the stock pen and the walking band.

---

## 3. The printed matter — **delete the scrim**

There is no scrim in the mockups and there should not be one. The scene already ends with two
full-bleed passes that do the same job better, because they are shaped:

```
radial-gradient(120% 78% at 50% 56%, transparent 42%, rgba(12,10,14,0.52) 100%)
linear-gradient(180deg, rgba(10,9,14,0.44) 0%, transparent 22%, transparent 56%, rgba(10,9,8,0.68) 100%)
```

The second one darkens the bottom of the ground — which is exactly where the card rail sits.
Every printed panel also carries its own opaque kraft background, so it never needs help.

The composition rule the scenes are built to, and the one thing to preserve if you move anything:

> **Nothing that moves is placed in x 0–430 above y 726.** The left third is reserved for print.

The class panel is only 78% opaque, so anything behind it ghosts through and reads as a
rendering artifact rather than as scenery. Two rounds of this bug are why the rule is written down.

---

## 4. Six class cards below 1300px

Once the stage letterboxes, this question goes away — the internal layout is always 1920 wide,
so there is no breakpoint, no scroll and no compact variant. The cards are 196px with 16px gaps:
6×196 + 5×16 = **1256px**, centred, which fits inside 1920 with 332px of margin either side.

Don't ship the horizontal scroll. A picker you have to scroll hides the thing you are asking the
player to compare, and the clipped end card is the locked Drifter — the most interesting one.

---

## 5. Backdrop or loading screen — **backdrop, and only that**

They are home-screen backdrops. They are composed for the print that sits on them: the left
third is deliberately empty of motion, the Homestead call-out is positioned against the barn in
each scene, and the walking band is placed to stay clear of the card rail.

As loading screens they would be composed differently — subject centred, nothing reserved — so
if you want loading screens, they should be their own third and fourth scenes rather than these
two reused. Cheap to add: a scene is one `.dc.html`-equivalent module with no dependencies on
the UI layer.

---

## Also worth knowing

- Both scenes are self-contained: a `<style>` block of `@keyframes` prefixed `y*` / `f*` so the
  two never collide, then one absolutely-positioned root. Mounting a third scene is one entry in a list.
- Every strip animation uses **pixel** `background-position` with `steps(n)`, never percentages.
  Percentages produced a one-frame-then-blank flicker that took a while to spot.
- Actors are 2× and buildings are 1× in the yard. That difference is the depth cue that makes the
  place read as a place; it is not an accident of cropping.
