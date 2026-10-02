import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { WorldData, TerrainPatch } from "../types";
import { CONFIG, CHUNKS, clamp } from "../config";
interface Chunk {
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  step: number;
  id: number;
  dirty: boolean;
  revision: number;
  baseColors?: Float32Array;
}
export class TerrainView {
  readonly group = new THREE.Group();
  readonly chunks: Chunk[] = [];
  readonly flood: Uint8Array;
  readonly floodTexture: THREE.DataTexture;
  readonly heightTexture: THREE.DataTexture;
  readonly base: Float32Array;
  readonly material: THREE.MeshStandardMaterial;
  private pathBounds: number[];
  private fullHeightUpload = true;
  private fullFloodUpload = true;
  private tiles = new Map<
    number,
    {
      mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
      signature: string;
      members: Set<number>;
    }
  >();
  constructor(
    readonly world: WorldData,
    public heights: Float32Array,
    grass: THREE.Texture,
  ) {
    const points = world.paths.flat();
    this.pathBounds = [
      Math.min(...points.map((p) => p[0])) - 6,
      Math.max(...points.map((p) => p[0])) + 6,
      Math.min(...points.map((p) => p[1])) - 6,
      Math.max(...points.map((p) => p[1])) + 6,
    ];
    this.base = heights.slice();
    this.flood = new Uint8Array(CONFIG.grid * CONFIG.grid);
    this.floodTexture = new THREE.DataTexture(
      this.flood,
      CONFIG.grid,
      CONFIG.grid,
      THREE.RedFormat,
    );
    this.floodTexture.needsUpdate = true;
    this.heightTexture = new THREE.DataTexture(
      heights,
      CONFIG.grid,
      CONFIG.grid,
      THREE.RedFormat,
      THREE.FloatType,
    );
    this.heightTexture.needsUpdate = true;
    this.heightTexture.onUpdate = () => {
      this.fullHeightUpload = false;
    };
    this.floodTexture.onUpdate = () => {
      this.fullFloodUpload = false;
    };
    this.material = new THREE.MeshStandardMaterial({
      map: grass,
      vertexColors: true,
      roughness: 0.93,
    });
    for (let z = 0; z < CHUNKS; z++)
      for (let x = 0; x < CHUNKS; x++) {
        let mesh = new THREE.Mesh(new THREE.BufferGeometry(), this.material);
        mesh.receiveShadow = true;
        mesh.castShadow = true;

        this.chunks.push({
          mesh,
          step: 8,
          id: z * CHUNKS + x,
          dirty: true,
          revision: 0,
        });
        const c = this.chunks.at(-1)!;
        c.step = 0;
        c.mesh.visible = false;
        if (
          Math.hypot(
            x * 64 + 32 - world.spawn[0],
            z * 64 + 32 - world.spawn[2],
          ) < 1600
        )
          this.build(c, 16);
      }
  }
  sample(x: number, z: number, heights = this.heights) {
    const gx = clamp(x / 2, 0, CONFIG.grid - 1.0001),
      gz = clamp(z / 2, 0, CONFIG.grid - 1.0001),
      ix = Math.floor(gx),
      iz = Math.floor(gz),
      u = gx - ix,
      v = gz - iz,
      i = iz * CONFIG.grid + ix,
      a = heights[i],
      b = heights[i + 1],
      c = heights[i + CONFIG.grid],
      d = heights[i + (CONFIG.grid + 1)];
    return u + v <= 1
      ? a + (b - a) * u + (c - a) * v
      : d + (c - d) * (1 - u) + (b - d) * (1 - v);
  }
  private pathDistance(x: number, z: number) {
    let result = 1e9;
    if (
      x < this.pathBounds[0] ||
      x > this.pathBounds[1] ||
      z < this.pathBounds[2] ||
      z > this.pathBounds[3]
    )
      return result;

    for (const path of this.world.paths)
      for (let i = 1; i < path.length; i++) {
        let a = path[i - 1],
          b = path[i],
          dx = b[0] - a[0],
          dz = b[1] - a[1],
          t = clamp(
            ((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz),
            0,
            1,
          );
        result = Math.min(
          result,
          Math.hypot(x - a[0] - t * dx, z - a[1] - t * dz),
        );
      }
    return result;
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
  private build(chunk: Chunk, step: number) {
    const cx = (chunk.id % CHUNKS) * 64,
      cz = Math.floor(chunk.id / CHUNKS) * 64;
    const positions: number[] = [],
      colors: number[] = [],
      baseColors: number[] = [],
      uv: number[] = [],
      normals: number[] = [],
      indices: number[] = [];
    const cache = new Map<string, number>(),
      c = new THREE.Color(),
      stone = new THREE.Color("#8c9187"),
      sand = new THREE.Color("#a69c73"),
      earth = new THREE.Color("#705139");
    const vertex = (x: number, z: number) => {
      const key = `${x},${z}`,
        cached = cache.get(key);
      if (cached !== undefined) return cached;
      const index = positions.length / 3,
        wx = cx + x,
        wz = cz + z,
        h = this.sample(wx, wz),
        dx = this.sample(wx - 2, wz) - this.sample(wx + 2, wz),
        dz = this.sample(wx, wz - 2) - this.sample(wx, wz + 2),
        length = Math.hypot(dx, 4, dz),
        baseHeight = this.sample(wx, wz, this.base),
        slope =
          Math.hypot(
            this.sample(wx - 2, wz, this.base) -
              this.sample(wx + 2, wz, this.base),
            this.sample(wx, wz - 2, this.base) -
              this.sample(wx, wz + 2, this.base),
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
        (wx > this.world.castleBounds.min[0] &&
          wx < this.world.castleBounds.max[0] &&
          wz > this.world.castleBounds.min[1] &&
          wz < this.world.castleBounds.max[1])
      )
        c.set("#a5966f");
      if (baseHeight < 1) c.lerp(sand, 0.65);
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
  private refresh(chunk: Chunk) {
    // Cratering preserves topology. Update existing GPU attributes instead of
    // allocating indices, UVs, vertex maps and geometry for every blast batch.
    const geo = chunk.mesh.geometry,
      positions = geo.getAttribute("position"),
      normals = geo.getAttribute("normal"),
      colors = geo.getAttribute("color"),
      earth = new THREE.Color("#705139"),
      baseColors = chunk.baseColors!;
    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i),
        z = positions.getZ(i),
        h = this.sample(x, z),
        dx = this.sample(x - 2, z) - this.sample(x + 2, z),
        dz = this.sample(x, z - 2) - this.sample(x, z + 2),
        length = Math.hypot(dx, 4, dz),
        damage = this.sample(x, z, this.base) - h,
        mix = damage > 0.1 ? clamp(damage / 0.6, 0, 1) : 0;
      this.scar(earth, x, z, h, damage, Math.hypot(dx, dz) / 4);
      positions.setY(i, h);
      normals.setXYZ(i, dx / length, 4 / length, dz / length);
      colors.setXYZ(
        i,
        baseColors[i * 3] * (1 - mix) + earth.r * mix,
        baseColors[i * 3 + 1] * (1 - mix) + earth.g * mix,
        baseColors[i * 3 + 2] * (1 - mix) + earth.b * mix,
      );
    }
    positions.needsUpdate = normals.needsUpdate = colors.needsUpdate = true;
    geo.computeBoundingSphere();
    chunk.dirty = false;
    chunk.revision++;
  }
  update(camera: THREE.Vector3) {
    let rebuilt = 0;
    const started = performance.now();
    const visible: { c: Chunk; d: number }[] = [];
    for (const c of this.chunks) {
      const d = Math.hypot(
        (c.id % CHUNKS) * 64 + 32 - camera.x,
        Math.floor(c.id / CHUNKS) * 64 + 32 - camera.z,
      );
      c.mesh.castShadow = d < 260;
      c.mesh.visible = d < 1600 && c.step !== 0;
      if (d < 1700) visible.push({ c, d });
      else if (d > 2100 && c.step !== 0) {
        c.mesh.geometry.dispose();
        c.mesh.geometry = new THREE.BufferGeometry();
        c.baseColors = undefined;
        c.step = 0;
        c.dirty = true;
      }
    }
    // Prioritize missing terrain, then nearby detail. All edits remain in heights,
    // so an unloaded damaged section rebuilds from the authoritative surface.
    visible.sort(
      (a, b) => Number(a.c.step !== 0) - Number(b.c.step !== 0) || a.d - b.d,
    );
    for (const { c, d } of visible) {
      const step = d < 240 ? 2 : d < 600 ? 4 : d < 1000 ? 8 : 16;
      if (
        (c.dirty || c.step !== step) &&
        rebuilt < 4 &&
        (rebuilt === 0 || performance.now() - started < 3)
      ) {
        if (c.step === step) this.refresh(c);
        else this.build(c, step);
        c.mesh.visible = d < 1600;
        rebuilt++;
      }
    }
    this.batch(visible);
  }

  private batch(visible: { c: Chunk; d: number }[]) {
    // Keep editable 64m section geometry, but submit 256m tiles to the GPU.
    // Dirty tiles remain visible until their bounded replacement is ready.
    const groups = new Map<number, { chunks: Chunk[]; distance: number }>();
    for (const { c, d } of visible) {
      if (!c.step) continue;
      const key =
        Math.floor((c.id % CHUNKS) / 4) +
        Math.floor(c.id / CHUNKS / 4) * (CHUNKS / 4);
      let tile = groups.get(key);
      if (!tile) groups.set(key, (tile = { chunks: [], distance: d }));
      tile.chunks.push(c);
      tile.distance = Math.min(tile.distance, d);
    }
    for (const [key, tile] of this.tiles) {
      if (!groups.has(key)) {
        this.group.remove(tile.mesh);
        tile.mesh.geometry.dispose();
        this.tiles.delete(key);
      }
    }
    const started = performance.now();
    let merged = 0;
    for (const [key, group] of [...groups].sort(
      (a, b) => a[1].distance - b[1].distance,
    )) {
      group.chunks.sort((a, b) => a.id - b.id);
      const signature = group.chunks
        .map((c) => `${c.id}:${c.revision}`)
        .join(",");
      let tile = this.tiles.get(key);
      if (
        tile?.signature !== signature &&
        merged < 2 &&
        (merged === 0 || performance.now() - started < 3)
      ) {
        const geometry = mergeGeometries(
          group.chunks.map((c) => c.mesh.geometry),
        )!;
        geometry.computeBoundingSphere();
        if (tile) {
          tile.mesh.geometry.dispose();
          tile.mesh.geometry = geometry;
        } else {
          const mesh = new THREE.Mesh(geometry, this.material);
          mesh.receiveShadow = true;
          this.group.add(mesh);
          this.tiles.set(key, (tile = { mesh, signature, members: new Set() }));
        }
        tile.signature = signature;
        tile.members = new Set(group.chunks.map((c) => c.id));
        merged++;
      }
      if (tile) tile.mesh.castShadow = group.distance < 260;
      for (const c of group.chunks) {
        c.mesh.visible = !tile?.members.has(c.id);
        if (c.mesh.visible && c.mesh.parent !== this.group)
          this.group.add(c.mesh);
        else if (!c.mesh.visible && c.mesh.parent === this.group)
          this.group.remove(c.mesh);
      }
    }
    for (const c of this.chunks)
      if (!c.mesh.visible && c.mesh.parent === this.group)
        this.group.remove(c.mesh);
  }

  patch(p: TerrainPatch) {
    for (let j = 0; j < p.indices.length; j++)
      this.heights[p.indices[j]] = p.values[j];
    for (const id of p.chunks) {
      this.chunks[id].dirty = true;
    }
    this.uploadRows(this.heightTexture, p.indices, this.fullHeightUpload);
  }
  private uploadRows(
    texture: THREE.DataTexture,
    indices: Uint32Array,
    full: boolean,
  ) {
    if (!indices.length) return;
    if (!full) {
      const rows = new Map<number, [number, number]>();
      for (const i of indices) {
        const row = Math.floor(i / CONFIG.grid);
        const range = rows.get(row);
        if (range) {
          range[0] = Math.min(range[0], i);
          range[1] = Math.max(range[1], i);
        } else rows.set(row, [i, i]);
      }
      for (const [start, end] of rows.values())
        texture.addUpdateRange(start, end - start + 1);
    }
    texture.needsUpdate = true;
  }
  fullTextureUpload() {
    this.fullHeightUpload = this.fullFloodUpload = true;
    this.heightTexture.clearUpdateRanges();
    this.floodTexture.clearUpdateRanges();
    this.heightTexture.needsUpdate = this.floodTexture.needsUpdate = true;
  }
  setFlood(indices: Uint32Array, reset = false) {
    if (reset) {
      this.flood.fill(0);
      this.fullFloodUpload = true;
      this.floodTexture.clearUpdateRanges();
      this.floodTexture.needsUpdate = true;
    }
    for (const i of indices) this.flood[i] = 255;
    this.uploadRows(this.floodTexture, indices, this.fullFloodUpload);
  }
  setDry(indices: Uint32Array) {
    for (const i of indices) this.flood[i] = 0;
    this.uploadRows(this.floodTexture, indices, this.fullFloodUpload);
  }
  restore(h: Float32Array) {
    this.heights.set(h);
    for (const c of this.chunks) c.dirty = true;
    this.fullHeightUpload = true;
    this.heightTexture.clearUpdateRanges();
    this.heightTexture.needsUpdate = true;
  }
}
