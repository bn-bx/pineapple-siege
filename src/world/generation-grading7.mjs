import { fieldSample } from "./landscape.mjs";
import {
  riverHalfWidth,
  pointInLake,
  segmentWater,
} from "./water-geometry.mjs";
export { inlandWaterHeight as waterHeight } from "./water-geometry.mjs";
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const mix = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, v) => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
function rect(field, grid, step, x0, z0, x1, z1, fn) {
  for (
    let z = Math.max(0, Math.floor(z0 / step));
    z <= Math.min(grid - 1, Math.ceil(z1 / step));
    z++
  )
    for (
      let x = Math.max(0, Math.floor(x0 / step));
      x <= Math.min(grid - 1, Math.ceil(x1 / step));
      x++
    )
      fn(x * step, z * step, z * grid + x);
}
/** For each cell near a river: [distance beyond its edge, water, half-width, distance]. */
function nearestRiverEdges(field, grid, step, rivers) {
  const nearest = new Map();
  for (const river of rivers)
    for (let i = 1; i < river.points.length; i++) {
      const a = river.points[i - 1],
        b = river.points[i],
        wa = riverHalfWidth(river, i - 1),
        wb = riverHalfWidth(river, i),
        w = Math.max(wa, wb),
        dx = b[0] - a[0],
        dz = b[2] - a[2],
        l = dx * dx + dz * dz;
      if (!l) continue;
      rect(
        field,
        grid,
        step,
        Math.min(a[0], b[0]) - w - RIVER_BANK,
        Math.min(a[2], b[2]) - w - RIVER_BANK,
        Math.max(a[0], b[0]) + w + RIVER_BANK,
        Math.max(a[2], b[2]) + w + RIVER_BANK,
        (x, z, id) => {
          const t = clamp(((x - a[0]) * dx + (z - a[2]) * dz) / l, 0, 1),
            distance = Math.hypot(x - a[0] - t * dx, z - a[2] - t * dz),
            width = mix(wa, wb, t),
            edge = distance - width;
          if (edge >= RIVER_BANK) return;
          const best = nearest.get(id);
          if (best && best[0] <= edge) return;
          nearest.set(id, [edge, mix(a[1], b[1], t), width, distance]);
        },
      );
    }
  return nearest;
}
/**
 * Site and road grading can fill a channel or lower the ground beside it.
 * Afterwards, cut the channel back out and hold the first few metres past
 * the waterline at least level with the water, so no reach is buried or
 * left standing above its banks.
 */
export function containRivers(field, grid, step, rivers, lakes) {
  for (const [id, [edge, water, width, distance]] of nearestRiverEdges(
    field,
    grid,
    step,
    rivers,
  )) {
    if (edge < 0) {
      field[id] = Math.min(
        field[id],
        riverChannelHeight(water, width, distance, field[id]),
      );
      continue;
    }
    // At the coast the sea holds the water; raising the shore there would
    // build a bar across the river mouth.
    if (edge < 1 || edge > 5 || water < 1 || field[id] <= 0) continue;
    const x = (id % grid) * step,
      z = Math.floor(id / grid) * step;
    if (lakes.some((lake) => pointInLake(lake, x, z))) continue;
    field[id] = Math.max(field[id], water + (edge - 1) * 0.2);
  }
}
/** Distance beyond the water's edge over which a river bank meets the land. */
const RIVER_BANK = 18;
/**
 * Rounded channel: deepest mid-stream (wider rivers run deeper), shelving to
 * a few decimetres at the generated half-width so the waterline sits close
 * to it, then a bank that rises back into the surrounding ground.
 */
export function riverChannelHeight(water, width, distance, ground) {
  const depth = 1.5 + width * 0.12,
    edge = water - 0.3;
  if (distance < width) {
    const u = distance / width;
    return edge - depth * (1 - u * u) * (1 - 0.35 * u * u);
  }
  const bank = smooth(width, width + RIVER_BANK, distance);
  return mix(edge + (distance - width) * 0.12, ground, bank);
}
export function carveWater(field, grid, step, rivers, lakes) {
  // Each cell takes its channel from the nearest river edge only. Taking the
  // lowest cut of every segment in reach let steep downstream segments dig
  // into the banks of the reach above them, leaving its water perched.
  const nearest = nearestRiverEdges(field, grid, step, rivers);
  for (const [id, [, water, width, distance]] of nearest)
    field[id] = Math.min(
      field[id],
      riverChannelHeight(water, width, distance, field[id]),
    );
  for (const lake of lakes) {
    const [cx, cz] = lake.center,
      r = lake.radius;
    rect(
      field,
      grid,
      step,
      cx - r - 24,
      cz - r - 24,
      cx + r + 24,
      cz + r + 24,
      (x, z, id) => {
        if (pointInLake(lake, x, z))
          field[id] = Math.min(field[id], lake.level - 4);
        else {
          const d = Math.hypot(x - cx, z - cz);
          if (d < r + 24)
            field[id] = Math.min(
              field[id],
              mix(lake.level - 2, field[id], smooth(r - 6, r + 24, d)),
            );
        }
      },
    );
  }
}
/**
 * Grid cells covered by river or lake water, matching inlandWaterHeight at
 * every grid sample. Grading asks this for hundreds of thousands of cells,
 * so it is rasterized once per pass instead of searched per cell.
 */
