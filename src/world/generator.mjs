import { createMountainLayout, mountainRelief } from "./mountains.mjs";
import { createArchitecture } from "./architecture.mjs";
import { VERTICAL_LIMITS } from "./vertical-limits.mjs";
export const GENERATOR_VERSION = 2;
export const WORLD_VERSION = 8;
export const SIZE = 6144;
export const STEP = 2;
export const GRID = SIZE / STEP + 1;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const mix = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, v) => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const quantize = (v) => Math.round(v * 1024) / 1024;
export function seedCode(seed, revision = GENERATOR_VERSION) {
  return `PS${revision}-${(seed >>> 0).toString(16).padStart(8, "0").toUpperCase()}`;
}
export function parseSeedCode(code) {
  const match = /^PS(\d+)-([\da-f]{8})$/i.exec(code.trim());
  if (!match) throw Error("Enter a seed code such as PS2-0000A301.");
  if (![1, GENERATOR_VERSION].includes(Number(match[1])))
    throw Error("This seed uses an unsupported island generator version.");
  return parseInt(match[2], 16) >>> 0;
}
export function islandLink(code, base) {
  parseSeedCode(code);
  const url = new URL(base);
  url.search = "";
  url.hash = "";
  url.searchParams.set("island", code.toUpperCase());
  return url.href;
}
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
export function generateIsland(seed, report = () => {}) {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff)
    throw Error("Island seed must be an unsigned 32-bit integer.");
  let failure;
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      return generateCandidate(seed, report, attempt);
    } catch (error) {
      failure = error;
      if (attempt < 7)
        report(`Refining island layout (${attempt + 2}/8)`, 0.02);
    }
  }
  throw failure;
}
function generateCandidate(seed, report, attempt) {
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
  const cx = 3072 + (hash(1, 1) - 0.5) * 100,
    cz = 3072 + (hash(1, 2) - 0.5) * 100,
    rotation = hash(2, 2) * Math.PI * 2,
    cos = Math.cos(rotation),
    sin = Math.sin(rotation);
  // Leave a wider ocean margin while scaling mountains and saddles with the coast.
  const islandScale = 0.94;
  const local = (x, z) => [
    ((x - cx) * cos + (z - cz) * sin) / islandScale,
    (-(x - cx) * sin + (z - cz) * cos) / islandScale,
  ];
  // Overlapping lobes give one large island; bays warp its broad silhouette.
  const lobes = [
    [0, 0, 2480, 2550],
    [-650, -180, 2050 + hash(3, 401) * 180, 2050],
    [700, 240, 2100, 2100 + hash(4, 401) * 180],
  ];
  const bays = Array.from({ length: 3 }, (_, i) => ({
    angle: hash(i, 402) * Math.PI * 2,
    depth: 180 + hash(i, 403) * 300,
    width: 0.16 + hash(i, 404) * 0.12,
  }));
  const mountainLayout = createMountainLayout(hash);
  const passes = mountainLayout.passes.map((pass) => ({
    p: [
      quantize(cx + (pass.x * cos - pass.z * sin) * islandScale),
      0,
      quantize(cz + (pass.x * sin + pass.z * cos) * islandScale),
    ],
    radius: 180 * islandScale,
  }));
  const coarseGrid = 385,
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
      let r = Infinity;
      for (const [ox, oz, rx, rz] of lobes)
        r = Math.min(
          r,
          Math.hypot(
            (warpedX - ox) / (rx * 1.08),
            (warpedZ - oz) / (rz * 1.08),
          ),
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
        mountainRelief(mountainLayout, lx, lz) *
        (0.84 +
          0.16 * (1 - Math.abs(2 * noise(wx / 290 + 31, wz / 290 + 37) - 1)));
      const hills =
        12 +
        fbm(wx / 560, wz / 560) * 38 +
        fbm(wx / 230 + 35, wz / 230 + 27) * 15;
      const id = z * coarseGrid + x;
      coarse[id] = mix(-26, hills, inland);
      mountain[id] = relief * inland;
      highestMountain = Math.max(highestMountain, mountain[id]);
    }
  const targetPeak = 730 + hash(5, 411) * 250;
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
  const raw = (x, z) => {
    const gx = clamp(x / 16, 0, 383.9999),
      gz = clamp(z / 16, 0, 383.9999),
      ix = Math.floor(gx),
      iz = Math.floor(gz),
      i = iz * coarseGrid + ix;
    return mix(
      mix(coarse[i], coarse[i + 1], gx - ix),
      mix(coarse[i + coarseGrid], coarse[i + coarseGrid + 1], gx - ix),
      gz - iz,
    );
  };
  const heights = new Float32Array(GRID ** 2);
  for (let z = 0; z < GRID; z++) {
    for (let x = 0; x < GRID; x++) heights[z * GRID + x] = raw(x * 2, z * 2);
    if (z % 768 === 0)
      report("Sampling island terrain", 0.04 + (0.14 * z) / GRID);
  }
  const sample = (x, z) => sampleHeight(heights, x, z);
  // Priority-flood drainage supplies a deterministic route from every ridge to sea.
  const R = 97,
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
  const rivers = [],
    used = new Set(),
    riverCount = 2 + Math.floor(hash(3, 3) * 3);
  for (let r = 0; r < riverCount; r++) {
    let source = -1,
      best = -Infinity;
    for (let a = 0; a < 1200; a++) {
      const x = 5 + Math.floor(hash(r * 1900 + a, 81) * 87),
        z = 5 + Math.floor(hash(r * 1900 + a, 82) * 87),
        h = raw(x * 64, z * 64);
      if (
        h < 250 ||
        rivers.some(
          (v) =>
            Math.hypot(x * 64 - v.points[0][0], z * 64 - v.points[0][2]) < 650,
        )
      )
        continue;
      const score =
        h * 0.35 +
        Math.min(90, catchment[z * R + x]) * 5 +
        hash(a, r + 91) * 40;
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
      width: 12 + hash(r, 99) * 6,
      points: roundRiver(points),
    });
  }
  report("Carving rivers and cascades", 0.2);
  const eachRect = (x0, z0, x1, z1, fn) => {
    for (
      let z = Math.max(0, Math.floor(z0 / 2));
      z <= Math.min(GRID - 1, Math.ceil(z1 / 2));
      z++
    )
      for (
        let x = Math.max(0, Math.floor(x0 / 2));
        x <= Math.min(GRID - 1, Math.ceil(x1 / 2));
        x++
      )
        fn(x * 2, z * 2, z * GRID + x);
  };
  for (const river of rivers)
    for (let p = 1; p < river.points.length; p++) {
      const a = river.points[p - 1],
        b = river.points[p],
        dx = b[0] - a[0],
        dz = b[2] - a[2],
        l = dx * dx + dz * dz,
        w = river.width;
      if (!l) continue;
      eachRect(
        Math.min(a[0], b[0]) - w - 24,
        Math.min(a[2], b[2]) - w - 24,
        Math.max(a[0], b[0]) + w + 24,
        Math.max(a[2], b[2]) + w + 24,
        (x, z, i) => {
          const t = clamp(((x - a[0]) * dx + (z - a[2]) * dz) / l, 0, 1),
            d = Math.hypot(x - a[0] - t * dx, z - a[2] - t * dz),
            water = mix(a[1], b[1], t),
            bed = water - 3 + (0.4 * d) / w;
          if (d < w + 24)
            heights[i] = Math.min(
              heights[i],
              mix(bed, heights[i], smooth(w, w + 24, d)),
            );
        },
      );
    }
  const riverDistance = pathIndex(
    rivers.map((r) => r.points.map((p) => [p[0], p[2]])),
    128,
    400,
  );
  // Use the same nearest heightfield sample as RiverField when sizing decks.
  const waterAt = (x, z) => {
    x = Math.round(x / STEP) * STEP;
    z = Math.round(z / STEP) * STEP;
    let height = -Infinity;
    for (const river of rivers)
      for (let i = 1; i < river.points.length; i++) {
        const a = river.points[i - 1],
          b = river.points[i],
          dx = b[0] - a[0],
          dz = b[2] - a[2],
          length = dx * dx + dz * dz;
        if (!length) continue;
        const t = clamp(((x - a[0]) * dx + (z - a[2]) * dz) / length, 0, 1);
        if (Math.hypot(x - a[0] - dx * t, z - a[2] - dz * t) <= river.width)
          height = Math.max(height, mix(a[1], b[1], t));
      }
    return height;
  };
  validateConnectedLand(heights);
  const sites = [],
    castles = [];
  const site = (kind, x, z, radius, extra = {}) => {
    const id =
      kind === "castle"
        ? "castle"
        : `${kind}-${sites.filter((s) => s.kind === kind).length + 1}`;
    const s = {
      id,
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
  const occupied = (x, z, radius) =>
    sites.some(
      (s) => Math.hypot(x - s.p[0], z - s.p[2]) < radius + s.radius + 100,
    );
  function inlandSite(kind, radius, number, castle = false) {
    for (let a = 0; a < 6000; a++) {
      const x = 400 + hash(a + number * 9101, 101) * (SIZE - 800),
        z = 400 + hash(a + number * 9101, 102) * (SIZE - 800),
        h = sample(x, z);
      if (
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
      return site(kind, x, z, radius);
    }
    throw Error(`Could not place ${kind} on safe land. Try another seed.`);
  }
  report("Placing fortresses and settlements", 0.27);
  for (let k = 0; k < 3; k++) {
    const grand = k === 0,
      s = inlandSite(
        grand ? "castle" : "small-castle",
        grand ? 335 : 205,
        100 + k,
        true,
      ),
      turn = Math.floor(hash(k, 200) * 4);
    const halfX = 108 + Math.floor(hash(k, 201) * 20),
      halfZ = 122 + Math.floor(hash(k, 202) * 20),
      scaleX = (grand ? 2 : 1.15) * (0.96 + hash(k, 203) * 0.08),
      scaleZ = (grand ? 2 : 1.1) * (0.96 + hash(k, 204) * 0.08);
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
      scaleY: grand ? 1.55 : 0.78 + hash(k, 205) * 0.15,
    });
  }
  let serial = 0;
  for (const [kind, count, radius] of [
    ["hamlet", 12, 65],
    ["farm", 7, 52],
    ["windmill", 5, 24],
    ["watchtower", 4, 20],
    ["logging", 2, 36],
    ["quarry", 1, 52],
  ])
    for (let i = 0; i < count; i++) inlandSite(kind, radius, serial++);
  function coastalSite(kind, number) {
    let best;
    for (let a = 0; a < 18000; a++) {
      const x = 220 + hash(a + number * 19001, 211) * (SIZE - 440),
        z = 220 + hash(a + number * 19001, 212) * (SIZE - 440),
        h = sample(x, z),
        radius = kind === "harbor" ? 52 : 24;
      if (
        h < 3 ||
        h > (kind === "harbor" ? 8 : 65) ||
        occupied(x, z, radius) ||
        riverDistance(x, z) < radius + 70
      )
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
    for (let k = 0; k < 2; k++) coastalSite(kind, k + serial++);
  // Cardinal structures can cross oblique reaches using measured bank spans.
  function riverSite(kind, index) {
    for (let a = 0; a < 4000; a++) {
      const river = rivers[(index + a) % rivers.length],
        n = river.points.length;
      if (n < 8) continue;
      const j = 2 + Math.floor(hash(a + index * 117, 220) * (n - 5)),
        p = river.points[j],
        prev = river.points[j - 1],
        axis = Math.abs(p[2] - prev[2]) >= Math.abs(p[0] - prev[0]) ? 0 : 1;
      const x = (p[0] + prev[0]) / 2,
        z = (p[2] + prev[2]) / 2,
        water = (p[1] + prev[1]) / 2;
      if (Math.hypot(p[0] - prev[0], p[2] - prev[2]) < 5) continue;
      if (water < 3 || water > 140) continue;
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
    throw Error(`Could not place ${kind} beside a river. Try another seed.`);
  }
  for (let k = 0; k < 2; k++) riverSite("watermill", k);
  for (let k = 0; k < 5; k++) riverSite(k === 0 ? "bridge" : "crossing", k);
  // Blend stable site terraces into the landscape without damming river channels.
  for (const s of sites) {
    if (s.kind === "crossing" || s.kind === "bridge") continue;
    const [x, y, z] = s.p,
      castle = castles.find((c) => c.id === s.id);
    const hx = castle ? (s.bounds.max[0] - s.bounds.min[0]) / 2 : s.radius,
      hz = castle ? (s.bounds.max[1] - s.bounds.min[1]) / 2 : s.radius;
    const edgeRelief = Math.max(
      ...[
        [-hx, -hz],
        [hx, -hz],
        [-hx, hz],
        [hx, hz],
      ].map(([dx, dz]) => Math.abs(sample(x + dx, z + dz) - y)),
    );
    const blend = clamp(30 + edgeRelief * 2, 30, 100);
    eachRect(
      x - hx - blend,
      z - hz - blend,
      x + hx + blend,
      z + hz + blend,
      (wx, wz, i) => {
        if (
          sample(wx, wz) < 1 ||
          riverDistance(wx, wz) < Math.max(...rivers.map((r) => r.width)) + 3 ||
          sites.some(
            (other) =>
              other !== s &&
              wx >= other.bounds.min[0] &&
              wx <= other.bounds.max[0] &&
              wz >= other.bounds.min[1] &&
              wz <= other.bounds.max[1],
          )
        )
          return;
        const d = Math.max(Math.abs(wx - x) - hx, Math.abs(wz - z) - hz);
        heights[i] = mix(y, heights[i], smooth(0, blend, d));
      },
    );
  }
  report("Routing roads and building bridges", 0.38);
  let paths = [];
  const roadConnections = [],
    roadH = new Float32Array(N),
    wet = new Uint8Array(N),
    bridgeCells = new Set(),
    bridgeRoadPoints = new Map();
  for (let id = 0; id < N; id++) {
    roadH[id] = sample((id % R) * 64, Math.floor(id / R) * 64);
    wet[id] = roadH[id] < 3 ? 1 : 0;
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
        wet[zz * R + xx] = 0;
        bridgeRoadPoints.set(zz * R + xx, [
          s.p[0] + (s.axis === 0 ? d * 64 : 0),
          s.p[2] + (s.axis === 1 ? d * 64 : 0),
        ]);
        if (Math.abs(d) <= 1) roadH[zz * R + xx] = s.deck;
      }
    }
  }
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
        const d = Math.hypot(x * 64 - point[0], z * 64 - point[1]);
        if (d < dist) {
          best = id;
          dist = d;
        }
      }
    return best;
  };
  const network = [sites[0]];
  for (const s of sites.slice(1)) {
    const target = network.reduce((a, b) =>
      Math.hypot(a.p[0] - s.p[0], a.p[2] - s.p[2]) <
      Math.hypot(b.p[0] - s.p[0], b.p[2] - s.p[2])
        ? a
        : b,
    );
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
      for (const j of roadNeighbors(id)) {
        if (wet[j]) continue;
        const slope = Math.abs(roadH[id] - roadH[j]) / 64;
        if (slope > 0.5 && !bridgeCells.has(id) && !bridgeCells.has(j))
          continue;
        const v =
          c +
          64 *
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
    if (!Number.isFinite(cost[goal]))
      throw Error(
        "Could not connect every settlement by road. Try another seed.",
      );
    const nodes = [];
    for (let id = goal; id >= 0; id = from[id]) {
      nodes.push(
        bridgeRoadPoints.get(id) ?? [(id % R) * 64, Math.floor(id / R) * 64],
      );
      if (id === start) break;
    }
    nodes.reverse();
    const entrance = roadEndpoints.get(s.id),
      exit = roadEndpoints.get(target.id);
    paths.push([
      ...(entrance ? [entrance.gate, entrance.approach] : [[s.p[0], s.p[2]]]),
      ...nodes,
      ...(exit ? [exit.approach, exit.gate] : [[target.p[0], target.p[2]]]),
    ]);
    roadConnections.push([s.id, target.id]);
    network.push(s);
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
    return out;
  });
  const bridges = sites.filter(
    (s) => s.kind === "bridge" || s.kind === "crossing",
  );
  const roadHeight = (p) => {
    const s = bridges.find(
      (s) =>
        Math.abs(s.axis === 0 ? p[1] - s.p[2] : p[0] - s.p[0]) < 8 &&
        Math.abs(s.axis === 0 ? p[0] - s.p[0] : p[1] - s.p[2]) <
          s.span / 2 + 20,
    );
    return s ? s.deck : sample(p[0], p[1]);
  };
  // Road edge blending follows connected route elevations; leave channels open under bridges.
  for (const path of paths)
    for (let j = 1; j < path.length; j++) {
      const a = path[j - 1],
        b = path[j],
        ha = roadHeight(a),
        hb = roadHeight(b),
        dx = b[0] - a[0],
        dz = b[1] - a[1],
        length = dx * dx + dz * dz;
      if (!length) continue;
      eachRect(
        Math.min(a[0], b[0]) - 9,
        Math.min(a[1], b[1]) - 9,
        Math.max(a[0], b[0]) + 9,
        Math.max(a[1], b[1]) + 9,
        (x, z, i) => {
          if (riverDistance(x, z) < 24) return;
          const t = clamp(((x - a[0]) * dx + (z - a[1]) * dz) / length, 0, 1),
            d = Math.hypot(x - a[0] - t * dx, z - a[1] - t * dz);
          if (d < 9)
            heights[i] = mix(mix(ha, hb, t), heights[i], smooth(3, 9, d));
        },
      );
    }
  // Grade dry-bank ramps up to each deck, leaving the channel untouched underneath.
  for (const s of bridges)
    eachRect(
      s.p[0] - s.span / 2 - 25,
      s.p[2] - s.span / 2 - 25,
      s.p[0] + s.span / 2 + 25,
      s.p[2] + s.span / 2 + 25,
      (x, z, i) => {
        if (riverDistance(x, z) < 24) return;
        const along = Math.abs(s.axis === 0 ? x - s.p[0] : z - s.p[2]),
          across = Math.abs(s.axis === 0 ? z - s.p[2] : x - s.p[0]);
        const weight =
          (1 - smooth(s.span / 2, s.span / 2 + 25, along)) *
          (1 - smooth(5, 12, across));
        if (weight > 0) heights[i] = mix(heights[i], s.deck, weight);
      },
    );
  // Reapply exact site pads after grading approach roads.
  for (const s of sites)
    if (!["crossing", "bridge", "watermill"].includes(s.kind)) {
      const c = castles.find((c) => c.id === s.id),
        hx = c ? (s.bounds.max[0] - s.bounds.min[0]) / 2 : s.radius,
        hz = c ? (s.bounds.max[1] - s.bounds.min[1]) / 2 : s.radius;
      eachRect(
        s.p[0] - hx,
        s.p[2] - hz,
        s.p[0] + hx,
        s.p[2] + hz,
        (x, z, i) => {
          if (Math.abs(x - s.p[0]) <= hx && Math.abs(z - s.p[2]) <= hz)
            heights[i] = s.p[1];
        },
      );
    }
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
  report("Building breakable castles and coastal landmarks", 0.5);
  const architecture = createArchitecture({ sites, castles }, sample, hash),
    { entities, homes } = architecture;
  for (const c of castles) {
    const s = sites.find((s) => s.id === c.id);
    s.assemblies = c.assemblies;
  }
  const distanceToRoad = pathIndex(paths),
    maxTrees = 14000;
  report("Planting varied forests", 0.65);
  const treeCandidates = [];
  for (let z = 50; z < SIZE - 50; z += 30)
    for (let x = 50; x < SIZE - 50; x += 30) {
      const px = x + (hash(x, z) - 0.5) * 19,
        pz = z + (hash(x + 5, z + 7) - 0.5) * 19,
        h = sample(px, pz),
        cluster = fbm(px / 240 + 33, pz / 240 + 71);
      const slope =
        Math.hypot(
          sample(px + 8, pz) - sample(px - 8, pz),
          sample(px, pz + 8) - sample(px, pz - 8),
        ) / 16;
      if (
        h < 5 ||
        h > 650 ||
        slope > 0.65 ||
        cluster < 0.38 ||
        hash(x + 3, z) >
          0.78 * (1 - smooth(250, 650, h)) * (1 - smooth(0.3, 0.65, slope)) ||
        distanceToRoad(px, pz) < 11 ||
        sites.some(
          (s) =>
            Math.abs(px - s.p[0]) < s.radius + 16 &&
            Math.abs(pz - s.p[2]) < s.radius + 16,
        ) ||
        Math.hypot(px - spawn[0], pz - spawn[2]) < 90
      )
        continue;
      const rd = riverDistance(px, pz);
      if (rd < 20) continue;
      const species =
        rd < 110
          ? "riverside"
          : h > 115 || hash(Math.floor(px / 320), Math.floor(pz / 320)) > 0.57
            ? "pine"
            : "broadleaf";
      const tall =
          (species === "pine" ? 18 : species === "riverside" ? 15 : 12) +
          hash(x + 8, z + 7) * 12,
        wide =
          species === "broadleaf"
            ? 5 + hash(x, z + 2) * 3
            : species === "riverside"
              ? 3
              : 3.5;
      treeCandidates.push({
        priority: hash(x + 977, z + 953),
        kind: "tree",
        p: [quantize(px), quantize(h + tall / 2), quantize(pz)],
        s: [wide, tall / 2, wide],
        material: "foliage",
        assembly: "",
        foundation: true,
        supports: [],
        variant: hash(x, z),
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
  for (let i = 0; i < 510; i++) {
    const x = 200 + hash(i, 301) * (SIZE - 400),
      z = 200 + hash(i, 302) * (SIZE - 400),
      h = sample(x, z);
    if (
      h < 3 ||
      distanceToRoad(x, z) < 9 ||
      sites.some((s) => Math.hypot(x - s.p[0], z - s.p[2]) < s.radius + 15) ||
      Math.hypot(x - spawn[0], z - spawn[2]) < 90
    )
      continue;
    const size = 2 + hash(i, 303) * 4;
    entities.push({
      id: entities.length,
      kind: "rock",
      p: [x, h + size * 0.6, z],
      s: [size, size * 0.6, size],
      material: "rock",
      assembly: "",
      foundation: true,
      supports: [],
      variant: hash(i, 304),
    });
  }
  report("Finding safe homes and flight approaches", 0.88);
  const civilians = [],
    blocks = entities.filter((e) => e.kind === "block");
  function civilian(home, settlement, x, z) {
    for (let a = 0; a < 600; a++) {
      const dx = a === 0 ? 0 : ((a % 15) - 7) * 3,
        dz = a === 0 ? 0 : (Math.floor(a / 15) - 10) * 3,
        px = x + dx,
        pz = z + dz,
        h = sample(px, pz);
      if (
        h < 1 ||
        riverDistance(px, pz) < 24 ||
        blocks.some(
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
    seed,
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
  const { landFraction } = validateIsland(world, heights);
  // Newly generated islands use the smaller footprint; older stored PS2 baselines
  // retain their original coastlines and remain valid when reloaded.
  if (landFraction < 0.53 || landFraction > 0.62)
    throw Error("Island footprint failed generation validation.");
  report("Island ready", 1);
  return { world, heights };
}
function validateConnectedLand(heights) {
  // Flood-fill a coarse land mask before accepting content on disconnected land.
  const side = 193,
    mask = new Uint8Array(side * side),
    queue = [];
  for (let z = 0; z < side; z++)
    for (let x = 0; x < side; x++)
      mask[z * side + x] = sampleHeight(heights, x * 32, z * 32) > 0 ? 1 : 0;
  const start = mask.indexOf(1);
  if (start >= 0) {
    mask[start] = 2;
    queue.push(start);
  }
  for (let h = 0; h < queue.length; h++) {
    const id = queue[h],
      x = id % side,
      z = Math.floor(id / side);
    for (const [dx, dz] of [
      [-1, 0],
      [1, 0],
      [0, -1],
      [0, 1],
    ]) {
      const nx = x + dx,
        nz = z + dz,
        next = nz * side + nx;
      if (nx >= 0 && nx < side && nz >= 0 && nz < side && mask[next] === 1) {
        mask[next] = 2;
        queue.push(next);
      }
    }
  }
  if (mask.includes(1)) throw Error("Island land must be connected.");
}

export function validateIsland(world, heights) {
  if (
    heights.length !== GRID ** 2 ||
    world.version !== WORLD_VERSION ||
    ![1, GENERATOR_VERSION].includes(world.generatorVersion)
  )
    throw Error("Island baseline is incomplete.");
  if (
    world.castles.length !== 3 ||
    world.civilians.length !== 664 ||
    world.structureCount > 16000
  )
    throw Error("Island content failed validation.");
  let peak = -Infinity,
    land = 0;
  for (let i = 0; i < heights.length; i++) {
    const h = heights[i];
    if (
      !Number.isFinite(h) ||
      h > (world.generatorVersion === 1 ? 390 : VERTICAL_LIMITS.maxPeak) ||
      h < -100
    )
      throw Error("Island terrain is invalid.");
    peak = Math.max(peak, h);
    if (h > 0) land++;
  }
  if (
    land / heights.length < (world.generatorVersion === 1 ? 0.57 : 0.53) ||
    land / heights.length > 0.72 ||
    peak < (world.generatorVersion === 1 ? 250 : VERTICAL_LIMITS.minPeak) ||
    peak > (world.generatorVersion === 1 ? 350 : VERTICAL_LIMITS.maxPeak)
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
  if (world.generatorVersion === GENERATOR_VERSION) {
    validateConnectedLand(heights);
    if (
      !world.passes ||
      world.passes.length < 2 ||
      world.passes.some(
        (pass) =>
          !Number.isFinite(pass.p[1]) ||
          pass.p[1] <= 0 ||
          pass.p[1] >= VERTICAL_LIMITS.passHeight,
      )
    )
      throw Error("Mountain passes lack safe saddle clearance.");
  }
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
  if (world.sites.some((s) => !reached.has(s.id)))
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
  return { landFraction: land / heights.length, peak };
}
