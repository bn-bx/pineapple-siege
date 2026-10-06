# Overhaul certification evidence

Release status: **not certified**. Results below are measurements, not a completion claim. The visual coverage checklist remains open.

## Sustained normal workload — 2026-10-06

Raw report: `PERFORMANCE_NATIVE_1791265979064.json`. Native Chrome 154, MacBookAir10,1 with 8 GiB RAM; seed 41729; 1440 × 749 browser viewport; initial 120 monsters; Auto quality; 1200 m distance. Continuous landmark flight, ordinary weapon cooldowns, all three weapons, saves each second. Workload 900 seconds, recovery 60 seconds. Foreground fraction 1.0. This run used the development server; cold release-build startup remains a separate gate.

| Metric | Measured | Required | Result |
| --- | ---: | ---: | --- |
| Average FPS | 59.97 | ≥59 | Pass |
| 1% low FPS | 50.86 | ≥55 | Fail |
| Frame p99 | 18.7 ms | ≤20 ms | Pass |
| Main-thread p95 | 4.6 ms | ≤4 ms | Fail |
| Worker-step p95 | 2.6 ms | ≤5 ms | Pass |
| Longest capture slice | 2.6 ms | ≤2 ms | Fail |
| Ten-second simulation/wall ratios | 0.9947–1.0034 | 0.98–1.02 | Pass |
| Estimated resident textures | 88.17 MiB | ≤192 MiB | Pass |
| Estimated render targets | 36.73 MiB | ≤64 MiB | Pass |

Auto fell to Recovery and rendered at 1280 × 665; the displayed quality selection was 720p. The report records actual scene dimensions. The longest frame interval was 384.2 ms and main-thread work peaked at 397.9 ms. The early scene submission samples isolate a 395.8 ms submission stall. Draw calls across sampled route sections ranged from 79 to 314.

Recovery ended with no pending destruction jobs, terrain work or texture uploads. Recovery frame p99 was 18.7 ms, 1% low 53.45 FPS, main p95 4.7 ms and worker p95 1.6 ms. All 15 visual resource groups and eight recordings loaded without recorded failures. Worker state recorded 12,023 removed entities; this alone does not verify every individual damage outcome.

JavaScript heap samples grew from 278.0 MiB at 10 seconds to 315.4 MiB at 950 seconds. These include telemetry and changing terrain residency, and do not establish either a leak or a memory-growth pass. Longer/repeated runs and post-recovery collection must establish a plateau. Texture/target estimates exclude driver and total process memory.

Read-only `pmset -g therm` before and after the workload reported no recorded thermal warning, performance warning or CPU power status. Direct temperature and clock telemetry were unavailable; no claim of measured thermal throttling or its absence is made.

## Corrections after this run

- Prepare both active and inactive laser-light shader variants while paused. The prior warm-up forced all lights visible, leaving the normal-flight light-count variant unprepared.
- Increase construction batch cells from 256 m to 384 m and rock cells to 512 m to reduce CPU draw submission. Entity identities, ownership, support and collisions remain unchanged.
- Reduce incremental save work quota from 1.5 ms to 1 ms, leaving time for the current item and runtime overhead beneath the 2 ms limit. Metadata still captures atomically at one tick.

These corrections require new measurements; the failed sustained result is retained rather than relabeled.

## Corrected short flight and browser pacing controls

`PERFORMANCE_NATIVE_1791266222845.json`: 30-second 120-monster flight after the shader warm-up, batching and save quota corrections. Average 60.00 FPS, 1% low 53.46 FPS, frame p99 18.7 ms, worst frame 18.8 ms; main p95 4.8 ms, worker p95 3.0 ms and maximum save slice 0.9 ms. The earlier roughly 400 ms submission stall did not recur in this run. This short route does not replace sustained certification.

`PERFORMANCE_NATIVE_1791266319757.json`: isolated 30-second minimal WebGL clear, with no game, audio, workers or assets. Average 60.00 FPS, 1% low 53.42 FPS, p99 18.7 ms and worst frame 18.8 ms. `PERFORMANCE_NATIVE_1791266543400.json` repeats the control and records callback-arrival intervals separately: animation-clock 1% low 53.40 FPS, callback-delivery 1% low 48.78 FPS. Both were entirely foreground. This is evidence that this Chrome session contributes a pacing limit; it does **not** waive the 55 FPS target or excuse game CPU work above budget. The controls use a 1440 × 693 viewport, versus the game's 1440 × 749 viewport.

An initial stress attempt was discarded after review found that aircraft teleports did not move the fixed inspection camera. The stress camera now follows the aircraft, exercising rendering and terrain streaming as well as simulation residency.

## Outstanding required evidence

Complete demanding matrix and recovery, corrected-build normal certification, native Safari performance and current-build robustness checks, complete visual matrix across seeds and states, input/device robustness, release-build cold downloads and streaming, and memory plateau. Earlier Safari storage/context checks are recorded below. Refer to `VISUAL_OVERHAUL_COVERAGE.md` for artwork and feature acceptance still open.

## Sustained unrestricted stress — 2026-10-06

Raw report: `PERFORMANCE_NATIVE_1791267591831.json`. Native Chrome on the same M1 Air, entirely foreground; initial 400 monsters, 3000 m distance, unrestricted real projectiles and overlapping debug nuke/laser strikes; aircraft and chase camera move between landmarks every 45 seconds. Workload 900 seconds plus 60 seconds recovery.

Average 59.98 FPS; animation-clock 1% low 51.89 FPS; frame p99 18.7 ms; worst frame 65.5 ms. Callback-delivery 1% low was 47.14 FPS and its worst interval 74.1 ms. Main-thread p95 5.1 ms; worker p95 5.6 ms; longest save capture slice 8.4 ms. Ten-second simulation/wall ratios stayed within 0.9851–1.0049. These are demanding-configuration limits, not a normal-play pass.

Sampled pending destruction reached 607 jobs and ballistic pieces 508. Recovery ended with zero pending destruction, terrain and texture uploads, zero moving pieces, 17,693 removed entities and 7,581 recorded shots. Recovery frame p99 was 18.6 ms, main p95 5.6 ms and worker p95 2.2 ms. Individual damage and input correctness still require the matrix and robustness review.

Textures remained 88.17 MiB; maximum sampled render-target estimate was 59.70 MiB, beneath 64 MiB. Recovery rendered at 1600 × 832 in Auto Performance. All 15 visual groups and eight recordings were loaded without recorded failures. The sampled JavaScript heap grew from 305.2 MiB at 10 seconds to 460.7 MiB at 951 seconds. A memory plateau has not been established. Terrain geometry residency and capture overhead require investigation; the growth is not labeled harmless.

