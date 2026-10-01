# Lantern Vale verification

Test host: Apple M1 MacBook Air, 8 GB RAM. Tests use the production build served by Vite preview. Results are local observations, not guarantees on other hardware.

## Automated checks

- Ten Vitest checks pass: canonical terrain sampling and bedrock limits, river-connected flooding, support-driven collapse and body limits, settled-rubble save/restore, physics/terrain agreement, swept aircraft crashes, real projectile hits and tree destruction, matching heights/normals across different terrain detail levels after excavation, and supported-neighbor preservation/bridge breaches/rubble reactivation, and horizontal tree orientation during forced settling.
- Chrome 153.0.8010.54: 21 functional checks pass, covering 1080p rendering, firing cooldown, pause, destruction, settling, save/reload, focus loss, confirmed reset, graphics-context loss/restoration, resize, and local-only asset requests.
- Eight failure-path checks pass: missing WebGL 2, shader initialization failure, unavailable IndexedDB, incompatible saves, temporary play without overwrite, aborted saves, pointer-lock rejection, and an accelerated day/night sweep.
- TypeScript checking and the static production build pass. Clean `npm ci` was verified; dependency audit reported zero vulnerabilities.

Machine-readable results and reproducible browser scripts are in this directory. Browser scripts use Playwright and the installed Google Chrome executable; Playwright is a test tool, not a shipped runtime dependency.

## Ten-minute baseline

`baseline-endurance-report.json` records 602 seconds of continuous automated flight, holding fire with the normal one-second weapon cooldown. The first minute circles the castle; later attack runs target towers, the keep, bridge, and forest. Crashes and automatic respawns occur naturally. The test does not repeatedly teleport the jet.

- 1920 × 1080 rendering, fixed quality.
- Median frame time: 16.7 ms; 95th percentile: 33.4 ms; 99th percentile: 49.9 ms.
- Four frames above 100 ms; worst observed frame: 283.3 ms.
- Peak moving bodies: 256, matching the budget.
- 380 shots; 2,131 removed components; 14,466 edited terrain samples.
- Final save: about 888 KB as JSON, including 2,041 compacted rubble records. IndexedDB stores the structured object, so its physical allocation differs.
- Sampled JavaScript heap fluctuated roughly 59–96 MB rather than growing without bound. This is main-page heap only, not total browser/GPU/worker memory.
- No captured JavaScript errors or WebGL errors.

That baseline preceded the final shared terrain-edge stitching and heightfield-collider optimization. See the final endurance report for the later build; the baseline must not be represented as its performance measurement.

## Final-build endurance

The second run completed 604 seconds at fixed 1920 × 1080. It recorded **33.3 ms median, 66.6 ms at the 95th percentile, and 66.8 ms at the 99th percentile**. The worst frame was 1,249.9 ms, with nine frames over 100 ms. **The performance gate failed.** No JavaScript/WebGL errors were captured, the 256-body cap held, and the final snapshot contained 431 shots, 2,114 removed components, 14,593 terrain edits, and 1,978 saved rubble records in an approximately 883 KB JSON save.

This run occurred after the Mac locked, with Safari's game tab still open and measurable browser/window-server contention. Physics-step samples were approximately 2–7 ms, substantially lower than the earlier run, but the overall frame-rate regression cannot be attributed confidently without an isolated unlocked retest. It is not acceptable to claim the 60 FPS normal-flight or 30 FPS destruction targets have been met on the final build. Main-page heap samples ranged roughly 55–120 MB; total process/GPU memory was not measured.

A subsequent pose-only correction keeps forcibly settled trees horizontal. It passed a focused regression test and a rebuilt production bundle; the ten-minute timing run predates that correction. Benchmark bundle hashes and delivered bundle hashes are recorded separately.

## Safari

Native Safari 26.6.2 successfully loaded the production build, captured the mouse, entered flight, crashed and respawned, paused, saved damaged scenery, and offered Continue after reload with the ruined world restored. Safari consumes Escape for its capture notice before passing it to the game.

Performance acceptance is not complete in Safari. Observed HUD readings were 26–30 FPS near the entry view and lower during simultaneous Chrome testing; those concurrent measurements are not a clean benchmark. The Mac locked during verification, preventing completion of native testing. Do not treat the Chrome results as Safari results.

## Fixed-view visual captures

Final castle, river, forest, night, explosion, and settled-ruin screenshots are saved as `final-*.png`. The final captures were inspected for silhouette clarity, terrain seams, visible destruction, water, and night lighting. No page errors were captured in this pass.

Twelve-second fixed-camera render samples at 1080p (simulation paused, same locked/contended host):

| View | Median frame | 95th percentile |
| --- | --- | --- |
| Castle | 33.3 ms | 66.6 ms |
| River | 16.7 ms | 33.4 ms |
| Forest | 33.3 ms | 50.1 ms |
| Illuminated castle | 33.3 ms | 50.0 ms |

These are rendering samples, not normal-flight performance measurements. Details are in `view-report.json`. Build JavaScript hashes are in `build-sha256.txt`.

## Deliberate approximations

- Reflections use a reduced-resolution scene. Underwater appearance uses depth-dependent terrain color and ripples, rather than a full refracted underwater render.
- Structural support is a component graph. Falling groups and compacted ruin piles use simplified shapes; this is not arbitrary mesh fracture or a structural engineering solver.
- Small fragments expire. Capacity pressure can settle older bodies early. Settled ruins preserve visible damage without preserving every original brick.
- Multiplayer interfaces are prepared, but no networking or server is included.
- Cloudflare Pages configuration is documented. Nothing was published to a live Cloudflare project.
