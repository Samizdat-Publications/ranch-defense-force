/**
 * Every asset on the PixelLab account, and what the game does with it.
 *
 *     npm run ledger            # writes docs/PIXELLAB_LEDGER.md
 *
 * ## Why this exists, and why it is not `npm run inventory`
 *
 * `docs/PIXELLAB_INVENTORY.md` answers "what does the account hold", which is
 * the question that stops a session generating a barn it already owns. It says
 * nothing about whether the barn is on screen, and that is the OTHER failure
 * this project repeats: session 18 found the barn, farmhouse, silo, coop,
 * windmill and well already paid for; session 22 found four blighted scarecrow
 * candidates and seven item cards pointing at stand-ins while their own icons
 * sat packed. Every one of those was in the inventory the whole time. Being
 * listed is not being used.
 *
 * The owner's rule, 2026-09-03: whatever is generated gets claimed, packed and
 * wired, or retired with a written reason. This is the file that makes that
 * checkable. Every row ends in exactly one state, and there is no fourth:
 *
 *   wired          the art is packed AND something draws its key
 *   packed-unused  packed in the atlas, drawn by nothing  -> a job, not a state
 *   unclaimed      on the account, never downloaded into assets/
 *   review         a candidate pack nobody picked from (already paid for)
 *   retired        tagged rdf-retired on the account, with a reason tag
 *   surplus        another roll of a prompt whose keeper is already wired
 *   open           a real question for the owner; the ledger says which
 *
 * ## How the join is made, and where it is honest about being approximate
 *
 * There is NO object-id anywhere in `art/sprites.json`, and there never has
 * been: the manifest names files, and the files were downloaded by hand across
 * twenty-two sessions. So a row cannot be joined to a sprite key by id.
 *
 * Two joins are exact:
 *   - TILESETS, through `assets/tilesets/*.json`, which carry the PixelLab id
 *     they were recovered from. Id -> file -> `wang.<name>` -> a map's terrain.
 *   - CHARACTERS, through their `rdf-<sheet>` tags, which are the sheet ids in
 *     `art/sprites.json` by construction.
 *
 * The object join is by FAMILY -- the account tag where there is one, the
 * normalised prompt where there is not -- through the table below. A family is
 * the unit that matters anyway: nobody needs to know which of four identical
 * barn rolls is the packed one, they need to know the barn is in the game and
 * three rolls are surplus. Where a family maps to keys, the keys are checked
 * against the built atlas and against every reference in `src/`, so the wired
 * or not verdict IS exact even though the provenance is not.
 *
 * KEEP THE TABLE UP TO DATE. An unmapped family is reported as `open` and
 * counted at the top, which is the pressure that keeps this file honest: a
 * generation run that adds a family and no table row makes the open count go
 * up, in a committed document, on the next refresh.
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

interface Asset {
  id: string
  name?: string
  prompt?: string
  size?: { width: number; height: number }
  directions?: number
  n_animations?: number
  tags?: string[]
  status?: string
  created_at?: string
}
interface Inventory {
  taken: string
  objects: Asset[]
  characters: Asset[]
  tilesets: Asset[]
}

const inv = JSON.parse(readFileSync('docs/pixellab-inventory.json', 'utf8')) as Inventory

/* ------------------------------------------------------------ what is packed */

let packed = new Set<string>()
let atlasNote = ''
try {
  const atlas = JSON.parse(readFileSync('public/atlas.json', 'utf8')) as
    { frames: Record<string, unknown>; pages: unknown[] }
  packed = new Set(Object.keys(atlas.frames))
  atlasNote = `${Object.keys(atlas.frames).length} frames on ${atlas.pages.length} pages`
} catch {
  atlasNote = 'NOT BUILT — run `npm run atlas` and refresh; every row will read unclaimed'
}

/**
 * A frame key, with the clip and direction stripped off.
 *
 * `farmhandBlight.walk.left.3` and `crop.corn.0` are both a NAME plus some
 * trailing structure, and the manifest, the content and the ledger all talk
 * about the name. Trailing integers go, then a clip and a direction if what is
 * left still has three or more segments.
 */
function spriteName(key: string): string {
  const parts = key.split('.')
  let n = parts.length
  while (n > 1 && /^\d+$/.test(parts[n - 1]!)) n--
  return n >= 3 ? parts.slice(0, n - 2).join('.') : parts.slice(0, n).join('.')
}
const packedNames = new Set([...packed].map(spriteName))

/* ------------------------------------------------- what the game actually draws */

const sources: string[] = []
function walk(dir: string): void {
  let entries: string[]
  try { entries = readdirSync(dir) } catch { return }
  for (const e of entries) {
    if (e === 'node_modules' || e === '.git' || e === '.claude' || e === 'dist') continue
    const p = join(dir, e)
    if (statSync(p).isDirectory()) walk(p)
    else if (/[.](ts|tsx|json|css|html)$/.test(e) && !p.includes('atlas.json')
      && !p.includes('pixellab-inventory.json')) sources.push(readFileSync(p, 'utf8'))
  }
}
for (const d of ['src', 'tools', 'tests']) walk(d)
const code = sources.join('\n')

/**
 * True when something in the repo names this sprite.
 *
 * A substring search, deliberately. Keys are assembled at runtime in half a
 * dozen places -- `${sheet}.${clip}.${dir}.${i}` in the renderer, `item.${icon}`
 * in the content layer -- so an exact-token match would report most of the
 * atlas as dead. The failure mode of a substring search is a FALSE WIRED, and
 * the names here are distinctive enough (`ranch.hayWagon`, `cave.stalactite0`)
 * that it does not happen in practice. It is also the safe direction to be
 * wrong in for a document whose job is to find UNUSED art: it under-reports
 * work to do rather than inventing it.
 */
const drawn = (name: string): boolean => code.includes(name)

/* ------------------------------------------------------------- the family map */

interface Fam {
  /** Sprite names the family produced. Empty means nothing was ever packed. */
  keys: string[]
  /** Where it ends up, in words, for the row's decision column. */
  note: string
  /** Force a verdict the key check cannot reach. */
  verdict?: 'open' | 'retired' | 'surplus'
}

