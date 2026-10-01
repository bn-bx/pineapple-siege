# Expanded targets and flying wreckage — verification

Host: Apple M1 MacBook Air, 8 GB RAM. Static production build served locally. Build hashes are in `build-sha256.txt`. No Cloudflare deployment or multiplayer implementation was performed.

## Delivered world and behavior

- 240 × 270-meter fortress, 2,675 castle components; approximately 65-meter major towers and a 100-meter keep.
- 21 additional target locations: four five-building hamlets, three farms, three windmills, two watermills, four watchtowers, two crossings, two logging camps, and a quarry.
- 4,050 constructed components total and 11,415 entities including vegetation and rocks. World/save version 4 uses explicit old-save recovery and preserves separate control preferences.
- Prepared two-to-six-piece fractures; up to 64 substantial bodies per cannon impact and 128 per nuke, within 256 globally. Later debris-driven collapses can produce further bodies within the global cap.
- Instanced solid-looking cosmetic chunks, up to 256 per cannon impact / 1,200 per nuke and 4,096 globally. Material-aware fragments have ballistic motion, terrain sweeps, bounces, and expiration. Lower resolution/reduced effects decrease cosmetic output without changing authoritative damage.
- Nukes eject physical soil/rock, push moving wreckage, reactivate nearby ruins, and scatter excess major ruins to approximate landing positions. The pineapple cloud and shockwave remain.
- Real terrain deformation, collision, bedrock, and connected-basin flooding remain intact; crater contours and exposed-soil/rock coloring are more pronounced.

## Automated functional checks

24 Vitest tests pass. They cover terrain sampling/seams, in-place render buffers, steering, independent weapon cooldowns, yield capture, clear spawn, baseline support, collapse, projectile sweeps, water impacts, bedrock, persistent ruins, and worker restoration. New focused checks cover every landmark class, physical/cosmetic blast budgets, module splitting, rubble reactivation, partially processed support queues, airborne excavation attenuation, a 120 m/s fragment against a thin wall, and representative nuke debris traveling over 200 meters without going below the canonical terrain.

The terrain-travel regression found a streamed-heightfield boundary failure during development. A canonical terrain sweep now backs up Rapier CCD for moving fragments. The support checks caught unattached gate crenellations and mill-wheel segments; those assemblies now pass the intact-world graph check.

Chrome browser checks: 16 interaction assertions, 21 recovery assertions, and eight failure scenarios passed. Reports are `functional-report.json`, `recovery-report.json`, and `failure-report.json`. Coverage includes saved unfinished destruction, reload completion, bedrock, reset confirmation, preference preservation, held/brief fire, effect caps, focus loss, resize, WebGL context restoration, blocked storage, interrupted writes, incompatible saves, pointer-lock fallback, and day/night rendering.

## Timed browser benchmark methodology

`benchmark.html` runs the production game in a 1920 × 1080 iframe. It records requestAnimationFrame intervals for ten minutes: a 30-second normal-flight warmup/measurement, then actual Valley-scale drops on the ten-second cooldown with cannon fire between them. The pilot starts around the castle and moves among distributed landmarks. It does not inject artificial damage events or reset the world during the run.

The loopback-only server `serve.py` stores progress and final JSON reports. The benchmark uses port 4175, separate from the user's normal preview/save origin on 4173. The in-app 3D preview is unloaded and other test scenes are closed for timed runs. Chrome and Safari run sequentially. Safari uses the native installed browser; its WebDriver permission remains disabled. Chrome uses installed Chrome through Playwright with a disposable browser profile.

Stats are sampled every half second, so maximum bodies/jobs/effects are sampled maxima. The diagnostic destruction scheduler is a soft two-millisecond budget: a terrain section or support connectivity traversal may exceed it. Main-page JavaScript heap, when exposed, excludes the worker, GPU allocations, and total process memory. All runtime dependencies remain local.

Both ten-minute runs completed on the recorded build. Native Safari was closed before the Chrome run; the normal preview was unloaded throughout.

## Visual evidence

`castle.png`, `castle-night.png`, and `courtyard.png` show the fortress; `hamlet.png`, `farm.png`, `windmill.png`, `watermill.png`, `watchtower.png`, `crossing.png`, `logging.png`, and `quarry.png` show the distributed target classes. `flying-wreckage.png`, `nuke-cloud.png`, `crater.png`, and `ruins.png` document the blast and persistent aftermath.

## Deliberate approximations

Cosmetic chunks collide with terrain only, cannot hit the aircraft, and are not saved. Major excess rubble uses approximate ballistic landing positions rather than full simulation through intervening buildings. Rubble compaction preserves a bounded ruin representation rather than every brick. Clouds are instanced smoke puffs, not volumetric fluid simulation. Terrain remains a heightfield with a 25-meter excavation limit; there are no caves or overhangs. Windmill blades and mill wheels are breakable assemblies but are not animated machinery. No secondary explosives were added.

## Completed timed results

| Browser | Phase | Median | p95 | p99 | Worst frame | Frames >100 ms |
| --- | --- | --- | --- | --- | --- | --- |
| Safari | Normal | 17.0 ms | 24.0 ms | 28.0 ms | 33.0 ms | 0 |
| Safari | Destruction | 23.0 ms | 38.0 ms | 52.0 ms | 506.0 ms | 6 |
| Chrome | Normal | 16.8 ms | 20.8 ms | 22.5 ms | 28.3 ms | 0 |
| Chrome | Destruction | 18.6 ms | 29.7 ms | 59.8 ms | 102.7 ms | 2 |

### Safari

- User agent: `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6.2 Safari/605.1.15`.
- 600.4 seconds, 58 nuke drops, 629 total shots, 11414 removed components.
- Sampled maxima: 256/256 bodies, 2143/4,096 cosmetic chunks, 3/3 clouds, 1/8 jobs. Bounds passed.
- Largest sampled additional destruction work: 3.0 ms.
- Final 14056 rubble records; approximate save payload 7.59 MiB; 0 saved pending jobs.
- Main-page heap: not exposed by this browser.
- Captured page/rejection errors: 0; final WebGL error: 0.
- Normal-flight median near-60-FPS criterion: passed. Destruction p95 ≤33.5 ms criterion: not met. These are route-specific measurements, not a guarantee for every viewpoint.

### Chrome

- User agent: `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/153.0.0.0 Safari/537.36`.
- 600.0 seconds, 57 nuke drops, 625 total shots, 11413 removed components.
- Sampled maxima: 256/256 bodies, 2131/4,096 cosmetic chunks, 3/3 clouds, 1/8 jobs. Bounds passed.
- Largest sampled additional destruction work: 2.8 ms.
- Final 14127 rubble records; approximate save payload 7.67 MiB; 0 saved pending jobs.
- Main-page heap: 177.1 MiB sampled maximum.
- Captured page/rejection errors: 0; final WebGL error: 0.
- Normal-flight median near-60-FPS criterion: passed. Destruction p95 ≤33.5 ms criterion: passed. These are route-specific measurements, not a guarantee for every viewpoint.

The first 30 seconds measure normal flight around the castle. Later flight revisits increasingly ruined areas, so the destruction aggregate includes both active blasts and settled aftermath. Worst-frame values cover the entire destruction phase; they are not individually attributed to a specific impact. Safari and Chrome expose different timing/memory facilities, and physics trajectories vary between runs. The reports do not measure total-process or GPU memory.

At the final checkpoint, Chrome simulation time was approximately 2.27 seconds behind the 600-second wall-clock run (about 0.38%); Safari remained approximately aligned. The existing catch-up cap can discard time during long scheduling stalls. No sustained worker backlog or unexpected pause was recorded.
