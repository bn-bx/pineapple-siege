# Pineapple Siege: remaining release work

Status as of October 7, 2026. The original overhaul remains open; whole-island visibility without scene fog is still required. This note records the next work from the actual current ledger rather than treating older investigations as completion evidence.

## Current stopping point

Batch 81 is the stopping point: owner-linked timber-and-iron ladders now connect the outer harbor docks to the generated waterline. The production build, 46-asset verifier, three focused ladder tests, and 49 visual-overhaul tests pass. The water-side screenshot is saved as [`PERFORMANCE_SCENE_1791372398131.png`](./PERFORMANCE_SCENE_1791372398131.png). The detail is implemented, but its readability from above-water and side approaches still needs review. It does not close the harbor/architecture area. The batch did not receive its planned 90-second normal-play sample.

The full remaining ledger is in [`VISUAL_OVERHAUL_LEDGER.md`](./VISUAL_OVERHAUL_LEDGER.md). The next work is:

1. **Architecture and landmarks:** replace repeated/generic silhouettes with complete family-specific art; finish castles, hamlets, farms, mills, docks, bridges, warehouses, towers, camps, quarry, lighthouse, and coastal ruins. Inspect owner-bound details and fractured materials in intact, damaged, collapsed, restored, near, and distant states. First follow-up: make harbor access read clearly and verify it survives removal/restoration in the actual renderer.
2. **Landscape:** refine mountain profiles, rock scale, river and shoreline transitions, roads, excavation walls, forest species variety, ground cover, and LOD handoffs. Inspect multiple seeds and edit states without adding fog or hiding distant landmarks.
3. **Actors and animation:** finish the jet, pineapple monsters, and residents; complete all movement, attack, stagger, dance, defeat, pause, and photo states; verify grounded feet and near/mid/far detail.
4. **Combat and sound:** finish each weapon's material/state coverage, destruction aftermath, disco presentation, and locally packaged audio. Review overlaps, underwater hits, reduced effects, mute, and nighttime readability.
5. **Experience and interfaces:** finish lighting calibration, chase-camera/readability cases, keyboard/touch use, menus, dialogs, HUD, recovery/storage errors, onboarding, preferences, and photo export.
6. **Combined release checks:** run the agreed 90-second M1 sample for each rendering batch and the temporary normal-play gate on the final combined build; measure the short 400-monster/3,000m/firing cases; verify Chrome and Safari, saves, restoration, preference migration, context recovery, and asset/storage failures. The 15-minute certifications remain deferred by the release instruction and are not passes.

**Release state:** batch 81 is live; the public `release.json` marker confirms `visual-overhaul-2026-10-07-batch-81` after the push. The overhaul and every area in the coverage table remain open. No final release certification has been completed.

**Current completion record:** see [`VISUAL_OVERHAUL_LEDGER.md`](./VISUAL_OVERHAUL_LEDGER.md). The dated investigation and batch results below are retained as history, not as evidence that the remaining families have shipped.

## 1. Production architecture and assets

- Finish cohesive modular artwork for castles, hamlets, farms, windmills, watermills, docks, warehouses, watchtowers, bridges, logging camps and the quarry; review the existing lighthouse and coastal ruins too.
- Complete silhouettes, roof construction, recesses, arches, parapets, joints, supports, doors, shutters, banners, lanterns and appropriate settlement props.
- Finish compatible fractured surfaces and exposed interiors; inspect each family intact, destroyed and restored from a save.
- Keep decorations with existing owners, support graphs and saved identities; inspect for detached pieces and invisible collision boundaries.
- Maintain three authored detail levels, local runtime resources, source files and provenance. Check all production assets load, with fallbacks used only for recovery.

Implementation begun in this batch: a new authored plank-door family with three levels, battens and diagonal bracing, integrated open entrance leaves, hinge hardware, timber frames and thresholds. Houses, barns, warehouses, mills and sheds derive their entrances from existing wall openings. A focused check verifies that leaves stay outside the passage and follow hinge-wall damage and restoration. This does not complete the architecture family replacements.

## 2. Terrain, water and landscape

- Finish mountain artwork, road surfaces, riverbanks, wet stone, shoreline sediment, shallow transitions, flow and restrained foam.
- Complete tree family variation and deterministic grass, shrubs, reeds, stones and branch placement across the whole island.
- Review nearby-to-distant transitions from ground flight through high altitude, preserving visible distant landmarks and no fog.
- Inspect seams, excavation walls, craters, deep shafts, river elevations, edited ground and vegetation ownership across seeds.
- Keep grass within 120m on M1 and reflections inside scheduled budgets.

## 3. Aircraft, pineapples, residents and animation

- Finish the jet's geometry, canopy, panel detail, control surfaces and exhaust.
- Complete pineapple fruit/crown shapes and expressive presentation while preserving hit volumes, scale and combat identity.
- Finish shared resident models and clothing variations.
- Complete and inspect walk, flee, cheer, mourning, attack, stagger, dance and defeat states; verify grounded feet and smooth snapshot-driven transitions.
- Review character detail selection, 120/400 populations, optional eyes, casualties, pause and photo mode.

## 4. Weapons, destruction, disco and sound

- Finish and inspect cannon impacts for every material, including dust, chips, splashes and matching sound.
- Finish nuke flash, shockwave, smoke and pineapple cloud shading and expansion, including three simultaneous clouds.
- Finish laser charge, beam, illuminated dust, distortion, excavation glow and aftermath with authoritative strikes preserved.
- Review the disco ball, mirrored surfaces and bounded beams throughout the lighting cycle.
- Inspect overlapping attacks, underwater impacts, vaporization, reduced effects, mute and the priority/distance audio mix. Complete remaining recording coverage and verify audible output in both browsers.

## 5. Lighting, camera, controls and readability