Post-run `pmset -g therm` again reported no recorded thermal/performance warning or CPU power status. No direct temperature/clock claim is made.

## Changes after the sustained reports

The current build adds matched alpha/wind/canonical-water auxiliary passes, photo cutout depth, quality-gated soft particle intersections, a shared CC0 puff atlas with material-specific impact colors, priority-based ordinary audio admission, and corrected geometry residency estimates including instance buffers. These additions have not yet passed a repeated combined sustained certification. The two completed soak reports above remain evidence for their recorded builds.

## Compatibility and regression checks after the particle pass

Native Safari reached Ready with the shared atlas and quality-gated particle depth. Its isolated storage checks passed (migration and migration failure, terrain/dry preservation, moving debris restoration, incremental merging, failed-commit atomicity, direct capture acknowledgement, retirement, and reset), then forced WebGL context loss recovered with the island preserved. These checks preceded the subsequent arched-window library export; that export still requires repeated Safari visual coverage.

The initial particle-pass unit run completed 231 of 232 checks with one 30-second timeout in the whole-island maximum-size laser restoration case. Its isolated rerun passed under the unchanged timeout in 28.29 seconds. A later combined run, including pool reuse, window ownership/ground-offset/flood and banner/depth checks, passed all 236 tests across 54 files in 246.20 seconds. The subsequent local-light shader guard passed its focused recovery/depth/visual tests and production build; final release changes still require a combined check.

A short normal-flight attempt was discarded before export because native inspection showed another Chrome tab was selected. Foreground-only performance evidence must record its foreground fraction; a background attempt is not a certification result.

## Foreground flight after the architecture pass

`PERFORMANCE_NATIVE_1791269761172.json` is a valid foreground (fraction 1) 30-second Chrome/120/1200m/Auto run. It fails: average 57.78 FPS, 1% low 26.76 FPS, frame p99 33.4ms, main p95 5.9ms, worker p95 3.1ms, capture max 2.3ms. All 16 resource groups and eight recordings loaded. Texture estimate is 89.71 MiB and targets 35.05 MiB; Auto reached Recovery at 1280×616. Whole-frame GPU p95 was 23.76ms, with initial shadow/reflection submission tails; effect update p95 was 0.1ms. No CPU build or test ran during the timed workload. Subsequent investigation independently reduces near foliage geometry under Recovery; this report does not include that change.

Read-only `memory_pressure -Q` reported 27% system-wide free memory after this run. `pmset -g therm` could not read thermal warning, performance warning or CPU power status. Neither value identifies the cause of the frame tails, and thermal slowdown remains unmeasured.

`PERFORMANCE_NATIVE_1791270292517.json` repeats this foreground flight after Recovery selects middle-distance foliage. It still fails: 58.44 FPS average, 24.04 FPS 1% low, 33.3ms frame p99, 8.2ms main p95, 5.6ms worker p95, 10.4ms maximum capture slice. End-of-run draw count was 177 and triangle count 585,547. The small geometry reduction alone did not resolve the stalls; no performance gain is certified from this change.

Subsequent changes move attached-edge banner wind from per-frame CPU vertex writes to a shared shader clock, with matched shadow/auxiliary geometry and scanned cloth. Static scenery and fallback terrain meshes skip redundant local transform updates. Distant residents now use a single merged authored human silhouette instead of a box. Terrain detail normals now use grass/soil world UVs and three cliff projections transformed through view-space tangent frames; lower quality retains geometric normals. Native Chrome initialized these shaders and rendered High inspection without a new shader error. These changes are not included in either flight report above and require new timing evidence.

## Guarded local-light flight repeat

`PERFORMANCE_NATIVE_1791271069386.json`: foreground Chrome, 30 seconds, 120 monsters, Auto, 1200m. Average 59.81 FPS, 1% low 41.99 FPS, frame p99 18.6ms, worst frame 83.6ms; main p95 6.2ms, worker p95 3.5ms, maximum capture slice 1.7ms. This remains a failed normal-play result. Recovery rendered at 1280×665, a different viewport from the previous flight reports; the changes and environment difference prevent attributing the improvement solely to the shader guard. Initial shadow/reflection submission tails remained (86.6/41.8ms), and GPU p95 at 20 seconds was 26.38ms. All 16 visual groups were loaded.

The guard keeps Three's four-light pool and skips point-light BRDF calculations only for exactly zero color or a position outside its finite attenuation cutoff. It introduces no daytime light-count variant. No new shader errors were recorded. Warm case preparation took 608.8ms; the page's initial startup took 47.42 seconds. Startup decomposition remains incomplete and this delay is not accepted as polished loading.

## Partial matrix and firing-route correction

`PERFORMANCE_NATIVE_PARTIAL_2026-10-06.json` preserves nine completed cases, each with foreground fraction 1: 120/400 flight, repeated nuke and overlapping laser workloads, single nuke with saves enabled/disabled, and the original 120-monster cannon route. It was downloaded before the route correction. The first eight cases are valid measurements of their listed workloads; none is a normal-play pass. The repeated nuke/laser cases drained authoritative destruction queues, terrain and texture work during recovery. The old `queueCompleted` field only checked authoritative pending jobs; inspect its separate resource fields rather than interpreting it as every presentation queue being empty.

The original cannon route fired only 56 projectiles and removed no entities. Its camera continued flying during recovery, creating fresh terrain requests (75 remained). It is insufficient evidence for unrestricted destructive firing. The test now repeats cardinal castle attack passes every three seconds, with cannon aim and a castle-yield nuke loadout. It uses real weapons; periodic debug placement keeps the benchmark from spending most of its workload in crash recovery or empty terrain. Recovery holds the presentation camera, and completion checks destruction, moving pieces, terrain, uploads and pending ruin batches. The projectile/distance subset and final complete review require new reports.

During the partial matrix, read-only power checks showed AC power, fully charged battery and Low Power Mode off. Direct temperature/clock telemetry remains unavailable.

## Corrected real projectile and maximum-distance matrix

Raw report: `PERFORMANCE_NATIVE_1791272766263.json`. Six native Chrome cases, all foreground fraction 1, normal viewport 1440×749, Auto Recovery at 1280×665. Textures remained 89.71 MiB and sampled render targets 36.73 MiB. These are demanding measurements, not normal-play passes.