/** Account tags -> what they became. One row per tag the account carries. */
const BY_TAG: Record<string, Fam> = {
  'rdf-carry': { keys: ['carry'], note: 'the six carried firearms; also their card art since this audit' },
  'rdf-carry-retired': { keys: [], note: 'session 22 rerolls, reasons already tagged', verdict: 'retired' },

  'rdf-crop-corn': { keys: ['crop.corn'], note: 'harvestable crop' },
  'rdf-crop-wheat': { keys: ['crop.wheat'], note: 'harvestable crop' },
  'rdf-crop-pumpkin': { keys: ['crop.pumpkin'], note: 'harvestable crop' },
  'rdf-crop-cabbage': { keys: ['crop.cabbage'], note: 'harvestable crop' },
  'rdf-crop-pumpkin-rot': { keys: ['crop.pumpkinRot'], note: 'blighted crop variant' },
  'rdf-crop-cabbage-rot': { keys: ['crop.cabbageRot'], note: 'blighted crop variant' },

  'rdf-prop-plough': { keys: ['prop.plough'], note: 'field scenery fixture' },
  'rdf-prop-carcass': { keys: ['prop.carcass'], note: 'field scenery fixture' },
  'rdf-prop-gravemarker': { keys: ['prop.graveMarker'], note: 'field scenery fixture' },
  'rdf-prop-stump': { keys: ['prop.treeStump'], note: 'field scenery fixture' },
  'rdf-prop-splitrail': { keys: ['prop.fenceRail', 'prop.fencePost'], note: 'field scenery fixture' },
  'rdf-prop-handpump': { keys: [], note: 'no hand pump was ever packed; nothing in maps.json asks for one' },

  'rdf-break-oildrum': { keys: ['prop.oilDrum'], note: 'breakables.json class' },
  'rdf-break-burnbarrel': { keys: ['prop.burnBarrel'], note: 'breakables.json class' },
  'rdf-break-milkcans': { keys: ['prop.milkCans'], note: 'breakables.json class' },
  'rdf-break-feedbin': { keys: ['prop.feedBin'], note: 'breakables.json class' },
  'rdf-break-haybale': { keys: ['prop.hayBale'], note: 'breakables.json class' },
  'rdf-break-haybale-round': { keys: ['prop.hayBaleRotted'], note: 'breakables.json class' },
  'rdf-break-trough': { keys: ['prop.trough'], note: 'breakables.json class' },
  'rdf-break-trough2': { keys: ['prop.troughFouled'], note: 'breakables.json class' },
  'rdf-break-logpile': { keys: ['prop.logPile'], note: 'breakables.json class' },
  'rdf-break-wheelbarrow': { keys: ['prop.wheelbarrow'], note: 'breakables.json class' },
  'rdf-break-bonepile': { keys: ['prop.bonePile'], note: 'breakables.json class' },
  'rdf-break-crate': { keys: [], note: 'no crate class exists; breakables.json has eleven and none is a crate' },

  'rdf-base-tank': { keys: ['base.tank0', 'base.tank1', 'base.tank2', 'base.tank3', 'base.tank4'], note: 'bunker dressing, theVault and theLift' },
  'rdf-base-lift': { keys: ['base.lift0', 'base.lift1', 'base.lift2', 'base.lift3', 'base.lift4'], note: 'bunker dressing and the lab scene' },
  'rdf-base-blastdoor': { keys: ['base.blastDoor0', 'base.blastDoor5'], note: 'the level exit, and the lab scene wall' },

  'rdf-overhead-branches': { keys: ['cave.branches0', 'cave.branches1', 'cave.branches2', 'cave.branches3', 'cave.branches4', 'cave.branches5', 'cave.branches6'], note: 'boneOrchard overhead layer, and the roots in the descent' },
  'rdf-cave-stalactite': { keys: ['cave.stalactite0', 'cave.stalactite1', 'cave.stalactite2', 'cave.stalactite3', 'cave.stalactite4', 'cave.stalactite5'], note: 'strata hanging in the descent column (wired by this audit)' },
  'rdf-cave-web': { keys: ['cave.web0', 'cave.web1', 'cave.web3', 'cave.web4', 'cave.web5'], note: 'OPEN: five webs packed and drawn by nothing. sprites.json says they are corner-anchored and NOT overhead art -- they belong ON something, as webbed breakable variants, and no webbed variant art exists. Recommend compositing one web over prop.crate and prop.oilDrum offline (free) rather than generating', verdict: 'open' },

  'rdf-scene-barn': { keys: ['ranch.barn'], note: 'title screen, both surface scenes' },
  'rdf-scene-farmhouse': { keys: ['ranch.farmhouse'], note: 'title screen' },
  'rdf-scene-silo': { keys: ['ranch.silo'], note: 'title screen' },
  'rdf-scene-coop': { keys: ['ranch.coop'], note: 'title screen' },
  'rdf-scene-windmill': { keys: ['windmill'], note: 'title screen, animated (sceneClips)' },
  'rdf-scene-well': { keys: ['ranch.well', 'ranch.wellStone'], note: 'title screen' },
  'rdf-scene-bunkhouse': { keys: ['ranch.bunkhouse'], note: 'title screen' },
  'rdf-scene-haywagon': { keys: ['ranch.hayWagon'], note: 'field dressing (wired by this audit)' },
  'rdf-scene-tractor-rusted': { keys: ['ranch.tractor', 'ranch.tractorRed'], note: 'title screen, and field dressing (wired by this audit)' },
  'rdf-scene-cropduster': { keys: ['ranch.biplane', 'duster'], note: 'the Duster boss is animated from its own sheet; ranch.biplane is the still' },
  'rdf-scene-scarecrow': { keys: ['scarecrow'], note: 'title screen, animated sway' },
  'rdf-scene-scarecrow-wrong': { keys: ['scarecrowBlight'], note: 'the blighted scarecrow (wired by this audit; three rolls retired)' },
  'rdf-scene-cattlechute': { keys: [], note: 'OPEN: never downloaded, and no scene or map asks for a cattle chute', verdict: 'open' },
  'rdf-silo-ruined': { keys: [], note: 'OPEN: never downloaded; ranch.silo is the one the scenes use', verdict: 'open' },
  'rdf-tree-orchard': { keys: ['nodeTree', 'node.tree'], note: 'orchard trees' },
  'rdf-tree-charred': { keys: ['node.treeCharred', 'node.treeDead'], note: 'burnt-map trees' },
  'rdf-magnet': { keys: ['pickup'], note: 'the magnet pickup' },

  /*
     NOT THIS AUDIT'S. Both smudge-pot objects were created 2026-09-04T00:09 and
     00:19 UTC, while this audit was running and after its own snapshot was
     taken -- another session generating into the same account, which CLAUDE.md
     warns about for the repo and which turns out to be just as true here. The
     row exists so the count is honest and the next refresh does not read them
     as an unexplained gap; whoever generated them owns wiring them.
  */
  'rdf-weapon-smudgepot': { keys: ['weapon.smudgePot'], note: 'OPEN: generated by ANOTHER SESSION during this audit (2026-09-04T00:19Z); not wired, and not this audit\'s to wire', verdict: 'open' },
}

/**
 * Untagged families -> what they became, keyed by a distinctive prompt fragment.
 *
 * Longest match wins, so a specific fragment can override a general one.
 */
