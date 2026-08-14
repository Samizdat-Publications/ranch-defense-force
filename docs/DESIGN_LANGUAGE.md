# Paper &amp; Pin — the design language

Every screen in this redesign is built from one idea: **the game's UI is printed
matter on a farm.** Kraft seed packets, stamped tin plates, wood type, dotted
paper, and a bulldog clip when something is held. Nothing is a glass panel and
nothing glows for decoration.

This document is the spec for `src/ui/style.css`. Values are literal — copy them.

---

## What this replaces

**All of the panel language documented in `style.css` under "THE PANEL LANGUAGE".**
The carved-wood `border-image` 9-slice, wood-as-chrome, dark-field-for-text, and
gold-means-affordable. Stated explicitly as the brief asked: **do not preserve
it.** Paper &amp; Pin replaces it on every surface.

Two consequences worth noting:

- The `border-image` goes away entirely, and with it the hard-won `fill` keyword
  bug. There is no 9-slice in this design — borders are plain 2–3px solid ink.
- LimeZu's UI pack is no longer used for chrome. Its **gamepad glyphs** are still
  useful and the licence credit is still required regardless.

**Three things earned their place and are kept:**

1. **The HP chaser** — the delayed white band draining behind the red. Best thing
   in the current HUD. Same CSS transition, now on cream paper instead of grey.
2. **The `scaleY` cooldown wipe** on weapon slots. Cheap, no layout, already wired.
3. **Affordable gets a warm outline** on every purchase surface. It is what lets
   the Homestead answer "what can I buy" without being read.

---

## Type

| Role | Family | Notes |
|---|---|---|
| Display | **Rye** | Card names, screen titles, big numbers. Wood type. Never below 18px, never for body copy. |
| Labels &amp; UI | **Silkscreen** | Everything stencilled: kind bands, tier plates, buttons, stat labels, footers. Always uppercase, always letter-spaced 0.1–0.34em. Small sizes are correct here — 7.5px to 13px. |
| Body | **IBM Plex Mono** | Blurbs, stat values, notes. 11–15px. |

All three are Google Fonts. **Self-host them** — a webfont link is a network
dependency on a game that should run offline, and it is not a runtime JS
dependency, so it does not touch the no-new-deps rule.

```
Rye · 400
Silkscreen · 400, 700
IBM Plex Mono · 400, 500, 600
```

`image-rendering: pixelated` on every sprite, everywhere, without exception.

## Colour

### Paper (the surface everything sits on)

```css
--paper:          linear-gradient(178deg, #d9c7a2 0%, #cdb994 58%, #c4ae86 100%);
--paper-bright:   linear-gradient(178deg, #eadcb8 0%, #ddca9f 56%, #d2bc8c 100%); /* selected, legendary */
--paper-dead:     linear-gradient(178deg, #c8bfa8 0%, #b6ad96 58%, #a89f88 100%); /* locked, unaffordable */
--paper-edge:     #40311f;   /* 3px solid, every paper element */
--paper-edge-gold:#6b4a12;   /* legendary and selected only */
```

Two textures, both cheap, both required — paper without them reads as flat tan:

```css
/* dotted stock, 0.12 opacity, over the whole surface */
background-image: radial-gradient(#5a4630 1px, transparent 1px);
background-size: 4px 4px;

/* inner hairline, 4-5px inset */
inset: 4px; border: 1px solid rgba(64, 49, 31, 0.32);
```

### Ink (text on paper)

```css
--ink:        #33261a;  /* Rye headings, big numbers */
--ink-body:   #5c4a33;  /* blurbs */
--ink-label:  #6b5840;  /* Silkscreen labels, footers */
--ink-band:   #4b3a24;  /* kind band */
--perf:       2px dashed rgba(64, 49, 31, 0.45);  /* the perforation */
```

### Dark surfaces (screens, art windows, overlays)

```css
--field:       #0b0a09;                    /* page behind everything */
--panel-dark:  rgba(14, 12, 10, 0.74);     /* the class sheet, notes */
--rule:        #3a3226;                    /* 1px borders on dark */
--rule-warm:   #4a3c28;
--window:      radial-gradient(70% 70% at 50% 40%, #3d3220 0%, #241d13 100%);
--window-in:   inset 0 3px 10px rgba(0, 0, 0, 0.7);
--cream:       #f6e6c2;  /* headings on dark */
--cream-2:     #f2e2c8;  /* button text */
--muted:       #9a8e76;  /* body on dark */
--muted-2:     #8a7c62;  /* labels on dark */
--muted-3:     #6f6350;  /* footnotes */
```

### Accent

```css
--gold:        #e0a02e;  /* section marks, the one accent colour */
--gold-btn:    linear-gradient(180deg, #e0b455, #b7862c);  /* primary button */
--gold-brand:  linear-gradient(180deg, #f0c561, #c2892a);  /* brand/stamp */
--gold-edge:   #33271a;
--danger:      linear-gradient(180deg, #8e3229, #6b2119);
--gain:        #3f6827;  /* + stat deltas */
--cost:        #8e3229;  /* − stat deltas, and the cost line */
```

### Rarity

