import * as THREE from "three";
import { pathIndex } from "../world/generator.mjs";
import { CONFIG, CHUNKS, clamp } from "../config";
import type { WorldData } from "../types";
export interface MeshChunk {
  id: number;
  mesh: THREE.Mesh;
  step: number;
  baseColors?: Float32Array;
  dirty: boolean;
  revision: number;
}
export interface SectionData {
  id: number;
  originX: number;
  originZ: number;
  width: number;
  heights: Float32Array;
  base: Float32Array;
}
export class TerrainMesher {
  private roadDistance: (x: number, z: number) => number;
  private castleBounds: WorldData["castleBounds"][];
  section?: SectionData;
  constructor(
    private world: Pick<WorldData, "paths" | "castleBounds" | "castles">,
  ) {
    this.roadDistance = pathIndex(world.paths);
    this.castleBounds = world.castles?.map((c) => c.bounds) ?? [
      world.castleBounds,
    ];
  }
  private pathDistance(x: number, z: number) {
    return this.roadDistance(x, z);
  }
  sample(x: number, z: number, field = this.section!.heights) {
    const s = this.section!;
    const gx = clamp(x / 2, 0, CONFIG.grid - 1.0001) - s.originX;
    const gz = clamp(z / 2, 0, CONFIG.grid - 1.0001) - s.originZ;
    const ix = Math.floor(gx),
      iz = Math.floor(gz),
      u = gx - ix,
      v = gz - iz;
    const i = iz * s.width + ix,
      a = field[i],
      b = field[i + 1],
      c = field[i + s.width],
      d = field[i + s.width + 1];
    return u + v <= 1
      ? a + (b - a) * u + (c - a) * v
      : d + (c - d) * (1 - u) + (b - d) * (1 - v);
  }
  private scar(
    color: THREE.Color,
    x: number,
    z: number,
    h: number,
    damage: number,
    slope: number,
  ) {
    const strata = 0.5 + 0.5 * Math.sin(h * 0.8 + x * 0.025 + z * 0.035);
    const grain =
      0.5 + 0.5 * Math.sin(x * 0.73 + z * 0.29) * Math.cos(z * 0.51 - x * 0.23);
    const rock = clamp((slope - 0.65) * 0.45 + damage / 32, 0, 1);
    color.setRGB(
      0.3 + strata * 0.1 + grain * 0.045,
      0.19 + strata * 0.075 + grain * 0.04,
      0.115 + strata * 0.055 + grain * 0.035,
    );
    const grey = 0.32 + grain * 0.12 + strata * 0.055;
    color.r += (grey - color.r) * rock;
    color.g += (grey * 0.97 - color.g) * rock;
    color.b += (grey * 0.87 - color.b) * rock;
  }
  build(chunk: MeshChunk, step: number) {
    const cx = (chunk.id % CHUNKS) * 64,
      cz = Math.floor(chunk.id / CHUNKS) * 64;
    const positions: number[] = [],
      colors: number[] = [],
      baseColors: number[] = [],
      uv: number[] = [],
      normals: number[] = [],
      indices: number[] = [];
    const cache = new Map<number, number>(),
      c = new THREE.Color(),
      stone = new THREE.Color("#8c9187"),
      sand = new THREE.Color("#a69c73"),
      earth = new THREE.Color("#705139");
    const vertex = (x: number, z: number) => {
      const key = z * 65 + x,
        cached = cache.get(key);
      if (cached !== undefined) return cached;
      const index = positions.length / 3,
        wx = cx + x,
        wz = cz + z,
        h = this.sample(wx, wz),
        dx = this.sample(wx - 2, wz) - this.sample(wx + 2, wz),
        dz = this.sample(wx, wz - 2) - this.sample(wx, wz + 2),
        length = Math.hypot(dx, 4, dz),
        baseHeight = this.sample(wx, wz, this.section!.base),
        slope =
          Math.hypot(
            this.sample(wx - 2, wz, this.section!.base) -
              this.sample(wx + 2, wz, this.section!.base),
            this.sample(wx, wz - 2, this.section!.base) -
              this.sample(wx, wz + 2, this.section!.base),
          ) * 0.25,
        damage = baseHeight - h,
        noise =
          Math.sin(wx * 0.04 + wz * 0.019) *
            Math.sin(wz * 0.063 - wx * 0.02) *
            0.5 +
          0.5;
      positions.push(wx, h, wz);
      normals.push(dx / length, 4 / length, dz / length);
      uv.push(wx * 0.07, wz * 0.07);
      c.setRGB(0.21 + noise * 0.08, 0.34 + noise * 0.09, 0.095 + noise * 0.04);
      c.lerp(
        stone,
        Math.max(
          clamp((slope - 0.6) * 1.4, 0, 1),
          clamp((baseHeight - 135) / 50, 0, 1),
        ),
      );
      if (
        this.pathDistance(wx, wz) < 3.2 ||
        this.castleBounds.some(
          (b) =>
            wx > b.min[0] && wx < b.max[0] && wz > b.min[1] && wz < b.max[1],
        )
      )
        c.set("#a5966f");
      if (baseHeight < 6)
        c.lerp(sand, clamp((6 - baseHeight) / 6, 0, 1) * 0.85);
      baseColors.push(c.r, c.g, c.b);
      this.scar(earth, wx, wz, h, damage, Math.hypot(dx, dz) / 4);
      if (damage > 0.1) c.lerp(earth, clamp(damage / 0.6, 0, 1));
      colors.push(c.r, c.g, c.b);
      cache.set(key, index);
      return index;
    };
    for (let z = 0; z < 64; z += step)
      for (let x = 0; x < 64; x += step) {
        if (step === 2 || (x > 0 && z > 0 && x + step < 64 && z + step < 64)) {
          const a = vertex(x, z),
            b = vertex(x + step, z),
            cc = vertex(x, z + step),
            d = vertex(x + step, z + step);
          indices.push(a, cc, b, d, b, cc);
        } else {
          // Every boundary has identical two-meter samples, regardless of neighbor LOD.
          const edge: number[] = [];
          for (let k = 0; k < step; k += z === 0 ? 2 : step)
            edge.push(vertex(x + k, z));
          for (let k = 0; k < step; k += x + step === 64 ? 2 : step)
            edge.push(vertex(x + step, z + k));
          for (let k = 0; k < step; k += z + step === 64 ? 2 : step)
            edge.push(vertex(x + step - k, z + step));
          for (let k = 0; k < step; k += x === 0 ? 2 : step)
            edge.push(vertex(x, z + step - k));
          const center = vertex(x + step / 2, z + step / 2);
          for (let k = 0; k < edge.length; k++)
            indices.push(center, edge[(k + 1) % edge.length], edge[k]);
        }
      }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(positions, 3),
    );
    geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(indices);
    geo.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
    geo.computeBoundingSphere();
    chunk.mesh.geometry.dispose();
    chunk.mesh.geometry = geo;
    chunk.step = step;
    chunk.baseColors = new Float32Array(baseColors);
    chunk.dirty = false;
    chunk.revision++;
  }
}
