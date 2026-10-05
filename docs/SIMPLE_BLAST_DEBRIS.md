# Simple blast debris

Blasts still excavate terrain, remove structures, resolve unsupported assemblies and defeat monsters. Wreckage is now a visual effect: no Rapier bodies, colliders, CCD or collision damage. It cannot hit aircraft, civilians or buildings. This removes debris-triggered damage and repeated collapse chains.

At most 512 wreckage poses and 512 cosmetic chips are visible. Excess wreckage requests are skipped while the pool is full; structural damage still completes. Existing pieces can be thrown again without extending their cleanup deadlines. Pieces use deterministic launch velocities, quaternion spin and terrain-only bounces. They move for at most six simulation seconds, retain early landing poses, shrink for one second, then disappear. Cleanup is permanent.

Defeated pineapples use one whole tumbling visual pose rather than seven native parts. At most 128 corpses move concurrently; further defeated monsters retain a static pose and follow the same cleanup deadline. Defeated identities, laser vaporization, crater changes and authoritative source dimensions remain save compatible. Older saved rubble clears incrementally.

The HUD shows the bounded wreckage and cosmetic populations. The native performance page includes isolated single-nuke cases with saving enabled and disabled, plus the existing sustained combat cases.

## CPU comparison

The same valley nuke / 120-monster CPU scenario previously reached mean simulation ticks of 8.74 ms in its busiest post-blast second, with 6.53 ms in physics and thousands of ballistic pieces. The simplified implementation measured 0.50 ms and 0.009 ms respectively at that second. Its first post-blast second averaged 2.77 ms including queued destruction work. The largest later one-second average was 0.61 ms. Wreckage stayed at or below 512, native debris bodies stayed at zero, and moving debris cleared by seven seconds.

These are CPU workload measurements on the development machine, not an FPS guarantee across devices. Terrain edits, structural support, active monsters, rendering and saving still have independent costs.

## Browser verification

With 120 monsters, one valley nuke and saving enabled at 900p, the native browser run held 60.0 FPS, a 56.4 FPS 1% low, 17.7 ms p99 frames and zero missed frames. Mean simulation time dropped from 4.12 ms in the prior release to 1.30 ms; p95 dropped from 10.8 to 3.3 ms. The measured physics stage dropped from 2.42 ms mean to 0.047 ms. Per-second simulation/wall-time ratios ranged from 0.967 to 1.033.

The benchmark's combined gate remains false because main-thread p95 was 4.1 ms against a 4.0 ms budget. Frame, simulation, save-slice and foreground thresholds passed. This rewrite addresses debris simulation load; it does not promise lower GPU or other main-thread costs.

Raw reports: `SIMPLE_BLAST_BROWSER_before.json` (previous release), `SIMPLE_BLAST_BROWSER.json` (rewrite), and `SIMPLE_BLAST_CPU.json`. Reproduce the CPU scenario with `npm run benchmark:debris`; browser scenarios are available at `/performance.html`.

The 400-monster stress case sends valley nukes every 100 ms for 30 seconds. It averaged 59.7 FPS, with simulation/wall-time ratios of 0.983–0.998, at most 512 moving pieces and zero native debris bodies. Physics averaged 0.040 ms; total simulation averaged 2.22 ms. It still had occasional spikes (83 ms worst frame, 134 ms worst simulation tick) and failed the combined gate. Bounded wreckage fixes sustained debris physics pressure; extreme terrain/destruction and rendering bursts can still stutter. See `SIMPLE_BLAST_BROWSER_stress.json`.

Validation: all 217 tests across 51 files pass; TypeScript and the production build pass. The existing destruction benchmark also confirms requests for 1,024–8,192 pieces admit at most 512 and create zero native bodies.
