import type { RiverData, LakeData } from "../types";
import {
  cappedRiverSurface,
  inlandWaterHeight,
} from "../world/water-geometry.mjs";

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
    const sx = Math.round(x / 2) * 2,
      sz = Math.round(z / 2) * 2;
    const any = inlandWaterHeight(this.rivers, this.lakes, sx, sz),
      river = inlandWaterHeight(this.rivers, this.lakes, sx, sz, true);
    // Lakes keep their level; rivers follow the ground down over dips.
    const surface =
      Number.isFinite(river) && !(any > river + 1e-6)
        ? cappedRiverSurface(river, terrainHeight)
        : any;
    if (Number.isFinite(surface) && surface > terrainHeight) return surface;
    return terrainHeight < 0 ? 0 : undefined;
  }
}
