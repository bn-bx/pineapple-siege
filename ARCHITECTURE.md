# Architecture

## Canonical world

The build-time generator produces a 2048 × 2048-meter region, a 1025 × 1025 Float32 heightfield at two-meter spacing, and entities with stable IDs. The original valley occupies the central region. The manifest currently contains 5,773 structural parts and 12,593 total entities, including 21 distributed landmark sites.

The generated files are authoritative baseline assets. Runtime clients do not need matching JavaScript trigonometry implementations to regenerate that baseline. Increment the world version when changing generation rules or entity ordering so an old saved list of component IDs cannot be applied to a different castle.

Terrain sections are 64 meters wide. Rendering chooses two-, four-, or eight-meter spacing with shared two-meter stitched boundaries and globally sampled normals. Physics uses exact two-meter triangles matching terrain sampling. Shared edge samples come from one global array; crater updates mark both adjacent sections dirty. Rapier heightfield colliders are maintained around the aircraft and moving debris, while flight/projectile terrain sweeps query the canonical heightfield everywhere.

## Simulation authority

The worker owns the aircraft, projectiles, destruction, Rapier world, and time. Commands are ordered worker messages. The fixed-step loop advances at 60 Hz and bounds catch-up work after scheduling delays. The main thread interpolates aircraft positions and quaternion orientations on the same snapshot timeline, follows with a spring camera, renders effects, and handles UI and audio.

Flight uses an arcade steering model, not an aerodynamic solver. Aircraft and projectiles use swept queries plus heightfield sampling. Physics bodies are reserved for substantial fragments; the aircraft and projectiles are analytically advanced.

Structures start with static box colliders. Build-time adjacency connects touching parts within each structural assembly. After an impact or foundation excavation, rooted graph traversal finds unsupported components. These components become spatially grouped rigid-body sections. This is a gameplay support model, not engineering-grade structural stress analysis.

Strong debris impacts can break further pieces. Trees use a trunk collider and a moving tree representation; branches and foliage effects are cosmetic. The default global active-body cap is 256, adjustable from 64 to 8,192. Capacity pressure demotes the oldest moving body to lightweight ballistic motion; excess direct-impact pieces also use ballistic motion, and unsupported structure groups retain priority through grouping. Demotion preserves identity, position, rotation, linear velocity, and angular velocity.

## Weapons and large destruction jobs

`WeaponId` includes cannon, nuke, and laser, while `ProjectileWeapon` remains cannon/nuke; `NukeYield` resolves a configured blast profile at release. Commands select the weapon and yield. Snapshots expose independent cooldowns and typed projectiles. Elongated projectile bodies use swept capsule queries matching their six- and eighteen-meter render scale.

Nukes enqueue serializable terrain, entity, and support phases. The worker schedules approximately two milliseconds of extra destruction work per tick, completing an atomic terrain section or connectivity traversal before yielding; unsupported clusters are queued and consumed incrementally. A single atomic unit may exceed that soft budget; diagnostics report its measured duration. Canonical samples are assigned to exactly one section job, and all adjacent render/collision sections refresh together.

Entity and ruin spatial indexes avoid repeated whole-world scans during broad blasts. Static rubble is rendered in 128-meter batches covering four terrain sections, rebuilt only when their content changes; moving debris remains a separate instanced layer. Smoke clouds use camera-facing instanced puffs, expire after about twenty seconds, and are capped at three.

## Persistence and bounded aftermath

Terrain changes are compacted by sample index, and structural removal is a set of IDs. Rubble is spatially compacted to 36 records per 64-meter section by default (12–384 through preferences). Consolidation combines same-material records into rough piles with accumulated volume and collision proxies. Existing piles absorb further overflow so recognizable individual sections remain. Save capture uses the same compactor, rather than dropping moving pieces when a section is full.

A save stores a version, baseline world version/seed, revision, clock, edited samples, removed IDs, static rubble records, and pending destruction jobs. Edited terrain uses an interleaved Float32 buffer of exact sample indices and canonical heights; the worker transfers ownership of the new save buffer without cloning thousands of tuple objects. Version-5 saves support packed terrain arrays; older baseline versions require explicit recovery. The worker completes restored jobs before publishing its ready message. Active bodies are converted to stable ground-level rubble in save snapshots. Reset invalidates pending save requests so an older write cannot resurrect the prior destroyed world.

IndexedDB transactions provide atomic replacement of the current save. Interrupted writes report failure and leave the game playable. The game does not promise a final asynchronous write during tab termination; periodic autosaves and saving on pause are the primary protection.

