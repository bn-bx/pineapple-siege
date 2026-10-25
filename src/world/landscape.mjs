import { pointInLake } from "./water-geometry.mjs";
/** PS5 planning fields. All grids are compact and all randomness is stage-local. */
export const PRESETS = Object.freeze({
  B: {
    name: "Balanced Kingdom",
    profile: undefined,
    rivers: 4,
    lakes: 1,
    forest: 0.85,
    trees: 16000,
    settlements: 1,
  },
  H: {
    name: "Highland Coast",
    profile: "mountainous",
    rivers: 4,
    lakes: 1,
    forest: 0.55,
    trees: 10000,
    settlements: 0.9,
  },
  R: {
    name: "Riverlands",
    profile: "broad lowland",
    rivers: 5,
    lakes: 2,
    forest: 0.7,
    trees: 14000,
    settlements: 1.1,
  },
  W: {
    name: "Woodland Realm",
    profile: "rolling woodland",
    rivers: 4,
    lakes: 1,
    forest: 1.5,
    trees: 30000,
    settlements: 0.95,
  },
});
export const REGION_NAMES = [
  "ocean",
  "woodland",
  "pasture",
  "wetland",
  "highland",
];
export const COAST_NAMES = [
  "inland",
  "beach",
  "headland",
  "cove",
  "shelf",
  "estuary",
];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export function fieldSample(field, grid, step, x, z) {
  const gx = clamp(x / step, 0, grid - 1.00001),
    gz = clamp(z / step, 0, grid - 1.00001),
    ix = Math.floor(gx),
    iz = Math.floor(gz),
    u = gx - ix,
    v = gz - iz,
    i = iz * grid + ix;
  const a = field[i],
    b = field[i + 1],
    c = field[i + grid],
    d = field[i + grid + 1];
  return u + v <= 1
    ? a + (b - a) * u + (c - a) * v
    : d + (c - d) * (1 - u) + (b - d) * (1 - v);
}
/** Coast families define the mainland itself, rather than nudging a shared round outline. */
export function shapeRadius(
  family,
  x,
  z,
  { phase = 0, breadth = 0.5, bend = 0.5 } = {},
) {
  const angle = Math.atan2(z, x),
    distance = Math.hypot(x, z);
  if (family === "elongated") {
    // A long, bent spine with broad shoulders and markedly narrower ends.
    const center = Math.sin(x / 1500 + phase) * (160 + bend * 230);
    return (
      Math.hypot(
        x / (2820 + breadth * 230),
        (z - center) / (1750 + breadth * 470),
      ) /
      (1 + 0.055 * Math.cos(angle * 5 + phase))
    );
  }
  if (family === "peninsulas") {
    const boundary =
      2420 *
      (1 +
        0.27 * Math.cos(angle * 3 + phase) +
        0.075 * Math.sin(angle * 5 - phase));
    return distance / boundary;
  }
  if (family === "horseshoe") {
    const outer = Math.hypot(x / (2740 + breadth * 100), z / 2640),
      mouthX = (bend - 0.5) * 600,
      bay = Math.hypot(
        (x - mouthX) / (1000 + breadth * 250),
        (z + 2480) / (1930 + bend * 150),
      );
    return Math.max(outer, 2 - bay);
  }
  if (family === "crescent") {
    const outer = Math.hypot(x / 2780, z / 2740),
      cut = Math.hypot(
        (x - 2530) / (1980 + breadth * 250),
        (z - (bend - 0.5) * 500) / 1900,
      );
    return Math.max(outer, 2 - cut);
  }
  if (family === "hammerhead") {
    return Math.min(
      Math.hypot(x / (1740 + breadth * 280), z / 2810),
      Math.hypot(x / 3020, (z - 980) / (1560 + bend * 230)),
    );
  }
  const boundary =
    2600 *
    (1 +
      0.105 * Math.cos(angle * 2 + phase) +
      0.085 * Math.sin(angle * 3 - phase) +
      0.045 * Math.cos(angle * 7 + phase));
  return distance / boundary;
}
/** Four bounded incision/thermal passes retain summits and lowland buildable area. */
export function erodeTerrain(field, grid, step) {
  const flow = new Float32Array(field.length),
    delta = new Float32Array(field.length);
  for (let pass = 0; pass < 4; pass++) {
    flow.fill(1);
    delta.fill(0);
    const order = [];
    for (let i = grid + 1; i < field.length - grid - 1; i++)
      if (field[i] > 75) order.push(i);
    order.sort((a, b) => field[b] - field[a]);
    for (const i of order) {
      let next = i;
      for (const offset of [
        -grid - 1,
        -grid,
        -grid + 1,
        -1,
        1,
        grid - 1,
        grid,
        grid + 1,
      ])
        if (field[i + offset] < field[next]) next = i + offset;
      if (next === i) continue;
      flow[next] += flow[i];
      const slope = (field[i] - field[next]) / step;
      const incision = Math.min(1.7, Math.sqrt(flow[i]) * slope * 0.025);
      delta[i] -= incision;
      delta[next] += incision * 0.25;
      const loose = Math.max(0, field[i] - field[next] - step * 1.15) * 0.035;
      delta[i] -= loose;
      delta[next] += loose;
    }
    for (const i of order) field[i] = Math.fround(field[i] + delta[i]);
  }
}
export function flightDistance(corridors, x, z) {
  let best = Infinity;
  for (const corridor of corridors ?? [])
    for (let i = 1; i < corridor.points.length; i++) {
      const a = corridor.points[i - 1],
        b = corridor.points[i],
        dx = b[0] - a[0],
        dz = b[2] - a[2],
        l = dx * dx + dz * dz;
      const t = clamp(((x - a[0]) * dx + (z - a[2]) * dz) / l, 0, 1);
      best = Math.min(best, Math.hypot(x - a[0] - dx * t, z - a[2] - dz * t));
    }
  return best;
}
export function createFlightCorridors(field, grid, size, hash) {
  const step = size / (grid - 1),
    corridors = [],
    angle = hash(0, 204) * Math.PI,
    cos = Math.cos(angle),
    sin = Math.sin(angle);
  for (let k = 0; k < 2; k++) {
    const points = [];
    for (let j = 0; j <= 24; j++) {
      const along = -3456 + j * 288,
        across =
          (k ? 1 : -1) * (800 + hash(k, 205) * 350) +
          Math.sin((j / 24) * Math.PI * 2 + hash(k, 203) * 2) * 310;
      points.push([
        size / 2 + along * cos - across * sin,
        380,
        size / 2 + along * sin + across * cos,
      ]);
    }
    corridors.push({
      id: `valley-${k + 1}`,
      width: 200,
      clearance: 100,
      points,
    });
  }
  // Broad, smooth valleys avoid forced narrow slots or abrupt terrain steps.
  for (let z = 0; z < grid; z++)
    for (let x = 0; x < grid; x++) {
      const i = z * grid + x;
      if (field[i] < 220) continue;
      const distance = flightDistance(corridors, x * step, z * step);
      if (distance < 420) {
        const t = clamp((distance - 200) / 220, 0, 1),
          weight = t * t * (3 - 2 * t);
        field[i] = Math.min(field[i], 260 + (field[i] - 260) * weight);
      }
    }
  return corridors;
}
export function mainlandMask(heights, grid, step) {
  const mask = new Uint8Array(heights.length),
    queue = new Int32Array(heights.length);
  let largest = [];
  for (let start = 0; start < heights.length; start++) {
    if (heights[start] <= 0 || mask[start]) continue;
    let head = 0,
      tail = 1;
    queue[0] = start;
    mask[start] = 1;
    while (head < tail) {
      const i = queue[head++],
        x = i % grid;
      for (const j of [
        x ? i - 1 : -1,
        x < grid - 1 ? i + 1 : -1,
        i >= grid ? i - grid : -1,
        i < heights.length - grid ? i + grid : -1,
      ]) {
        if (j >= 0 && heights[j] > 0 && !mask[j]) {
          mask[j] = 1;
          queue[tail++] = j;
        }
      }
    }
    if (tail > largest.length) largest = Array.from(queue.subarray(0, tail));
  }
  mask.fill(0);
  for (const i of largest) mask[i] = 1;
  return { grid, step, cells: mask };
}
export function onMainland(mainland, x, z) {
  const { grid, step, cells } = mainland;
  if (x < 0 || z < 0 || x > (grid - 1) * step || z > (grid - 1) * step)
    return false;
  return !!cells[Math.round(z / step) * grid + Math.round(x / step)];
}
export function buildRegions(
  heights,
  grid,
  step,
  rivers,
  lakes,
  preset,
  hash,
  mainland,
) {
  const moisture = new Uint8Array(heights.length),
    exposure = new Uint8Array(heights.length),
    woodland = new Uint8Array(heights.length),
    biome = new Uint8Array(heights.length),
    coast = new Uint8Array(heights.length);
  // Moisture seeds diffuse on a 64 m grid, keeping regional work bounded.
  const waterSeeds = new Uint8Array(heights.length);
  for (const r of rivers)
    for (const [x, , z] of r.points)
      waterSeeds[
        clamp(Math.round(z / step), 0, grid - 1) * grid +
          clamp(Math.round(x / step), 0, grid - 1)
      ] = 255;
  for (const l of lakes)
    waterSeeds[
      Math.round(l.center[1] / step) * grid + Math.round(l.center[0] / step)
    ] = 255;
  const distance = new Uint16Array(heights.length).fill(65535);
  for (let i = 0; i < distance.length; i++) if (waterSeeds[i]) distance[i] = 0;
  for (let i = 0; i < distance.length; i++) {
    if (i % grid) distance[i] = Math.min(distance[i], distance[i - 1] + 1);
    if (i >= grid) distance[i] = Math.min(distance[i], distance[i - grid] + 1);
  }
  for (let i = distance.length - 1; i >= 0; i--) {
    if (i % grid < grid - 1)
      distance[i] = Math.min(distance[i], distance[i + 1] + 1);
    if (i < distance.length - grid)
      distance[i] = Math.min(distance[i], distance[i + grid] + 1);
  }
  for (let z = 0; z < grid; z++)
    for (let x = 0; x < grid; x++) {
      const i = z * grid + x,
        h = heights[i],
        slope =
          Math.hypot(
            (heights[i + 1] ?? h) - (heights[i - 1] ?? h),
            (heights[i + grid] ?? h) - (heights[i - grid] ?? h),
          ) /
          (2 * step);
      const wet = clamp(
        0.36 +
          0.46 * Math.exp((-distance[i] * step) / 200) +
          hash(Math.floor(x / 20), Math.floor(z / 20)) * 0.22 -
          h / 3000,
        0,
        1,
      );
      const exposed = clamp(
        slope * 0.45 + h / 1300 + 0.12 * Math.sin(x / 40),
        0,
        1,
      );
      const fx = x / 65,
        fz = z / 65,
        ix = Math.floor(fx),
        iz = Math.floor(fz),
        u = (fx - ix) ** 2 * (3 - 2 * (fx - ix)),
        v = (fz - iz) ** 2 * (3 - 2 * (fz - iz)),
        a = hash(ix + 311, iz),
        b = hash(ix + 312, iz),
        c = hash(ix + 311, iz + 1),
        d = hash(ix + 312, iz + 1),
        patch = (a + (b - a) * u) * (1 - v) + (c + (d - c) * u) * v;
      const forest = clamp(
        PRESETS[preset].forest *
          (0.12 + wet * 0.7 + patch * 0.65 - exposed * 0.3) -
          0.14,
        0,
        1,
      );
      moisture[i] = Math.round(wet * 255);
      exposure[i] = Math.round(exposed * 255);
      woodland[i] = Math.round(forest * 255);
      biome[i] =
        h <= 0
          ? 0
          : h > 450 || slope > 0.8
            ? 4
            : wet > 0.72 && h < 180
              ? 3
              : forest > 0.54
                ? 1
                : 2;
      coast[i] =
        h < -8
          ? 0
          : h < 0
            ? 4
            : h < 35
              ? distance[i] * step < 80
                ? 5
                : slope > 0.6
                  ? 2
                  : exposed < 0.15
                    ? 3
                    : 1
              : slope > 0.9 && h < 130
                ? 2
                : 0;
      if (!onMainland(mainland, x * step, z * step) && h > 0) woodland[i] = 0;
    }
  return { grid, step, moisture, exposure, woodland, biome, coast };
}
export function regionAt(regions, x, z) {
  if (!regions)
    return { moisture: 0.5, exposure: 0.3, woodland: 0.5, biome: 2, coast: 0 };
  const { grid, step } = regions,
    gx = clamp(x / step, 0, grid - 1),
    gz = clamp(z / step, 0, grid - 1),
    i = Math.round(gz) * grid + Math.round(gx);
  return {
    moisture: fieldSample(regions.moisture, grid, step, x, z) / 255,
    exposure: fieldSample(regions.exposure, grid, step, x, z) / 255,
    woodland: fieldSample(regions.woodland, grid, step, x, z) / 255,
    biome: regions.biome[i],
    coast: regions.coast[i],
  };
}
export function makeLakes(rivers, sample, hash, count) {
  const lakes = [];
  for (const river of rivers) {
    for (
      let i = Math.floor(river.points.length * 0.5);
      i < river.points.length - 3;
      i += 3
    ) {
      const p = river.points[i],
        next = river.points[i + 1],
        radius = 55 + hash(i, 411) * 30;
      if (
        p[1] < 12 ||
        p[1] > 180 ||
        p[1] - next[1] > 4 ||
        lakes.some(
          (l) => Math.hypot(l.center[0] - p[0], l.center[1] - p[2]) < 400,
        )
      )
        continue;
      if (
        [
          [-1, 0],
          [1, 0],
          [0, -1],
          [0, 1],
        ].some(
          ([dx, dz]) =>
            sample(p[0] + dx * (radius + 28), p[2] + dz * (radius + 28)) <
            p[1] - 0.5,
        )
      )
        continue;
      const outline = Array.from({ length: 24 }, (_, k) => {
        const a = (k / 24) * Math.PI * 2,
          r = radius * (0.9 + hash(i, k) * 0.1);
        return [p[0] + Math.cos(a) * r, p[2] + Math.sin(a) * r];
      });
      // Flatten the connected reach through the basin; the downstream edge remains its outlet.
      let end = i;
      while (
        end < river.points.length - 1 &&
        Math.hypot(river.points[end][0] - p[0], river.points[end][2] - p[2]) <
          radius
      ) {
        river.points[end][1] = p[1];
        end++;
      }
      lakes.push({
        id: `lake-${lakes.length + 1}`,
        center: [p[0], p[2]],
        radius,
        level: p[1],
        outline,
        outlet: [...river.points[Math.max(i, end - 1)]],
        riverId: river.id,
      });
      if (lakes.length >= count) return finishLakes(lakes, rivers);
      break;
    }
  }
  return finishLakes(lakes, rivers);
}
function finishLakes(lakes, rivers) {
  for (const lake of lakes) {
    for (const river of rivers)
      for (const p of river.points)
        if (pointInLake(lake, p[0], p[2])) p[1] = lake.level;
    const river = rivers.find((r) => r.id === lake.riverId);
    const center = river.points.findIndex(
      (p) => p[0] === lake.center[0] && p[2] === lake.center[1],
    );
    let end = center + 1;
    while (
      end < river.points.length &&
      pointInLake(lake, river.points[end][0], river.points[end][2])
    )
      end++;
    if (end < river.points.length) {
      const a = river.points[end - 1],
        b = river.points[end];
      let low = 0,
        high = 1;
      for (let k = 0; k < 24; k++) {
        const t = (low + high) / 2;
        if (
          pointInLake(lake, a[0] + (b[0] - a[0]) * t, a[2] + (b[2] - a[2]) * t)
        )
          low = t;
        else high = t;
      }
      const t = (low + high) / 2,
        p = [a[0] + (b[0] - a[0]) * t, lake.level, a[2] + (b[2] - a[2]) * t];
      lake.outlet = [...p];
      river.points.splice(end, 0, p);
      river.widths.splice(
        end,
        0,
        river.widths[end - 1] + (river.widths[end] - river.widths[end - 1]) * t,
      );
    }
  }
  for (let pass = 0; pass < rivers.length; pass++) {
    const joins = new Map();
    for (const r of rivers)
      for (const p of r.points) {
        const key = p[0] + ":" + p[2];
        joins.set(key, Math.max(joins.get(key) ?? -Infinity, p[1]));
      }
    for (const r of rivers)
      for (let i = r.points.length - 1; i >= 0; i--) {
        const p = r.points[i];
        p[1] = Math.max(
          p[1],
          joins.get(p[0] + ":" + p[2]),
          r.points[i + 1]?.[1] ?? 0,
        );
      }
  }
  return lakes;
}
export function makeWaterfalls(rivers) {
  const falls = [];
  for (const river of rivers)
    for (let i = 1; i < river.points.length; i++) {
      const a = river.points[i - 1],
        b = river.points[i];
      if (a[1] - b[1] > 8 && Math.hypot(b[0] - a[0], b[2] - a[2]) < 100)
        falls.push({
          id: `${river.id}-fall-${i}`,
          riverId: river.id,
          top: [...a],
          bottom: [...b],
          width: river.widths?.[i] ?? river.width,
        });
    }
  return falls;
}
export function validatePlan(plan) {
  if (plan.castles.length !== 5 || plan.flightCorridors.length < 2)
    throw Error("Incomplete island layout");
  let land = 0,
    peak = 0;
  for (const h of plan.heights) {
    if (!Number.isFinite(h)) throw Error("Invalid layout height");
    if (h > 0) land++;
    peak = Math.max(peak, h);
  }
  const fraction = land / plan.heights.length;
  if (fraction < 0.35 || fraction > 0.72 || peak < 700 || peak > 1000)
    throw Error("Island footprint or summit is unsuitable");
  if (plan.sites.some((s) => !onMainland(plan.mainland, s.p[0], s.p[2])))
    throw Error("Disconnected landmark placement");
  for (const pass of plan.passes)
    if (
      fieldSample(plan.heights, plan.grid, plan.step, pass.p[0], pass.p[2]) >=
      450
    )
      throw Error("Unsafe mountain pass");
  return { landFraction: fraction, peak };
}