const BY_PROMPT: [string, Fam][] = [
  // -- the lab and the bunker, all of it drawn by src/ui/scene.ts or maps.json
  ['laboratory control consoles', { keys: ['vault.labConsole', 'labConsole'], note: 'lab scene, animated flicker' }],
  ['glass tank of glowing green', { keys: ['tankSwirl', 'tankPanel', 'tankBarrel', 'tankVat'], note: 'lab scene, animated fluid loops' }],
  ['cracked cylindrical glass tank', { keys: ['vault.vatBroken'], note: 'lab scene' }],
  ['glass containment vat', { keys: ['vault.vatAlien', 'vault.vatSpecimen', 'vatSpecimen'], note: 'lab scene; the specimen tube animates, the alien vat is a still' }],
  ['column of small round rising bubble', { keys: ['vatSpecimen'], note: 'lab scene, the specimen tube loop' }],
  ['shelving rack of laboratory specimen j', { keys: ['vault.jarRack'], note: 'lab scene' }],
  ['examination table', { keys: ['vault.examTable'], note: 'lab scene' }],
  ['laboratory bench covered in glass', { keys: ['base.labBench'], note: 'lab scene and bunker dressing' }],
  ['laboratory workbench with beakers', { keys: ['base.labBench'], note: 'lab scene and bunker dressing' }],
  ['stack of rusted steel drums piled', { keys: ['vault.drumStack'], note: 'lab scene' }],
  ['group of six rusted steel drums', { keys: ['vault.drumScatter'], note: 'lab scene' }],
  ['rank of eight rusted steel drums', { keys: ['vault.drumRank'], note: 'lab scene' }],
  ['split rusted steel drum', { keys: ['vault.drumWeeping'], note: 'lab scene (wired by this audit)' }],
  ['steel floor grate', { keys: ['vault.floorGrate'], note: 'lab scene' }],
  ['steel ladder bolted', { keys: ['ranch.barnLadder'], note: 'OPEN: packed, no barn interior exists to hang it in', verdict: 'open' }],
  ['concrete bunker wall', { keys: ['base.wallPipes', 'base.wallHazard', 'base.wallVent', 'base.wallStencil', 'base.wallLamp', 'base.wallPlain'], note: 'bunker boundary panels and the lab wall' }],
  ['poured concrete wall seen from', { keys: ['terrain.concrete'], note: 'bunker ground' }],
  ['air duct', { keys: ['base.ceilingDuct'], note: 'bunker overhead layer' }],
  ['pipes and cable trays', { keys: ['base.ceilingPipes'], note: 'bunker overhead layer' }],
  ['bundle of rusted steel pipes', { keys: ['base.ceilingPipes'], note: 'bunker overhead layer' }],
  ['fluorescent ceiling light', { keys: ['base.striplightLit', 'base.striplightDead'], note: 'bunker overhead layer and the lab ceiling' }],
  ['server rack', { keys: ['base.serverRack'], note: 'bunker dressing' }],
  ['steel lockers', { keys: ['base.lockers'], note: 'bunker dressing' }],
  ['pallet stacked with crates', { keys: ['base.cratePallet'], note: 'bunker dressing' }],
  ['filing cabinet', { keys: ['base.filingSpill'], note: 'bunker dressing' }],
  ['ceiling rubble', { keys: ['base.rubble'], note: 'bunker dressing' }],
  ['cable spool', { keys: ['base.cableSpool'], note: 'bunker dressing' }],
  ['pallet jack', { keys: ['base.palletJack'], note: 'bunker dressing' }],
  ['warning sign', { keys: ['base.warningSign'], note: 'bunker dressing and the lab wall' }],
  ['eyewash', { keys: ['base.latrine'], note: 'bunker dressing' }],
  ['hospital trolley', { keys: ['base.medChair'], note: 'bunker dressing' }],

  // -- the title screen's farm
  ['weathered red wooden barn', { keys: ['ranch.barn', 'scene.barn'], note: 'title screen' }],
  ['clapboard farmhouse', { keys: ['ranch.farmhouse', 'scene.house'], note: 'title screen' }],
  ['corrugated metal grain silo', { keys: ['ranch.silo', 'scene.silo'], note: 'title screen' }],
  ['chicken coop on stilts', { keys: ['ranch.coop', 'scene.coop'], note: 'title screen' }],
  ['fieldstone water well', { keys: ['ranch.well', 'ranch.wellStone'], note: 'title screen' }],
  ['straw scarecrow on a wooden cross', { keys: ['scarecrow', 'scene.scarecrow'], note: 'title screen, animated sway' }],
  ['old farm tractor seen from the side', { keys: ['ranch.tractor', 'scene.tractorLeft'], note: 'title screen, and the field scene tractor' }],
  ['broad old oak tree', { keys: ['scene.oak', 'scene.treeOak'], note: 'title screen' }],
  ['dead leafless sapling', { keys: ['node.treeDead'], note: 'blighted map trees' }],
  ['huge dead leafless oak', { keys: ['scene.treeOak'], note: 'title screen' }],
  ['dying tree', { keys: ['node.treeCharred'], note: 'burnt-map trees' }],
  ['dead tree snapped off', { keys: ['node.treeCharred'], note: 'burnt-map trees' }],
  ['wall of distant trees', { keys: ['sceneBg.treeline'], note: 'title screen horizon (the corn wall is the default; this is the alternative)' }],
  ['strip of distant treeline', { keys: ['sceneBg.treeline'], note: 'title screen horizon alternative' }],
  ['wall of tall ripe corn', { keys: ['sceneBg.cornWall'], note: 'title screen horizon' }],
  ['dog kennel', { keys: ['ranch.doghouse', 'scene.doghouse'], note: 'title screen yard' }],
  ['wooden kennel doghouse', { keys: ['ranch.doghouse', 'scene.doghouse'], note: 'title screen yard' }],
  ['straw bedding with a wooden nesting', { keys: ['ranch.nest', 'scene.nest'], note: 'title screen yard' }],
  ['nest box', { keys: ['ranch.nestBox', 'scene.nest'], note: 'title screen yard' }],
  ['clutch of seven chicken eggs', { keys: ['ranch.eggs'], note: 'title screen yard' }],
  ['section of split rail wooden fence', { keys: ['ranch.fenceRail', 'scene.fenceRail'], note: 'field dressing (wired by this audit) and the title screen' }],
  ['timber post and rail fence', { keys: ['ranch.fenceRun', 'ranch.fenceRail', 'ranch.fenceCorner'], note: 'field dressing (wired by this audit)' }],
  ['timber fencing', { keys: ['ranch.fencePost', 'ranch.fenceCornerPost'], note: 'field dressing (wired by this audit)' }],
  ['timber fence corner post', { keys: ['ranch.fenceCornerPost'], note: 'field dressing (wired by this audit)' }],
  ['collapsed section of timber post', { keys: ['ranch.fenceBroken', 'ranch.fenceRailBroken'], note: 'field dressing (wired by this audit)' }],
  ['timber farm gate standing open', { keys: ['ranch.gateOpen'], note: 'field dressing (wired by this audit)' }],
  ['closed timber farm gate', { keys: ['ranch.gateClosed'], note: 'OPEN: packed, drawn by nothing; gateOpen took the dressing slot', verdict: 'open' }],
  ['livestock pen gate', { keys: [], note: 'a PIECE of a pen; superseded by the pen.* whole enclosures', verdict: 'retired' }],
  ['livestock pen fence', { keys: [], note: 'a PIECE of a pen; superseded by the pen.* whole enclosures', verdict: 'retired' }],
  ['paddock enclosed by', { keys: ['pen.paddockDirt', 'pen.paddockGrass', 'pen.paddockFlat', 'pen.paddockV3'], note: 'OPEN: four complete paddocks packed, no scene stands anything in one', verdict: 'open' }],
  ['chicken run enclosed by', { keys: ['pen.chickenRunDirt', 'pen.chickenRunGreen', 'pen.chickenRunFlat', 'pen.chickenRunV3'], note: 'OPEN: four complete runs packed, no scene stands anything in one', verdict: 'open' }],
  ['horse stall', { keys: ['ranch.stallFront', 'ranch.stallFrontBroken', 'ranch.stallDivider'], note: 'OPEN: barn interior, and no barn interior exists', verdict: 'open' }],
  ['stall divider', { keys: ['ranch.stallDivider'], note: 'OPEN: barn interior, and no barn interior exists', verdict: 'open' }],
  ['barn hay loft', { keys: ['ranch.loftEdge'], note: 'OPEN: barn interior, and no barn interior exists', verdict: 'open' }],
  ['barn lantern', { keys: ['ranch.barnLantern', 'ranch.barnLanternDark'], note: 'OPEN: barn interior, and no barn interior exists', verdict: 'open' }],
  ['patch of barn floor', { keys: ['ranch.barnFloor'], note: 'OPEN: barn interior, and no barn interior exists', verdict: 'open' }],
  ['horse manure', { keys: ['ranch.muckTracks'], note: 'field decal (wired by this audit)' }],
  ['hay ring feeder', { keys: ['ranch.roundBale', 'ranch.roundBaleRotted'], note: 'title screen, and a breakable skin (wired by this audit)' }],
  ['galvanised steel water trough', { keys: ['ranch.waterTrough'], note: 'breakable skin on the trough class (wired by this audit)' }],
  ['long wooden water trough', { keys: ['prop.trough', 'ranch.waterTrough'], note: 'breakables.json trough class' }],
  ['stacked rectangular straw hay bales', { keys: ['ranch.squareBales'], note: 'title screen' }],
  ['dented steel milk churn', { keys: ['prop.milkCans', 'scene.milkcan'], note: 'breakables.json milkCans class' }],
  ['irrigation pipe', { keys: [], note: 'OPEN: still in review, never claimed; nothing asks for one', verdict: 'open' }],
  ['tool shed', { keys: [], note: 'OPEN: still in review, never claimed; nothing asks for one', verdict: 'open' }],
  ['wooden signpost', { keys: ['scene.signCow'], note: 'OPEN: LimeZu sign packed and unused; these were never downloaded', verdict: 'open' }],

  // -- the farm's animals, all of them enemies or title-screen residents
  ['crop duster', { keys: ['duster'], note: 'the Duster boss, its own animated sheet' }],
  ['proud rooster', { keys: ['rooster', 'farmRooster'], note: 'enemy sheet and the yard' }],
  ['farmyard rooster', { keys: ['farmRooster'], note: 'the yard' }],
  ['plymouth rock hen', { keys: ['barredHen', 'barredHenBlight'], note: 'the yard, and its blighted twin' }],
  ['leghorn hen', { keys: ['leghornHen', 'leghornHenBlight'], note: 'the yard, and its blighted twin' }],
  ['polish crested chicken', { keys: ['polishHen', 'polishHenBlight'], note: 'the yard, and its blighted twin' }],
  ['silkie chicken', { keys: ['silkieHen', 'silkieHenBlight'], note: 'the yard, and its blighted twin' }],
  ['bantam hen', { keys: ['bantamHen', 'bantamHenBlight'], note: 'the yard, and its blighted twin' }],
  ['orpington hen', { keys: ['buffHen', 'buffHenBlight'], note: 'the yard, and its blighted twin' }],
  ['ameraucana hen', { keys: ['beardedHen', 'beardedHenBlight'], note: 'the yard, and its blighted twin' }],
  ['brahma hen', { keys: ['brahmaHen', 'brahmaHenBlight'], note: 'the yard, and its blighted twin' }],
  ['english bulldog', { keys: ['joy', 'joyBlight'], note: 'Joy, in the yard, and her blighted twin' }],
  ['siamese cat', { keys: ['siameseCat', 'siameseCatBlight'], note: 'the yard, and its blighted twin' }],
  ['tabby cat', { keys: ['tabbyCat', 'tabbyCatBlight'], note: 'the yard, and its blighted twin' }],
  ['black domestic cat', { keys: ['wiz', 'wizBlight', 'ouiji', 'ouijiBlight'], note: 'Wiz and Ouiji in the yard, and their blighted twins' }],
  ['stocky donkey', { keys: ['rosie', 'rosieBlight'], note: 'Rosie, in the yard, and her blighted twin' }],
  ['grey donkey', { keys: ['donkeyCursed'], note: 'enemy sheet' }],
  ['beige draft mule', { keys: ['beigeMule', 'beigeMuleBlight'], note: 'the yard, and its blighted twin' }],
  ['black draft mule', { keys: ['blackMule', 'blackMuleBlight', 'draftMuleCursed'], note: 'the yard, its blighted twin, and the cursed enemy' }],
  ['arabian horse', { keys: ['arabian', 'arabianBlight', 'arabianCursed'], note: 'the yard, its blighted twin, and the cursed enemy' }],
  ['fjord pony', { keys: ['fjordPony', 'fjordPonyBlight', 'fjordPonyCursed'], note: 'the yard, its blighted twin, and the cursed enemy' }],
  ['scruffy brown farm dog', { keys: ['barnDog', 'feralDog'], note: 'the Barn Dog summon and the feral dog enemy' }],
  ['brown farm dog sitting', { keys: ['scene.dogIdleStrip', 'joy'], note: 'OPEN: LimeZu dog strips packed and unused since the generated dogs landed', verdict: 'open' }],
  ['diseased rooster', { keys: ['rooster'], note: 'enemy sheet' }],
  ['diseased hen', { keys: ['infectedHen'], note: 'enemy sheet' }],
  ['diseased sheep', { keys: ['blownSheep'], note: 'enemy sheet' }],
  ['bloated diseased pig', { keys: ['sickHog'], note: 'enemy sheet' }],
  ['angry black bull', { keys: ['prizeBull', 'whitacreBull'], note: 'the Prize Bull boss and the Whitacre Bull item' }],
  ['woolly white sheep', { keys: ['scene.sheep', 'scene.sheepGrazeStrip'], note: 'title screen yard' }],
  ['dairy cow', { keys: ['scene.cow', 'scene.cowGrazeStrip'], note: 'title screen yard' }],
  ['brown calf', { keys: ['scene.calf', 'scene.calfGrazeStrip'], note: 'OPEN: packed, no scene places the calf', verdict: 'open' }],
  ['yellow chick', { keys: ['chick', 'scene.chick'], note: 'title screen yard' }],
  ['baby chick', { keys: ['chick'], note: 'title screen yard' }],
  ['duck in flight', { keys: ['duckFlight'], note: 'the flying duck' }],
  ['black crow familiar', { keys: ['weapon.crowBell'], note: 'the Crow Bell weapon' }],
  ['crow perched', { keys: [], note: 'OPEN: still in review, never claimed', verdict: 'open' }],

  // -- items, weapons, pickups
  ['gas mask', { keys: ['item.gasMask', 'gasMaskIcon'], note: 'the Iron Lung item card' }],
  ['jar of red medicine', { keys: ['item.healthJar', 'pickup.heal'], note: 'the health pickup' }],
  ['sack of loose grain', { keys: ['item.feedSack', 'pickup.xp'], note: 'the Feed Sack item and the feed pickup' }],
  ['framing hammer', { keys: ['weapon.framingHammer'], note: 'OPEN: packed weapon icon, no weapon owns it -- HOLD for docs/UPGRADE_ROSTER.md, which designs six new Loads and says to grep the account before generating icons', verdict: 'open' }],
  ['bucket slopping', { keys: ['weapon.slopBucket'], note: 'OPEN: packed; freed by this audit when keroseneCan took its own icon', verdict: 'open' }],
  ['chicken egg', { keys: ['weapon.eggToss'], note: 'OPEN: packed weapon icon, no weapon owns it -- HOLD for docs/UPGRADE_ROSTER.md, which designs six new Loads and says to grep the account before generating icons', verdict: 'open' }],
  ['dried red chilies', { keys: ['weapon.chiliShot'], note: 'OPEN: packed weapon icon, no weapon owns it -- HOLD for docs/UPGRADE_ROSTER.md, which designs six new Loads and says to grep the account before generating icons', verdict: 'open' }],
  ['watermelon held as a throwing', { keys: ['weapon.melonLob'], note: 'OPEN: packed weapon icon, no weapon owns it -- HOLD for docs/UPGRADE_ROSTER.md, which designs six new Loads and says to grep the account before generating icons', verdict: 'open' }],
  ['digging shovel', { keys: ['weapon.shovel'], note: 'OPEN: packed weapon icon, no weapon owns it -- HOLD for docs/UPGRADE_ROSTER.md, which designs six new Loads and says to grep the account before generating icons', verdict: 'open' }],
  ['seed blower tube', { keys: ['weapon.seedSpitter'], note: 'OPEN: packed; freed by this audit when slingBands took its own icon', verdict: 'open' }],
  ['brass blowpipe', { keys: ['weapon.seedSpitter'], note: 'OPEN: packed, drawn by nothing since this audit', verdict: 'open' }],
  ['horseshoe magnet', { keys: ['pickup.magnet', 'item.magnet'], note: 'the magnet pickup' }],
  ['fireball projectile', { keys: ['proj.fireball'], note: 'projectile art' }],
  ['fireball explosion', { keys: ['fx.explosion'], note: 'the explosion FX clip' }],
  ['slashing blade trail', { keys: ['fx.slash'], note: 'the slash FX clip' }],
  // The card's tin plate, its art window and the panel behind both are CSS --
  // `src/ui/card.css` draws them, and `tools/build-atlas.ts` writes the one
  // nine-slice the UI does use (`public/ui/plate.png`). These twenty-two rolls
  // predate that decision and nothing can reach them.
  ['name plate', { keys: [], note: 'the card plate is CSS (card.css) over a generated nine-slice; a per-card plate sprite was never the design', verdict: 'retired' }],
  ['nameplate', { keys: [], note: 'the card plate is CSS (card.css) over a generated nine-slice', verdict: 'retired' }],
  ['steel plaque', { keys: [], note: 'the card plate is CSS (card.css) over a generated nine-slice', verdict: 'retired' }],
  ['banner plate', { keys: [], note: 'the card plate is CSS (card.css) over a generated nine-slice', verdict: 'retired' }],
  ['tin sign blank', { keys: [], note: 'the card plate is CSS (card.css) over a generated nine-slice', verdict: 'retired' }],
  ['gunmetal bar', { keys: [], note: 'the card plate is CSS (card.css) over a generated nine-slice', verdict: 'retired' }],
  ['steel plate with chamfered', { keys: [], note: 'the card plate is CSS (card.css) over a generated nine-slice', verdict: 'retired' }],
  ['galvanised metal strip', { keys: [], note: 'the card plate is CSS (card.css) over a generated nine-slice', verdict: 'retired' }],
  ['picture frame border', { keys: [], note: 'the card art window is CSS (.pcard-window); a drawn frame would fight the plate above it', verdict: 'retired' }],
  ['carved wooden interface panel', { keys: [], note: 'public/ui/panel.png is generated by the atlas tool from the UI pack; this is a second answer to a solved question', verdict: 'retired' }],
  ['stamped steel pip', { keys: [], note: 'rank pips are CSS (.pcard-pip); one 32px sprite per pip would not survive the plate scale', verdict: 'retired' }],

  // -- nodes and ground
  ['boulder', { keys: ['node.rockBig', 'node.rockMedium', 'node.oreSilver', 'node.oreGold', 'node.crystal'], note: 'harvest nodes' }],
  ['grey rock', { keys: ['node.rockMedium', 'node.rockSmall'], note: 'harvest nodes' }],
  ['grey stone', { keys: ['node.rockSmall'], note: 'harvest nodes' }],
  ['salt crystal', { keys: ['node.crystal'], note: 'harvest node' }],
  ['scrap metal', { keys: ['node.scrap'], note: 'harvest node' }],
  ['bleached animal bones', { keys: ['prop.bonePile'], note: 'breakables.json bonePile class' }],
  ['burnt hollow tree stump', { keys: ['prop.treeStump'], note: 'field scenery fixture' }],
  ['puddle of thick wet brown mud', { keys: ['decal.mud', 'hazard.mud'], note: 'ground decal and the mud hazard' }],
  ['churned mud', { keys: ['hazard.mud'], note: 'the mud hazard' }],
  ['burning ground', { keys: ['hazard.fire'], note: 'the fire hazard' }],
  ['green gas hanging', { keys: ['hazard.gas', 'fx.gas'], note: 'the gas hazard and the gas FX clip' }],
  ['rusted steel oil drum', { keys: ['prop.oilDrum'], note: 'breakables.json oilDrum class' }],

  // -- crops
  ['ripe corn stalk', { keys: ['crop.corn'], note: 'harvestable crop' }],
  ['withered dead corn', { keys: ['crop.cornRot'], note: 'blighted crop' }],
  ['corn stalks rotted', { keys: ['crop.cornRot'], note: 'blighted crop' }],
  ['ripe golden wheat', { keys: ['crop.wheat'], note: 'harvestable crop' }],
  ['rotted blackened wheat', { keys: ['crop.wheatRot'], note: 'blighted crop' }],
  ['wheat turned filthy', { keys: ['crop.wheatRot'], note: 'blighted crop' }],
  ['orange pumpkin', { keys: ['crop.pumpkin'], note: 'harvestable crop' }],
  ['rotting pumpkin', { keys: ['crop.pumpkinRot'], note: 'blighted crop' }],
  ['rotten collapsed pumpkin', { keys: ['crop.pumpkinRot'], note: 'blighted crop' }],
  ['cabbage head', { keys: ['crop.cabbage', 'crop.cabbageRot'], note: 'harvestable crop and its blighted twin' }],
  ['rotted slimy cabbage', { keys: ['crop.cabbageRot'], note: 'blighted crop' }],
  ['tomato plant', { keys: ['crop.tomato', 'crop.tomatoRot'], note: 'harvestable crop and its blighted twin' }],
  ['strawberry plant', { keys: ['crop.strawberry'], note: 'harvestable crop' }],
  ['chili plant', { keys: ['crop.chili'], note: 'harvestable crop' }],
  ['zucchini', { keys: ['crop.zucchini'], note: 'harvestable crop' }],
  ['cauliflower', { keys: ['crop.cauliflower'], note: 'harvestable crop' }],
  ['watermelon', { keys: ['crop.melon'], note: 'harvestable crop' }],

  // -- review-status packs, none of them claimed
  ['glowing green seed', { keys: [], note: 'OPEN: review pack, never picked from', verdict: 'open' }],
  ['sack of grain', { keys: [], note: 'OPEN: review pack, never picked from', verdict: 'open' }],
  ['motion lines', { keys: [], note: 'OPEN: review pack, never picked from', verdict: 'open' }],
  ['kicked-up dirt', { keys: [], note: 'OPEN: review pack, never picked from', verdict: 'open' }],
  ['scorch mark', { keys: ['decal.scorch'], note: 'OPEN: review pack; decal.scorch is already packed and drawn', verdict: 'open' }],
  ['tyre ruts', { keys: ['decal.tireRuts'], note: 'OPEN: review pack; decal.tireRuts is already packed and drawn', verdict: 'open' }],
  ['coil of rusted barbed wire', { keys: ['prop.barbedWire', 'item.barbedWire'], note: 'OPEN: review pack; both barbed-wire sprites are already packed and drawn', verdict: 'open' }],
  ['heap of cold grey ash', { keys: ['decal.ash'], note: 'OPEN: review pack; decal.ash is already packed and drawn', verdict: 'open' }],
  ['cattails', { keys: [], note: 'OPEN: review pack; no water map exists', verdict: 'open' }],
  ['water reeds', { keys: [], note: 'OPEN: review pack; no water map exists', verdict: 'open' }],
  ['apple tree', { keys: [], note: 'OPEN: review pack, never picked from', verdict: 'open' }],
  ['golden light', { keys: ['fx.heal'], note: 'OPEN: review pack; the heal FX is already packed', verdict: 'open' }],
  ['warm golden glow', { keys: ['fx.heal'], note: 'OPEN: review pack; the heal FX is already packed', verdict: 'open' }],
  ['orange sparks', { keys: ['fx.impact'], note: 'OPEN: review pack; the impact FX is already packed', verdict: 'open' }],
  ['puff of pale dust', { keys: ['fx.dust'], note: 'OPEN: review pack; the dust FX is already packed', verdict: 'open' }],
  ['muzzle flash', { keys: ['fx.muzzle'], note: 'OPEN: review pack; the muzzle FX is already packed', verdict: 'open' }],
  ['five bar farm gate', { keys: ['prop.gate'], note: 'OPEN: review pack; prop.gate is already packed and drawn', verdict: 'open' }],
  ['puddle of grey-brown mud', { keys: ['decal.mud'], note: 'OPEN: review pack; decal.mud is already packed and drawn', verdict: 'open' }],
  ['splatter stain', { keys: ['decal.blood'], note: 'OPEN: review pack, never picked from', verdict: 'open' }],
  ['burst of dust and debris', { keys: ['fx.dust'], note: 'OPEN: review pack; the dust FX is already packed', verdict: 'open' }],
  ['electric blue lightning', { keys: ['fx.bolt'], note: 'OPEN: review pack; the bolt FX is already packed', verdict: 'open' }],
  ['yellow-green gas', { keys: ['fx.gas'], note: 'OPEN: review pack; the gas FX is already packed', verdict: 'open' }],
  ['mason jar of dark red preserves', { keys: ['item.healthJar'], note: 'OPEN: review pack; the health jar is already packed', verdict: 'open' }],
  ['burlap pouch of grain', { keys: ['item.feedSack'], note: 'OPEN: review pack; the feed sack is already packed', verdict: 'open' }],
  ['fence post strung with barbed wire', { keys: ['prop.fencePost'], note: 'OPEN: review pack; prop.fencePost is already packed and drawn', verdict: 'open' }],
  ['chicken coop with a ramp', { keys: ['ranch.coop'], note: 'OPEN: review pack; ranch.coop is already packed and drawn', verdict: 'open' }],

  // -- strays from before this project had a naming convention
  ['rowboat', { keys: [], note: 'not this game -- a stray from the first session, before the farm was decided', verdict: 'retired' }],
  ['iron lamp post', { keys: [], note: 'not this game -- a stray from the first session; the yard lights are CSS glows', verdict: 'retired' }],
  ['tree', { keys: ['node.tree'], note: 'an early tree roll, superseded by rdf-tree-orchard', verdict: 'surplus' }],
  ['smudge pot', { keys: [], note: 'OPEN: generated by ANOTHER SESSION during this audit (2026-09-04T00:09Z), still in review; not for this audit to claim', verdict: 'open' }],
]

