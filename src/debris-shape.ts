import type { Material, Quat, Vec3 } from "./types";

export const isRoof = (material: Material) =>
  material === "roof" || material === "slate";

/** Same five corners as the four-sided roofs used by the intact scenery. */
export function roofVertices(s: Vec3) {
  const [x, y, z] = s;
  return new Float32Array([
    -x,
    -y,
    -z,
    x,
    -y,
    -z,
    x,
    -y,
    z,
    -x,
    -y,
    z,
    0,
    y,
    0,
  ]);
}

/** Distance from the roof origin to its lowest rotated corner. */
export function roofClearance(s: Vec3, q: Quat) {
  const [x, y, z, w] = q;
  const rowX = 2 * (x * y + z * w),
    rowY = 1 - 2 * (x * x + z * z),
    rowZ = 2 * (y * z - x * w);
  return Math.max(
    Math.abs(rowX) * s[0] + rowY * s[1] + Math.abs(rowZ) * s[2],
    -rowY * s[1],
  );
}
