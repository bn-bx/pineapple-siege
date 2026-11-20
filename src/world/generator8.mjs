import {
  auditGeography,
  validatePlayableGeography,
} from "./generation-validation.mjs";
import {
  PRESETS,
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
  containRivers,
  gradeSites,
  gradeRoads,
  flattenSites,
  waterHeight,
} from "./generation-grading7.mjs";
import { createMountainLayout, mountainRelief } from "./mountains6.mjs";
import { createArchitecture } from "./architecture.mjs";
import { VERTICAL_LIMITS } from "./vertical-limits.mjs";
import { buildPineappleGod } from "./pineapple-god.mjs";
import { applyApprovedGod } from "./approved-god.mjs";
export const GENERATOR_VERSION = 8;
export const WORLD_VERSION = 14;
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
/**
 * Water levels from the ground the river actually runs through. The drainage
 * graph fills every hollow to its spill height, which left long reaches held
 * level above lower banks. Here the surface stays a little below the lower
 * of the two banks at every sample and never rises downstream; carving then
 * cuts the channel down to it. Tributaries meet the trunk at its level.
 */
export function settleRiverLevels(rivers, sample, freeboard = 0.6) {
  const settled = new Map();
  for (const river of rivers) {
    const P = river.points,
      // Rivers that reach the sea, including basins below sea level, keep
      // their mouth at sea level and drop to it over the last reach.
      mouth = P.at(-1)[1] === 0;
    let water = Infinity;
    for (let i = 0; i < P.length; i++) {
      const [x, , z] = P[i],
        a = P[Math.max(0, i - 1)],
        b = P[Math.min(P.length - 1, i + 1)],
        length = Math.hypot(b[0] - a[0], b[2] - a[2]) || 1,
        nx = -(b[2] - a[2]) / length,
        nz = (b[0] - a[0]) / length,
        width = river.widths?.[i] ?? river.width;
      let bank = Infinity;
      for (const d of [width + 1.5, width + 5])
        for (const side of [-1, 1])
          bank = Math.min(bank, sample(x + nx * d * side, z + nz * d * side));
      water = Math.min(water, bank - freeboard);
      P[i][1] = quantize(Math.max(0, water));
    }
    if (mouth) P.at(-1)[1] = 0;
    // A tributary ends on a point of a river settled before it.
    const join = settled.get(P.at(-1)[0] + ":" + P.at(-1)[2]);
    if (join !== undefined) {
      P.at(-1)[1] = join;
      for (let i = P.length - 2; i >= 0; i--)
        P[i][1] = Math.max(P[i][1], P[i + 1][1]);
    }
    for (const p of P) {
      const key = p[0] + ":" + p[2];
      if (!settled.has(key)) settled.set(key, p[1]);
    }
  }
}
/** PS8 adds twin-lobed, fingered and teardrop mainlands to the PS7 coast families. */
function shapeRadius8(family, x, z, variation) {
  const { phase = 0, breadth = 0.5, bend = 0.5 } = variation,
    angle = Math.atan2(z, x),
    distance = Math.hypot(x, z);
  if (family === "twin") {
    // Two unequal lobes joined by a waisted isthmus.
    const offset = 1250 + breadth * 350,
      tilt = (bend - 0.5) * 700,
      a = Math.hypot((x + offset) / (1650 + bend * 300), (z + tilt) / 1750),
      b = Math.hypot((x - offset) / (1350 + breadth * 350), (z - tilt) / 1500),
      neck = Math.hypot(x / 1500, (z - tilt * 0.2) / (520 + breadth * 260));
    return Math.min(a, b, neck);
  }
  if (family === "fingers") {
    // Long ridged peninsulas separated by deep, fjord-like sounds.
    const count = 4 + Math.floor(bend * 3),
      lobe = Math.max(0, Math.cos(angle * count + phase)) ** 3;
    return (
      distance /
      (1950 * (1 + 0.62 * lobe + 0.06 * Math.sin(angle * 9 - phase)) +
        breadth * 200)
    );
  }
  if (family === "teardrop") {
    // A broad head tapering into one long tail.
    const pointed = Math.cos(angle - phase);
    return (
      distance /
      (2350 *
        (1 + (0.32 + breadth * 0.12) * pointed + 0.08 * Math.cos(2 * angle)) +
        0.05 * Math.sin(angle * 5) * 2350)
    );
  }
  return shapeRadius(family, x, z, variation);
}
/**
 * PS8 offshore islands: 3-7 hilly isles, sandy cays, sea-stack clusters and
 * atolls, placed only in open ocean away from the mainland and map edge.
 */
