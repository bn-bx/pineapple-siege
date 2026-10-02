import type { Material, Quat, Vec3 } from "./types";

export const isRoof = (material: Material) =>
  material === "roof" || material === "slate";

/** Four closed tetrahedra partition the pyramid without changing its silhouette. */
const corners: Vec3[] = [
  [-1, -1, -1],
  [1, -1, -1],
  [1, -1, 1],
  [-1, -1, 1],
];
export const roofParts = corners.map((a, i) => {
  const raw: Vec3[] = [a, corners[(i + 1) % 4], [0, -1, 0], [0, 1, 0]];
  const min = [0, 1, 2].map((k) => Math.min(...raw.map((v) => v[k])));
  const max = [0, 1, 2].map((k) => Math.max(...raw.map((v) => v[k])));
  const offset = min.map((v, k) => (v + max[k]) / 2) as Vec3;
  const size = min.map((v, k) => (max[k] - v) / 2) as Vec3;
  const vertices = raw.map(
    (v) => v.map((n, k) => (n - offset[k]) / size[k]) as Vec3,
  );
  // Weathered outside and underside first; two fresh fracture faces follow.
  return {
    offset,
    size,
    vertices,
    faces: [
      [0, 3, 1],
      [0, 1, 2],
      [0, 2, 3],
      [1, 3, 2],
    ],
  };
});

/** Same five corners as the four-sided roofs used by the intact scenery. */
export function roofVertices(s: Vec3, part = 0) {
  if (part)
    return new Float32Array(
      roofParts[part - 1].vertices.flatMap((v) => v.map((n, k) => n * s[k])),
    );
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
export function roofClearance(s: Vec3, q: Quat, part = 0) {
  const [x, y, z, w] = q;
  const rowX = 2 * (x * y + z * w),
    rowY = 1 - 2 * (x * x + z * z),
    rowZ = 2 * (y * z - x * w);
  if (part)
    return Math.max(
      ...roofParts[part - 1].vertices.map(
        (v) => -(rowX * v[0] * s[0] + rowY * v[1] * s[1] + rowZ * v[2] * s[2]),
      ),
    );
  return Math.max(
    Math.abs(rowX) * s[0] + rowY * s[1] + Math.abs(rowZ) * s[2],
    -rowY * s[1],
  );
}
