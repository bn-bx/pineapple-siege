# Base-game simplification verification

The game now uses procedural standard-material scenery, static mills/banners, near/distant tree batches, shared inexpensive ocean/river shading, one directional light, emissive windows, and bounded shared weapon effects. Decorative props, googly eyes, authored surface shaders/assets, reflection rendering, AO, bloom, heat distortion, disco scenery/music, and layered environment audio were deleted.

Application bootstrap delegates settings/HUD, input/photo, island replacement, and saving. Explicit session modes gate playback, photo acknowledgement, preview, and graphics recovery. Renderer ownership is split between world batches, actors, effects, and environment; shared GPU resources dispose once. Weapon handling and destruction queues are separate simulation drivers. Workers, transfer buffers, streaming, interpolation, spatial indexing, collision/support rules, incremental saving, and legacy strike parsing remain.

## Baseline and local work

Before editing, the original source/build and pre-existing modifications were copied to `/tmp/siege-simplification/baseline` and `/tmp/siege-simplification/local-changes.patch`. The original full suite had 353 passing tests and one failure in a windmill presentation fixture without `world.sites`. Presentation-only tests were removed with their corresponding features; retained tests were updated to shared-material/shared-cue behavior. Local ladder/landmark presentation changes were superseded by the requested removal and preserved in the backup. Existing investigation files, original audio sources, and visual-overhaul ledgers were left intact.

The generator, world version 8, save compatibility 9, and generated entity data are unchanged. Preference revision 4 ignores googly-eye preferences and preserves other settings. Live destruction remains fixed defaults plus rapid fire; historical strike profiles still restore.

## Functional results

- TypeScript and production build pass; all three hashed audio assets verify against the built application.
- 283 tests pass across 63 files in the final full run.
- Temporary reference tests against the original simulation pass for cannon, nuke, and laser. Serialized pending state matches before reload; final removed identities, terrain bytes, civilians, and monsters match after reload.
- `scripts/check-island-browser.mjs` passes with no browser errors: saved damage/reload, preview and seed links, replacement cancellation, failed writes, reset, mobile preview, generation failure, unavailable storage/temporary play, and protected historical saves.
- `scripts/check-simplification-browser.mjs` passes with no browser errors: simultaneous touch steering/fire/boost and release, cinematic controls, photo/pause freezing, camera movement, focus, PNG export, and forced WebGL context recovery.
- Visual captures confirm recognizable [castles](SIMPLIFICATION_CASTLE.png), [windmills](SIMPLIFICATION_WINDMILL.png), [watermills](SIMPLIFICATION_WATERMILL.png), [laser feedback](SIMPLIFICATION_LASER.png), and [nuke damage/clouds](SIMPLIFICATION_NUKE.png), alongside settlements, forests, water, monsters, and cannon impacts. The isolated visual review completed without browser errors.
- Synthetic inspection snapshots now copy packed buffers and clear worker slot ownership, avoiding duplicate recycling during laser inspection. A transferable-buffer regression test passes.
- Browser inspection found an existing context-recovery ordering problem. Recovery now begins in the next task after Three.js rebuilds context caches, avoiding old-context texture uploads and stalled compilation.

## Matched native measurements

Measurements use isolated Chrome sessions, the same seed 41729, requested Auto quality, 1280×800 viewport, 1200 m detail distance for matrix runs, and the harness's unchanged flight/rapid-fire strike schedule. Actual adaptive resolution is reported; it can differ because load differs. CPU tests and other browser runs are stopped during native measurement. Each combat case includes 60 seconds of recovery. The stress soak runs 400 monsters with rapid-fire mixed strikes for 15 minutes plus 60 seconds of recovery at 3000 m detail distance.

The matrix completed with no JavaScript errors and 100% measured foreground time. Entries below are baseline → simplified. Adaptive quality ended at 720p before and 900p after; both runs requested Auto.

| Scenario         | Main mean ms | Frame p99 ms | Worker p95 ms | Draw calls | Geometries | Textures |
| ---------------- | ------------ | ------------ | ------------- | ---------- | ---------- | -------- |
| Flight, 120      | 4.25 → 2.87  | 17.8 → 17.7  | 2.8 → 2.8     | 191 → 183  | 627 → 524  | 52 → 17  |
| Rapid nuke, 120  | 3.59 → 3.08  | 17.7 → 17.7  | 3.2 → 3.9     | 181 → 187  | 600 → 497  | 52 → 17  |
| Rapid laser, 120 | 3.47 → 2.78  | 17.7 → 18.7  | 4.6 → 5.8     | 163 → 150  | 600 → 498  | 52 → 17  |
| Flight, 400      | 3.41 → 2.97  | 17.7 → 18.7  | 3.8 → 5.4     | 208 → 212  | 625 → 524  | 63 → 17  |
| Rapid nuke, 400  | 3.55 → 2.89  | 17.7 → 18.7  | 3.8 → 4.0     | 202 → 208  | 600 → 498  | 52 → 17  |
| Rapid laser, 400 | 3.46 → 2.83  | 17.7 → 18.7  | 6.0 → 6.6     | 175 → 172  | 600 → 498  | 52 → 17  |