function addOffshoreIslands(field, grid, size, hash) {
  const step = size / (grid - 1),
    placed = [],
    sample = (x, z) => fieldSample(field, grid, step, x, z);
  const target = 3 + Math.floor(hash(1, 851) * 5),
    // Most seeds first try for one large satellite island where the ocean allows.
    wantsLarge = hash(2, 851) < 0.85;
  const stamp = (cx, cz, extent, height) => {
    for (
      let z = Math.max(0, Math.floor((cz - extent) / step));
      z <= Math.min(grid - 1, Math.ceil((cz + extent) / step));
      z++
    )
      for (
        let x = Math.max(0, Math.floor((cx - extent) / step));
        x <= Math.min(grid - 1, Math.ceil((cx + extent) / step));
        x++
      ) {
        const i = z * grid + x,
          h = height(x * step - cx, z * step - cz);
        if (Number.isFinite(h)) field[i] = Math.max(field[i], h);
      }
  };
  for (let k = 0; k < 80 && placed.length < target; k++) {
    const large = wantsLarge && k < 40 && placed.filter((p) => p.large).length < 2 && k % 2 === 0,
      kind = large
        ? "hill"
        : ["hill", "hill", "hill", "cay", "stacks", "atoll"][
            Math.floor(hash(k, 852) * 6)
          ],
      extent = large
        ? 760 + hash(k, 853) * 420
        : kind === "hill"
          ? 300 + hash(k, 853) * 360
          : kind === "cay"
            ? 280 + hash(k, 853) * 260
            : kind === "atoll"
              ? 340 + hash(k, 853) * 200
              : 200 + hash(k, 853) * 120,
      // Outlines reach about 1.3x their nominal extent on headlands.
      reach = kind === "hill" ? extent * 1.3 : extent,
      margin = reach + 220,
      cx = margin + hash(k, 854) * (size - 2 * margin),
      cz = margin + hash(k, 855) * (size - 2 * margin);
    if (placed.some((p) => Math.hypot(p.x - cx, p.z - cz) < p.reach + reach + 200))
      continue;
    let open = sample(cx, cz) < -8;
    for (let j = 0; j < 28 && open; j++) {
      const a = (j / 28) * Math.PI * 2;
      for (const r of [reach * 0.6, reach + 170])
        if (sample(cx + Math.cos(a) * r, cz + Math.sin(a) * r) > -8) open = false;
    }
    if (!open) continue;
    const phase = hash(k, 856) * Math.PI * 2,
      peak = large ? 90 + hash(k, 857) * 140 : 35 + hash(k, 857) * 95,
      turn = hash(k, 858) * Math.PI;
    if (kind === "hill") {
      // An irregular coast (headlands and coves from five harmonics) around
      // one to three summits joined by saddles, with a sandy apron.
      const harmonics = [2, 3, 4, 5, 7].map((n, i) => ({
          n,
          amp: (0.2 / (1 + i * 0.6)) * (0.5 + hash(k * 13 + i, 864)),
          phase: hash(k * 13 + i, 865) * Math.PI * 2,
        })),
        peaks = Array.from({ length: 1 + Math.floor(hash(k, 866) * 3) }, (_, i) => {
          const a = phase + i * 2.4,
            r = i === 0 ? hash(k, 867) * 0.25 : 0.3 + hash(k * 5 + i, 868) * 0.25;
          return {
            x: Math.cos(a) * r * extent,
            z: Math.sin(a) * r * extent,
            height: peak * (i === 0 ? 1 : 0.45 + hash(k * 5 + i, 869) * 0.45),
            width: extent * (0.28 + hash(k * 5 + i, 870) * 0.2),
          };
        });
      stamp(cx, cz, reach + 40, (x, z) => {
        const a = Math.atan2(z, x);
        let shape = 1;
        for (const h of harmonics) shape += h.amp * Math.sin(a * h.n + h.phase);
        const t = 1 - Math.hypot(x, z) / (extent * Math.max(0.45, shape));
        if (t <= 0) return NaN;
        let relief = 0;
        for (const p of peaks)
          relief = Math.max(
            relief,
            p.height * Math.exp(-((Math.hypot(x - p.x, z - p.z) / p.width) ** 2)),
          );
        // Low rolling ground everywhere inland, summits rising behind the beach.
        const rolling =
          14 * (1 + Math.sin(x / 70 + phase) * Math.sin(z / 85 - phase)) +
          6 * Math.sin(x / 31 - z / 43 + phase);
        return 2.5 + 9 * Math.min(1, t * 6) + (rolling + relief) * smooth(0.04, 0.3, t);
      });
    }
    else if (kind === "cay")
      stamp(cx, cz, extent + 40, (x, z) => {
        const u = (x * Math.cos(turn) + z * Math.sin(turn)) / extent,
          v = (-x * Math.sin(turn) + z * Math.cos(turn)) / (extent * (0.26 + hash(k, 859) * 0.18)),
          t = 1 - Math.hypot(u, v + 0.25 * u * u);
        return t <= 0 ? NaN : 2 + t * 9;
      });
    else if (kind === "atoll")
      stamp(cx, cz, extent + 40, (x, z) => {
        const d = Math.hypot(x, z),
          a = Math.atan2(z, x),
          width = 55 + 30 * Math.sin(a * 2 + phase),
          ring = 1 - ((d - extent * 0.8) / width) ** 2,
          gap = Math.sin(a * 3 + phase) > 0.86;
        // The lagoon stays shallow water; reef breaks let the sea in.
        if (d < extent * 0.8 - width) return -3;
        return ring <= 0 || gap ? NaN : 2 + ring * 7;
      });
    else {
      const count = 3 + Math.floor(hash(k, 860) * 4);
      for (let s = 0; s < count; s++) {
        const a = phase + s * 2.399963,
          r = s === 0 ? 0 : 50 + hash(k * 7 + s, 861) * (extent - 60),
          sx = cx + Math.cos(a) * r,
          sz = cz + Math.sin(a) * r,
          radius = 40 + hash(k * 7 + s, 862) * 35,
          tall = 22 + hash(k * 7 + s, 863) * 60;
        // Steep-sided pillars with flat, grassy caps.
        stamp(sx, sz, radius + 20, (x, z) => {
          const t = 1 - Math.hypot(x, z) / radius;
          return t <= 0 ? NaN : tall * Math.min(1, t * 3.2);
        });
      }
    }
    placed.push({ x: cx, z: cz, extent, reach, kind, large });
  }
  return placed;
}
/**
 * Where two rivers run close together, bank shaping follows the nearer
 * river's level and can lift ground above the other's surface. Keep the
 * four grid nodes around every centreline point below that river's water.
 */