## Rendering and budgets

Scenery uses spatially grouped instancing; distant pines use simpler geometry. Terrain damage updates existing vertex and normal buffers in marked sections; topology is rebuilt only when detail level changes. Shadows are updated periodically and focus on nearby geometry. Water uses a reduced-resolution reflected scene, procedural ripples, a connected-water mask, and depth-dependent tint. Transient explosion effects are omitted from reflections.

The first release approximates underwater appearance with terrain-depth color rather than tracing refraction through a complete underwater scene. Shoreline appearance is approximate; the connected flood mask controls where water exists.

Particles are pooled. Large rubble has real collision, while small visual particles do not. Cosmetic randomness is intentionally independent of the authority's terrain and structural state.

## Future multiplayer boundary

A future server should validate input and own authoritative impacts, terrain revisions, structural removals, and major rubble. A late joiner receives the baseline identity and a current compact world snapshot, then ordered deltas. Clients may predict flight and display immediate effects, reconciling with server snapshots later.

Do not synchronize every dust particle or rely on multiple browsers independently reproducing rigid-body trajectories. The current Rapier worker can inform a future server implementation, but transport, reconciliation, room hosting, authentication, and anti-cheat remain future work. Static Cloudflare Pages hosting does not dictate the simulation server provider.

Control and nuke preferences occupy a separate IndexedDB record. Reset clears only the current world. Baseline/save version 5 deliberately uses the existing incompatible-save recovery flow for older worlds.

## Flying wreckage

Blast profiles capture physical-body limits, launch speeds, and cosmetic-ejecta allocation. Prepared box partitions create two to six nonoverlapping physical pieces from a module. CCD is enabled for fast chunks. A canonical terrain sweep catches fast fragments crossing a streamed heightfield boundary; collision-tested movement remains consistent with edited ground. Both weapon classes shove existing moving wreckage and reactivate a spatially indexed selection of settled ruins. Nuke jobs store resolved profiles, excavation attenuation, deterministic seeds, and deferred support clusters so restoration does not drop unfinished damage.

`FragmentEffect` messages carry a seed, source position, blast origin, material, count, spread, and speed. The renderer owns a preallocated 65,536-instance pool with a configurable live budget of 1,024–65,536 (default 4,096) with terrain-swept ballistic motion and damped bounces. These pieces use no Rapier bodies, do not alter authoritative collision, and are not saved. Smoke, cosmetic chunks, and flashes are omitted from water reflections. Default physical caps are 64 pieces per cannon impact / 128 per nuke within a global cap of 256; preferences raise these to 2,048 / 4,096 / 8,192 respectively; chain collapses can contribute further bodies over subsequent ticks within that global cap.

Excess major wreckage starts at its source transform and advances in the worker with gravity, tumbling, canonical terrain sweeps, damped bounces, and map-boundary confinement. It becomes section-compacted static rubble only after resting on the current ground; there is no predicted landing teleport or airborne timeout settlement. This lightweight layer omits structure and mutual debris collisions, retains one representation per overflow source/group, participates in repeat blasts and laser cleanup, and shares packed body snapshots and save capture with Rapier bodies. Render instances grow as needed and interpolate position and quaternion orientation between snapshots. The performance display reports rigid and ballistic counts separately. Damage is independent of cosmetic quality. Craters have deterministic irregular contours and exposed soil/rock coloration; depth remains bounded by original terrain minus 25 meters.

## Experimental budgets and flight smoothing

`destruction-settings.ts` owns validated level mappings. Preferences are separate from world reset, and absent fields migrate to Standard. Worker commands change future budgets; nuke projectiles capture their entire resolved blast profile at release. Jobs retain that profile through serialization. Save snapshots include destruction settings so restoration completes with its original retention budget before current preferences apply. Disabling cooldown clears both weapon timers and bypasses projectile and pending-job admission limits. The fixed simulation fires once per tick while held; snapshots and the shared-asset projectile pool accommodate every live shot. Normal mode retains the usual timers and admission limits. Legacy noNukeCooldown preferences migrate to the all-weapon noCooldown setting. Larger blast scale never changes bedrock or the soft destruction job budget.

Static fallback preserves source module dimensions at every tier. Rubble retention controls record detail; consolidation preserves material volume in approximate local piles. Lowering live-body limits demotes at most sixteen excess bodies per tick without snapping them to the ground. A collider-to-moving-body index avoids scanning every moving body for each contact. Cosmetic pool resizing trims inactive slots in place.

