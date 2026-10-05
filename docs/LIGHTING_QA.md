# Lighting and environment verification

The game now has a clear terrain horizon, coordinated stylized sunsets and twilight, warm village windows and lamps, and matching cloud and water colors. This pass does not change gameplay, world generation, saved entities, or save compatibility.

## Implementation budgets

- Four unshadowed local point lights remain allocated; nearest-source selection reuses fixed arrays and lights fade before moving. Lamps and house window decorations use two instanced draws. Decorations belong to existing walls and disappear when those owners are removed; fractured windows remain dark.
- The shared lighting calculation supplies reused colors and vectors from the authoritative simulation hour. Cloud and water animation use simulation time, preserving pause/photo mode. Disco and laser atmosphere controls remain connected. Paused time/camera changes invalidate reflections without raising active reflection frequency.
- The existing coarse terrain covers the whole island in worker and fallback modes. Coverage returns on detach and disappears on cached reattach. Detailed objects and river reaches retain distance culling while the camera far plane covers the terrain horizon.
- Coarse damage refreshes are coalesced and consume at most 0.35 ms of the available optional update budget. Base colors are cached, bounds reserve excavation depth, and packet handling does not rescan geometry. Save restoration refreshes the coarse surface and clears pending work.
- Existing Auto quality, shadow sizes, and shadow/reflection intervals remain in use. No extra reflection, shadow, bloom, or volumetric pass was added.

## Correctness and visual review

The full suite passed **205 tests in 48 files**. After the final backdrop scheduling optimization, the affected terrain suites passed **5 tests** again. TypeScript, the production build, and whitespace checks passed for the final implementation.

New tests cover lighting continuity and periodicity, stable light selection, source fading, destruction and restoration, house decoration ownership without world mutation, dark window debris, tile detach/reattach, worker failure, fallback coverage, budgeted damage refresh, and restored terrain heights. The prior detailed-tile test now also accounts for the persistent backdrop.

Chrome visual review covered sunrise, midday, sunset, twilight, and midnight across representative ground and high-altitude views; 600, 1200, and 3000 m detail distances; villages, coastline, and mountains. No shader errors were observed. [Sunset preview](LIGHTING_SUNSET.png) and [night preview](LIGHTING_NIGHT.png) record village illumination. The native flight cases exercise moving terrain residency; tests cover worker failure and save restoration.

## Native performance method

The unchanged baseline was built before editing. Final runs use the same isolated test database, seed, Auto graphics, 1200 m distance, audio, autosaves, and six foreground 30-second cases (flight, nuke, laser; 120 and 400 monsters). Browser viewport dimensions are compared within each browser. No heavy shell checks ran during timed playback.

Baseline reports: [Chrome](PERFORMANCE_NATIVE_1791219138566.json), [Safari](PERFORMANCE_NATIVE_1791221479532.json). Final Chrome report: [optimized build](PERFORMANCE_NATIVE_1791223395198.json). Earlier Chrome reports [inspection run](PERFORMANCE_NATIVE_1791222396238.json) and [fresh-load repeat](PERFORMANCE_NATIVE_1791222664372.json) precede the final backdrop scheduling optimization and are retained for transparency.

Final Safari report: [optimized build](PERFORMANCE_NATIVE_1791223713379.json). All baseline and final cases recorded **100% foreground**. Chrome used a 1440 × 749 CSS viewport; Safari used 1264 × 690, unchanged within each browser.

The 5% frame-p95/p99 comparison passes **6/6 Chrome cases** and **1/6 Safari cases**. Chrome averages 59.6–60.0 FPS with p99 17.7 ms in every case. Safari averages 55.4–59.8 FPS; its heaviest nuke case regresses from 25 to 38 ms p99. **The 5% target is not met across both browsers.** Neither baseline nor final build passes the harness's complete steady-60-FPS certification gates. CPU submission/handler tails remain a concern during destruction; individual 1% lows and maximum stalls are retained in the raw reports. These runs do not establish the cause of every difference or eliminate machine-load and GC variability.

Safari does not expose the asynchronous GPU timer or JS heap measurement used by this harness. Its missing GPU/heap metrics are unavailable, not zero. Chrome peak sampled JS heap over the matrix is 306 MiB in the final run versus 342 MiB in the baseline; this is a sampled GC-sensitive peak, not a leak/soak certification. No new 15-minute soak was run.