Lives in `content/rarity.json`, not here. The UI reads `colour` / `dark` / `ink` /
`rank` from it and must not hardcode tier colours anywhere.

## The card

One silhouette for every card in the game — level-up, shop, Homestead, class
select. A kraft seed packet with a punched hang tab.

```
hang tab      108×26, clip-path polygon(9% 0, 91% 0, 100% 100%, 0 100%)
              15px punch hole, #1b1610, inset 0 2px 3px rgba(0,0,0,0.9)
body          3px solid var(--paper-edge), var(--paper)
kind band     Silkscreen 8.5px / 0.14em, ink-band, 2px bottom border, 7px padding
art window    132px tall, 3px border, var(--window) + var(--window-in)
              sprite centred, top: -9px (clears the plate), integer zoom only
rarity plate  see below — margin: -17px -7px 0, overlaps the window's bottom edge
name          Rye 20px, min-height 44px (two lines)
blurb         IBM Plex Mono 11.5px / 1.5, min-height 52px
perforation   var(--perf)
stat block    Silkscreen 8.5px labels left, mono values right, --gain / --cost
footer        2px top border, rgba(64,49,31,0.09) fill, LOT nn · SOURCE
```

Card width 210px on a level-up, 196px on the class rail. Do not scale the whole
card — the sprite is the only thing that scales, and only by integers.

### The rarity plate

The one piece of chrome in the design, and the only place a tier is expressed.

```css
height: 30px;
background: linear-gradient(180deg, var(--tier-colour), var(--tier-dark));
border: 2px solid #2b241a;              /* legendary: #5d3a08 */
box-shadow: 0 4px 8px rgba(0,0,0,0.45),
            inset 0 1px 0 rgba(255,255,255,0.34),
            inset 0 -2px 4px rgba(0,0,0,0.3);
```

- Tier **name** in Silkscreen 11px / 0.17em, `var(--tier-ink)`, `text-shadow: 0 2px 0 rgba(0,0,0,0.45)`.
- **Pips** flanking it on both sides: `rank` diamonds, 5×5px, `rotate(45deg)`, tier ink.
- Two **rivets** at 5px from each top corner: 4px circles, `rgba(0,0,0,0.35)` with a
  `0 5px 0` shadow for the second rivet and a 1px white lip.
- **Legendary only:** a foil sweep across the plate,
  `linear-gradient(104deg, transparent 36%, rgba(255,245,205,0.85) 49%, transparent 62%)`
  at `background-size: 240% 100%`, 2.6s linear infinite.
- Unaffordable: drop the emboss and the drop shadow, keep the colour. It reads as
  unprinted stock rather than disabled UI.

The same diamond is armour's unit in the HUD and rank's unit in the Homestead. It
is the only glyph in the game and it means "one step" everywhere.

## Motion

All CSS keyframes on `transform`, `opacity` or `width`. No library, no per-frame
canvas work, nothing in the hot loop. The HUD keeps writing to the DOM only when a
value changes.

| What | Timing |
|---|---|
| Card deal | 560ms `cubic-bezier(.16,1,.3,1)`, **110ms stagger** per card |
| Rarity plate stamp | 380ms `cubic-bezier(.2,1.5,.4,1)` at **+340ms** after the card lands — a separate beat, so the tier is the last thing you read. 1.55× overshoot, settles at `rotate(-0.8deg)` |
| Legendary foil | 2.6s linear infinite |
| Sprite breathe | 3.4s ease-in-out infinite, ±2px |
| Panel in (pause, results, signs) | 420–520ms `cubic-bezier(.16,1,.3,1)`, translateY 26px |
| Stat rows | 300–320ms ease-out, 45–55ms stagger |
| Acres stamp (results) | 460ms `cubic-bezier(.2,1.5,.4,1)`, delayed 700ms so it lands after the sheet |
| Porch light (home, Homestead) | 11s cycle, one flicker. The only *event* on the screen |
| Sprite walk cycles | one strip PNG + `background-position` with `steps(n)` |

**Centring gotcha, worth knowing:** if a panel is centred with
`transform: translate(-50%, -50%)` and also animated, the animation's transform
replaces the centring. Put the translate inside the keyframes, at every stop.

## HUD rules

The centre ~70% stays clear. Everything is pinned to a rail:

```
top-left      HP bar 420×40 + armour pips
top-centre    wave clock (Rye 26px) + boss bar pinned beneath it
top-right     feed, with the feed-sack sprite
bottom-left   ability plate, gold, pulsing when ready
bottom-centre weapon ring, 128px slots, cooldown wipe + tier chip
bottom edge   XP strip, 34px, full width
```

The boss bar stays at the top rather than floating over the boss. A bar over an
enemy that crosses the arena spends the fight behind him, which is exactly when
you need to read it.

## Copy voice

Plain, dry, and about the work. Never explain a mechanic in marketing language.

> Feed Sack — *More of you to lose before the field takes you.*
> Salt Circle — *Nothing crosses it twice. Whatever tries, comes apart at the line.*
> Whetstone — *Everything you own hits harder.*

Screen titles are farm nouns: *The Day's Sheet*, *The Homestead*, *Taking the
Field*, *Give Up the Field*. Buttons are verbs somebody would say out loud.