/**
 * The tags `npm run tag` writes back. Never a family, always a verdict.
 *
 * They have to be filtered out everywhere the family is derived, because the
 * account returns tags in its own order and a verdict tag can sort first. It
 * did: after the first tagging run, `rdf-wired` came back at index 0 on every
 * character and the sheet lookup started reading "wired" as a sheet name.
 */
const MANAGED = /^rdf-(wired|packed-unused|surplus|unclaimed|review|retired|open)$|^ledger-/
const own = (a: Asset): string[] => (a.tags ?? []).filter((t) => !MANAGED.test(t))

function famFor(a: Asset): Fam {
  const tag = own(a).find((t) => BY_TAG[t])
  if (tag) return BY_TAG[tag]!
  const p = (a.prompt ?? a.name ?? '').toLowerCase()
  let best: Fam | null = null
  let bestLen = 0
  for (const [frag, fam] of BY_PROMPT) {
    if (p.includes(frag) && frag.length > bestLen) { best = fam; bestLen = frag.length }
  }
  return best ?? { keys: [], note: 'UNMAPPED — add a row to tools/pixellab-ledger.ts', verdict: 'open' }
}

type Verdict = 'wired' | 'packed-unused' | 'unclaimed' | 'review' | 'retired' | 'surplus' | 'open'

