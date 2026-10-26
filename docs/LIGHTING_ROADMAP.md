# Lighting roadmap

Phase 1a (shadow snapping, altitude-aware shadow frustum, bias tuning, normal-island haze) is in progress. The phases below are planned for later. Each phase ships with unit tests, before/after screenshots at fixed seeds and hours (noon low, noon high, golden hour, night, distant Pineapple God), `performance.html` before/after timings, and no production push until reviewed.

Constraints: AO, bloom, and reflection targets were removed for performance and the larger performance scenarios remain uncertified, so every addition must be gated by quality profile and measured.

## Phase 1b — Island-wide terrain shadows and cavity shading

- Compute a sun-horizon shadow mask from the terrain heightmap in the terrain worker; sample it in the terrain/scenery shader so mountains and the Pineapple God cast long shadows island-wide at near-zero GPU cost.
- Same pass produces a cavity/valley occlusion term (cheap AO substitute).
- Recompute only when the sun angle moves past a threshold or terrain revisions (craters) change affected pages.

## Phase 1c — Cascaded shadows (Ultra/High only)

- 2–3 cascades: sharp near (~150 m), mid (~800 m), far (several km).
- Far cascade refreshes about every 0.5 s and draws only static casters (terrain, buildings, statue).
- Balanced and below keep the single adaptive shadow map.

## Phase 2 — Sky and atmosphere

- PMREM environment map from the existing sky shader, regenerated on meaningful hour changes, for sky-tinted ambient and specular (water, gold, metal).
- Time-of-day curves: warmer golden hour, per-hour exposure, moonlight balance, optional stars.
- Baked per-vertex occlusion for building eaves/corners.

## Phase 3 — Local dynamic light

- Fixed pool of about 4 point lights (constant count avoids shader recompiles from light-count defines) assigned to the nearest explosions, nuke flash, fires, muzzle flashes, and fuel wrecks; unused lights at zero intensity.
- Night windows and fires use fake glow decals rather than real lights.
