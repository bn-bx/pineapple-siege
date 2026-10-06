# Pineapple Siege visual overhaul: current completion ledger

This ledger is the completion source of truth. A working implementation remains open until its representative views and failure states have been inspected; an item remains open until deployed. The October 6 notes in `VISUAL_OVERHAUL_REMAINING.md` are historical evidence and are not acceptance claims.

## Current batch

Farm fields now use canonical terrain sampling, avoid flooded and road areas, and attach crop beds and plants to an existing barn foundation owner. The isolated inspector now has direct choices for the landmark families present in each generated seed and a **Restore test world** action. Both changes use the isolated benchmark save; they do not access the player's production save.

Evidence so far: `tests/visual-overhaul.test.ts` covers farm dressing over dry ground, suppression over water, and removal with its owner. The focused file passes 16 tests. The production build and existing visual asset verifier pass. A local isolated-scene review at seed 41729 confirmed the farm preset frames the barn and visible crop rows at ground height. The batch is deployed in commit `e12209c`.

The forest batch adds two deterministic shrubs per eligible tree, using existing broadleaf and riverside models. Placement rejects wet, road, and steep ground; scenery inherits tree ownership and the existing 120m ground-detail cap. The focused tree-owner test verifies that understory is emitted and removed with its tree. It shipped in `839605e`.

Rooflines now distinguish domestic and working buildings. Houses, barns, and sheds receive weathered masonry chimney stacks with flue openings and courses; warehouses and mills receive louvered cupolas. Every piece uses a shared instanced batch and is owned by the existing destructible roof section. The isolated family tests cover all five families and verify that roof removal clears its dressing. Seed 41729 was inspected in the local production preview. The focused visual-overhaul suite passed 21 tests, with build and asset verification passing. The roofline batch shipped in `ca19cc9`, and the live release marker confirmed batch 3.

Logging-camp stacks now render as horizontal twelve-sided timber logs with the existing wood material and their original entity IDs, collision, and destruction. Existing owner-linked iron bands remain in place. The log-family geometry test verifies selection and axis dimensions; no entities, instances, or saved data were added. The isolated logging-camp preset at seed 41729 was inspected after the production build. The focused visual-overhaul suite passed 22 tests; build and asset verification passed. The batch shipped in `8dcda29`; the live release marker confirmed batch 4.

Windmills now replace their four static crossbars with rotating linen sails and timber spars in two shared instanced batches. Existing blade entity IDs own each sail, so damage removes individual pieces and restoration brings them back. Rotation uses snapshot time and freezes with the rest of presentation. The owner-selection and paused-time tests pass; the isolated seed 41729 windmill preset was loaded locally. The focused suite passes 23 tests; the production build and asset verification pass. This batch is pending deployment.

Watermills now replace sixteen static cube paddles and two fixed spokes with sixteen tangential timber paddles and two radial spokes in shared instanced batches. Each moving part retains its existing damage owner; the hub, supports, and collision entities remain untouched. The wheel advances from snapshot time and freezes with pause/photo snapshots. The isolated river-mill view was inspected in the local preview. Focused tests verify generated-layout selection, movement, pause stability, removal, and restoration; 24 tests pass, along with the production build and asset verification. Release metadata records both animated landmark batches; production marker verification is pending.

## Coverage

| Area | Families or states | Current implementation | Remaining work | Status |
|---|---|---|---|---|
| Architecture | Castle, keep, hamlet, house, farm, barn | Existing destructible assemblies; owner-linked windows, doors, braces, roof edges, coping, settlement props, farm rows, masonry chimneys, and louvered working-building cupolas | Distinct finished art for every construction family; inspect intact, damage, collapse, and restored saves | Open |
| Other landmarks | Windmill, watermill, dock, harbor, warehouse, bridge/crossing, watchtower, logging camp, quarry, lighthouse, coastal ruin | Existing generated structures and supports; roof vents, round destructible logging timber, snapshot-driven windmill sails and waterwheel paddles | Finish remaining family silhouettes, supports, props, fractured surfaces, and restored-state review | Open |
| Terrain | Mountain, cliff, road, soil, shore, river, crater, shaft | Terrain-aware scanned materials, slope/triplanar rock, roads/water masks, streamed LOD, destruction colors, distant island silhouettes, no scene fog | Finish mountain silhouettes, road/shore transitions, banks, excavation edges, and multi-seed transition review | Open |
| Vegetation | Pine, broadleaf, riverside, grass, ground dressing | Authored tree LODs and impostors, wind, deterministic owner-linked ground clusters and shrubs; grass capped at 120m | Finish tree silhouette variety and ground coverage; inspect water, roads, clearances, edits, and distant popping | Open |
| Aircraft | Jet, canopy, cockpit, control surfaces, exhaust | Authored aircraft model, transparent canopy, cockpit, and animated ailerons | Finish and inspect panel detail, exhaust presentation, animation transitions, and photo/pause states | Open |
| Characters | Pineapple monsters and residents | Fruit surface, crown/roots, shared body parts, resident color variants, and snapshot-driven basic poses | Complete model variety, readable attack/stagger/defeat, full resident pose review, and 120/400 population review | Open |
| Combat | Cannon, nuke, laser, debris, disco | Bounded effect pools, local particle atlas, material-oriented debris, laser/nuke presentation, disco shader | Complete material/state coverage, overlaps, reduced-effects behavior, audio mix, and aftermath review | Open |
| Sound | Engine, wind, water, forest, settlement, impacts, explosions | Locally hosted licensed recordings and bounded distance/priority mixing | Fill recording gaps and verify audible mixes, mute, and crowded strikes in Chrome and Safari | Open |
| Experience | Lighting, flight camera, aim, warnings, keyboard, touch | Existing lighting and post-processing profiles, camera, aim, HUD, flight controls, photo tools | Calibrate all lighting and flight states; review physical touch, dialogs, recovery, onboarding, and responsive interfaces | Open |
| Performance and release | Auto quality, saves, assets, startup, browser/state recovery | Diagnostics and bounded resource systems; normal-play gate temporarily relaxed by user | Measure temporary FPS gate and short demanding cases; verify save, context, load-failure, migration, Chrome/Safari, and final deployed build | Open |

## Release gates

- Complete an area only after each listed family has finished artwork, working ownership/animation behavior, a visual review record, and a production deployment.
- Use the agreed temporary M1 normal-play threshold of 50 FPS average and 40 FPS 1% low at Auto, 120 monsters, and 1,200m detail. Long soaks remain deferred. Whole-island visibility without fog is mandatory.
- Keep performance results separate from visual completion; never infer a pass from compilation, one screenshot, or an older build.
- Keep asset provenance and locally bundled runtime files. Convert immutable model and texture URLs to content-hashed names before replacing an already published asset.