function verdictFor(a: Asset, fam: Fam, seenFamily: boolean): { v: Verdict; where: string } {
  if (own(a).some((t) => t === 'rdf-carry-retired') || (a.tags ?? []).includes('rdf-retired')) {
    const reason = (a.tags ?? []).find((t) => t.startsWith('reason-'))
    return { v: 'retired', where: reason ? reason.replace(/^reason-/, '').replace(/-/g, ' ') : fam.note }
  }
  if (a.status === 'review') return { v: 'review', where: fam.note }
  if (a.status === 'failed') return { v: 'retired', where: 'the generation failed; nothing was produced' }
  if (fam.verdict === 'retired') return { v: 'retired', where: fam.note }
  if (fam.verdict === 'surplus') return { v: 'surplus', where: fam.note }

  /*
     A family key may name a GROUP rather than a sprite.

     `rdf-carry` produced `carry.scattergun`, `carry.harpoon` and four more, and
     the family's key is `carry` -- the thing they have in common. Matching only
     whole names reported the six purpose-drawn firearms as never downloaded on
     the very run after they were wired into every card in the game.
  */
  const packedKeys = fam.keys.filter((k) =>
    packedNames.has(k) || packed.has(k) || [...packedNames].some((n) => n.startsWith(`${k}.`)))
  const drawnKeys = packedKeys.filter(drawn)
  if (fam.verdict === 'open') return { v: 'open', where: fam.note }
  if (!fam.keys.length) return { v: 'unclaimed', where: fam.note }
  if (!packedKeys.length) return { v: 'unclaimed', where: `${fam.note} — nothing packed under ${fam.keys.join(', ')}` }
  if (!drawnKeys.length) return { v: 'packed-unused', where: `${fam.note} — ${packedKeys.join(', ')} packed, drawn by nothing` }
  // The keeper is wired; every further roll of the same prompt is surplus.
  if (seenFamily) return { v: 'surplus', where: `another roll of ${drawnKeys[0]}` }
  return { v: 'wired', where: `${fam.note} (${drawnKeys.join(', ')})` }
}