function wetCells(grid, step, rivers, lakes) {
  const wet = new Uint8Array(grid * grid);
  const cover = (x0, z0, x1, z1, test) => {
    for (
      let z = Math.max(0, Math.ceil(z0 / step));
      z <= Math.min(grid - 1, Math.floor(z1 / step));
      z++
    )
      for (
        let x = Math.max(0, Math.ceil(x0 / step));
        x <= Math.min(grid - 1, Math.floor(x1 / step));
        x++
      ) {
        const id = z * grid + x;
        if (!wet[id] && test(x * step, z * step)) wet[id] = 1;
      }
  };
  for (const river of rivers)
    for (let i = 1; i < river.points.length; i++) {
      const a = river.points[i - 1],
        b = river.points[i],
        wa = riverHalfWidth(river, i - 1),
        wb = riverHalfWidth(river, i),
        w = Math.max(wa, wb);
      cover(
        Math.min(a[0], b[0]) - w,
        Math.min(a[2], b[2]) - w,
        Math.max(a[0], b[0]) + w,
        Math.max(a[2], b[2]) + w,
        (x, z) => segmentWater(a, b, wa, wb, x, z) !== undefined,
      );
    }
  for (const lake of lakes)
    cover(
      lake.center[0] - lake.radius,
      lake.center[1] - lake.radius,
      lake.center[0] + lake.radius,
      lake.center[1] + lake.radius,
      (x, z) => pointInLake(lake, x, z),
    );
  return wet;
}
function padSize(site, castles) {
  const castle = castles.find((c) => c.id === site.id);
  return castle
    ? [
        (site.bounds.max[0] - site.bounds.min[0]) / 2,
        (site.bounds.max[1] - site.bounds.min[1]) / 2,
      ]
    : site.kind === "pineapple-god"
      ? [420, 420]
      : [site.radius, site.radius];
}
export function gradeSites(field, grid, step, sites, castles, rivers, lakes) {
  const wet = wetCells(grid, step, rivers, lakes);
  for (const site of sites) {
    if (["bridge", "crossing"].includes(site.kind)) continue;
    const [x, y, z] = site.p,
      [hx, hz] = padSize(site, castles);
    const relief = Math.max(
      ...[
        [-hx, -hz],
        [hx, -hz],
        [-hx, hz],
        [hx, hz],
      ].map(([dx, dz]) =>
        Math.abs(fieldSample(field, grid, step, x + dx, z + dz) - y),
      ),
    );
    const blend = clamp(50 + relief * 2.5, 50, 180);
    // Only sites overlapping this pad's footprint can shield cells from it.
    const others = sites.filter(
      (other) =>
        other !== site &&
        other.bounds.max[0] >= x - hx - blend &&
        other.bounds.min[0] <= x + hx + blend &&
        other.bounds.max[1] >= z - hz - blend &&
        other.bounds.min[1] <= z + hz + blend,
    );
    rect(
      field,
      grid,
      step,
      x - hx - blend,
      z - hz - blend,
      x + hx + blend,
      z + hz + blend,
      (wx, wz, id) => {
        if (field[id] < 1 || wet[id]) return;
        if (
          others.some(
            (other) =>
              wx >= other.bounds.min[0] &&
              wx <= other.bounds.max[0] &&
              wz >= other.bounds.min[1] &&
              wz <= other.bounds.max[1],
          )
        )
          return;
        const distance = Math.max(Math.abs(wx - x) - hx, Math.abs(wz - z) - hz);
        field[id] = mix(y, field[id], smooth(0, blend, distance));
      },
    );
  }
}
export function gradeRoads(field, grid, step, paths, sites, rivers, lakes) {
  const wet = wetCells(grid, step, rivers, lakes);
  const bridges = sites.filter((s) => ["bridge", "crossing"].includes(s.kind));
  const deckAt = (x, z) =>
    bridges.find(
      (s) =>
        Math.abs(s.axis === 0 ? z - s.p[2] : x - s.p[0]) < 12 &&
        Math.abs(s.axis === 0 ? x - s.p[0] : z - s.p[2]) <= s.span / 2 + 2,
    );
  // Compute complete profiles before changing terrain, so corners cannot pick up
  // the previous segment's shoulder and turn it into a sudden step.
  const profiles = paths.map((path) => {
    const points = [];
    for (let j = 1; j < path.length; j++) {
      const a = path[j - 1],
        b = path[j],
        length = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (!length) continue;
      const n = Math.ceil(length / 8);
      for (let k = j === 1 ? 0 : 1; k <= n; k++) {
        const t = k / n,
          x = mix(a[0], b[0], t),
          z = mix(a[1], b[1], t),
          deck = deckAt(x, z);
        points.push({
          x,
          z,
          y: deck?.deck ?? fieldSample(field, grid, step, x, z),
          fixed: !!deck,
        });
      }
    }
    for (let pass = 0; pass < 4; pass++) {
      for (let i = 1; i < points.length; i++) {
        const a = points[i - 1],
          b = points[i],
          limit = Math.hypot(b.x - a.x, b.z - a.z) * 0.4;
        if (!b.fixed) b.y = clamp(b.y, a.y - limit, a.y + limit);
      }
      for (let i = points.length - 2; i >= 0; i--) {
        const a = points[i + 1],
          b = points[i],
          limit = Math.hypot(b.x - a.x, b.z - a.z) * 0.4;
        if (!b.fixed) b.y = clamp(b.y, a.y - limit, a.y + limit);
      }
    }
    return points;
  });
  const roadMask = new Uint8Array(field.length),
    roadCells = [];
  for (const points of profiles)
    for (let j = 1; j < points.length; j++) {
      const a = points[j - 1],
        b = points[j],
        dx = b.x - a.x,
        dz = b.z - a.z,
        length = dx * dx + dz * dz;
      if (!length) continue;
      rect(
        field,
        grid,
        step,
        Math.min(a.x, b.x) - 12,
        Math.min(a.z, b.z) - 12,
        Math.max(a.x, b.x) + 12,
        Math.max(a.z, b.z) + 12,
        (x, z, id) => {
          const t = clamp(((x - a.x) * dx + (z - a.z) * dz) / length, 0, 1),
            distance = Math.hypot(x - a.x - dx * t, z - a.z - dz * t);
          if (
            distance < 12 &&
            !wet[id]
          ) {
            field[id] = mix(
              mix(a.y, b.y, t),
              field[id],
              smooth(4, 12, distance),
            );
            if (distance < Math.max(4.5, step * 0.75) && !roadMask[id]) {
              roadMask[id] = 1;
              roadCells.push(id);
            }
          }
        },
      );
    }
  // Project the entire shared road raster onto a bounded grade. The queue
  // propagates cuts through junctions until every neighboring core sample agrees.
  const queue = [];
  for (const i of roadCells) {
    roadMask[i] = 2;
    queue.push(i);
  }
  for (let head = 0; head < queue.length; head++) {
    const i = queue[head];
    roadMask[i] = 1;
    for (const offset of [
      -grid - 1,
      -grid,
      -grid + 1,
      -1,
      1,
      grid - 1,
      grid,
      grid + 1,
    ]) {
      const j = i + offset;
      if (!roadMask[j]) continue;
      const limit =
        step *
        (Math.abs(offset) === 1 || Math.abs(offset) === grid
          ? 0.32
          : Math.SQRT2 * 0.32);
      if (field[j] > field[i] + limit + 0.002) {
        field[j] = field[i] + limit;
        if (roadMask[j] !== 2) {
          roadMask[j] = 2;
          queue.push(j);
        }
      }
    }
  }
}
export function flattenSites(field, grid, step, sites, castles, rivers, lakes) {
  const wet = wetCells(grid, step, rivers, lakes);
  for (const site of sites) {
    if (["crossing", "bridge", "watermill"].includes(site.kind)) continue;
    const [x, y, z] = site.p,
      [hx, hz] = padSize(site, castles);
    rect(field, grid, step, x - hx, z - hz, x + hx, z + hz, (wx, wz, id) => {
      if (
        Math.abs(wx - x) <= hx &&
        Math.abs(wz - z) <= hz &&
        !wet[id]
      )
        field[id] = y;
    });
  }
}
