# The upgrade roster

Design only. Nothing under `src/` was touched. The measurement tool is
`tools/offer-stream.ts`; everything below the fold is a specification an
implementer can transcribe into `src/content/*.json` and six call sites.

The owner's complaint, in his words: *"I hit the upgrade screen like 20 times in
a few waves, but the options are mostly the same like 7 things, and especially
in the store, often the available items will be 3 of the same thing... it gets
boring after the 5th upgrade since you've already got most of everything."*

He is right, and he is right about the wrong cause. **The pool is not thin.**
It is measured below at 27–44 takeable candidates at every point in a run, and
it drops below 12 in one run out of 144. The problem is that the draw is
structurally incapable of showing most of it.

---

## 1. What was measured

`tools/offer-stream.ts` flies the same crude bot `tools/balance.ts` uses — merge
what you own, then defence, then whatever is first — over the same fixed seed
ladder, and records **every card on every board**: 24 seeds × 6 classes = 144
runs, 4,992 full boards, 25,922 individual cards. Run it with:

```bash
npx vite-node tools/offer-stream.ts -- 24 all kite      # the numbers below
npx vite-node tools/offer-stream.ts -- 24 hand,kid kite # faster, same shape
```

### Headline, all 144 runs

| | measured |
|---|---|
| upgrade screens per run | **31.2 level-ups + 3.5 shops**, 180 cards shown |
| distinct ids seen by level 5 | **15.5** |
| …by level 10 / 15 / 20 | 33.3 / 38.0 / 44.2 |
| …by the end of a run | **46.0 of the 56 that exist** |
| **share of every card that is a pure stat bump** | **64.9%** |
| **boards where all four cards were the same category** | **40.0%** (39.6% of those all-stat) |
| boards with 3+ of one category | **79.3%** |
| **level-up cards that were `common` rarity** | **76.5%** |
| **uncommon-or-better level-up cards that were the single doubled slot** | **100.0%** |
| **merges, as a share of level-up cards** | **2.9%**, and 100% of them the doubled slot |
| draws containing an id already taken to max | **0.0%** (the pool filters correctly) |
| draws containing an id you already own a copy of | **63.2%** |
| **shops that reshowed an id from the previous shop** | **100.0% of visits**, 46.5% of shop cards |
| **top 7 ids as a share of every card shown** | **33.2%** |
| the 11 common stat items as a share of every card shown | **46.3%** |
| **across any 5 consecutive level-ups** | **15.8 distinct ids on 21.3 cards — 74.2% new** |
| **level the takeable pool first drops below 12** | never, in 143/144 runs |
| takeable candidates, L1-5 → L30-34 | 44 → 41 → 38 → 32 → 31 → 30 → 27 |

Per class, end-of-run distinct ids seen (of 56): hand 44.5, kid 45.5, widow
50.3, vet 46.5, agronomist 45.8, drifter 43.5. The complaint is not
class-specific.

The roster is **56 cards**, not the 59 the brief assumed: 16 weapons and 40
items. `items.json`'s own `_designNote` says 11/11/9/5/4 = 40 and it is right;
the count of 43 came from reading `_`-prefixed documentation keys as entries.

### The three structural causes

**(a) Three of the four level-up slots can only ever be commons.**
`drawLevelUp` fills its boosted slot from `betterIdx`, then fills every
remaining slot from `commonIdx` alone:

```ts
const pool = commonIdx.length > 0 ? commonIdx : candidates.map((_, i) => i)
```

A weapon merge's rarity is its next tier — `uncommon`, `epic` or `legendary`,
never `common`. So **a merge cannot appear in slots 2, 3 or 4 of a level-up, at
any point in any run**, and neither can an element, a special, or any uncommon
item. Every one of them competes for one slot in four. That is not an inference:
100.0% of the 6,090 uncommon-or-better level-up cards measured were the boosted
slot. The 11 common stat items therefore inherit three slots out of four and
take 46.3% of every card the player ever sees, and the top seven ids alone take
a third. "Mostly the same like 7 things" is measured at 33.2%.

**(b) The suppression memory is shorter than the gap between shops.**
`MEMORY_SECONDS = 90`. Shops open after waves 5/10/15/20/24 — 5 × 40s = 200
seconds apart. The memory has fully expired before the next shop opens, every
time, so shop suppression is dead by construction: **100.0% of shop visits
reshowed an id from the previous visit**, and 46.5% of shop cards were repeats.
The reroll has no memory at all, which is why a reroll can hand back what was
just on the board. A time-based memory is the wrong unit anyway: level-ups
arrive roughly every 30s early and every 90s late, so 90 seconds means "the last
three boards" at level 5 and "the last board" at level 30.

**(c) There is nothing to show that is not a percentage.**
Of 40 items, 22 are pure `mods` — a single number on the stat sheet. 18 do
something. Six of those 18 are epic or legendary and shop-only, so a run that
cannot afford the shop never sees a behavioural card at all except the three
element loads. And there is no card in the game that is *about* a weapon you own
— the 48 per-tier riders in `weapons.json` exist and fire, but they are not
cards; they arrive as a side effect of a merge and the card text does not even
say what changed ("Tier 3: +2 pellets (+60% damage)" is the whole line, with no
before, no after, and the 60% hardcoded in `offers.ts`).

The result the numbers describe: 40% of boards are four percentages, 79% are
three of one thing, and after level 10 the game has essentially finished
introducing itself.

---

## 2. What this is judged against

After the rebuild, on the same 24 seeds and the same bot:

