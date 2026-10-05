# Performance release verification

Substantial performance changes are implemented in this working tree, but the **Steady 60 FPS release remains incomplete and is not certified**. The native runs below fail the requested frame-tail gates. Correctness checks and average FPS do not substitute for passing every gate.

## Current verification status

Final code build 43 passes **188 tests in 41 files**, TypeScript and the production build. Ten native storage/migration/reset checks pass. The latest completed Chrome matrix uses build 42 (`PERFORMANCE_NATIVE_1791164514334.json`) and fails every complete release gate. The final build changes only permanent-rubble render batching to 256-meter groups, with a boundary/transform preservation check. Its Safari run was interrupted by a locked Mac; foreground certification and a fresh final-build 15-minute soak are pending unlock. The completed 15-minute build-25 soak remains recorded below and is not substituted for final-build verification.

## Scope and invariants

Generator revision 1 and world version 8 remain unchanged. Save compatibility is 9. The exact baseline, seeds, 664 residents, 14,000-tree generation limit, configured monster limits, flight tuning, weapon strengths, damage, casualties, and permanent rubble remain authoritative. Auto changes presentation and background scheduling.

Implemented stages:

- Sparse dry-cell indices, incremental terrain/ruin journals and sectioned atomic commits; valid version-8 migration preserves its original on transaction failure. Save capture yields between sections; commits acknowledge journals before retirement.
- Dedicated terrain meshing worker with two-sample halos, epoch/revision/LOD rejection, bounded caches, coarse coverage, spatial working sets, and hysteresis. Small staged height/wet uploads share the optional installation deadline. The pinned Three.js r180 upload adapter avoids whole-heightfield row uploads and synchronous GL state queries. It uses Three's texture-binding cache and reacquires GPU handles after initialization/context recovery.
- Static spatial batches, compact surviving instances, shared tree trunks, batched river reaches, instanced monster parts and projectiles, distant residents, and packet-driven GPU debris interpolation. Disabled eyes skip face creation and update traversal. Eyes still require CPU transforms when enabled.
- Four lantern lights, pooled explosion presentation, merged redundant laser embellishments, fixed core shaft rendering, staggered reflection/shadow scheduling, and an Auto controller with fast reduction and slow recovery. Manual resolution and requested viewing distance remain intact.
- Nearby authoritative simulation at 60 Hz, distance-tiered ambient navigation, static collider residency plus global exact shape queries, canonical terrain sweeps, resumable support/collapse/laser jobs, spatial beam lookup and coalesced excavation, and eight transferable motion slots. Pool lookup storage follows packet population rather than increasing entity IDs.
- Bounded telemetry rings, asynchronous disjoint GPU timing where supported, every-tick worker samples, main-thread and save timing, pool/terrain/destruction queues, and resource sampling. Native Safari did not expose the GPU timer extension; CPU submission and foreground frame intervals remain available there.

## Native method

Use `npm run build`, `npm run preview`, then `/performance.html`. The test database is separate from the player's active island. No benchmark resets or replaces the player's save.

The six cases run in the foreground for 30 seconds each with 120 and 400 monsters, Auto graphics, 1,200 m distance, audio, and approximately one-second autosaves. Combat uses deterministic direct authoritative impacts at 10 Hz around the reference castle. This isolates destruction pressure; it does **not** establish the cost of moving fired projectiles or every interactive flight path. First-shot costs, terrain streaming, quality transitions and autosaves remain included. Loading/intentional preparation pauses are excluded. Deliberate pause gaps are not trimmed from an active case to improve a result.

Native checks ran on this M1 MacBook Air (8 GB). Chrome and Safari used wide windows. The latest harness records visibility and document focus; older reports did not record that fraction and cannot independently certify foreground playback. Earlier in-app runs used the narrower side-panel viewport; their GPU/frame results are not directly comparable to wide windows. Heavy command-line checks were kept separate from native timed playback. Other user applications were left intact.

