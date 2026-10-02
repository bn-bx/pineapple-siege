import { mkdirSync, writeFileSync } from "node:fs";
const SIZE = 2048,
  STEP = 2,
  GRID = SIZE / STEP + 1,
  OFFSET = 768,
  SEED = 41729;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v)),
  mix = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, x) => {
  let t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
function hash(x, z) {
  let n = Math.imul(x, 374761393) ^ Math.imul(z, 668265263) ^ SEED;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
}
function noise(x, z) {
  let ix = Math.floor(x),
    iz = Math.floor(z),
    fx = x - ix,
    fz = z - iz;
  fx = fx * fx * (3 - 2 * fx);
  fz = fz * fz * (3 - 2 * fz);
  return mix(
    mix(hash(ix, iz), hash(ix + 1, iz), fx),
    mix(hash(ix, iz + 1), hash(ix + 1, iz + 1), fx),
    fz,
  );
}
const fbm = (x, z) =>
  noise(x, z) * 0.57 +
  noise(x * 2.03 + 19, z * 2.03 + 9) * 0.28 +
  noise(x * 4.07, z * 4.07) * 0.15;
const FX = 1320,
  FZ = 1070,
  HALF_X = 120,
  HALF_Z = 135,
  FLOOR = 10,
  SCALE_X = 500 / 240,
  SCALE_Z = 550 / 270,
  SCALE_Y = 1.75,
  CASTLE_X = HALF_X * SCALE_X,
  CASTLE_Z = HALF_Z * SCALE_Z;
const riverX = (z) =>
    248 + 30 * Math.sin(z * 0.014) + 13 * Math.sin(z * 0.033 + 0.7),
  riverW = (z) => 10.5 + 2.8 * Math.sin(z * 0.023 + 1.4);
const BX = riverX(220),
  paths = [
    [
      [210, 166],
      [BX - 45, 202],
      [BX - 34, 220],
      [BX + 34, 220],
      [340, 205],
      [FX - OFFSET, FZ - CASTLE_Z - OFFSET - 22],
      [FX - OFFSET, FZ - CASTLE_Z - OFFSET],
    ],
    [
      [350, 238],
      [398, 232],
      [413, 270],
      [418, 329],
      [390, 392],
      [365, 425],
    ],
    [
      [BX - 42, 220],
      [185, 251],
      [170, 298],
      [194, 338],
      [238, 343],
    ],
  ];
function distanceSegment(x, z, a, b) {
  let dx = b[0] - a[0],
    dz = b[1] - a[1],
    t = clamp(((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz), 0, 1);
  return Math.hypot(x - a[0] - t * dx, z - a[1] - t * dz);
}
function pathDistance(x, z) {
  let d = 1e9;
  for (const path of paths)
    for (let i = 1; i < path.length; i++)
      d = Math.min(d, distanceSegment(x, z, path[i - 1], path[i]));
  return d;
}
function original(x, z) {
  let edge = Math.max(Math.abs(x - 256), Math.abs(z - 256));
  let h =
    3.7 +
    fbm(x * 0.017, z * 0.017) * 7 +
    Math.sin(x * 0.025 + z * 0.009) * 2 +
    smooth(175, 251, edge) * (17 + 48 * fbm(x * 0.025 + 12, z * 0.026));
  h +=
    smooth(330, 435, z) *
    (23 + 21 * fbm(x * 0.03, z * 0.03)) *
    (1 - smooth(440, 502, z));
  let rd = Math.abs(x - riverX(z)),
    rw = riverW(z),
    bed = -3.4 + smooth(0, rw, rd) * 2.35 + 0.16 * noise(x * 0.3, z * 0.3);
  h = mix(bed, h, smooth(rw, rw + 17, rd));
  h = mix(
    h,
    10,
    1 -
      smooth(
        0,
        25,
        Math.max(
          Math.abs(x + OFFSET - FX) - HALF_X - 12,
          Math.abs(z + OFFSET - FZ) - HALF_Z - 12,
        ),
      ),
  );
  let approach =
    (1 - smooth(5, 20, Math.abs(z - 220))) *
    (1 - smooth(40, 58, Math.abs(x - BX)));
  h = mix(
    h,
    mix(Math.min(h, 1.9), 2.2, smooth(28, 32, Math.abs(x - BX))),
    approach,
  );
  return h;
}
function raw(x, z) {
  let lx = x - OFFSET,
    lz = z - OFFSET,
    edge = Math.max(Math.abs(lx - 256), Math.abs(lz - 256));
  let h =
    12 +
    fbm(x * 0.004, z * 0.004) * 90 +
    Math.pow(fbm(x * 0.008 + 42, z * 0.008 + 19), 2) * 85;
  h += smooth(790, 1024, Math.max(Math.abs(x - 1024), Math.abs(z - 1024))) * 80;
  let rd = Math.abs(lx - riverX(lz)),
    rw = riverW(lz);
  h = mix(-3.5 + (rd / rw) * 0.8, h, smooth(rw, rw + 42, rd));
  return mix(
    original(clamp(lx, -60, 572), clamp(lz, -60, 572)),
    h,
    smooth(245, 340, edge),
  );
}
const sites = [];
function site(kind, x, z, radius) {
  const id = `${kind}-${sites.filter((s) => s.kind === kind).length + 1}`;
  sites.push({
    id,
    kind,
    p: [x, kind === "watermill" ? 5 : raw(x, z), z],
    radius,
    bounds: { min: [x - radius, z - radius], max: [x + radius, z + radius] },
    assemblies: [],
  });
}
for (const p of [
  [560, 620],
  [1510, 650],
  [580, 1430],
  [1530, 1510],
])
  site("hamlet", ...p, 65);
for (const p of [
  [370, 1050],
  [1660, 1060],
  [1290, 1650],
])
  site("farm", ...p, 48);
for (const p of [
  [700, 440],
  [1450, 400],
  [410, 1610],
])
  site("windmill", ...p, 24);
for (const z of [570, 1470])
  site(
    "watermill",
    OFFSET + riverX(z - OFFSET) + riverW(z - OFFSET) + 25,
    z,
    52,
  );
for (const p of [
  [350, 420],
  [1730, 580],
  [1740, 1550],
  [720, 1740],
])
  site("watchtower", ...p, 20);
for (const z of [720, 1330])
  site("crossing", OFFSET + riverX(z - OFFSET), z, 60);
for (const p of [
  [690, 1160],
  [1800, 1280],
])
  site("logging", ...p, 36);
site("quarry", 1670, 820, 52);
for (const s of sites) {
  const [x, , z] = s.p;
  if (s.kind === "crossing") continue;
  paths.push([
    [x - OFFSET, z - OFFSET],
    [x - OFFSET + (x < 1024 ? 60 : -60), z - OFFSET],
    [FX - OFFSET, FZ - CASTLE_Z - OFFSET - 22],
  ]);
}
function ground(x, z) {
  let h = raw(x, z);
  const castleBlend =
    1 -
    smooth(
      0,
      25,
      Math.max(
        Math.abs(x - FX) - CASTLE_X - 12,
        Math.abs(z - FZ) - CASTLE_Z - 12,
      ),
    );
  h = mix(h, FLOOR, castleBlend);
  for (const s of sites) {
    if (s.kind === "crossing") continue;
    if (s.kind === "watermill") {
      const bank = Math.max(
        Math.abs(x - (s.p[0] + 16)) - 30,
        Math.abs(z - s.p[2]) - 36,
      );
      h = mix(h, s.p[1], 1 - smooth(0, 9, bank));
      continue;
    }
    const d = Math.max(Math.abs(x - s.p[0]), Math.abs(z - s.p[2]));
    h = mix(h, s.p[1], 1 - smooth(s.radius - 8, s.radius + 12, d));
  }
  return h;
}
const heights = new Float32Array(GRID * GRID);
for (let z = 0; z < GRID; z++)
  for (let x = 0; x < GRID; x++)
    heights[z * GRID + x] = ground(x * STEP, z * STEP);
function sample(x, z) {
  let gx = clamp(x / STEP, 0, GRID - 1.001),
    gz = clamp(z / STEP, 0, GRID - 1.001),
    ix = Math.floor(gx),
    iz = Math.floor(gz),
    u = gx - ix,
    v = gz - iz,
    i = iz * GRID + ix,
    a = heights[i],
    b = heights[i + 1],
    c = heights[i + GRID],
    d = heights[i + GRID + 1];
  return u + v <= 1
    ? a + (b - a) * u + (c - a) * v
    : d + (c - d) * (1 - u) + (b - d) * (1 - v);
}
const entities = [];
function add(
  kind,
  x,
  y,
  z,
  sx,
  sy,
  sz,
  material,
  assembly = "",
  foundation = false,
) {
  const e = {
    id: entities.length,
    kind,
    p: [x, y, z],
    s: [sx, sy, sz],
    material,
    assembly,
    foundation,
    supports: [],
    variant: hash(Math.round(x * 7), Math.round(z * 9)),
  };
  entities.push(e);
  return e;
}
const fx = FX,
  fz = FZ,
  floor = FLOOR;
const banners = [],
  lights = [],
  towers = [];
function wall(
  name,
  cx,
  cz,
  length,
  axis,
  height = 24,
  gate = false,
  base = floor,
) {
  const n = Math.ceil(length / 8),
    span = length / n,
    layers = Math.ceil(height / 5),
    dy = height / layers;
  for (let l = 0; l < layers; l++)
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) * span - length / 2;
      const cy = (l + 0.5) * dy;
      const opening = cy < 10 ? 8 : cy < 13 ? 5 : cy < 16 ? 2 : 0;
      if (gate && Math.abs(t) < opening) continue;
      add(
        "block",
        cx + (axis === 0 ? t : 0),
        base + (l + 0.5) * dy,
        cz + (axis === 1 ? t : 0),
        axis === 0 ? span / 2 : 2.4,
        dy / 2,
        axis === 1 ? span / 2 : 2.4,
        "sandstone",
        name,
        l === 0 && base === floor,
      );
    }
  for (let i = 0; i < n; i += 2) {
    const t = (i + 0.5) * span - length / 2;
    add(
      "block",
      cx + (axis === 0 ? t : 0),
      base + height + 1.4,
      cz + (axis === 1 ? t : 0),
      axis === 0 ? 1.65 : 2.6,
      1.4,
      axis === 1 ? 1.65 : 2.6,
      "sandstone",
      name,
    );
  }
  // Buttresses strengthen the silhouette without individual-brick physics.
  for (let i = 0; i < n; i += 4) {
    const t = (i + 0.5) * span - length / 2;
    if (gate && Math.abs(t) < 12) continue;
    for (let l = 0; l < 3; l++)
      add(
        "block",
        cx + (axis === 0 ? t : 3.1),
        floor + 3 + l * 6,
        cz + (axis === 1 ? t : 3.1),
        axis === 0 ? 1.7 : 3.8 - l * 0.45,
        3,
        axis === 1 ? 1.7 : 3.8 - l * 0.45,
        "sandstone",
        name,
        l === 0,
      );
  }
}
function tower(
  name,
  cx,
  cz,
  height = 50,
  width = 18,
  roof = false,
  landmark = true,
) {
  if (landmark) towers.push([cx, floor, cz]);
  const cell = width / 3;
  for (let l = 0; l < Math.ceil(height / 5); l++)
    for (let x = 0; x < 3; x++)
      for (let z = 0; z < 3; z++) {
        if (x === 1 && z === 1) continue;
        if (l % 4 === 2 && x === 1 && z === 0) continue;
        add(
          "block",
          cx + (x - 1) * cell,
          floor + (l + 0.5) * 5,
          cz + (z - 1) * cell,
          cell / 2,
          2.5,
          cell / 2,
          "sandstone",
          name,
          l === 0,
        );
      }
  for (let y = 17; y < height - 7; y += 17) {
    for (const side of [-1, 1]) {
      add(
        "block",
        cx,
        floor + y,
        cz + side * (width / 2 - 0.15),
        1.25,
        3.3,
        0.45,
        "window",
        name,
      );
      add(
        "block",
        cx + side * (width / 2 - 0.15),
        floor + y,
        cz,
        0.45,
        3.3,
        1.25,
        "window",
        name,
      );
    }
  }
  let owner;
  for (let i = -1; i <= 1; i++)
    for (const side of [-1, 1]) {
      owner = add(
        "block",
        cx + i * cell,
        floor + Math.ceil(height / 5) * 5 + 1.5,
        cz + side * width * 0.43,
        cell * 0.32,
        1.5,
        2,
        "sandstone",
        name,
      );
      add(
        "block",
        cx + side * width * 0.43,
        floor + Math.ceil(height / 5) * 5 + 1.5,
        cz + i * cell,
        2,
        1.5,
        cell * 0.32,
        "sandstone",
        name,
      );
    }
  if (roof)
    add(
      "block",
      cx,
      floor + Math.ceil(height / 5) * 5 + 17,
      cz,
      width * 0.62,
      17,
      width * 0.62,
      "slate",
      name,
    );
  banners.push({
    owner: owner.id,
    p: [cx, floor + height - 8, cz - width / 2 - 0.25],
    s: [4, 10, 1],
  });
  return owner.id;
}
wall("front", fx, fz - HALF_Z, 240, 0, 24, true);
wall("rear", fx, fz + HALF_Z, 240, 0);
wall("west", fx - HALF_X, fz, 270, 1);
wall("east", fx + HALF_X, fz, 270, 1);
for (const a of [-1, 1])
  for (const b of [-1, 1])
    tower(
      `tower-${a}-${b}`,
      fx + a * HALF_X,
      fz + b * HALF_Z,
      b === 1 ? 65 : 60,
      20,
      b === 1,
    );