`flightPose` uses quaternion slerp and position interpolation with the same alpha derived from the snapshot time interval; teleports snap rather than sweeping across the world. Camera aim has independent exponential smoothing, and the shake offset is applied after updating a stable unshaken camera position. Flight speeds, steering authority, boundary assistance and collision rules are unchanged.

## Final polish

`preferences.ts` normalizes persisted settings and applies preference revision 1. Migration chooses Valley-scale once without changing saved terrain, structures, experimental sliders, or storage identifiers. Presentation branding is independent of the existing `lantern-vale` database name.

Camera modes are chase, cinematic, and photo. Cinematic changes framing only. Photo sends the existing pause command and waits for a `paused` message carrying the authoritative snapshot before enabling free-camera movement. Rendering remains active with effect time frozen. Escape and interruption paths clear input and return to paused chase. PNG capture renders synchronously before `toBlob`, without preserveDrawingBuffer.

Transient `contactSound` messages carry position, material, energy, and action. Worker-side spatial/time aggregation bounds sound traffic without altering collisions or damage; audio reuses noise buffers and caps voices. Cut-face texture atlases and geometry are shared by moving and settled fragment instances. Scar color generation is shared by terrain build and refresh paths to preserve identical section edges. Dust uses a fixed 256-instance pool.

## Orbital laser and deep excavation

Space Laser locks a freshly swept surface target along the jet's forward aim. The worker owns each four-second charge and five-second beam, plus its independent cooldown. Normal release sets a 24-second timer (nine seconds active plus fifteen seconds recharge); unrestricted fire starts a strike every valid firing tick without shortening charge or beam duration.

The beam clears an expanding horizontal cylinder across the full vertical world column, reaching a 190-meter radius after one firing second. Structures and substantial debris are removed directly; vaporized source IDs suppress old deferred structure fragments. Outside wreckage from those sources remains valid. A separate support queue resolves surviving unsupported sections, and final cleanup removes debris inside the completed footprint.

Laser terrain jobs coalesce by 64-meter section and target, retaining the greatest requested progress. Absolute edits monotonically lower samples toward a steep, rim-tapered 500-meter shaft relative to baseline; duplicate/replayed work cannot deepen it further. Final strikes track their own outstanding sections, so continuing unrestricted fire does not prevent older strikes retiring. Work uses the shared soft destruction budget. Dry samples clear existing flood values and block subsequent flood traversal. Ordinary crater operations preserve already-deeper samples.

Version-5 saves include active strike ages/phases, per-section laser work, deferred support names, the independent laser cooldown, packed dry sample IDs, and vaporized component IDs. Queued edits complete before ready; unfinished live strike clocks remain frozen until play resumes. Restoration permits depths down to baseline minus 500 meters only in saved laser areas. The existing incompatible-save recovery dialog protects older baselines and preferences.

Rendering uses shared instanced cylinders, rings, impact discs, and a fixed electrical-arc buffer. The nearest 64 strikes have detailed presentation; remaining strikes use a growing pool of simple columns. Four selected spatial audio voices share generated noise and the existing compressor/ceiling. Effects follow simulation time and reset/pause/photo behavior. Photo movement can descend into deep shafts. Substantial bodies use terrain-relative escape checks instead of an absolute negative-altitude cutoff.


## Configurable space laser

Destruction preferences normalize laser size (0–100, logarithmic 190–3,000 m radius), depth (25–500 m), and brightness (0.25–2). Launch captures a profile on each strike; physics, visuals, and saved work use that profile independently of later preference changes. Older version-5 profiles and work targets resolve to defaults without replacing the world.

Excavation targets carry radius/depth and coalesce only when center and both dimensions match. Work yields between terrain sections and between independent targets. For radii over 500 m, section work also performs static object and settled-rubble cleanup across all map sections, including fragments whose centers lie outside the footprint but whose dimensions intersect it. Moving debris and cosmetic chunks are cleared during the burn; newly settling fragments are suppressed by the active footprint. Final section acknowledgements retain each finishing strike until its cleanup completes.

## High-count debris performance

Body snapshots retain the in-process `BodyView[]` API for saves and tests. Worker snapshots instead contain one transferable `PackedBodies` buffer: 50 bytes per body, with signed integer identity/source, ten Float32 transform components, and byte material/kind tags. The main thread decodes once per arrival, including pause/photo snapshots. The worker never transfers a live physics buffer. Body IDs retain integer precision and transforms use submillimeter Float32 accuracy across the map.