The benchmark reports all gates, not only average FPS. Full-run frame and worker-step intervals are retained. Stage rings are bounded to 4,096 samples; long-soak stage percentiles describe the final portion, while frame/step percentiles describe the full run. GPU queries measure elapsed pass execution and are subject to browser/driver timing behavior; they are not a vendor-native GPU capture.

## Saved native results

| Report | Browser / stage | Key result |
|---|---|---|
| `PERFORMANCE_NATIVE_1791148093119.json` | Chrome, earlier implementation | Dense nuke main-thread p95 reached 23 ms; save slices exceeded 2 ms. |
| `PERFORMANCE_NATIVE_1791149260837.json` | In-app browser, early narrow viewport | Combat averages approached 60 FPS, but frame tails and CPU/save gates failed. |
| `PERFORMANCE_NATIVE_1791149728850.json` | Chrome, before river/projectile batching | Frame tails and simulation/save gates failed. |
| `PERFORMANCE_NATIVE_1791153136110.json` | Safari, whole-buffer row upload path | Nuke playback 10.6–11.7 FPS; submission p95 160–177 ms. |
| `PERFORMANCE_NATIVE_1791153882769.json` | Safari, packed section uploads | Nuke playback 41.8–42.7 FPS; submission p95 7 ms. All complete release gates still failed. |
| `PERFORMANCE_NATIVE_1791154181709.json` | Chrome, packed sections through Three's copy API | Flight 59.2–60.0 FPS, nuke 57.8–59.4, laser 51.4–51.5. Upload state queries caused laser upload p95 about 29 ms. All complete release gates failed. |

Later reports and final verification results are appended below. Earlier stage reports intentionally remain available to show failures and changes, rather than overwriting unsuccessful measurements.

## Remaining release risks

The native reports still show expensive dense-nuke simulation, long allocation/submission tails, and some capture slices over 2 ms. The initial metadata/airborne-pose capture is one consistent-tick copy and can exceed its target under dense destruction. Ordinary IndexedDB commits now run in a storage worker; older reports below precede that change. Transfer preparation still runs on the main thread and must be included in the frame gates. Transaction wall time is reported separately from synchronous preparation.

The terrain meshing worker can fall back to synchronous construction if unavailable. That fallback preserves correctness but does not meet the render-thread budget. It is counted explicitly in telemetry.

A completed 15-minute soak establishes observed behavior for that seed/scenario, not a proof across all islands, maximal settings, or browser contexts. This release's soak did not pass all gates. Exact controlled-destruction equivalence against an independent reference implementation, complete native multi-seed/view coverage, and a vendor-native GPU capture remain separate verification requirements.

## Latest automated checks

- TypeScript and production build pass (`/tmp/siege-ts23.log`, `/tmp/siege-build23.log`).
- 164 of 165 regression tests passed in the full run. The remaining full-map maximum-size laser test hit the existing 30-second timeout after 32.7 seconds. It passed unchanged when rerun alone with a 60-second timeout (32.1 seconds). The assertions cover all-grid excavation, dry water masking, queued cleanup, save, restore and reload. This timeout is disclosed rather than reported as a passing default command.
- New tests cover packed-upload bounds and the final sample row/column, upload/reset queues, GL state-query avoidance and coherent bindings, laser presentation limits, stable high-ID packet lookup, per-species wreckage interpolation/depth shaders, river batching, stale meshing results, packet retirement, journals, lazy bodies, collider shapes and resident sweep bounds.
- Existing world/debris/destruction CPU benchmarks also ran. Their Extreme stress settings do not establish foreground Standard/Auto FPS.

Controlled worker CPU results before the final worker changes (`PERFORMANCE_CPU_STAGE23.json`, no concurrent browser benchmark):

| Monsters | Scenario | Step p95 / p99 ms | Largest capture slice ms |
|---|---|---|---|
| 120 | Flight | 2.62 / 3.94 | 0.42 |
| 120 | Nuke | 10.21 / 13.30 | 3.27 |
| 120 | Laser | 6.24 / 9.96 | 10.54 |
| 400 | Flight | 4.10 / 6.14 | 0.22 |
| 400 | Nuke | 11.19 / 14.13 | 3.38 |
| 400 | Laser | 7.50 / 12.06 | 4.41 |

