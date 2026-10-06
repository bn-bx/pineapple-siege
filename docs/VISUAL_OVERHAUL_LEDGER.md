# Pineapple Siege visual overhaul: current completion ledger

This ledger is the completion source of truth. A working implementation remains open until its representative views and failure states have been inspected; an item remains open until deployed. The October 6 notes in `VISUAL_OVERHAUL_REMAINING.md` are historical evidence and are not acceptance claims.

## Current batch

Farm fields now use canonical terrain sampling, avoid flooded and road areas, and attach crop beds and plants to an existing barn foundation owner. The isolated inspector now has direct choices for the landmark families present in each generated seed and a **Restore test world** action. Both changes use the isolated benchmark save; they do not access the player's production save.

Evidence so far: `tests/visual-overhaul.test.ts` covers farm dressing over dry ground, suppression over water, and removal with its owner. The focused file passes 16 tests. The production build and existing visual asset verifier pass. A local isolated-scene review at seed 41729 confirmed the farm preset frames the barn and visible crop rows at ground height. Production deployment is the remaining step for this batch.

## Coverage

| Area | Families or states | Current implementation | Remaining work | Status |
|---|---|---|---|---|
| Architecture | Castle, keep, hamlet, house, farm, barn | Existing destructible assemblies; owner-linked windows, doors, braces, roof edges, coping, and settlement props; farm rows added this batch | Distinct finished art for every construction family; inspect intact, damage, collapse, and restored saves | Open |
| Other landmarks | Windmill, watermill, dock, harbor, warehouse, bridge/crossing, watchtower, logging camp, quarry, lighthouse, coastal ruin | Existing generated structures, support graphs, and landmark-specific details | Finish family silhouettes, machinery, supports, props, fractured surfaces, and restored-state review | Open |
| Terrain | Mountain, cliff, road, soil, shore, river, crater, shaft | Terrain-aware scanned materials, slope/triplanar rock, roads/water masks, streamed LOD, destruction colors, distant island silhouettes, no scene fog | Finish mountain silhouettes, road/shore transitions, banks, excavation edges, and multi-seed transition review | Open |
| Vegetation | Pine, broadleaf, riverside, grass, ground dressing | Authored tree LODs and impostors, wind, deterministic owner-linked ground clusters; grass capped at 120m | Finish tree silhouette variety and ground coverage; inspect water, roads, clearances, edits, and distant popping | Open |
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
