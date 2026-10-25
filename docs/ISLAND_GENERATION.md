# Island generation

New islands use one seed-driven generator (revision 7 / world 13). There is no style selector or candidate picker. One complete island appears automatically; **New island** generates another and **Start flying** accepts it. Code import is tucked inside **Have an island code?**. Replacing saved progress still requires confirmation.

Coastlines vary between long bent islands, branching peninsulas, deep horseshoe bays, irregular mainlands, crescents, and hammerhead coasts, with independent proportions, orientation, secondary bays and headlands. Mountain ranges have broader connected foothills, longer ridges, sharp crests and branching spurs. Terrain is no longer flattened to force low passes or cross-island flight lanes. Ecology and relief vary independently of the silhouette.

PS4 / world 10 and the original PS5 / world 11 generators are frozen with their dependencies. Their codes, baselines, and damage remain supported. New codes use `PS7-XXXXXXXX`; older codes reproduce their original islands. Complete revision, world, seed and legacy-preset identity still protects damage and realm caches.

## Rolling relief (2026-10-25)

Revision 7 adds domain-warped regional uplands, rolling hills and valley bands before drainage and settlement placement. Lowland profiles scale the regional relief while retaining small hills. Coastal aprons descend toward beaches; exposed sectors retain higher headlands. Settlement elevation limits now accommodate uplands, and grading blends over 50–180 m to soften terrace edges. Structural footprints, including the monument terrace, remain level for stable foundations.

Revision 6 / world 12 remains available through PS6 codes and existing baselines. Its generator and grading remain unchanged. PS7 uses world 13, keeping damage and realm identity separate from previous terrain. Existing saved islands retain their shape; choose **New island** to see the new relief.

### Relief verification

47 distinct targeted tests passed across generation, variety, compatibility, replacement, relief, saves and realm travel. Type checking, production build and runtime-asset verification passed. The 35-seed full-generation corpus passed after fixing watchtower rails that retained the reserved site height after road grading; 34 cases passed initially and the failing seed 3428989595 passed its targeted rerun. Reports are `artifacts/island-overhaul/variety-release-audit.json` (initial) and `terrain-relief-audit.json` (combined with the repaired case).

Chrome rendered seed 41729 at mountain, castle, coast, lake and waterfall viewpoints with no page errors. Captures are `artifacts/island-overhaul/variety-41729-*.png`. The lowland-slope regression compares ungraded PS6 and PS7 terrain for that seed and pins the PS6 baseline fingerprint. A separate fixture test checks watchtower support connectivity after a changed ground height and retains legacy coordinates by default.

## Pipeline

The shared browser/build dispatcher normalizes generation requests. The current generator plans on a 16 m grid: coastline and eroded mountain relief; drainage and catchments; variable-width rivers, lake basins and outlets; regional moisture and exposure; reserved monument and portal sites; terrain-scored settlements; bridge-aware roads and useful connecting loops. Terrain, drainage, regions, settlements, architecture, and vegetation use independent seeded coordinate streams.

Each request plans and materializes one 4,609² heightfield at 2 m spacing. Water carving, terraces, and road grading run at final resolution before destructible structures and vegetation are built. A shared road raster limits gradients at intersecting routes. River crossings reserve banks before optional towns are placed; secondary settlement counts scale with usable lowland area. Regions remain compact coarse fields and are shared by map, detailed, and distant terrain colors.

The populated mainland must stay connected. Optional islets remain uninhabited. Five castles, two grand and three smaller, and one Pineapple God remain required. Settlement counts vary with suitability and seeded ecology. Optional content stays within 48,000 structural entities and 30,000 trees. Castle entrances retain clear approaches; the generator does not carve routes through mountain ranges.

River widths, lake polygons, nearest-sample queries, and dry masks agree across generation, simulation, effects, and water rendering. Lakes remain impassable to wheeled monsters; generated river surfaces retain existing driving behavior. Modern ocean flooding starts at ocean-connected edge cells. Generated inland levels are fixed rather than dynamically simulated.

## Save precision

Damage saves retain version 10 and their Float32 height pairs. On the far portion of the grid, global sample indices exceed Float32 integer precision. New captures attach an optional Uint32 exact-index sidecar when needed, including during section merging, transfer, and restoration. Existing records without the sidecar retain their original decoding; no old terrain or entity records are rewritten during loading.

## Verification

