# Controls, fortress and nuke verification

Host: Apple M1 MacBook Air, 8 GB RAM. Production build served locally by Vite preview. No Cloudflare deployment was performed. Browser test profiles are disposable; the existing Safari world was preserved using temporary play.

## Functional coverage

- 16 simulation/render tests cover independent steering reversals, keyboard and boundary turn directions, independent cooldowns, yield capture, respawn, supported baseline structures, a clear ten-second spawn approach, all three nuke profiles, restoration of unfinished destruction, swept nuke water impacts, bedrock, real terrain collision, structural support, tree/bridge damage, bounded bodies, rubble reactivation, and terrain seams/normals.
- Terrain regression checks also verify that in-place mesh updates retain geometry, match canonical collision samples on shared borders, and restore original material colors after reset.
- All 16 Chrome interaction checks pass, covering persisted preferences, brief clicks/Space presses, weapon keys, cooldowns, pausing, saved queued damage, reset, cloud limits and graphics errors.
- All 21 recovery checks pass, covering focus loss, saved destruction, confirmed reset, WebGL context restoration, resize and local-only runtime requests.
- All eight failure checks pass, covering missing WebGL 2, shader failure, disabled/interrupted storage, incompatible saves, temporary play, drag steering and a complete accelerated day/night sweep.

Machine-readable reports and executable checks are alongside this file. Browser scripts require Playwright as a development test tool; it is not included in the shipped application.

## Performance methodology

`stress.cjs` runs at fixed 1920 × 1080 in installed Chrome, with Safari's 3D tab hidden. The final run also unloads the idle in-app preview; the initial run had that preview paused in the background. It circles the fortress at 320 meters, measures 30 seconds without firing, then switches between Valley-scale nukes on their ten-second simulation cooldown and continuous cannon fire. It uses actual weapon releases and collisions, rather than injected blasts. Frame times come from requestAnimationFrame. Limits and worker statistics are sampled every half-second, so their reported maxima are sampled maxima. Main-page JavaScript heap excludes worker, GPU and total process memory.

The initial five-minute measurement is retained as `baseline-stress-report.json`. Normal-flight median/p95 were 16.7/16.8 ms. Destruction median/p95 were 16.7/50.0 ms, with a 316.6 ms worst frame and 190 frames over 100 ms. It completed 26 nukes, 278 total shots and 7,273 removed components, with no page or WebGL errors. The performance target did not pass.

That result prompted two optimizations: crater updates now modify existing vertex buffers instead of reconstructing mesh topology; neighboring rubble sections share render batches. Cloud disposal now explicitly releases instance buffers. A second five-minute run (`mesh-optimized-stress-report.json`) reached 16.7/33.4 ms median/p95 during destruction, but retained 300 ms spikes. That led to packing terrain saves into transferable Float32 buffers to reduce autosave cloning and allocation. Final measurements are in `stress-report.json` and are summarized below.

## Delivered-build Chrome result

Chrome 153.0.8010.54, fixed 1920 × 1080, 301.4 seconds. The Mac was unlocked; the Safari game was hidden and the idle in-app preview unloaded. Build hashes are in `build-sha256.txt`.

| Phase | Median frame | p95 frame | p99 frame | Worst frame |
| --- | ---: | ---: | ---: | ---: |
| Normal flight | 16.7 ms | 16.8 ms | 16.8 ms | 33.4 ms |
| Repeated Valley-scale destruction | 16.7 ms | 16.8 ms | 33.4 ms | 183.2 ms |

The measured Chrome normal-flight and destruction targets passed for this route. Median and p95 were approximately 60 FPS. One destruction-phase frame exceeded 100 ms; occasional impact stalls have not been eliminated. This is a five-minute stress run, not a guarantee for every viewpoint or unlimited sessions.

- 27 actual nuke drops; 297 total shots; 7,410 destroyed components.
- Peak sampled active bodies: 154/256; detailed clouds: 3/3; queued destruction jobs: 1/8. No jobs remained in the final save.
- Largest sampled extra destruction processing time: 3.2 ms. The two-millisecond scheduler budget is soft, not a strict per-tick upper bound.
- 5,305 compacted rubble records. Save payload approximately 2.62 MB, counting packed terrain bytes plus JSON-sized metadata; IndexedDB's physical allocation differs.
- Peak sampled main-page heap: 155.4 MB; garbage collection returned it to roughly 100 MB at the end. Worker/GPU/process totals were not measured.
- No captured page or WebGL errors; no unexpected pauses. Simulation time remained aligned with elapsed real time.

The packed-save run reduced destruction p95 from 33.4 to 16.8 ms and frames over 100 ms from 203 to 1 compared with the preceding five-minute run. Runs had slightly different impact/physics trajectories, so this is a practical comparison, not a controlled microbenchmark.

## Safari and manual limits

Native Safari 26.6.2 loaded the final renderer/control build (before the terrain-save packing change), presented old-save recovery, entered flight at the raised spawn height, accepted a quick Space press for a Castle-leveling nuke, and accepted a mouse click for the cannon. The nuke produced 2,047 destroyed components. The first Escape dismissed Safari's pointer-lock notice; the second paused the game. The original save remained untouched, and the test's strength preference was restored to Local.

With High quality selected, the final flight HUD reported 23 ms median / 34 ms p95 after the nuke, 21 / 38 ms after switching to the cannon, and 26 / 41 ms later in flight. Resolution was 1920 × 976 with the capture notice, then 1920 × 1048 after dismissal. These are rolling 600-frame HUD observations, not a full automated Safari benchmark. Other game previews were unloaded for this final check. No 60 FPS Safari claim is made, and Safari console logs were not captured. The subsequent packed-save change was verified through Chrome save/reload and failure-path tests.

Physical one-finger trackpad feel requires user assessment; automated pointer and drag events test direction and inversion but do not reproduce a person's finger movement. No Safari 60 FPS claim is made.

## Screenshots and delivery

- `entry.png`: simplified entry menu.
- `castle.png`, `courtyard.png`, `castle-night.png`: enlarged fortress and lighting.
- `cannon-projectile.png`: enlarged cannon pineapple.
- `nuke-cloud.png`: golden smoke body and green crown.
- `ruins.png`: aftermath and cratering.

The modular source and `dist/` are ready for static hosting. `README.md` describes controls, development commands, Cloudflare Pages configuration and version-3 save recovery. Historical reports under `checks/jet/` belong to the previous build and must not be used as measurements of this update.

## Deliberate limits

Destruction uses prepared components and simplified grouped rubble. Clouds are instanced smoke puffs, with at most three detailed clouds. Jobs use a soft two-millisecond budget: completing one terrain section or support assembly can exceed it. Physics remains capped at 256 active bodies; excess damage becomes compacted static ruins. Water retains the existing connected-basin flooding and depth-tint approximation rather than full underwater refraction. No multiplayer, health/radiation system or deployment was added.