Flight meets the simulation/capture gates in this run. Dense combat does not. Earlier runs were faster; neither measurement justifies asserting a stable worst-case result. Resumable save validation now has an island epoch guard, so reset/replacement/close cannot allow an older yielded preparation to overwrite a new baseline.

The latest desktop-sized in-app attempt stalled during navigation/debugger synchronization. Reload and closure/viewport recovery also timed out; no new hardware result was obtained. Earlier narrow in-app reports remain the available evidence. The user's game tab was not reset or replaced.

Native IndexedDB verification on the latest build passed eight checks: migration failure/original protection, atomic 8→9 migration, terrain/dry preservation, packed-debris grounding, section merging, clone-failure atomicity, rejection of a yielded old save after reset, and damage reset with exact baseline retention.

The latest build also prewarms the actual water reflection pass. Main-screen compilation alone leaves reflection output-colour-space shader variants and its render target cold; the reflection wrapper previously skipped that pass when loading rendered shadows. Reflection submission has a separate CPU stage so first-use and scheduled-pass costs can be distinguished.

## Reflection prewarm and bounded GL uploads

`PERFORMANCE_NATIVE_1791155424180.json` (Chrome) removes synchronous GL state queries from section uploads and reduces transparent laser embellishments to eight nearby shafts. Laser average FPS improves to 59.9–60.0; complete gates still fail.

`PERFORMANCE_NATIVE_1791155857777.json` (Chrome) also prewarms the actual reflection pass. All six cases meet the average-FPS and frame p99 gates, but **none passes every release gate**:

| Monsters | Scenario | FPS / 1% low | Frame p99 ms | Main p95 / p99 ms | Simulation p95 / p99 ms | Capture max ms |
|---|---|---|---|---|---|---|
| 120 | Flight | 60.0 / 51.5 | 18.6 | 6.0 / 9.0 | 4.8 / 11.7 | 3.6 |
| 120 | Nuke | 59.8 / 43.9 | 18.7 | 11.2 / 14.0 | 22.7 / 32.7 | 8.7 |
| 120 | Laser | 59.9 / 44.7 | 18.7 | 6.9 / 9.2 | 9.1 / 16.8 | 2.4 |
| 400 | Flight | 60.0 / 53.9 | 18.5 | 5.5 / 6.5 | 5.7 / 8.7 | 1.1 |
| 400 | Nuke | 59.6 / 36.2 | 18.7 | 11.5 / 14.9 | 20.5 / 35.0 | 10.8 |
| 400 | Laser | 60.0 / 53.5 | 18.7 | 7.5 / 9.4 | 12.1 / 20.7 | 5.8 |

TypeScript and production build 25 pass. Nine selected renderer tests pass, including explicit disposal of reflection and shadow targets and shader-uniform textures. Disposal prevents those targets surviving island replacement. A native image-export control records the actual game canvas under `docs/PERFORMANCE_SCENE_*.png`.

## Fifteen-minute native soak

Chrome report `PERFORMANCE_NATIVE_1791157081537.json` completed 900 seconds of mixed rapid-fire combat with 400 monsters, Auto, 1,200 m and audio. It recorded 53,892 frames: 59.88 FPS average, 45.63 FPS 1% low, 18.7 ms frame p99, and 0.108% of frames exceeding 33.3 ms. The complete gate **fails**. Main-thread p95/p99 was 10.4/14.2 ms; simulation 15.8/29.0 ms; the largest capture slice was 34.2 ms.

Ninety resource samples show packet occupancy at most six of eight slots, textures constant at 24, geometries 341–361, and no continuous heap-growth trend (collection repeatedly lowers usage). Terrain queues stayed within 86, reaching zero in the final sample. Destruction work peaked at 304 queued items and ended at 274; this is bounded observed behavior for the run, not a formal throughput guarantee. The initial resource sample contains deliberate preparation/pause worker lag and is not an active simulation-lag measurement. The post-soak image is `PERFORMANCE_SCENE_1791157133827.png`; native 3,000-meter mountain inspection is `PERFORMANCE_SCENE_1791157192748.png`.