/* -------------------------------------------------------------- the tilesets */

/** id -> the local set name, read out of the recovered tileset metadata. */
const tilesetById = new Map<string, string>()
for (const f of readdirSync('assets/tilesets').filter((f) => f.endsWith('.json'))) {
  try {
    const t = JSON.parse(readFileSync(`assets/tilesets/${f}`, 'utf8')) as { id?: string; name?: string }
    /*
       The FILENAME, never the sidecar's `name`.

       Fourteen sidecars carry the prompt as their name -- "short green pasture
       grass ↗ dark brown ploughed soil in furrows" -- because that is what the
       API returned. The atlas key is built from the file's basename
       (`wang.grass_to_soil`), and so is the `groundSet` a map asks for, so the
       basename is the only one of the two that joins to anything.
    */
    if (t.id) tilesetById.set(t.id, f.replace(/[.]json$/, ''))
  } catch { /* a malformed sidecar is a missing join, not a crash */ }
}

/* ------------------------------------------------------------------ the write */

const esc = (s: string): string => s.replace(/[|]/g, '\\|').replace(/\n/g, ' ')
const short = (s: string, n = 62): string =>
  (s.length > n ? `${s.slice(0, n - 1)}…` : s).replace(/\s+/g, ' ')

const counts: Record<string, number> = {}
const bump = (v: string): void => { counts[v] = (counts[v] ?? 0) + 1 }