All values below show **baseline → final**. CPU is main-thread p95 (render submission plus packet-handler work). GPU is asynchronous elapsed p95. Draw calls are end-of-case samples rather than averages; Auto quality and asynchronous workload can affect them.

### Chrome: frame times

| Case | Average FPS | Frame p95 ms | Frame p99 ms | Within 5% |
|---|---:|---:|---:|---|
| flight/120 | 60.0 → 60.0 | 17.6 → 17.7 | 17.7 → 17.7 | Pass |
| nuke/120 | 60.0 → 59.6 | 17.6 → 17.7 | 17.7 → 17.7 | Pass |
| laser/120 | 60.0 → 59.8 | 17.7 → 17.6 | 17.7 → 17.7 | Pass |
| flight/400 | 60.0 → 60.0 | 17.6 → 17.7 | 17.7 → 17.7 | Pass |
| nuke/400 | 60.0 → 60.0 | 17.6 → 17.7 | 17.7 → 17.7 | Pass |
| laser/400 | 60.0 → 60.0 | 17.6 → 17.6 | 17.7 → 17.7 | Pass |

### Chrome: rendering resources

| Case | Main CPU p95 ms | GPU p95 ms | Draw calls | Geometry count | Peak sampled heap MiB |
|---|---:|---:|---:|---:|---:|
| flight/120 | 6.5 → 6.3 | 11.1 → 10.9 | 260 → 173 | 408 → 394 | 294.9 → 262.1 |
| nuke/120 | 6.3 → 11.8 | 12.4 → 9.5 | 333 → 322 | 399 → 386 | 307.1 → 279.0 |
| laser/120 | 4.7 → 6.9 | 11.8 → 10.5 | 205 → 176 | 400 → 386 | 242.4 → 306.3 |
| flight/400 | 4.9 → 6.1 | 8.2 → 9.4 | 197 → 188 | 484 → 473 | 253.3 → 242.9 |
| nuke/400 | 5.9 → 9.7 | 12.3 → 10.5 | 353 → 220 | 468 → 456 | 342.5 → 244.9 |
| laser/400 | 4.8 → 7.2 | 11.8 → 10.4 | 205 → 176 | 468 → 456 | 276.1 → 249.4 |

### Safari: frame times

| Case | Average FPS | Frame p95 ms | Frame p99 ms | Within 5% |
|---|---:|---:|---:|---|
| flight/120 | 59.7 → 58.5 | 20.0 → 19.0 | 23.0 → 23.0 | Pass |
| nuke/120 | 57.7 → 56.7 | 23.0 → 25.0 | 32.0 → 29.0 | Fail |
| laser/120 | 59.9 → 59.8 | 18.0 → 19.0 | 21.0 → 24.0 | Fail |
| flight/400 | 59.9 → 59.8 | 17.0 → 18.0 | 19.0 → 20.0 | Fail |
| nuke/400 | 59.5 → 55.4 | 21.0 → 26.0 | 25.0 → 38.0 | Fail |
| laser/400 | 59.2 → 59.8 | 18.0 → 20.0 | 24.0 → 23.0 | Fail |

### Safari: rendering resources

| Case | Main CPU p95 ms | GPU p95 ms | Draw calls | Geometry count | Peak sampled heap MiB |
|---|---:|---:|---:|---:|---:|
| flight/120 | 6.0 → 5.0 | unavailable → unavailable | 195 → 172 | 404 → 394 | unavailable → unavailable |
| nuke/120 | 10.0 → 13.0 | unavailable → unavailable | 330 → 300 | 400 → 386 | unavailable → unavailable |
| laser/120 | 5.0 → 6.0 | unavailable → unavailable | 205 → 176 | 400 → 386 | unavailable → unavailable |
| flight/400 | 5.0 → 5.0 | unavailable → unavailable | 198 → 176 | 483 → 471 | unavailable → unavailable |
| nuke/400 | 10.0 → 14.0 | unavailable → unavailable | 261 → 251 | 468 → 456 | unavailable → unavailable |
| laser/400 | 6.0 → 6.0 | unavailable → unavailable | 205 → 176 | 468 → 456 | unavailable → unavailable |