The subsequent worker changes use finer exact resident blocker cells and avoid inactive-laser cleanup scans of all ruins and moving debris. They are measured separately from this soak.

## Final worker optimizations and packet ownership

Chrome report `PERFORMANCE_NATIVE_1791157513466.json` includes the finer resident blocker index and inactive-laser fast paths. Each case meets average FPS and frame p99, and each still fails the full gate. Nuke-only laser-cleanup p95 drops to about 0.1 ms. The 120-monster nuke simulation p95 improves from 22.7 to 15.5 ms; the 400-monster nuke from 20.5 to 19.3 ms. Other scenarios show variability and no overall certification is inferred.

| Monsters | Scenario | FPS / 1% low | Frame p99 ms | Main p95 / p99 ms | Simulation p95 / p99 ms | Capture max ms |
|---|---|---|---|---|---|---|
| 120 | flight | 60.0 / 51.2 | 18.7 | 5.3 / 7.1 | 3.8 / 7.4 | 0.8 |
| 120 | nuke | 59.8 / 44.0 | 18.7 | 10.8 / 13.8 | 15.5 / 21.2 | 5.1 |
| 120 | laser | 59.8 / 40.3 | 18.7 | 8.1 / 11.9 | 12.9 / 26.7 | 2.3 |
| 400 | flight | 59.9 / 45.9 | 18.7 | 7.5 / 10.4 | 8.6 / 19.6 | 1.3 |
| 400 | nuke | 59.4 / 30.5 | 18.7 | 12.0 / 14.8 | 19.3 / 28.2 | 4.9 |
| 400 | laser | 59.8 / 42.2 | 18.7 | 8.4 / 12.1 | 14.2 / 31.2 | 2.8 |

Build 27 additionally fixes repeated resume ownership: timeline rebase retains the latest packet without retiring it, retirement uses a deduplicated set, and disposal retires remaining packets and clears their wrappers. This prevents double transfer of a still-used buffer. Six timeline/resource tests pass, plus TypeScript and the production build. The previous 44 worker/gameplay tests passed with a 60-second per-test timeout.

Native Chrome inspections cover the reference seed and seed 1234567, fortress, mountains and coast, 1,200/3,000 m, and a broadleaf night scene with eyes enabled. Saved images are `PERFORMANCE_SCENE_1791157845187.png` (fortress), `PERFORMANCE_SCENE_1791157893511.png` (coast), and `PERFORMANCE_SCENE_1791157936293.png` (night/eyes). These are visual checks, not FPS certifications. No browser warnings or errors were recorded in these inspections. Complete photo-mode, context-recovery and all-species native coverage remains outstanding.

## Native Safari after worker and packet fixes

Report `PERFORMANCE_NATIVE_1791158233569.json` uses build 27. All full gates fail; GPU timer queries remain unavailable. Packed rectangle uploads retain low submission overhead compared with the original whole-buffer path. This run precedes the final cloud-quality pool fix.

| Monsters | Scenario | FPS / 1% low | Frame p99 ms | Main p95 / p99 ms | Simulation p95 / p99 ms | Capture max ms |
|---|---|---|---|---|---|---|
| 120 | flight | 58.4 / 17.1 | 35.0 | 6.0 / 10.0 | 5.0 / 11.0 | 3.0 |
| 120 | nuke | 48.1 / 20.3 | 38.0 | 12.0 / 15.0 | 16.0 / 22.0 | 5.0 |
| 120 | laser | 53.1 / 8.6 | 50.0 | 7.0 / 12.0 | 12.0 / 23.0 | 14.0 |
| 400 | flight | 58.9 / 18.7 | 29.0 | 5.0 / 8.0 | 4.0 / 7.0 | 1.0 |
| 400 | nuke | 47.3 / 19.7 | 37.0 | 13.0 / 16.0 | 15.0 / 20.0 | 9.0 |
| 400 | laser | 52.5 / 8.5 | 54.0 | 8.0 / 12.0 | 15.0 / 34.0 | 4.0 |

