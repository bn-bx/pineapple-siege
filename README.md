# Pineapple Siege

A third-person flight and destruction sandbox on a procedurally generated medieval island. Fly a fighter jet, launch oversized pineapples, breach the castle, excavate craters, and leave a ruined world behind. The game saves locally in the current browser.

## Run locally

Use Node.js **22.12 or newer** and npm:

```sh
npm ci
npm run dev
```

Open the local address printed by Vite. The development server generates a deterministic reference island before starting. Players choose their own island through the in-browser preview.

```sh
npm test
npm run build
npm run preview
```

`npm run build` generates the world, checks TypeScript, and creates the complete static application in `dist/`. The production build needs no backend and makes no requests to external asset services. Directly opening the source `index.html` from Finder is no longer supported.

The source tree contains the current game, its world generator, and automated tests. Earlier prototypes and verification captures remain in Git history.

## Controls

| Input               | Action                                                          |
| ------------------- | --------------------------------------------------------------- |
| Mouse               | Steer; the jet banks into turns                                 |
| W / S               | Raise / lower throttle                                          |
| A / D               | Additional steering, including keyboard-only play               |
| Shift               | Boost                                                           |
| 1 / 2 / 3           | Select cannon / nuke / space laser                              |
| Left click or Space | Use selected weapon; hold to repeat on its cooldown             |
| R                   | Respawn airborne                                                |
| Escape              | Pause and release the mouse                                     |
| C                   | Toggle cinematic camera; manual flight and firing remain active |
| P                   | Enter/exit frozen photo mode                                    |
| Double-click        | Center mouse steering                                           |

If mouse capture is unavailable, hold and drag to steer, and use Space to fire. Safari may consume Escape presses for its mouse-capture banner before opening the game menu.

On phones and tablets, use the left thumb pad to steer (release to center), and hold Fire, Boost, or the +/− throttle buttons on the right. Tap the weapon buttons to switch weapons, Respawn to return airborne, and the top-right menu button to pause. Steering sensitivity and reversal settings also apply to touch. Touch controls support simultaneous fingers and work in portrait or landscape.

Pineapples inherit the aircraft's velocity, fall slightly, and explode on impact. The ring on the world estimates the impact location. The jet crashes against terrain, structures, substantial rubble, and water, then returns airborne after two seconds. Terrain damage and destroyed structures persist; wreckage clears after seven seconds. The boundary assistant turns the jet toward the kingdom before reaching the map edge.

The menu contains independent horizontal/vertical steering reversal, sensitivity, rapid fire, quality, reduced effects and camera shake, time, audio, performance information, and world reset. Pointer movement defaults to right → turn right and up → climb. Steering preferences and the cooldown toggle persist independently of world resets.

## Destruction defaults

Destruction is fixed at Standard: a bounded pool of 512 visual wreckage pieces and 512 cosmetic chips. Wreckage has terrain-only flight and bounces, with no native physics contacts or secondary damage. Pieces move for up to six simulation seconds, then shrink away over one second. Nukes use Valley-scale strength at 1× blast scale. Space Laser uses a 380 m strike diameter, 500 m excavation depth, and 100% brightness. Old preferences for these removed controls are replaced with these defaults; existing world damage and already-launched strikes retain their saved state.

The only Destruction control is **No cooldown · 0.1 sec**. Enabling it replaces all three weapon cooldowns with a 0.1-second interval (10 launches per simulated second), bypasses projectile/pending-damage admission limits, and retains each laser's full charge and beam sequence. Turning it off restores normal cooldowns. Pause and photo mode freeze firing timers.

Moving-body snapshots use a transferable packed buffer instead of cloning nested objects. Cosmetic chunks use a dense typed-array pool, and the renderer uploads only occupied instance ranges. Airborne terrain sweeps skip sample work only when a conservative terrain bound proves the complete path is clear.

For collapses above 512 moving bodies, the 128 largest sections retain mutual collision detail. Smaller chunks still hit terrain, surviving structures, settled rubble, and those major sections, but pass through each other. Full mutual collision returns once fewer than 257 bodies remain. This avoids dense chip-to-chip contact storms while keeping castle damage and substantial wreckage physical.