| metric | now | target |
|---|---|---|
| pure stat share of all cards | 64.9% | **≤ 25%** |
| all-one-category boards | 40.0% | **≤ 3%** |
| 3+ of one category | 79.3% | **≤ 20%** |
| level-up cards that are `common` | 76.5% | ≤ 45% |
| uncommon+ that are the doubled slot | 100.0% | ≤ 40% |
| merges as share of level-up cards | 2.9% | 8–14% |
| shops reshowing the previous visit | 100.0% | **0%** |
| distinct ids by level 10 | 33.3 | **≥ 45** |
| distinct ids by end of run | 46.0 of 56 | 70–85 of a **reachable ~115** |
| distinct ids across 5 consecutive level-ups | 15.8 of 21.3 (74.2%) | **≥ 90%** |
| top 7 ids' share of all cards | 33.2% | ≤ 12% |
| candidate pool at L30-34 | 27 | ≥ 60 |

Two notes on reading that table. **160 is the roster, not the pool a single run
can see**: a run plays one class (3 of the 18 class cards) and carries at most
six weapons (18 of the 48 upgrades), so the pool *reachable in one run* is about
**115**. That is deliberate — it is the same mechanism that makes two runs
different from each other. And the two distinct-id targets are therefore not
comparable to today's "46 of 56" as a fraction; the number that matters is 46 →
70+ **cards actually seen**, which is a 50% increase in the material a single
run puts in front of the player.

The last row matters most: the pool must stay *large* late, because the late-run
complaint ("you've already got most of everything") is about the pool
**shrinking** as you max things out. The gated categories are what keep it
growing — every weapon you pick up adds three cards to the pool that did not
exist before you owned it.

---

## 3. The roster: 160 cards

56 today → **160**. 104 new. Counted by category, with how many already exist:

| # | Category | Total | New | Gate |
|---|---|---|---|---|
| 1 | Weapons | 16 | 0 | — |
| 2 | Weapon Upgrades | 48 | 48 | own the weapon |
| 3 | Class Cards | 18 | 18 | play the class |
| 4 | Loads (elements) | 9 | 6 | — (exclusive: one at a time) |
| 5 | Load Riders | 4 | 4 | own a Load |
| 6 | On-Hit | 11 | 7 | — |
| 7 | On-Kill | 6 | 5 | — |
| 8 | Allies & Placeables | 9 | 6 | — |
| 9 | Body & Ground | 10 | 5 | — |
| 10 | Field & Ledger | 7 | 5 | — |
| 11 | Stat Cards | 22 | 0 | — |
| | **Total** | **160** | **104** | |

Two thirds of the new cards (66 of 104) are **gated**, and that is the whole
trick. A gated card costs almost nothing to design — it is a number on a weapon
or a passive that already exists — it cannot dilute the early game because it
cannot appear yet, and it makes the pool *grow* as the run goes on instead of
shrinking. It is also where builds diverge: two players with different weapons
are drawing from genuinely different pools by wave 10.

Nothing existing is deleted. The 22 stat cards stay; what changes is that **at
most one of them can appear on a board**.

---

## 4. Synergy tags

Every card declares `tags: string[]`. Two jobs: cards reference each other in
text and in effect, and the draw biases toward tags the player already holds so
a build **forms** instead of accumulating.

`fire` · `frost` · `acid` · `salt` · `lime` · `spark` · `tar` · `slick` ·
`load` · `mark` · `bleed` · `stun` · `crit` · `pierce` · `melee` · `ranged` ·
`ally` · `placeable` · `kill` · `armour` · `dash` · `feed` · `luck` · `xp`

Worked examples of tags doing real work, not decoration:

- **Hot As It Comes** (`slick`, `fire`) — *"every slick on the field burns
  twice as hot."* Reads `slick` and multiplies the dps of tar puddles, kerosene
  splashes, the Chem Sprayer's gas, the Grenade Launcher's T3 rind and the
  Crop Duster's trail. One card, six sources, no new hook.
- **Cross-Contamination** (`mark`) — *"anything carrying two statuses takes
  +30%."* Every `load`, every `bleed` and every `slow` card in the roster feeds
  it.
- **Weak Seam** (`crit`, `mark`) — crits apply a mark, so a crit build and a
  status build are suddenly the same build.
- **Last Rites** (`kill`, `mark`) — a marked enemy that dies bursts. Pairs with
  Rock Salt, Quicklime and Weak Seam, all of which apply marks by different
  routes.

Tag bias in the draw: `weight *= min(2, 1 + 0.12 * tagsOwnedMatching(card))`.
Deterministic, computed from the build, no RNG consumed.

---

## 5. The card-text contract

Every card states what taking it *again* does. This is a rendering contract
plus three content fields, and it is Batch 1 work because it is most of what
the owner will feel first.

| card kind | what the card must show | how |
|---|---|---|
| **stackable** | a stack counter and the concrete before → after | new `CardSpec.stacks: {n, max}` renders `3/5` beside the lot number; the existing `previewDelta` line already produces `Attack speed 12% → 24%` and applies unchanged |
| **non-stackable** | `ONE ONLY` in the footer's lot slot | `maxStacks: 1` |
| **merge** | the *concrete* delta, per tier | `weapons.json` `tiers` becomes `{"3": {"name": "+2 pellets", "delta": "6 → 8 pellets · 6 → 9.6 damage"}}`; `offers.ts` renders `Tier 3: +2 pellets — 6 → 8 pellets · 6 → 9.6 damage` instead of today's `Tier 3: +2 pellets (+60% damage)` |
| **weapon upgrade** | the owning weapon's name in the kind band | `ItemDef.requiresWeapon` drives the band |
| **class card** | the class name in the kind band | `ItemDef.requiresClass` |
| **behavioural, no mods** | the blurb IS the delta, and it must carry the numbers at the *current* stack | new `ItemDef.stackBlurb` with `{n}` substituted from `itemCount + 1` |
| **maxed** | never reappears | already true (`canTakeItem`); the only remaining gap is that the card at max shows no "this was your last one" — add `4/4 · LAST` on the final copy |

