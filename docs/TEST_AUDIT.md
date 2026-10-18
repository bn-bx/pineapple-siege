# Test and legacy-code audit — 2026-10-18

The audit covered application/save coordination, simulation, rendering/audio, world generation, tests, and verification scripts. Three subagents audited separate areas, followed by an independent review of the changes. The initial checkout was clean.

## Evidence for removals

| Removed code or assertion | Evidence of obsolescence | Coverage retained or improved |
| --- | --- | --- |
| `Simulation.moving`, its body-limit getter/constants, and unused pause field | The map was `Map<number, never>` with no insertion path. Pause is owned by the worker. Its old bounds assertions could never fail. | Actual native-body counts, ballistic cleanup, packed snapshot caps, mixed flying/settled admission, and preservation of visual pieces across historical budget settings. The save packet and `stats.bodies` field remain supported. |
| Ragdoll physics constructor parameter and unrelated test worlds | The argument was never read or stored; trajectories use terrain and `advanceDebris`. All callers are internal. Separate test worlds therefore could not observe ragdoll allocations. | Tumbling, landing, bounded mass defeats, corpse suppression, legacy fragment transfer, and simulation-level native-body checks. |
| Old renderer quality fields, geometry allocations, face state, fallback geometry, imports, and unused constructor properties | Strict compiler diagnostics showed no readers. Repository reference searches confirmed the removed API mocks had no implementations. | Resource ownership/disposal, actual resource accounting, camera/quality behavior, and actor rendering tests. |
| `VISUAL_BUDGET` and its equality assertion | The only consumer compared the exported constant to its own fixed value; production did not consult it. | Shared/detached texture and geometry accounting tests. |
| Six old weapon/debris configuration properties and removed control labels | Only their definitions remained; no computed CONFIG access, reflection, or spreading was found. Active values come from `WEAPONS` and current debris limits. | Weapon cooldown/profile, save-profile, debris-cap, and cleanup tests. |
| Version-8 migration branch in `SaveStore.load` | An earlier guard returns every non-current version; `compatible` also requires the current version. The branch could never migrate a record. | Historical records remain untouched for recovery; explicit version 8, 9, and future-version tests verify no write or baseline decoding. |
| PS1 height-limit branches and redundant current-version wrapper in `validateIsland` | Its initial guard rejects every generator except the current version. | Exact generated-baseline equivalence and old-layout rejection checks; genuine historical baselines remain protected by recovery. |
| Former single-world reset implementation and inert `queuedReset` flag | The live game already routed reset through both realms. The old exported reset had no callers and was the only writer that could make the flag true. | The live reset now uses a save-retirement wrapper with deferred-capture and failure regressions. |
| Split historical fixture files | Every historical-fixture consumer reads raw `world.bin`; production splitting is separately tested against `public/`. | Isolated regeneration produced byte-identical terrain and identical metadata after excluding the unused `heightFiles` manifest. Raw historical fixtures remain required. |

A static module graph, including worker URLs and both HTML entry points, reached all 135 runtime modules. No source module or test file was deleted. Historical strike parsing, legacy Web Audio fallbacks, and laser dance behavior were retained because live callers and meaningful compatibility coverage remain.

## Genuine fixes

- Water lookup now accepts exact world-edge coordinates and rejects coordinates outside a partial final cell. Both boundary regressions failed before the fix.
- Reset advances save ownership and prevents new captures before storage retirement can reject an in-flight autosave. Cancellation can no longer disable future saving; failed resets release the gate.
- Temporary island replacement skips second-realm persistence when storage is unavailable. The browser audit reproduced the previous failure as `Island was not replaced: Error: Simulated unavailable storage` before the fix.
- Laser work compacts completed section acknowledgements once per slice, preserving ordered pending IDs and profile identity. The isolated 20,736-section acknowledgement component measured 3,467 ms with per-target filtering versus 5.77 ms with one batch; this is not a full-world timing or performance certification. Ordered partial completion, independent profiles, save/reload, and overlapping strikes remain checked.
- Dry-cell save packing writes directly into a preallocated typed array instead of materializing a boxed iterable. At 21,242,881 samples, the measured component fell from 4,697 ms to 70 ms with exact array equality. The unchanged full-world laser regression subsequently passed in 20.67 seconds under its original 30-second limit.
- Browser harnesses use current generated seed codes while retaining intentional rejection of old/malformed codes. Mountain inspection reads the actual grid/spacing. The Python flight harness accepts the initial preview and opens Advanced controls before interacting.
- Historical browser compatibility checks now exercise protected recovery with a genuine PS1 baseline instead of expecting unsupported layouts to migrate. Native storage checks separately exercise current full/incremental writes, atomic failure, capture retirement, and reset.
- Generator benchmarking copies the complete baseline `.mjs` module set from Git, including the statue helpers that previously caused baseline imports to fail.
- TypeScript now enforces unused locals and parameters during normal builds.

## Verification

- Strict TypeScript compilation, the complete production build pipeline, hashed audio verification (all three assets), and `git diff --check` pass. Checks used the bundled Node runtime because `npm` was not on the shell PATH.
- Exact generated baseline/terrain equivalence and malformed-dimension rejection pass after simplifying generator validation. Historical raw-fixture regeneration was separately compared byte-for-byte and then regenerated for the final suite.
- Native browser storage checks pass all 10 assertions: historical recovery protection, accepted baseline matching, terrain/dry round trips, moving-to-grounded rubble restoration, incremental merge, transaction failure atomicity, direct worker capture, retirement, reset races, and clearing.
- Historical browser recovery passes with an exact PS1 fixture generated from Git revision `42df749`. Baseline, damage, and section fingerprints remain identical through recovery, temporary play, damage, reset, save, and reload; Escape cannot bypass recovery. Browser errors: zero.
- The main island browser harness passed its earlier saved-world/replacement/error/mobile scenarios and exposed the real storage-disabled replacement bug. A focused production rerun verifies seed 17 → 42 replacement returns ready with saving still disabled and no browser errors after the fix.
- All modified JavaScript verification scripts pass syntax checks; the Python harness passes AST parsing. Baseline benchmark module imports and current/unsupported seed inputs were checked directly.
- Final stable-source Vitest run: **494 tests passed across all 98 files**, with no failed tests or unhandled errors. The run regenerated the historical fixture and used the unchanged one-worker/test-timeout configuration. It includes the full-world laser test, direct packing, new reset/save regressions, compatibility checks, and rendering/disposal tests together.

No tests were disabled, no test file was removed, and no timeout was increased. The first maximum-size laser timeout was treated as a real performance problem; the original test passes after acknowledgement batching and direct dry-index packing.

No functional or test blockers remain from this audit. The complete island browser harness was not repeated after its focused repair verification. Other visual harnesses, the 32-seed timing comparison, native foreground performance certification, and long combat soaks were not rerun; this audit does not certify those performance gates.
