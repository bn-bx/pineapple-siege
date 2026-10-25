import type { RiverData, LakeData } from "../types";
import { inlandWaterHeight } from "../world/water-geometry.mjs";

/** Query the same generated footprint and nearest 2 m sample as the simulation. */
export class WaterSurfaceLookup {
  constructor(
    private rivers: RiverData[],
    readonly worldSize: number,
    readonly cellSize = 64,
    private lakes: LakeData[] = [],
  ) {}
  sample(
    x: number,
    z: number,
    terrainHeight: number,
    wet: boolean,
  ): number | undefined {
    if (!wet || x < 0 || z < 0 || x > this.worldSize || z > this.worldSize)
      return undefined;
    const surface = inlandWaterHeight(
      this.rivers,
      this.lakes,
      Math.round(x / 2) * 2,
      Math.round(z / 2) * 2,
    );
    if (Number.isFinite(surface) && surface > terrainHeight) return surface;
    return terrainHeight < 0 ? 0 : undefined;
  }
}
