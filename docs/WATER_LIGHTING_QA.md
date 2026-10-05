# Water and brighter settlement lighting follow-up

This follow-up adds lower lanterns along both sides of castle curtain walls, brighter intact windows, wider local point lighting, terrain-conforming warm ground spill, and brighter moonlit fill. Ground spill uses one instanced draw and the existing height texture, follows terrain changes, disappears with destroyed owners, and is hidden in daylight. The four unshadowed point lights and existing reflection/shadow budgets remain unchanged.

Ocean water now separates shallow turquoise from deeper blue, uses seamless filtered and mipmapped ripples, reduces distorted reflections, and keeps direct sun glints. Rivers share the time-of-day palette and gain flowing surface variation, rippled normals, sky and sun highlights, and depth shading. Original river paths, elevations, wet-mask clipping, world generation, and save formats remain unchanged. Both surfaces use simulation time so pause/photo mode freezes animation.

The disco material wrapper previously overwrote distinct shader cache keys with an identical wrapper function. It now preserves each original program key across decoration and island reloads, preventing custom river and terrain shaders from sharing plain material programs.

## Checks

The complete suite passed 207 tests in 49 files before the final shader-cache fix. After that fix and the final night palette adjustment, all 9 affected tests in 6 suites passed. TypeScript, the production build, and whitespace checks passed. Browser checks showed no shader errors; midnight castles/villages and midday oceans/rivers were inspected at ground and overview height. Tests cover river batching/flow through bends, preserved elevations and wet-mask clipping, original shader keys across island reload, source destruction, and hidden daytime ground spill.

Images: [castle](LIGHTING_CASTLE_BRIGHT.png), [village](LIGHTING_VILLAGE_BRIGHT.png), [ocean](WATER_OCEAN.png), [river](WATER_RIVER.png).

## Performance

The same six 30-second foreground cases were run at Auto quality, 1200 m distance, seed 41729, with audio and autosaving. Browser viewport dimensions match the preceding release within each browser. The final change after timing only adjusts midnight ambient/ground palette values; the benchmark resets simulation hour to 15.5, where daylight is 1 and those night endpoints do not contribute. No rendering logic changed afterward.

The original 5% frame-p95/p99 target remains unmet. Chrome's first five cases average 60 FPS, but p99 rose approximately 1 ms relative to the previous release. The last heavy-laser case runs at 30 FPS. Repeating that case on a fresh follow-up load and on the unchanged deployed renderer both yielded 30 FPS and effectively identical frame tails, so this experiment does not identify that slowdown as a follow-up regression. This is not a guaranteed 60 FPS result or a soak certification. Safari averages 58.5–59.8 FPS, with mixed changes in frame tails. Safari GPU/heap measurements are unavailable.

All values below are **preceding lighting release → follow-up**. Draw calls are end-of-case samples, not averages. CPU is main-thread p95; GPU is asynchronous elapsed p95. Heap is the largest sampled JS heap and is GC-sensitive.

### Chrome

Reports: [preceding release](PERFORMANCE_NATIVE_1791223395198.json), [follow-up](PERFORMANCE_NATIVE_1791227235498.json). Both record 100% foreground.

| Case | FPS | p95 ms | p99 ms | CPU p95 ms | GPU p95 ms | Draw calls | Peak heap MiB |
|---|---:|---:|---:|---:|---:|---:|---:|
| flight/120 | 60.0 → 60.0 | 17.7 → 18.7 | 17.7 → 18.7 | 6.3 → 4.8 | 10.9 → 15.5 | 173 → 166 | 262.1 → 386.2 |
| nuke/120 | 59.6 → 60.0 | 17.7 → 18.7 | 17.7 → 18.7 | 11.8 → 5.7 | 9.5 → 12.1 | 322 → 311 | 279.0 → 250.7 |
| laser/120 | 59.8 → 60.0 | 17.6 → 18.7 | 17.7 → 18.7 | 6.9 → 3.7 | 10.5 → 14.9 | 176 → 171 | 306.3 → 319.7 |
| flight/400 | 60.0 → 60.0 | 17.7 → 18.6 | 17.7 → 18.6 | 6.1 → 4.3 | 9.4 → 13.5 | 188 → 169 | 242.9 → 244.2 |
| nuke/400 | 60.0 → 60.0 | 17.7 → 18.6 | 17.7 → 18.7 | 9.7 → 5.8 | 10.5 → 12.6 | 220 → 317 | 244.9 → 292.2 |
| laser/400 | 60.0 → 30.0 | 17.6 → 35.3 | 17.7 → 35.4 | 7.2 → 5.1 | 10.4 → 15.0 | 176 → 171 | 249.4 → 333.3 |

### Safari

Reports: [preceding release](PERFORMANCE_NATIVE_1791223713379.json), [follow-up](PERFORMANCE_NATIVE_1791227759792.json). Both record 100% foreground.

| Case | FPS | p95 ms | p99 ms | CPU p95 ms | GPU p95 ms | Draw calls | Peak heap MiB |
|---|---:|---:|---:|---:|---:|---:|---:|
| flight/120 | 58.5 → 59.5 | 19.0 → 22.0 | 23.0 → 30.0 | 5.0 → 6.0 | Unavailable | 172 → 168 | Unavailable |
| nuke/120 | 56.7 → 58.5 | 25.0 → 24.0 | 29.0 → 30.0 | 13.0 → 9.0 | Unavailable | 300 → 313 | Unavailable |
| laser/120 | 59.8 → 59.2 | 19.0 → 19.0 | 24.0 → 29.0 | 6.0 → 5.0 | Unavailable | 176 → 171 | Unavailable |
| flight/400 | 59.8 → 59.7 | 18.0 → 18.0 | 20.0 → 22.0 | 5.0 → 6.0 | Unavailable | 176 → 169 | Unavailable |
| nuke/400 | 55.4 → 58.6 | 26.0 → 23.0 | 38.0 → 29.0 | 14.0 → 11.0 | Unavailable | 251 → 215 | Unavailable |
| laser/400 | 59.8 → 59.8 | 20.0 → 18.0 | 23.0 → 23.0 | 6.0 → 5.0 | Unavailable | 176 → 171 | Unavailable |

### Matched heavy-laser repeat

The unchanged production renderer at `f3f0420` was rebuilt separately with identical world assets and the same harness controls, then tested fresh at the same Chrome viewport and settings. These runs both recorded 100% foreground.

| Renderer | FPS | p95 ms | p99 ms | CPU p95 ms | GPU p95 ms | Draw calls |
|---|---:|---:|---:|---:|---:|---:|
| [Unchanged deployed renderer](PERFORMANCE_NATIVE_1791227508223.json) | 30.0 | 35.3 | 35.4 | 5.6 | 14.4 | 176 |
| [Fresh follow-up renderer](PERFORMANCE_NATIVE_1791227385184.json) | 30.0 | 35.3 | 35.3 | 4.8 | 12.7 | 171 |

The earlier 60 FPS measurements are retained in the original release report; this repeat demonstrates sensitivity to current machine/browser conditions without establishing the root cause of the 30 FPS behavior.