The cosmetic pool stores live fragments contiguously in a preallocated Float32 buffer. Expiration and vaporization swap the last live slot into the removed slot; lowering the limit truncates the live prefix permanently. Burst work is capped by the pool's limit. Transform composition writes directly into the instance buffer; colors update only when pool membership changes. Paused, unchanged frames reuse buffers. Moving rigid-body instance capacity follows the largest physics setting, updates once per snapshot, and uploads only occupied ranges.

Physical updates reuse view transforms, avoid duplicate Rapier translation reads, cache size bounds, and settle sleeping bodies before other reads. Map insertion order gives constant-time oldest-body eviction. CCD starts enabled only for chunks fast enough to need it and is refreshed when existing wreckage is blasted. Terrain sections cache a conservative maximum including shared border samples; a segment above every intersected section's maximum skips the terrain sweep. Craters, laser excavation, and restoration only lower the baseline, so these bounds remain valid. Other segments retain their original canonical sweep and streamed Rapier collision.

Run `npm run benchmark:destruction` for separated airborne-body, transferable-snapshot, cosmetic-update, and actual castle-collapse CPU timings. It prints mean and p95 in milliseconds; it does not measure browser GPU cost or promise a frame rate. Defaults retain 256 active bodies and 4,096 cosmetic chunks. Extreme supports 8,192 bodies, 2,048 cannon / 4,096 nuke pieces per blast, and 65,536 cosmetic chunks. Above 512 active bodies, collision layers retain the 128 largest sections as major bodies. Other physical chunks collide with the world and major bodies, but omit mutual chip contacts. New large pieces fill available major slots. Full mutual collision is restored at 256 bodies, with hysteresis preventing repeated graph rebuilds. Collider removal, laser vaporization, and settlement maintain this budget. Default-sized explosions retain full contacts. Dense ground contact and shadow/reflection rendering remain workload-dependent.

The local CPU comparison on 2026-10-01 used the same generated world and requested body budgets, with the original simulation/cosmetic implementations as baseline. Mean/p95 timings were: 8,192 airborne bodies, 15.35/19.18 ms → 11.25/13.64 ms per step; their snapshot preparation/transfer, 27.14/29.51 ms → 1.41/1.66 ms (decode adds 0.14/0.23 ms); 16,384 cosmetic chunks over flat ground, 3.15/3.35 ms → 1.96/2.04 ms per update. The new pool updated 65,536 cosmetic chunks in 7.99/8.22 ms. The 4,096-body castle collapse averaged 39.86/52.76 ms → 28.38/44.15 ms, ending with 5,167 vs 5,986 moving pieces because collision scaling changes subsequent contact cascades. These are single local runs, not browser frame-rate guarantees; dense collapses still exceed a 16.7 ms simulation budget.


## Continuous overflow debris

The ballistic update benchmark added on 2026-10-01 measured airborne batches at 4,096 pieces: mean 0.58 ms / p95 0.90 ms, and 16,384 pieces: mean 2.14 ms / p95 3.13 ms. These isolated worker CPU timings exclude rendering, snapshots, rubble insertion, and dense terrain contacts. The browser verification of a default Valley-scale castle blast showed 3,906 ballistic pieces plus 152 rigid bodies at 0.75 simulation seconds, and 3,486 ballistic pieces plus 178 rigid bodies at 1.75 seconds. Counts change as debris lands and contact cascades break surviving structures. Save capture retains the established behavior of recording airborne wreckage as ground-level rubble without changing live motion.


## Roof silhouettes and distant flash

Debris gravity is shared by Rapier bodies, worker ballistic wreckage, and cosmetic chips at 21.6 m/s² (20% above the earlier 18). Weapon projectile gravity is unchanged. Roof and slate sections fracture into four closed tetrahedral wedges that exactly partition the intact pointed roof. Each wedge retains its original sloped exterior and has two exposed cut faces. Moving and settled colliders share the same vertices as rendering, and lightweight landing and save capture use each rotated wedge's lowest corner. Roof wedges remain independent through support collapse, physics budget overflow, settlement, reblasting and save restoration. Four cached geometries are instanced by material and shape. The optional `roofPart` tag occupies spare bits in the kind byte, keeping packed body buffers at 50 bytes and old saves compatible. Rubble consolidation retains actual pyramid/wedge volume and clears the individual shape tag when creating a pile.

Nuke exposure reaches 2,200–6,000 meters according to yield/scale, giving a visible atmospheric wash across the whole valley even when the blast is behind the camera. Looking toward the blast remains brighter. Pulse durations, strongest-only overlapping contributions, pause/reset behavior, and the reduced-effects opacity cap and short fade remain unchanged.