| Workload | Avg FPS | 1% low | Frame p99 ms | Main p95 ms | Worker p95 ms | Max capture ms | Recovery |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| Cannon 120 | 58.67 | 23.98 | 33.4 | 9.1 | 8.5 | 4.3 | All tracked queues empty; 439 shots, 158 removed |
| Nuke projectiles 120 | 57.81 | 17.08 | 33.3 | 10.7 | 10.5 | 4.4 | All tracked queues empty; 423 shots, 4804 removed |
| Flight 3000m, 120 | 59.63 | 35.29 | 18.7 | 6.8 | 3.3 | 2.8 | No recovery phase |
| Cannon 400 | 59.34 | 27.80 | 18.7 | 10.3 | 13.4 | 3.1 | 40 terrain requests remained; damage/motion/ruin queues empty; 407 shots, 159 removed |
| Nuke projectiles 400 | 59.30 | 27.34 | 18.7 | 13.3 | 29.5 | 43.0 | All tracked queues empty; 385 shots, 4794 removed |
| Flight 3000m, 400 | 59.72 | 38.37 | 18.7 | 12.3 | 9.5 | 11.0 | No recovery phase |

The 120-monster nuke case had a 516.2ms worst frame and a 479.2ms reflection submission tail. Its first ten-second simulation/wall ratio was .7158; later windows recovered to approximately 1. The 400-monster nuke case began at .6828, cannon at .8922; later sampled windows were within .98–1.02. Initial lost simulation time is not concealed by the later ratio or average FPS. The real projectile tests are materially more demanding than the discarded old route.

Post-report fixes: refresh already-created moving debris with finished scanned/fractured surfaces while retaining packed pose buffers; preserve material shader keys; pre-create all four roof fragment shapes with their actual no-instance-color layout for shadow/reflection warming; render settled trunks with a static bark material rather than airborne pose interpolation; guarantee one bounded terrain request or installation when other work has exhausted optional headroom, with a small coarse refresh allowance. Targeted debris, terrain, graphics-recovery and rendering checks passed (17 tests). New timings and final combined regression remain required.

## Finished debris materials and fair terrain scheduling — 2026-10-06

Airborne debris was still retaining cloned loading materials after scanned surfaces installed. Rebinding now preserves packed motion buffers while replacing these clones with the finished materials and matched depth materials. All roof fragment attribute layouts are prepared while paused. Terrain streaming now guarantees one bounded operation when other optional presentation work consumes the frame allowance, avoiding permanent starvation. These fixes preserve authoritative geometry and damage.

`PERFORMANCE_NATIVE_1791273406575.json`: corrected real-nuke route, 120 monsters, 45 seconds firing plus 60 seconds recovery, entirely foreground. Average 59.16 FPS, 1% low 24.71 FPS, frame p99 18.7 ms, main p95 10.4 ms, worker p95 12.4 ms, maximum capture 5.6 ms. Reflection submission maximum fell from the prior 479.2 ms to 45.7 ms, but shadow submission reached 135.7 ms. A ten-second simulation ratio fell to 0.9303. Recovery drained all tracked queues, with 442 shots and 4,804 removed entities. This remains a failed performance result; the reflection reduction does not establish a normal-play pass or isolate the contribution of each correction.

`PERFORMANCE_NATIVE_1791273620756.json`: corrected real-cannon route, 400 monsters, 45 seconds firing plus 60 seconds recovery, entirely foreground. Average 59.25 FPS, 1% low 25.91 FPS, frame p99 18.6 ms, worst frame 149.5 ms. Main p95 11.0 ms, worker p95 13.1 ms, maximum capture 3.4 ms. The initial ten-second simulation ratio was 0.9707. Terrain reached zero during recovery, where the preceding corrected route left 40 pending items. Recovery also drained destruction, ballistic bodies, texture uploads and render ruins. This confirms queue progress for this route, not compliance with normal performance gates.

Both runs used a 1440 × 749 native viewport, Auto Recovery at 1280 × 665 internally, estimated resident textures 84.38 MiB and render targets 36.73 MiB. `terrainWorkerActive = 1` denotes that the terrain worker exists, not an unfinished request; terrain queue depth includes requests and completed work. Driver memory, thermal behavior and a heap plateau remain unverified.

After these measurements, leaf wind was unified across beauty, shadow and falling-tree depth passes. Settled canopy and rubble shadow variants are also prepared while paused. This later correction requires fresh native measurements and is not included in the two reports above.

## Current regression status after shared leaf shadows

The full 54-file suite ran 239 tests: 233 passed and six failed. Five failures exposed asset-map assumptions in test-created renderers; these paths were corrected, and the affected rubble, shape, visibility and disposal files then passed (27 tests). The maximum-size whole-island laser restoration test exceeded its unchanged 30-second timeout in the full run, the affected-file rerun, and alone (31.9, 35.9 and 42.1 seconds respectively). Its timeout remains unresolved. The previous 236-test pass is historical evidence, not a current all-tests pass. Native measurements after shared leaf-shadow preparation remain required.

## Terrain scan and shared-shadow native rerun

`PERFORMANCE_NATIVE_1791274743652.json`: 120-monster corrected real-nuke route, 45 seconds firing plus 60 seconds recovery, entirely foreground. With the ninth scanned surface (coastal sand) and shared foliage depth, average was 59.12 FPS, 1% low 24.32 FPS, frame p99 31.3 ms, worst 166.6 ms; main p95 12.4 ms, worker p95 20.4 ms and maximum capture 19.1 ms. Shadow submission reached 160.4 ms and reflection 48.8 ms. A ten-second simulation ratio fell to 0.6216. All tracked queues drained during recovery. Estimated textures were 88.38 MiB and targets 36.73 MiB. Initial startup was 71.05 seconds (cached local resource transfers); the subsequent case preparation was 1.24 seconds. Startup decomposition and actual cold transfer measurements remain open.

The High terrain shader compiled with no recorded errors during native mountain and coastal inspection. This is a shader/limited-view check, not full visual sign-off. The mountain and landmark art limitations remain visible.

Following this failed run, quality profiles now omit moving debris shadows in Balanced, Performance and Recovery, and omit settled canopy shadows at those levels. High and Ultra retain them. Reduced effects also omit these cosmetic shadows. Damage, fragment motion, terrain, ordinary structure shadows and simulation behavior remain authoritative. Diagnostics expose the moving-debris-shadow state. This subsequent correction needs new measurements; the failed report above is retained.

## Moving debris shadow budget and terrain journals

