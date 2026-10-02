# Pineapple Siege

A third-person flight and destruction sandbox in a medieval valley. Fly a fighter jet, launch oversized pineapples, breach the castle, excavate craters, and leave a ruined world behind. The game saves locally in the current browser.

## Run locally

Use Node.js **22.12 or newer** and npm:

```sh
npm ci
npm run dev
```

Open the local address printed by Vite. The development server generates the baseline world before starting.

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

Pineapples inherit the aircraft's velocity, fall slightly, and explode on impact. The ring on the world estimates the impact location. The jet crashes against terrain, structures, substantial rubble, and water, then returns airborne after two seconds. Destruction stays in place. The boundary assistant turns the jet toward the kingdom before reaching the map edge.

The menu contains independent horizontal/vertical steering reversal, sensitivity, nuke strength, quality, reduced effects and camera shake, time, audio, performance information, and world reset. Pointer movement defaults to right → turn right and up → climb. Steering preferences and nuke strength persist independently of world resets.

## Experimental destruction settings

Four independent sliders in Settings → Destruction expose five levels. Standard preserves the prior limits; Heavy through Extreme now have larger budgets. These preferences survive reloads and world resets. Restore destruction defaults resets these controls without resetting the world.

| Limit                                      |    Slim | Standard |     Heavy |   Massive |     Extreme |
| ------------------------------------------ | ------: | -------: | --------: | --------: | ----------: |
| Active physics bodies                      |      64 |      256 |     1,024 |     4,096 |       8,192 |
| Cannon / nuke fragments per blast          | 16 / 32 | 64 / 128 | 256 / 512 | 1,024 / 2,048 | 2,048 / 4,096 |
| Cosmetic chunk pool                        |   1,024 |    4,096 |    16,384 |    32,768 |      65,536 |
| Cosmetic chunks per blast multiplier       |   0.25× |       1× |        3× |        6× |         12× |
| Persistent rubble records per 64 m section |      12 |       36 |        96 |       192 |         384 |

Raise both physics bodies and fragments to keep more building pieces in motion. Higher physics levels also extend the maximum moving lifetime from 12 seconds at Standard to 30 seconds at Extreme. Substantial building modules retain their original dimensions at every level. The rubble slider controls how many individual records remain per section; overflow consolidates into rough, material-specific piles that retain accumulated volume. Tiny cosmetic chips and dust remain transient. This is prepared destruction rather than exact preservation of every brick. Existing saved ruins are not erased when lowering retention; the new budget guides subsequent compaction. Lowering the body cap settles excess pieces in batches on subsequent simulation ticks.

Nuke blast scale ranges from **1× to 3×** and multiplies the selected yield's damage radius, crater radius, and depth (still capped at 25 meters below the baseline). A 3× radius covers roughly 9× the ground area. Each airborne nuke captures its resolved profile when released; changing settings affects later drops. No cooldown applies to all three weapons, clears their timers, and bypasses the in-flight projectile and pending-damage admission limits. Holding fire launches once per simulation tick (60 shots per simulated second). Fragment budgets still follow the sliders, and detailed clouds remain capped at three.

Moving-body snapshots use a transferable packed buffer instead of cloning nested objects. Cosmetic chunks use a dense typed-array pool, and the renderer uploads only occupied instance ranges. Airborne terrain sweeps skip sample work only when a conservative terrain bound proves the complete path is clear.

For collapses above 512 moving bodies, the 128 largest sections retain mutual collision detail. Smaller chunks still hit terrain, surviving structures, settled rubble, and those major sections, but pass through each other. Full mutual collision returns once fewer than 257 bodies remain. This avoids dense chip-to-chip contact storms while keeping castle damage and substantial wreckage physical.

Extreme settings can substantially reduce frame rate and enlarge saves. Reduced effects and render quality still reduce cosmetic output. The current settings are shown in the performance display. Aircraft translation and rotation share the buffered simulation timeline used by other moving objects, absorbing uneven worker delivery with about 100 ms of presentation delay. The chase camera smooths its aim, and camera shake does not accumulate into its following position.

