# Pineapple Siege

A flight and destruction sandbox on a seeded medieval island. Fly, fight giant pineapple monsters, demolish castles and settlements, and reshape terrain. Progress saves locally in the browser.

## Run locally

Use Node.js 22.12 or newer:

```sh
npm ci
npm run dev
```

Open the address printed by Vite. For verification and a static production build:

```sh
npm test
npm run build
npm run preview
```

The production application in `dist/` needs no backend or external asset service. Open it through a web server rather than directly from Finder.

## Play

| Input         | Action                                     |
| ------------- | ------------------------------------------ |
| Mouse / A, D  | Steer                                      |
| W / S         | Raise / lower throttle                     |
| Shift         | Boost                                      |
| 1 / 2 / 3 / 4 | Cannon / nuke / space laser / gravity bomb |
| Click / Space | Fire; hold to repeat                       |
| R             | Respawn                                    |
| Escape        | Pause                                      |
| C             | Chase / cinematic camera                   |
| P             | Frozen photo mode                          |
| Double-click  | Center steering                            |

Without mouse capture, drag to steer and use Space to fire. Touch controls provide a left steering pad and simultaneous Fire, Boost, throttle, weapon, respawn, and menu buttons.

The full-screen pause menu keeps Play/Resume at the top and all four settings groups visible together: Controls, Graphics, Audio, and World. Changes apply immediately and retain existing preference behavior. Controls includes rapid fire and steering/camera options; Graphics includes quality, CRT, detail distance, reduced effects, and Advanced diagnostics. World includes seed sharing, island creation, monster count, time of day, and reset. The Map tab shows the island's original terrain and landmarks with the aircraft's position when opened; damage and enemies are not shown. Controls guide provides keyboard, mouse, and touch help. Escape returns from Map or Controls guide to Settings; during flight it pauses. Island replacement and reset still require confirmation.

The Gravity Bomb (slot 4) drops a glowing capsule with aircraft momentum. On impact it creates a core 35 m overhead, expanding its pull from 30 m to 1,000 m over four seconds, tearing scenery into moving wreckage before flinging it outward. It leaves terrain unchanged and does not pull the aircraft. Drops have an eight-second cooldown (0.1 seconds with rapid fire); at most eight bombs can be active, and a full pool rejects drops without consuming cooldown. Active bombs are transient; their resulting destruction persists in saves.

All weapons have unlimited ammunition. Cannon shots launch at 420 m/s plus aircraft speed, with a 0.25-second cooldown; nuke cooldown is 10 seconds. The jet reaches 180 m/s at full throttle and 240 m/s with boost. Enemy spikes have bright orange cores and short luminous trails. Rapid fire replaces weapon cooldowns with 0.1 seconds and preserves the laser's charge/beam sequence. Nukes use fixed Valley strength; lasers use fixed 380 m diameter and 500 m excavation depth. Already-launched strikes retain saved parameters. Auto quality starts at Ultra (1440p), waits three seconds after starting or resuming, and lowers graphics only for sustained rendering slowdown. Healthy rendering restores one quality level every five seconds. Worker-only stalls and automatic quality reductions do not dim the global nuke flash; the Reduce effects checkbox still does. Pause and photo mode freeze simulation, cooldowns, effects, and audio. Photo mode supports camera movement, focus, and PNG export.

Crashes, water, intact structures, and substantial rubble remain physical. Automatic respawn, boundary assistance, collapse physics, craters, flooding, rubble collision, and wreckage cleanup remain active. Nukes excavate up to 48 / 80 / 100 m per ground-level Local / Castle / Valley strike at the crater center; repeated blasts stop 500 m below the original terrain. Ground-coupled nukes leave scattered fires for 60 seconds, with three times the original flame size and sprite density. Flames burn foliage after one second and wood after five seconds, damage creatures, and crash aircraft on direct contact. Water extinguishes fires; active fires persist in saves and freeze while paused. Terrain and casualties persist until reset. Destruction uses bounded moving-body and cosmetic pools.

## Island and progress

The 9,216 m island contains seeded mountains, rivers, forests, castles, farms, hamlets, mills, harbors, bridges, logging camps, and a quarry. Preview and accept a seed before playing; replacing an existing island requires the in-game replacement dialog. Monster attacks, warnings, stagger, defeats, and townspeople's fleeing, casualties, morale, mourning, and celebrations remain active. Monsters stop attacking and dance while lasers charge or burn; laser damage continues.