`PERFORMANCE_NATIVE_1791275175269.json`: corrected real-nuke route, 120 monsters, 45 seconds firing plus 60 seconds recovery, entirely foreground. Average 58.98 FPS, 1% low 22.18 FPS, frame p99 31.4 ms, worst 102.0 ms; main p95 10.8 ms, worker p95 13.4 ms, maximum capture 7.3 ms. Largest shadow submission was 91.5 ms and reflection 57.1 ms. The initial ten-second simulation ratio was 0.9639; later sampled windows were 0.9886–1.0018. Recovery drained all tracked queues. Estimated textures were 88.38 MiB and targets 36.73 MiB. One new shadow program appeared before the first resource sample; the subsequent program count stayed at 331. This remains a failed result, and the one program does not explain every hitch. Differences in runtime activity prevent attributing every timing change to the shadow budget alone.

After that measurement, authoritative terrain change journals and pending save height journals changed from boxed numeric Maps to paged Float64 values with presence bits. This preserves recorded numbers (including zero) and the packed save format. Full-map terrain history uses numeric pages rather than millions of boxed entries. `terrainHeightJournalDataBytes` reports typed-array data for changed terrain, current dirty samples and unacknowledged height captures; it excludes Map/page-object overhead, dry-index data, temporary capture section Maps and driver memory.

The unchanged maximum-size whole-island laser restoration test, which previously timed out at 42.1 seconds alone, passed after this change; the two-file focused run took 24.07 seconds with 21.25 seconds in tests, including two new exact-value/storage-bound tests. This is evidence for the journal correction, not a full-suite or gameplay performance pass. Full regression and fresh native measurements remain required.

The paged-journal integration subsequently passed the full regression suite: 55 files, 241 tests, 313.39 seconds total. The whole-island maximum-laser test passed within its unchanged timeout as part of this run. Afterward, startup diagnostics were separated into model/foliage/particle/surface loading, visual installation, variant assembly, shader submit/wait, initial shadow/scene/reflection/post passes and GPU completion. Five focused journal/graphics recovery tests passed after that diagnostic-only change. Current native gameplay, startup measurements and final certification are still required.

## Normal flight with paged journals and decomposed startup

`PERFORMANCE_NATIVE_1791276100909.json`: 30-second 120-monster normal flight at 1200 m, entirely foreground. Average 59.44 FPS, 1% low 29.90 FPS, frame p99 18.7 ms, worst 134.8 ms; main p95 7.1 ms, worker p95 4.9 ms and maximum capture 1.5 ms. Two sampled simulation ratios were 0.9982 and 0.9985. All 17 asset groups loaded without recorded failure. This remains a failed normal-performance result.

Initial startup was 12.13 seconds in this cached local run. Asset loading totaled 2.23 seconds; the initial preparation recorded 0.68 seconds awaiting assets, 0.52 installing visuals, 0.04 assembling variants, 0.14 submitting shaders, 0.46 waiting for compilation, 0.59 warming shadows/scene, 1.31 warming reflections, 1.58 warming post passes, 1.61 warming inactive effect variants and 0.06 waiting for GPU completion. Case preparation was 0.87 seconds. These are decomposed warm/cache measurements, not a cold network certification or an isolated comparison with the earlier 71-second result.

A mapped non-instanced terrain shadow program was not represented during preparation: streamed tiles arrive later, and the coarse terrain does not cast shadows. One new shadow program appeared during flight and the shadow submission maximum reached 141.6 ms. A temporary mapped terrain caster now prepares this layout while paused and releases its geometry afterward. Four focused graphics-recovery tests pass, including the new terrain proxy ownership/disposal check. The correction needs a native repeat; it is not included in this report.

## Terrain shadow preparation repeat and current Safari recovery

`PERFORMANCE_NATIVE_1791276523196.json`: native Chrome, 30-second normal flight with 120 monsters and 1200 m distance, foreground fraction 1. Average 59.47 FPS, 1% low 30.63 FPS, frame p99 18.6 ms, worst 68.6 ms; main p95 9.5 ms, worker p95 6.4 ms, maximum capture 1.7 ms. No new shadow programs appeared; shadow submission maximum was 5.2 ms, compared with 141.6 ms before the preparation correction. Reflection maximum remained 45.1 ms. Sampled simulation ratios were 0.9877 and 0.9969. Startup was 15.58 seconds with cached local transfers. This verifies the missing shadow-layout preparation, but the normal-performance gates still fail.

`PERFORMANCE_NATIVE_1791276748354.json`: native Safari 26.6.2, the same normal workload, foreground fraction 1, viewport 1264 × 690, Auto Recovery internally 1280 × 698. Average 46.61 FPS, 1% low 5.60 FPS, frame p99 43 ms, worst 1127 ms; main p95 8 ms, worker p95 approximately 5 ms, maximum capture 3 ms. Shadow maximum was 7 ms with no new shadow programs, but reflection submission reached 410 ms and main work 910 ms. The cause of those stalls remains unresolved. Two sustained simulation windows were 0.9884 and 1.0076. All 17 asset groups and eight audio recordings decoded; this does not verify audible mixing. Estimated texture residency was 88.38 MiB and render targets 37.86 MiB.

After that Safari flight, the isolated Storage correctness check passed. The Context recovery check visibly reported “Context recovery passed · island preserved.” These are functional checks, not a performance pass. Only the agent-created 5173 benchmark tab was closed afterward; preexisting Safari tabs were retained. No thermal certification or current 15-minute soak is established by these runs.

## Current 400-monster real-nuke workload

`PERFORMANCE_NATIVE_1791277752389.json`: native Chrome, 45 seconds of actual firing plus 60 seconds recovery, 400 monsters, 1200 m distance, entirely foreground, Auto Recovery at 1280 × 665. This includes paged terrain journals, terrain shadow preparation and the resident casualty presentation. Average 58.41 FPS, 1% low 21.50 FPS, frame p99 33.4 ms, worst 101 ms; main p95 16.1 ms, worker p95 55.8 ms and maximum capture 15.4 ms. Ten-second simulation ratios during firing fell through 0.9000, 0.8283, 0.5126 and 0.3900; later recovery mostly returned near 1, with a final sampled window at 0.9717. These demanding limits remain unacceptable evidence for normal certification and do not show that paged journals resolved gameplay stalls.

After 314 shots and 4,786 removals, all tracked damage, ballistic, terrain, texture and ruin queues drained. No new shadow programs appeared; shadow submission maximum was 6.2 ms and reflection 58.4 ms. All 17 asset groups loaded. Estimated texture residency stayed 88.38 MiB and render targets 36.73 MiB. Height journal typed-array data was approximately 1.66–2.03 MiB during firing and 1.38 MiB after recovery, excluding journal object and temporary capture overhead. Main-page heap samples ranged from approximately 283–468 MiB and are not worker memory or proof of a sustained plateau. The remaining worker/save and rendering tails require further correction and another sustained certification.