function keepRiverBedsBelowWater(field, grid, step, rivers) {
  for (const river of rivers)
    for (const [x, water, z] of river.points) {
      const ix = Math.floor(x / step),
        iz = Math.floor(z / step);
      for (const [dx, dz] of [
        [0, 0],
        [1, 0],
        [0, 1],
        [1, 1],
      ]) {
        const gx = Math.min(grid - 1, ix + dx),
          gz = Math.min(grid - 1, iz + dz),
          i = gz * grid + gx;
        field[i] = Math.min(field[i], water - 0.05);
      }
    }
}
export function planIsland8(request, report = () => {}, firstAttempt = 0) {
  const { seed } = request;
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff)
    throw Error("Island seed must be an unsigned 32-bit integer.");
  let failure;
  const reasons = [];
  // Retry only compact plans; full-resolution terrain is allocated after acceptance.
  for (let attempt = firstAttempt; attempt < 16; attempt++) {
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
  // PS8: most mainlands sit off-centre, opening a wide sea on one side for
  // larger offshore islands. Late retries return to the centred PS7 layout.
  const shift = attempt >= 8 || hash(4, 4411) < 0.2 ? 0 : 350 + hash(5, 4411) * 400,
    shiftAngle = hash(6, 4411) * Math.PI * 2;
  const cx = SIZE / 2 + (hash(1, 1) - 0.5) * 100 + Math.cos(shiftAngle) * shift,
    cz = SIZE / 2 + (hash(1, 2) - 0.5) * 100 + Math.sin(shiftAngle) * shift,
    rotation = hash(2, 2) * Math.PI * 2,
    cos = Math.cos(rotation),
    sin = Math.sin(rotation);
  // Leave a wider ocean margin while scaling mountains and saddles with the coast.
  // PS8: mainland size varies per seed (PS7 used a fixed 1.41).
  // Later retries fall back toward the proven PS7 size so every seed resolves.
  const islandScale = attempt >= 8 ? 1.41 : 1.28 + hash(3, 4411) * 0.16;
  const landscapeProfile = ["mountainous", "rolling woodland", "broad lowland"][
    Math.floor(identityHash(9, 411) * 3)
  ];
  const SHAPE_FAMILIES = [
    "elongated",
    "peninsulas",
    "horseshoe",
    "irregular",
    "crescent",
    "hammerhead",
    "twin",
    "fingers",
    "teardrop",
  ];
  const seededFamily =
    SHAPE_FAMILIES[Math.floor(identityHash(19, 412) * SHAPE_FAMILIES.length)];
  // After twelve failed layouts, switch to one of the six PS7 families.
  const shapeFamily =
    attempt >= 12 && SHAPE_FAMILIES.indexOf(seededFamily) >= 6
      ? SHAPE_FAMILIES[(SHAPE_FAMILIES.indexOf(seededFamily) + attempt) % 6]
      : seededFamily;
  // Most islands blend in a second family, so outlines stop repeating.
  const blendFamily =
      SHAPE_FAMILIES[Math.floor(identityHash(24, 412) * SHAPE_FAMILIES.length)],
    blendWeight =
      attempt >= 4 || identityHash(25, 412) < 0.3
        ? 0
        : identityHash(26, 412) * 0.45;
  const late = attempt >= 10,
    warpAmount = late ? 230 : 140 + hash(27, 412) * 240,
    warpScale = late ? 700 : 520 + hash(28, 412) * 480;
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
    { length: late ? 3 + Math.floor(hash(8, 402) * 3) : 2 + Math.floor(hash(8, 402) * 6) },
    (_, i) => ({
      angle: hash(i, 402) * Math.PI * 2,
      depth: late ? 240 + hash(i, 403) * 640 : 180 + hash(i, 403) * 860,
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
      const warpedX =
          lx +
          (noise(wx / warpScale + 11, wz / warpScale + 27) - 0.5) * warpAmount,
        warpedZ =
          lz +
          (noise(wx / warpScale + 39, wz / warpScale + 7) - 0.5) * warpAmount;
      let r = mix(
        shapeRadius8(shapeFamily, warpedX, warpedZ, shapeVariation),
        shapeRadius8(blendFamily, warpedX, warpedZ, shapeVariation),
        blendWeight,
      );
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
      // Regional uplands and rolling hills continue between the mountain ranges.
      // Warp their coordinates so valleys bend instead of following the noise grid.
      const hx = wx + (noise(wx / 950 + 103, wz / 950 + 107) - 0.5) * 360,
        hz = wz + (noise(wx / 950 + 109, wz / 950 + 113) - 0.5) * 360;
      const upland = smooth(0.26, 0.78, fbm(hx / 1350 + 17, hz / 1350 + 43)),
        rolling = smooth(0.22, 0.8, noise(hx / 420 + 61, hz / 420 + 83)),
        detail = fbm(hx / 165 + 35, hz / 165 + 27),
        valley =
          1 -
          smooth(
            0.035,
            0.23,
            Math.abs(noise(hx / 730 + 127, hz / 730 + 131) * 2 - 1),
          );
      const regionalScale = landscapeProfile === "broad lowland" ? 0.8 : 1;
      const hills = Math.max(
        10,
        18 +
          regionalScale * (upland * 145 + rolling * 85) +
          detail * 22 -
          valley * 32,
      );
      const id = z * coarseGrid + x;
      const coastExposure = hash(Math.floor((angle + Math.PI) * 4), 933);
      const shoreHills =
        // Beaches descend to a low coastal apron; exposed sectors retain headlands.
        mix(10 + detail * 12, hills, smooth(1.015, 0.8, r)) +
        (coastExposure > 0.7 ? 65 : 0) * smooth(0.72, 0.97, r);
      const shelf = -26 + 18 * Math.exp(-Math.max(0, r - 1) * 30);
      coarse[id] = mix(shelf, shoreHills, inland);
      mountain[id] = relief * inland;
      highestMountain = Math.max(highestMountain, mountain[id]);
    }
  const targetPeak = 760 + hash(5, 411) * 200;
  // Normalize the combined peak without suppressing the rolling lowlands.
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
  const offshore = addOffshoreIslands(coarse, coarseGrid, SIZE, hash);
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
  /**
   * Turn a 64 m drainage path into a natural channel: a centripetal
   * Catmull-Rom curve through the drainage nodes, resampled about every
   * 16 m, with a gentle hashed meander that fades out at the source, at the
   * mouth or join (so tributaries still meet the trunk exactly) and on steep
   * reaches. Small level changes are spread along each reach; drops big
   * enough to be falls stay concentrated at the end of their reach.
   */
  function meanderRiver(points, salt) {
    if (points.length < 3) return points.map((p) => p.map(quantize));
    const spacing = 16,
      fallDrop = 8;
    const node = (i) => points[clamp(i, 0, points.length - 1)];
    const curve = [];
    for (let i = 0; i < points.length - 1; i++) {
      const p0 = node(i - 1),
        p1 = node(i),
        p2 = node(i + 1),
        p3 = node(i + 2);
      const knot = (a, b) =>
        Math.max(1e-3, Math.hypot(b[0] - a[0], b[2] - a[2]) ** 0.5);
      const t1 = knot(p0, p1),
        t2 = t1 + knot(p1, p2),
        t3 = t2 + knot(p2, p3);
      const at = (t, k) => {
        // Barry-Goldman evaluation of the centripetal spline on x/z.
        const a1 = (p0[k] * (t1 - t)) / t1 + (p1[k] * t) / t1,
          a2 = (p1[k] * (t2 - t) + p2[k] * (t - t1)) / (t2 - t1),
          a3 = (p2[k] * (t3 - t) + p3[k] * (t - t2)) / (t3 - t2),
          b1 = (a1 * (t2 - t)) / t2 + (a2 * t) / t2,
          b2 = (a2 * (t3 - t) + a3 * (t - t1)) / (t3 - t1);
        return (b1 * (t2 - t) + b2 * (t - t1)) / (t2 - t1);
      };
      const run = Math.hypot(p2[0] - p1[0], p2[2] - p1[2]),
        steps = Math.max(1, Math.round(run / spacing)),
        drop = p1[1] - p2[1];
      for (let j = i === 0 ? 0 : 1; j <= steps; j++) {
        const u = j / steps,
          t = t1 + (t2 - t1) * u,
          // A fall keeps the upper level until the last sample of its reach.
          y = drop > fallDrop ? (j < steps ? p1[1] : p2[1]) : p1[1] - drop * u;
        curve.push(
          i === 0 && j === 0
            ? [p1[0], p1[1], p1[2]]
            : j === steps
              ? [p2[0], y, p2[2]]
              : [at(t, 0), y, at(t, 2)],
        );
      }
    }
    // Arc length and local grade drive where the river may wander.
    const run = [0];
    for (let i = 1; i < curve.length; i++)
      run.push(
        run[i - 1] +
          Math.hypot(
            curve[i][0] - curve[i - 1][0],
            curve[i][2] - curve[i - 1][2],
          ),
      );
    const total = run.at(-1),
      phase = drainageHash(salt, 431) * Math.PI * 2,
      phase2 = drainageHash(salt, 433) * Math.PI * 2,
      wave = 210 + drainageHash(salt, 437) * 120;
    const out = curve.map((p, i) => {
      if (i === 0 || i === curve.length - 1) return p.map(quantize);
      const before = curve[Math.max(0, i - 2)],
        after = curve[Math.min(curve.length - 1, i + 2)],
        tx = after[0] - before[0],
        tz = after[2] - before[2],
        length = Math.hypot(tx, tz) || 1,
        grade = Math.max(0, before[1] - after[1]) / length;
      const ends = smooth(0, 140, run[i]) * smooth(0, 140, total - run[i]),
        flat = 1 - smooth(0.04, 0.16, grade),
        s = run[i] / wave;
      const offset =
        (Math.sin(s * Math.PI * 2 + phase) * 11 +
          Math.sin(s * Math.PI * 4.7 + phase2) * 5) *
        ends *
        flat;
      return [
        quantize(p[0] - (tz / length) * offset),
        quantize(p[1]),
        quantize(p[2] + (tx / length) * offset),
      ];
    });
    // Levels never rise downstream.
    for (let i = 1; i < out.length; i++)
      out[i][1] = Math.min(out[i][1], out[i - 1][1]);
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
      points: meanderRiver(points, r),
    });
  }
  // Rivers rise as a spring-fed trickle and widen as their catchment grows.
  for (const river of rivers) {
    const P = river.points;
    let lastWidth = 2,
      run = 0;
    river.widths = P.map(([x, , z], i) => {
      if (i) run += Math.hypot(x - P[i - 1][0], z - P[i - 1][2]);
      const id =
        clamp(Math.round(z / 64), 0, R - 1) * R +
        clamp(Math.round(x / 64), 0, R - 1);
      lastWidth = Math.max(
        lastWidth,
        Math.min(23, 6 + Math.sqrt(catchment[id]) * 0.65),
      );
      // Never narrower than a couple of terrain cells, so the channel and
      // its banks can be resolved on the 2 m height grid.
      const spring = 0.2 + 0.8 * smooth(0, 520, run);
      return quantize(Math.max(2.4, lastWidth * spring));
    });
    river.width = Math.max(...river.widths);
  }
  settleRiverLevels(rivers, sample);
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
        h > (castle ? 230 : 245) ||
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
            Math.abs(sample(x + dx, z + dz) - h) > (castle ? 65 : 32),
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
        // Raw ground is graded to a road afterwards (at most 0.4 along the
        // route). Next to either end a steep climb is allowed at a heavy
        // cost, so a landmark on a headland can get out of its pocket
        // instead of the whole layout being thrown away; elsewhere roads
        // keep to gentler ground.
        const nearEnd =
          Math.max(
            Math.abs((j % R) - (start % R)),
            Math.abs(Math.floor(j / R) - Math.floor(start / R)),
          ) <= 3 ||
          Math.max(
            Math.abs((j % R) - (goal % R)),
            Math.abs(Math.floor(j / R) - Math.floor(goal / R)),
          ) <= 3;
        if (
          slope > (nearEnd ? 0.9 : 0.5) &&
          !bridgeCells.has(id) &&
          !bridgeCells.has(j)
        )
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
  containRivers(heights, GRID, STEP, rivers, lakes);
  keepRiverBedsBelowWater(heights, GRID, STEP, rivers);
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
    shapeBlend: blendWeight ? { family: blendFamily, weight: blendWeight } : null,
    offshoreIslands: offshore.map(({ x, z, extent, kind }) => ({
      kind,
      p: [quantize(x), quantize(z)],
      extent: quantize(extent),
    })),
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

