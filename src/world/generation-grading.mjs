import { fieldSample } from "./landscape.mjs";
import {
  inlandWaterHeight,
  riverHalfWidth,
  pointInLake,
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
export function carveWater(field, grid, step, rivers, lakes) {
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
        Math.min(a[0], b[0]) - w - 24,
        Math.min(a[2], b[2]) - w - 24,
        Math.max(a[0], b[0]) + w + 24,
        Math.max(a[2], b[2]) + w + 24,
        (x, z, id) => {
          const t = clamp(((x - a[0]) * dx + (z - a[2]) * dz) / l, 0, 1),
            distance = Math.hypot(x - a[0] - t * dx, z - a[2] - t * dz),
            width = mix(wa, wb, t),
            water = mix(a[1], b[1], t);
          if (distance < width + 24)
            field[id] = Math.min(
              field[id],
              mix(
                water - 3 + (0.4 * distance) / width,
                field[id],
                smooth(width, width + 24, distance),
              ),
            );
        },
      );
    }
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
    const blend = clamp(30 + relief * 2, 30, 100);
    rect(
      field,
      grid,
      step,
      x - hx - blend,
      z - hz - blend,
      x + hx + blend,
      z + hz + blend,
      (wx, wz, id) => {
        if (
          field[id] < 1 ||
          Number.isFinite(inlandWaterHeight(rivers, lakes, wx, wz))
        )
          return;
        if (
          sites.some(
            (other) =>
              other !== site &&
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
            !Number.isFinite(inlandWaterHeight(rivers, lakes, x, z))
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
  for (const site of sites) {
    if (["crossing", "bridge", "watermill"].includes(site.kind)) continue;
    const [x, y, z] = site.p,
      [hx, hz] = padSize(site, castles);
    rect(field, grid, step, x - hx, z - hz, x + hx, z + hz, (wx, wz, id) => {
      if (
        Math.abs(wx - x) <= hx &&
        Math.abs(wz - z) <= hz &&
        !Number.isFinite(inlandWaterHeight(rivers, lakes, wx, wz))
      )
        field[id] = y;
    });
  }
}