## Complete worker-step timing repeat

Worker diagnostics now include flight, projectile impacts, destruction, terrain maintenance and event work alongside existing actor/physics stages. One worst-step record retains tick, simulation time and a copied stage breakdown between snapshots. Nested collider timing is excluded from the unclassified remainder. This is bounded diagnostic metadata, outside saved state and the packed movement protocol. Sixteen focused performance/resident checks and the production build pass.

`PERFORMANCE_NATIVE_1791278115371.json`: another entirely foreground 400-monster real-nuke run, 45 seconds firing plus 60 seconds recovery. Average 57.65 FPS, 1% low 16.42 FPS, frame p99 34.3 ms; main p95 17.2 ms, worker p95 39.3 ms, maximum worker tick 844 ms and maximum capture 38.5 ms. All tracked queues drained. The worst tick was 601, at simulation time 10.017 seconds: projectile work 379.5 ms, monsters 320.6 ms, residents 47.8 ms, flight 38.5 ms, residency 25.5 ms, physics 21.6 ms, terrain maintenance 6.4 ms, destruction 2.2 ms and unclassified 1.5 ms. This rules out attributing this particular tick solely to the previously unmeasured destruction queue; it does not distinguish intrinsic computation, GC or scheduling delays inside the wall-time measurements. Initial ten-second simulation ratios were 0.6656, 0.3367 and 0.8053, followed by near-real-time windows. The cause and correction remain open, and this run is not a certification pass.

Combined regression after resident casualties and complete worker timing passed: 56 files, 245 tests, 288.73 seconds total. Timeouts remained unchanged. This confirms functional regression coverage, not normal-play performance, complete artwork, or final release certification.

## Scaled reflection storage

Reflection targets now scale from 1024×576 on Ultra through 768×432, 512×288 and 384×216 to 256×144 on Recovery. Update frequencies remain independently scheduled. The target owner survives texture-property release during resize and is used for disposal. Budget reservations use the actual profile rectangle instead of 768². Twenty focused rendering/recovery tests, the build and the asset verifier pass.

`PERFORMANCE_NATIVE_1791278756612.json`: 30-second normal native Chrome flight, 120 monsters, 1200 m, foreground fraction 1. Average 58.68 FPS, 1% low 22.18 FPS, frame p99 33.3 ms, worst 148 ms; main p95 14.3 ms, worker p95 20 ms and maximum capture 19 ms. Recovery reflection storage was 256×144, with estimated targets 32.51 MiB. No new shadow programs appeared; shadow maximum was 8.3 ms, reflection maximum 148.8 ms. Sustained simulation windows were 0.9904 and 0.9869. This confirms the storage reduction, not a timing improvement or normal-play pass. The retained early worst worker tick attributed 114.5 ms to event/aim work; the worker-stage measurement still cannot distinguish computation from GC or scheduling. After the run, the native Context recovery check visibly passed and preserved the island with resized reflection ownership.

## Conservative global sweep bounds

Fallback projectile and aim queries now reject entities and rotated ruins outside conservative capsule bounds on all three axes before exact shape casts. Global targets outside resident physics remain queried. Radius and half-length preserve grazing-hit envelopes. Forty-five focused weapon, simulation, destruction, collision and performance checks and the build pass, including the preserved off-residency hit and rejected off-axis cast.

`PERFORMANCE_NATIVE_1791279240594.json`: entirely foreground 30-second normal Chrome flight, 120 monsters and 1200 m. Average 59.34 FPS, 1% low 27.95 FPS, frame p99 18.7 ms; main p95 8 ms, worker p95 4.5 ms and maximum capture 2.6 ms. Reflection maximum was 34.2 ms, shadow 3.3 ms. Simulation windows were 0.9865 and 1.0015. This remains a failed normal result. Runtime activity differs between repeats, so the timing difference cannot be attributed solely to lateral rejection. Recorded GPU mean was 17.8 ms and p95 33.4 ms, leaving rendering pressure unresolved.

## Material shading budget and pineapple relief

Performance and Recovery omit standard material normal-map sampling through one shared shader uniform; Balanced, High and Ultra retain it. Scanned color and roughness remain, as do authored fruit/water shading. The hook is idempotent, composes inherited debris hooks, and rebinds shared actor materials when a renderer is replaced. Fourteen initial shader/depth/graphics/debris tests and the build passed; the replacement binding extension then passed its two focused checks and the build.

`PERFORMANCE_NATIVE_1791279507819.json`: 30-second normal native Chrome flight, 120 monsters, 1200 m, foreground fraction 1. Average 59.28 FPS, 1% low 27.04 FPS, frame p99 18.8 ms, worst 64.5 ms; main p95 9.3 ms, worker p95 6.6 ms, maximum capture 3.5 ms. The normal-detail counter was zero in both sampled Recovery windows; targets were 32.51 MiB. GPU mean was 17.05 ms and p95 31.81 ms, reflection maximum 62.4 ms. Simulation windows were 0.9930 and 1.0001. This validates the active reduction, not a normal performance pass or an isolated speed comparison. Native Chrome logged no captured shader warnings/errors. High sunset coastal inspection rendered successfully and was saved as `PERFORMANCE_SCENE_1791279555874.png`; this remains limited visual coverage.

After that measurement, pineapple scale relief changed from a screen-axis normal offset to a derivative surface basis, retaining physical relief strength across distance. Fine grain and scale detail fade at small projected size to reduce shimmer. The upgrade applies to monsters, projectiles and fruit fragments through their shared material hook. Thirteen focused visual/monster/fragment/shader checks and the build pass; final native appearance, Safari compilation and combined regression remain required.

`PERFORMANCE_NATIVE_1791280154610.json`: current native Safari normal flight after pineapple relief and shared-material rebinding, 120 monsters, 1200 m, foreground fraction 1. Average 48.86 FPS, 1% low 16.70 FPS, frame p99 41 ms, worst 121 ms; main p95 9 ms, worker p95 5 ms and maximum capture 5 ms. Reflection maximum was 29 ms and shadow 4 ms. Sustained simulation windows were 0.9977 and 0.9979. All 17 asset groups loaded, and the current aircraft, fruit, terrain and architecture rendered during native inspection. This is limited rendering verification and a failed normal-performance result. The earlier 410 ms reflection stall was absent in this short repeat; no isolated cause or sustained pass is established. Only the agent-created 5173 tab was closed afterward.

Terrain color sampling subsequently removed its overwritten default grass read and now skips soil, rock and sand sampling when their blend weights are zero. Explicit world-position gradients are computed before varying branches so mip selection remains defined. The blend weights and canonical terrain are unchanged. Eighteen focused terrain/presentation checks and the build pass. Native shader validation, performance and combined regression remain required after this correction.