`npm test` covers generation, compatibility, terrain/water behavior, simulation, destruction, and rendering ownership. The overhaul suite pins PS4 and original PS5 output, checks new and legacy codes, compares repeated plans, exercises 400 mainland monster spawns, and verifies exact far-grid terrain restoration. The variety suite checks six consecutive seeds, substantially different land coverage and relief, determinism, and the absence of forced passes.

Run `node --expose-gc scripts/check-island-overhaul.mjs` for the fixed 35-seed corpus; add `--coarse` for a 128-layout sweep or `--quick` for six seeds. Reports and browser captures belong in ignored `artifacts/island-overhaul/`. Native Chrome rendering and save checks are required in addition to simulation tests. Generation and gameplay performance need matched measurements on the same machine; software rendering does not certify native frame timing.

### Single-generator checks (2026-10-24)

All 66 tests in the five generation, variety, mountain, compatibility and replacement suites passed. This includes full generation across the fixed 32-seed mountain corpus and difficult seeds 12, 20 and 22, all six coast families among consecutive seeds, repeated-seed determinism, and frozen PS4/PS5 fingerprints. The run took 387 seconds; its output is `artifacts/island-overhaul/variety-tests.log`.

Type checking, the production build, and built runtime-asset verification passed. Native Chrome checks passed the simplified flow, rapid cancellation, collapsed code import, PS4/PS5 destruction save and reload, PS5 realm travel, replacement cancellation, and mobile layout. The final mountain-detail build also passed revision-6 destruction save/reload and touch viewport checks. Native captures cover the revised mountain ranges, coasts, castles, lakes and waterfalls; a comparison of six consecutive seeds confirms the different silhouettes. These checks are recorded in `artifacts/island-overhaul/`, alongside `browser-qa.json`, `single-final-qa.json`, and `variety-atlas.png`.

### Original PS5 release checks (2026-10-24)

These measurements record the original preset-based implementation before the single-generator revision.

- All 140 full islands (35 seeds across four presets) passed geography, water, road, flight, and content validation. All 256 additional coarse layouts passed.
- The full 530-test run passed 529 tests; one sculpted-statue resource test exceeded its 30-second timeout while generation audits were running. The subsequent isolated 29-test run passed, including that test, PS4 fingerprints, PS5 generation, save restoration, and atomic replacement.
- Type checking, production build, and built runtime-asset verification passed.
- Native Chrome on Apple M1 passed preset cancellation, three-layout selection, final preview, PS4/PS5 destruction save and reload, PS5 realm round trips, replacement cancellation, and mobile selection. Castle, coast, lake, and waterfall views were captured for all four presets without page errors.

The isolated, warmed generation benchmark used six seeds per revision and all four PS5 presets on the same machine, with explicit garbage collection between samples:

| Measurement                   |                              PS4 |       PS5 | Gate         |
| ----------------------------- | -------------------------------: | --------: | ------------ |
| Median full generation        |                           6.90 s |    3.86 s | Pass         |
| p95 full generation           |                          17.74 s |    5.17 s | Pass         |
| Peak process memory           |                        475.5 MiB | 511.5 MiB | Pass (+7.6%) |
| Three layout previews, median | 6.90 s full-generation reference |    4.04 s | Pass         |

Native foreground Chrome frame measurements used seed 42, Balanced Kingdom for PS5, a 1280 × 900 drawing buffer, manual 1080 quality, 1,200 m render distance, and CRT effects off. Each case warmed for 15 seconds and recorded 20 seconds of active flight with the requested monster count. A safe circular route at 900 m avoided crashes; this measures steady flight rather than a destruction-heavy battle.

| Active monsters | PS4 p95 frame | PS5 p95 frame | Gate         |
| --------------- | ------------: | ------------: | ------------ |
| 120             |       18.5 ms |       18.6 ms | Pass (+0.5%) |
| 400             |       18.6 ms |       18.1 ms | Pass (−2.7%) |

Reproduce generation measurements with `node --expose-gc scripts/benchmark-island-generation.mjs`. With a local Vite server at port 5177, run `scripts/check-island-overhaul-browser.mjs` and `scripts/check-island-overhaul-views.mjs` using Node for selection/save and visual checks. The browser scripts accept `PLAYWRIGHT_MODULE`, `CHROME_PATH`, and `ISLAND_URL` overrides. Run `scripts/benchmark-island-frames.mjs` separately, without competing generation workloads, for the native 120/400-monster frame gate. It compares PS4 against the current generator by default; set `ISLAND_REVISION=5` to reproduce the historical PS5 comparison.
