# Rendering and responsiveness optimization checks

This pass keeps the existing draw-distance and quality settings, scenery owners, physics rate and save format. These changes are included in production release `smooth-streaming-frame-time-fixes-2026-10-25` (v148).

## Changes

- Preserve the worker snapshot publication phase instead of rounding each deadline up to an 8 ms callback. Physics remains 60 Hz; intended snapshot delivery remains 30 Hz. Missed publication slots are skipped after stalls rather than replayed in a burst.
- Use two snapshot intervals (66.7 ms) of flight interpolation buffering instead of 100 ms. Playback remains monotonic, freezes during pause and never extrapolates beyond authoritative collision states.
- Retain alternate terrain detail meshes in a worker LRU capped at 4,096 entries and 32 MiB of geometry arrays. Edits invalidate cached geometry by revision, and world changes clear the cache. Worker-only scar-refresh color copies are not retained.
- Avoid submitting a second terrain request while that tile has a completed result awaiting installation, and clear obsolete dirty requests once a matching mesh is installed.
- Share distant material/depth-material instances across spatial cells. Skip a distant draw when every owner already has nearby coverage, keeping its instance arrays resident for immediate reuse.
- Scan the full scene for resource statistics only when diagnostics are requested. The benchmark explicitly keeps those scans enabled.
- Correct the built-in flight benchmark's low spawn path, which hit scenery and finished in the death camera. Flight cases now use a terrain-cleared continuous orbit and reject any frames in which the aircraft crashes or falls.

## Checks

37 focused tests across 10 files passed, covering snapshot jitter and latency, publication cadence and stalls, terrain cache reuse/edit/world invalidation, completed-job deduplication, horizon coverage/material sharing, destruction restoration and resource disposal. TypeScript, the production build, and runtime asset verification passed.

## Native browser spot checks

The isolated benchmark used seed 41729, a 693 × 718 CSS viewport, a 1386 × 1436 drawing buffer, Ultra quality and foreground fraction 1. All retained runs had zero crashed frames. Gameplay saves were not used.

| Case | Mean FPS | Frame p95 | Frame p99 | Main-thread mean | Main-thread p99 |
| --- | ---: | ---: | ---: | ---: | ---: |
| Corrected baseline, 120 monsters, 1,200 m, 30 s | 60.00 | 17.6 ms | 17.7 ms | 4.27 ms | 9.2 ms |
| Render/cache changes, 120 monsters, 1,200 m, 30 s | 60.00 | 17.5 ms | 17.7 ms | 4.02 ms | 8.5 ms |
| Including cadence/buffer changes, 120 monsters, 1,200 m, 30 s | 60.00 | 18.4 ms | 18.7 ms | 4.22 ms | 8.2 ms |
| Including cadence/buffer changes, 400 monsters, 3,000 m, 45 s | 59.91 | 18.6 ms | 18.7 ms | 4.81 ms | 13.4 ms |
| Final terrain request deduplication, 400 monsters, 3,000 m, 45 s | 60.00 | 18.6 ms | 18.7 ms | 4.50 ms | 7.6 ms |

In the initial render/cache-only comparison, mean GPU time changed from 9.04 to 8.40 ms. After adding the cadence/buffer changes it measured 9.20 ms, so no consistent overall GPU improvement is claimed from these short runs. Observed mean snapshot delivery intervals changed from roughly 45–46 ms to 34–35 ms (these means include a single startup gap). The configured playback buffer is 33.3 ms shorter; this is not a hardware measurement of end-to-end input latency.

The last 400-monster run retained 3,000 m detail distance at Ultra, with no missed frames in that 45-second sample and simulation cadence close to 1×. Its terrain queue still contained 339 requests during movement; the deduplication guard is correct but these runs do not establish that the far-detail backlog drains faster.

The benchmark's complete certification gates still report FAIL. Main-thread tail latency and estimated memory exceed its budgets; the heavier run's 1% low was 53.5 FPS against a 55 FPS target. Short flight spot checks do not certify long sessions, destruction-heavy combat, or uniform performance across seeds. Resource estimates are unchanged at about 213.3 MiB of texture storage and 85.1 MiB of render targets.

Ignored reports:

- `artifacts/PERFORMANCE_NATIVE_1792963078955.json`: corrected baseline.
- `artifacts/PERFORMANCE_NATIVE_1792963325204.json`: render/cache-only comparison.
- `artifacts/PERFORMANCE_NATIVE_1792963578488.json`: render/cache-only 3,000 m / 120 check.
- `artifacts/PERFORMANCE_NATIVE_1792963784695.json`: cadence/buffer 1,200 m / 120 check.
- `artifacts/PERFORMANCE_NATIVE_1792963924635.json`: cadence/buffer 3,000 m / 400 check.
- `artifacts/PERFORMANCE_NATIVE_1792964281802.json`: final 3,000 m / 400 check.


## Follow-up: visible scenery and terrain handoffs