`PERFORMANCE_NATIVE_1791280970684.json`: conditional terrain color sampling in native Chrome, 30-second normal flight, 120 monsters, 1200 m, foreground fraction 1. Average 59.54 FPS, 1% low 32.95 FPS, frame p99 18.7 ms and worst 49.8 ms; main p95 7.7 ms, worker p95 3.9 ms, maximum save capture 1.3 ms. No captured shader warnings/errors. This remains a failed normal result, particularly main-thread and frame-tail gates. It does not establish an isolated causal speed improvement. Safari validation of the new terrain branching remains required.

## Individual tree distance bands

Standing trees now use three instanced views with shared instance matrices and colors. Vertex rejection selects the near, middle or impostor band from each tree's world origin and the main camera, rather than switching an entire 512 m batch from its center. Main-camera uniforms keep reflection, shadow and auxiliary depth selection consistent; prewarming temporarily forces all bands visible. Species beauty/depth materials are shared across batches; falling-tree materials retain their independent wind presentation. Optional eyes inherit the same distance band. Removal compacts all three views, and restoration preserves their shared instance data. Auto middle distances are 420/360/300/240/160 m from Ultra through Recovery; near distances remain 180/180/140/100/0 m. Coarse batch visibility uses conservative radius overlap with each band.

Three new tests cover exact band boundaries (including disabled near detail), hook composition/shared uniforms and owner removal across all views. Nine focused tree/resource/recovery checks and twelve tree/depth/visual/eye checks passed; the production build passed. Native compilation, appearance, timing, destruction/restoration and final combined regression remain pending at this point. Neither this integration nor the terrain correction completes vegetation artwork or release certification.

`PERFORMANCE_NATIVE_1791281236705.json`: native Chrome normal flight with individual tree bands, 120 monsters, 1200 m, foreground fraction 1. Average 59.57 FPS, 1% low 34.06 FPS, frame p99 18.6 ms and worst 50.1 ms; main p95 8.2 ms, worker p95 4.8 ms and maximum capture 7.6 ms. Simulation windows were 0.9900 and 1.0033. Recovery rendered at 1280×616; viewport differed from the preceding repeat, so no isolated speed comparison is established. This remains a failed normal result. Native High ground-level pine inspection with optional eyes rendered and logged no captured warnings/errors before destruction. HUD-free evidence is `PERFORMANCE_SCENE_1791281269088.png`; conical/repeated crowns remain an artwork gap. After invoking the isolated inspection nuke and play controls, browser automation lost its tab debugger connection. Destruction outcome was not observed and is not counted as verified.

Native Safari rendering validation after conditional terrain sampling and tree bands: initial chase and ground-level pine views rendered, then an isolated inspection nuke removed nearby standing crowns and rendered the resulting crater. HUD-free damaged view: `PERFORMANCE_SCENE_1791281485683.png`. No visibly detached nearby standing foliage appeared in that observed view. This is limited rendering/destruction coverage, not a full damage/save-restoration matrix. CPU-heavy combined tests ran concurrently, so no Safari performance numbers were taken. Initial chase inspection also exposed remaining haze, masonry repetition and water/horizon transitions that require visual correction.

Combined regression after resident defeat, worker timing, reflection resizing, lateral sweep bounds, material normal budgeting, pineapple relief, conditional terrain sampling and individual tree bands: **58 files / 251 tests passed**, 343.23 seconds, with the existing 30-second test timeout unchanged. Production build passed before native inspection. Native performance still fails the normal release gates; this regression is correctness evidence only.

## Pine branch artwork revision

Pine crown geometry now uses irregular radial shoot layers instead of filling a smooth cone, at 384/128/32 near/middle/far cards (previously 600/190/32). Native review caught overly horizontal cards in the first export; orientation and shoot size were corrected before retaining the runtime revision. The editable Blender source, GLB, Meshopt runtime, matching tree impostors and provenance hashes were rebuilt together. The asset verifier passed all 61 mesh nodes, three detail levels, 27 scanned maps, foliage/particle resources and local decoders; production compilation passed. Ground-level High native Chrome evidence: `PERFORMANCE_SCENE_1791282117228.png`, with no captured shader warnings/errors. Branches are readable from the side; the forest and surrounding artwork still require broader production art review. Safari reviewed the preceding tree-band geometry, not this later crown revision.

`PERFORMANCE_NATIVE_1791282189656.json`: revised pine artwork, 30-second normal Chrome flight, 120 monsters, 1200 m, 1440×749 viewport, foreground fraction 1. Average 59.34 FPS, 1% low 28.10 FPS, frame p99 18.7 ms, worst 83.4 ms; main p95 5.6 ms, worker p95 3.3 ms, maximum save capture 1.4 ms. Simulation windows were 0.9980 and 0.9986. Main-thread and 1% low gates still fail. Timing differences across separate repeats are not isolated causal measurements. The earlier 251-test combined regression precedes this artwork-only rebuild; asset verification and production compilation were repeated afterward. Current normal/stress certification and complete family/state coverage remain unfinished.

## October 6 production-build candidate: whole-island visibility

The user requires fog-free visibility across the whole island. Scene fog is disabled for every quality selection, the camera far plane covers the island diagonal, and owner-derived distant building/rock/forest silhouettes remain visible beyond the nearby detail distance. The detail preference and existing saved choices are retained. No gameplay, generation or packed-protocol changes accompany this revision.

The combined automated suite passed **253 tests in 59 files** (137.17s). Later distant color/rock silhouette and final ground color adjustments passed seven and nine focused checks respectively, and production compilation passed. The model verifier passes 64 mesh nodes and all three authored levels, including outward-volume checks on closed construction/character families and the grass color attribute. Runtime texture provenance remains verified.

Final ground-level settlement image: `PERFORMANCE_SCENE_1791300335403.png` (Chrome, seed 41729, midday, High, no fog). It is a work-in-progress art comparison, not approval of the realistic reference standard or complete asset/state coverage.

