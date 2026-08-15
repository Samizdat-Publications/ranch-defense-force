# The mockups

Four pages. Open any `.dc.html` directly in a browser — no build step, no server, no
dependencies beyond the sibling `support.js` and the `art/` folder next to them.
They are self-contained reference documents, not code to lift wholesale.

| File | What it specifies |
|---|---|
| `Card System.dc.html` | The Paper & Pin card language: seed-packet anatomy with labelled parts, the five rarity plates side by side, the level-up deal in situ, the shop variant. |
| `Upgrade Card.dc.html` | The card itself as a component. Every other page mounts this one. |
| `Home Screen.dc.html` | Title screen — the yard at dusk, class rail, selected-class sheet, the barn doors as the Homestead entrance. Two scene variants. |
| `Class Card.dc.html` | One class packet, including the nailed-shut locked state. |
| `Upgrade Roster.dc.html` | All 56 upgrades rendered as real cards, grouped by source and tier, plus the engineering-cost panels. |
| `Game Screens.dc.html` | HUD in play, pause, results, the Homestead yard, and the purchase grid. |

## What to read them for

**Layout, spacing, motion timing and colour.** Every value is a literal in the
markup — no CSS variables, no classes, no indirection. If you want the exact
plate gradient or the exact deal stagger, it is written inline where it is used.

`../DESIGN_LANGUAGE.md` is the distilled version: the same numbers as a spec,
without the mockup scaffolding. Prefer it for implementation. Come here when you
want to see the thing working, or when the spec is ambiguous about something
visual.

## What NOT to copy

- **The `<x-dc>` / `dc-import` / `sc-for` machinery.** That is this authoring
  environment's template runtime, not a suggestion for the game. The game is
  plain DOM built in TypeScript — `src/ui/dom.ts`'s `el()` helper is the right
  tool.
- **`support.js`.** Runtime for the above. Never ships.
- **Inline styles as an approach.** They are inline here because it makes the
  mockup readable as a single artefact. In the game, this belongs in
  `style.css` — see `DESIGN_LANGUAGE.md` for the intended class structure.
- **The placeholder numbers.** Wave 14, 248 feed, 2,617 kills, the stat deltas
  on cards not in `items.json`. All illustrative. Real values come from the JSON.

## Fonts

Three Google Fonts, loaded from CDN in each page's `<helmet>`:

- **Rye** — display. Card names, screen titles, big numbers.
- **Silkscreen** — pixel UI. Labels, plates, tags, buttons. Never body copy.
- **IBM Plex Mono** — body and stat rows.

For the game, self-host all three rather than hitting the CDN. Rye and Silkscreen
are the identity; Plex Mono is replaceable with any clean mono if licensing is
easier.

## Known placeholder art in these pages

- Enemy sprites in the HUD are **recoloured livestock** standing in for real
  infected art. `art/enemy/` has the first generated infected farmhand.
- Two of four Homestead building signs borrow item icons.
- Four of six class portraits reuse the two shipped farmer sheets. The other two
  need `npm run characters`.

All flagged in the pages themselves, in the amber "still open" panels.
