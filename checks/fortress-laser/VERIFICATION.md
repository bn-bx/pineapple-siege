# Grand fortress, persistent rubble, and space laser

## Delivered locally

- Version-5 world: 500 × 550-meter fortress, twelve perimeter/gate towers, roughly 200-meter keep, expanded courts/halls, rear palace, eastward site, relocated logging camp, and safe airborne approach.
- 3,721 castle components; 5,096 structural components and 11,916 total world entities. Every intact assembly passes the rooted-support check.
- Substantial source dimensions survive settling. Section overflow consolidates same-material rubble into rough piles that retain represented material volume. Save capture includes moving pieces even at full section budgets.
- Weapon 3 locks a freshly aimed surface, charges for four seconds, and burns for five. The footprint reaches a 190-meter radius during its first firing second; the completed crater reaches baseline minus 500 meters and remains dry.
- Normal recharge is fifteen seconds after the charge/beam sequence. No cooldown permits one independent release per simulation tick, including overlapping beams. Detailed visual effects select the nearest 64 strikes; farther strikes remain visible as instanced columns. Audio selects four spatial voices.
- Active strikes, queued excavation, final-work acknowledgements, support work, recharge, dry samples, and vaporized source IDs survive save/reload. Older baselines use the existing protected-save recovery prompt. Preferences remain independent.
- Production build created in `dist/`. No deployment performed.

## Automated and browser checks

The final automated suite contains **46 passing tests across seven files**, including the existing flight/destruction/preference regressions and ten new laser/rubble scenarios. Coverage includes exact strike timing, fresh targeting, sixty releases per simulated second, multiple simultaneous strikes, retirement while later strikes continue, charging/burning/final-job saves, volume preservation with overflowing save budgets, outside wreckage preservation, deep rigid-body collision, dry river/edge excavation, subsequent ordinary blasts, and shared terrain edges/normals at unequal LOD.

The production Chrome functional report contains **17 passing checks**, covering actual keyboard firing, selected-weapon HUD, spatial audio, pause/photo freezing, charge and beam recovery, deep-crater reload, confirmed world reset, unrestricted launches and completion, old-save temporary play/replacement, retained preferences, and graphics/page errors.

An initial harness run assumed reset stayed paused and injected old-save data before the game's final pagehide save. The corrected harness explicitly pauses after automatic reset/resume and uses a script-free fixture before injecting recovery data. No product change was required for these harness errors.

## Performance

Chrome 154.0.8037.58, headless installed browser, 1920 × 1080, fixed High quality, Standard debris, full effects. A controlled fortress inspection camera remained fixed while the aircraft was periodically repositioned. The unrestricted phase used actual held weapon input. The run lasted 65.6 seconds; simulation advanced 61.2 seconds. This is a short controlled workload, not a Safari benchmark or an endurance guarantee.

| Phase | Median / p95 | Worst frame |
| --- | --- | --- |
| Intact fortress, 12 seconds | 16.7 / 16.8 ms | 16.8 ms |
| Single laser and aftermath, 18 seconds | 16.7 / 16.7 ms | 16.8 ms |
| Unrestricted overlapping lasers, 20 seconds | 16.7 / 33.3 ms | 166.6 ms |
| Drain/aftermath, 15 seconds | 16.7 / 16.8 ms | 50.1 ms |

- 966 strikes released; peak 600 active/finishing strikes and 86 queued world-work units.
- All laser strikes and queued work drained before the final save.
- Peak sampled extra destruction processing: 7.8 ms. The section/support scheduler has a soft budget; individual units can exceed it.
- Peak sampled main-thread heap: 109.6 MB; worker/WASM/GPU allocations are excluded.
- Final save payload estimate: 894,234 bytes, including typed buffers and JSON-sized metadata. IndexedDB physical allocation differs.
- 72,699 dry samples retained. Zero unexpected pauses, page errors, or captured WebGL errors.
- Rapid unrestricted fire caused occasional stalls and simulation slowdown. Normal flight and a single strike stayed near 60 FPS in this run.

## Visual artifacts and reproduction

`castle.png`, `charge.png`, `charge-night.png`, `beam.png`, `beam-night.png`, and `crater.png` show the fortress, charge, firing, and empty shaft. `stress-final.png` records the end of the timed run. Paused inspection screenshots' rolling HUD FPS is not a benchmark; use `stress-report.json` for timings.

Build the project and serve the production output on `http://127.0.0.1:4206`. Run `functional.cjs`, `visual.cjs`, and `stress.cjs` in this directory with Node. These local harnesses use the bundled Playwright runtime and installed Chrome path on this workstation, launch disposable browser profiles, and are excluded from `dist/`. `functional-report.json`, `visual-report.json`, `stress-report.json`, and `unit-report.json` contain the machine-readable results.

Safari was not rebenchmarked. The existing prepared module, support-graph, and approximate landing model remains; tiny cosmetic chips/dust fade, and later weapon impacts can deposit new rubble in an already-completed laser crater.
