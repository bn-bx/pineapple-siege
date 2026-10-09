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

| Input         | Action                      |
| ------------- | --------------------------- |
| Mouse / A, D  | Steer                       |
| W / S         | Raise / lower throttle      |
| Shift         | Boost                       |
| 1 / 2 / 3     | Cannon / nuke / space laser |
| Click / Space | Fire; hold to repeat        |
| R             | Respawn                     |
| Escape        | Pause                       |
| C             | Chase / cinematic camera    |
| P             | Frozen photo mode           |
| Double-click  | Center steering             |

Without mouse capture, drag to steer and use Space to fire. Touch controls provide a left steering pad and simultaneous Fire, Boost, throttle, weapon, respawn, and menu buttons.

The full-screen pause menu keeps Play/Resume at the top and all four settings groups visible together: Controls, Graphics, Audio, and World. Changes apply immediately and retain existing preference behavior. Controls includes rapid fire and steering/camera options; Graphics includes quality, CRT, detail distance, reduced effects, and Advanced diagnostics. World includes seed sharing, island creation, monster count, time of day, and reset. The Map tab shows the island's original terrain and landmarks with the aircraft's position when opened; damage and enemies are not shown. Controls guide provides keyboard, mouse, and touch help. Escape returns from Map or Controls guide to Settings; during flight it pauses. Island replacement and reset still require confirmation.

All weapons have unlimited ammunition. Cannon shots launch at 420 m/s plus aircraft speed, with a 0.25-second cooldown; nuke cooldown is 10 seconds. The jet reaches 180 m/s at full throttle and 240 m/s with boost. Enemy spikes have bright orange cores and short luminous trails. Rapid fire replaces weapon cooldowns with 0.1 seconds and preserves the laser's charge/beam sequence. Nukes use fixed Valley strength; lasers use fixed 380 m diameter and 500 m excavation depth. Already-launched strikes retain saved parameters. Auto quality starts at Ultra (1440p), waits three seconds after starting or resuming, and lowers graphics only for sustained rendering slowdown. Healthy rendering restores one quality level every five seconds. Worker-only stalls and automatic quality reductions do not dim the global nuke flash; the Reduce effects checkbox still does. Pause and photo mode freeze simulation, cooldowns, effects, and audio. Photo mode supports camera movement, focus, and PNG export.

Crashes, water, intact structures, and substantial rubble remain physical. Automatic respawn, boundary assistance, collapse physics, craters, flooding, rubble collision, and wreckage cleanup remain active. Nukes excavate up to 48 / 80 / 100 m per ground-level Local / Castle / Valley strike at the crater center; repeated blasts stop 500 m below the original terrain. Terrain and casualties persist until reset. Destruction uses bounded moving-body and cosmetic pools.

## Island and progress

The 6,144 m island contains seeded mountains, rivers, forests, castles, farms, hamlets, mills, harbors, bridges, logging camps, and a quarry. Preview and accept a seed before playing; replacing an existing island requires the in-game replacement dialog. Monster attacks, warnings, stagger, defeats, and townspeople's fleeing, casualties, morale, mourning, and celebrations remain active. Monsters stop attacking and dance while lasers charge or burn; laser damage continues.

Rendering uses shared standard materials, simple near/distant trees, static mill machinery and banners, emissive windows, a basic sky, one directional light, and inexpensive ocean water. Weapon explosions, nuke flash/pineapple cloud, laser charge/beam, damage dust, debris, and basic exhaust remain. Decorative props, googly eyes, reflections, ambient occlusion, bloom, disco scenery/music, and layered environment audio have been removed.

World version 8, save compatibility 9, generator output, entity identities, and support/collision data are unchanged. Historical saves remain protected by the recovery dialog; temporary play leaves them untouched. Save transactions remain incremental. Preference revision 5 adds the CRT selection, defaults missing or invalid modes to Subtle, and preserves supported choices. Graphics recovery can restore the renderer or reload without replacing saved progress.

## Verification

`npm test` covers flight, weapons, destruction, terrain, monsters, civilians, generator, saves, and presentation ownership. CRT preset checks and local timing results are documented in [CRT verification](docs/CRT_QA.md). `npm run assets:verify` checks the three shared audio assets against a completed build. `performance.html` uses an isolated save database for flight/combat runs at 120 and 400 monsters and a 15-minute rapid-fire soak. Native foreground browser measurements are required for performance certification; software rendering and simulation-only benchmarks cannot certify it.

See [simplification verification](docs/SIMPLIFICATION_QA.md) for measurements and limitations. See [architecture](ARCHITECTURE.md) for code ownership and [deployment](docs/DEPLOYMENT.md) for production releases. Generated reports belong in ignored `artifacts/`, not documentation.