**Render distance** in Graphics defaults to **1,200 meters**. Its slider ranges from **600 to 3,000 meters** in 100-meter steps and applies immediately. It controls terrain, buildings, trees, rubble, residents, monsters, camera clipping, and horizon fog; small section/batch margins keep objects at the boundary from disappearing early. Close-up detail thresholds remain fixed. Increasing distance draws more of the world and may reduce FPS; distant terrain streams in gradually. The setting persists through reloads and world resets, and Reset settings restores 1,200 meters. Rendering distance does not alter simulation, damage, or saved world contents.

**Show performance** includes 1% low FPS and worst-frame milliseconds alongside median and p95 frame time. The 1% low is 1,000 divided by the mean duration of the slowest 1% of the last 600 active frames, including uncapped stalls. It warms up for 100 frames. At 60 FPS this window covers about ten seconds; at lower FPS it covers longer. Resume, world reset, render-quality/distance changes, and performance-display toggles start fresh samples so menu/background gaps and previous settings do not skew the comparison. These readings measure frame delivery, not GPU execution time.

## Weapons and fortress

The cannon fires six-meter pineapples every 0.75 seconds. The nuke drops an eighteen-meter pineapple beneath the jet, inherits its velocity, and defaults to a ten-second cooldown. The No cooldown setting disables all weapon cooldown timers and removes projectile and pending-damage admission limits; holding fire launches the selected weapon once per simulation tick. The laser still completes its charge and beam sequence. All three weapons have unlimited ammunition. Switching weapons or respawning does not bypass cooldowns; pausing freezes them.

Nuke strength in Settings affects future drops:

| Strength        | Damage radius | Crater radius | Added depth | Cloud height |
| --------------- | ------------- | ------------- | ----------- | ------------ |
| Local           | 70 m          | 35 m          | 12 m        | 120 m        |
| Castle-leveling | 180 m         | 70 m          | 20 m        | 240 m        |
| Valley-scale    | 420 m         | 160 m         | 25 m        | 400 m        |

Nukes begin with a white-hot core and a brief white exposure flash, strongest nearby when looking toward the impact. The peak holds for about 0.45–0.9 seconds and fades over 5.1–8 seconds according to blast size, revealing the golden pineapple-shaped smoke cloud and green crown plumes. Reduced effects substantially dims the flash and shortens its fade to 1.8 seconds; overlapping flashes use the strongest contribution rather than adding brightness. Pausing freezes the effect and resetting clears it. The grand fortress occupies 500 × 550 meters, with twelve perimeter/gate towers, crenellated outer walls, layered courtyards, a central palace, and four taller asymmetric spires. Warm sandstone, dark slate roofs, and narrow windows give it the silhouette of the supplied castle reference. Its eastward site and clear flight approach leave room beside the river and surrounding landmarks.

The world layout and save format are now version 7. Version-6 and older saves prompt for a new world or temporary play without overwriting the old save. The expanded terrain uses a new sample stride and layout; older saves are protected until you choose a new world.

The surrounding map contains twelve five-building hamlets, seven farmsteads, five windmills, two watermills with docks and warehouses, four watchtowers, four additional bridges, two logging camps, and a quarry. Landmarks have independent breakable assemblies. There are no secondary explosions.

## Googly eyes

The castle parts, trees, rocks, banners, lanterns, jet, cannon/nuke pineapples, monsters and their spikes, moving and settled wreckage, and cosmetic fragments all wear googly eyes. Even the orbital disco ball and pineapple smoke clouds get a face. The matte, bone-white eyes have tiny black pupils that independently lock onto the rendered jet, with no random wobble or distractions. Settings → Graphics → Googly eyes switches the decoration on or off immediately; it defaults to off and remembers your choice. The older automatic-on setting is switched off once on upgrade; choosing eyes on afterward persists. Eyes follow the rendered transforms, disappear with destroyed/vaporized objects, and return with world resets; their animation freezes during pause and photo mode.

Eye pairs use shared procedural billboard geometry and reuse each source batch's instance buffer, adding no physics bodies or per-fragment CPU animation. They are visual decoration and require no save migration.

