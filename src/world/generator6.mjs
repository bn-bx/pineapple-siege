import {
  auditGeography,
  validatePlayableGeography,
} from "./generation-validation.mjs";
import {
  PRESETS,
  addIslets,
  shapeRadius,
  erodeTerrain,
  buildRegions,
  regionAt,
  mainlandMask,
  onMainland,
  flightDistance,
  makeLakes,
  makeWaterfalls,
  validatePlan,
  fieldSample,
} from "./landscape.mjs";
import {
  carveWater,
  gradeSites,
  gradeRoads,
  flattenSites,
  waterHeight,
} from "./generation-grading.mjs";
import { createMountainLayout, mountainRelief } from "./mountains6.mjs";
import { createArchitecture } from "./architecture.mjs";
import { VERTICAL_LIMITS } from "./vertical-limits.mjs";
import { buildPineappleGod } from "./pineapple-god.mjs";
import { applyApprovedGod } from "./approved-god.mjs";
export const GENERATOR_VERSION = 6;
export const WORLD_VERSION = 12;
export const SIZE = 9216;
export const STEP = 2;
export const GRID = SIZE / STEP + 1;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const mix = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, v) => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const quantize = (v) => Math.round(v * 1024) / 1024;
export function hashFor(seed) {
  return (x, z) => {
    let n = Math.imul(x, 374761393) ^ Math.imul(z, 668265263) ^ (seed >>> 0);
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
  };
}
export function sampleHeight(heights, x, z) {
  const gx = clamp(x / STEP, 0, GRID - 1.00001),
    gz = clamp(z / STEP, 0, GRID - 1.00001),
    ix = Math.floor(gx),
    iz = Math.floor(gz),
    u = gx - ix,
    v = gz - iz,
    i = iz * GRID + ix;
  const a = heights[i],
    b = heights[i + 1],
    c = heights[i + GRID],
    d = heights[i + GRID + 1];
  return u + v <= 1
    ? a + (b - a) * u + (c - a) * v
    : d + (c - d) * (1 - u) + (b - d) * (1 - v);
}
class Heap {
  a = [];
  push(id, cost) {
    const a = this.a;
    let i = a.length;
    a.push([id, cost]);
    while (i) {
      const p = (i - 1) >> 1;
      if (a[p][1] <= cost) break;
      a[i] = a[p];
      i = p;
    }
    a[i] = [id, cost];
  }
  pop() {
    const a = this.a,
      top = a[0],
      end = a.pop();
    if (a.length) {
      let i = 0;
      while (i * 2 + 1 < a.length) {
        let c = i * 2 + 1;
        if (c + 1 < a.length && a[c + 1][1] < a[c][1]) c++;
        if (a[c][1] >= end[1]) break;
        a[i] = a[c];
        i = c;
      }
      a[i] = end;
    }
    return top;
  }
  get length() {
    return this.a.length;
  }
}
export function pathIndex(paths, cellSize = 128, padding = 20) {
  const cells = new Map();
  for (const path of paths)
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1],
        b = path[i];
      for (
        let z = Math.floor((Math.min(a[1], b[1]) - padding) / cellSize);
        z <= Math.floor((Math.max(a[1], b[1]) + padding) / cellSize);
        z++
      )
        for (
          let x = Math.floor((Math.min(a[0], b[0]) - padding) / cellSize);
          x <= Math.floor((Math.max(a[0], b[0]) + padding) / cellSize);
          x++
        ) {
          const k = z * 1000 + x;
          let list = cells.get(k);
          if (!list) cells.set(k, (list = []));
          list.push([a, b]);
        }
    }
  return (x, z) => {
    let d = Infinity;
    for (const [a, b] of cells.get(
      Math.floor(z / cellSize) * 1000 + Math.floor(x / cellSize),
    ) ?? []) {
      const dx = b[0] - a[0],
        dz = b[1] - a[1],
        l = dx * dx + dz * dz,
        t = l ? clamp(((x - a[0]) * dx + (z - a[1]) * dz) / l, 0, 1) : 0;
      d = Math.min(d, Math.hypot(x - a[0] - dx * t, z - a[1] - dz * t));
    }
    return d;
  };
}
export function planIsland6(request, report = () => {}) {
  const { seed } = request;
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff)
    throw Error("Island seed must be an unsigned 32-bit integer.");
  let failure;
  const reasons = [];
  // Retry only compact plans; full-resolution terrain is allocated after acceptance.
  for (let attempt = 0; attempt < 16; attempt++) {
    try {
      return generateCandidate(request, report, attempt);
    } catch (error) {
      failure = error;
      reasons.push(error.message);
      if (attempt < 15)
        report(`Refining island layout (${attempt + 2}/16)`, 0.02);
    }
  }
  failure.attemptReasons = reasons;
  throw failure;
}
function generateCandidate(request, report, attempt) {
  const { seed } = request;
  // Ecology, relief and silhouette vary independently; there are no player-selected styles.
  const identityHash = hashFor(seed ^ 0x6482ea31),
    preset = ["B", "H", "R", "W"][Math.floor(identityHash(7, 21) * 4)],
    settings = PRESETS[preset];
  const STEP = 16,
    GRID = SIZE / STEP + 1;
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff)
    throw Error("Island seed must be an unsigned 32-bit integer.");
  const hash = hashFor((seed ^ Math.imul(attempt, 0x9e3779b9)) >>> 0),
    noise = (x, z) => {
      const ix = Math.floor(x),
        iz = Math.floor(z),
        fx = smooth(0, 1, x - ix),
        fz = smooth(0, 1, z - iz);
      return mix(
        mix(hash(ix, iz), hash(ix + 1, iz), fx),
        mix(hash(ix, iz + 1), hash(ix + 1, iz + 1), fx),
        fz,
      );
    };
  const fbm = (x, z) =>
    noise(x, z) * 0.58 +
    noise(x * 2.03 + 19, z * 2.03 + 9) * 0.28 +
    noise(x * 4.07, z * 4.07) * 0.14;
  report("Shaping coastline and mountain ridges", 0.02);
  const cx = SIZE / 2 + (hash(1, 1) - 0.5) * 100,
    cz = SIZE / 2 + (hash(1, 2) - 0.5) * 100,
    rotation = hash(2, 2) * Math.PI * 2,
    cos = Math.cos(rotation),
    sin = Math.sin(rotation);
  // Leave a wider ocean margin while scaling mountains and saddles with the coast.
  const islandScale = 1.41;
  const landscapeProfile = ["mountainous", "rolling woodland", "broad lowland"][
    Math.floor(identityHash(9, 411) * 3)
  ];
  const shapeFamily = [
    "elongated",
    "peninsulas",
    "horseshoe",
    "irregular",
    "crescent",
    "hammerhead",
  ][Math.floor(identityHash(19, 412) * 6)];
  const shapeVariation = {
    phase: identityHash(21, 412) * Math.PI * 2,
    breadth: identityHash(22, 412),
    bend: identityHash(23, 412),
  };
  const local = (x, z) => [
    ((x - cx) * cos + (z - cz) * sin) / islandScale,
    (-(x - cx) * sin + (z - cz) * cos) / islandScale,
  ];
  const bays = Array.from(
    { length: 3 + Math.floor(hash(8, 402) * 3) },
    (_, i) => ({
      angle: hash(i, 402) * Math.PI * 2,
      depth: 240 + hash(i, 403) * 640,
      width: 0.12 + hash(i, 404) * 0.23,
    }),
  );
  const mountainLayout = createMountainLayout(hash);
  const passes = mountainLayout.passes.map((pass) => ({
    p: [
      quantize(cx + (pass.x * cos - pass.z * sin) * islandScale),
      0,
      quantize(cz + (pass.x * sin + pass.z * cos) * islandScale),
    ],
    radius: 180 * islandScale,
  }));
  const coarseGrid = SIZE / 16 + 1,
    coarse = new Float32Array(coarseGrid ** 2),
    mountain = new Float32Array(coarse.length);
  let highestMountain = 0;
  for (let z = 0; z < coarseGrid; z++)
    for (let x = 0; x < coarseGrid; x++) {
      const wx = x * 16,
        wz = z * 16,
        [lx, lz] = local(wx, wz);
      const warpedX = lx + (noise(wx / 700 + 11, wz / 700 + 27) - 0.5) * 230,
        warpedZ = lz + (noise(wx / 700 + 39, wz / 700 + 7) - 0.5) * 230;
      let r = shapeRadius(shapeFamily, warpedX, warpedZ, shapeVariation);
      const angle = Math.atan2(lz, lx);
      for (const bay of bays) {
        const d = Math.atan2(
          Math.sin(angle - bay.angle),
          Math.cos(angle - bay.angle),
        );
        r += (bay.depth / 2600) * Math.exp(-((d / bay.width) ** 2));
      }
      r += (noise(wx / 180 + 71, wz / 180 + 53) - 0.5) * 0.018;
      const inland =
        smooth(1.035, 0.955, r) *
        smooth(70, 220, Math.min(wx, wz, SIZE - wx, SIZE - wz));
      const relief =
        mountainRelief(mountainLayout, lx, lz) **
          (landscapeProfile === "mountainous"
            ? 0.72
            : landscapeProfile === "broad lowland"
              ? 1.7
              : 1.1) *
        (0.66 +
          0.22 * (1 - Math.abs(2 * noise(wx / 150 + 31, wz / 150 + 37) - 1)) +
          0.12 * (1 - Math.abs(2 * noise(wx / 70 + 63, wz / 70 + 17) - 1)));
      const hills =
        12 +
        fbm(wx / 560, wz / 560) * 38 +
        fbm(wx / 230 + 35, wz / 230 + 27) * 15;
      const id = z * coarseGrid + x;
      const coastExposure = hash(Math.floor((angle + Math.PI) * 4), 933);
      const shoreHills =
        hills + (coastExposure > 0.7 ? 55 : 0) * smooth(0.75, 1, r);
      const shelf = -26 + 18 * Math.exp(-Math.max(0, r - 1) * 30);
      coarse[id] = mix(shelf, shoreHills, inland);
      mountain[id] = relief * inland;
      highestMountain = Math.max(highestMountain, mountain[id]);
    }
  const targetPeak = 760 + hash(5, 411) * 200;
  // Normalize relief alone, leaving fertile lowlands at their original scale.
  let peak = 0;
  for (let i = 0; i < coarse.length; i++)
    peak = Math.max(
      peak,
      coarse[i] + (mountain[i] / highestMountain) * targetPeak,
    );
  const reliefScale = (targetPeak - 50) / (peak - 50);
  for (let i = 0; i < coarse.length; i++)
    coarse[i] = quantize(
      coarse[i] + (mountain[i] / highestMountain) * targetPeak * reliefScale,
    );
  erodeTerrain(coarse, coarseGrid, 16);
  // Mountains retain their natural relief; only actual castle entrances reserve approaches.
  const flightCorridors = [];
  addIslets(coarse, coarseGrid, SIZE, hash);
  const raw = (x, z) => fieldSample(coarse, coarseGrid, 16, x, z);
  const heights = new Float32Array(GRID ** 2);
  for (let z = 0; z < GRID; z++) {
    for (let x = 0; x < GRID; x++)
      heights[z * GRID + x] = raw(x * STEP, z * STEP);
    if (z % 768 === 0)
      report("Sampling island terrain", 0.04 + (0.14 * z) / GRID);
  }
  const sample = (x, z) => fieldSample(heights, GRID, STEP, x, z);
  const baseHeights = heights.slice();
  const mainland = mainlandMask(heights, GRID, STEP);
  // Priority-flood drainage supplies a deterministic route from every ridge to sea.
  const R = SIZE / 64 + 1,
    N = R * R,
    level = new Float64Array(N).fill(Infinity),
    parent = new Int32Array(N).fill(-1),
    heap = new Heap();
  const roadNeighbors = (id) => {
    const x = id % R,
      z = Math.floor(id / R),
      out = [];
    if (x) out.push(id - 1);
    if (x < R - 1) out.push(id + 1);
    if (z) out.push(id - R);
    if (z < R - 1) out.push(id + R);
    return out;
  };
  const neighbors = (id) => {
    const out = roadNeighbors(id),
      x = id % R,
      z = Math.floor(id / R);
    for (const [dx, dz] of [
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ])
      if (x + dx >= 0 && x + dx < R && z + dz >= 0 && z + dz < R)
        out.push(id + dx + dz * R);
    return out;
  };
  const drainageOrder = [];
  for (let id = 0; id < N; id++) {
    const h = raw((id % R) * 64, Math.floor(id / R) * 64);
    if (h < 0) {
      level[id] = 0;
      heap.push(id, 0);
    }
  }
  while (heap.length) {
    const [id, cost] = heap.pop();
    if (cost !== level[id]) continue;
    drainageOrder.push(id);
    for (const j of neighbors(id)) {
      const h = raw((j % R) * 64, Math.floor(j / R) * 64),
        v = Math.max(cost + 0.005, h);
      if (v < level[j]) {
        level[j] = v;
        parent[j] = id;
        heap.push(j, v);
      }
    }
  }
  const catchment = new Uint32Array(N).fill(1);
  for (let i = drainageOrder.length - 1; i >= 0; i--) {
    const id = drainageOrder[i];
    if (parent[id] >= 0) catchment[parent[id]] += catchment[id];
  }
  function roundRiver(points) {
    const out = [points[0]];
    for (let i = 1; i < points.length - 1; i++) {
      const a = points[i - 1],
        b = points[i],
        c = points[i + 1];
      if ((b[0] - a[0]) * (c[2] - b[2]) === (b[2] - a[2]) * (c[0] - b[0])) {
        out.push(b);
        continue;
      }
      const q = b.map((v, k) => mix(v, a[k], 0.4)),
        r = b.map((v, k) => mix(v, c[k], 0.4));
      for (let j = 0; j <= 6; j++) {
        const t = j / 6;
        out.push(
          q.map((v, k) =>
            quantize((1 - t) ** 2 * v + 2 * (1 - t) * t * b[k] + t * t * r[k]),
          ),
        );
      }
    }
    out.push(points.at(-1));
    return out;
  }
  const drainageHash = hashFor(
    (seed ^ Math.imul(attempt, 0x9e3779b9) ^ 0x6d2b79f5) >>> 0,
  );
  const rivers = [],
    used = new Set(),
    riverCount = settings.rivers + Math.floor(drainageHash(3, 3) * 2);
  for (let r = 0; r < riverCount; r++) {
    let source = -1,
      best = -Infinity;
    for (let a = 0; a < 1200; a++) {
      const sourceRange = R - 10,
        x = 5 + Math.floor(drainageHash(r * 1900 + a, 81) * sourceRange),
        z = 5 + Math.floor(drainageHash(r * 1900 + a, 82) * sourceRange),
        h = raw(x * 64, z * 64);
      if (
        !onMainland(mainland, x * 64, z * 64) ||
        h < (r < 3 ? 250 : 140) ||
        rivers.some(
          (v) =>
            Math.hypot(x * 64 - v.points[0][0], z * 64 - v.points[0][2]) <
            (r < 3 ? 650 : 350),
        )
      )
        continue;
      const score =
        h * 0.35 +
        Math.min(90, catchment[z * R + x]) * 5 +
        drainageHash(a, r + 91) * 40;
      if (score > best) {
        best = score;
        source = z * R + x;
      }
    }
    if (source < 0)
      throw Error("Could not find separated river sources. Try another seed.");
    const points = [];
    let id = source,
      last = Infinity;
    for (let a = 0; a < N && id >= 0; a++) {
      const x = (id % R) * 64,
        z = Math.floor(id / R) * 64,
        h = raw(x, z);
      const water = quantize(Math.max(0, Math.min(last, level[id] - 1.5)));
      if (used.has(id)) {
        // Join an existing rendered reach rather than carving it a second time.
        let join,
          distance = Infinity;
        for (const river of rivers)
          for (const p of river.points) {
            const d = Math.hypot(p[0] - x, p[2] - z);
            if (d < distance && p[1] <= last) {
              join = p;
              distance = d;
            }
          }
        if (join) {
          points.push([...join]);
          break;
        }
      }
      points.push([x, water, z]);
      used.add(id);
      last = water;
      if (h < 0) break;
      id = parent[id];
    }
    rivers.push({
      id: `river-${r + 1}`,
      width: 12 + drainageHash(r, 99) * 6,
      points: roundRiver(points),
    });
  }
  for (const river of rivers) {
    let lastWidth = 7;
    river.widths = river.points.map(([x, , z]) => {
      const id =
        clamp(Math.round(z / 64), 0, R - 1) * R +
        clamp(Math.round(x / 64), 0, R - 1);
      return (lastWidth = quantize(
        Math.max(lastWidth, Math.min(23, 6 + Math.sqrt(catchment[id]) * 0.65)),
      ));
    });
    river.width = Math.max(...river.widths);
  }
  const lakes = makeLakes(rivers, sample, drainageHash, settings.lakes);
  const waterfalls = makeWaterfalls(rivers);
  report("Carving rivers, lakes and cascades", 0.2);
  carveWater(heights, GRID, STEP, rivers, lakes);
  const regions = buildRegions(
    heights,
    GRID,
    STEP,
    rivers,
    lakes,
    preset,
    hashFor((seed ^ 0x8d42ec91) >>> 0),
    mainland,
  );
  const riverDistance = pathIndex(
    rivers.map((r) => r.points.map((p) => [p[0], p[2]])),
    128,
    400,
  );
  const waterAt = (x, z) =>
    waterHeight(rivers, lakes, Math.round(x / 2) * 2, Math.round(z / 2) * 2);
  const siteHash = hashFor(
    (seed ^ Math.imul(attempt, 0x9e3779b9) ^ 0x1b873593) >>> 0,
  );
  const sites = [],
    castles = [];
  const site = (kind, x, z, radius, extra = {}) => {
    const id =
      kind === "castle" && !sites.some((s) => s.id === "castle")
        ? "castle"
        : `${kind}-${sites.filter((s) => s.kind === kind).length + 1}`;
    const s = {
      id,
      layout: ["street", "crescent", "clustered"][
        Math.floor(siteHash(Math.round(x), Math.round(z)) * 3)
      ],
      turn: Math.floor(siteHash(Math.round(x) + 7, Math.round(z) + 11) * 4),
      kind,
      p: [quantize(x), quantize(sample(x, z)), quantize(z)],
      radius,
      bounds: { min: [x - radius, z - radius], max: [x + radius, z + radius] },
      assemblies: [],
      ...extra,
    };
    sites.push(s);
    return s;
  };
  const reserved = [];
  const occupied = (x, z, radius) =>
    reserved.some((p) => Math.hypot(x - p[0], z - p[2]) < radius + 120) ||
    sites.some(
      (s) => Math.hypot(x - s.p[0], z - s.p[2]) < radius + s.radius + 100,
    );
  // Reserve the god's terrace before any settlement or forest can occupy it.
  let godCandidate,
    godScore = -Infinity;
  for (let a = 0; a < 10000; a++) {
    const x = 1200 + siteHash(a, 881) * (SIZE - 2400),
      z = 1200 + siteHash(a, 882) * (SIZE - 2400),
      h = sample(x, z);
    if (
      !onMainland(mainland, x, z) ||
      flightDistance(flightCorridors, x, z) < 850
    )
      continue;
    if (h < 100 || h > 330) continue;
    const corners = [-760, 0, 760].flatMap((dx) =>
      [-760, 0, 760].map((dz) => sample(x + dx, z + dz)),
    );
    if (Math.min(...corners) < 12 || Math.max(...corners) > 650) continue;
    const rd = riverDistance(x, z);
    if (rd < 160) continue;
    const score = Math.min(rd, 1100) * 2 + h + Math.max(...corners) * 0.3;
    if (score > godScore) {
      godScore = score;
      godCandidate = { x, z, h };
    }
  }
  if (!godCandidate)
    throw Error(
      "Could not reserve the pineapple god's mountain terrace. Try another seed.",
    );
  const god = site("pineapple-god", godCandidate.x, godCandidate.z, 760);
  let portalAnchor;
  for (let i = 0; i < 8000; i++) {
    const x = 800 + siteHash(i, 912) * (SIZE - 1600),
      z = 800 + siteHash(i, 913) * (SIZE - 1600),
      h = sample(x, z);
    if (
      h < 16 ||
      h > 120 ||
      !onMainland(mainland, x, z) ||
      occupied(x, z, 130) ||
      Number.isFinite(waterAt(x, z))
    )
      continue;
    if (
      lakes.some(
        (l) => Math.hypot(x - l.center[0], z - l.center[1]) < l.radius + 180,
      ) ||
      riverDistance(x, z) < 180
    )
      continue;
    if (
      [
        [-90, 0],
        [90, 0],
        [0, -90],
        [0, 90],
      ].some(([dx, dz]) => Math.abs(sample(x + dx, z + dz) - h) > 12)
    )
      continue;
    portalAnchor = [x, h, z];
    reserved.push(portalAnchor);
    break;
  }
  if (!portalAnchor) throw Error("Could not reserve a safe portal approach");
  function inlandSite(kind, radius, number, castle = false) {
    let best,
      bestScore = -Infinity;
    for (let a = 0; a < 6000; a++) {
      const anchor =
        !castle &&
        a < 800 &&
        castles.length &&
        ["hamlet", "farm"].includes(kind)
          ? castles[number % castles.length]
          : undefined;
      const angle = siteHash(a + number * 9101, 103) * Math.PI * 2;
      const range = 700 + siteHash(a + number * 9101, 104) * 1700;
      const x = anchor
          ? anchor.p[0] + Math.cos(angle) * range
          : 400 + siteHash(a + number * 9101, 101) * (SIZE - 800),
        z = anchor
          ? anchor.p[2] + Math.sin(angle) * range
          : 400 + siteHash(a + number * 9101, 102) * (SIZE - 800),
        h = sample(x, z);
      if (
        x < 400 ||
        z < 400 ||
        x > SIZE - 400 ||
        z > SIZE - 400 ||
        !onMainland(mainland, x, z) ||
        Number.isFinite(waterAt(x, z)) ||
        flightDistance(flightCorridors, x, z) < radius + 100 ||
        h < 14 ||
        h > (castle ? 135 : 150) ||
        occupied(x, z, radius) ||
        riverDistance(x, z) < radius + 55
      )
        continue;
      if (
        [
          [-radius, -radius],
          [radius, -radius],
          [-radius, radius],
          [radius, radius],
        ].some(
          ([dx, dz]) =>
            sample(x + dx, z + dz) < 5 ||
            Math.abs(sample(x + dx, z + dz) - h) > (castle ? 55 : 23),
        )
      )
        continue;
      const region = regionAt(regions, x, z);
      const score = castle
        ? h * 0.6 - Math.abs(h - 85)
        : kind === "farm"
          ? region.moisture * 90 - region.exposure * 50 - h * 0.2
          : kind === "logging"
            ? region.woodland * 100
            : kind === "watchtower"
              ? h + region.exposure * 50
              : kind === "windmill"
                ? region.exposure * 80 + h * 0.4
                : kind === "quarry"
                  ? region.exposure * 70 + h * 0.25
                  : siteHash(a, number + 233) * 20;
      if (score > bestScore) {
        best = { x, z };
        bestScore = score;
      }
      if (a > 250 && best) break;
    }
    if (best) return site(kind, best.x, best.z, radius);
    throw Error(`Could not place ${kind} on safe land. Try another seed.`);
  }
  report("Placing fortresses and settlements", 0.27);
  for (let k = 0; k < 5; k++) {
    const grand = k < 2,
      s = inlandSite(
        grand ? "castle" : "small-castle",
        grand ? 335 : 205,
        100 + k,
        true,
      ),
      turn = Math.floor(siteHash(k, 200) * 4);
    const halfX = 108 + Math.floor(siteHash(k, 201) * 20),
      halfZ = 122 + Math.floor(siteHash(k, 202) * 20),
      scaleX = (grand ? 2 : 1.15) * (0.96 + siteHash(k, 203) * 0.08),
      scaleZ = (grand ? 2 : 1.1) * (0.96 + siteHash(k, 204) * 0.08);
    const sx = turn % 2 ? halfZ * scaleZ : halfX * scaleX,
      sz = turn % 2 ? halfX * scaleX : halfZ * scaleZ;
    s.bounds = {
      min: [s.p[0] - sx - 28, s.p[2] - sz - 28],
      max: [s.p[0] + sx + 28, s.p[2] + sz + 28],
    };
    castles.push({
      id: s.id,
      p: s.p,
      bounds: s.bounds,
      assemblies: [],
      grand,
      turn,
      halfX,
      halfZ,
      scaleX,
      scaleZ,
      scaleY: grand ? 1.55 : 0.78 + siteHash(k, 205) * 0.15,
      layout: ["rectangular", "courtyard", "stepped"][
        Math.floor(siteHash(k, 206) * 3)
      ],
    });
  }
  for (const c of castles) {
    let selected,
      best = Infinity;
    for (let candidate = 0; candidate < 4; candidate++) {
      const direction = [
          [0, -1],
          [1, 0],
          [0, 1],
          [-1, 0],
        ][candidate],
        offset = c.halfZ * c.scaleZ;
      let penalty = 0,
        altitude = c.p[1] + (c.grand ? 320 : 220);
      for (let d = 120; d <= 620; d += 32) {
        const x = c.p[0] + direction[0] * (offset + d),
          z = c.p[2] + direction[1] * (offset + d);
        altitude = Math.max(altitude, sample(x, z) + 130);
        if (Math.hypot(x - god.p[0], z - god.p[2]) < god.radius + 100)
          penalty += 10000;
        for (const other of castles)
          if (
            other !== c &&
            Math.hypot(x - other.p[0], z - other.p[2]) <
              (other.grand ? 380 : 250)
          )
            penalty += 10000;
      }
      const score =
        penalty + altitude + siteHash(candidate, Math.round(c.p[0])) * 12;
      if (score < best) {
        best = score;
        selected = { candidate, direction, offset, altitude };
      }
    }
    if (best >= 10000)
      throw Error("Could not reserve a clear castle flight approach");
    const { candidate, direction, offset, altitude } = selected;
    c.turn = candidate;
    const hx = c.turn % 2 ? c.halfZ * c.scaleZ : c.halfX * c.scaleX,
      hz = c.turn % 2 ? c.halfX * c.scaleX : c.halfZ * c.scaleZ;
    c.bounds = {
      min: [c.p[0] - hx - 28, c.p[2] - hz - 28],
      max: [c.p[0] + hx + 28, c.p[2] + hz + 28],
    };
    sites.find((s) => s.id === c.id).bounds = c.bounds;
    const points = [120, 300, 620].map((d) => [
      c.p[0] + direction[0] * (offset + d),
      altitude,
      c.p[2] + direction[1] * (offset + d),
    ]);
    flightCorridors.push({
      id: `${c.id}-approach`,
      width: 160,
      clearance: 100,
      points,
    });
  }
  // Reserve river crossings before optional towns consume the usable banks.
  for (let k = 0; k < 9; k++)
    riverSite(k === 0 ? "bridge" : "crossing", k, k > 0);
  let usableArea = 0;
  for (let i = 0; i < heights.length; i++)
    if (mainland.cells[i] && heights[i] >= 14 && heights[i] <= 150)
      usableArea += STEP * STEP;
  const populationScale = clamp(usableArea / 20_000_000, 0.6, 1.05);
  let serial = 0;
  god.yaw = Math.atan2(castles[0].p[0] - god.p[0], castles[0].p[2] - god.p[2]);
  for (const [kind, count, radius] of [
    ["hamlet", 24, 65],
    ["farm", 14, 52],
    ["windmill", 8, 24],
    ["watchtower", 8, 20],
    ["logging", 4, 36],
    ["quarry", 2, 52],
  ])
    for (
      let i = 0,
        limit = Math.max(
          1,
          Math.round(
            count *
              (0.72 + siteHash(count, 1043) * 0.22) *
              settings.settlements *
              populationScale,
          ),
        );
      i < limit;
      i++
    ) {
      const town = kind === "hamlet" && i < 6;
      const placed = inlandSite(kind, town ? 145 : radius, serial++);
      placed.town = town;
    }
  function coastalSite(kind, number) {
    let best;
    for (let a = 0; a < 18000; a++) {
      const x = 220 + siteHash(a + number * 19001, 211) * (SIZE - 440),
        z = 220 + siteHash(a + number * 19001, 212) * (SIZE - 440),
        h = sample(x, z),
        radius = kind === "harbor" ? 52 : 24;
      if (
        !onMainland(mainland, x, z) ||
        flightDistance(flightCorridors, x, z) < radius + 100 ||
        h < 3 ||
        h > (kind === "harbor" ? 8 : 65) ||
        occupied(x, z, radius) ||
        riverDistance(x, z) < radius + 70
      )
        continue;
      const coast = regionAt(regions, x, z);
      if (kind === "harbor" && (coast.exposure > 0.45 || coast.coast === 2))
        continue;
      const directions = [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ];
      const d = directions.find(
        ([dx, dz]) =>
          sample(x + dx * 90, z + dz * 90) < -1 &&
          sample(x - dx * 65, z - dz * 65) > 8,
      );
      if (!d) continue;
      if (kind === "harbor" && sample(x + d[0] * 180, z + d[1] * 180) > 0)
        continue;
      const score =
        Math.min(
          sample(x + d[0] * 90 - d[1] * 300, z + d[1] * 90 + d[0] * 300),
          sample(x + d[0] * 90 + d[1] * 300, z + d[1] * 90 - d[0] * 300),
        ) - h;
      if (kind !== "harbor" || score > 3)
        return site(kind, x, z, radius, {
          dockAxis: d[0] ? 0 : 1,
          dockSign: d[0] || d[1],
        });
      if (!best || score > best.score) best = { x, z, radius, d, score };
    }
    if (best)
      return site(kind, best.x, best.z, best.radius, {
        dockAxis: best.d[0] ? 0 : 1,
        dockSign: best.d[0] || best.d[1],
      });
    throw Error(`Could not place ${kind} on the coast. Try another seed.`);
  }
  for (const kind of ["harbor", "lighthouse", "coastal-ruin"])
    for (let k = 0; k < (kind === "coastal-ruin" ? 2 : 3); k++)
      coastalSite(kind, k + serial++);
  // Cardinal structures can cross oblique reaches using measured bank spans.
  function riverSite(kind, index, optional = false) {
    for (let a = 0; a < 4000; a++) {
      const river = rivers[(index + a) % rivers.length],
        n = river.points.length;
      if (n < 8) continue;
      const j = 2 + Math.floor(siteHash(a + index * 117, 220) * (n - 5)),
        p = river.points[j],
        prev = river.points[j - 1],
        axis = Math.abs(p[2] - prev[2]) >= Math.abs(p[0] - prev[0]) ? 0 : 1;
      const x = (p[0] + prev[0]) / 2,
        z = (p[2] + prev[2]) / 2,
        water = (p[1] + prev[1]) / 2;
      if (Math.hypot(p[0] - prev[0], p[2] - prev[2]) < 5) continue;
      if (
        water < 3 ||
        water > (kind === "watermill" ? 220 : 500) ||
        lakes.some(
          (l) => Math.hypot(x - l.center[0], z - l.center[1]) < l.radius + 180,
        )
      )
        continue;
      if (kind === "watermill") {
        const offset = river.width * 1.5 + 22,
          mx = x + (axis === 0 ? offset : 0),
          mz = z + (axis === 1 ? offset : 0);
        if (occupied(mx, mz, 52) || sample(mx, mz) < water + 0.2) continue;
        return site(kind, mx, mz, 52, {
          turn: axis === 1 ? 1 : 0,
          waterLevel: water,
        });
      }
      let bank = river.width + 8;
      for (; bank < 100; bank += 4)
        if (
          [-1, 1].every(
            (sign) =>
              riverDistance(
                x + (axis === 0 ? bank * sign : 0),
                z + (axis === 1 ? bank * sign : 0),
              ) >
              river.width + 8,
          )
        )
          break;
      if (bank >= 100) continue;
      const span = bank * 2 + 32;
      if (
        occupied(x, z, span / 2) ||
        sample(
          x + (axis === 0 ? span / 2 : 0),
          z + (axis === 1 ? span / 2 : 0),
        ) <
          water + 0.2 ||
        sample(
          x - (axis === 0 ? span / 2 : 0),
          z - (axis === 1 ? span / 2 : 0),
        ) <
          water + 0.2
      )
        continue;
      return site(kind, x, z, span / 2, { axis, span, waterLevel: water });
    }
    if (optional) return;
    throw Error(`Could not place ${kind} beside a river. Try another seed.`);
  }
  for (let k = 0; k < 4; k++) riverSite("watermill", k, k > 0);
  gradeSites(heights, GRID, STEP, sites, castles, rivers, lakes);
  report("Routing roads and building bridges", 0.38);
  let paths = [];
  const roadConnections = [],
    roadH = new Float32Array(N),
    wet = new Uint8Array(N),
    bridgeCells = new Set(),
    bridgeAxes = new Map(),
    bridgeRoadPoints = new Map();
  for (let id = 0; id < N; id++) {
    roadH[id] = sample((id % R) * 64, Math.floor(id / R) * 64);
    wet[id] =
      roadH[id] < 3 ||
      Number.isFinite(waterAt((id % R) * 64, Math.floor(id / R) * 64))
        ? 1
        : 0;
  }
  // Roads meet the quarter-turned gates, and route around fortress walls.
  const roadEndpoints = new Map();
  for (const c of castles) {
    const direction = [
        [0, -1],
        [1, 0],
        [0, 1],
        [-1, 0],
      ][c.turn],
      offset = c.halfZ * c.scaleZ;
    roadEndpoints.set(c.id, {
      gate: [
        c.p[0] + direction[0] * (offset + 4),
        c.p[2] + direction[1] * (offset + 4),
      ],
      approach: [
        c.p[0] + direction[0] * (offset + 90),
        c.p[2] + direction[1] * (offset + 90),
      ],
    });
    for (let id = 0; id < N; id++) {
      const x = (id % R) * 64,
        z = Math.floor(id / R) * 64;
      if (
        x > c.bounds.min[0] &&
        x < c.bounds.max[0] &&
        z > c.bounds.min[1] &&
        z < c.bounds.max[1]
      )
        wet[id] = 1;
    }
  }
  for (const s of sites.filter(
    (s) => s.kind === "bridge" || s.kind === "crossing",
  )) {
    roadEndpoints.set(s.id, {
      gate: [s.p[0], s.p[2]],
      approach: [
        s.p[0] + (s.axis === 0 ? s.span / 2 + 100 : 0),
        s.p[2] + (s.axis === 1 ? s.span / 2 + 100 : 0),
      ],
    });
  }
  // River cells are traversable only through designated bridge corridors.
  for (const river of rivers)
    for (const p of river.points)
      wet[Math.round(p[2] / 64) * R + Math.round(p[0] / 64)] = 1;
  for (const s of sites.filter(
    (s) => s.kind === "bridge" || s.kind === "crossing",
  )) {
    const x = Math.round(s.p[0] / 64),
      z = Math.round(s.p[2] / 64);
    s.waterLevel = Math.max(s.waterLevel, waterAt(s.p[0], s.p[2]));
    s.deck = s.waterLevel + 3;
    for (let t = -s.span / 2; t <= s.span / 2; t += 4)
      s.deck = Math.max(
        s.deck,
        sample(
          s.p[0] + (s.axis === 0 ? t : 0),
          s.p[2] + (s.axis === 1 ? t : 0),
        ) + 1.5,
        waterAt(
          s.p[0] + (s.axis === 0 ? t : 0),
          s.p[2] + (s.axis === 1 ? t : 0),
        ) + 3,
      );
    for (let d = -2; d <= 2; d++) {
      const xx = x + (s.axis === 0 ? d : 0),
        zz = z + (s.axis === 1 ? d : 0);
      if (xx >= 0 && xx < R && zz >= 0 && zz < R) {
        bridgeCells.add(zz * R + xx);
        bridgeAxes.set(zz * R + xx, s.axis);
        wet[zz * R + xx] = 0;
        bridgeRoadPoints.set(zz * R + xx, [
          s.p[0] + (s.axis === 0 ? d * 64 : 0),
          s.p[2] + (s.axis === 1 ? d * 64 : 0),
        ]);
        if (Math.abs(d) <= 1) roadH[zz * R + xx] = s.deck;
      }
    }
  }
  const crossingSites = sites.filter(
    (s) => s.kind === "bridge" || s.kind === "crossing",
  );
  const supportedBridge = (x, z) =>
    crossingSites.some(
      (s) =>
        (s.kind === "bridge" || s.kind === "crossing") &&
        Math.abs(s.axis === 0 ? z - s.p[2] : x - s.p[0]) < 5.1 &&
        Math.abs(s.axis === 0 ? x - s.p[0] : z - s.p[2]) < s.span / 2 + 4,
    );
  const roadPoint = (id) =>
    bridgeRoadPoints.get(id) ?? [(id % R) * 64, Math.floor(id / R) * 64];
  const edgeCache = new Map();
  const edgeClear = (from, to) => {
    const key = Math.min(from, to) * N + Math.max(from, to);
    if (edgeCache.has(key)) return edgeCache.get(key);
    const a = roadPoint(from),
      b = roadPoint(to),
      n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 8));
    let clear = true;
    for (let k = 0; k <= n; k++) {
      const x = mix(a[0], b[0], k / n),
        z = mix(a[1], b[1], k / n);
      if (
        !supportedBridge(x, z) &&
        (sample(x, z) < 0.5 || Number.isFinite(waterAt(x, z)))
      ) {
        clear = false;
        break;
      }
    }
    edgeCache.set(key, clear);
    return clear;
  };
  const nodeFor = (s) => {
    const point = roadEndpoints.get(s.id)?.approach ?? [s.p[0], s.p[2]];
    let best = -1,
      dist = Infinity;
    for (let dz = -2; dz <= 2; dz++)
      for (let dx = -2; dx <= 2; dx++) {
        const x = Math.round(point[0] / 64) + dx,
          z = Math.round(point[1] / 64) + dz,
          id = z * R + x;
        if (x < 1 || x >= R - 1 || z < 1 || z >= R - 1 || wet[id]) continue;
        const candidate = roadPoint(id),
          d = Math.hypot(candidate[0] - point[0], candidate[1] - point[1]);
        const height = sample(point[0], point[1]);
        if (Math.abs(roadH[id] - height) > d * 0.4 + 1) continue;
        let safe = true;
        for (let k = 1, n = Math.ceil(d / 8); k < n; k++) {
          const px = mix(point[0], candidate[0], k / n),
            pz = mix(point[1], candidate[1], k / n);
          if (sample(px, pz) < 1 || Number.isFinite(waterAt(px, pz))) {
            safe = false;
            break;
          }
        }
        if (safe && d < dist) {
          best = id;
          dist = d;
        }
      }
    return best;
  };
  const roadSites = sites.filter((s) => s.kind !== "pineapple-god");
  const network = [roadSites[0]],
    usedRoads = new Set(),
    routeLengths = [];
  const networkDistance = (from, to) => {
    const distance = new Map([[from, 0]]),
      seen = new Set();
    for (let k = 0; k < roadSites.length; k++) {
      let current,
        best = Infinity;
      for (const [id, value] of distance)
        if (!seen.has(id) && value < best) {
          current = id;
          best = value;
        }
      if (current === to) return best;
      if (current === undefined) break;
      seen.add(current);
      roadConnections.forEach(([a, b], i) => {
        const next = a === current ? b : b === current ? a : undefined;
        if (
          next !== undefined &&
          best + routeLengths[i] < (distance.get(next) ?? Infinity)
        )
          distance.set(next, best + routeLengths[i]);
      });
    }
    return Infinity;
  };
  const connections = roadSites.slice(1).map((s) => [s, undefined]);
  for (let k = 0; k < castles.length; k++)
    connections.push([castles[k], castles[(k + 1) % castles.length]]);
  for (const [s, loopTarget] of connections) {
    const target =
      loopTarget ??
      network.reduce((a, b) =>
        Math.hypot(a.p[0] - s.p[0], a.p[2] - s.p[2]) <
        Math.hypot(b.p[0] - s.p[0], b.p[2] - s.p[2])
          ? a
          : b,
      );
    const oldDistance = loopTarget
      ? networkDistance(s.id, target.id)
      : Infinity;
    if (
      loopTarget &&
      oldDistance < Math.hypot(s.p[0] - target.p[0], s.p[2] - target.p[2]) * 1.4
    )
      continue;
    const start = nodeFor(s),
      goal = nodeFor(target),
      cost = new Float64Array(N).fill(Infinity),
      from = new Int32Array(N).fill(-1),
      queue = new Heap();
    if (start < 0 || goal < 0)
      throw Error("A landmark has no safe road approach. Try another seed.");
    cost[start] = 0;
    queue.push(start, 0);
    while (queue.length) {
      const [id, c] = queue.pop();
      if (c !== cost[id]) continue;
      if (id === goal) break;
      for (const j of neighbors(id)) {
        if (wet[j]) continue;
        const bridgeAxis = bridgeAxes.get(id) ?? bridgeAxes.get(j);
        if (
          bridgeAxis !== undefined &&
          Math.abs(j - id) !== (bridgeAxis === 0 ? 1 : R)
        )
          continue;
        const diagonal = Math.abs(j - id) !== 1 && Math.abs(j - id) !== R;
        if (
          diagonal &&
          (wet[id + (j % R > id % R ? 1 : -1)] ||
            wet[id + (j > id ? R : -R)] ||
            bridgeCells.has(id) ||
            bridgeCells.has(j))
        )
          continue;
        const distance = diagonal ? Math.SQRT2 * 64 : 64;
        const slope = Math.abs(roadH[id] - roadH[j]) / distance;
        if (slope > 0.5 && !bridgeCells.has(id) && !bridgeCells.has(j))
          continue;
        if (!edgeClear(id, j)) continue;
        const v =
          c +
          distance *
            (usedRoads.has(j) ? 0.6 : 1) *
            (1 + slope * slope * 60) *
            (passes.some(
              (pass) =>
                Math.hypot(
                  (j % R) * 64 - pass.p[0],
                  Math.floor(j / R) * 64 - pass.p[2],
                ) < 300,
            )
              ? 0.8
              : 1) +
          (bridgeCells.has(j) ? 20 : 0);
        if (v < cost[j]) {
          cost[j] = v;
          from[j] = id;
          queue.push(j, v);
        }
      }
    }
    if (!Number.isFinite(cost[goal]) && loopTarget) continue;
    if (!Number.isFinite(cost[goal]))
      throw Error(
        "Could not connect every settlement by road. Try another seed.",
      );
    const nodes = [],
      routeNodes = [];
    for (let id = goal; id >= 0; id = from[id]) {
      routeNodes.push(id);
      nodes.push(
        bridgeRoadPoints.get(id) ?? [(id % R) * 64, Math.floor(id / R) * 64],
      );
      if (id === start) break;
    }
    nodes.reverse();
    const entrance = roadEndpoints.get(s.id),
      exit = roadEndpoints.get(target.id);
    const route = [
      ...(entrance ? [entrance.gate, entrance.approach] : [[s.p[0], s.p[2]]]),
      ...nodes,
      ...(exit ? [exit.approach, exit.gate] : [[target.p[0], target.p[2]]]),
    ];
    const length = route
      .slice(1)
      .reduce(
        (sum, p, i) => sum + Math.hypot(p[0] - route[i][0], p[1] - route[i][1]),
        0,
      );
    if (loopTarget && length >= oldDistance * 0.85) continue;
    for (const id of routeNodes) usedRoads.add(id);
    paths.push(route);
    routeLengths.push(length);
    roadConnections.push([s.id, target.id]);
    if (!loopTarget) network.push(s);
  }
  // Round dry-land road corners while preserving straight bridge approaches.
  paths = paths.map((path) => {
    const out = [path[0]];
    for (let i = 1; i < path.length - 1; i++) {
      const a = path[i - 1],
        b = path[i],
        c = path[i + 1],
        before = Math.hypot(a[0] - b[0], a[1] - b[1]),
        after = Math.hypot(c[0] - b[0], c[1] - b[1]);
      if (before < 20 || after < 20 || riverDistance(b[0], b[1]) < 140) {
        out.push(b);
        continue;
      }
      const radius = Math.min(22, before * 0.3, after * 0.3),
        q = b.map((v, k) => mix(v, a[k], radius / before)),
        r = b.map((v, k) => mix(v, c[k], radius / after));
      for (let j = 0; j <= 4; j++) {
        const t = j / 4;
        out.push(
          q.map((v, k) =>
            quantize((1 - t) ** 2 * v + 2 * (1 - t) * t * b[k] + t * t * r[k]),
          ),
        );
      }
    }
    out.push(path.at(-1));
    return out.some(
      ([x, z]) => Number.isFinite(waterAt(x, z)) && !supportedBridge(x, z),
    )
      ? path
      : out;
  });
  for (const s of sites.filter((s) => s.town)) {
    for (const offset of [-63, -21, 21, 63])
      paths.push([
        [s.p[0] + offset, s.p[2] - 105],
        [s.p[0] + offset, s.p[2] + 105],
      ]);
    for (const offset of [-44, 0, 44])
      paths.push([
        [s.p[0] - 110, s.p[2] + offset],
        [s.p[0] + 110, s.p[2] + offset],
      ]);
  }
  flattenSites(heights, GRID, STEP, sites, castles, rivers, lakes);
  gradeRoads(heights, GRID, STEP, paths, sites, rivers, lakes);
  const main = castles[0],
    gateOffset = main.halfZ * main.scaleZ + 140;
  const spawn = [
    main.p[0] +
      (main.turn === 1 ? gateOffset : main.turn === 3 ? -gateOffset : 0),
    0,
    main.p[2] +
      (main.turn === 0 ? -gateOffset : main.turn === 2 ? gateOffset : 0),
  ];
  spawn[1] = Math.min(
    VERTICAL_LIMITS.assistance - 70,
    Math.max(280, sample(spawn[0], spawn[2]) + 170),
  );
  const plan = {
    request,
    ecology: preset,
    attempt,
    shapeFamily,
    landscapeProfile,
    baseHeights,
    heights,
    grid: GRID,
    step: STEP,
    portalAnchor,
    size: SIZE,
    mainland: mainlandMask(heights, GRID, STEP),
    regions,
    flightCorridors,
    rivers,
    lakes,
    waterfalls,
    sites,
    castles,
    paths,
    roadConnections,
    passes,
    spawn,
  };
  validatePlan(plan);
  const audit = auditGeography(plan, sample, false);
  if (audit.wetRoads || audit.unsafeFlight)
    throw Error("Layout lacks safe road or flight clearance");
  return plan;
}