The local follow-up addresses presentation transitions directly:

- Nearby scenery and the whole-island representation now hand over per entity across a 320 m band. CPU batch attachment/detachment happens outside that band; a 512 m batch no longer changes appearance in a single frame.
- Distant living crowns use the foliage color and texture, matching nearby crowns instead of using the entity's bark material.
- Terrain keeps the previous surface for a 550 ms complementary opaque transition, including the initial coarse backdrop and cached tile reattachment. Old geometry is disposed after the transition. A subsequent LOD waits for the current handover; authoritative damage replaces the surface immediately instead of waiting for a fade.
- Terrain uses the original material once a handover finishes. The extra shader and old geometry are temporary. Blend attributes are reused when geometry changes roles.
- Shadow and photo-depth hooks preserve the same masks. Nearby windows still follow the environment's day/night emission. Destruction and save ownership remain unchanged.

41 focused tests across 10 files passed for this follow-up. TypeScript, the production build and runtime asset verification passed.

The browser viewport for the follow-up was 1280 × 720 CSS pixels, wider than the earlier 693 × 718 spot checks. The 45 s, 400-monster / 3000 m case used seed 41729, stayed foreground and had zero crashed frames. Adaptive quality settled at a 1920 × 1080 drawing buffer, so these runs must not be compared directly with the earlier narrower-window 60 FPS results.

A separate local source copy retained the prior optimization pass but removed this follow-up's scenery/terrain fades. At the same wider viewport it measured 54.76 FPS, 5.40 ms mean main-thread time, and 15.57 ms mean GPU time. The initial fade implementation measured 53.07 FPS, 6.32 ms mean main-thread time, and 15.84 ms mean GPU time. This prompted restricting the terrain fade shader to active transitions. Both runs failed the full performance gates; these short runs do not establish a general speed improvement.

- `artifacts/PERFORMANCE_NATIVE_1792968952018.json`: matched pre-transition source-copy baseline.
- `artifacts/PERFORMANCE_NATIVE_1792968718166.json`: initial follow-up transitions.

Final transition-material lifetime refinement: `artifacts/PERFORMANCE_NATIVE_1792969175682.json` measured 54.94 FPS, 5.53 ms mean main-thread time, 11.30 ms main-thread p99, and 15.62 ms mean GPU time. The average frame rate was effectively unchanged from the matched 54.76 FPS baseline. The 1% low remained 23.5 FPS and full gates still failed. This is a visual handoff fix, not evidence that the wider-view frame-time problem is solved. Runtime logs contained no shader errors or warnings. Screenshot: `/private/tmp/pineapple-popin-flight-check.png`.


## Follow-up: frame-time spikes

This pass continues beyond the visual handoff fix.

- Warm both ordinary terrain and transitioning terrain with their actual mapped, non-instanced shadow layouts before play, including the shared laser projection. The earlier report recorded an 86.4 ms shadow submission and one shader program created in flight. Subsequent profiling runs created zero shadow programs in flight; shadow submission maxima were 3–8.2 ms in the retained samples.
- Auto previously required smoothed frame time above 20 ms, so recurring 33 ms frames among mostly 60 FPS frames did not trigger a reduction. It now also observes raw frame intervals through a two-second exponential window and a decaying GPU peak. Recurring GPU misses must pass the sustained-pressure threshold, with worker/lag checks excluding simulation-only stalls. The final response uses 750 ms of sustained overload after that evidence. Recovery waits at least 15 seconds and requires clean tail/headroom evidence to avoid buffer-size oscillation.
- The first Auto step changes 1440p to 1080p; tree distance, shadow resolution, debris shadows, cosmetic density, draw distance, textures and scenery owners stay the same. Manual quality selections retain their previous behavior.
- Skip coastal foam/offshore-wave noise calculations when their final multiplier is zero. Beyond the fully blended ocean horizon, return the identical backdrop after canonical wet/height clipping and color conversion. Derivative padding protects quad boundaries, and active laser projection retains the full shading path. These water changes alone did not materially improve measured frame-time tails; the Auto change is responsible for the observed tail improvement.
- Diagnostics distinguish shadow-update frames and regular frames, and occasionally sample one GPU pass in a frame. Only whole-frame timing drives Auto. Queries remain asynchronous/bounded and pass sampling is disabled when resource diagnostics are off.
- Benchmark reports retain at most 128 slow-frame records and 128 resolution transitions to identify when stalls occur without growing telemetry indefinitely.

72 focused tests across 18 files passed, with affected Auto/warmup/ocean tests rechecked after the final response tuning. TypeScript, production build and runtime asset verification passed.

The retained frame-spike checks use seed 41729, a 693 × 718 CSS viewport and the continuous flight route, with foreground fraction 1 and no crashes. Auto initially renders 1386 × 1436 pixels and can reduce to 1042 × 1080. The following results include the adaptation period; they are short spot checks rather than long-session certification.