/**
 * Full-resolution grading can still reject a layout (for example a road that
 * grades too steeply). Continue with the next layout attempt rather than
 * failing the seed; the result stays deterministic for the seed.
 */
export function materializeIsland8(plan, report = () => {}) {
  for (;;) {
    try {
      return materializeCandidate8(plan, report);
    } catch (error) {
      if (plan.attempt >= 15) throw error;
      report(`Refining island layout (${plan.attempt + 2}/16)`, 0.02);
      plan = planIsland8(plan.request, report, plan.attempt + 1);
    }
  }
}
function materializeCandidate8(plan, report) {
  const {
    request,
    attempt,
    shapeFamily,
    shapeBlend,
    offshoreIslands,
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
  containRivers(heights, GRID, STEP, rivers, lakes);
  keepRiverBedsBelowWater(heights, GRID, STEP, rivers);
  const riverDistance = pathIndex(
    rivers.map((r) => r.points.map((p) => [p[0], p[2]])),
    128,
    400,
  );
  const waterAt = (x, z) => waterHeight(rivers, lakes, x, z);
  report("Building varied breakable landmarks", 0.5);
  const architecture = createArchitecture(
      { sites, castles },
      sample,
      hash,
      true,
    ),
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
    maxTrees = Math.min(30000, Math.round(PRESETS[plan.ecology].trees * 1.65));
  report("Planting varied forests", 0.65);
  // Continuous, seed-locked patches concentrate the budget into deep groves
  // with scalloped edges and open meadows rather than an even tree carpet.
  const groveNoise = (x, z, scale) => {
    const gx = x / scale,
      gz = z / scale,
      ix = Math.floor(gx),
      iz = Math.floor(gz),
      u = smooth(0, 1, gx - ix),
      v = smooth(0, 1, gz - iz);
    return mix(
      mix(
        vegetationHash(ix + 411, iz + 717),
        vegetationHash(ix + 412, iz + 717),
        u,
      ),
      mix(
        vegetationHash(ix + 411, iz + 718),
        vegetationHash(ix + 412, iz + 718),
        u,
      ),
      v,
    );
  };
  const treeCandidates = [];
  // PS8: open meadows inside the woods, with the odd lone specimen tree.
  const meadowAt = (px, pz) =>
    smooth(0.64, 0.8, groveNoise(px - 2311, pz + 1709, 260));
  // Palm belts line sheltered sea shores; cooler islands (about one in five) grow none.
  const palmClimate = vegetationHash(17, 4401) >= 0.2;
  const nearSea = (px, pz) => {
    for (let k = 0; k < 8; k++) {
      const a = (k * Math.PI) / 4;
      for (const r of [45, 110])
        if (sample(px + Math.cos(a) * r, pz + Math.sin(a) * r) < -1)
          return true;
    }
    return false;
  };
  const addTree = (px, pz, h, species, tall, wide, priority, variant) =>
    treeCandidates.push({
      priority,
      kind: "tree",
      p: [quantize(px), quantize(h + tall / 2), quantize(pz)],
      s: [wide, tall / 2, wide],
      material: "foliage",
      assembly: "",
      foundation: true,
      supports: [],
      variant,
      treeSpecies: species,
    });
  for (let gz = 50; gz < SIZE - 50; gz += 16)
    for (let gx = 50; gx < SIZE - 50; gx += 16)
      // The second, offset candidate only fills dense grove cores and palm belts.
      for (const sub of [0, 1]) {
        const x = gx + sub * 8,
          z = gz + sub * 8;
        const px = x + (vegetationHash(x, z) - 0.5) * 14,
          pz = z + (vegetationHash(x + 5, z + 7) - 0.5) * 14,
          h = sample(px, pz);
        if (h < 2.5 || h > 650) continue;
        // Offshore islands have no regional woodland field; give them their own groves.
        const cluster = onMainland(mainland, px, pz)
            ? regionAt(regions, px, pz).woodland
            : 0.3 + groveNoise(px + 77, pz - 55, 300) * 0.5,
          grove =
            groveNoise(px, pz, 380) * 0.72 +
            groveNoise(px + 931, pz - 713, 110) * 0.28,
          density = smooth(0.36, 0.65, grove);
        const slope =
          Math.hypot(
            sample(px + 8, pz) - sample(px - 8, pz),
            sample(px, pz + 8) - sample(px, pz - 8),
          ) / 16;
        if (
          slope > 0.65 ||
          Math.hypot(px - portalAnchor[0], pz - portalAnchor[2]) < 140 ||
          Number.isFinite(waterAt(px, pz)) ||
          flightDistance(flightCorridors, px, pz) < 145 ||
          sites.some(
            (s) =>
              Math.abs(px - s.p[0]) < s.radius + 42 &&
              Math.abs(pz - s.p[2]) < s.radius + 42,
          ) ||
          Math.hypot(px - spawn[0], pz - spawn[2]) < 150
        )
          continue;
        const rd = riverDistance(px, pz);
        if (rd < 20) continue;
        const age = vegetationHash(x + 8, z + 7),
          variant = vegetationHash(x, z),
          roadDistance = distanceToRoad(px, pz);
        // Coastal palms: low, gentle ground within sight of the sea.
        if (palmClimate && h < 26 && slope < 0.35 && rd > 60) {
          const belt = smooth(
            0.34,
            0.6,
            groveNoise(px + 517, pz - 389, 140) * 0.7 +
              groveNoise(px - 211, pz + 97, 45) * 0.3,
          );
          if (
            belt > (sub ? 0.6 : 0.02) &&
            vegetationHash(x + 3, z) < 0.12 + belt * 0.62 &&
            nearSea(px, pz)
          ) {
            const tall = 24 * (0.8 + age * 0.45),
              wide = 6.4 * (0.82 + age * 0.34);
            if (roadDistance >= wide * 2.6 + 8)
              addTree(
                px,
                pz,
                h,
                "palm",
                tall,
                wide,
                vegetationHash(x + 977, z + 953) * 0.35 + (1 - belt) * 0.45,
                variant,
              );
            continue;
          }
        }
        if (
          h < 5 ||
          cluster < 0.18 ||
          density < 0.04 ||
          (sub && (density < 0.45 || cluster < 0.3)) ||
          roadDistance < 30
        )
          continue;
        const meadow = meadowAt(px, pz),
          specimen = !sub && vegetationHash(x + 29, z + 31) < 0.04,
          // Clearings open in thinner woods; dense grove cores stay closed.
          cleared =
            vegetationHash(x + 11, z + 13) <
            meadow * 0.9 * (1 - smooth(0.55, 0.85, density));
        if (cleared && !specimen) continue;
        if (
          !cleared &&
          vegetationHash(x + 3, z) >
            (0.1 + density * 0.95) *
              (0.46 + cluster * 0.6) *
              (1 - smooth(250, 650, h)) *
              (1 - smooth(0.3, 0.65, slope))
        )
          continue;
        const region = regionAt(regions, px, pz);
        // Sheltered hills carry oak woods, exposed heights conifers, and wet banks
        // weeping trees. Riverside trees thin out gradually away from the water.
        const stand = vegetationHash(Math.floor(px / 160), Math.floor(pz / 160)),
          mixSpecies = stand * 0.72 + vegetationHash(x + 71, z + 93) * 0.28,
          pineShare =
            0.22 + smooth(120, 480, h) * 0.56 + region.exposure * 0.18,
          riverside =
            rd < 45 ||
            region.biome === 3 ||
            vegetationHash(x + 41, z + 43) < 1 - smooth(45, 115, rd),
          species = cleared
            ? "broadleaf"
            : riverside
              ? "riverside"
              : mixSpecies < pineShare
                ? "pine"
                : "broadleaf";
        // Thin grove margins hold younger, shorter trees; cores and lone
        // meadow specimens grow old and broad.
        const edge = 1 - smooth(0.12, 0.6, density),
          ancient = cleared || (age > 0.955 && density > 0.55),
          maturity =
            (0.48 + age * 0.65 + density * 0.24) *
            (1 - edge * 0.22) *
            (sub ? 0.78 : 1) *
            (ancient ? 1.65 : 1),
          tall =
            (species === "pine" ? 42 : species === "riverside" ? 34 : 30) *
            maturity,
          wide =
            (species === "broadleaf" ? 13 : species === "riverside" ? 7 : 8) *
            (0.55 + age * 0.4 + density * 0.3) *
            (1 - edge * 0.15) *
            (ancient ? 1.5 : 1);
        if (roadDistance < wide * 2.6 + 8) continue;
        addTree(
          px,
          pz,
          h,
          species,
          tall,
          wide,
          vegetationHash(x + 977, z + 953) * 0.35 +
            (cleared ? 0.1 : (1 - density) * 0.65),
          variant,
        );
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
    shapeBlend,
    offshoreIslands,
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
  const { landFraction } = validateIsland8(world, heights);
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
export function validateIsland8(world, heights) {
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