A merge card is the worst offender today and the cheapest to fix. The owner's
"it's not clear what buying the same uncommon weapon 3 or 4 times does" is
literally answered by the `delta` field: sixteen weapons × three tiers = 48
short strings, all derivable from numbers already in `weapons.json`.

---

## 6. The tables

Columns: **id** · **name** · **rarity** · **source** (L level-up, S shop, B
both) · **stacks** · **cost** · **tags** · **what it does, with numbers** ·
**hook** · **art**.

Hook codes are defined in §8. `—` means an existing field carries it with no new
plumbing. Art: `have` = an atlas key exists today, `claim` = generated and
sitting unclaimed in `docs/PIXELLAB_INVENTORY.md`, `NEW` = wants generating.

### 4. Loads — 9 (6 new)

Exclusive: taking one replaces the last, as today. Each is the run's single
loudest decision, and there are now nine of them instead of three.

| id | name | rar | src | stk | cost | tags | effect | hook | art |
|---|---|---|---|---|---|---|---|---|---|
| `tracerRounds` | Tracer Rounds | rare | S | 3 | 34 | fire, slick | burn 7dps/3s; ignites slicks at 14dps | — | have |
| `etchedRounds` | Etched Rounds | rare | S | 3 | 34 | acid, bleed | bleed 5dps/5s | — | have |
| `coldRounds` | Cold Rounds | rare | S | 3 | 34 | frost | slow 45% for 2s | — | have |
| `saltRounds` | Rock Salt | rare | S | 1 | 34 | salt, mark | every hit marks for **+22% damage taken, 4s** | — (`markPct`) | NEW |
| `limeRounds` | Quicklime | rare | S | 1 | 34 | lime, mark | marks +12%/5s **and** slows 25%/3s | — | NEW |
| `fenceRounds` | Fence Charge | rare | S | 1 | 36 | spark | every hit arcs to **1 more enemy within 120px for 45%** | **H1** | NEW |
| `keroseneRounds` | Kerosene Load | rare | S | 1 | 36 | fire, slick | every hit leaves a **34px burning slick, 3s, 10dps** | **H6** | have (`item.keroseneCan`) |
| `tarRounds` | Tar Load | rare | S | 1 | 34 | tar, slick | slow 35%/2.5s; a **kill leaves a 46px tar slick, 4s, 40% slow** | **H6** | NEW |
| `fontRounds` | Font Water | epic | S | 1 | 44 | blessed | no DoT: every hit **knocks back 70**, every kill **heals 3** | — / **H11** | NEW |

### 5. Load Riders — 4 (all new, all gated on owning a Load)

| id | name | rar | src | stk | cost | tags | effect | hook | art |
|---|---|---|---|---|---|---|---|---|---|
| `secondPass` | Second Pass | unc | B | 3 | 18 | load | your load's damage-over-time ticks **+25% harder** per stack | — (`dotDamageMul`) | NEW |
| `deepSoak` | Deep Soak | unc | B | 3 | 18 | load | your load lasts **+1.5s** per stack | — (`dotDurationMul`) | NEW |
| `hotAsItComes` | Hot As It Comes | rare | S | 2 | 30 | slick, fire | **every slick on the field** — tar, kerosene, gas, rind, Crop Duster — does **+100% dps** per stack | — (hazard `dps`) | NEW |
| `crossContam` | Cross-Contamination | epic | S | 1 | 46 | mark | an enemy carrying **two or more statuses takes +30%** from everything | — (`markPct`) | NEW |

### 6. On-Hit — 11 (7 new)

| id | name | rar | src | stk | cost | tags | effect | hook | art |
|---|---|---|---|---|---|---|---|---|---|
| `throughAndThrough` | Through and Through | unc | B | 3 | 19 | ranged, pierce | **+1 pierce** on every ranged shot | — (`p.pierce`) | NEW |
| `ricochetPlate` | Ricochet Plate | rare | B | 3 | 28 | ranged | a shot that hits **bounces to one more enemy within 150px at 60%** | **H2** | NEW |
| `splitShot` | Split Shot | rare | S | 2 | 32 | ranged, kill | a shot that **kills splits into two at 45%** | **H3** | NEW |
| `burrLoad` | Burr Load | unc | B | 3 | 20 | ranged | shots **steer 100°/s** toward the nearest enemy | **H4** | NEW |
| `moonshineJug` | Moonshine Jug | rare | B | 3 | 30 | fire | **15% of hits burst for 55% in 52px** | **H5** | NEW |
| `broadSide` | Broad Side | com | L | 5 | 14 | ranged | **+12% projectile radius** per stack | — (`p.radius`) | NEW |
| `weakSeam` | Weak Seam | rare | B | 3 | 27 | crit, mark | a **crit marks for +20%, 3s** | — (`markPct`) | NEW |
| `postDriver` | Post Driver | rare | B | 3 | 30 | stun | every stun you land lasts **×2**, swing speed −12% | — | have |
| `secondCutting` | Second Cutting | epic | S | 2 | 44 | melee | the scythe grows a **second blade at 70%** | — | have |
| `reapersOwn` | The Reaper's Own | leg | S | 1 | 68 | melee, kill | blades **pierce everything**; a melee kill **re-swings at 80%** | — | have |
| `cattleProd` | Cattle Prod | epic | S | 2 | 42 | stun | touching you **stuns 0.3s**, once per enemy per 8s | — | have |

### 7. On-Kill — 6 (5 new)