| Case | Frame p99 | Frame >33.3 ms | Mean FPS | Notes |
| --- | ---: | ---: | ---: | --- |
| Warmup fix, 3000 m / 400, 45 s | 33.5 ms | 1.67% | 58.49 | zero in-flight shadow compilation |
| Water optimization, 3000 m / 400, 45 s | 33.3 ms | 0.94% | 58.92 | no clear water-only tail improvement |
| Initial recurring-miss response, 3000 m / 400, 45 s | 18.8 ms | 0.37% | 59.38 | Auto settles at High; response still used 2000 ms |
| Initial recurring-miss response, 1200 m / 120, 30 s | 18.7 ms | 0.45% | 59.60 | ten >25 ms frames at 8.24–9.95 s, before Auto changed at 10.67 s; none after |

The 3000 m run still had a 65.6 ms worst frame and a 29.6 FPS 1% low across the full adaptation period. Normal-distance trace evidence prompted shortening the recurring-miss response; do not interpret p99 improvement as elimination of every isolated stall. Full certification gates still fail, including the texture-memory budget while keeping textures resident.

Reports:

- `artifacts/PERFORMANCE_NATIVE_1792973250064.json`: warmup fix and shadow-frame attribution.
- `artifacts/PERFORMANCE_NATIVE_1792973383102.json`: pass attribution before water changes.
- `artifacts/PERFORMANCE_NATIVE_1792973612028.json`: water guards before Auto response changes.
- `artifacts/PERFORMANCE_NATIVE_1792973901943.json`: initial recurring-miss response, 3000 m / 400.
- `artifacts/PERFORMANCE_NATIVE_1792974105049.json`: initial recurring-miss response, 1200 m / 120 with slow-frame trace.


The faster response was then checked with slow-frame tracing. `artifacts/PERFORMANCE_NATIVE_1792974273206.json` caught a 54.7 ms main-thread frame at the quality transition. Replacing the duplicate `setPixelRatio` / `setSize` calls with one `setDrawingBufferSize`, and deferring it to the next frame, was insufficient: `artifacts/PERFORMANCE_NATIVE_1792974516077.json` still measured 44.7 ms inside the canvas resize itself.

The final implementation therefore keeps the Auto output canvas at a fixed device-pixel size and changes only the internal scene/post-processing resolution. The final pass upscales to the output canvas. `stats.width/height` report internal rendering dimensions; `outputWidth/outputHeight` report the actual canvas. Manual quality still controls its output size. Unchanged sizes skip canvas and target resets; queued Auto resource changes apply before drawing the next frame. Point-sprite sizes are scaled to preserve their apparent size when internal and output resolutions differ. Regression coverage verifies one atomic resize for manual changes, no reset for unchanged dimensions, and no output-canvas resets during Auto scene-resolution changes.


Final fixed-output results:

| Case | Frame p99 | Worst frame | >33.3 ms | Mean FPS | Resize CPU |
| --- | ---: | ---: | ---: | ---: | ---: |
| 1200 m / 120, 30 s | 18.7 ms | 33.9 ms | 0.22% | 59.70 | 0.1 ms |
| 3000 m / 400, 45 s | 18.7 ms | 35.2 ms | 0.15% | 59.72 | 0.1 ms |

Normal flight had no >25 ms frames after Auto changed internal resolution at 20.79 s. The heavy run changed at 7.98 s; its last >25 ms frame was at 8.06 s, followed by about 37 s without one in this sample. The heavy run's first few frames still included startup CPU spikes (41.8 ms maximum main-thread work); the overall 1% low was 39.1 FPS, and the broader certification gates still fail. No claim is made that all browser, startup, or combat stalls are eliminated.

The output stayed at 1386 × 1436 while the scene settled at 1042 × 1080. The heavy case retained 3000 m detail distance, 20 textures and the same High/Ultra object-detail settings. Runtime logs contained no rendering errors or warnings.

- `artifacts/PERFORMANCE_NATIVE_1792974730773.json`: final fixed-output 1200 m / 120 check.
- `artifacts/PERFORMANCE_NATIVE_1792974856860.json`: final fixed-output 3000 m / 400 check (last result in the array). This earlier report's slow-frame/quality-transition arrays also include the previous case; elapsed-time reset separates the segments. The benchmark now clears those diagnostic arrays at each case boundary. Per-case frame/CPU/GPU aggregates were already isolated and are unaffected.
- `/private/tmp/pineapple-frame-spikes-check.png`: final native visual evidence.

Final validation: 75 tests across 19 files passed, including context recovery, GPU-query categorization, raw-frame Auto pressure, unchanged scene-detail budgets, atomic/no-op canvas sizing, fixed-output Auto sizing, point-sprite scaling, water/horizon clipping, terrain transitions, cache invalidation, destruction restoration and resource disposal. TypeScript, production build and runtime asset verification passed. This validation is the release evidence for v148; production deployment additionally requires checking the exact commit, runtime terrain parts, Ready state and Play on the production domain.
