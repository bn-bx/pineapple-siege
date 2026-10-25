// Continuous carved anatomy. Each band/sector is a closed damage owner, with
// identical boundary samples on its neighbors and the same source for physics.
const mix = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, x) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const bump = (x, y, cx, cy, sx, sy) =>
  Math.exp(-(((x - cx) / sx) ** 2) - ((y - cy) / sy) ** 2);
function profile(y, knots) {
  for (let i = 1; i < knots.length; i++)
    if (y <= knots[i][0]) {
      const [a, av] = knots[i - 1],
        [b, bv] = knots[i];
      return mix(av, bv, (y - a) / (b - a));
    }
  return knots.at(-1)[1];
}
const FACE_PLANES = [
  [-0.76, [0.5, 0.5, 0.5, 0.46, 0.34, 0.18, 0]],
  [-0.7, [0.84, 0.84, 0.84, 0.82, 0.76, 0.62, 0]],
  [-0.6, [0.96, 0.96, 0.95, 0.93, 0.88, 0.72, 0]],
  [-0.5, [0.93, 0.93, 0.92, 0.9, 0.85, 0.72, 0]],
  [-0.42, [0.87, 0.87, 0.86, 0.84, 0.81, 0.69, 0]],
  [-0.36, [0.85, 0.85, 0.85, 0.83, 0.79, 0.67, 0]],
  [-0.31, [0.86, 0.86, 0.85, 0.84, 0.8, 0.68, 0]],
  [-0.26, [0.87, 0.88, 0.86, 0.83, 0.81, 0.66, 0]],
  [-0.2, [1.0, 1.0, 0.91, 0.87, 0.88, 0.7, 0]],
  [-0.12, [1.1, 1.02, 0.91, 0.96, 1.0, 0.77, 0]],
  [0, [1.04, 0.99, 0.88, 0.87, 0.95, 0.78, 0]],
  [0.14, [0.97, 0.84, 0.74, 0.73, 0.79, 0.74, 0]],
  [0.25, [0.9, 0.96, 0.98, 0.98, 0.94, 0.79, 0]],
  [0.36, [0.86, 0.87, 0.88, 0.88, 0.85, 0.72, 0]],
  [0.55, [0.83, 0.84, 0.84, 0.83, 0.8, 0.67, 0]],
  [0.72, [0.72, 0.73, 0.73, 0.72, 0.68, 0.55, 0]],
  [0.88, [0.51, 0.51, 0.51, 0.5, 0.46, 0.36, 0]],
  [1, [0, 0, 0, 0, 0, 0, 0]],
];
const FACE_COLUMNS = [0, 0.14, 0.3, 0.48, 0.66, 0.84, 1];
function facePlane(y, u) {
  let row = 1,
    col = 1;
  while (row < FACE_PLANES.length - 1 && y > FACE_PLANES[row][0]) row++;
  while (col < FACE_COLUMNS.length - 1 && u > FACE_COLUMNS[col]) col++;
  const [ay, a] = FACE_PLANES[row - 1],
    [by, b] = FACE_PLANES[row];
  const tx =
    (u - FACE_COLUMNS[col - 1]) / (FACE_COLUMNS[col] - FACE_COLUMNS[col - 1]);
  return mix(
    mix(a[col - 1], a[col], tx),
    mix(b[col - 1], b[col], tx),
    (y - ay) / (by - ay),
  );
}
function head(y, angle, facet = 0) {
  const width = profile(y, [
    [-0.76, 0.43],
    [-0.68, 0.58],
    [-0.5, 0.73],
    [-0.2, 0.78],
    [0.12, 0.73],
    [0.48, 0.72],
    [0.7, 0.66],
    [0.88, 0.48],
    [1, 0],
  ]);
  const depth = profile(y, [
    [-0.76, 0.42],
    [-0.68, 0.66],
    [-0.5, 0.78],
    [-0.2, 0.83],
    [0.12, 0.88],
    [0.48, 0.84],
    [0.7, 0.73],
    [0.88, 0.52],
    [1, 0],
  ]);
  const sine = Math.sin(angle),
    cosine = Math.cos(angle);
  let x = width * Math.sign(sine) * Math.abs(sine) ** 0.72,
    z = depth * cosine;
  if (cosine > 0) {
    // Artist-authored facial planes: rows run from the broad chin to the brow
    // and forehead; columns run from the center line to the temple bevel.
    const u = Math.abs(x) / Math.max(0.001, width);
    const mouthShift =
      0.015 *
      Math.min(1, (Math.abs(x) / 0.3) ** 2) *
      Math.exp(-((x / 0.36) ** 8)) *
      (1 - smooth(-0.25, -0.16, y)) *
      smooth(-0.55, -0.46, y);
    const faceY = y + Math.min(0.12, mouthShift);
    z = facePlane(faceY, u);
  }
  // Pineapple diamonds belong to the crown/temples, leaving the face readable.
  const rind = Math.max(smooth(0.49, 0.68, y), 1 - smooth(0.15, 0.65, cosine));
  const raised = facet * rind;
  x += sine * raised;
  z += cosine * raised;
  return [x, y, z];
}
function torso(y, angle) {
  const width = profile(y, [
    [-1, 0.57],
    [-0.65, 0.57],
    [-0.3, 0.59],
    [0.05, 0.7],
    [0.4, 0.94],
    [0.63, 1],
    [0.76, 0.87],
    [0.88, 0.58],
    [1, 0.27],
  ]);
  const depth = profile(y, [
    [-1, 0.58],
    [-0.65, 0.58],
    [-0.3, 0.64],
    [0.15, 0.74],
    [0.55, 0.81],
    [0.76, 0.64],
    [0.88, 0.48],
    [1, 0.43],
  ]);
  const x = width * Math.sin(angle),
    c = Math.cos(angle);
  let z = depth * c;
  const front = smooth(0.05, 0.8, c);
  if (c > 0) {
    z = mix(z, depth * (1 - 0.22 * (x / width) ** 2), front);
    let relief = 0;
    for (const side of [-1, 1]) {
      relief += 0.22 * bump(x, y, side * 0.43, 0.49, 0.35, 0.17); // broad pectorals
      relief -= 0.075 * bump(x, y, side * 0.43, 0.29, 0.33, 0.035); // infrapectoral crease
      for (const row of [-0.39, -0.15, 0.09])
        relief += 0.17 * bump(x, y, side * 0.19, row, 0.16, 0.09);
      relief += 0.085 * bump(x, y, side * 0.52, -0.2, 0.13, 0.3); // obliques
      relief += 0.085 * bump(x, y, side * 0.26, 0.83, 0.2, 0.13); // trapezius into neck
    }
    relief -= 0.065 * bump(x, y, 0, 0.43, 0.028, 0.28); // sternum
    relief -= 0.04 * bump(x, y, 0, -0.49, 0.04, 0.035);
    z += relief * front;
  }
  return [x, y > 0.76 ? 0.76 + (y - 0.76) * 0.1 : y, z];
}
function neck(y, angle) {
  const width = profile(y, [
      [-1, 1],
      [-0.3, 0.72],
      [1, 0.55],
    ]),
    x = width * Math.sin(angle),
    c = Math.cos(angle);
  let z = (0.7 - 0.12 * y) * c;
  if (c > 0)
    z +=
      (0.08 * bump(x, y, 0.3, 0, 0.1, 0.8) +
        0.08 * bump(x, y, -0.3, 0, 0.1, 0.8)) *
      c;
  return [x, y, z];
}
export function heroAnatomy(shape, band, azimuth) {
  const result = [],
    rows = shape === "hero-head" ? 10 : shape === "hero-neck" ? 4 : 6,
    cols = 6;
  const low = shape === "hero-head" ? -0.76 : -1;
  const lo = shape === "hero-neck" ? -1 : mix(low, 1, band / 6),
    hi = shape === "hero-neck" ? 1 : mix(low, 1, (band + 1) / 6);
  const half = shape === "hero-neck" ? Math.PI / 6 : Math.PI / 12;
  const left = azimuth - half,
    right = azimuth + half;
  const sample =
    shape === "hero-head" ? head : shape === "hero-neck" ? neck : torso;
  const local = (p) => [
    p[0] * Math.cos(azimuth) - p[2] * Math.sin(azimuth),
    p[1],
    p[0] * Math.sin(azimuth) + p[2] * Math.cos(azimuth),
  ];
  const tri = (a, b, c) => result.push(...local(a), ...local(b), ...local(c));
  const quad = (a, b, c, d) => {
    tri(a, b, c);
    tri(a, c, d);
  };
  for (let row = 0; row < rows; row++)
    for (let col = 0; col < cols; col++) {
      const a = mix(lo, hi, row / rows),
        b = mix(lo, hi, (row + 1) / rows),
        c = mix(left, right, col / cols),
        d = mix(left, right, (col + 1) / cols);
      const corners = [sample(a, c), sample(a, d), sample(b, d), sample(b, c)];
      const mid = sample(
        (a + b) / 2,
        (c + d) / 2,
        shape === "hero-head" ? 0.018 : 0,
      );
      for (let i = 0; i < 4; i++) tri(corners[i], corners[(i + 1) % 4], mid);
    }
  for (const angle of [left, right])
    for (let row = 0; row < rows; row++) {
      const a = mix(lo, hi, row / rows),
        b = mix(lo, hi, (row + 1) / rows);
      const points = [[0, a, 0], sample(a, angle), sample(b, angle), [0, b, 0]];
      quad(...(angle === left ? points.reverse() : points));
    }
  for (const y of [lo, hi])
    for (let col = 0; col < cols; col++) {
      const a = sample(y, mix(left, right, col / cols)),
        b = sample(y, mix(left, right, (col + 1) / cols)),
        c = [0, y, 0];
      tri(...(y === lo ? [c, b, a] : [c, a, b]));
    }
  return result;
}
