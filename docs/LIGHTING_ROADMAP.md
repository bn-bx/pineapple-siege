# Lighting roadmap

Done: phase 1a (shadow snapping, altitude-aware shadow frustum, bias tuning, normal-island haze) and phase 1b (island-wide terrain and statue shadows from a worker-computed horizon mask; see `src/render/terrain-sun-mask.ts`) and phase 2 sky (sun disc with limb darkening, glow and low-sun warming; a phase-lit moon that lights the night; twinkling stars; analytic sky reflections on metal; see `src/render/sky-bodies.ts` and `src/render/sky-reflection.ts`) and phase 3 local light (explosions, nukes, fires, burning fuel, muzzle flashes and a burning aircraft light their surroundings through up to 8 shader light slots; fires get glow halos and lit windows glow at night; see `src/render/dynamic-lights.ts` and `src/render/window-glow.ts`). Each phase ships with unit tests, before/after screenshots at fixed seeds and hours, and no production push until reviewed. Where npm or Vite can't run, `scripts/offline/` provides the test runner, type check, view capture and local preview.

Constraints: AO, bloom, and reflection targets were removed for performance and the larger performance scenarios remain uncertified, so every addition must be gated by quality profile and measured.

Known 1b limits, candidates for follow-up: the mask is 2D (an object's height is ignored, so tall towers in a valley shadow are darkened to the top); texels are 18 m; cavity/valley occlusion was not added.

## Phase 1c — Cascaded shadows (Ultra/High only)

- 2–3 cascades: sharp near (~150 m), mid (~800 m), far (several km).
- Far cascade refreshes about every 0.5 s and draws only static casters (terrain, buildings, statue).
- Balanced and below keep the single adaptive shadow map.

## Phase 2 — Remaining

- Baked per-vertex occlusion for building eaves/corners.
- A PMREM map was not needed: metals use an analytic sky gradient instead (no render targets, no measured frame cost).

## Phase 3 — Notes

- Lights are a shader loop over uniform arrays, not Three point lights, so the active count changes without recompiling (the laser keeps its own point light). Slots per quality: 8/8/6/4/2.
- No shadows from local lights; light passes through walls.
- Possible follow-ups: a small light on the laser impact for lower qualities, and window light spilling onto nearby ground.