| id | name | rar | src | stk | cost | tags | effect | hook | art |
|---|---|---|---|---|---|---|---|---|---|
| `feedTheBirds` | Feed the Birds | unc | B | 4 | 17 | kill, feed | **15% of kills drop a feed token**, +15% per stack | **H11** | have (`pickup.feed`) |
| `broodyHen` | Broody Hen | rare | S | 3 | 30 | kill, ally | every **12th kill hatches a chick**: 9 damage, 8s, one live chick per stack | **H11**+**H8** | claim (`rdf-chick`) |
| `bloodMeal` | Blood Meal | unc | B | 4 | 20 | kill | kills **heal 1.2** | **H11** | NEW |
| `rotUnderfoot` | Rot Underfoot | rare | B | 3 | 28 | kill, slick, acid | **25% of kills leave a 42px acid pool, 3s, 14dps** | **H6** | NEW |
| `lastRites` | Last Rites | epic | S | 2 | 44 | kill, mark | a **marked** enemy that dies **bursts for 40% of its max HP in 70px** | **H5** | NEW |
| `threshingFloor` | Threshing Floor | epic | S | 2 | 46 | kill | a kill **splashes 40% of its max HP in 90px** | — | have |

### 8. Allies & Placeables — 9 (6 new)

Every placeable rides the **projectile pool** with `type: 'placeable'`, exactly
as `whitacreBull` rides `type: 'minion'` today. No new pool, no allocation.

| id | name | rar | src | stk | cost | tags | effect | hook | art |
|---|---|---|---|---|---|---|---|---|---|
| `scarecrowPost` | Scarecrow Post | rare | B | 3 | 32 | ally, placeable | plants a scarecrow: **9 damage every 1.2s at 190px, 25s life**, one per stack | **H8** | have (`prop.scarecrow`) |
| `bearTrap` | Bear Trap | unc | B | 4 | 22 | placeable, stun | drops a trap every 5s, **max 4 live**: 45 damage, **holds 1.5s** | **H8** | NEW |
| `henCoop` | Hen Coop | rare | S | 2 | 34 | ally, placeable | a coop that **sends out a hen every 6s**: 7 damage, dies on contact | **H8** | claim (`rdf-scene-coop`, 4 unclaimed) |
| `tripWire` | Trip Wire | unc | B | 3 | 21 | placeable, stun | a wire between you and the nearest prop: crossing it does **28 and stuns 0.5s** | **H8** | NEW |
| `yardGoose` | Yard Goose | epic | S | 1 | 46 | ally | a goose that harasses the nearest enemy: **14 damage, 180 knockback, every 0.6s** | — (minion path) | NEW |
| `littermate` | Littermate | epic | S | 1 | 48 | ally | **requires Barn Dog** — a second dog at 80% damage | — (minion path) | have (`weapon.barnDog`) |
| `whitacreBull` | The Whitacre Bull | leg | S | 1 | 74 | ally | a bull that **charges for 90 every 9s** | — | have |
| `cropDuster` | Crop Duster | epic | S | 2 | 48 | slick, placeable | you **trail gas: 12dps in 70px** | — | have |
| `saltCircle` | Salt Circle | leg | S | 1 | 62 | salt, placeable | a **160px ring**: crossing it does **40 and slows 50%** | — | have (`item.saltCircle`, currently mis-pointed) |

### 9. Body & Ground — 10 (5 new)

| id | name | rar | src | stk | cost | tags | effect | hook | art |
|---|---|---|---|---|---|---|---|---|---|
| `fenceRow` | Fence Row | unc | B | 4 | 20 | armour | start each wave with a **25 shield** per stack | **H9** | NEW |
| `hobnails` | Hobnails | unc | B | 4 | 19 | melee | anything that **touches you is slowed 35% for 1s** | — (touch path) | NEW |
| `oilcloth` | Oilcloth | unc | B | 3 | 22 | armour | **hazards do 40% less to you** per stack, capped at 80% | — (`playerDps`) | NEW |
| `windbreak` | Windbreak | rare | B | 2 | 28 | — | **knockback you apply +40%**; an enemy thrown into another does **12 to both** | — (`kx/ky`) | NEW |
| `secondWind` | Second Wind | leg | S | 1 | 66 | — | once per run, **death leaves you at 40% HP** and clears everything within 200px | **H10** | NEW |
| `barbedWire` | Barbed Wire | unc | B | 4 | 20 | armour | attackers take **5 back** | — | have (mis-pointed) |
| `strawHat` | Straw Hat | rare | B | 3 | 24 | armour | enemies within 60px deal **15% less** | — | have |
| `wetRag` | Wet Rag | rare | B | 3 | 24 | armour | **2s of grace** inside gas | — | have |
| `ironLung` | Iron Lung | epic | S | 2 | 40 | armour | **gas does nothing**, +20 max HP | — | have |
| `sundayBest` | Sunday Best | leg | S | 1 | 58 | armour | the **first hit each wave** is refunded for **200** | — | have |

### 10. Field & Ledger — 7 (5 new)

| id | name | rar | src | stk | cost | tags | effect | hook | art |
|---|---|---|---|---|---|---|---|---|---|
| `seedCorn` | Seed Corn | unc | B | 4 | 18 | xp | **+10% XP** from every source per stack | **H15** (`xpPct`) | NEW |
| `ledgerBook` | Ledger Book | rare | S | 2 | 26 | feed | **interest cap 12 → 24**, rate **8% → 11%** | content (`waves.json`) | NEW |
| `spareChoke` | Spare Choke | rare | B | 3 | 27 | luck | **one free level-up reroll** per stack, per level | offers/UI | NEW |
| `handbill` | Handbill | epic | S | 1 | 42 | luck | the shop shows **five cards**, and the **first reroll each visit is free** | UI | NEW |
| `earlyBird` | Early Bird | com | L | 5 | 13 | feed | feed pickups are worth **+1** | — | have (`pickup.feed`) |
| `pickaxeHead` | Better Pickaxe Head | unc | B | 4 | 26 | — | next pickaxe tier | — | have |
| `axeHead` | Better Axe Head | unc | B | 4 | 26 | — | next axe tier | — | have |