Reduced effects and render quality still reduce cosmetic output. The current settings are shown in the performance display. Aircraft translation and rotation share the buffered simulation timeline used by other moving objects, absorbing uneven worker delivery with about 100 ms of presentation delay. The chase camera smooths its aim, and camera shake does not accumulate into its following position.

**Detail distance** in Graphics defaults to **1,200 meters**, with a **600–3,000 meter** slider. The whole island remains visible at every setting without fog: distant terrain, buildings and forests retain a shared silhouette layer. Higher settings extend nearby detail and may reduce FPS. Grass remains bounded to 120 meters. The preference persists through reloads/reset and does not change simulation, damage or saves.

**Show performance** includes 1% low FPS and worst-frame milliseconds alongside median and p95 frame time. The 1% low is 1,000 divided by the mean duration of the slowest 1% of the last 600 active frames, including uncapped stalls. It warms up for 100 frames. At 60 FPS this window covers about ten seconds; at lower FPS it covers longer. Resume, world reset, render-quality/distance changes, and performance-display toggles start fresh samples so menu/background gaps and previous settings do not skew the comparison. These readings measure frame delivery, not GPU execution time.

## Weapons and fortress

The cannon fires six-meter pineapples every 0.75 seconds. The nuke drops an eighteen-meter pineapple beneath the jet, inherits its velocity, and defaults to a ten-second cooldown. The No cooldown setting uses 0.1-second firing intervals and removes projectile and pending-damage admission limits. The laser still completes its charge and beam sequence. All three weapons have unlimited ammunition. Switching weapons or respawning does not bypass cooldowns; pausing freezes them.

Nuke strength in Settings affects future drops:

| Strength        | Damage radius | Crater radius | Added depth | Cloud height |
| --------------- | ------------- | ------------- | ----------- | ------------ |
| Local           | 70 m          | 52.5 m        | 24 m        | 120 m        |
| Castle-leveling | 180 m         | 105 m         | 40 m        | 240 m        |
| Valley-scale    | 420 m         | 240 m         | 50 m        | 400 m        |

Nukes begin with a white-hot core and a brief white exposure flash, strongest nearby when looking toward the impact. The peak holds for about 0.45–0.9 seconds and fades over 5.1–8 seconds according to blast size, revealing the golden pineapple-shaped smoke cloud and green crown plumes. Reduced effects substantially dims the flash and shortens its fade to 1.8 seconds; overlapping flashes use the strongest contribution rather than adding brightness. Pausing freezes the effect and resetting clears it. The grand fortress varies around a 500 × 550-meter footprint, with twelve perimeter/gate towers, crenellated outer walls, layered courtyards, a central palace, and four taller asymmetric spires. Warm sandstone, dark slate roofs, and narrow windows give it the silhouette of the supplied castle reference. Its eastward site and clear flight approach leave room beside the river and surrounding landmarks.

The current island world/save format is version 8. Older saves remain protected by the recovery dialog until you explicitly replace them; temporary island play leaves them untouched. Preferences stay independent of the world baseline.

The surrounding map contains twelve five-building hamlets, seven farmsteads, five windmills, two watermills with docks and warehouses, four watchtowers, four additional bridges, two logging camps, and a quarry. Landmarks have independent breakable assemblies. There are no secondary explosions.

## Googly eyes

The castle parts, trees, rocks, banners, lanterns, jet, cannon/nuke pineapples, monsters and their spikes, moving and settled wreckage, and cosmetic fragments all wear googly eyes. Even the orbital disco ball and pineapple smoke clouds get a face. The matte, bone-white eyes have tiny black pupils that independently lock onto the rendered jet, with no random wobble or distractions. Settings → Graphics → Googly eyes switches the decoration on or off immediately; it defaults to off and remembers your choice. The older automatic-on setting is switched off once on upgrade; choosing eyes on afterward persists. Eyes follow the rendered transforms, disappear with destroyed/vaporized objects, and return with world resets; their animation freezes during pause and photo mode.

Eye pairs use shared procedural billboard geometry and reuse each source batch's instance buffer, adding no physics bodies or per-fragment CPU animation. They are visual decoration and require no save migration.

## Giant pineapple monsters

