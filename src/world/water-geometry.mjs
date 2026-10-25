export function riverHalfWidth(river, index) {
  return river.widths?.[index] ?? river.width;
}
export function segmentWater(a, b, startWidth, endWidth, x, z) {
  const dx = b[0] - a[0],
    dz = b[2] - a[2],
    length = dx * dx + dz * dz;
  if (!length) return undefined;
  const t = Math.max(
    0,
    Math.min(1, ((x - a[0]) * dx + (z - a[2]) * dz) / length),
  );
  const width = startWidth + (endWidth - startWidth) * t;
  if ((x - a[0] - dx * t) ** 2 + (z - a[2] - dz * t) ** 2 > width * width)
    return undefined;
  return a[1] + (b[1] - a[1]) * t;
}
export function pointInLake(lake, x, z) {
  if (
    Math.abs(x - lake.center[0]) > lake.radius ||
    Math.abs(z - lake.center[1]) > lake.radius
  )
    return false;
  let inside = false;
  const polygon = lake.outline;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i],
      b = polygon[j];
    if (
      a[1] > z !== b[1] > z &&
      x < ((b[0] - a[0]) * (z - a[1])) / (b[1] - a[1]) + a[0]
    )
      inside = !inside;
  }
  return inside;
}
const waterIndices = new WeakMap();
export function inlandWaterHeight(rivers, lakes, x, z, riverOnly = false) {
  let indices = waterIndices.get(rivers);
  if (!indices) {
    indices = new WeakMap();
    waterIndices.set(rivers, indices);
  }
  let cells = indices.get(lakes);
  if (!cells) {
    cells = new Map();
    indices.set(lakes, cells);
    const add = (x0, z0, x1, z1, entry) => {
      for (let cz = Math.floor(z0 / 128); cz <= Math.floor(z1 / 128); cz++)
        for (let cx = Math.floor(x0 / 128); cx <= Math.floor(x1 / 128); cx++) {
          const key = cz * 1000 + cx,
            list = cells.get(key);
          if (list) list.push(entry);
          else cells.set(key, [entry]);
        }
    };
    for (const river of rivers)
      for (let i = 1; i < river.points.length; i++) {
        const a = river.points[i - 1],
          b = river.points[i],
          wa = riverHalfWidth(river, i - 1),
          wb = riverHalfWidth(river, i),
          w = Math.max(wa, wb);
        add(
          Math.min(a[0], b[0]) - w,
          Math.min(a[2], b[2]) - w,
          Math.max(a[0], b[0]) + w,
          Math.max(a[2], b[2]) + w,
          { a, b, wa, wb },
        );
      }
    for (const lake of lakes)
      add(
        lake.center[0] - lake.radius,
        lake.center[1] - lake.radius,
        lake.center[0] + lake.radius,
        lake.center[1] + lake.radius,
        { lake },
      );
  }
  let result = -Infinity;
  for (const entry of cells.get(
    Math.floor(z / 128) * 1000 + Math.floor(x / 128),
  ) ?? []) {
    if (entry.lake) {
      if (!riverOnly && pointInLake(entry.lake, x, z))
        result = Math.max(result, entry.lake.level);
    } else {
      const h = segmentWater(entry.a, entry.b, entry.wa, entry.wb, x, z);
      if (h !== undefined) result = Math.max(result, h);
    }
  }
  return result;
}