### 11. Stat Cards — 22 (unchanged content, changed draw weight)

`whetstone` `workBoots` `feedSack` `saltLick` `roosterAlarm` `balingTwine`
`fenceStaples` `chalkLine` `grainScoop` `lampOil` `splitRail` (common) ·
`hayHook` `slingBands` `weatherVane` `tractorPlate` `coffeeThermos` `fourLeaf`
`bootKnife` `dogWhistle` (uncommon) · `keroseneCan` `culvertPipe` `ditchLight`
(rare).

No numbers change. What changes is the draw: **at most one stat card on any
board**, which takes them from 64.9% of the stream to a floor of 25% and a
ceiling of 25%. They are still the reliable filler a player wants when nothing
else on the board fits the build; there are just no longer four of them at once.

Two content fixes while here, both free: `chalkLine` and `bootKnife` both grant
crit chance and read as the same card — retag `bootKnife` to `crit` and raise
its crit *damage* so the pair is "more often" against "harder". And `lampOil`,
`fourLeaf` and `ditchLight` are three luck cards at three rarities; that is
fine, but they should all carry the `luck` tag so a luck build forms.

### 2. Weapon Upgrades — 48 (all new, all gated on owning the weapon)

**This is where the game gets depth cheaply.** Each is a boolean on a weapon
slot that an existing behaviour already reads a number for. Three per weapon.
None can appear until you own the weapon, so they cost the early game nothing
and make the pool grow through wave 25.

Rarity ladder is uniform: the first is **uncommon**, the second **rare**, the
third **epic**. Cost 20 / 30 / 44. All `maxStacks: 1`, source `both`. All ride
**H12**. Art: the owning weapon's tier sprite, tinted — **zero new art**.

| weapon | uncommon | rare | epic |
|---|---|---|---|
| **Scattergun** | **Choke Tube** — spread ×0.55 | **Buck & Ball** — +2 pellets, −15% each | **Cut Shell** — pellets pierce 1 and knock back 90 |
| **Varmint Rifle** | **Match Barrel** — +60% shot speed, and the round steers 60°/s onto its first target *(H4)* | **Hot Load** — burn dps ×1.8 | **Set Trigger** — fires twice per cooldown, 2nd at 60% |
| **Grenade Launcher** | **Thin Casing** — splash ×1.35 | **Willie Pete** — the blast leaves fire, 3s, 12dps | **Rifled Cup** — the shell bounces once and blows again at 60% |
| **Drum Gun** | **Wax Wads** — +2 wall bounces | **Frangible** — +2 shards, +25% shard damage | **Live Wire** — shards arc to one more enemy for 40% *(H1)* |
| **Tar Bomb** | **Thin Cut** — puddle radius ×1.4 | **Heavy Cut** — slow 50% → 70% | **Sump Oil** — the puddle burns 10dps with no fire load |
| **Harpoon Gun** | **Barbed Head** — hooked targets bleed 8dps/4s | **Twin Line** — +1 target | **Winch** — hauled targets land stunned 0.8s |
| **Chem Sprayer** | **Wide Nozzle** — radius ×1.3 | **Concentrate** — +80% damage, −20% radius | **Backpack Tank** — the jet applies your load at double duration |
| **Bait Drum** | **Sweet Feed** — pull radius ×1.4 | **Spoiled Feed** — lured enemies take +20% | **Blasting Cap** — detonation ×1.8 |
| **Pitchfork** | **Long Haft** — range +25% | **Three Tine** — arc ×1.4 | **Ash Handle** — every 4th swing stuns 0.6s |
| **Scythe** | **Whetted Edge** — hit interval ×0.75 | **Long Snath** — orbit radius +30% | **Reverse Snath** — +40% damage while standing still |
| **Sledge** | **Long Handle** — radius ×1.3 | **Dead Blow** — stun ×1.6 | **Drop Forged** — the slam leaves a 3s fissure, 40% slow |
| **Barn Dog** | **Slip Lead** — leash +50% | **Cattle Bred** — bite +40% | **Blood Up** — +15% dog speed per kill to +90%, resets each wave |
| **Post Hole Auger** | **Carbide Teeth** — +35% damage | **Two Speed** — +40% attack speed | **Down Pressure** — 5 hits on one target stun 0.8s |
| **Crow Bell** | **Heavier Clapper** — +45% damage | **Cracked Bell** — the ring slows 30% for 2s | **Tolls Twice** — a second ring 0.5s later at 60% |
| **Seed Drill** | **Deep Set** — patch lasts +4s | **Volunteer Corn** — patch damage ticks 50% faster | **Broadcast** — throws two patches |
| **Combine Head** | **Wider Table** — arc ×1.15 | **Concave Adjust** — +25% damage | **Straw Chopper** — its kills leave a 40px hazard, 3s, 10dps |

### 3. Class Cards — 18 (all new, gated on class)

Each plays directly into the passive `classes.json` already declares, so the
numbers are edits to a block the sim already reads. Uncommon / rare / epic,
cost 20 / 30 / 44, `maxStacks: 1`, source `both`. All ride **H13**. Art: the
class portrait — **zero new art**.

