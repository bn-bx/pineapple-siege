# Production deployment

Production is [sweetpickledpineapple.com](https://sweetpickledpineapple.com), hosted by the Cloudflare Pages project `pineapple-siege-git`. Its Pages hostname is [pineapple-siege-git.pages.dev](https://pineapple-siege-git.pages.dev). GitHub's private `bn-bx/pineapple-siege` repository is the source; pushes to `main` trigger production builds.

## Build and release

Cloudflare uses Node 22, `npm run build`, repository root, and output directory `dist`. The build generates terrain parts, hashes audio, checks TypeScript, builds Vite, and verifies runtime assets. There are no Pages Functions or runtime secrets. `public/_headers` makes hashed assets immutable and HTML/world manifests revalidate.

```sh
npm ci
npm test
npm run build
git add <changed-files>
git commit -m "Describe the change"
git push origin main
```

The checkout's local Git SSH configuration selects a repository-scoped write deploy key. Use your own authorized GitHub access on another machine; credentials belong outside the repository. Cloudflare's GitHub App connection is independent of local SSH access.

A push confirms GitHub receipt. Verify the new release on the production domain after Pages finishes building: `/release.json` must contain the intended release, the game must reach Ready and start, and `/world.json` plus every listed terrain part must return successfully. The Pages dashboard exposes build status and logs.

The menu footer displays `v139`, `v140`, and so on, calculated automatically from the number of commits reachable from the build's `HEAD`. Every new commit advances the version when it is built; pushing to `main` publishes it. No manual bump or Git hook is needed. Vite embeds the number in the menu and writes `/version.json` with the version and full commit ID for deployment verification. Shallow build checkouts fetch their full history before counting; a history-fetch failure stops the build instead of displaying an incorrect version. Local uncommitted edits retain the current commit's version until committed and rebuilt (or the dev server is restarted).

## Saves and recovery

Browser saves are scoped to the site origin. Keep the production domain unchanged to preserve players' IndexedDB progress; Pages preview URLs and localhost use separate storage. Do not include generated world files, `dist`, credentials, or local Cloudflare state in Git.

A failed build leaves the last successful production deployment live. Fix the build and push a new commit. For a bad release, roll back through Cloudflare Pages or revert the commit and push; then verify the domain. A dashboard rollback does not change Git history.

## Current release

`terrain-streaming-tree-transitions-2026-10-25` divides distant scenery into spatially culled batches, fades individual trees between detail levels, and updates scenery visibility every frame. Terrain streaming prepares nearby meshes during startup, predicts the flight path without widening the detail radius, accepts useful in-flight detail upgrades, and reserves a small frame allowance for installation and dispatch. World generation and save compatibility remain unchanged. Local browser checks confirmed rendering and an empty terrain queue at flight startup; occasional frame spikes remain, and these checks do not certify sustained performance across all scenes or combat.

Release validation: 552 of 553 tests passed across the full 112-file suite. The monument geometry/resource test exceeded its 30-second timeout under load, then passed alone in 25 seconds with a 90-second allowance. All 36 focused rendering, terrain, tree, resource-disposal and graphics-recovery tests passed, as did TypeScript, the production build and runtime asset verification.

`rolling-island-terrain-2026-10-25` combines revision 7 / world 13 island generation, rolling uplands, lakes and variable-width rivers, coastal beaches and surf, and mixed-age forests with matching near/distant foliage motion. PS4, PS5 and PS6 islands retain their versioned generators and save identities. Save compatibility remains 10; optional Uint32 terrain-index sidecars preserve exact damage above Float32 integer precision.

Release review covered the generation dispatcher and frozen legacy implementations, preview cancellation and replacement transactions, cross-realm identity, terrain save capture/transfer/storage/restore, shared water footprints, renderer shader composition, and resource disposal. The full 112-file run passed 546 of 547 tests; its sole failure was an obsolete monument generator-version assertion. After correcting that assertion and the old tree-scale expectations, all 13 focused monument/tree tests passed. TypeScript, production build, runtime asset verification, and JavaScript syntax checks passed.

Native Chrome on Apple M1 passed current-island creation and damage save/reload, PS4/PS5 damage save/reload, PS5 and PS7 portal round trips, replacement cancellation, mobile preview, and exact far-grid terrain save/reload through IndexedDB. PS7 laser rendering after realm replacement and mountain, castle, coast, lake and waterfall captures produced no browser errors. Evidence is in ignored `artifacts/release-review-*.log`, `artifacts/release-integration/`, and `artifacts/island-overhaul/`. Large sculpt review sources remain available locally and in Git but are omitted from production output. Native foreground Chrome flight samples at 1280 × 900 with 120 and 400 monsters recorded 17.6 ms p95 for both PS4 and PS7, passing the 10% regression gate with no browser errors; this steady-flight comparison does not certify destruction-heavy combat.

`pineapple-god-reference-sculpt-2026-10-23` integrates the user-approved head and full-body sculpt into the existing destructible monument, enlarges and animates the cross-realm portals, and adds the island-wide disco show during space-laser strikes. A packed 11-batch mesh maps to 815 stable destruction owners, preserving saved removed IDs, eye glow, collapse, realm behavior, and save format. Production builds omit the large review workbench and its source images; local visual review remains available. The full production build, runtime assets, TypeScript, 51 focused statue/portal/laser/lighting/cleanup tests, and historically difficult seed outputs pass. One historical seed-retry-count assertion was replaced with checks for valid generated river networks because retry count changed while the generated islands remained valid. Final in-game visual acceptance remains pending.

`gravity-bomb-1000m-2026-10-19` expands the gravity bomb's pull and burst radius to 1,000 m. Both realm HUDs display the configured radius. Fourteen gravity-bomb lifecycle, force, rendering, audio, water/lava, and rapid-fire stress tests and TypeScript checks pass; the boundary checks cover inward pull and outward release at 900 m and no influence beyond 1,000 m.

The preceding `gravity-bomb-2026-10-19` replaces weapon slot 4 with a dropped gravity bomb in both realms. On contact, the core pulls scenery and wreckage inward for four seconds across a growing 200 m field, then releases it outward. The eight-second cooldown, eight-active limit, shared fragmentation budget, and debris speed cap bound repeated drops. The field leaves terrain and aircraft velocity unchanged; destruction persists through existing saves while active bombs remain transient. Forty-six focused weapon, debris, save, rendering, and audio tests, TypeScript, the production build, runtime assets, and a dense-castle browser check pass. Rapid-fire stress and water/lava activation checks pass. A full-suite attempt was stopped after several minutes without a result; no full-suite pass is claimed.

The preceding `automatic-menu-version-2026-10-19` adds the automatically generated commit-count version to the menu footer and `/version.json`. Version generation is checked across successive commits and a shallow clone; TypeScript, the build, and desktop/mobile menu checks pass.

The preceding `portal-save-river-fixes-2026-10-19` release fixes Firefox save delivery by waiting for the receiving worker before dispatching the capture. Portal travel pauses autosaves, waits for the arrival pose, and safely lifts the aircraft out of its dive if a transfer fails. Previously failing PS4 seeds can retry river sources across the full island after exhausting the original layouts; previously successful layouts remain byte-exact. Firefox and Chrome checks cover travel in both directions, forced storage failures, and saving. A separate Chrome production-build check confirms automatic and manual saves survive reload and a full browser restart, including destruction and terrain edits.

The preceding `curved-ocean-horizon-2026-10-18` release adds an Earth-scale ocean horizon that recedes with camera altitude. Existing water blends into a sky-rendered backdrop with shared day/night colors and reduced distant ripples. Local shorelines, physics, saves, and the lava environment remain unchanged. TypeScript, the production build, runtime assets, nine focused tests, and browser checks at low/high altitude, wide-angle photo mode, sunset, and night pass. The full suite reports 493 passing tests and three timeouts in existing island-generation, monster-save, and cannon statue-reaction tests.

The preceding `test-audit-fixes-2026-10-18` release fixes water lookup at world boundaries, prevents reset from disabling saving when an autosave is canceled, and restores temporary-island replacement when storage is unavailable. Laser completion acknowledgements and dry-cell save packing avoid large repeated allocations. Proven unused scaffolding and obsolete assertions are removed while save compatibility and meaningful regression coverage remain. All 494 tests across 98 files, strict TypeScript checks, the production build, runtime assets, and focused browser checks passed for that release; evidence and verification limits are in [the audit report](TEST_AUDIT.md).

The preceding `island-expansion-2026-10-15` release adds a discoverable portal and a separately saved inverted island. Travel uses a full-screen flash, either destroyed portal endpoint prevents travel, and world reset restores both realms. Existing saves start on the surface with a fresh second realm. Surface settings, map, controls, and loading text keep the discovery hidden.

The inverted realm has upright pineapple flight, enlarged standing jet monsters, a destructible Jet God, jet-themed weapons and nuclear clouds, permanent building fires, bare dead trees, and a lethal lava ocean. Both portal approaches clear trees without changing entity IDs. Fuel-fire saves also accept the small fire patches produced by an aircraft crash.

The preceding `wheeled-pineapple-crowd-spacing-2026-10-14` release added local crowd steering, 50 m swept body clearance, approximately 64 m preferred spacing, distinct approach positions around the player, and traffic yielding. Existing overlapping saves spread gradually through valid movement, and traffic waits do not rebuild terrain routes.

The preceding `wheeled-pineapple-rage-2026-10-14` release added growing, rotating wheels to living enraged monsters. They drive at 60 m/s, cross river surfaces, turn faster, recover from blocked routes, and produce bounded river spray. Ocean water remains blocked. Attack cooldowns remain 1.68 seconds with a 750 m horizontal range, and health and damage are unchanged. Rage and river positions survive save/reload; existing enraged saves load with fully grown wheels. No island regeneration or save migration is required.

The preceding `pineapple-god-awakening-2026-10-13` release added the giant destructible god, red eye flashes after ground monster kills, and permanent rage after figure damage.

That release used PS4, world version 10, save compatibility 10, and preference revision 5. Earlier PS3 layouts use the existing incompatible-save flow rather than migrating destruction onto the new statue layout. Crash-camera state, fuel droplets, and aircraft wrecks are transient; destruction, statue rage, and fire hazards continue through the existing save system.

The preceding larger-islands release expanded new islands to 9,216 m across with varied landscapes, busier settlements, paged GPU terrain textures, predictive streaming, and map waypoints. See [larger-island verification](LARGER_ISLANDS_QA.md) for those checks and performance measurements.
