# Pineapple Siege architecture

The browser runs a flight and destruction sandbox on a seeded 6,144 m island. The main thread owns input, menus, rendering, audio, and persistence. A simulation worker owns flight, combat, damage, terrain edits, civilians, monsters, and Rapier physics. A separate generation worker builds island candidates.

## Application

`src/main.ts` boots `src/app/game.ts`. The session state in `src/session-state.ts` distinguishes loading, menu, playing, photo transitions, photo mode, island preview, and recovery. Application modules own input, settings, HUD, island selection, and incremental saving. Pause and photo mode freeze simulation and audio. Graphics recovery rebuilds renderer resources before resuming.

`src/app/island-coordinator.ts` handles preview, reroll, seed sharing, and replacement. `src/app/save-coordinator.ts` handles persistence and protected-save recovery. IndexedDB stores the exact generated baseline separately from damage; replacement writes the baseline and removes prior damage atomically. Failed writes, historical saves, and temporary play retain their recovery protections.

## Simulation

`src/sim/simulation.ts` coordinates the original tick order. `weapon-driver.ts` owns firing and projectile handling; `destruction-driver.ts` owns queued destruction orchestration. Spatial queries, incremental destruction work, terrain streaming, bounded physics/cosmetic pools, and wreckage cleanup support large worlds. Packed transferable snapshots are recycled and interpolated by the main thread.

Live weapon configuration uses fixed defaults plus rapid fire. Save-boundary parsers retain historical profiles and pending-strike parameters. Monsters still interrupt attacks and dance during laser strikes. Civilian casualties, morale, and celebrations remain simulation behavior.

## Rendering and audio

`src/render/renderer.ts` coordinates world batches, actors, effects, environment, terrain, and cameras. Subsystems own update/reset/dispose behavior. A shared disposal collector releases shared resources once. World batches retain generated entity identity and destruction ownership; decoration never changes collision or support data.

Shared standard materials distinguish stone, wood, roofs, terrain, and foliage. Trees use near/distant geometry; mills and banners are static. Ocean and rivers share inexpensive scrolling normals and authoritative terrain/flood masks. Lighting uses a basic sky, ambient light, one directional light, bounded nearby shadows, and emissive windows. Presentation supports antialiasing, photo focus, and an optional display-space CRT shader after output conversion. CRT presets (Off, Subtle, Retro TV) affect the canvas and exported photos, while HTML controls stay crisp. The pass reuses composer targets, tracks drawing-buffer resolution, and records `crtSubmit` timing. Subtle is the default; CRT selection is independent of reduced effects and auto quality. Reflection targets, AO, bloom, and heat distortion are removed.

Audio uses one engine loop, one ambient bed, and shared positional cues with voice limits. Volume, mute, pause, reset, and disposal apply to all voices. Runtime audio hashes are generated and verified during builds; source attribution is in `public/assets/audio/CREDITS.md`.

## Compatibility and builds

World version 8, save compatibility 9, generator output, entity IDs, and support relationships are preserved. Preference revision 5 adds the CRT selection, defaults missing or invalid modes to Subtle, and preserves remaining choices. `src/world/generator.mjs` is shared by build tooling and the generation worker. Validation checks coastlines, population, roads, budgets, identities, and grounded supports before acceptance.

Vite builds the game and an isolated `performance.html` harness. Terrain parts remain below Cloudflare Pages' asset-size limit; the unsplit test terrain is omitted from production. Generated world files, runtime hashes, build output, and benchmark artifacts are ignored. The lockfile pins dependency installation.

## Verification

Tests cover flight, combat, destruction, terrain, monsters, civilians, generation, saves, and renderer ownership. Browser checks cover island/save failure paths, touch controls, pause/photo/export, and graphics recovery. The performance harness records frame tails, worker stages, resource counts, and long combat soaks. Current measurements and unresolved performance gates are documented in [simplification verification](docs/SIMPLIFICATION_QA.md). Production routing and release procedure are in [deployment](docs/DEPLOYMENT.md).