The native production preview is served on loopback port 5187. A fresh 15-minute normal workload began around 10:26am Central, using the built assets, 120 monsters, Auto and 1200m detail. The run completed and was saved as `PERFORMANCE_NATIVE_1791301368052.json`. Average 59.94 FPS, 1% low 49.13 FPS, frame p99 18.7 ms and worst 416.6 ms; main-thread p95 4.5 ms, worker-step p95 2.5 ms, maximum save capture 3.6 ms. Sustained simulation/wall-time samples stayed within 0.9964–1.0050. Estimated resident textures peaked at 88.38 MiB and render targets at 32.51 MiB. Foreground fraction was 1. The following 60-second recovery completed its queues, with a 56.44 FPS 1% low. Normal certification still fails the 1% low, main-thread and maximum save-slice gates. This measured build precedes the later roof/settlement/fruit/bedrock edits. The user requested a return to implementation instead of another long test, so the separate stress soak is deferred and remains required for release. `pmset -g therm` did not expose thermal-warning, performance-warning or CPU power status; direct temperature/clock telemetry is unavailable. No thermal pass is inferred.

## Implementation resumed after the normal soak

Added all four roof fascia edges and sloping hip caps, window transoms, and foundation-owned crate stacks beside house/warehouse side walls. Placement rejects roads, water and steep slopes; existing decoration removal and terrain-edit handling apply. Assembly grouping avoids repeated world-wide searches during installation. Fruit skin now varies scale outlines and color by cell, with central dimples and the existing distance-filtered relief. Exposed cliff color uses its scanned mineral surface rather than multiplying by the canonical altitude grass tint; grass and road tint semantics remain. These revisions passed 13 focused checks in 0.48 seconds and production compilation. They are further implementation, not a repeat sustained certification or finished asset coverage.

The subsequent terrain material revision adds derivative-based mineral relief from the existing landscape variation, with stronger broad rock mottling and no added texture sample, terrain displacement or collision change. The crown shader adds growth tint, a central rib, dry-tip coloration and distance-filtered fibers on both monster and weapon fruit. Production compilation and 13 focused visual/monster/resource checks passed in 0.71 seconds. Neither edit has a new sustained performance measurement. Ground settlement evidence before the crown revision: `PERFORMANCE_SCENE_1791302049199.png`. Mountain inspection at 3000m detail rendered successfully; its smooth conical silhouette remains an unresolved art limitation.

Final native Chrome ground settlement capture after crown fibers: `PERFORMANCE_SCENE_1791302188771.png` (seed 41729, midday, High, 1200m detail, no fog). The scene rendered successfully. This capture does not certify every seed, browser, damage state or performance setting.

## Working entrances and pine proportion correction

The door family now has three authored source levels, with near plank gaps, bevels, battens and bracing. Runtime dressing adds open leaves, hinge hardware, frames and ground thresholds to existing generated house/barn/warehouse/mill/shed openings. Hinge-wall removal/restoration and passage clearance passed a focused regression; 13 visual/resource checks passed in 0.56s. The verifier passes 67 mesh nodes and all three door levels. Production compilation passed. Native Chrome village and farm views rendered; the village entrance image is `PERFORMANCE_SCENE_1791302922567.png`.

Farm inspection exposed stretched upright pine cards. Their vertical cross-axis now compensates for the tall instance scale and twig widths are narrower; near/middle/far counts remain 384/128/32. Source models, compressed GLB, matching three tree impostors and provenance were rebuilt together under manifest version 9. The asset verifier and production build pass. These changes have no new sustained performance result, Safari review or complete damage/state visual matrix.

Native Chrome farm review after the proportion correction shows distinct lateral branch layers instead of hanging twig strips. Evidence: `PERFORMANCE_SCENE_1791303152853.png` (seed 41729, midday, High, 1200m detail). The correction is retained. Forest variety and complete visual coverage remain open; this comparison does not establish a performance improvement.

## Timber wall construction and reflection budget

Timber wall courses now carry posts, plates and diagonal braces on both faces, attached to their existing owners. Lower plaster courses receive the existing timber surrounds. A shared darker timber material reuses the scanned resources and shader hooks. The owner-removal/restoration regression now includes a timber foundation course alongside plaster and windows. Native Chrome farm view rendered and was saved as `PERFORMANCE_SCENE_1791306522352.png`.

Construction batches now use the existing 512m forest/rock grid, with their distant coverage bounds derived from the rebuilt owner batches. `PERFORMANCE_NATIVE_1791306131219.json` is the 30-second Chrome flight measurement after framing/batching and before the subsequent reflection/profile changes: 120 monsters, Auto Balanced, 1200m, 1440x749 viewport, foreground fraction 1. Average 60.00 FPS, 1% low 56.33 FPS, frame p99 17.7ms, main p95 5.1ms, worker p95 2.4ms, maximum save slice 1.1ms. Main p95 still fails. Its reflection submission mean was 2.24ms, p95 2.7ms; this is a short single-route result, not normal certification or an isolated causal batch comparison.

Balanced/Performance/Recovery reflections now use existing tree impostors and omit fine scenery. The pass restores original visibility, parents and distance uniforms in a finally block, including when rendering fails. Trunks are omitted in that pass because matching impostors already include trunks. Owner transforms and removal masks remain unchanged. High/Ultra retain detailed reflection foliage; the main camera keeps its detail and full island horizon. The active reflection foliage choice appears in diagnostics. Quality profiles are cached per renderer until selection or Auto level changes, avoiding repeated profile/array allocations inside frame/detail loops. Benchmark case preparation now explicitly applies Auto quality, preventing a preceding High inspection from silently affecting a measured case.

These changes passed 22 focused checks in six files (1.12s) and production compilation. Combined regression, final sustained certification, Safari and complete reflection/state review remain required.

`PERFORMANCE_NATIVE_1791306963797.json` is the subsequent 30-second flight with the first reflection-detail helper and cached profiles. Average 60.00 FPS, 1% low 53.37 FPS, main p95 5.3ms, worker p95 2.6ms, maximum save slice 1ms; reflection submission mean 3.16ms. This result exposed an implementation mistake: detached distant forest batches were activated in reflections despite existing horizon coverage. That selection was rejected and corrected to include only batches already active in the main view. The exception/restoration regression now also checks that detached distant batches remain detached and hidden. The corrected code passes 22 focused checks and production compilation; its next short measurement is pending. Earlier failed measurements remain recorded.

`PERFORMANCE_NATIVE_1791307432634.json` records the corrected active-batch reflection selection: 30-second foreground Chrome flight, 120 monsters, Auto, 1200m detail. Average 60.00 FPS, 1% low 53.43 FPS, frame p99 18.7ms, main p95 5.0ms, worker p95 2.6ms, maximum save slice 0.8ms. It still fails the low-FPS and main-thread targets; no performance improvement or certification is claimed.

## Camera obstruction, boulder dressing and loading follow-up

Camera smoothing now precedes terrain/structure/rubble obstruction checks. The resolved camera position is copied directly instead of blending back toward a position behind an obstruction. Existing flight controls, camera targets, projection settings and collision authority are preserved. The focused camera regression covers a clear requested endpoint whose smoothed boom crosses a wall, and immediate camera reset after a discontinuity.