export function addIslets(field, grid, size, hash) {
  const step = size / (grid - 1);
  for (let k = 0; k < 4; k++) {
    if (hash(k, 812) < 0.45) continue;
    const ox = 500 + hash(k, 814) * 650,
      oz = 600 + hash(k, 815) * 650,
      cx = k % 2 ? size - ox : ox,
      cz = k < 2 ? oz : size - oz,
      radius = 110 + hash(k, 813) * 85;
    if (
      Array.from({ length: 16 }, (_, j) => {
        const a = (j / 16) * Math.PI * 2;
        return fieldSample(
          field,
          grid,
          step,
          cx + Math.cos(a) * (radius + 220),
          cz + Math.sin(a) * (radius + 220),
        );
      }).some((h) => h > -8)
    )
      continue;
    for (
      let z = Math.floor((cz - radius - 40) / step);
      z <= Math.ceil((cz + radius + 40) / step);
      z++
    )
      for (
        let x = Math.floor((cx - radius - 40) / step);
        x <= Math.ceil((cx + radius + 40) / step);
        x++
      ) {
        const d = Math.hypot(x * step - cx, z * step - cz),
          height = 22 * (1 - (d / radius) ** 2);
        field[z * grid + x] = Math.max(field[z * grid + x], height);
      }
  }
}