## Giant pineapple monsters

120 giant, angry pineapple monsters populate the expanded countryside by default, including encounters near settlements. Five cannon hits defeat one; hits stagger them and interrupt a volley. They pursue at 14 m/s, detect aircraft within 500 m horizontally and 350 m above the ground, and wind up for 0.75 seconds before throwing three velocity-led crown spikes 0.15 seconds apart at 125 m/s. Their attack cooldown is 2.4 seconds. Close flight remains vulnerable to swipes. Nukes remain lethal within their damage radius, and sustained lasers destroy monsters.

Monsters retain their doubled size. While any space laser charges or burns, they stop attacking and dance; laser damage still applies. Spikes have bounded lifetimes and population limits.

World → Pineapple monsters has a slider from 0 (Off) to 400; the new default is 120. Existing population preferences, including 20, are preserved. Lower counts hide higher-numbered monsters without defeating them; raising the count reveals living monsters and spawns more as needed. Positions, damage, and defeats are saved. Reset world revives defeated monsters.

## Expanded world and townspeople

The map spans **6,144 × 6,144 meters** (37.75 km²), nine times the original area. The original valley, castle dimensions, and spawn coordinates are retained. Rivers, roads, sparse forests, and new settlements extend into the countryside. Terrain uses a 3,073² heightfield, with nearby detail and coarse distant sections loaded around the camera. Distant destruction remains authoritative when terrain meshes are unloaded.

The compact flight HUD shows the living population and a 0–100 happiness score. Casualties permanently reduce happiness; fear and mourning lower morale, while celebrations raise it.

There are 600 cartoon townspeople: eight per residential house and 64 around the castle. They wander near home, avoid water and intact buildings, and flee low aircraft and nearby monsters. Explosions, aircraft, laser columns, moving wreckage, and collapsing buildings can kill them; casualties disappear without gore and remain lost until Reset world.

A settlement cheers for six seconds when its last monster within 500 m is defeated. The final active monster defeat triggers celebration at every surviving settlement. Loading or changing monster counts never triggers victory. Civilian losses and building damage override cheering: survivors mourn for at least ten seconds, and residents of homes missing at least 25% of their structural parts remain sad. Reactions and casualties save with the world; pause and photo mode freeze them. Spatial cheer and mourning sounds follow volume and mute settings. There is no civilian score.

Run `npm run benchmark:world` for CPU simulation timings at 120 and 400 monsters, including a Valley-scale castle blast. These timings exclude browser rendering and GPU work.

## Space laser

The laser now starts a valley-wide disco as soon as charging begins. A 250 m mirrored ball appears above the map center, the sky turns black while the ground remains visible under moving colored lights, and a generated beat plays through the existing volume and mute controls. The show ends when the last beam ends, even if excavation continues. Pausing and photo mode freeze the visuals and beat. Reduced effects lowers the disco lights without changing damage.

Press **3** to select Space Laser. Aim the jet toward a surface and click or press Space to lock that location. A four-second cyan-white charge builds from targeting rings, electrical arcs, rising energy, and sound. The sky-to-ground beam then burns for five seconds while the jet remains under your control. Flying into the bright central beam destroys the jet and triggers the usual two-second respawn; charging effects are harmless.

The **Space Laser** settings offer logarithmic strike size (380 m diameter through **Entire map**, approximately 17,382 m diameter), crater depth (25–500 m), and beam brightness (25–200%). Size scales destruction, visuals, and the beam’s aircraft collision together. Each strike captures its launch settings; changing sliders applies to the next strike. Preferences persist and Reset settings restores the current default laser. Huge strikes finish terrain and object cleanup in queued sections, keeping the dry footprint active until cleanup completes. Version-6 and older world saves require the protected new-world flow.

At default size, the strike expands to a **190-meter radius** during its first firing second and progressively excavates a **380-meter-wide shaft up to 500 meters below the original terrain**. Structures, trees, rocks, moving debris, and settled rubble in the footprint are vaporized rather than scattered. The rock-lined crater stays dry, including where a river previously flowed. Dust and heat glow fade afterward; subsequent weapon hits can deposit new rubble. Repeated laser strikes cannot deepen terrain past the 500-meter limit.