for (const a of [-1, 1])
  tower(`gate-${a}`, fx + a * 20, fz - HALF_Z - 3, 65, 24, true);
// Four flank towers and two rear towers complete the twelve-tower perimeter.
for (const side of [-1, 1]) {
  for (const along of [-1, 1])
    tower(
      `flank-${side}-${along}`,
      fx + side * HALF_X,
      fz + along * 45,
      58,
      18,
      true,
    );
  tower(`rear-${side}`, fx + side * 40, fz + HALF_Z, 70, 22, true);
}
wall("middle-front", fx, fz - 78, 224, 0, 20, true);
wall("inner-west", fx - 46, fz + 13, 104, 1, 18);
wall("inner-east", fx + 46, fz + 13, 104, 1, 18);
wall("inner-front", fx, fz - 39, 92, 0, 18, true);
// Broad keep foundation and terrace; all levels connect to grounded supports.
const keepZ = fz + 25;
for (let x = -2; x <= 2; x++)
  for (let z = -2; z <= 2; z++)
    add(
      "block",
      fx + x * 10,
      floor + 3,
      keepZ + z * 10,
      5,
      3,
      5,
      "sandstone",
      "keep",
      true,
    );
for (let l = 0; l < 18; l++)
  for (let x = 0; x < 7; x++)
    for (let z = 0; z < 6; z++) {
      if (x !== 0 && x !== 6 && z !== 0 && z !== 5) continue;
      if (l > 2 && l % 4 === 2 && (x === 2 || x === 4) && (z === 0 || z === 5))
        continue;
      add(
        "block",
        fx + (x - 3) * 6,
        floor + 8 + l * 4,
        keepZ + (z - 2.5) * 6,
        3,
        2,
        3,
        "sandstone",
        "keep",
      );
    }