## Final automated verification

The full suite passes **170 tests in 35 files**, with `--maxWorkers=1 --testTimeout=60000` (192.4 seconds, `/tmp/siege-all-tests28.log`). The extended timeout is explicit; the earlier default-timeout failure remains documented. TypeScript and the production build pass (`/tmp/siege-ts28.log`, `/tmp/siege-build28.log`). `git diff --check` passes.

Both full and reduced cloud qualities are prewarmed in separate bounded pools (three per quality, at most three active). Acquisition matches requested quality, including after Auto changes; reduced clouds use fewer than 60% of the full-detail billboards. Previously all prewarmed clouds had full-detail geometry. The water shader now skips its disco pattern when the uniform is off. A new test checks quality selection, repeated reuse and the six-cloud inventory bound. These changes adapt presentation without changing authoritative blasts.

A final in-app control-recovery attempt again timed out while synchronizing/closing the stalled test tab. The original game tab and save were left untouched; desktop-sized in-app certification remains unavailable.

The final resident threat-wake test passes along with the relevant civilian morale, cloud-pool and disco lifecycle tests (14 targeted checks). TypeScript and production build 29 pass. The full 170-test run preceded this small resident scheduling correction; its new regression check is verified separately. Stage-28 CPU results are preserved as `PERFORMANCE_CPU_STAGE28.json`; the last controlled CPU run updates `PERFORMANCE_CPU_RESULTS.json`.

## Foreground auditing, save ownership and graphics recovery

Safari reports `PERFORMANCE_NATIVE_1791159174170.json` and `PERFORMANCE_NATIVE_1791159690930.json` include the reduced cloud-pool and resident threat-wake fixes. Both fail every complete gate. The latter records foreground fraction 1.0 in every case; visible, focused playback still fails. Earlier failures remain available without attributing their variability to an unverified cause.

| Monsters | Scenario | FPS / 1% low | Frame p99 ms | Main p95 / p99 ms | Simulation p95 / p99 ms | Capture max ms |
|---|---|---|---|---|---|---|
| 120 | flight | 59.49 / 26.7 | 26.0 | 5.0 / 6.0 | 3.0 / 6.0 | 2.0 |
| 120 | nuke | 47.77 / 13.7 | 50.0 | 12.0 / 16.0 | 14.0 / 20.0 | 5.0 |
| 120 | laser | 54.31 / 22.1 | 35.0 | 6.0 / 8.0 | 11.0 / 17.0 | 7.0 |
| 400 | flight | 58.31 / 16.0 | 35.0 | 5.0 / 8.0 | 5.0 / 11.0 | 2.0 |
| 400 | nuke | 33.50 / 7.8 | 96.0 | 25.0 / 32.0 | 49.0 / 115.0 | 39.0 |
| 400 | laser | 54.18 / 18.9 | 35.0 | 8.0 / 10.0 | 15.0 / 28.0 | 15.0 |

Chrome report `PERFORMANCE_NATIVE_1791161206683.json` records foreground fraction 1.0 in all six cases, after explicitly selecting and raising the test tab. It includes revision-cached current terrain bounds and scalar packet-tag rubble preparation. All average-FPS and frame-p99 gates pass, and all complete gates still fail. Asynchronous native GPU elapsed p95 ranges from 8.7 to 13.8 ms; this remains distinct from a vendor-native capture.

| Monsters | Scenario | FPS / 1% low | Frame p99 ms | Main p95 / p99 ms | Simulation p95 / p99 ms | Capture max ms |
|---|---|---|---|---|---|---|
| 120 | flight | 59.97 / 54.0 | 17.7 | 5.4 / 7.8 | 3.0 / 6.3 | 2.2 |
| 120 | nuke | 59.67 / 37.4 | 17.7 | 11.3 / 14.7 | 16.0 / 24.5 | 10.6 |
| 120 | laser | 59.87 / 46.9 | 17.7 | 6.3 / 8.0 | 7.2 / 11.3 | 1.6 |
| 400 | flight | 59.94 / 51.4 | 17.7 | 5.9 / 7.2 | 3.9 / 7.3 | 1.0 |
| 400 | nuke | 59.77 / 41.9 | 17.7 | 10.0 / 12.9 | 14.7 / 20.3 | 5.1 |
| 400 | laser | 59.94 / 51.3 | 17.7 | 7.0 / 9.7 | 10.7 / 18.9 | 3.1 |

