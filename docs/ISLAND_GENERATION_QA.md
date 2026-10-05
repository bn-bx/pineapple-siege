# Island and mountain release QA

New islands use generator revision 2 with world format 8 and save format 9. Existing revision-1 baselines retain their original terrain and identities; PS1 links alias the revised generator.

## Automated checks

- Full release Vitest run: 43 files, 197 tests passed.
- Mountain coverage: 32 fixed seeds, including unsigned seed boundaries; tallest peaks 700–1,000 m, two recorded saddles below 450 m, connected land, descending river beds and confluences, tree elevation limits, safe aircraft spawn, and generator revision compatibility.
- Flight ceiling: 1,500 m, assistance at 1,350 m; HUD warning at 1,250 m with separate 25 m hysteresis thresholds. Height remains AGL; warnings explicitly use sea-level altitude.
- Additional terrain, river rendering, and resource-disposal checks passed after the altitude-fog shader adjustment.
- TypeScript and production Vite build passed.
- Genuine revision-1 baseline browser check passed: preserved historical terrain and damage on reload, retained PS1 sharing labels, reset to the exact old terrain, and saved/reloaded again without changing generator revision. Sea-level warning labels, assistance, and pause visibility also passed.
- Disposable browser integration passed: preview normalization, sharing, replacement/cancellation, transaction failures, reload/reset, temporary play, and legacy recovery; no browser errors.

## Visual checks

Six seeds: 0, 1, 42, 2026, 4294967295, and 41729. Captured overhead previews and coast, mountain, pass, river, crossing, and high-altitude views at 600 m and 3,000 m viewing distances. All six completed with no browser errors. Images are in `/tmp/mountain-qa/` and can be regenerated with `scripts/check-mountain-views.mjs`.

Visual review exposed high-altitude fog hiding terrain at minimum viewing distance. Terrain, river, and ocean fog now use horizontal distance so their fading follows the existing streaming boundary. Camera clipping includes vertical separation. The terrain detail texture is neutralized so rock coloring remains distinct from grass.

## Generation timing

`ISLAND_GENERATION_BENCHMARK.json` compares the working generator against commit `cd08f33533d8b069538cfb1dad851335985777ed` using the same 32 seeds on Node v24.19.0. Both generators were warmed before measurement.

- Revision 1 median: **1,274 ms**, 27 total retries.
- Revision 2 median: **1,083 ms**, 8 total retries.
- Median ratio: **0.850**, approximately **15% faster**; satisfies the maximum 25% slowdown target.

This measures generation CPU time, not browser FPS. Run `scripts/benchmark-island-generation.mjs` with `ISLAND_BASE_REF` and `ISLAND_BENCHMARK_OUTPUT` to repeat the comparison without changing the checkout.

## Mountain variety follow-up

The original revision-2 implementation always used two parallel ridges and two island-wide cuts, producing a repeated six-group silhouette. The revised generator chooses among one long range, separated regional ranges, scattered massifs, and coastal ranges. It varies region count (1–5), region positions and orientations, lengths, widths, summit envelopes, relative heights, and local pass positions. River sources now search across the island so peripheral ranges can feed drainage. Existing stored baselines are not regenerated.

The 32-seed regression measures actual connected highlands above 450 m, requiring at least four distinct group counts and more than 2,000 m of variation in highest-summit position on both axes. Visual follow-up seeds include 0, 3, 4, 7, 42, and 41729 to exercise all four layout styles; captures are in `/tmp/mountain-variety-qa/`.

Follow-up validation passed: 14 generation and mountain tests, 13 additional terrain/world/rendering regressions, TypeScript, and production build. The 32-seed diversity assertions passed. All six follow-up islands completed overhead and seven in-game view captures without browser errors; their previews visibly differ in grouping and island coverage. The benchmark above and its JSON report reflect this revised mountain layout before the footprint follow-up below.

## Ocean margin follow-up

New generation scales the island, its mountain layout, and its recorded pass locations to 94% of their previous width. The 6,144-meter map remains unchanged. New candidates must have 53–62% land; baseline validation still accepts the larger historical PS2 footprint, while revision-1 validation retains its original limits. Existing saved baselines are not regenerated.

Comparison of seeds 0, 3, 42, 4, 7, and 41729 against the preceding mountain generator measured 11–14% less land area, with 44–45% ocean instead of 36–38%. Generation can choose a different deterministic retry when placement constraints require it.

The 32-seed geography/diversity checks, boundary-seed generation, exported-baseline determinism, resident safety, water destruction/restoration, damage compatibility, world loading, historical revision validation, TypeScript, and production build passed. Synthetic larger revision-1 and revision-2 baselines remain valid. The genuine revision-1 browser reload/reset/save round trip also passed. Six seeds completed previews and seven in-game views each without browser errors, including both viewing-distance extremes; images are in `/tmp/island-shrink-qa/`.

## Pineapple defeat follow-up

New defeats separate into body, crown, and two arms, each with its own tumbling physics body and persistent pose. Settled pieces release their physics bodies. Older whole-body saved wreckage remains intact. Piece poses travel with the packed actor buffer, and save captures clone them to preserve snapshot isolation. Detached body faces retain googly-eye support.

Physics settling, piece separation, packed-buffer reuse, defeat persistence, save restoration, rendering resource cleanup, and storage regressions passed. A disposable browser verified visible falling pieces and a four-piece save/reload without browser errors. The final full release suite passed all 197 tests in 43 files, and TypeScript, production build, and browser island lifecycle integration passed.