for (let y = 20; y < 77; y += 13)
  for (const x of [-13, 0, 13])
    add("block", fx + x, floor + y, keepZ - 17.8, 2, 4, 0.55, "window", "keep");
for (let i = -3; i <= 3; i++)
  for (const side of [-1, 1])
    add(
      "block",
      fx + i * 6,
      floor + 79,
      keepZ + side * 17,
      1.8,
      1.5,
      2.4,
      "sandstone",
      "keep",
    );
add("block", fx, floor + 96, keepZ, 22, 17, 19, "slate", "keep");
// Uneven palace towers and long slate silhouettes echo the reference castle.
tower("great-spire", fx - 34, keepZ + 36, 126, 20, true, false);
tower("chapel-spire", fx + 70, fz + 77, 101, 17, true, false);
tower("west-spire", fx - 83, fz + 70, 91, 16, true, false);
tower("east-spire", fx + 88, fz - 9, 82, 15, true, false);
for (let i = 0; i < 6; i++)
  add(
    "block",
    fx,
    floor + 0.5 + i * 0.5,
    fz - 9 + i * 2,
    10,
    0.5 + i * 0.5,
    1,
    "sandstone",
    "keep",
    true,
  );
for (const x of [-1, 1])
  for (const z of [-1, 1]) {
    const cx = fx + x * 60,
      cz = fz + z * 37,
      name = `hall-${x}-${z}`;
    wall(name, cx, cz - 12, 20, 0, 12);
    wall(name, cx, cz + 12, 20, 0, 12);
    wall(name, cx - 10, cz, 24, 1, 12);
    wall(name, cx + 10, cz, 24, 1, 12);
    add("block", cx, floor + 21, cz, 12, 10, 15, "slate", name);
  }