120 giant, angry pineapple monsters populate the expanded countryside by default, including encounters near settlements. Five cannon hits defeat one; hits stagger them and interrupt a volley. They pursue at 14 m/s, detect aircraft within 500 m horizontally and 350 m above the ground, and wind up for 0.75 seconds before throwing three velocity-led crown spikes 0.15 seconds apart at 125 m/s. Their attack cooldown is 2.4 seconds. Close flight remains vulnerable to swipes. Nukes remain lethal within their damage radius, and sustained lasers destroy monsters.

Monsters retain their doubled size. While any space laser charges or burns, they stop attacking and dance; laser damage still applies. Spikes have bounded lifetimes and population limits.

World → Pineapple monsters has a slider from 0 (Off) to 400; the new default is 120. Existing population preferences, including 20, are preserved. Lower counts hide higher-numbered monsters without defeating them; raising the count reveals living monsters and spawns more as needed. Defeated monsters fly and tumble as one whole pineapple using a cheap visual trajectory, then shrink away on the same six-plus-one-second schedule as wreckage. At most 128 corpses move concurrently; excess corpses retain a static pose until cleanup. Their defeated identities are saved. Existing split corpses migrate to a whole visual pose. Positions, damage, and defeats are saved. Reset world revives defeated monsters.

## Expanded world and townspeople

The map spans **6,144 × 6,144 meters** (37.75 km²), with 53–62% occupied by a seeded island and a wider ocean margin around every coast. Asymmetric coastlines, deep bays, peninsulas, mountains, rivers, roads, forests, settlements, and castle layouts vary between seeds. Terrain uses a 3,073² heightfield, with nearby detail and coarse distant sections loaded around the camera. Distant destruction remains authoritative when terrain meshes are unloaded.

The compact flight HUD shows the living population and a 0–100 happiness score. Casualties permanently reduce happiness; fear and mourning lower morale, while celebrations raise it.

There are 664 cartoon townspeople: eight per residential house 64 around the grand castle, 16 around each smaller castle, and 16 at each fishing harbor. They wander near home, avoid water and intact buildings, and flee low aircraft and nearby monsters. Explosions, aircraft, laser columns, moving wreckage, and collapsing buildings can kill them; casualties disappear without gore and remain lost until Reset world.

A settlement cheers for six seconds when its last monster within 500 m is defeated. The final active monster defeat triggers celebration at every surviving settlement. Loading or changing monster counts never triggers victory. Civilian losses and building damage override cheering: survivors mourn for at least ten seconds, and residents of homes missing at least 25% of their structural parts remain sad. Reactions and casualties save with the world; pause and photo mode freeze them. Spatial cheer and mourning sounds follow volume and mute settings. There is no civilian score.

Run `npm run benchmark:world` for CPU simulation timings at 120 and 400 monsters, including a Valley-scale castle blast. These timings exclude browser rendering and GPU work.

## Space laser

The laser now starts a valley-wide disco as soon as charging begins. A 250 m mirrored ball appears above the map center, the sky turns black while the ground remains visible under moving colored lights, and a generated beat plays through the existing volume and mute controls. The show ends when the last beam ends, even if excavation continues. Pausing and photo mode freeze the visuals and beat. Reduced effects lowers the disco lights without changing damage.

Press **3** to select Space Laser. Aim the jet toward a surface and click or press Space to lock that location. A four-second cyan-white charge builds from targeting rings, electrical arcs, rising energy, and sound. The sky-to-ground beam then burns for five seconds while the jet remains under your control. Flying into the bright central beam destroys the jet and triggers the usual two-second respawn; charging effects are harmless.

Space Laser is fixed at 380 m strike diameter, 500 m depth, and 100% brightness. Already-launched strikes retain their saved profiles.

At default size, the strike expands to a **190-meter radius** during its first firing second and progressively excavates a **380-meter-wide shaft up to 500 meters below the original terrain**. Structures, trees, rocks, moving debris, and settled rubble in the footprint are vaporized rather than scattered. The rock-lined crater stays dry, including where a river previously flowed. Dust and heat glow fade afterward; subsequent weapon hits can leave temporary wreckage. Repeated laser strikes cannot deepen terrain past the 500-meter limit.

Normally a strike takes its nine-second charge/burn sequence plus fifteen seconds of recharge. No cooldown allows a new locked strike every 0.1 seconds while firing is held; all strikes still charge and burn independently. Terrain work is coalesced per section, with overlapping edits using the deeper result. The nearest eight strikes receive detailed effects and farther strikes use simple instanced columns; audio selects up to four spatial voices. This does not limit authoritative strikes. Large unrestricted runs can slow and accumulate unfinished excavation.