| class · passive | uncommon | rare | epic |
|---|---|---|---|
| **The Hand** · Braced | **Set Feet** — Braced starts at 0.5s, not 1s | **Deep Rooted** — Braced caps at **45%**, not 30% | **Anchor Stone** — at cap, enemies within 90px are slowed 30% |
| **The Kid** · Momentum | **Long Stride** — caps at **+70%**, not +50% | **Following Wind** — Momentum decays over 1s instead of dropping to zero on stop | **Dust Devil** — Bolt's trail lasts 3s and does 8dps |
| **The Widow** · Grit | **Set Jaw** — **45%** of a blow lands at once, not 55% | **Long Mourning** — the wound bleeds off over **8s**, not 5s | **Black Dress** — a kill closes **40%** of the wound, and closing one fully heals 6 |
| **The Veteran** · Overwatch | **Range Card** — the far band starts at **140px**, not 170 | **Cold Bore** — the far bonus is **+60%**, not +40% | **Enfilade** — the near penalty is gone; contact is neutral |
| **The Agronomist** · Cultivar | **Field Trial** — statuses last a further **+40%** | **Selective Breeding** — Cultivar's damage bonus **70% → 110%** | **Volunteer Strain** — an enemy dying with 2+ statuses spreads them to 3 neighbours |
| **The Drifter** · Hot Streak | **Long Season** — the window is **6s**, not 4s | **Nothing To Lose** — cap **18** stacks, not 12 | **Cut and Run** — a hit takes **half** the streak, not all of it |

---

## 7. Draw rules, in `offers.ts` terms

### 7.1 Category is declared, not derived

`ItemDef.category` and `WeaponDef.category` become required fields, and `Offer`
carries it. The measurement tool derives category today by sniffing for
`special`/`element`/`toolUpgrade`; the draw must not guess.

### 7.2 The level-up board: quotas, and no more commons-only slots

Delete the `commonIdx`-only pool. All four slots draw from the whole candidate
set weighted by `rarityWeight × tagBias`, filled in this order:

1. **Slot A — the doubled slot.** As today: the highest-rarity card drawn, at
   double magnitude. Keep it. It is a good rule; it was just carrying the entire
   non-common roster on its own.
2. **Slot B — gated.** Must be a `weaponMod` or `class` card if any is
   available. From wave 3 onward there always is.
3. **Slot C — behavioural.** Must be `load`, `rider`, `onHit`, `onKill`, `ally`,
   `body` or `ledger`.
4. **Slot D — free.**

Then two board-level caps, applied as filters while filling:

- **At most one `stat` card per board.**
- **At most one `merge` per board**, unless nothing else qualifies.

Fallback when a quota cannot be met (a thin pool, or a class with everything
taken): behavioural → gated → merge → stat → anything. Never leave a slot empty
and never repeat an id within a board (already guaranteed).

The `guaranteeOneAboveCommon` special case can go: with slots B and C drawing
from categories that are mostly uncommon-or-better, an all-common board becomes
arithmetically rare rather than something to patch after the fact.

### 7.3 Memory measured in boards, not seconds

`recentlyOffered: Map<string, number>` becomes a **board index**, incremented
once per board dealt (level-up or shop).

- **Hard ban** for `SUPPRESS_BOARDS = 6` boards.
- **Weight ×0.3** for a further 6.
- Both relax automatically when the filtered candidate set cannot fill a board —
  the existing "suppressed rather than banned" reasoning is right, it was just
  denominated in the wrong unit.

At 31 level-ups per run, six boards is roughly three minutes early and eight
minutes late, which is what 90 seconds was *trying* to be.

### 7.4 The shop can never repeat itself

Two sets on `OfferPool`:

- `lastShopBoard: Set<string>` — every id shown at the **previous** shop visit.
  Hard-banned. Cleared and rewritten when a visit closes.
- `thisShopSeen: Set<string>` — every id shown **so far this visit**, including
  everything a reroll swept away. Hard-banned. **This is what makes a reroll a
  reroll**; today the previous board is a legal redraw.

Both degrade to weight-0.15 suppression if the pool cannot fill four slots,
which with 160 cards will effectively never happen. Held (`HOLD`-clipped) cards
are exempt from both — the player asked for that one.

Target: the measured 100.0% shop repeat rate goes to 0%.

### 7.5 Weapon slots full

Today, `slotsFull` filters new weapons out and the pool falls back to merges
alone — six candidates against forty items, which is why `weaponOfferWeight` had
to be inflated to 1.6 to keep merges visible at all. With the roster:

- New-weapon offers are still filtered out.
- **The six owned weapons contribute up to 18 weapon-upgrade cards**, which is
  a bigger and more interesting pool than the six merges it replaces.
- One new **`swap`** offer becomes available at `rare`, shop-only: *"Trade your
  lowest-tier weapon for one you do not own, at T1."* It is the answer to a run
  that filled its slots with the wrong thing in wave 2 and has no recourse.
- `weaponOfferWeight` can come back down from 1.6 toward 1.0, because merges are
  no longer competing with the whole item roster from one slot. Re-measure
  rather than assume; the tuning note in `tuning.json` says this is the knob and
  it is right.

### 7.6 Luck

Unchanged on rarity weights — `rarity.json`'s `luckScaling` is a good system.
Two additions:

- **Tag bias scales with luck**: `0.12 → 0.12 + luck/500`, so at luck 60 the
  bias is ×1.24 per matching tag instead of ×1.12. A luck build's cards agree
  with each other more. This is a much better luck fantasy than "slightly more
  epics".
- **The 5-card board threshold drops from luck 40 to luck 30** (`waves.json`
  `cardsAtHighLuck` gains a `cardsAtHighLuckThreshold`).

### 7.7 What the shop uniquely sells

Today: epics and legendaries, via `source: "shop"`. Keep that, and add four
things a level-up can never offer:

1. **The `swap` card** (§7.5).
2. **Weapon upgrades for weapons at T3+** — the epic tier of each weapon's three
   is shop-only, so the shop is where a finished weapon gets its capstone.
3. **`ledgerBook` and `handbill`** — cards about the shop itself belong in it.
4. **The Loads.** Already shop-only and correct: one exclusive, run-defining
   choice you pay for is exactly what a shop is for. With nine of them the shop
   visit becomes a real decision rather than "is fire on the board".