Full build-34 regression verification passes 178 tests in 38 files with the disclosed 60-second per-test timeout (`/tmp/siege-all-tests34.log`). TypeScript and production build pass. New checks cover cancellation of warmup/query ownership, terrain-bound conservatism and invalidation, direct packed roof rendering without wrapper reads, and stale save completion across reset/new capture.

Native Chrome context loss/restoration passes. GPU timing support is reacquired and shader preparation finishes while paused; the restored playable scene is saved as `PERFORMANCE_SCENE_1791160986219.png`. No browser errors were recorded. Complete native photo-mode and all-species viewpoint coverage remain outstanding.

Damage commits now run in a dedicated storage worker. Reset/replacement await retirement, invalidate yielded preparation and abort active transactions before changing the baseline. Native Chrome passes all eight storage/migration/reset checks through this worker-backed path. Three client/transaction tests and the two capture-coordinator tests pass; build-35 TypeScript and production build pass. Ordinary worker commits preserve the caller buffers and only acknowledge journals after the committed reply.

Controlled CPU stage 33 is preserved as `PERFORMANCE_CPU_STAGE33.json`; it precedes the latest allocation reduction in rubble consolidation. That reduction avoids orientation/cell allocations when unnecessary and replaces temporary candidate arrays with scalar nearest selection. A reference test checks 150 full cells against the previous selection path, preserving merge identities, material, location and volume. This is specific rubble equivalence, not the outstanding end-to-end destruction-reference check.

## Storage-worker hardening and final correctness checks

The full build-36 suite passes **182 tests in 40 files**, with `--maxWorkers=1 --testTimeout=60000` (187.0 seconds, `/tmp/siege-all-tests36.log`). Build-38 TypeScript and production build pass. Five selected save-worker/capture checks pass after adding explicit dispatch preparation timing.

Report `PERFORMANCE_NATIVE_1791162233154.json` measures worker-backed persistence and the allocation-reduced rubble merge. Foreground fraction is 1.0 throughout, but all complete gates still fail. One short formatter invocation overlapped the latter portion of this intermediate run; it is not used as final certification. The following build additionally counts save-buffer copying and message preparation that execute in a microtask after the initial message-handler call. Those costs were represented in frame delivery before, but were not explicitly added to the main-work stage.

Each new native case now pauses, finishes its outstanding capture/commit and clears only the disposable test damage before resetting simulation capture IDs. This removes carry-over storage state between cases. Baseline and preferences remain intact. The change is confined to the benchmark workflow.