- Finish exposure and material calibration across midday, sunset and night; review cloud, sun, moon and settlement lighting.
- Inspect environment lighting, AO, bloom, grading and antialiasing without crushed shadows, glare or exposure pumping.
- Verify quality reductions and recovery do not visibly oscillate.
- Finish camera obstruction handling, bank/boost framing, warnings and restrained shake.
- Verify aiming, impact prediction, cooldowns, incoming attacks, crashes, boundaries and reduced-shake/effects controls in daylight, darkness, foliage, smoke and disco lighting.
- Review encounters, exploration routes, landmark recognition, reactions and population/morale feedback without adding missions or progression.

## 6. Interfaces and sandbox states

- Complete visual and interaction review of menus, dialogs, HUD, warnings, touch controls, focus states and responsive layouts.
- Review island previews, seed sharing, generation progress, save notices, recovery, reset confirmation, asset failures and graphics recovery.
- Verify contextual onboarding, preference migration and expanded quality selections.
- Verify photo exposure, focus, photo-only depth of field and HUD-free exports against the rendered scene.

## 7. Performance failures and demanding configurations

Latest completed 900-second normal workload: `PERFORMANCE_NATIVE_1791301368052.json`, Chrome on the target Mac, Auto, 120 monsters, 1200m detail, with 60 seconds of subsequent recovery. This measurement precedes later artwork revisions.

| Metric | Measured | Required | Status |
| --- | ---: | ---: | --- |
| Average FPS | 59.94 | >=59 | Pass |
| 1% low FPS | 49.13 | >=55 | Fail |
| Frame p99 | 18.7ms | <=20ms | Pass |
| Main-thread p95 | 4.5ms | <=4ms | Fail |
| Worker-step p95 | 2.5ms | <=5ms | Pass |
| Maximum save capture | 3.6ms | <=2ms | Fail |
| Sustained simulation/wall ratio | 0.9964–1.0050 | 0.98–1.02 | Pass |

- Fix the three failing gates and measure the completed combined candidate.
- Measure the 120/400 matrix, actual rapid-fire projectiles, overlapping lasers, 3000m detail and repeated destruction.
- Verify correct damage, responsive controls, bounded resources, queue completion and recovery after firing stops.
- Keep resident textures within 192MiB and render targets within 64MiB; track memory growth, streaming, GPU work, shadows, reflections, post-processing and saving.

## 8. Release certification

- Run a fresh 15-minute normal certification on the final combined build and a separate 15-minute stress soak on the fanless M1.
- Record frame tails, memory, slowdown and recovery. Direct thermal/clock telemetry remains unavailable; do not infer a thermal pass from that limitation.
- Inspect every asset family over multiple seeds, distances, times of day and camera modes, including intact/destroyed/restored states.
- Verify Chrome and Safari, keyboard and touch, asset and storage failures, context loss, pause/resume, reset, island replacement, preference migration and save restoration.
- Measure cold startup, downloads, shader preparation and streaming hitches; verify flight remains available while optional distant detail installs.
- Perform the combined review and resolve open art/functional/performance failures before treating the overhaul as finished.

The stress soak remains deferred after the user requested a return to implementation. It remains a release requirement. Earlier test results in the certification document are historical evidence, not acceptance of the latest build.

## Subsequent implementation batch

Added owner-linked timber wall posts, plates and braces, including lower plaster-course finishing. Integrated reduced foliage/scenery detail for lighter reflection profiles with exception-safe main-view restoration, cached renderer quality profiles and explicit Auto reset in benchmark preparation. A 30-second flight before the reflection/cache changes passed average/frame-tail/worker/save targets but still failed main-thread p95 at 5.1ms. This short result does not replace the failed sustained normal certification or close the architecture/lighting/performance release blocks.

The corrected reflection selection's short flight still fails low-FPS/main-thread targets (53.43 FPS 1% low and 5.0ms p95); see `PERFORMANCE_NATIVE_1791307432634.json`. Further implementation fixes camera smoothing order before obstruction checks, adds owner-linked small stone clusters around boulders, and uses bounded parallel foliage loading. These pass production compilation and focused checks, but do not close sustained performance, final artwork or release certification.

The ocean normal field now uses metre-scaled ripple/chop/wave/swell periods with the existing four samples; native Auto coast inspection rendered without recorded shader errors. Auto pressure now accumulates recurring expensive frames, decays isolated spikes, clears on resume, and retains 15-second recovery. Forty-two focused checks and production compilation pass. The final short timing result is recorded separately; final assets, browser/state coverage and sustained certification remain open.

Final short measurement of this batch: `PERFORMANCE_NATIVE_1791308068650.json`, 60.00 FPS average, 53.40 FPS 1% low, main p95 5.2ms, worker p95 2.9ms and maximum save capture 0.8ms. Auto held Performance at 900p. Low-FPS/main-thread targets still fail; this does not replace sustained certification.

### October 6 active art batch

Implemented coping and iron joinery with owner removal/restoration checks, resident hands/boots/proportion/color corrections, merged aircraft cockpit/canopy details, custom generated pineapple rind, root-arm grain, fibrous shared spike resources, tree-detail dithering, terrain outcrops, flow-advected and filtered river ripples, material chip resting orientations, faceted disco reflections, material-dependent impact audio, one-draw aiming contrast, small sun/moon discs, night fill/glow calibration and a responsive island picker with visible actions.

These are integrated improvements within all five requested areas, **not completion of the five areas**. Native reviews still show overly smooth mountain silhouettes, repeated architectural modules and insufficient landscape richness. Landmark-specific production art, complete damaged/restored inspection, animation/weapon/audio coverage, Safari/physical touch, and final performance certification remain open. Preserve the earlier measured performance failures until the completed candidate is measured again.