export function materializeIsland6(plan, report = () => {}) {
  const {
    request,
    attempt,
    shapeFamily,
    landscapeProfile,
    portalAnchor,
    regions,
    mainland,
    flightCorridors,
    rivers,
    lakes,
    waterfalls,
    sites: originalSites,
    castles: originalCastles,
    paths,
    roadConnections,
    passes,
    spawn,
  } = plan;
  const sites = structuredClone(originalSites),
    castles = structuredClone(originalCastles);
  const god = sites.find((s) => s.kind === "pineapple-god"),
    main = castles[0];
  const seed = request.seed;
  const hash = hashFor(
    (seed ^ Math.imul(attempt, 0x9e3779b9) ^ 0x85ebca6b) >>> 0,
  );
  const vegetationHash = hashFor((seed ^ 0xa84f391d) >>> 0);
  const heights = new Float32Array(GRID ** 2);
  for (let z = 0; z < GRID; z++) {
    for (let x = 0; x < GRID; x++)
      heights[z * GRID + x] = fieldSample(
        plan.baseHeights,
        plan.grid,
        plan.step,
        x * 2,
        z * 2,
      );
    if (z % 768 === 0)
      report("Sampling selected island", 0.1 + (z / GRID) * 0.2);
  }
  const sample = (x, z) => sampleHeight(heights, x, z);
  carveWater(heights, GRID, STEP, rivers, lakes);
  gradeSites(heights, GRID, STEP, sites, castles, rivers, lakes);
  flattenSites(heights, GRID, STEP, sites, castles, rivers, lakes);
  gradeRoads(heights, GRID, STEP, paths, sites, rivers, lakes);
  const riverDistance = pathIndex(
    rivers.map((r) => r.points.map((p) => [p[0], p[2]])),
    128,
    400,
  );
  const waterAt = (x, z) => waterHeight(rivers, lakes, x, z);
  report("Building varied breakable landmarks", 0.5);
  const architecture = createArchitecture({ sites, castles }, sample, hash),
    { entities, homes } = architecture;
  // Build the approved monument before validating new geography.
  buildPineappleGod(god, entities, hash, sample, true);
  // Footings reach graded ground while retaining their tops and owner IDs.
  // This also grounds the retained monument owners with no approved mesh.
  for (const e of entities)
    if (e.foundation) {
      const ground = sample(e.p[0], e.p[2]),
        originalBottom = e.p[1] - e.s[1];
      if (!e.visual && originalBottom <= ground + 0.05) continue;
      const top = e.p[1] + e.s[1],
        bottom = Math.min(originalBottom, ground - 1);
      e.p[1] = (top + bottom) / 2;
      e.s[1] = (top - bottom) / 2;
    }
  architecture.structureCount = entities.length;
  if (entities.length > 48000)
    throw Error(`Structure budget exceeded: ${entities.length}`);
  for (const c of castles) {
    const s = sites.find((s) => s.id === c.id);
    s.assemblies = c.assemblies;
  }
  const distanceToRoad = pathIndex(paths),
    maxTrees = PRESETS[plan.ecology].trees;
  report("Planting varied forests", 0.65);
  const treeCandidates = [];
  for (let z = 50; z < SIZE - 50; z += 24)
    for (let x = 50; x < SIZE - 50; x += 24) {
      const px = x + (vegetationHash(x, z) - 0.5) * 19,
        pz = z + (vegetationHash(x + 5, z + 7) - 0.5) * 19,
        h = sample(px, pz),
        cluster = regionAt(regions, px, pz).woodland;
      const slope =
        Math.hypot(
          sample(px + 8, pz) - sample(px - 8, pz),
          sample(px, pz + 8) - sample(px, pz - 8),
        ) / 16;
      if (
        Math.hypot(px - portalAnchor[0], pz - portalAnchor[2]) < 140 ||
        !onMainland(mainland, px, pz) ||
        Number.isFinite(waterAt(px, pz)) ||
        flightDistance(flightCorridors, px, pz) < 145 ||
        h < 5 ||
        h > 650 ||
        slope > 0.65 ||
        cluster < 0.24 ||
        vegetationHash(x + 3, z) >
          (0.45 + regionAt(regions, px, pz).woodland * 0.5) *
            (1 - smooth(250, 650, h)) *
            (1 - smooth(0.3, 0.65, slope)) ||
        distanceToRoad(px, pz) < 11 ||
        sites.some(
          (s) =>
            Math.abs(px - s.p[0]) < s.radius + 16 &&
            Math.abs(pz - s.p[2]) < s.radius + 16,
        ) ||
        Math.hypot(px - spawn[0], pz - spawn[2]) < 90
      )
        continue;
      const rd = riverDistance(px, pz),
        region = regionAt(regions, px, pz);
      if (rd < 20) continue;
      const species =
        rd < 110 || region.biome === 3
          ? "riverside"
          : h > 115 ||
              region.exposure > 0.5 ||
              vegetationHash(Math.floor(px / 320), Math.floor(pz / 320)) > 0.57
            ? "pine"
            : "broadleaf";
      const tall =
          (species === "pine" ? 18 : species === "riverside" ? 15 : 12) +
          vegetationHash(x + 8, z + 7) * 12,
        wide =
          species === "broadleaf"
            ? 5 + vegetationHash(x, z + 2) * 3
            : species === "riverside"
              ? 3
              : 3.5;
      treeCandidates.push({
        priority: vegetationHash(x + 977, z + 953),
        kind: "tree",
        p: [quantize(px), quantize(h + tall / 2), quantize(pz)],
        s: [wide, tall / 2, wide],
        material: "foliage",
        assembly: "",
        foundation: true,
        supports: [],
        variant: vegetationHash(x, z),
        treeSpecies: species,
      });
    }
  // Rank all eligible trees before thinning, avoiding a north-to-south population bias.
  treeCandidates.sort((a, b) => a.priority - b.priority);
  const forest = treeCandidates
    .slice(0, maxTrees)
    .sort((a, b) => a.p[2] - b.p[2] || a.p[0] - b.p[0]);
  for (const { priority, ...tree } of forest)
    entities.push({ ...tree, id: entities.length });
  for (let i = 0; i < 1148; i++) {
    const x = 200 + vegetationHash(i, 301) * (SIZE - 400),
      z = 200 + vegetationHash(i, 302) * (SIZE - 400),
      h = sample(x, z);
    if (
      Math.hypot(x - portalAnchor[0], z - portalAnchor[2]) < 140 ||
      !onMainland(mainland, x, z) ||
      Number.isFinite(waterAt(x, z)) ||
      flightDistance(flightCorridors, x, z) < 145 ||
      h < 3 ||
      distanceToRoad(x, z) < 9 ||
      sites.some((s) => Math.hypot(x - s.p[0], z - s.p[2]) < s.radius + 15) ||
      Math.hypot(x - spawn[0], z - spawn[2]) < 90
    )
      continue;
    const size = 2 + vegetationHash(i, 303) * 4;
    entities.push({
      id: entities.length,
      kind: "rock",
      p: [x, h + size * 0.6, z],
      s: [size, size * 0.6, size],
      material: "rock",
      assembly: "",
      foundation: true,
      supports: [],
      variant: vegetationHash(i, 304),
    });
  }
  report("Finding safe homes and flight approaches", 0.88);
  const civilians = [],
    blocks = entities.filter((e) => e.kind === "block");
  const blockCells = new Map();
  for (const block of blocks) {
    const x0 = clamp(Math.floor((block.p[0] - block.s[0] - 1.5) / 64), 0, 143),
      x1 = clamp(Math.floor((block.p[0] + block.s[0] + 1.5) / 64), 0, 143),
      z0 = clamp(Math.floor((block.p[2] - block.s[2] - 1.5) / 64), 0, 143),
      z1 = clamp(Math.floor((block.p[2] + block.s[2] + 1.5) / 64), 0, 143);
    for (let z = z0; z <= z1; z++)
      for (let x = x0; x <= x1; x++) {
        const id = z * 144 + x,
          list = blockCells.get(id);
        if (list) list.push(block);
        else blockCells.set(id, [block]);
      }
  }
  function civilian(home, settlement, x, z) {
    for (let a = 0; a < 1800; a++) {
      const dx = a === 0 ? 0 : Math.cos(a * 2.39996323) * Math.sqrt(a) * 3,
        dz = a === 0 ? 0 : Math.sin(a * 2.39996323) * Math.sqrt(a) * 3,
        px = x + dx,
        pz = z + dz,
        h = sample(px, pz);
      if (
        !onMainland(mainland, px, pz) ||
        Number.isFinite(waterAt(px, pz)) ||
        h < 1 ||
        riverDistance(px, pz) < 24 ||
        (
          blockCells.get(Math.floor(pz / 64) * 144 + Math.floor(px / 64)) ?? []
        ).some(
          (e) =>
            Math.abs(e.p[0] - px) < e.s[0] + 1.5 &&
            Math.abs(e.p[2] - pz) < e.s[2] + 1.5 &&
            e.p[1] + e.s[1] > h &&
            e.p[1] - e.s[1] < h + 5,
        ) ||
        civilians.some((c) => Math.hypot(c.p[0] - px, c.p[2] - pz) < 2)
      )
        continue;
      civilians.push({
        id: civilians.length,
        home,
        settlement,
        p: [quantize(px), quantize(h), quantize(pz)],
      });
      return;
    }
    throw Error(`No safe resident spawn near ${home}. Try another seed.`);
  }
  for (const home of homes) {
    const s = sites.find((s) => s.assemblies.includes(home.assembly));
    if (!s) throw Error("Missing home assembly.");
    for (let i = 0; i < 8; i++)
      civilian(
        home.assembly,
        s.id,
        home.x + (i - 3.5) * 4,
        home.z + home.d / 2 + 5,
      );
  }
  for (const c of castles)
    for (let i = 0; i < (c.grand ? 64 : 16); i++) {
      const x = c.p[0] + ((i % 8) - 3.5) * 22,
        z = c.bounds.min[1] - 12 - Math.floor(i / 8) * 4;
      civilian(c.id, c.id, x, z);
    }
  const world = {
    version: WORLD_VERSION,
    generatorVersion: GENERATOR_VERSION,
    shapeFamily,
    portalAnchor,
    regions,
    mainland,
    flightCorridors,
    lakes,
    waterfalls,
    seed,
    landscapeProfile,
    size: SIZE,
    step: STEP,
    grid: GRID,
    chunkSize: 64,
    castle: main.p,
    castleBounds: main.bounds,
    landmarks: main.landmarks,
    castles: castles.map(({ halfX, halfZ, scaleX, scaleY, scaleZ, ...c }) => c),
    rivers,
    passes: passes.map((pass) => ({
      ...pass,
      p: [pass.p[0], sample(pass.p[0], pass.p[2]), pass.p[2]],
    })),
    banners: architecture.banners,
    lights: architecture.lights,
    bridge: sites.find((s) => s.kind === "bridge").p.filter((_, i) => i !== 1),
    spawn,
    paths,
    roadConnections,
    structureCount: architecture.structureCount,
    castleCount: architecture.castleCount,
    sites,
    civilians,
    entities,
  };
  const { landFraction } = validateIsland6(world, heights);
  // Reject layouts with too little usable land or insufficient surrounding ocean.
  if (landFraction < 0.35 || landFraction > 0.72)
    throw Error("Island footprint failed generation validation.");
  applyApprovedGod(
    god,
    entities.filter((e) => e.assembly === god.id),
    sample,
  );
  report("Island ready", 1);
  return { world, heights };
}
export function validateIsland6(world, heights) {
  if (
    heights.length !== GRID ** 2 ||
    world.size !== SIZE ||
    world.grid !== GRID ||
    world.step !== STEP ||
    world.chunkSize !== 64 ||
    world.version !== WORLD_VERSION ||
    world.generatorVersion !== GENERATOR_VERSION
  )
    throw Error("Island baseline is incomplete.");
  if (
    world.castles.length !== 5 ||
    !world.civilians.length ||
    world.structureCount > 48000
  )
    throw Error("Island content failed validation.");
  let peak = -Infinity,
    land = 0;
  for (let i = 0; i < heights.length; i++) {
    const h = heights[i];
    if (!Number.isFinite(h) || h > VERTICAL_LIMITS.maxPeak || h < -100)
      throw Error("Island terrain is invalid.");
    peak = Math.max(peak, h);
    if (h > 0) land++;
  }
  if (
    land / heights.length < 0.35 ||
    land / heights.length > 0.72 ||
    peak < VERTICAL_LIMITS.minPeak ||
    peak > VERTICAL_LIMITS.maxPeak
  )
    throw Error("Island coastline or mountain heights failed validation.");
  for (let i = 0; i < GRID; i++)
    if (
      heights[i] >= 0 ||
      heights[(GRID - 1) * GRID + i] >= 0 ||
      heights[i * GRID] >= 0 ||
      heights[i * GRID + GRID - 1] >= 0
    )
      throw Error("Island must be surrounded by ocean.");
  if (!world.mainland) throw Error("Mainland mask missing");
  for (const site of world.sites)
    if (!onMainland(world.mainland, site.p[0], site.p[2]))
      throw Error("Landmark is outside the mainland");
  if (
    sampleHeight(heights, world.spawn[0], world.spawn[2]) + 100 >
    world.spawn[1]
  )
    throw Error("Aircraft spawn lacks terrain clearance.");
  const reached = new Set(["castle"]);
  for (let pass = 0; pass < world.sites.length; pass++)
    for (const [a, b] of world.roadConnections)
      if (reached.has(a) || reached.has(b)) {
        reached.add(a);
        reached.add(b);
      }
  if (world.sites.some((s) => s.kind !== "pineapple-god" && !reached.has(s.id)))
    throw Error("Road network is disconnected.");
  for (const s of world.sites)
    if (s.kind === "bridge" || s.kind === "crossing") {
      const parts = world.entities.filter((e) => e.assembly === s.id);
      if (
        !Number.isFinite(s.deck) ||
        s.deck < s.waterLevel + 3 ||
        !parts.some((e) => e.foundation) ||
        !parts.some(
          (e) => e.material === "wood" && Math.abs(e.p[1] - s.deck) < 0.01,
        )
      )
        throw Error("River crossing is missing its supported bridge deck.");
    }
  for (let i = 0; i < world.entities.length; i++) {
    const e = world.entities[i];
    if (
      e.id !== i ||
      e.s.some((v) => !Number.isFinite(v) || v <= 0) ||
      e.p.some((v) => !Number.isFinite(v)) ||
      e.supports.some((id) => id < 0 || id >= world.structureCount)
    )
      throw Error("Invalid structural identity or geometry.");
    if (
      e.kind === "block" &&
      e.foundation &&
      e.p[1] - e.s[1] > sampleHeight(heights, e.p[0], e.p[2]) + 1.4
    )
      throw Error("A structure lacks a grounded footing.");
    if (
      e.visual &&
      (e.p[1] + e.s[1] >= VERTICAL_LIMITS.ceiling ||
        (e.foundation &&
          sampleHeight(heights, e.p[0], e.p[2]) < e.p[1] - e.s[1] - 1.4))
    )
      throw Error(
        "The pineapple god lacks grounded foundations or flight clearance.",
      );
  }
  // Every structural module must reach an anchored foundation through its support graph.
  const grounded = new Uint8Array(world.structureCount),
    queue = [];
  for (let i = 0; i < world.structureCount; i++)
    if (world.entities[i].foundation) {
      grounded[i] = 1;
      queue.push(i);
    }
  for (let head = 0; head < queue.length; head++)
    for (const id of world.entities[queue[head]].supports)
      if (!grounded[id]) {
        grounded[id] = 1;
        queue.push(id);
      }
  if (grounded.some((v) => !v))
    throw Error("A structural module has no grounded support.");
  validatePlayableGeography(world, (x, z) => sampleHeight(heights, x, z));
  return { landFraction: land / heights.length, peak };
}
