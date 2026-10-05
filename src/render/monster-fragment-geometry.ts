import * as THREE from "three";

/** Clip textured triangles into a body quarter while preserving UVs and normals. */
export function monsterBodyQuarter(
  source: THREE.BufferGeometry,
  left: boolean,
  upper: boolean,
) {
  const g = source.index ? source.toNonIndexed() : source;
  const position = g.getAttribute("position"),
    normal = g.getAttribute("normal"),
    uv = g.getAttribute("uv");
  type Vertex = number[];
  const out: number[][] = [];
  const planes = [
    (v: Vertex) => (left ? -1 : 1) * v[0],
    (v: Vertex) => (upper ? 1 : -1) * (v[1] - 15),
  ];
  for (let i = 0; i < position.count; i += 3) {
    let polygon: Vertex[] = [0, 1, 2].map((j) => [
      position.getX(i + j),
      position.getY(i + j),
      position.getZ(i + j),
      normal.getX(i + j),
      normal.getY(i + j),
      normal.getZ(i + j),
      uv?.getX(i + j) ?? 0,
      uv?.getY(i + j) ?? 0,
    ]);
    for (const distance of planes) {
      const clipped: Vertex[] = [];
      for (let k = 0; k < polygon.length; k++) {
        const a = polygon[k],
          b = polygon[(k + 1) % polygon.length],
          da = distance(a),
          db = distance(b);
        if (da >= 0) clipped.push(a);
        if (da >= 0 !== db >= 0) {
          const t = da / (da - db);
          clipped.push(a.map((v, n) => v + (b[n] - v) * t));
        }
      }
      polygon = clipped;
    }
    for (let k = 1; k + 1 < polygon.length; k++)
      out.push(polygon[0], polygon[k], polygon[k + 1]);
  }
  if (g !== source) g.dispose();
  const result = new THREE.BufferGeometry();
  result.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(
      out.flatMap((v) => v.slice(0, 3)),
      3,
    ),
  );
  result.setAttribute(
    "normal",
    new THREE.Float32BufferAttribute(
      out.flatMap((v) => v.slice(3, 6)),
      3,
    ),
  );
  result.setAttribute(
    "uv",
    new THREE.Float32BufferAttribute(
      out.flatMap((v) => v.slice(6, 8)),
      2,
    ),
  );
  return result;
}
/** Yellow flesh closes both exposed cut surfaces, avoiding hollow fruit chunks. */
export function monsterQuarterCaps(left: boolean, upper: boolean) {
  const positions: number[] = [],
    sign = left ? -1 : 1,
    vertical = upper ? 1 : -1;
  for (let plane = 0; plane < 2; plane++)
    for (let i = 0; i < 20; i++) {
      const point = (a: number) =>
        plane === 0
          ? [0, 15 + vertical * Math.sin(a) * 12, Math.cos(a) * 8]
          : [sign * Math.sin(a) * 9, 15, Math.cos(a) * 8];
      positions.push(
        0,
        15,
        0,
        ...point((i * Math.PI) / 20),
        ...point(((i + 1) * Math.PI) / 20),
      );
    }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geometry.computeVertexNormals();
  return geometry;
}
