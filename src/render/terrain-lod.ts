// Prepare detail before the aircraft reaches it. Distance is measured along the
// swept flight path, so fast flight does not leave a gap behind the look-ahead.
export const TERRAIN_LOOK_AHEAD_SECONDS = 1.5;
const DETAIL_DISTANCES = [240, 600, 1000] as const;
const DETAIL_STEPS = [2, 4, 8, 16] as const;

export function terrainPathDistance(
  x: number,
  z: number,
  camera: { x: number; z: number },
  predicted = camera,
) {
  const dx = predicted.x - camera.x,
    dz = predicted.z - camera.z,
    lengthSquared = dx * dx + dz * dz,
    t = lengthSquared
      ? Math.max(
          0,
          Math.min(
            1,
            ((x - camera.x) * dx + (z - camera.z) * dz) / lengthSquared,
          ),
        )
      : 0;
  return Math.hypot(x - camera.x - dx * t, z - camera.z - dz * t);
}

export function terrainDetailStep(distance: number, previous = 0) {
  // Upgrade immediately; only delay downgrades to avoid oscillation at borders.
  const desired =
    DETAIL_STEPS[DETAIL_DISTANCES.findIndex((limit) => distance < limit)] ?? 16;
  if (previous && desired > previous) {
    const boundary =
      DETAIL_DISTANCES[DETAIL_STEPS.findIndex((step) => step === previous)];
    if (boundary !== undefined && distance < boundary * 1.15) return previous;
  }
  return desired;
}