// A broad rear palace closes the upper court; roofs are independently breakable.
for (const side of [-1, 1]) {
  const name = `palace-${side}`,
    cx = fx + side * 48,
    cz = fz + 102;
  wall(name, cx, cz - 15, 62, 0, 26);
  wall(name, cx, cz + 15, 62, 0, 26);
  wall(name, cx - 31, cz, 30, 1, 26);
  wall(name, cx + 31, cz, 30, 1, 26);
  for (let part = -1; part <= 1; part++)
    add("block", cx + part * 21, floor + 37, cz, 11, 11, 18, "slate", name);
}
for (const p of [
  [fx - 10, 14, fz - HALF_Z - 4],
  [fx + 10, 14, fz - HALF_Z - 4],
  [fx - 25, 16, fz + 5],
  [fx + 25, 16, fz + 5],
]) {
  const owner = entities
    .filter((e) => e.material === "sandstone")
    .reduce((a, b) =>
      Math.hypot(...a.p.map((v, k) => v - p[k])) <
      Math.hypot(...b.p.map((v, k) => v - p[k]))
        ? a
        : b,
    );
  lights.push({ owner: owner.id, p });
}
// Scale the authored castle modules before adjacency generation. More grandeur
// comes from broader modules and added architecture, rather than tiny brick bodies.
const transformCastle = (p) => [
  fx + (p[0] - fx) * SCALE_X,
  floor + (p[1] - floor) * SCALE_Y,
  fz + (p[2] - fz) * SCALE_Z,
];
for (const e of entities) {
  e.p = transformCastle(e.p);
  e.s = [e.s[0] * SCALE_X, e.s[1] * SCALE_Y, e.s[2] * SCALE_Z];
}
for (const b of banners) {
  b.p = transformCastle(b.p);
  b.s = [b.s[0] * SCALE_X, b.s[1] * SCALE_Y, b.s[2]];
}
for (const l of lights) l.p = transformCastle(l.p);
for (let i = 0; i < towers.length; i++) towers[i] = transformCastle(towers[i]);
// Real bridge parts: individual deck sections, posts and rails.
const bridge = [OFFSET + BX, 220 + OFFSET];
for (let i = 0; i < 16; i++) {
  let x = bridge[0] - 30 + i * 4,
    name = "bridge";
  add(
    "block",
    x,
    1.95,
    bridge[1],
    2,
    0.25,
    3.25,
    "wood",
    name,
    i === 0 || i === 15,
  );
  for (let side of [-1, 1]) {
    add("block", x, 3.3, bridge[1] + side * 3.1, 2, 0.14, 0.14, "wood", name);
    add(
      "block",
      x,
      2.7,
      bridge[1] + side * 3.1,
      0.16,
      0.85,
      0.16,
      "wood",
      name,
    );
  }
}
const castleCount = entities.filter((e) => e.assembly !== "bridge").length;
function building(name, x, z, w = 14, d = 18, h = 13, material = "plaster") {
  const y = sample(x, z);
  // Interlocking wall courses with a clear doorway; independently breakable roof sections.
  for (let level = 0; level < 3; level++) {
    const sy = h / 6,
      cy = y + ((level + 0.5) * h) / 3;
    for (const side of [-1, 1]) {
      add(
        "block",
        x + (side * w) / 2,
        cy,
        z,
        1,
        sy,
        d / 2,
        "wood",
        name,
        level === 0,
      );
      for (const sign of [-1, 1])
        add(
          "block",
          x + sign * w * 0.31,
          cy,
          z + (side * d) / 2,
          w * 0.19,
          sy,
          1,
          material,
          name,
          level === 0,
        );
      if (level > 0 || side === 1)
        add(
          "block",
          x,
          cy,
          z + (side * d) / 2,
          w * 0.12,
          sy,
          1,
          material,
          name,
          level === 0,
        );
    }
  }
  for (const side of [-1, 1])
    add(
      "block",
      x,
      y + h + 3,
      z + side * d * 0.25,
      w * 0.65,
      4,
      d * 0.25 + 1,
      "roof",
      name,
    );
  for (const side of [-1, 1])
    add(
      "block",
      x + side * w * 0.4,
      y + h * 0.5,
      z,
      w * 0.025,
      h * 0.5,
      d * 0.52,
      "wood",
      name,
      true,
    );
}
function post(name, x, z, h = 25, w = 8) {
  const y = sample(x, z);
  for (let l = 0; l < 5; l++)
    add(
      "block",
      x,
      y + ((l + 0.5) * h) / 5,
      z,
      w / 2,
      h / 10,
      w / 2,
      "stone",
      name,
      l === 0,
    );
  add("block", x, y + h + 3, z, w * 0.8, 4, w * 0.8, "roof", name);
  return y;
}
for (const s of sites) {
  const [x, y, z] = s.p,
    begin = entities.length;
  if (s.kind === "hamlet")
    for (let i = 0; i < 5; i++)
      building(
        `${s.id}-house-${i}`,
        x + ((i % 3) - 1) * 33,
        z + (Math.floor(i / 3) - 0.5) * 40,
        14 + (i % 2) * 4,
        20,
        12 + (i % 3) * 3,
      );
  if (s.kind === "farm") {
    building(`${s.id}-barn`, x - 18, z, 23, 32, 16, "wood");
    building(`${s.id}-house`, x + 24, z + 12, 13, 17, 11);
    for (let i = -3; i <= 3; i++)
      for (const side of [-1, 1]) {
        const px = x + i * 12,
          pz = z + side * 40,
          py = sample(px, pz);
        add(
          "block",
          px,
          py + 1.4,
          pz,
          0.3,
          1.4,
          0.3,
          "wood",
          `${s.id}-fence-${side}`,
          true,
        );
        if (i < 3)
          add(
            "block",
            px + 6,
            py + 1.8,
            pz,
            6,
            0.2,
            0.25,
            "wood",
            `${s.id}-fence-${side}`,
          );
      }
    for (let i = 0; i < 3; i++) {
      const px = x + i * 7 - 8,
        pz = z - 27,
        py = sample(px, pz),
        name = `${s.id}-cart-${i}`;
      add("block", px, py + 1, pz, 2.4, 1, 1.6, "wood", name, true);
      add("block", px, py + 3, pz, 2.7, 1.1, 1.8, "earth", name);
    }
  }
  if (s.kind === "windmill") {
    const py = post(s.id, x, z, 30, 10);
    add("block", x, py + 23, z - 6, 1.8, 2, 2, "wood", s.id);
    for (const a of [-1, 1]) {
      add("block", x + a * 9, py + 23, z - 7, 8, 1.6, 0.5, "wood", s.id);
      add("block", x, py + 23 + a * 9, z - 7, 1.6, 8, 0.5, "wood", s.id);
    }
  }
  if (s.kind === "watchtower") {
    post(s.id, x, z, 42, 12);
    for (const a of [-1, 1])
      add("block", x + a * 7, y + 36, z, 1, 4, 7, "wood", s.id);
  }
  if (s.kind === "watermill") {
    building(`${s.id}-mill`, x, z, 18, 22, 20, "stone");
    building(`${s.id}-warehouse`, x + 27, z + 8, 17, 26, 13, "wood");
    const wheel = `${s.id}-mill`;
    // Segmented wheel joined to the wall by its axle; every paddle is destructible.
    add("block", x - 12, y + 8, z, 4, 1, 1, "wood", wheel);
    add("block", x - 15, y + 8, z, 1, 7, 0.6, "wood", wheel);
    add("block", x - 15, y + 8, z, 1, 0.6, 7, "wood", wheel);
    for (let i = 0; i < 16; i++) {
      const a = (i * Math.PI) / 8;
      add(
        "block",
        x - 15,
        y + 8 + Math.sin(a) * 7,
        z + Math.cos(a) * 7,
        1.6,
        1.6,
        1.6,
        "wood",
        wheel,
      );
    }
    for (let i = 0; i < 7; i++) {
      const px = x - 17 - i * 3;
      add(
        "block",
        px,
        y + 1,
        z + 18,
        1.6,
        0.6,
        4,
        "wood",
        `${s.id}-dock`,
        i === 0,
      );
      add("block", px, y + 3, z + 21, 0.2, 2, 0.2, "wood", `${s.id}-dock`);
    }
  }
  if (s.kind === "crossing") {
    const w = riverW(z - OFFSET) + 32;
    let deck = 5;
    for (let px = x - w; px <= x + w + 6; px += 2)
      for (const dz of [-5, 0, 5])
        deck = Math.max(deck, sample(px, z + dz) + 3);
    for (let i = 0; i <= Math.ceil((w * 2) / 6); i++) {
      const px = x - w + i * 6,
        py = sample(px, z);
      add("block", px, deck, z, 3.1, 1.2, 5, "wood", s.id);
      if (i % 3 === 0 || i === Math.ceil((w * 2) / 6))
        for (const a of [-1, 1]) {
          const foot = sample(px, z + a * 4);
          add(
            "block",
            px,
            (deck + foot) / 2,
            z + a * 4,
            1,
            (deck - foot) / 2,
            1,
            "stone",
            s.id,
            true,
          );
        }
      for (const a of [-1, 1])
        add("block", px, deck + 2, z + a * 4.8, 3.1, 1, 0.4, "wood", s.id);
    }
    paths.push([
      [x - w - 25 - OFFSET, z - OFFSET],
      [x + w + 25 - OFFSET, z - OFFSET],
    ]);
  }
  if (s.kind === "logging") {
    building(`${s.id}-shed`, x + 15, z, 15, 18, 10, "wood");
    for (let row = 0; row < 3; row++)
      for (let l = 0; l < 3; l++)
        add(
          "block",
          x - 15,
          y + 1 + l * 2,
          z - 15 + row * 7,
          12,
          1,
          1,
          "wood",
          `${s.id}-stack-${row}`,
          l === 0,
        );
  }
  if (s.kind === "quarry") {
    for (let i = 0; i < 24; i++) {
      const px = x - 32 + (i % 6) * 12,
        pz = z - 25 + Math.floor(i / 6) * 14,
        py = sample(px, pz);
      add(
        "rock",
        px,
        py + 4 + (i % 3) * 2,
        pz,
        5,
        4 + (i % 3) * 2,
        5,
        "rock",
        `${s.id}-rock-${i}`,
        true,
      );
    }
    building(`${s.id}-shed`, x + 28, z + 30, 15, 12, 10, "wood");
    for (let i = 0; i < 5; i++) {
      add(
        "block",
        x - 28 + i * 12,
        y + 10,
        z + 40,
        0.6,
        10,
        0.6,
        "wood",
        `${s.id}-scaffold`,
        true,
      );
      add(
        "block",
        x - 22 + i * 12,
        y + 19,
        z + 40,
        6.5,
        1,
        3,
        "wood",
        `${s.id}-scaffold`,
      );
    }
  }
  s.assemblies = [...new Set(entities.slice(begin).map((e) => e.assembly))];
}
if (castleCount > 5000 || entities.length > 8000)
  throw Error(`Structure budget exceeded: ${castleCount}/${entities.length}`);