GPU timing follows the asynchronous availability/disjoint checks in the [WebGL timer-query specification](https://registry.khronos.org/webgl/extensions/EXT_disjoint_timer_query_webgl2/). Shadow scope and scheduling account for the repeated caster renders described by [Three.js](https://threejs.org/manual/pages/shadows.html).

## Direct worker persistence and dense pose cache

The full build-41 suite passes **187 tests in 41 files** (201.85 seconds, `/tmp/siege-all-tests41.log`, `--maxWorkers=1 --testTimeout=60000`). TypeScript and production build 42 pass. All ten native storage checks pass, including direct captures, retirement before delivery, atomic migration, failed transactions and reset. Fatal errors retire capture ownership and close the writer.

Ordinary save payloads now travel from simulation directly to storage through a one-shot MessageChannel. The UI receives only committed revision/hour/capture metadata and timing arrays. Capture measurements now include the synchronous payload-cloning time in the simulation worker; storage timings measure preparation and commit in the storage worker. Main dispatch preparation is recorded separately. Neither transferred baseline buffers nor pose-cache arrays are aliased.

Simulation updates a dense body-pose cache while advancing existing rigid/ballistic physics. Packet packing uses native contiguous copies in the existing 50-byte ABI. Membership handoffs and swap deletion repair ID mappings without changing physics iteration order. Controlled CPU stage 39 records nuke snapshot p95 of 0.36 ms for both populations, compared with 2.94/3.05 ms in stage 33. Tick costs remain over budget, and occasional capture slices exceed 2 ms. Raw stage 39 is preserved as `PERFORMANCE_CPU_STAGE39.json`; it tests simulation/capture CPU and excludes browser channel dispatch.

Auto now ignores paused cadence and requires fresh active overload/headroom after resume. Its CPU average includes full preparation/submission once per frame. Reports 38 and 39 remain retained as `PERFORMANCE_NATIVE_1791162579455.json` and `PERFORMANCE_NATIVE_1791163669592.json`; all complete gates fail.

Report `PERFORMANCE_NATIVE_1791164514334.json` measures the direct-channel build with foreground fraction 1.0 in every case. It passes all average-FPS and frame-p99 gates. Both flight cases pass the 1% low gate, but **every complete gate fails**. No builds, tests or CPU benchmarks ran concurrently with this timed matrix. It precedes the final 256-meter ruin batching change.

| Monsters | Scenario | FPS / 1% low | Frame p99 ms | Main p95 / p99 ms | Simulation p95 / p99 ms | Capture max ms | Main dispatch max ms |
|---|---|---|---|---|---|---|---|
| 120 | flight | 60.0 / 56.4 | 17.7 | 6.0 / 8.7 | 3.5 / 8.6 | 1.6 | 1.0 |
| 120 | nuke | 59.3 / 27.5 | 17.6 | 11.4 / 13.9 | 18.3 / 25.2 | 6.2 | 0.2 |
| 120 | laser | 60.0 / 54.1 | 17.6 | 7.2 / 11.0 | 10.0 / 20.7 | 13.0 | 0.2 |
| 400 | flight | 60.0 / 56.4 | 17.7 | 5.8 / 7.7 | 5.0 / 8.2 | 3.6 | 0.3 |
| 400 | nuke | 59.7 / 37.6 | 17.6 | 10.7 / 13.1 | 16.1 / 20.5 | 3.1 | 0.2 |
| 400 | laser | 59.9 / 47.3 | 17.6 | 9.0 / 12.0 | 15.0 / 31.5 | 9.6 | 0.4 |

## Final batching verification and interrupted native playback

Build 43 combines compatible permanent-rubble instances in 256-meter groups while retaining 64-meter collision/camera indexes and all ruin records. Batch construction visits neighboring cell sets incrementally rather than allocating a flattened ID list. The new check compares all transforms across sixteen cells and an adjoining batch boundary, then verifies removal. The three selected renderer/resource/recovery files pass nine tests. The full suite passes **188 tests in 41 files** (223.74 seconds, `/tmp/siege-all-tests43.log`, with the disclosed 60-second timeout). TypeScript, production build (`/tmp/siege-build43.log`) and the final whitespace check pass.

Final-build Safari foreground playback began after raising its test window and releasing the completed Chrome test world. Visible intermediate flight/120 and nuke/120 summaries were 57.6 and 42.6 FPS respectively; these are provisional UI observations, not an exported complete report. The Mac then locked, and the computer-use tool reported that it could not unlock it. No attempt was made to bypass the lock or enter credentials. This run is invalid for foreground certification; a fresh Safari matrix and final-build 15-minute soak require manual unlock. Native in-app desktop control remains separately unavailable because of the previously recorded synchronization failures.

The release is **not ready for certification**. Remaining measured costs include active render preparation/submission, ballistic/contact work under sustained nukes, laser/destruction work, and consistent-tick metadata/transfer capture slices. Full independent destruction-reference comparisons, complete native photo/species coverage and vendor GPU captures remain outstanding. None of the failed thresholds are waived, and earlier successful average FPS or correctness checks do not imply steady 60 FPS.
