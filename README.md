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

Extreme settings can substantially reduce frame rate and enlarge saves. Reduced effects and render quality still reduce cosmetic output. The current settings are shown in the performance display. Aircraft translation and rotation now interpolate together; the chase camera smooths its aim, and camera shake no longer accumulates into its following position.

## Weapons and fortress

The cannon fires six-meter pineapples once per second. The nuke drops an eighteen-meter pineapple beneath the jet, inherits its velocity, and defaults to a ten-second cooldown. The No cooldown setting disables all weapon cooldown timers and removes projectile and pending-damage admission limits; holding fire launches the selected weapon once per simulation tick. The laser still completes its charge and beam sequence. All three weapons have unlimited ammunition. Switching weapons or respawning does not bypass cooldowns; pausing freezes them.

Nuke strength in Settings affects future drops:

| Strength        | Damage radius | Crater radius | Added depth | Cloud height |
| --------------- | ------------- | ------------- | ----------- | ------------ |
| Local           | 70 m          | 35 m          | 12 m        | 120 m        |
| Castle-leveling | 180 m         | 70 m          | 20 m        | 240 m        |
| Valley-scale    | 420 m         | 160 m         | 25 m        | 400 m        |

Nukes begin with a white-hot core and a brief white exposure flash, strongest nearby when looking toward the impact. The peak holds for about 0.45–0.9 seconds and fades over 5.1–8 seconds according to blast size, revealing the golden pineapple-shaped smoke cloud and green crown plumes. Reduced effects substantially dims the flash and shortens its fade to 1.8 seconds; overlapping flashes use the strongest contribution rather than adding brightness. Pausing freezes the effect and resetting clears it. The grand fortress occupies 500 × 550 meters, with twelve perimeter/gate towers, crenellated outer walls, layered courtyards, a central palace, and four taller asymmetric spires. Warm sandstone, dark slate roofs, and narrow windows give it the silhouette of the supplied castle reference. Its eastward site and clear flight approach leave room beside the river and surrounding landmarks.

The world layout and save format are now version 6. Version-5 and older saves prompt for a new world or temporary play without overwriting the old save. They cannot be mapped safely onto the revised castle's component IDs.

The surrounding map contains four five-building hamlets, three farmsteads, three windmills, two watermills with docks and warehouses, four watchtowers, two additional bridges, two logging camps, and a quarry. Landmarks have independent breakable assemblies. There are no secondary explosions.

## Giant pineapple monsters

Eight giant, angry pineapple monsters crawl across the valley by default. They wander around passable ground, pursue nearby low-flying jets, wind up before throwing visible crown spikes, and swipe aircraft that fly close to their arms. Cannon blasts stagger them; three hits defeat one. Nukes defeat monsters in their damage radius, and a sustained space laser also destroys them. The HUD shows how many remain.

Monsters are now twice their original size, including their hitboxes and swipe reach. Their speed and three-hit health stay the same. While any space laser charges or burns, living monsters stop attacking and dance across the map; laser damage still affects monsters near the strike.

World → Pineapple monsters offers Off, 3, 8, and 20. Changes take effect immediately. Lower counts hide higher-numbered monsters without defeating them; raising the count reveals any that are still alive. Monster positions, damage, and defeats are saved with the world. Defeated monsters return only after Reset world. Existing compatible saves gain monsters automatically.

## Space laser

The laser now starts a valley-wide disco as soon as charging begins. A 250 m mirrored ball appears above the map center, the sky turns black while the ground remains visible under moving colored lights, and a generated beat plays through the existing volume and mute controls. The show ends when the last beam ends, even if excavation continues. Pausing and photo mode freeze the visuals and beat. Reduced effects lowers the disco lights without changing damage.

Press **3** to select Space Laser. Aim the jet toward a surface and click or press Space to lock that location. A four-second cyan-white charge builds from targeting rings, electrical arcs, rising energy, and sound. The sky-to-ground beam then burns for five seconds while the jet remains under your control. Flying into the bright central beam destroys the jet and triggers the usual two-second respawn; charging effects are harmless.

The **Space Laser** settings offer logarithmic strike size (380 m diameter through **Entire map**, 6,000 m diameter), crater depth (25–500 m), and beam brightness (25–200%). Size scales destruction, visuals, and the beam’s aircraft collision together. Each strike captures its launch settings; changing sliders applies to the next strike. Preferences persist and Reset settings restores the current default laser. Huge strikes finish terrain and object cleanup in queued sections, keeping the dry footprint active until cleanup completes. Existing version-5 saves load with default values for older strikes.

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

## Nuke presentation and sound

Nukes have a longer white exposure flash, a 4.5-second white-to-gold fireball and shockwave, then the existing pineapple cloud. Audio is generated locally: a sharp pressure crack, descending bass, filtered roar, rolling echoes, and a 10–14-second rumble tail according to blast size. Water impacts are more muffled. Nuke release has a deeper sound than the cannon. Up to four nuke voices remain active, with short crossfades when replacing older sounds. A shared compressor and soft peak ceiling control overlapping blasts; volume and mute still apply to the final output. No audio files or network services are required.

## Final polish and cameras

The game is now **Pineapple Siege**. Existing browser saves remain in the same IndexedDB database. Preferences migrate independently: Valley-scale is selected once on upgrade, then later strength changes are remembered. Graphics quality, sound, reduced effects/shake, performance display, and hold-time now persist through reloads and world resets.

The full-screen menu always shows Flight, Destruction, Graphics, Audio, and World settings, with no sections to expand. **Reset settings to defaults** restores every preference (including Valley-scale nukes, Standard debris, normal cooldowns, Auto quality, and 35% sound volume) and afternoon time without erasing world damage. Settings reset persists across reloads; **Reset world** remains a separate confirmed action. The HUD shows weapon selectors, cooldown progress, objects destroyed, and height above the actual deformed ground (AGL).

- **C:** toggle cinematic side, rear-quarter, and orbit shots. Flight and weapons stay under your control; C returns to chase immediately. Crash, respawn, pause, and reset return to chase.
- **P:** freeze the world and enter photo mode; P resumes the previous camera mode. Drag to look, use WASD to move, Q/E to move vertically, and Shift to move faster. H hides/shows photo controls. The toolbar adjusts field of view and saves a clean PNG at the current render resolution. Escape returns to the pause menu.

Photo mode waits for the simulation worker's pause acknowledgement. World effects and sound remain frozen while the camera moves. Camera state and transient dust/audio are never stored in world saves.

Engine audio now layers turbine and airflow with the existing engine body. Material-specific fracture, impact, and settling sounds share generated buffers, with up to 24 ordinary voices and four nuke voices. Craters expose soil and rock strata, fragments show contrasting cut faces, and pooled low dust lingers over impacts. These presentation changes do not alter permanent damage or remove unrestricted firing.

Earlier screenshots and performance reports are available in Git history.
