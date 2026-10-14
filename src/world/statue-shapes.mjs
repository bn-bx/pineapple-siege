// Shared source geometry keeps generated collision bounds and both render views aligned.
export function statueShape(shape, band = 0) {
  const positions = [];
  const tri = (a, b, c) => positions.push(...a, ...b, ...c);
  const quad = (a, b, c, d) => {
    tri(a, b, c);
    tri(a, c, d);
  };
  if (shape === "box" || shape === "leaf" || shape === "diamond") {
    const points =
      shape === "leaf"
        ? [
            [-0.7, -1, -0.25],
            [0.7, -1, -0.25],
            [1, -0.2, 0],
            [0, 1, 0.65],
            [-1, -0.2, 0],
            [0, -0.35, 0.4],
          ]
        : shape === "diamond"
          ? [
              [0, -1, 0],
              [1, 0, 0],
              [0, 1, 0],
              [-1, 0, 0],
              [0, 0, 1],
              [0, 0, -1],
            ]
          : [
              [-1, -1, -1],
              [1, -1, -1],
              [1, 1, -1],
              [-1, 1, -1],
              [-1, -1, 1],
              [1, -1, 1],
              [1, 1, 1],
              [-1, 1, 1],
            ];
    if (shape === "box")
      for (const face of [
        [0, 3, 2, 1],
        [4, 5, 6, 7],
        [0, 1, 5, 4],
        [3, 7, 6, 2],
        [0, 4, 7, 3],
        [1, 2, 6, 5],
      ])
        quad(...face.map((i) => points[i]));
    else if (shape === "diamond")
      for (let i = 0; i < 4; i++) {
        tri(points[i], points[(i + 1) % 4], points[4]);
        tri(points[(i + 1) % 4], points[i], points[5]);
      }
    else {
      for (let i = 0; i < 5; i++)
        tri(points[i], points[(i + 1) % 5], points[5]);
      tri(points[0], points[4], points[3]);
      tri(points[0], points[3], points[2]);
      tri(points[0], points[2], points[1]);
    }
    return positions;
  }
  const rock = shape === "rock";
  const sector = shape !== "ellipsoid" && !rock,
    carved = shape === "pineapple";
  const lo = sector ? -Math.PI / 2 + (band * Math.PI) / 6 : -Math.PI / 2;
  const hi = sector ? lo + Math.PI / 6 : Math.PI / 2;
  const left = sector ? -Math.PI / 12 : -Math.PI;
  const right = sector ? Math.PI / 12 : Math.PI;
  const rows = rock ? 5 : sector ? 4 : 12,
    cols = rock ? 9 : sector ? 4 : 24;
  const point = (lat, lon, relief = 0) => {
    const radius = rock ? 0.88 + 0.12 * Math.cos(lon * 3 + lat * 5) : 1;
    return [
      (Math.cos(lat) + relief) * Math.sin(lon) * radius,
      Math.sin(lat),
      (Math.cos(lat) + relief) * Math.cos(lon) * radius,
    ];
  };
  for (let y = 0; y < rows; y++)
    for (let x = 0; x < cols; x++) {
      const a = lo + ((hi - lo) * y) / rows,
        b = lo + ((hi - lo) * (y + 1)) / rows;
      const c = left + ((right - left) * x) / cols,
        d = left + ((right - left) * (x + 1)) / cols;
      const corners = [point(a, c), point(a, d), point(b, d), point(b, c)];
      // Raised diamond facets are part of the owning section, never separate floating trim.
      const mid = point((a + b) / 2, (c + d) / 2, carved ? 0.027 : 0);
      for (let i = 0; i < 4; i++) tri(corners[i], corners[(i + 1) % 4], mid);
    }
  if (sector) {
    for (const lon of [left, right])
      for (let y = 0; y < rows; y++) {
        const a = lo + ((hi - lo) * y) / rows,
          b = lo + ((hi - lo) * (y + 1)) / rows;
        const p = [
          [0, Math.sin(a), 0],
          point(a, lon),
          point(b, lon),
          [0, Math.sin(b), 0],
        ];
        quad(...(lon === left ? p.reverse() : p));
      }
    for (const lat of [lo, hi])
      for (let x = 0; x < cols; x++) {
        const a = point(lat, left + ((right - left) * x) / cols),
          b = point(lat, left + ((right - left) * (x + 1)) / cols),
          c = [0, Math.sin(lat), 0];
        tri(...(lat === lo ? [c, b, a] : [c, a, b]));
      }
  }
  return positions;
}

export function rotateStatuePoint([x, y, z], [rx, ry, rz]) {
  [y, z] = [
    y * Math.cos(rx) - z * Math.sin(rx),
    y * Math.sin(rx) + z * Math.cos(rx),
  ];
  [x, z] = [
    x * Math.cos(ry) + z * Math.sin(ry),
    -x * Math.sin(ry) + z * Math.cos(ry),
  ];
  return [
    x * Math.cos(rz) - y * Math.sin(rz),
    x * Math.sin(rz) + y * Math.cos(rz),
    z,
  ];
}
