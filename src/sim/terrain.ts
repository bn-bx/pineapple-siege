import { SparseIndices } from "./sparse-indices";
import { SparseValues } from "./sparse-values";
import { CONFIG, CHUNKS, CHUNK_SAMPLES, LASER, clamp } from "../config";
import { RiverField } from "../world/rivers";
import type { RiverData, TerrainPatch } from "../types";
export class Terrain {
  readonly base: Float32Array;
  readonly heights: Float32Array;
  readonly changed = new SparseValues();
  readonly sectionVersions = new Uint32Array(CHUNKS * CHUNKS);
  sectionAt(x: number, z: number) {
    return (
      clamp(Math.floor(z / 64), 0, CHUNKS - 1) * CHUNKS +
      clamp(Math.floor(x / 64), 0, CHUNKS - 1)
    );
  }
  private invalidateWater(indices: Uint32Array) {
    for (const i of indices) {
      const x = i % CONFIG.grid,
        z = Math.floor(i / CONFIG.grid);
      this.sectionVersions[this.sectionAt(x * 2, z * 2)]++;
    }
  }
  readonly flooded = new Uint8Array(CONFIG.grid * CONFIG.grid);
  readonly dryIndices = new SparseIndices();
  dirtySamples = new SparseValues();
  dirtyDry = new SparseIndices();
  readonly laserDry = new Uint8Array(CONFIG.grid * CONFIG.grid);
  private floodQueue = new Uint32Array(4096);
  private floodHead = 0;
  private floodTail = 0;
  private floodCount = 0;
  private enqueueFlood(i: number) {
    if (this.floodCount === this.floodQueue.length) {
      const old = this.floodQueue,
        grown = new Uint32Array(old.length * 2);
      for (let j = 0; j < this.floodCount; j++)
        grown[j] = old[(this.floodHead + j) & (old.length - 1)];
      this.floodQueue = grown;
      this.floodHead = 0;
      this.floodTail = this.floodCount;
    }
    this.floodQueue[this.floodTail] = i;
    this.floodTail = (this.floodTail + 1) & (this.floodQueue.length - 1);
    this.floodCount++;
  }
  private laserShapes = new Map<
    string,
    { indices: Uint32Array; shapes: Float64Array }
  >();
  private ceilings = new Float32Array(CHUNKS * CHUNKS);
  // Lazy 16-meter bounds tighten the immutable 64-meter broad phase beneath
  // craters and shafts. Shared edges are included; revision invalidation uses
  // the same neighbor sections as collision/walkability updates.
  private fineSide = CONFIG.worldSize / 16;
  private fineCeilings = new Float32Array(this.fineSide * this.fineSide);
  private fineVersions = new Uint32Array(this.fineSide * this.fineSide).fill(
    0xffffffff,
  );
  private fineCeiling(x: number, z: number) {
    const id = z * this.fineSide + x,
      section = Math.floor(z / 4) * CHUNKS + Math.floor(x / 4),
      revision = this.sectionVersions[section];
    if (this.fineVersions[id] !== revision) {
      let highest = -Infinity;
      for (let iz = z * 8; iz <= z * 8 + 8; iz++)
        for (let ix = x * 8; ix <= x * 8 + 8; ix++)
          highest = Math.max(highest, this.heights[iz * CONFIG.grid + ix]);
      this.fineCeilings[id] = highest;
      this.fineVersions[id] = revision;
    }
    return this.fineCeilings[id];
  }
  readonly rivers: RiverField;
  constructor(
    base: Float32Array,
    rivers: RiverData[] = [],
    public trackDirty = false,
  ) {
    this.rivers = new RiverField(rivers);
    this.base = base;
    this.heights = base.slice();
    // All terrain edits lower the baseline. Include shared section edges so
    // this remains a conservative bound after craters, shafts, and restoration.
    for (let cz = 0; cz < CHUNKS; cz++)
      for (let cx = 0; cx < CHUNKS; cx++) {
        let highest = -Infinity;
        for (
          let z = cz * CHUNK_SAMPLES;
          z <= cz * CHUNK_SAMPLES + CHUNK_SAMPLES;
          z++
        )
          for (
            let x = cx * CHUNK_SAMPLES;
            x <= cx * CHUNK_SAMPLES + CHUNK_SAMPLES;
            x++
          )
            highest = Math.max(highest, base[z * CONFIG.grid + x]);
        this.ceilings[cz * CHUNKS + cx] = highest;
      }
    this.initializeFlood();
  }
  aboveSurface(a: readonly number[], b: readonly number[], clearance: number) {
    const bottom = Math.min(a[1], b[1]) - clearance;
    const x0 = clamp(Math.floor(Math.min(a[0], b[0]) / 64), 0, CHUNKS - 1),
      x1 = clamp(Math.floor(Math.max(a[0], b[0]) / 64), 0, CHUNKS - 1),
      z0 = clamp(Math.floor(Math.min(a[2], b[2]) / 64), 0, CHUNKS - 1),
      z1 = clamp(Math.floor(Math.max(a[2], b[2]) / 64), 0, CHUNKS - 1);
    let coarseAbove = true;
    for (let z = z0; z <= z1 && coarseAbove; z++)
      for (let x = x0; x <= x1; x++)
        if (bottom <= this.ceilings[z * CHUNKS + x]) {
          coarseAbove = false;
          break;
        }
    if (coarseAbove) return true;
    const fx0 = clamp(
        Math.floor(Math.min(a[0], b[0]) / 16),
        0,
        this.fineSide - 1,
      ),
      fx1 = clamp(Math.floor(Math.max(a[0], b[0]) / 16), 0, this.fineSide - 1),
      fz0 = clamp(Math.floor(Math.min(a[2], b[2]) / 16), 0, this.fineSide - 1),
      fz1 = clamp(Math.floor(Math.max(a[2], b[2]) / 16), 0, this.fineSide - 1);
    for (let z = fz0; z <= fz1; z++)
      for (let x = fx0; x <= fx1; x++)
        if (bottom <= this.fineCeiling(x, z)) return false;
    return true;
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
  surfaceHeight(
    x: number,
    z: number,
    terrainHeight?: number,
  ): number | undefined {
    const i = this.rivers.index(x, z);
    if (this.laserDry[i]) return undefined;
    const river = this.rivers.cells.get(i),
      h = terrainHeight ?? this.sample(x, z);
    if (river !== undefined && h < river) return river;
    return this.flooded[i] && h < 0 ? 0 : undefined;
  }
  water(x: number, z: number, terrainHeight?: number) {
    return this.surfaceHeight(x, z, terrainHeight) !== undefined;
  }
  waterMask() {
    const mask = this.flooded.slice();
    for (const [i, h] of this.rivers.cells)
      if (!this.laserDry[i] && this.heights[i] < h) mask[i] = 1;
    for (let i = 0; i < mask.length; i++)
      mask[i] = mask[i] && !this.laserDry[i] ? 255 : 0;
    return mask;
  }
  initializeFlood() {
    this.flooded.fill(0);
    this.floodHead = this.floodTail = this.floodCount = 0;
    // Seed the immutable ocean, then enqueue only its unvisited frontier.
    for (let i = 0; i < this.base.length; i++)
      if (this.base[i] < -0.15 && !this.laserDry[i]) this.flooded[i] = 1;
    for (let i = 0; i < this.base.length; i++) {
      if (this.flooded[i] || this.laserDry[i] || this.heights[i] >= -0.06)
        continue;
      const x = i % CONFIG.grid,
        z = Math.floor(i / CONFIG.grid);
      if (
        (x > 0 && this.flooded[i - 1]) ||
        (x < CONFIG.grid - 1 && this.flooded[i + 1]) ||
        (z > 0 && this.flooded[i - CONFIG.grid]) ||
        (z < CONFIG.grid - 1 && this.flooded[i + CONFIG.grid])
      ) {
        this.flooded[i] = 1;
        this.enqueueFlood(i);
      }
    }
    this.expandFlood(false);
  }
  private expandFlood(emit = true) {
    const newCells: number[] = [];
    const visit = (j: number) => {
      if (
        j >= 0 &&
        !this.laserDry[j] &&
        !this.flooded[j] &&
        this.heights[j] < -0.06
      ) {
        this.flooded[j] = 1;
        if (emit) newCells.push(j);
        this.enqueueFlood(j);
      }
    };
    while (this.floodCount) {
      const i = this.floodQueue[this.floodHead];
      this.floodHead = (this.floodHead + 1) & (this.floodQueue.length - 1);
      this.floodCount--;
      const x = i % CONFIG.grid,
        z = Math.floor(i / CONFIG.grid);
      if (x > 0) visit(i - 1);
      if (x < CONFIG.grid - 1) visit(i + 1);
      if (z > 0) visit(i - CONFIG.grid);
      if (z < CONFIG.grid - 1) visit(i + CONFIG.grid);
    }
    return new Uint32Array(newCells);
  }
  floodChanged(indices: Uint32Array) {
    const initial: number[] = [];
    for (const i of indices) {
      if (this.laserDry[i]) continue;
      const x = i % CONFIG.grid,
        z = Math.floor(i / CONFIG.grid);
      if (
        this.flooded[i] ||
        (this.heights[i] < -0.06 &&
          ((x > 0 && this.flooded[i - 1]) ||
            (x < CONFIG.grid - 1 && this.flooded[i + 1]) ||
            (z > 0 && this.flooded[i - CONFIG.grid]) ||
            (z < CONFIG.grid - 1 && this.flooded[i + CONFIG.grid])))
      ) {
        this.flooded[i] = 1;
        initial.push(i);
        this.enqueueFlood(i);
      }
    }
    const extra = this.expandFlood(),
      result = new Uint32Array([...initial, ...extra]);
    this.invalidateWater(result);
    return result;
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
    let x0 = clamp(Math.floor((x - radius) / 2), 0, CONFIG.grid - 1),
      x1 = clamp(Math.ceil((x + radius) / 2), 0, CONFIG.grid - 1),
      z0 = clamp(Math.floor((z - radius) / 2), 0, CONFIG.grid - 1),
      z1 = clamp(Math.ceil((z + radius) / 2), 0, CONFIG.grid - 1);
    if (section !== undefined) {
      const cx = section % CHUNKS,
        cz = Math.floor(section / CHUNKS);
      x0 = Math.max(x0, cx * CHUNK_SAMPLES);
      x1 = Math.min(
        x1,
        cx === CHUNKS - 1
          ? CONFIG.grid - 1
          : cx * CHUNK_SAMPLES + CHUNK_SAMPLES - 1,
      );
      z0 = Math.max(z0, cz * CHUNK_SAMPLES);
      z1 = Math.min(
        z1,
        cz === CHUNKS - 1
          ? CONFIG.grid - 1
          : cz * CHUNK_SAMPLES + CHUNK_SAMPLES - 1,
      );
    }
    for (let iz = z0; iz <= z1; iz++)
      for (let ix = x0; ix <= x1; ix++) {
        const i = iz * CONFIG.grid + ix;
        if (this.heights[i] <= Math.fround(this.base[i] - CONFIG.bedrock))
          continue;
        const dx = ix * 2 - x,
          dz = iz * 2 - z;
        if (dx * dx + dz * dz >= radius * radius) continue;
        const angle = Math.atan2(iz * 2 - z, ix * 2 - x);
        const edge =
          1 -
          0.055 *
            (1 +
              Math.sin(angle * 7 + x * 0.13) * Math.cos(angle * 11 + z * 0.11));
        let d = Math.hypot(ix * 2 - x, iz * 2 - z) / (radius * edge);
        if (d >= 1) continue;
        const value = Math.fround(
          Math.max(
            Math.min(this.base[i] - CONFIG.bedrock, this.heights[i]),
            this.heights[i] - depth * Math.pow(1 - d * d, 1.45),
          ),
        );
        if (value === this.heights[i]) continue;
        this.heights[i] = value;
        this.changed.set(i, value);
        if (this.trackDirty) this.dirtySamples.set(i, value);
        indices.push(i);
        values.push(value);
        for (
          let cz = clamp(Math.floor((iz * 2 - 2) / 64), 0, CHUNKS - 1);
          cz <= clamp(Math.floor((iz * 2 + 2) / 64), 0, CHUNKS - 1);
          cz++
        )
          for (
            let cx = clamp(Math.floor((ix * 2 - 2) / 64), 0, CHUNKS - 1);
            cx <= clamp(Math.floor((ix * 2 + 2) / 64), 0, CHUNKS - 1);
            cx++
          )
            chunks.add(cz * CHUNKS + cx);
      }
    for (const id of chunks) this.sectionVersions[id]++;
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
    const cx = section % CHUNKS,
      cz = Math.floor(section / CHUNKS);
    const x0 = cx * CHUNK_SAMPLES,
      x1 = cx === CHUNKS - 1 ? CONFIG.grid - 1 : x0 + CHUNK_SAMPLES - 1;
    const z0 = cz * CHUNK_SAMPLES,
      z1 = cz === CHUNKS - 1 ? CONFIG.grid - 1 : z0 + CHUNK_SAMPLES - 1;
    const key = x + ":" + z + ":" + radius + ":" + section;
    let cached = this.laserShapes.get(key);
    if (!cached) {
      const ids: number[] = [],
        shapes: number[] = [];
      for (let iz = z0; iz <= z1; iz++)
        for (let ix = x0; ix <= x1; ix++) {
          const d = Math.hypot(ix * 2 - x, iz * 2 - z) / radius;
          if (d >= 1) continue;
          const rim = clamp((d - 0.65) / 0.35, 0, 1);
          ids.push(iz * CONFIG.grid + ix);
          shapes.push(1 - rim * rim * (3 - 2 * rim));
        }
      cached = {
        indices: new Uint32Array(ids),
        shapes: new Float64Array(shapes),
      };
      this.laserShapes.set(key, cached);
      if (this.laserShapes.size > 4096)
        this.laserShapes.delete(this.laserShapes.keys().next().value!);
    }
    for (let k = 0; k < cached.indices.length; k++) {
      const i = cached.indices[k],
        ix = i % CONFIG.grid,
        iz = Math.floor(i / CONFIG.grid),
        shape = cached.shapes[k];
      if (!this.laserDry[i]) {
        this.laserDry[i] = 1;
        this.dryIndices.add(i);
        if (this.trackDirty) this.dirtyDry.add(i);
        this.flooded[i] = 0;
        dry.push(i);
      }
      const value = Math.fround(
        Math.min(
          this.heights[i],
          this.base[i] - depth * clamp(progress, 0, 1) * shape,
        ),
      );
      if (value === this.heights[i]) continue;
      this.heights[i] = value;
      this.changed.set(i, value);
      if (this.trackDirty) this.dirtySamples.set(i, value);
      indices.push(i);
      values.push(value);
      for (
        let zz = clamp(Math.floor((iz * 2 - 2) / 64), 0, CHUNKS - 1);
        zz <= clamp(Math.floor((iz * 2 + 2) / 64), 0, CHUNKS - 1);
        zz++
      )
        for (
          let xx = clamp(Math.floor((ix * 2 - 2) / 64), 0, CHUNKS - 1);
          xx <= clamp(Math.floor((ix * 2 + 2) / 64), 0, CHUNKS - 1);
          xx++
        )
          chunks.add(zz * CHUNKS + xx);
    }
    for (const id of chunks) this.sectionVersions[id]++;
    if (dry.length)
      for (let z = Math.max(0, cz - 1); z <= Math.min(CHUNKS - 1, cz + 1); z++)
        for (
          let x = Math.max(0, cx - 1);
          x <= Math.min(CHUNKS - 1, cx + 1);
          x++
        )
          this.sectionVersions[z * CHUNKS + x]++;
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
    this.dryIndices.clear();
    this.dirtyDry.clear();
    for (const i of dry)
      if (i < this.laserDry.length) {
        this.laserDry[i] = 1;
        this.dryIndices.add(i);
      }
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
        if (this.trackDirty) this.dirtySamples.set(i, value);
      }
    }
    for (let i = 0; i < this.sectionVersions.length; i++)
      this.sectionVersions[i]++;
    this.initializeFlood();
  }
  reset() {
    for (let i = 0; i < this.sectionVersions.length; i++)
      this.sectionVersions[i]++;
    this.laserDry.fill(0);
    this.dryIndices.clear();
    this.dirtyDry.clear();
    this.heights.set(this.base);
    this.changed.clear();
    this.laserShapes.clear();
    this.dirtySamples.clear();
    this.initializeFlood();
  }
}
