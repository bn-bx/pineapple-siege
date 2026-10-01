import { CONFIG, LASER, clamp } from "../config";
import type { TerrainPatch } from "../types";
export class Terrain {
  readonly base: Float32Array;
  readonly heights: Float32Array;
  readonly changed = new Map<number, number>();
  readonly flooded = new Uint8Array(CONFIG.grid * CONFIG.grid);
  readonly laserDry = new Uint8Array(CONFIG.grid * CONFIG.grid);
  private floodQueue = new Uint32Array(CONFIG.grid * CONFIG.grid);
  constructor(base: Float32Array) {
    this.base = base.slice();
    this.heights = base.slice();
    this.initializeFlood();
  }
  sample(x: number, z: number) {
    const g = CONFIG.grid,
      gx = clamp(x / 2, 0, g - 1.00001),
      gz = clamp(z / 2, 0, g - 1.00001),
      ix = Math.floor(gx),
      iz = Math.floor(gz),
      u = gx - ix,
      v = gz - iz,
      i = iz * g + ix,
      a = this.heights[i],
      b = this.heights[i + 1],
      c = this.heights[i + g],
      d = this.heights[i + g + 1];
    return u + v <= 1
      ? a + (b - a) * u + (c - a) * v
      : d + (c - d) * (1 - u) + (b - d) * (1 - v);
  }
  water(x: number, z: number) {
    return (
      this.flooded[
        clamp(Math.round(z / 2), 0, 1024) * 1025 +
          clamp(Math.round(x / 2), 0, 1024)
      ] === 1 && this.sample(x, z) < 0
    );
  }
  initializeFlood() {
    this.flooded.fill(0);
    let n = 0;
    for (let i = 0; i < this.base.length; i++)
      if (this.base[i] < -0.15 && !this.laserDry[i]) {
        this.flooded[i] = 1;
        this.floodQueue[n++] = i;
      }
    this.expandFlood(n);
  }
  private expandFlood(n: number) {
    let head = 0;
    const newCells: number[] = [];
    while (head < n) {
      const i = this.floodQueue[head++],
        x = i % 1025,
        z = Math.floor(i / 1025);
      for (const j of [
        x > 0 ? i - 1 : -1,
        x < 1024 ? i + 1 : -1,
        z > 0 ? i - 1025 : -1,
        z < 1024 ? i + 1025 : -1,
      ])
        if (
          j >= 0 &&
          !this.laserDry[j] &&
          !this.flooded[j] &&
          this.heights[j] < -0.06
        ) {
          this.flooded[j] = 1;
          newCells.push(j);
          this.floodQueue[n++] = j;
        }
    }
    return new Uint32Array(newCells);
  }
  floodChanged(indices: Uint32Array) {
    let n = 0;
    for (const i of indices) {
      if (this.laserDry[i]) continue;
      const x = i % 1025,
        z = Math.floor(i / 1025);
      if (this.flooded[i]) this.floodQueue[n++] = i;
      else if (
        this.heights[i] < -0.06 &&
        [
          x > 0 ? i - 1 : -1,
          x < 1024 ? i + 1 : -1,
          z > 0 ? i - 1025 : -1,
          z < 1024 ? i + 1025 : -1,
        ].some((j) => j >= 0 && this.flooded[j])
      ) {
        this.flooded[i] = 1;
        this.floodQueue[n++] = i;
      }
    }
    const initial = Array.from(this.floodQueue.slice(0, n)),
      extra = this.expandFlood(n);
    return new Uint32Array([...initial, ...extra]);
  }
  crater(
    x: number,
    z: number,
    radius = CONFIG.craterRadius,
    depth = CONFIG.craterDepth,
    revision = 0,
    section?: number,
  ): TerrainPatch {
    const indices: number[] = [],
      values: number[] = [],
      chunks = new Set<number>();
    let x0 = clamp(Math.floor((x - radius) / 2), 0, 1024),
      x1 = clamp(Math.ceil((x + radius) / 2), 0, 1024),
      z0 = clamp(Math.floor((z - radius) / 2), 0, 1024),
      z1 = clamp(Math.ceil((z + radius) / 2), 0, 1024);
    if (section !== undefined) {
      const cx = section % 32,
        cz = Math.floor(section / 32);
      x0 = Math.max(x0, cx * 32);
      x1 = Math.min(x1, cx === 31 ? 1024 : cx * 32 + 31);
      z0 = Math.max(z0, cz * 32);
      z1 = Math.min(z1, cz === 31 ? 1024 : cz * 32 + 31);
    }
    for (let iz = z0; iz <= z1; iz++)
      for (let ix = x0; ix <= x1; ix++) {
        const angle = Math.atan2(iz * 2 - z, ix * 2 - x);
        const edge =
          1 -
          0.055 *
            (1 +
              Math.sin(angle * 7 + x * 0.13) * Math.cos(angle * 11 + z * 0.11));
        let d = Math.hypot(ix * 2 - x, iz * 2 - z) / (radius * edge);
        if (d >= 1) continue;
        let i = iz * 1025 + ix,
          value = Math.fround(
            Math.max(
              Math.min(this.base[i] - CONFIG.bedrock, this.heights[i]),
              this.heights[i] - depth * Math.pow(1 - d * d, 1.45),
            ),
          );
        if (value === this.heights[i]) continue;
        this.heights[i] = value;
        this.changed.set(i, value);
        indices.push(i);
        values.push(value);
        for (
          let cz = clamp(Math.floor((iz * 2 - 2) / 64), 0, 31);
          cz <= clamp(Math.floor((iz * 2 + 2) / 64), 0, 31);
          cz++
        )
          for (
            let cx = clamp(Math.floor((ix * 2 - 2) / 64), 0, 31);
            cx <= clamp(Math.floor((ix * 2 + 2) / 64), 0, 31);
            cx++
          )
            chunks.add(cz * 32 + cx);
      }
    return {
      indices: new Uint32Array(indices),
      values: new Float32Array(values),
      chunks: [...chunks],
      revision,
    };
  }
  /** Absolute monotonic excavation, safe to coalesce/replay without extra digging. */
  laserCrater(
    x: number,
    z: number,
    progress: number,
    section: number,
    revision = 0,
    radius = LASER.radius,
    depth = LASER.depth,
  ) {
    const indices: number[] = [],
      values: number[] = [],
      dry: number[] = [],
      chunks = new Set<number>();
    const cx = section % 32,
      cz = Math.floor(section / 32);
    const x0 = cx * 32,
      x1 = cx === 31 ? 1024 : x0 + 31;
    const z0 = cz * 32,
      z1 = cz === 31 ? 1024 : z0 + 31;
    for (let iz = z0; iz <= z1; iz++)
      for (let ix = x0; ix <= x1; ix++) {
        const d = Math.hypot(ix * 2 - x, iz * 2 - z) / radius;
        if (d >= 1) continue;
        const i = iz * CONFIG.grid + ix;
        if (!this.laserDry[i]) {
          this.laserDry[i] = 1;
          this.flooded[i] = 0;
          dry.push(i);
        }
        const rim = clamp((d - 0.65) / 0.35, 0, 1);
        const shape = 1 - rim * rim * (3 - 2 * rim);
        const value = Math.fround(
          Math.min(
            this.heights[i],
            this.base[i] - depth * clamp(progress, 0, 1) * shape,
          ),
        );
        if (value === this.heights[i]) continue;
        this.heights[i] = value;
        this.changed.set(i, value);
        indices.push(i);
        values.push(value);
        for (
          let zz = clamp(Math.floor((iz * 2 - 2) / 64), 0, 31);
          zz <= clamp(Math.floor((iz * 2 + 2) / 64), 0, 31);
          zz++
        )
          for (
            let xx = clamp(Math.floor((ix * 2 - 2) / 64), 0, 31);
            xx <= clamp(Math.floor((ix * 2 + 2) / 64), 0, 31);
            xx++
          )
            chunks.add(zz * 32 + xx);
      }
    return {
      patch: {
        indices: new Uint32Array(indices),
        values: new Float32Array(values),
        chunks: [...chunks],
        revision,
      },
      dry: new Uint32Array(dry),
    };
  }
  restore(
    data: Float32Array | [number, number][],
    dry: Uint32Array = new Uint32Array(),
  ) {
    this.laserDry.fill(0);
    for (const i of dry) if (i < this.laserDry.length) this.laserDry[i] = 1;
    const count = data instanceof Float32Array ? data.length / 2 : data.length;
    for (let offset = 0; offset < count; offset++) {
      const i =
          data instanceof Float32Array ? data[offset * 2] : data[offset][0],
        h =
          data instanceof Float32Array ? data[offset * 2 + 1] : data[offset][1];
      if (i >= 0 && i < this.heights.length && Number.isFinite(h)) {
        const value = Math.max(
          this.base[i] -
            (this.laserDry[i] ? CONFIG.laserBedrock : CONFIG.bedrock),
          Math.min(this.base[i], h),
        );
        this.heights[i] = value;
        this.changed.set(i, value);
      }
    }
    this.initializeFlood();
  }
  reset() {
    this.laserDry.fill(0);
    this.heights.set(this.base);
    this.changed.clear();
    this.initializeFlood();
  }
}