interface Row { id: string; what: string; size: string; v: Verdict; where: string; sort: string }
const objectRows: Row[] = []
const famSeen = new Set<string>()
for (const o of [...inv.objects].sort((a, b) => (a.prompt ?? '').localeCompare(b.prompt ?? ''))) {
  const fam = famFor(o)
  const famKey = (o.tags ?? []).find((t) => BY_TAG[t]) ?? fam.keys.join('+') ?? fam.note
  const seen = famSeen.has(famKey)
  const { v, where } = verdictFor(o, fam, seen)
  if (v === 'wired') famSeen.add(famKey)
  bump(v)
  objectRows.push({
    id: o.id,
    what: short(o.prompt ?? o.name ?? '?'),
    size: `${o.size?.width ?? '?'}x${o.size?.height ?? '?'}`,
    v, where: short(where, 200),
    sort: (o.prompt ?? o.name ?? '').toLowerCase(),
  })
}

/**
 * Character name or tag -> the sheet id it was packed under, where the two
 * differ, plus a written verdict for the ones that were never meant to pack.
 *
 * Most characters carry an `rdf-<sheet>` tag and need no entry. These are the
 * ones that predate the convention or that exist to be an input rather than an
 * output — a style anchor is not unwired art, it is the thing every other
 * character was generated FROM.
 */
const CHAR: Record<string, { sheet?: string; verdict?: Verdict; note?: string }> = {
  'Job': { sheet: 'joy', note: 'Joy, the bulldog, in the title-screen yard' },
  'Fjord Pony': { sheet: 'fjordPony', note: 'the pony in the yard, and its cursed enemy twin' },
  'Arabian': { sheet: 'arabian', note: 'the horse in the yard, and its cursed enemy twin' },
  'Wiz': { sheet: 'wiz', note: 'one of the two cats in the yard' },
  'rdf-farmhand-infected': { sheet: 'farmhandBlight', note: 'the infected farmhand; recoloured by `npm run recolour` and packed under the blighted id' },
  'rdf-hand-anchor': { verdict: 'wired', note: 'STYLE ANCHOR, not a sprite — every generated character was made against it. Being unpacked is correct.' },
  'rdf-hand-anchor-64': { verdict: 'wired', note: 'STYLE ANCHOR at 64px — the input every later character was generated from. Being unpacked is correct.' },
  'warrior woman with orange hair': { verdict: 'retired', note: 'not this game -- three rolls of a fantasy character, from before the roster was six farm classes' },
  'flat shaded light brown bear': { verdict: 'retired', note: 'not this game -- the roster is farm animals turned; a bear is neither farm nor turned' },
  'old man bald': { verdict: 'retired', note: 'predates the roster; The Hand covers the old farmer and is generated against the house anchor' },
  'blonde farmer with long hair and a dress': { verdict: 'retired', note: 'predates the roster; The Widow covers this and is generated against the house anchor' },
  'a farmhand who has gone wrong': { verdict: 'retired', note: 'the superseded 40x40 first pass; `7418d20d` replaced it and NOTES records why' },
}

const charRows: Row[] = inv.characters.map((c) => {
  const tag = own(c)[0] ?? c.name ?? ''
  const name = c.name ?? ''
  const entry = CHAR[tag] ?? CHAR[name]
    ?? Object.entries(CHAR).find(([k]) => name.toLowerCase().startsWith(k.toLowerCase()))?.[1]
  const sheet = entry?.sheet ?? tag.replace(/^rdf-/, '')
  const hit = [...packedNames].find((n) => n.toLowerCase() === sheet.toLowerCase())
  const v: Verdict = entry?.verdict
    ?? (hit && drawn(hit) ? 'wired' : hit ? 'packed-unused' : 'unclaimed')
  bump(v)
  return {
    id: c.id,
    what: short(c.name ?? c.prompt ?? '?'),
    size: `${c.size?.width ?? '?'}x${c.size?.height ?? '?'}`,
    v,
    where: entry?.note ? `${entry.note}${hit ? ` (\`${hit}\`)` : ''}`
      : hit ? `packed as \`${hit}\`` : 'never packed',
    sort: tag,
  }
})

const tileRows: Row[] = inv.tilesets.map((t) => {
  const name = tilesetById.get(t.id)
  const key = name ? `wang.${name}` : ''
  const isPacked = !!name && packedNames.has(key)
  /*
     A ground is asked for by its BARE name, not by its atlas key.

     `maps.json` says `"groundSet": "grass_to_rot"` and `"wangSet":
     "concrete_to_wall"`; the renderer prefixes `wang.` when it looks the frame
     up. Checking only the prefixed key reported twenty-eight grounds as unused
     including the two the bunker's own walls are made of, which is the shape of
     a tool bug rather than a finding.
  */
  const used = !!name && (drawn(key) || drawn(`"${name}"`))
  const v: Verdict = isPacked && used ? 'wired' : isPacked ? 'packed-unused' : 'unclaimed'
  bump(v)
  return {
    id: t.id,
    what: short(t.name ?? t.prompt ?? '?', 74),
    size: '',
    v,
    where: name ? (isPacked ? `\`${key}\`` : `downloaded as ${name}, not packed`) : 'never downloaded',
    sort: name ?? 'zzz',
  }
})

const table = (rows: Row[], sized = true): string => {
  const head = sized
    ? '| id | size | what | state | where it ends up |\n|---|---|---|---|---|'
    : '| id | what | state | where it ends up |\n|---|---|---|---|'
  const body = rows.map((r) => sized
    ? `| \`${r.id.slice(0, 8)}\` | ${r.size} | ${esc(r.what)} | **${r.v}** | ${esc(r.where)} |`
    : `| \`${r.id.slice(0, 8)}\` | ${esc(r.what)} | **${r.v}** | ${esc(r.where)} |`)
  return [head, ...body].join('\n')
}

/* ------------------------------------------ the other direction: dead atlas keys

   The rows above start from the ACCOUNT and ask what draws each asset. This
   asks the opposite question of the ATLAS, and it catches what the first pass
   structurally cannot: art that is packed and dead but never came from PixelLab
   at all -- the bundled LimeZu scene cuts that the generated `ranch.*` family
   replaced, and every key freed up by a card that stopped borrowing a stand-in.
   Same defect, different supplier, and a ledger that only watched the account
   would report the atlas as clean while a fifth of a page sat unread.
*/
const manifest = JSON.parse(readFileSync('art/sprites.json', 'utf8')) as Record<string, unknown>
/**
 * Which block of `art/sprites.json` a packed name came from.
 *
 * Walked rather than pattern-matched: a group's `files` map or its `sheets` map
 * holds the name, and finding it says which supplier and which rule the key
 * lives under -- `scene` is Design's LimeZu cuts, `ranch` is generated, `gun` is
 * the bundled firearm sheet. That is the first thing you want to know about a
 * dead key, because it decides whether the answer is "wire it" or "it was
 * replaced and can go".
 */
function groupOf(name: string): string {
  const root = name.split('.')[0] ?? name
  for (const [group, block] of Object.entries(manifest)) {
    if (group.startsWith('_') || typeof block !== 'object' || block === null) continue
    const b = block as { files?: Record<string, unknown>; sheets?: Record<string, unknown>; clips?: Record<string, unknown> }
    for (const map of [b.files, b.sheets, b.clips]) {
      if (!map) continue
      for (const k of Object.keys(map)) if (k === name || k === root) return group
    }
  }
  return root
}
/**
 * A packed name that nothing in the repo can reach, by any of three routes.
 *
 * The naive check -- is the full name a substring of the source -- reported
 * seventy-four dead keys and most of them were alive. Keys are ASSEMBLED at
 * the call site in this codebase, three ways, and each needs its own question:
 *
 *   `portrait.${classId}`   a template on the group, so ask for `portrait.${`
 *   `stripUrl('tankSwirl')` the SHEET name alone, so ask for the last segment
 *   `"grass_to_rot"`        content naming a set bare, so ask for it quoted
 *
 * Being wrong here is expensive in one direction only: a false DEAD sends the
 * next session hunting for a use that already exists, or worse, deleting art
 * the game draws. All three routes are cheap, so all three are asked.
 */