// Build adjacency only within each assembly, avoiding a world-wide quadratic scan.
const groups = new Map();
for (const e of entities) {
  let g = groups.get(e.assembly);
  if (!g) groups.set(e.assembly, (g = []));
  g.push(e);
}
for (const group of groups.values())
  for (let i = 0; i < group.length; i++) {
    const a = group[i];
    for (let j = i + 1; j < group.length; j++) {
      const b = group[j],
        gap = a.p.map((v, k) => Math.abs(v - b.p[k]) - a.s[k] - b.s[k]);
      if (gap.every((v) => v < 0.16)) {
        a.supports.push(b.id);
        b.supports.push(a.id);
      }
    }
  }
const structureCount = entities.length;
// Preserve the central forest and use larger spacing in the surrounding flight region.
for (let z = 24; z < 2024; z += 14)
  for (let x = 24; x < 2024; x += 14) {
    let px = x + (hash(x, z) - 0.5) * 9,
      pz = z + (hash(x + 6, z + 9) - 0.5) * 9,
      lx = px - OFFSET,
      lz = pz - OFFSET,
      h = sample(px, pz),
      cluster = fbm(px * 0.011 + 33, pz * 0.011 + 71);
    if (
      sites.some(
        (s) =>
          Math.abs(px - s.p[0]) < s.radius + 10 &&
          Math.abs(pz - s.p[2]) < s.radius + 10,
      ) ||
      cluster < 0.43 ||
      hash(x + 3, z) > 0.64 ||
      h < 2 ||
      h > 138 ||
      pathDistance(lx, lz) < 6 ||
      (Math.abs(px - fx) < CASTLE_X + 32 &&
        Math.abs(pz - fz) < CASTLE_Z + 32) ||
      (Math.abs(pz - bridge[1]) < 9 && Math.abs(px - bridge[0]) < 40)
    )
      continue;
    if (Math.hypot(px - 1133, pz - 1193) < 35) continue;
    let tall = 13 + hash(x + 8, z + 7) * 14;
    add(
      "tree",
      px,
      h + tall * 0.5,
      pz,
      2.8 + hash(x, z + 2) * 1.5,
      tall * 0.5,
      3,
      "foliage",
      "",
      true,
    );
  }