Pause and photo mode freeze the laser. Saves retain locked targets, remaining charge/burn timing, queued excavation, the dry mask, and laser recharge. Reload finishes already-queued world edits before flight becomes available, then resumes unfinished charge/burn timing when play resumes. Reset clears strikes, terrain, water exclusions, and effects. Reduced effects dims presentation without changing damage.

## Destruction and saves

- Terrain craters change the visible ground and its collision surface. Cannon/nuke hits stop 50 meters below the original terrain; lasers have a separate 500-meter limit. Ordinary blasts never raise a deeper existing crater.
- Castle masonry, towers, trees, rocks, and bridge parts can break. Unsupported building sections fall in groups.
- By default, up to 256 moving rigid bodies are simulated, with up to 64 substantial fragments per cannon blast and 128 per nuke. Selected modules split into two to six pieces. Nukes eject earth and push existing wreckage.
- By default, a separate 4,096-piece pool draws solid-looking cosmetic chunks with ballistic motion and terrain bounces: up to 256 per cannon blast and 1,200 per nuke. These cannot hit the jet and share the six-second motion and one-second shrink lifetime. Reduced effects lowers their count, not world damage.
- Wreckage and defeated pineapples move for six seconds, then shrink away over one second. Early landings retain temporary visual wreckage.
- Cleanup is permanent. Physics bodies are released when shrinking begins, and rubble from older saves clears incrementally.
- Ordinary craters connected to the river can flood; isolated craters and laser shafts remain dry.
- IndexedDB stores changed terrain samples, destroyed component IDs, major rubble, time, unfinished nuke destruction jobs, and laser strikes/excavation. Restored jobs finish before flight is enabled. Autosaves occur at most once per second; pausing also requests a save.
- Returning to the game restores the ruined world and starts the aircraft safely airborne. Saved debris clears incrementally after loading; transient effects are not saved.
- Reset requires confirmation. Incompatible saves prompt for replacement or temporary play without overwriting them. If saving fails, a visible status message explains that flight is continuing without saving.

Saves belong to this browser and website origin. Clearing site data, using private browsing, browser eviction, or changing domains can remove or separate saves. There is no account or cloud synchronization. Closing a tab before an in-progress transaction finishes can lose the latest unsaved second; save status indicates when the write completes.

## Deployment

