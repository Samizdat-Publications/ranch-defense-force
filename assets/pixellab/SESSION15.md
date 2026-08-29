# The last generation batch

The PixelLab subscription was cancelled after this session. **Balance is 0 and
the key is dead** — nothing here can be regenerated, so pick from what is in
these directories rather than planning a re-roll.

Everything below was made with `POST /v2/map-objects` at **1 generation per
call** (`npm run mapobject`). None of it is wired: `art/sprites.json` was
deliberately not touched, because packing an unreviewed pick is how a wrong
sprite ships silently. Review with `npm run contactdir -- <dir> out.png 1400 4`.

| directory | what | notes |
|---|---|---|
| `yard/` | 18 subjects for the home-screen scene, 3–4 candidates each | raw. The four large subjects came back **carded** |
| `yard_picked/` | barn, house, silo, oak — the chosen candidates, de-carded | use these, not the `yard/` originals |
| `field/` | crops, the 8 weapon sprites, duck, gas mask, heal jar, blighted crops, hazards, biome nodes | |
| `field2/` | retries of the four subjects the first pass got wrong | prefer these over the `field/` versions of the same names |
| `duster/` | 22 candidates for the wave-25 boss, four facings | |

## What is worth knowing before picking

- **`/map-objects` cards anything large.** Every subject at ~400px came back as
  a framed illustration on a solid ground; every subject at ≤160px came back
  clean. `npm run rmbg` fixed the four that mattered and that is what
  `yard_picked/` is. **Protect before you write** — any pass that re-cuts from a
  source must run after the de-card, not before.
- **Two subjects still have duds among their candidates.** `icon_gasmask_2` and
  `pickup_heal_0` are solid grey squares; `weapon_melonLob_2` and
  `weapon_shovel_2` include a human hand; `node_scrapheap_2` is a red truck.
- **`ui_panel` has exactly one usable candidate** in each batch —
  `field/ui_panel_1.png` and `field2/ui_panel_1.png`. The rest are blank
  parchment with no frame. `field2/ui_panel_1.png` is the better of the two.
- **The duster ignored the requested facing about half the time.** `duster/` was
  generated with explicit LEFT / RIGHT / head-on / from-behind wording and is
  the better set; `field/duster_*` was the first, vaguer attempt. Pick four that
  actually face four different ways rather than trusting the filename.
- **Sizes are capped at 400px** by the endpoint, so `barn` is 400×224 where the
  LimeZu crop was 480×224, and `silo` is 224×400 where the crop was 224×448.
  `src/ui/scene.ts` positions these by the **top-left of the full box**, so both
  need a coordinate nudge when they land, not a rescale.
