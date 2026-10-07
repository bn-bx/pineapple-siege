import type { RiverData, Vec3 } from "../types";

interface RiverSegment {
  a: Vec3;
  b: Vec3;
  width: number;
}

/** Spatially indexed river reaches for effects that need the visible waterline. */
export class WaterSurfaceLookup {
  private readonly cells = new Map<number, RiverSegment[]>();
  private readonly cellCount: number;

  constructor(
    rivers: readonly RiverData[],
    readonly worldSize: number,
    readonly cellSize = 64,
  ) {
    this.cellCount = Math.ceil(worldSize / cellSize);
    for (const river of rivers)
      for (let i = 1; i < river.points.length; i++) {
        const a = river.points[i - 1],
          b = river.points[i],
          segment = { a, b, width: Math.max(0.1, river.width) },
          minX = Math.max(0, Math.floor((Math.min(a[0], b[0]) - segment.width) / cellSize)),
          maxX = Math.min(
            this.cellCount - 1,
            Math.floor((Math.max(a[0], b[0]) + segment.width) / cellSize),
          ),
          minZ = Math.max(0, Math.floor((Math.min(a[2], b[2]) - segment.width) / cellSize)),
          maxZ = Math.min(
            this.cellCount - 1,
            Math.floor((Math.max(a[2], b[2]) + segment.width) / cellSize),
          );
        for (let z = minZ; z <= maxZ; z++)
          for (let x = minX; x <= maxX; x++) {
            const key = z * this.cellCount + x,
              list = this.cells.get(key);
            if (list) list.push(segment);
            else this.cells.set(key, [segment]);
          }
      }
  }

  sample(
    x: number,
    z: number,
    terrainHeight: number,
    wet: boolean,
  ): number | undefined {
    if (!wet) return undefined;
    const cellX = Math.floor(x / this.cellSize),
      cellZ = Math.floor(z / this.cellSize);
    if (
      cellX < 0 ||
      cellX >= this.cellCount ||
      cellZ < 0 ||
      cellZ >= this.cellCount
    )
      return undefined;
    let riverHeight = -Infinity;
    for (const { a, b, width } of
      this.cells.get(cellZ * this.cellCount + cellX) ?? []) {
      const dx = b[0] - a[0],
        dz = b[2] - a[2],
        length2 = dx * dx + dz * dz,
        t = length2 > 1e-6
          ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[2]) * dz) / length2))
          : 0,
        nearestX = a[0] + dx * t,
        nearestZ = a[2] + dz * t;
      if ((x - nearestX) ** 2 + (z - nearestZ) ** 2 > width * width)
        continue;
      const height = a[1] + (b[1] - a[1]) * t;
      if (height > terrainHeight) riverHeight = Math.max(riverHeight, height);
    }
    if (Number.isFinite(riverHeight)) return riverHeight;
    // The world ocean is at zero; negative terrain inside its wet mask is submerged.
    return terrainHeight < 0 ? 0 : undefined;
  }
}