PS4 islands include a roughly 1 km tall seated Pineapple God in the mountains, with a carved pineapple face, leaf crown, scepter, throne, and stairs. Its stone and gold sections can be destroyed independently, unsupported sections collapse, and damage persists in saves. The map includes a Pineapple God waypoint. PS3 layouts use the existing incompatible-save recovery flow. Each ground pineapple monster defeat flashes the surviving statue eyes red for 10 seconds. Damage to its main figure permanently enrages surviving pineapple monsters: they grow two oversized wheels and pursue across the island at 60 m/s with faster attacks and a 750 m range. Wheeled monsters cross river surfaces, steer around obstacles and other monsters, maintain body clearance, spread around the player, yield in narrow passages, and recover from blocked routes; ocean water remains impassable. Rage persists across deaths and saves until the island resets; throne, stair, and rock damage alone does not trigger it. Existing PS4 saves are supported.

Rendering uses shared standard materials, detailed near trees with matching distant silhouettes and foliage motion, static mill machinery and banners, emissive windows, a basic sky, and one directional light. Coastal water includes shallow-water color, animated surf, beaches, and rock outcrops that follow terrain excavation. Weapon explosions, nuke flash/pineapple cloud, laser charge/beam, damage dust, debris, and basic exhaust remain. Googly eyes, reflections, ambient occlusion, bloom, and layered environment audio have been removed. Space-laser strikes trigger the island-wide disco show.

Sun shadows use a texel-snapped box that stays 440 m wide in ordinary flight and widens with altitude (up to 1,320 m on Ultra/High, 920 m on Balanced, 640 m on Performance), leading ahead along the view so terrain, buildings, and the Pineapple God cast shadows when seen from above; the two widest boxes refresh at half rate. The normal island has height-based aerial haze beyond 500 m that fades into the time-of-day horizon color, thinner at altitude, and matches the distant ocean backdrop. Additive glows are not hazed. Beyond the shadow box, mountains and the Pineapple God cast long island-wide shadows from an 18 m height grid computed in a worker; they follow the sun in half-degree steps, update after craters and statue damage, and leave water unshaded. Planned lighting work is in [lighting roadmap](docs/LIGHTING_ROADMAP.md).

The normal island's ocean meets an Earth-scale curved horizon that recedes with camera altitude. Nearby water fades into the sky-rendered ocean backdrop with matching day/night colors and calmer distant ripples. Local shorelines and water physics stay at sea level; the lava environment retains its existing rendering.

New islands use one seed-driven generator (revision 7 / world version 13), with substantially different coastlines, broader mountain ranges, lakes, regional landscapes, and varied settlements. One complete preview appears at a time; New island generates another. PS4, PS5 and PS6 islands and progress remain playable. Rolling uplands, winding valleys and smaller hills now continue between the mountain ranges. Save compatibility remains version 10; exact terrain-index sidecars preserve far-grid damage. See [island generation](docs/ISLAND_GENERATION.md) for the pipeline and verification. Historical saves remain protected by the recovery dialog; temporary play leaves them untouched. Save transactions remain incremental. Preference revision 5 adds the CRT selection, defaults missing or invalid modes to Subtle, and preserves supported choices. Graphics recovery can restore the renderer or reload without replacing saved progress.

## Verification

Where npm or Vite can't run, [offline checks](scripts/offline/README.md) run the same tests with plain Node, type-check, capture before/after views in headless Chromium, and serve a local preview. `npm test` covers flight, weapons, destruction, terrain, monsters, civilians, generator, saves, and presentation ownership. CRT preset checks and local timing results are documented in [CRT verification](docs/CRT_QA.md). `npm run assets:verify` checks the three shared audio assets against a completed build. `performance.html` uses an isolated save database for flight/combat runs at 120 and 400 monsters and a 15-minute rapid-fire soak. Native foreground browser measurements are required for performance certification; software rendering and simulation-only benchmarks cannot certify it.

See [simplification verification](docs/SIMPLIFICATION_QA.md) for measurements and limitations. See [architecture](ARCHITECTURE.md) for code ownership and [deployment](docs/DEPLOYMENT.md) for production releases. Generated reports belong in ignored `artifacts/`, not documentation.
