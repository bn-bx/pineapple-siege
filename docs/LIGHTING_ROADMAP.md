# Lighting roadmap

Done: phase 1a (shadow snapping, altitude-aware shadow frustum, bias tuning, normal-island haze) and phase 1b (island-wide terrain and statue shadows from a worker-computed horizon mask; see `src/render/terrain-sun-mask.ts`). Each phase ships with unit tests, before/after screenshots at fixed seeds and hours, and no production push until reviewed. Where npm or Vite can't run, `scripts/offline/` provides the test runner, type check, view capture and local preview.

Constraints: AO, bloom, and reflection targets were removed for performance and the larger performance scenarios remain uncertified, so every addition must be gated by quality profile and measured.

Known 1b limits, candidates for follow-up: the mask is 2D (an object's height is ignored, so tall towers in a valley shadow are darkened to the top); texels are 18 m; cavity/valley occlusion was not added.

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