for (let z = 790; z < 1258; z += 8)
  for (let x = 790; x < 1258; x += 8) {
    let lx = x - OFFSET,
      lz = z - OFFSET,
      h = sample(x, z);
    if (
      sites.some(
        (s) =>
          Math.abs(x - s.p[0]) < s.radius + 10 &&
          Math.abs(z - s.p[2]) < s.radius + 10,
      ) ||
      fbm(lx * 0.024 + 33, lz * 0.023 + 71) < 0.55 ||
      hash(x, z) > 0.5 ||
      h < 2 ||
      h > 35 ||
      pathDistance(lx, lz) < 6 ||
      (Math.abs(x - fx) < CASTLE_X + 32 && Math.abs(z - fz) < CASTLE_Z + 32) ||
      (lx > 190 && lx < 318 && lz > 140 && lz < 247) ||
      Math.hypot(x - 1133, z - 1193) < 40
    )
      continue;
    let tall = 15 + hash(x + 3, z + 3) * 11;
    add("tree", x, h + tall / 2, z, 3, tall / 2, 3, "foliage", "", true);
  }
for (let i = 0; i < 170; i++) {
  let x = 40 + hash(i, 77) * 1968,
    z = 40 + hash(i, 78) * 1968,
    h = sample(x, z);
  if (
    h < 2 ||
    (Math.abs(x - fx) < CASTLE_X + 32 && Math.abs(z - fz) < CASTLE_Z + 32)
  )
    continue;
  let s = 1.5 + hash(i, 79) * 3;
  add("rock", x, h + s * 0.4, z, s, s * 0.6, s * 0.85, "rock", "", true);
}
const world = {
  version: 6,
  seed: SEED,
  size: SIZE,
  step: STEP,
  grid: GRID,
  chunkSize: 64,
  castle: [fx, floor, fz],
  castleBounds: {
    min: [fx - CASTLE_X, fz - CASTLE_Z],
    max: [fx + CASTLE_X, fz + CASTLE_Z],
  },
  landmarks: {
    gate: [fx, floor, fz - CASTLE_Z],
    keep: transformCastle([fx, floor, keepZ]),
    towers,
  },
  banners,
  bridge,
  spawn: [1030, 310, 700],
  paths: paths.map((p) => p.map(([x, z]) => [x + OFFSET, z + OFFSET])),
  lights,
  structureCount,
  castleCount,
  sites,
  entities,
};
mkdirSync("public", { recursive: true });
writeFileSync("public/world.bin", new Uint8Array(heights.buffer));
writeFileSync("public/world.json", JSON.stringify(world));
console.log(
  `World: ${GRID}² samples, ${structureCount} structure parts, ${entities.length} entities`,
);