Existing boulders now own deterministic small stone clusters using the existing shared ground-rock geometry and material. Placement rejects roads, water and slopes that would expose floating stones. Clusters use the existing 120m ground-detail limit, terrain resampling and owner removal. Ground-dressing checks now cover both trees and boulders. Foliage loading now runs at most two texture requests concurrently, matching the existing two decoder workers and preserving failure reporting, cancellation and texture disposal. This loading change has no measured cold-start improvement yet.

The production build passes. The latest focused run passes 27 checks across three files in 0.81s. Native farm destruction evidence `PERFORMANCE_SCENE_1791307496361.png` shows the removed farm without its intact framing; that capture precedes the camera/scree/loading follow-up. Full destruction/restoration coverage remains open.

Native Chrome reached Ready with bounded parallel foliage loading; no warning/error was recorded in the inspected session. Coastal Auto evidence before ocean scale calibration is `PERFORMANCE_SCENE_1791307722268.png`. The revised ocean uses four existing normal samples at 12/35/97/311m periods with coordinated wind drift, replacing kilometre-scale ripple sampling. Native Chrome rendered the revised surface without recorded warning/error: `PERFORMANCE_SCENE_1791307851557.png`. Visual review retains the smaller ripples; no GPU speedup is claimed. No scene fog was added.

Auto quality now retains bounded accumulated overload from recurring expensive frames rather than discarding it on every quieter frame. A single spike decays away; continuous overload still reduces after 450ms, repeated reductions retain the 500ms guard, and recovery still requires 15 seconds of uninterrupted headroom. CPU/GPU overload thresholds are 4/13ms, with CPU recovery below 3.2ms. Pause/resume clears accumulated pressure and sampling time. Fixed selections remain unchanged. The focused run passes 42 checks across four files in 3.01s, including isolated versus recurring GPU spikes and fresh pause intervals. Production compilation passes; native timing of this revision is pending.

`PERFORMANCE_NATIVE_1791308068650.json` is the final short flight of this batch: foreground Chrome, 120 monsters, Auto, 1200m. Average 60.00 FPS, 1% low 53.40 FPS, frame p99 18.7ms; main p95 5.2ms, worker p95 2.9ms, maximum save slice 0.8ms. Auto reached Performance (level 3) and remained there at the 10/20/30-second samples, rendering 1600x832 at the same 900p setting. The low-FPS and main-thread targets still fail. This verifies Auto responds to recurring pressure; it does not demonstrate a performance improvement. Startup was 6.96s and visual resource loading 1.56s on the local preview reload; this was not a controlled cold-cache network test.

## October 6, 14:50 Central — five-area implementation checkpoint

This checkpoint integrates construction coping/ironwork, authored resident hands/boots and proportions, stable resident color identity under culling, five-mesh aircraft with cockpit/canopy, shared generated pineapple rind and root grain, fibrous monster spike resources, tree-detail dithering, terrain outcrops, filtered flow-advected river ripples, thin-axis fragment settling, faceted disco reflections, differentiated material impact audio, one-draw contrasting aim marker, solar/lunar discs, calibrated night fill/windows/pools, and a responsive island picker action row.

Production TypeScript/Vite build passes. Asset verification passes 59 mesh nodes (18 three-level families and five aircraft meshes), 27 scanned maps, foliage, particle atlas, local decoders and custom fruit texture source/runtime hashes. Focused checks cover 45 unique tests across 11 files; affected lighting/river and shared-resource disposal checks were repeated after their changes. The earlier exact 0.8 window-emission assertion was replaced by a bounded nonzero brightness assertion after deliberate glare reduction. The resource-disposal fixture now verifies shared spike material/geometry are each released once.

Native Chrome review reached Ready on the combined build with no new console errors. Import review found incompatible quantized/unquantized UV storage in merged resident parts; converting UVs to Float32 fixed the load failure. The actor inspection control initially assumed packed Vec3 supports slice; copying numeric components fixed it. These issues were corrected before this checkpoint.

Evidence:

- `PERFORMANCE_SCENE_1791315423757.png`: midday mountain review. Smooth silhouettes and coarse distant ground remain unfinished.
- `PERFORMANCE_SCENE_1791315450760.png`: aircraft inspection with canopy/cockpit export.
- `PERFORMANCE_SCENE_1791315626982.png`: initial sunset river review; subsequent review reduced bend striping through continuous world-space advection and pixel filtering.
- `PERFORMANCE_SCENE_1791315783612.png`: corrected river and root-arm surface.
- `PERFORMANCE_SCENE_1791316122884.png`: latest monster front view, custom rind, root grain and complete crown framing.
- `PHOTO_EXPORT_2026-10-06.png`: actual Chrome Save PNG output, copied from the 14:45:23 download and visually inspected. HUD/photo controls are absent. The browser automation's download-event waiter timed out, but the UI displayed Photo saved and the new file was present. This export precedes the final night calibration and spike replacement, so it does not establish those latest visuals in photo mode.

Island picker reviewed at desktop and 390x844; all actions are visible with the resized map/sticky action row. Game Start, HUD, photo entry, controls, PNG export, photo exit and pause-menu recovery were exercised on a newly created local test island, PS2-E20EA141. This is a responsive-layout review, not physical touch-device certification. Temporary viewport override was reset. Benchmark save remains isolated from gameplay storage.

These checks do not accept complete architecture, landscape, characters, combat or experience coverage. Repeated architecture and smooth mountains remain visible. All original sustained performance gates, final combined visual coverage, Safari/physical touch, complete recording coverage, demanding cases and stress certification remain open. No fresh performance pass is claimed from this art review.

Final focused combined run: 45/45 tests in 11 files, 1.89 seconds. Latest production build and `git diff --check` pass. A native nuke at the corrected actor inspection target produced the canonical crater, removed nearby tree dressing and the target actor, and left the view responsive to pause; `PERFORMANCE_SCENE_1791316281670.png` records the aftermath. No new console errors were captured. This is one visual aftermath check, not a demanding configuration/performance or restored-save pass.

## October 6 production release instruction

The user explicitly directed production release now, allowing performance slack and deferring long tests. For this release, the earlier sustained FPS gates and 15-minute normal/stress soaks are deferred rather than passed. Launch/build, locally packaged assets, save compatibility and focused functional checks remain required. The implementation/remaining-work entries are retained as honest engineering records; publishing does not certify completed artistic coverage. Production uses the existing Cloudflare Pages Git deployment on main and keeps the apex origin/world version 8.
