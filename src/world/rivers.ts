import { CONFIG, clamp } from "../config";
import type { RiverData } from "../types";

/** Immutable channel surfaces. Inland water never floods beyond this generated footprint. */
export class RiverField {
  readonly cells = new Map<number, number>();
  constructor(rivers: RiverData[] = []) {
    for (const river of rivers)
      for (let p = 1; p < river.points.length; p++) {
        const a = river.points[p - 1],
          b = river.points[p];
        const dx = b[0] - a[0],
          dz = b[2] - a[2],
          length = dx * dx + dz * dz;
        if (!length) continue;
        const x0 = Math.max(
          0,
          Math.floor((Math.min(a[0], b[0]) - river.width) / 2),
        );
        const x1 = Math.min(
          CONFIG.grid - 1,
          Math.ceil((Math.max(a[0], b[0]) + river.width) / 2),
        );
        const z0 = Math.max(
          0,
          Math.floor((Math.min(a[2], b[2]) - river.width) / 2),
        );
        const z1 = Math.min(
          CONFIG.grid - 1,
          Math.ceil((Math.max(a[2], b[2]) + river.width) / 2),
        );
        for (let z = z0; z <= z1; z++)
          for (let x = x0; x <= x1; x++) {
            const t = clamp(
              ((x * 2 - a[0]) * dx + (z * 2 - a[2]) * dz) / length,
              0,
              1,
            );
            if (
              Math.hypot(x * 2 - a[0] - dx * t, z * 2 - a[2] - dz * t) >
              river.width
            )
              continue;
            const index = z * CONFIG.grid + x,
              height = a[1] + (b[1] - a[1]) * t;
            this.cells.set(
              index,
              Math.max(this.cells.get(index) ?? -Infinity, height),
            );
          }
      }
  }
  index(x: number, z: number) {
    return (
      clamp(Math.round(z / 2), 0, CONFIG.grid - 1) * CONFIG.grid +
      clamp(Math.round(x / 2), 0, CONFIG.grid - 1)
    );
  }
  surface(x: number, z: number) {
    return this.cells.get(this.index(x, z));
  }
}
