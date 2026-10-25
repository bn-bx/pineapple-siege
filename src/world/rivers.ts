import { CONFIG, clamp } from "../config";
import type { LakeData, RiverData } from "../types";
import {
  riverHalfWidth,
  segmentWater,
  pointInLake,
} from "./water-geometry.mjs";

/** Authoritative nearest-sample inland water footprints, shared with presentation. */
export class RiverField {
  readonly cells = new Map<number, number>();
  readonly riverCells = new Map<number, number>();
  readonly lakeCells = new Set<number>();
  constructor(rivers: RiverData[] = [], lakes: LakeData[] = []) {
    const raster = (
      x0: number,
      z0: number,
      x1: number,
      z1: number,
      visit: (x: number, z: number, i: number) => void,
    ) => {
      for (
        let z = Math.max(0, Math.floor(z0 / 2));
        z <= Math.min(CONFIG.grid - 1, Math.ceil(z1 / 2));
        z++
      )
        for (
          let x = Math.max(0, Math.floor(x0 / 2));
          x <= Math.min(CONFIG.grid - 1, Math.ceil(x1 / 2));
          x++
        )
          visit(x * 2, z * 2, z * CONFIG.grid + x);
    };
    for (const river of rivers)
      for (let i = 1; i < river.points.length; i++) {
        const a = river.points[i - 1],
          b = river.points[i],
          wa = riverHalfWidth(river, i - 1),
          wb = riverHalfWidth(river, i),
          width = Math.max(wa, wb);
        raster(
          Math.min(a[0], b[0]) - width,
          Math.min(a[2], b[2]) - width,
          Math.max(a[0], b[0]) + width,
          Math.max(a[2], b[2]) + width,
          (x, z, index) => {
            const height = segmentWater(a, b, wa, wb, x, z);
            if (height !== undefined) {
              const h = Math.max(this.cells.get(index) ?? -Infinity, height);
              this.cells.set(index, h);
              this.riverCells.set(index, h);
            }
          },
        );
      }
    for (const lake of lakes)
      raster(
        lake.center[0] - lake.radius,
        lake.center[1] - lake.radius,
        lake.center[0] + lake.radius,
        lake.center[1] + lake.radius,
        (x, z, index) => {
          if (pointInLake(lake, x, z)) {
            this.lakeCells.add(index);
            this.cells.set(
              index,
              Math.max(this.cells.get(index) ?? -Infinity, lake.level),
            );
          }
        },
      );
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