Main-thread means improved 13–33% across the matrix. Presentation resources and asset residency decreased. Frame tails and worker time did not uniformly improve; higher effective resolution, machine load, and a single before/after run limit causal claims. Only simplified flight at 120 monsters passed every harness gate; all baseline cases and the other simplified cases failed at least one gate. The larger scenarios therefore remain uncertified.

Production output, including the unchanged world tiles, decreased from 127,153,994 to 49,382,528 bytes (61.2%). JavaScript decreased from 3,829,165 to 3,378,437 bytes (11.8%). The largest remaining JavaScript payload is the preserved physics worker.

Both 15-minute stress soaks plus recovery completed with no JavaScript errors and 100% measured foreground time. Both settled at 720p and failed the full performance gate.

| Stress soak metric                       | Baseline         | Simplified       |
| ---------------------------------------- | ---------------- | ---------------- |
| Mean FPS                                 | 59.96            | 60.00            |
| 1% low FPS                               | 50.39            | 53.01            |
| Frame p95 / p99 ms                       | 18.6 / 18.7      | 18.6 / 18.7      |
| Worst frame ms                           | 68.3             | 34.6             |
| Main mean / p95 / p99 ms                 | 4.44 / 6.4 / 8.9 | 3.61 / 5.0 / 6.5 |
| Worker mean / p95 / p99 ms               | 3.04 / 5.8 / 9.8 | 3.06 / 5.8 / 9.0 |
| Final draw calls / geometries / textures | 267 / 773 / 52   | 276 / 673 / 17   |
| Final shader programs                    | 489              | 167              |
| Estimated final texture residency MiB    | 89.71            | 47.07            |
| Final geometry storage MiB               | 55.76            | 46.16            |
| Final render targets MiB                 | 31.93            | 30.15            |
| Recovery main mean / p99 ms              | 3.79 / 7.0       | 3.30 / 5.7       |

The soak reduced main-thread mean by 18.5% and p99 by 27.0%; worst frame roughly halved. Worker cost remained similar, and the 1% low plus worker/main tail gates still fail. Draw calls and triangle counts did not decrease uniformly. At the final sample, both runs had zero pending destruction jobs, moving bodies, ballistic bodies, permanent ruins, and cosmetic fragments; simulation ratio was approximately 1.0. Wall-clock input scheduling produced different shot totals, so the soak's final damage counts are not a deterministic equivalence comparison.

Resource-accounting correction: the captured simplified reports omitted the authoritative height and wet textures because standard-material uniforms are not enumerable material properties. Their fixed 47,216,645 bytes are now included explicitly in runtime accounting. The JSON retains the captured `reportedResidentTextureBytes` alongside corrected estimates. This affects memory estimates, not timings or the failed gate outcome; both corrected estimates remain below the 192 MiB budget. Full measurements are in [SIMPLIFICATION_BENCHMARKS.json](SIMPLIFICATION_BENCHMARKS.json). Performance certification is a separate measured outcome; simplification alone does not certify the existing release gates.

## Reproduce

Build and run Vite preview on port 5177. Browser scripts accept `PLAYWRIGHT_MODULE` and `CHROME_PATH`; install Playwright separately or point to an existing package.

```sh
node scripts/check-island-browser.mjs
node scripts/check-simplification-browser.mjs
node scripts/benchmark-simplification-browser.mjs after matrix
node scripts/benchmark-simplification-browser.mjs after soak
```

For a separately served baseline build, set `SIEGE_BENCHMARK_URL` and use label `baseline`. Outputs are under `/tmp/siege-simplification/<label>`. Keep native runs in the foreground, one at a time. Functional browser checks use isolated, disposable browser contexts. Production release details are recorded in [DEPLOYMENT.md](DEPLOYMENT.md).

## Pause-menu correction

Graphics, Audio, and World previously started collapsed without visible disclosure indicators. All four groups now start expanded, with explicit plus/minus indicators and a responsive two-column/one-column layout. Obsolete section grid areas and unused menu CSS are removed. `scripts/check-pause-menu-browser.mjs` verifies every retained setting is visible and enabled after pausing at desktop and mobile sizes, along with keyboard disclosures, Advanced diagnostics, resume/pause, and retained mute/rapid-fire values. This closes a visibility gap in the earlier browser checks.