### 7.8 The consequence that must be stated out loud

**Changing the draw changes how many `next()` calls a run consumes, so every
recorded seed replays as a different run.** That is acceptable for an offers
change and it is not avoidable — but the map pick must stay the first draw and
stay one draw (`maps.json` `_rngNote`), so map-per-seed is preserved and the
arena a seed produces does not move. Everything after it does. Say so in the
commit; do not let it be discovered.

---

## 8. Sim hooks

**12 new hooks, at 6 call sites.** **85 of the 104 new cards ride one; the other
19 need no new plumbing at all.** The ratio is the point: `H12` alone carries 48
cards and `H13` carries 18, so two hooks account for two thirds of the roster.
Nothing here is a card-shaped `if` in `world.ts`.

| # | hook | where | shape | cards |
|---|---|---|---|---|
| **H1** | `Projectile.chainCount`, `.chainRange`, `.chainMul` | new `applyOnHitRiders()` called at the end of `World.applyHit` | on hit, query the grid once and damage up to N others | 2 |
| **H2** | `Projectile.ricochet`, `.ricochetRange` | same call site | on hit, retarget the projectile at a new enemy instead of freeing it | 1 |
| **H3** | `Projectile.splitOnKill`, `.splitCount`, `.splitMul` | `killEnemy`, beside the existing chain guard | reuses the `chaining` re-entry guard | 1 |
| **H4** | `Projectile.homingRate` | the projectile integrate step | steer `vx/vy` toward `findNearestEnemy` at N°/s | 2 |
| **H5** | `Projectile.explodeRadius`, `.explodeMul`, `.explodeChance` | `applyOnHitRiders()` | one `areaDamage` call; the existing `arcLob` splash generalised | 2 |
| **H6** | `Enemy.deathHazardKind`, `.deathHazardRadius`, `.deathHazardSeconds`, `.deathHazardDps` | `killEnemy` | one `spawnHazard()`; the hazard pool already exists | 3 + 3 weapon upgrades |
| **H8** | `Projectile.type = 'placeable'` + `SUSTAIN.placeable` + `Projectile.fireCd`, `.fireRange` | new entry in the `SUSTAIN` table in `behaviours/weapons.ts` | a static pooled projectile that fires on a cooldown; **no new pool** | 5 |
| **H9** | `specialItems.shieldHp`, `.shieldRegenOnWave`, `player.shield` | `takeWound` / `onWaveComplete` | generalises `firstHitShield`, which is already a special case of it — this is a refactor that pays for itself | 1 |
| **H10** | `specialItems.revives`, `player.revivesLeft` | the death branch of `takeWound` | one counter | 1 |
| **H11** | `specialItems.killDropChance`, `.killDropKind`, `.killHeal`, `.killSpawnEvery` | `killEnemy`, after `player.onKill` | reuses the pickup pool and the minion path | 4 |
| **H12** | `WeaponSlot.mods: string[]` + `hasMod(slot, id)` | `behaviours/weapons.ts`, one read per rider | the behaviours already read `tier >= n`; this is `hasMod(slot,'chokeTube')` beside it | **48** |
| **H13** | `ItemDef.requiresClass` + `player.classBonus` block | `player.updatePassive` / `onKill` / `takeWound` | the passives already read numbers off `def.passive`; this overlays them | **18** |

The 19 that need nothing: `throughAndThrough` `broadSide` `weakSeam`
`secondPass` `deepSoak` `hotAsItComes` `crossContam` `saltRounds` `limeRounds`
`yardGoose` `littermate` `hobnails` `oilcloth` `windbreak` `earlyBird`
`ledgerBook` `spareChoke` `handbill` `seedCorn`. They are content edits against
fields the sim already reads — which is the honest reason to prefer a card that
rides `markPct` over a card that invents a new debuff.

Offer-layer only, no sim change: **H14** `ItemDef.tags` + tag bias in
`offers.ts`; **H15** a new `xpPct` stat key in `stats.ts` (additive, like every
other); **H16** `ItemDef.category` / `requiresWeapon` / `stackBlurb`.

### Non-negotiables, checked

- **Additive stat resolution.** Every new `mods` entry goes through
  `resolveStats` unchanged. The only multipliers introduced are per-application
  payload scalars at the point a status leaves a projectile — exactly where
  `dotDamageMul` already lives, and applied once. No multiplicative stat
  stacking anywhere.
- **Zero allocation in the hot loop.** Placeables ride the projectile pool;
  corpse hazards ride the hazard pool; chicks and hens ride the minion path;
  chain/ricochet/split reuse `this.queryOut`. **No new pools.** Pool sizes that
  need to grow (`projectiles` for placeables, `hazards` for corpse pools) move in
  `tuning.json`, not in code. `applyOnHitRiders()` must early-out on a single
  cached boolean when no rider is owned, so a run with none pays one compare.
- **Seeded RNG.** Tag bias is a weight, not a draw. `explodeChance` and
  `killDropChance` are `rng.chance()` calls on the existing stream. §7.8 states
  the seed consequence.
- **Every tunable number in content.** Every number in §6 is a JSON field. The
  only code constants introduced are `SUPPRESS_BOARDS` and the quota table,
  which are draw *structure* rather than balance — and both should still land in
  `tuning.json` under `offers`, beside `weaponOfferWeight`.

---

## 9. Implementation, in five batches

Each is shippable, testable with `npm test` + `tools/balance.ts`, and
re-measurable with `tools/offer-stream.ts`. **Batch 1 is the one the owner
feels**, and it is deliberately the draw rules plus the first 30 behavioural
cards rather than the largest card count.