The private [bn-bx/pineapple-siege](https://github.com/bn-bx/pineapple-siege) repository is connected to Cloudflare Pages. A push to `main` automatically builds and deploys [sweetpickledpineapple.com](https://sweetpickledpineapple.com). See [the deployment guide](docs/DEPLOYMENT.md) for the full account, SSH, Pages, DNS, verification, and recovery setup.

## Development architecture

The TypeScript source separates rendering, simulation, generation, persistence, audio, and input. Three.js/WebGL 2 renders the scene; Rapier runs inside a worker at a fixed 60 Hz. Terrain deltas transfer typed arrays, and render snapshots contain serializable state rather than Three.js objects.

`GameCommand`, `WorldDelta`, `SimulationSnapshot`, and `SaveSnapshot` in `src/types.ts` form the local-authority boundary. A future 2–8-player server can own flight, impacts, world changes, and major rubble while each browser handles visual effects. Networking is deliberately not implemented.

Open with `#debug` to enable the `window.lanternVale` inspection API and performance display. Debug hooks expose controlled blasts, aircraft placement, fixed-step advancement, snapshots, save requests, and inspection-camera views. They are absent from the normal game URL.

Run `npm test` for the automated simulation, weapons, monster, rendering, and persistence checks. Older browser and performance reports are retained in Git history; their measurements do not describe the current build.

With Python Playwright installed and Vite running at `http://127.0.0.1:5177`, run `python scripts/check-flight-browser.py` for the flight/destruction, performance-overlay, and render-distance browser checks. It exercises the native slider, visibility, saved settings, reload, and default reset. It uses a disposable profile, exercises GPU rendering, and disables drawing for isolated timing/lifecycle checks on headless software graphics. Results and screenshots are written under `/tmp`; they are not hardware-performance measurements.

## Nuke presentation and sound

Nukes have a longer white exposure flash, a 4.5-second white-to-gold fireball and shockwave, then the existing pineapple cloud. Audio is generated locally: a sharp pressure crack, descending bass, filtered roar, rolling echoes, and a 10–14-second rumble tail according to blast size. Water impacts are more muffled. Nuke release has a deeper sound than the cannon. Up to four nuke voices remain active, with short crossfades when replacing older sounds. A shared compressor and soft peak ceiling control overlapping blasts; volume and mute still apply to the final output. No audio files or network services are required.

## Final polish and cameras

Spatial audio supports both AudioParam-based listener positioning and Firefox's legacy listener methods. Weapon selection and the rest of the HUD continue updating during audible flight. The selector uses three stable button columns, with the cooldown bar beneath and a stronger selected-weapon highlight; small-window hints and telemetry stay clear of the buttons.

The game is now **Pineapple Siege**. Existing browser saves remain in the same IndexedDB database. Preferences migrate independently: Valley-scale is selected once on upgrade, then later strength changes are remembered. Graphics quality/distance, sound, reduced effects/shake, performance display, and hold-time now persist through reloads and world resets.

The full-screen menu shows Flight, Destruction, Graphics, Audio, and World settings. Destruction contains only the 0.1-second cooldown toggle; Space Laser has no settings section. **Reset settings to defaults** restores every preference (including Valley-scale nukes, Standard debris, normal cooldowns, Auto quality, and 35% sound volume) and afternoon time without erasing world damage. Settings reset persists across reloads; **Reset world** remains a separate confirmed action. The HUD shows weapon selectors, cooldown progress, objects destroyed, and height above the actual deformed ground (AGL).

- **C:** toggle cinematic side, rear-quarter, and orbit shots. Flight and weapons stay under your control; C returns to chase immediately. Crash, respawn, pause, and reset return to chase.
- **P:** freeze the world and enter photo mode; P resumes the previous camera mode. Drag to look, use WASD to move, Q/E to move vertically, and Shift to move faster. H hides/shows photo controls. The toolbar adjusts field of view and saves a clean PNG at the current render resolution. Escape returns to the pause menu.

Photo mode waits for the simulation worker's pause acknowledgement. World effects and sound remain frozen while the camera moves. Camera state and transient dust/audio are never stored in world saves.

Engine audio now layers turbine and airflow with the existing engine body. Material-specific fracture, impact, and settling sounds share generated buffers, with up to 24 ordinary voices and four nuke voices. Craters expose soil and rock strata, fragments show contrasting cut faces, and pooled low dust lingers over impacts. These presentation changes do not alter permanent damage or rapid firing.

Earlier screenshots and performance reports are available in Git history.

## Procedural islands, previews, and sharing

On your first visit, **Choose your island** shows an illustrated overhead preview of the actual generated world: elevation-shaded mountains, forest cover, waterways, roads, landmark markers, and the highest peak elevation. **Reroll** generates another island. Paste a versioned seed such as `PS2-0000A301` and select **Preview seed** to reproduce one. **Keep this island** begins play.

**World → New island** opens the same screen. Previewing, rerolling, or cancelling does not replace your island. Keeping a candidate asks you to confirm replacement of your current island and its damage, casualties, and monster progress. Generation or storage failure preserves the previous save. **Reset world** repairs the same island and revives its inhabitants; it never changes the seed. Settings persist independently.

**Copy seed** and **Copy island link** share the seed and generator label. Revision-2 links reproduce the island’s original geography and content. A link opens its candidate preview before any replacement. Damage and progress remain private to each browser. If clipboard access is unavailable, a selectable field provides the text. New seed codes encode generator revision 2 and an unsigned 32-bit seed. PS1 inputs are accepted as aliases for the same numeric seed in revision 2; old links therefore produce improved geography rather than their original terrain. Existing revision-1 saved baselines and progress remain unchanged. Malformed and unsupported revisions are rejected. Shared query parameters are consumed after acceptance or cancellation so reload resumes normal play.

The island has one varied grand fortress and two smaller castles, twelve hamlets, seven farms, five windmills, two watermills, four watchtowers, four crossings plus the main bridge, two logging camps, a quarry, two fishing harbors, two lighthouses, and two coastal ruins. Harbor homes participate in the existing resident reactions and casualties. Mountain layouts vary between one long range, separated regional ranges, scattered massifs, and coastal ranges. One to five mountain regions have independent positions, directions, lengths, widths, summit counts, and heights, with tallest peaks varying between 700–1,000 meters and at least two broad passes below 450 meters. The flight ceiling is 1,500 meters above sea level: a HUD warning starts at 1,250 meters and gradual climb assistance starts at 1,350 meters, with 25-meter warning hysteresis. The height readout remains height above ground. Steep faces expose rock, elevated slopes show scree, and forests thin toward summits. Settlement terraces blend into neighboring slopes without closing waterways. Pines, broadleaf woodland, and slender riverside trees form clustered forests with clearings, sparse slopes, and clear roads and flight approaches. Tree species remain recognizable as falling and settled wreckage.

Ocean water stays at sea level and can flood connected craters. Rivers have generated elevated surfaces confined to their channels; there is no fluid simulation. Laser shafts remain dry at all elevations. The ocean extends beyond the playable boundary visually, while existing flight boundary assistance remains active.

The browser generates islands in a dedicated worker and stores the exact pristine heightfield and manifest in IndexedDB alongside the generator identity and seed. Reload applies saved changes to that exact baseline. If storage is unavailable, temporary play is supported, including island replacement for the current session. V1 keeps one active island, without an island library.

The shared generator is `src/world/generator.mjs`; `ISLAND_SEED=42 npm run world` selects the build/test reference seed. `npm test` generates both the current island and a separate fixed version-7 regression fixture, preserving historical flight/destruction checks while testing the new generator directly. `scripts/check-island-browser.mjs` exercises the preview, sharing, cancellation, replacement, transaction failures, reloads, reset, and temporary-play flows using a disposable Playwright browser.

## Performance diagnostics

Auto graphics starts at 900p and adapts shadows, reflections, transient effects, and resolution to load, with slow recovery to avoid oscillation. Manual resolution and the requested viewing distance remain respected. Terrain meshes stream from a dedicated worker; actors, projectiles, scenery, and airborne debris use shared instance batches. Disabled googly eyes do no frame traversal. Save compatibility 9 adds incremental section transactions and an atomic migration of valid version-8 saves without changing world version 8. Damage compatibility follows the saved baseline’s generator revision.

Run `npm run benchmark:performance` for controlled worker CPU measurements. Build, start `npm run preview`, and open `/performance.html` for foreground native GPU/frame checks, isolated save migration/failure tests, and the 15-minute combat soak. These tests use a separate database and preserve your active island. Local Vite preview/dev servers can save reports under `docs`; static hosting supports downloading the same report. The inspection controls cover seeds, castles, coasts, mountains, forests, night lighting, eyes, and both supported distance extremes. Measured results and release-gate status are recorded in `docs/PERFORMANCE_QA.md`; average FPS alone does not certify the release.

### Mountain release verification

`tests/mountain-release.test.ts` checks 32 fixed revision-2 seeds, mountain and pass limits, continuous descending river beds and confluences, tree elevations, revised flight assistance, ceiling-warning hysteresis, and saved revision compatibility. Rivers use eight-direction priority-flood drainage and catchment-based source selection. Bridges keep axis-aligned destructible modules while measuring banks across oblique channels. The map remains 6,144 meters wide, with 53–62% land for newly generated islands; saved baselines preserve their original coastlines. Aircraft speed and terrain streaming distances remain unchanged. Laser beams extend to 2,200 meters above sea level.

`node scripts/benchmark-island-generation.mjs` compares the working generator to `ISLAND_BASE_REF` (default `HEAD`) using 32 seeds and writes a JSON report to `ISLAND_BENCHMARK_OUTPUT` (default `/tmp/island-generation-benchmark.json`). `scripts/check-mountain-views.mjs` captures six seeds and both supported distance extremes. `scripts/check-island-compatibility.mjs` verifies historical save reload/reset using genuine revision-1 manifest and heightfield files supplied through `ISLAND_V1_WORLD` and `ISLAND_V1_HEIGHTS`. Browser scripts accept `ISLAND_URL`, `PLAYWRIGHT_MODULE`, and `CHROME_PATH`. Results are recorded in `docs/ISLAND_GENERATION_QA.md`.