Normally a strike takes its nine-second charge/burn sequence plus fifteen seconds of recharge. No cooldown allows a new locked strike every simulation tick while firing is held; all strikes still charge and burn independently. Terrain work is coalesced per section, with overlapping edits using the deeper result. The nearest 64 strikes receive detailed effects and farther strikes use simple instanced columns; audio selects up to four spatial voices. This does not limit authoritative strikes. Large unrestricted runs can slow and accumulate unfinished excavation.

Pause and photo mode freeze the laser. Saves retain locked targets, remaining charge/burn timing, queued excavation, the dry mask, and laser recharge. Reload finishes already-queued world edits before flight becomes available, then resumes unfinished charge/burn timing when play resumes. Reset clears strikes, terrain, water exclusions, and effects. Reduced effects dims presentation without changing damage.

## Destruction and saves

- Terrain craters change the visible ground and its collision surface. Cannon/nuke hits stop 25 meters below the original terrain; lasers have a separate 500-meter limit. Ordinary blasts never raise a deeper existing crater.
- Castle masonry, towers, trees, rocks, and bridge parts can break. Unsupported building sections fall in groups.
- By default, up to 256 moving rigid bodies are simulated, with up to 64 substantial fragments per cannon blast and 128 per nuke. Selected modules split into two to six pieces. Nukes eject earth and push existing wreckage.
- By default, a separate 4,096-piece pool draws solid-looking cosmetic chunks with ballistic motion and terrain bounces: up to 256 per cannon blast and 1,200 per nuke. These cannot hit the jet and expire after settling. Reduced effects lowers their count, not world damage.
- Excess major destruction becomes scattered persistent rubble. Its landing position is approximated; nearby substantial pieces use actual rigid-body motion.
- At Standard, rubble is consolidated into at most 36 records per terrain section, retaining material volume in rough piles when records fill. A later blast can reactivate nearby large rubble. The game preserves ruins without retaining every brick forever.
- Ordinary craters connected to the river can flood; isolated craters and laser shafts remain dry.
- IndexedDB stores changed terrain samples, destroyed component IDs, major rubble, time, unfinished nuke destruction jobs, and laser strikes/excavation. Restored jobs finish before flight is enabled. Autosaves occur at most once per second; pausing also requests a save.
- Returning to the game restores the ruined world and starts the aircraft safely airborne. Airborne debris is restored as stable rubble using the same volume-preserving compaction rules, including when section budgets are full; transient effects are not saved.
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

The full-screen menu always shows Flight, Destruction, Graphics, Audio, and World settings, with no sections to expand. **Reset settings to defaults** restores every preference (including Valley-scale nukes, Standard debris, normal cooldowns, Auto quality, and 35% sound volume) and afternoon time without erasing world damage. Settings reset persists across reloads; **Reset world** remains a separate confirmed action. The HUD shows weapon selectors, cooldown progress, objects destroyed, and height above the actual deformed ground (AGL).

- **C:** toggle cinematic side, rear-quarter, and orbit shots. Flight and weapons stay under your control; C returns to chase immediately. Crash, respawn, pause, and reset return to chase.
- **P:** freeze the world and enter photo mode; P resumes the previous camera mode. Drag to look, use WASD to move, Q/E to move vertically, and Shift to move faster. H hides/shows photo controls. The toolbar adjusts field of view and saves a clean PNG at the current render resolution. Escape returns to the pause menu.

Photo mode waits for the simulation worker's pause acknowledgement. World effects and sound remain frozen while the camera moves. Camera state and transient dust/audio are never stored in world saves.

Engine audio now layers turbine and airflow with the existing engine body. Material-specific fracture, impact, and settling sounds share generated buffers, with up to 24 ordinary voices and four nuke voices. Craters expose soil and rock strata, fragments show contrasting cut faces, and pooled low dust lingers over impacts. These presentation changes do not alter permanent damage or remove unrestricted firing.

Earlier screenshots and performance reports are available in Git history.