### Batch 1 — the draw, the card text, and 30 behavioural cards
`offers.ts` (§7.1–7.4, 7.6), the card-text contract (§5), and: 6 new Loads,
4 Load Riders, 7 On-Hit, 5 On-Kill, plus the `tiers` → `{name, delta}` rewrite
for all 16 weapons and the 7 free art re-points (§10). Hooks H1–H6, H11, H14,
H16.
**Ships:** 22 new cards, 48 rewritten merge card texts, and the fix for 40% of
boards being four percentages.
**Measured by:** stat share 64.9% → ≤35%, all-one-category 40.0% → ≤5%, shop
repeat 100% → 0%, distinct-by-L10 33.3 → ≥40.

### Batch 2 — weapon upgrades
H12, the 48 cards, the weapon-slots-full rule and the `swap` offer (§7.5).
**Ships:** 48 cards, zero new art, and the late-run pool going from 27
candidates to ~45.
**Measured by:** candidates at L30-34 ≥ 45; merges 2.9% → 8-14%; distinct-by-end
≥ 65.

### Batch 3 — allies, placeables and the body
H8, H9, H10, and the 6 Allies & Placeables plus 5 Body & Ground cards.
**Ships:** 11 cards, the first things the player *puts on the field*, and a
shield/revive layer the game has wanted since `sundayBest` was written as a
one-off.
**Measured by:** clear rate must not move more than ±3 on the balance ladder;
`brawler` and `spacer` pilots specifically, because placeables reward standing.

### Batch 4 — class cards
H13 and the 18 cards.
**Ships:** the six classes stop being a stat spread with one button and start
being six different draws. This is also the answer to NOTES' standing item that
Grit, Overwatch and Hot Streak have no on-screen expression — a card that reads
"Deep Rooted — Braced caps at 45%, not 30%" *teaches the passive*.
**Measured by:** the six-class parity test; no class may move more than 3 clears.

### Batch 5 — the ledger, and the retune
5 Field & Ledger cards, the shop's five-card board and free reroll, `spareChoke`
in the level-up UI, and a full re-tune pass with the balance harness across all
six classes and three pilots.
**Ships:** the economy layer, and the numbers settled.
**Measured by:** the full §2 target table.

A sixth, optional: `tools/offer-stream.ts` should grow a `--assert` mode that
fails on the §2 targets, so the regression is a test rather than a habit.

---

## 10. Art

### Free first — 7 items are pointing at stand-ins while their own art sits in the atlas

`art/sprites.json` packs `item.saltLick`, `item.slingBands`, `item.weatherVane`,
`item.tractorPlate`, `item.barbedWire`, `item.keroseneCan` and `item.saltCircle`.
`items.json` points those seven cards at `node.rockSmall`, `weapon.seedSpitter`,
`weapon.rake`, `node.rockBig`, `node.oreSilver`, `weapon.slopBucket` and
`node.rockSmall` respectively. Seven one-line `cardSprite` edits, zero cost.
This is the project's recurring lesson (`CLAUDE.md`: *"a document saying art is
missing is not evidence that it is"*) turning up again.

### Reuses — 0 generations

| cards | art |
|---|---|
| 48 weapon upgrades | the owning weapon's `tierSprites[n]`, tinted, with the weapon name in the kind band |
| 18 class cards | the class sheet's idle-down frame, as class select already draws |
| `feedTheBirds`, `earlyBird` | `pickup.feed` |
| `littermate` | `weapon.barnDog` |
| `keroseneRounds` | `item.keroseneCan` |
| `scarecrowPost` | `prop.scarecrow` (packed) |
| the 6 new Load *projectile* colourways | **nothing, at first.** `renderer.ts:1554` already falls back to the base clip when `proj.<clip>.<element>` was never packed, so a new Load ships legibly with no art at all. The colourways are a follow-up: `npm run recolour` over the 7 signature clips × 6 new elements = 42 variants, a tool run rather than a generation, and the atlas is already paged so the page budget can take it |

### Claims — generated and paid for, sitting unpicked

Both are `status: review` packs in `docs/PIXELLAB_INVENTORY.md`; claiming costs
nothing and is finished work, not pending work.

- `rdf-scene-coop` — 4 candidates, 128×160 — for **Hen Coop**
- `rdf-chick` / the 32×32 chick objects at inventory lines 226–232 — for
  **Broody Hen**

### To generate — 31 icons, one style-anchored batch, split to match the batches

32×32 card icons, `create_1_direction_object`, anchored to
`assets/pixellab/picked/` house style, conformed like the rest. **The owner's
rule is that anything generated is wired in the same task**, so the batch splits
three ways rather than shipping as one unwired pack:

**Batch 1 — 19 icons.** salt sack · quicklime bag · fence insulator with a wire
· tar bucket · a stone font · a second-pass sprayer nozzle · a soaking rag over
a jar · a burning oil rag · two mismatched jars (cross-contamination) · a bullet
with a shaved point (through-and-through) · a dented steel ricochet plate · a
shell splitting in two · a burr · a moonshine jug · a wide-bore round · a
seam-ripper on cloth · a bloody feed scoop (blood meal) · a rotted footprint
(rot underfoot) · a prayer card with a burnt edge (last rites).

**Batch 3 — 8 icons.** a rusted bear trap · a wire between two posts (trip
wire) · a yard goose · a row of fence posts (fence row) · a hobnailed boot sole
· a folded oilcloth · a windbreak hedge · a lantern going out and relighting
(second wind).

**Batch 5 — 4 icons.** a ledger book · an ear of seed corn · a spare choke tube
· a printed handbill.

Grep `docs/PIXELLAB_INVENTORY.md` for every one of these before generating.
The jar-of-preserves, jar-of-red-medicine, feed-bucket, shovel, salt-crystal and
horseshoe-magnet objects already in the account may cover four or five of the
31, and this project has paid for that lesson more than once.