function reachedBy(name: string): string {
  if (drawn(name)) return 'named'
  const parts = name.split('.')
  const root = parts[0] ?? name
  const last = parts[parts.length - 1] ?? name
  if (code.includes(`${root}.\${`)) return `maybe — something builds \`${root}.\${…}\``
  if (code.includes(`"${last}"`) || code.includes(`'${last}'`)) return `maybe — "${last}" appears as a bare id`
  return 'no'
}
const deadKeys = [...packedNames].filter((n) => reachedBy(n) !== 'named').sort()
const deadList = deadKeys
  .map((n) => `- \`${n}\`  (${groupOf(n)}) — reachable: ${reachedBy(n)}`)
  .join('\n')
const deadHard = deadKeys.filter((n) => reachedBy(n) === 'no')

/**
 * The open rows, rolled up by reason, biggest first.
 *
 * A hundred-odd `open` rows is not a queue anybody works; sixteen questions is.
 * The rows and the roll-up come from the same strings, so the summary cannot
 * drift from the table under it.
 */
const openReasons = new Map<string, number>()
for (const r of [...objectRows, ...charRows, ...tileRows]) {
  if (r.v !== 'open') continue
  openReasons.set(r.where, (openReasons.get(r.where) ?? 0) + 1)
}
const openGroups = [...openReasons].sort((a, b) => b[1] - a[1])

const order: Verdict[] = ['wired', 'packed-unused', 'surplus', 'unclaimed', 'review', 'retired', 'open']
const total = objectRows.length + charRows.length + tileRows.length

const out = `# PixelLab ledger — every asset, and what draws it

**Generated by \`npm run ledger\`. Do not hand-edit — it is overwritten.**

Account snapshot taken \`${inv.taken}\`; atlas: ${atlasNote}.

## What this is for

\`docs/PIXELLAB_INVENTORY.md\` answers *what does the account hold*. This answers
*what is on screen*, which is the question every session of this project has got
wrong in the same direction: art generated, paid for, listed in the inventory,
and drawn by nothing. Session 18 found the barn, farmhouse, silo, coop, windmill
and well already bought. Session 22 found four blighted-scarecrow candidates and
seven item cards pointing at stand-ins while their own icons sat packed.

The owner's rule, 2026-09-03: **whatever is generated gets claimed, packed and
wired, or retired with a written reason.** Every row below ends in exactly one
state and there is no fourth.

| state | meaning | count |
|---|---|---|
${order.map((v) => `| **${v}** | ${{
  wired: 'packed in the atlas AND something in `src/` draws its key',
  'packed-unused': 'packed, drawn by nothing — a job, not a resting state',
  surplus: 'another roll of a prompt whose keeper is already wired',
  unclaimed: 'on the account, never downloaded into `assets/`',
  review: 'a candidate pack nobody has picked from — already paid for',
  retired: 'tagged `rdf-retired` on the account, with a reason tag',
  open: 'a real question for the owner; the row says which',
}[v]} | ${counts[v] ?? 0} |`).join('\n')}

${total} rows: ${objectRows.length} objects, ${charRows.length} characters, ${tileRows.length} tilesets.

## The open questions, in one place

Every \`open\` row rolled up by its reason. This is the queue: each line is one
decision the owner owns, and closing it turns N rows green at once. On the
account the same rows carry \`rdf-open\`, so
\`list_objects(tags="rdf-open")\` is this list from the other side.

| n | the question |
|---|---|
${openGroups.map(([reason, n]) => `| ${n} | ${esc(reason.replace(/^OPEN:\s*/, ''))} |`).join('\n')}

## How the join is made

There is no PixelLab object id anywhere in \`art/sprites.json\` and there never
has been — the manifest names files, and the files were downloaded by hand
across twenty-two sessions. Two joins are exact: **tilesets**, through the
PixelLab id inside each \`assets/tilesets/*.json\`, and **characters**, through
their \`rdf-<sheet>\` tags, which are the sheet ids in the manifest by
construction.

**Objects join by family** — the account tag where there is one, the normalised
prompt where there is not — through the table in \`tools/pixellab-ledger.ts\`.
That is the unit that matters: nobody needs to know which of four identical barn
rolls is the packed one, they need to know the barn is in the game and three
rolls are surplus. The keys a family maps to are then checked against the built
atlas and against every reference in \`src/\`, so the **wired or not verdict is
exact** even where the provenance is approximate.

An **unmapped** family reports as \`open\` and is counted above. That is the
pressure that keeps this file honest: a generation run that adds a family and no
table row makes the open count go up, in a committed document, on the next
refresh.

## Tilesets — ${tileRows.length}

The exact join. Every one was generated as a Wang set, downloaded into
\`assets/tilesets/\`, and packed as \`wang.<name>\`; a map's \`terrain\` block is
what picks one. \`packed-unused\` here means a ground nobody stands on.

${table([...tileRows].sort((a, b) => order.indexOf(a.v) - order.indexOf(b.v) || a.sort.localeCompare(b.sort)), false)}

## Characters — ${charRows.length}

${table([...charRows].sort((a, b) => order.indexOf(a.v) - order.indexOf(b.v) || a.sort.localeCompare(b.sort)))}

## Packed and dead — ${deadKeys.length} atlas names nothing NAMES, ${deadHard.length} nothing can reach

The account rows above ask, of each asset, *what draws it*. This asks the atlas
the opposite question, and it catches what the first pass structurally cannot:
keys that are packed and dead but never came from PixelLab -- the bundled LimeZu
scene cuts that the generated \`ranch.*\` family replaced, and every key freed
up when a card stopped borrowing a stand-in. Same defect, different supplier.
The group in brackets is the \`art/sprites.json\` block the name was packed from.

**\`reachable\` is the part to read.** No source file spells any of these names
out, but this codebase ASSEMBLES keys at the call site three ways --
\`portrait.\${classId}\`, \`stripUrl('tankSwirl')\` on the sheet name alone, and
content naming a ground bare as \`"grass_to_rot"\` -- so most of this list is
alive by one of those routes and only \`reachable: no\` is a finding. Being
wrong the other way is the expensive direction: a false DEAD sends the next
session hunting for a use that already exists, or deleting art the game draws.

${deadList}

## Objects — ${objectRows.length}

${order.map((v) => {
  const rows = objectRows.filter((r) => r.v === v)
  if (!rows.length) return ''
  return `### ${v} — ${rows.length}\n\n${table(rows.sort((a, b) => a.sort.localeCompare(b.sort)))}\n`
}).filter(Boolean).join('\n')}
`

writeFileSync('docs/PIXELLAB_LEDGER.md', out)
/*
   The same verdicts, machine-readable, for `npm run tag`.

   Deliberately a sidecar rather than a second copy of the family table: the
   tagger writes the account, and a tagger with its OWN idea of what is wired is
   how the account and the repo drift apart again. One table, two consumers.
*/
writeFileSync('docs/pixellab-ledger.json', JSON.stringify({
  taken: inv.taken,
  objects: objectRows.map((r) => ({ id: r.id, verdict: r.v, where: r.where })),
  characters: charRows.map((r) => ({ id: r.id, verdict: r.v, where: r.where })),
}, null, 1))
const line = order.map((v) => `${v} ${counts[v] ?? 0}`).join(', ')
console.log(`${total} rows — ${line}`)
console.log('-> docs/PIXELLAB_LEDGER.md')
