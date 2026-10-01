# Pineapple Siege — polish verification

## Implemented

- Visible rename; existing IndexedDB database and world version 4 retained.
- Grouped settings and persistent graphics/audio/hold-time preferences. One-time Valley-scale preference migration.
- Weapon selectors, cooldown bar, AGL height, objects-destroyed counter, and fading successful saves.
- C toggles live cinematic shots; P enters acknowledged, frozen photo mode with free camera, FOV, and PNG export.
- Shared-buffer layered engine/material audio, 24 ordinary voices and four nuke voices; reset clears transient sound.
- Shared fracture texture atlases, stable crater strata, and 256 pooled dust puffs.
- Spatial camera candidate queries and reduced per-material body-instance allocation. No new firing restrictions.

## Functional checks

36 automated tests passed across six test files, including preference migration, camera cycling, normalized photo movement, existing terrain/destruction tests, and unrestricted firing.

Chrome browser reports:
- `browser-report.json`: 14 checks passed (branding, preferences, camera transitions, photo freeze/export, reset, ruined saves).
- `edge-report.json`: eight checks passed (audio, active-blast freeze, focus loss, resize, context recovery, crash camera, repeated reset, GL/errors).
- `failure-report.json`: eight checks passed (missing WebGL, shader failure, unavailable/interrupted storage, incompatible saves, temporary play, drag fallback, day/night sweep).
- `../no-cooldown/report.json`: ten regression checks passed, including 60 shots per simulation second for either weapon and 120 rendered projectiles.
- `pending-save-report.json`: five checks passed. Twenty pending Valley-scale blasts survived reload; restoration completed in 2.124 seconds with 4,573 objects destroyed and zero jobs remaining before flight was enabled. Legacy preferences migrated once; reset cleared transient sound and camera mode.
- `safari-functional.json`: nine native Safari checks passed, including cinematic/photo behavior, save/reset, and graphics errors.

An initial resize assertion ran before the resize event; waiting for the event/frame resolved it. No runtime resize change was needed.

The offline stereo audio overlap test peaked at **0.858** (below clipping at 1.0). Ordinary/nuke voices reached 24/4 and returned to zero after effects ended. Engine layers intentionally continue while flying.

## Performance

Canvas: 1920 × 1080. Standard debris settings, full effects. Chrome used an isolated headless profile; Safari uses the native browser and a separate localhost test origin. The two timed browser runs do not overlap. Reports include sampled worker timing, rendered geometry/texture counts, and main-thread heap where supported. Heap samples exclude worker/WASM/GPU allocations.

| Run | Normal median / p95 | Destruction median / p95 | Worst frame | Simulation / wall time |
|---|---|---|---|---|
| Chrome 153, ten minutes | 16.6 / 20.8 ms | 17.6 / 28.2 ms | 162.6 ms | 589.3 / 600.0 s |
| Safari 26.6.2, ten minutes | 20.0 / 33.0 ms | 29.0 / 55.0 ms | 586.0 ms | 597.0 / 600.2 s |

Chrome fired 615 shots, including 56 normal-cooldown nukes, and destroyed 11,415 objects. Peak sampled physics time was 25.8 ms; destruction processing peaked at 4.5 ms. Peak main-thread heap was 280.8 MB. The final save was 8.00 MB, with 14,206 rubble records. Body/cloud limits held at 256/3. No page or GL errors occurred. Chrome's normal median and destruction p95 meet the approximate 60/30 FPS targets, with occasional visible stalls and some simulation slowdown.

The Chrome timed report precedes final color-only fracture tuning, weapon-button CSS, preference-write failure isolation, and reset sound cleanup; the rendering/destruction workload is otherwise the same.

Safari launched 624 shots including 57 nukes, destroyed 11,410 objects, and saved 7.86 MB. Peak sampled physics/destruction work was 14.8/4.0 ms. Heap memory is unavailable in Safari; `maxHeap: 0` means unavailable, not zero usage. Bodies/clouds stayed within 256/3. Its approximately 50 FPS normal median and 55 ms destruction p95 do not meet the 60/30 FPS goals at fixed 1080p; Balanced/Auto can reduce rendering cost. World simulation stayed close to real time.

Safari's harness recorded one unexpected pause at 416 seconds and automatically resumed. Its cause was not captured, so this is a limitation of the run rather than a claimed clean uninterrupted session. Functional tests separately confirmed the intended pause/focus recovery paths; no JavaScript exception or WebGL error was reported in the timed run.

### Unrestricted firing

A separate 60.1-second Standard-debris run launched **2,988 shots** with no cooldown or projectile/job admission limits. It alternated weapons every ten seconds. During the latter half, median/p95 frames were **32.4/54.4 ms**; the worst frame across the full run was 101.8 ms. Simulation advanced 50.1 seconds. This workload does **not** maintain real-time simulation or the destruction p95 target.

Peak pending jobs: 450; saved unfinished jobs: 318. Bodies stayed at/below 256 and cosmetics at/below 4,096. Peak main-thread heap was 277.6 MB and the saved world was 4.06 MB. No page or GL errors occurred. The report's `nukes` field uses cooldown transitions and is inapplicable to unrestricted mode; use total `stats.shots` for this run. Its `normal` column is the first-half timing window, not a no-fire baseline.

Unlimited fire intentionally permits projectile and damage-queue growth. Long or Extreme runs can slow substantially and accumulate more queued work. The polish pass does not promise a fixed performance ceiling for that mode.

## Visual artifacts

- `before-castle.png`, `before-crater.png`: preserved screenshots from the preceding world build; cameras/blasts are not pixel-matched.
- `entry.png`, `cinematic.png`, `photo.png`: interface, live showcase camera, clean exported image.
- `castle-12.png`, `castle-18.5.png`, `castle-0.png`: daylight, sunset, and night inspections.
- `intact-close.png`, `dust-and-fragments.png`, `crater.png`: intact castle, lingering effects, and settled cratered ruins.

## Reproduction

Build with `npm run build`. Run `python3 checks/polish/serve.py` for a loopback-only benchmark server on port 4185. Open `/benchmark.html?browser=safari&seconds=600` in Safari and click Start benchmark. Chrome harness: `node checks/polish/run-chrome.cjs`; use `STRESS=1 RUN_SECONDS=60` for rapid fire. Browser scripts require Playwright and the installed Chrome executable. Harnesses and reports are not shipped in `dist`.

Safari WebDriver was unavailable because remote automation is disabled. Native UI navigation and the local test harness provide Safari verification without changing that security setting.
