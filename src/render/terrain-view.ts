import { terrainSurfaceColor, terrainScarColor } from "./terrain-colors";
import { TerrainMesher, type SectionData } from "./terrain-mesher";
import { TerrainTextureUploads } from "./terrain-texture-uploads";
import type { TerrainJob, TerrainResult } from "./terrain-mesh-worker";
import * as THREE from "three";
import { pathIndex } from "../world/generator.mjs";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { WorldData, TerrainPatch } from "../types";
import { CONFIG, CHUNKS, clamp, DEFAULT_RENDER_DISTANCE } from "../config";
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
  private mesher: TerrainMesher;
  private worker?: Worker;
  private textureUploads?: TerrainTextureUploads;
  enableStreamingUploads() {
    this.textureUploads ??= new TerrainTextureUploads(
      this.heightTexture,
      this.floodTexture,
    );
  }
  uploadTextures(renderer: THREE.WebGLRenderer, budgetMS: number) {
    return this.textureUploads?.flush(renderer, Math.max(0, budgetMS)) ?? 0;
  }
  get textureQueue() {
    return this.textureUploads?.pending ?? 0;
  }
  get workerActive() {
    return !!this.worker;
  }
  private epoch = 1;
  private serial = 0;
  private inFlight = new Map<number, number>();
  private completed: TerrainResult[] = [];
  private activeTiles = new Set<number>();
  private dirtyTiles = new Set<number>();
  private requestedSteps = new Uint8Array(CHUNKS * CHUNKS);
  private editRevisions = new Uint32Array(CHUNKS * CHUNKS);
  private lastCell = -1;
  private lastDistance = 0;
  private lastDetail = 0;
  private coarseIndices?: Uint16Array | Uint32Array;
  private coarse?: THREE.Mesh;
  private coarseCovered = new Uint8Array(CHUNKS * CHUNKS);
  private coarseColor = new THREE.Color();
  private coarseBaseColors = new Float32Array((CHUNKS + 1) ** 2 * 3).fill(NaN);
  private coarseDirty = new Set<number>();
  private sandColor = new THREE.Color("#a69c73");
  private scarColor = new THREE.Color();
  queueDepth = 0;
  workerMS = 0;
  private castleBounds: WorldData["castleBounds"][];
  private pathBounds: number[];
  private roadDistance: (x: number, z: number) => number;
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
    this.mesher = new TerrainMesher(world);
    this.castleBounds = world.castles?.map((c) => c.bounds) ?? [
      world.castleBounds,
    ];
    if (typeof Worker !== "undefined") {
      this.worker = new Worker(
        new URL("./terrain-mesh-worker.ts", import.meta.url),
        { type: "module" },
      );
      this.worker.postMessage({
        type: "init",
        world: {
          paths: world.paths,
          castleBounds: world.castleBounds,
          castles: world.castles,
        },
      });
      this.worker.onmessage = (event: MessageEvent<TerrainResult>) => {
        const result = event.data;
        if (result.epoch !== this.epoch) return;
        this.inFlight.delete(result.tile);
        if (
          !this.activeTiles.has(result.tile) ||
          result.members.some(
            (c) =>
              c.revision !== this.editRevisions[c.id] ||
              c.step !== this.requestedSteps[c.id],
          )
        ) {
          if (this.activeTiles.has(result.tile))
            this.dirtyTiles.add(result.tile);
          return;
        }
        this.completed.push(result);
        this.workerMS = result.buildMS;
      };
      this.worker.onerror = (event) => {
        console.error("Terrain meshing worker failed", event.message);
        this.worker?.terminate();
        this.worker = undefined;
        this.inFlight.clear();
        for (const [key, tile] of this.tiles) {
          this.group.remove(tile.mesh);
          tile.mesh.geometry.dispose();
          this.coverCoarse(key, false);
        }
        this.tiles.clear();
        this.completed.length = 0;
        for (const c of this.chunks) {
          c.step = 0;
          c.dirty = true;
        }
      };
    }
    this.roadDistance = pathIndex(world.paths);
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
    this.material.onBeforeCompile = (shader) => {
      // A neutral detail texture lets vertex colors distinguish grass from rock.
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <map_fragment>",
        "#include <map_fragment>\n diffuseColor.rgb = vec3(dot(diffuseColor.rgb, vec3(.2126,.7152,.0722)));",
      );
    };
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
          !this.worker &&
          Math.hypot(
            x * 64 + 32 - world.spawn[0],
            z * 64 + 32 - world.spawn[2],
          ) < 1600
        )
          this.build(c, 16);
      }
    {
      const g = new THREE.PlaneGeometry(
        CONFIG.worldSize,
        CONFIG.worldSize,
        CHUNKS,
        CHUNKS,
      );
      g.rotateX(-Math.PI / 2);
      g.translate(CONFIG.worldSize / 2, 0, CONFIG.worldSize / 2);
      g.setAttribute(
        "color",
        new THREE.BufferAttribute(
          new Float32Array(g.getAttribute("position").count * 3),
          3,
        ),
      );
      g.setAttribute(
        "uv",
        new THREE.BufferAttribute(
          new Float32Array(g.getAttribute("position").count * 2),
          2,
        ),
      );
      this.coarseIndices = (g.index!.array as Uint16Array).slice();
      this.coarse = new THREE.Mesh(g, this.material);
      this.coarse.receiveShadow = true;
      this.coarse.matrixAutoUpdate = false;
      this.refreshCoarse();
      this.group.add(this.coarse);
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

    result = this.roadDistance(x, z);
    return result;
  }
  private section(id: number): SectionData {
    const x = (id % CHUNKS) * 32,
      z = Math.floor(id / CHUNKS) * 32;
    const originX = Math.max(0, x - 2),
      originZ = Math.max(0, z - 2);
    const width = Math.min(CONFIG.grid - 1, x + 34) - originX + 1;
    const height = Math.min(CONFIG.grid - 1, z + 34) - originZ + 1;
    const heights = new Float32Array(width * height),
      base = new Float32Array(width * height);
    for (let row = 0; row < height; row++) {
      const offset = (originZ + row) * CONFIG.grid + originX;
      heights.set(this.heights.subarray(offset, offset + width), row * width);
      base.set(this.base.subarray(offset, offset + width), row * width);
    }
    return { id, originX, originZ, width, heights, base };
  }
  private build(chunk: Chunk, step: number) {
    this.mesher.section = this.section(chunk.id);
    this.mesher.build(chunk, step);
  }

  private refresh(chunk: Chunk) {
    const geo = chunk.mesh.geometry,
      positions = geo.getAttribute("position"),
      normals = geo.getAttribute("normal"),
      colors = geo.getAttribute("color");
    const earth = new THREE.Color(),
      baseColors = chunk.baseColors!;
    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i),
        z = positions.getZ(i),
        h = this.sample(x, z),
        dx = this.sample(x - 2, z) - this.sample(x + 2, z),
        dz = this.sample(x, z - 2) - this.sample(x, z + 2),
        length = Math.hypot(dx, 4, dz),
        damage = this.sample(x, z, this.base) - h,
        mix = damage > 0.05 ? clamp(damage / 0.3, 0, 1) : 0;
      terrainScarColor(earth, x, z, h, damage, Math.hypot(dx, dz) / 4);
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

  update(
    camera: THREE.Vector3,
    renderDistance = DEFAULT_RENDER_DISTANCE,
    budgetMS = 2,
    detailScale = 1,
  ) {
    const coarseStarted = performance.now();
    this.refreshCoarse(false, Math.min(0.35, Math.max(0, budgetMS) * 0.25));
    budgetMS = Math.max(0, budgetMS - (performance.now() - coarseStarted));
    if (this.worker) {
      this.updateAsync(camera, renderDistance, budgetMS, detailScale);
      return;
    }
    let rebuilt = 0;
    const started = performance.now();
    const visible: { c: Chunk; d: number }[] = [];
    for (const c of this.chunks) {
      const d = Math.hypot(
        (c.id % CHUNKS) * 64 + 32 - camera.x,
        Math.floor(c.id / CHUNKS) * 64 + 32 - camera.z,
      );
      c.mesh.castShadow = d < 260;
      c.mesh.visible = d < renderDistance + 64 && c.step !== 0;
      if (d < renderDistance + 100) visible.push({ c, d });
      else if (d > renderDistance + 500 && c.step !== 0) {
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
        c.mesh.visible = d < renderDistance + 64;
        rebuilt++;
      }
    }
    this.batch(visible.filter(({ d }) => d < renderDistance + 64));
  }

  private updateAsync(
    camera: THREE.Vector3,
    distance: number,
    budgetMS: number,
    detailScale: number,
  ) {
    const started = performance.now(),
      cell = Math.floor(camera.x / 32) + Math.floor(camera.z / 32) * 192;
    if (
      cell !== this.lastCell ||
      distance !== this.lastDistance ||
      detailScale !== this.lastDetail
    ) {
      this.lastCell = cell;
      this.lastDistance = distance;
      this.lastDetail = detailScale;
      const next = new Set<number>(),
        tilesPerRow = CHUNKS / 4;
      const x0 = clamp(
          Math.floor((camera.x - distance - 160) / 256),
          0,
          tilesPerRow - 1,
        ),
        x1 = clamp(
          Math.floor((camera.x + distance + 160) / 256),
          0,
          tilesPerRow - 1,
        );
      const z0 = clamp(
          Math.floor((camera.z - distance - 160) / 256),
          0,
          tilesPerRow - 1,
        ),
        z1 = clamp(
          Math.floor((camera.z + distance + 160) / 256),
          0,
          tilesPerRow - 1,
        );
      for (let z = z0; z <= z1; z++)
        for (let x = x0; x <= x1; x++) {
          if (
            (x * 256 + 128 - camera.x) ** 2 + (z * 256 + 128 - camera.z) ** 2 >
            (distance + 320) ** 2
          )
            continue;
          const key = z * tilesPerRow + x;
          next.add(key);
          let dirty = !this.activeTiles.has(key);
          for (let dz = 0; dz < 4; dz++)
            for (let dx = 0; dx < 4; dx++) {
              const id = (z * 4 + dz) * CHUNKS + x * 4 + dx,
                d =
                  Math.hypot(
                    x * 256 + dx * 64 + 32 - camera.x,
                    z * 256 + dz * 64 + 32 - camera.z,
                  ) / detailScale;
              const old = this.requestedSteps[id];
              const step = d < 240 ? 2 : d < 600 ? 4 : d < 1000 ? 8 : 16;
              // Keep a 12% overlap around thresholds to prevent repeated LOD churn.
              const thresholds = [0, 0, 240, 0, 600, 0, 0, 0, 1000];
              const keep =
                old &&
                old !== step &&
                Math.abs(d - (thresholds[Math.min(old, step)] || 1000)) < 45;
              if (!keep && old !== step) {
                this.requestedSteps[id] = step;
                dirty = true;
              }
            }
          if (dirty) this.dirtyTiles.add(key);
          const tile = this.tiles.get(key);
          if (tile) {
            tile.mesh.castShadow =
              Math.hypot(x * 256 + 128 - camera.x, z * 256 + 128 - camera.z) <
              400;
            if (!tile.mesh.parent) {
              this.group.add(tile.mesh);
              this.coverCoarse(key, true);
            }
          }
        }
      for (const key of this.activeTiles)
        if (!next.has(key)) {
          const tile = this.tiles.get(key);
          if (tile) this.group.remove(tile.mesh);
          this.coverCoarse(key, false);
          this.dirtyTiles.delete(key);
        }
      this.activeTiles = next;
      // Bounded LRU for GPU tiles. Detached tiles avoid scene traversal.
      for (const [key, tile] of this.tiles)
        if (this.tiles.size > 160 && !next.has(key)) {
          tile.mesh.geometry.dispose();
          this.tiles.delete(key);
          this.coverCoarse(key, false);
        }
    }
    while (this.completed.length && performance.now() - started < budgetMS) {
      const r = this.completed.shift()!;
      if (r.epoch !== this.epoch || !this.activeTiles.has(r.tile)) continue;
      if (
        r.members.some(
          (c) =>
            c.revision !== this.editRevisions[c.id] ||
            c.step !== this.requestedSteps[c.id],
        )
      ) {
        this.dirtyTiles.add(r.tile);
        continue;
      }
      const g = new THREE.BufferGeometry();
      for (const [name, array, size] of [
        ["position", r.position, 3],
        ["normal", r.normal, 3],
        ["color", r.color, 3],
        ["uv", r.uv, 2],
      ] as const)
        g.setAttribute(name, new THREE.BufferAttribute(array, size));
      g.setIndex(new THREE.BufferAttribute(r.index, 1));
      g.boundingSphere = new THREE.Sphere(
        new THREE.Vector3(...r.sphere.slice(0, 3)),
        r.sphere[3],
      );
      let tile = this.tiles.get(r.tile);
      if (tile) {
        tile.mesh.geometry.dispose();
        tile.mesh.geometry = g;
      } else {
        const mesh = new THREE.Mesh(g, this.material);
        mesh.receiveShadow = true;
        mesh.matrixAutoUpdate = false;
        this.tiles.set(
          r.tile,
          (tile = { mesh, signature: "", members: new Set() }),
        );
      }
      tile.members.clear();
      for (const c of r.members) {
        const chunk = this.chunks[c.id];
        chunk.step = c.step;
        chunk.dirty = false;
        chunk.revision = c.revision;
        tile.members.add(c.id);
      }
      this.group.add(tile.mesh);
      this.coverCoarse(r.tile, true);
    }
    while (
      this.inFlight.size < 2 &&
      performance.now() - started < budgetMS &&
      this.dirtyTiles.size
    ) {
      let key = -1,
        best = Infinity;
      for (const k of this.dirtyTiles) {
        if (this.inFlight.has(k)) continue;
        const d =
          ((k % (CHUNKS / 4)) * 256 + 128 - camera.x) ** 2 +
          (Math.floor(k / (CHUNKS / 4)) * 256 + 128 - camera.z) ** 2;
        if (d < best) {
          best = d;
          key = k;
        }
      }
      if (key < 0) break;
      this.dirtyTiles.delete(key);
      if (!this.activeTiles.has(key)) continue;
      const sections: TerrainJob["sections"] = [],
        transfer: ArrayBuffer[] = [];
      const x = (key % (CHUNKS / 4)) * 4,
        z = Math.floor(key / (CHUNKS / 4)) * 4;
      for (let dz = 0; dz < 4; dz++)
        for (let dx = 0; dx < 4; dx++) {
          const id = (z + dz) * CHUNKS + x + dx,
            section = this.section(id);
          sections.push({
            ...section,
            step: this.requestedSteps[id] || 16,
            revision: this.editRevisions[id],
          });
          transfer.push(
            section.heights.buffer as ArrayBuffer,
            section.base.buffer as ArrayBuffer,
          );
        }
      const serial = ++this.serial;
      this.inFlight.set(key, serial);
      this.worker!.postMessage(
        {
          type: "mesh",
          job: { epoch: this.epoch, tile: key, serial, sections },
        },
        transfer,
      );
    }
    this.queueDepth =
      this.dirtyTiles.size + this.completed.length + this.inFlight.size;
  }
  private coverCoarseChunk(id: number, covered: boolean) {
    if (
      !this.coarse ||
      !this.coarseIndices ||
      this.coarseCovered[id] === Number(covered)
    )
      return;
    this.coarseCovered[id] = Number(covered);
    const index = this.coarse.geometry.index!,
      start = id * 6;
    for (let i = start; i < start + 6; i++)
      index.array[i] = covered ? 0 : this.coarseIndices[i];
    index.addUpdateRange(start, 6);
    index.needsUpdate = true;
  }
  private coverCoarse(tile: number, covered: boolean) {
    const x = (tile % (CHUNKS / 4)) * 4,
      z = Math.floor(tile / (CHUNKS / 4)) * 4;
    for (let row = z; row < z + 4; row++)
      for (let col = x; col < x + 4; col++)
        this.coverCoarseChunk(row * CHUNKS + col, covered);
  }
  private refreshCoarse(full = true, budgetMS = Infinity) {
    if (!this.coarse) return;
    const geometry = this.coarse.geometry;
    const p = geometry.getAttribute("position") as THREE.BufferAttribute,
      n = geometry.getAttribute("normal") as THREE.BufferAttribute,
      colors = geometry.getAttribute("color") as THREE.BufferAttribute,
      uv = geometry.getAttribute("uv") as THREE.BufferAttribute;
    const update = (i: number) => {
      const x = p.getX(i),
        z = p.getZ(i),
        h = this.sample(x, z),
        base = this.sample(x, z, this.base);
      const dx = this.sample(x - 2, z) - this.sample(x + 2, z),
        dz = this.sample(x, z - 2) - this.sample(x, z + 2),
        length = Math.hypot(dx, 4, dz);
      if (Number.isNaN(this.coarseBaseColors[i * 3])) {
        const slope =
          Math.hypot(
            this.sample(x - 2, z, this.base) - this.sample(x + 2, z, this.base),
            this.sample(x, z - 2, this.base) - this.sample(x, z + 2, this.base),
          ) * 0.25;
        terrainSurfaceColor(this.coarseColor, x, z, base, slope);
        if (
          this.pathDistance(x, z) < 3.2 ||
          this.castleBounds.some(
            (b) => x > b.min[0] && x < b.max[0] && z > b.min[1] && z < b.max[1],
          )
        )
          this.coarseColor.set("#a5966f");
        if (base < 6)
          this.coarseColor.lerp(
            this.sandColor,
            clamp((6 - base) / 6, 0, 1) * 0.85,
          );
        this.coarseColor.toArray(this.coarseBaseColors, i * 3);
      } else this.coarseColor.fromArray(this.coarseBaseColors, i * 3);
      const damage = base - h;
      if (damage > 0.05) {
        terrainScarColor(
          this.scarColor,
          x,
          z,
          h,
          damage,
          Math.hypot(dx, dz) * 0.25,
        );
        this.coarseColor.lerp(this.scarColor, clamp(damage / 0.3, 0, 1));
      }
      p.setY(i, h - 1);
      n.setXYZ(i, dx / length, 4 / length, dz / length);
      colors.setXYZ(
        i,
        this.coarseColor.r,
        this.coarseColor.g,
        this.coarseColor.b,
      );
      uv.setXY(i, x * 0.07, z * 0.07);
      if (!full) {
        p.addUpdateRange(i * 3, 3);
        n.addUpdateRange(i * 3, 3);
        colors.addUpdateRange(i * 3, 3);
      }
    };
    if (full) {
      this.coarseDirty.clear();
      for (let i = 0; i < p.count; i++) update(i);
      uv.needsUpdate = true;
      // Damage only lowers terrain. Reserve depth once rather than scanning every patch.
      geometry.computeBoundingBox();
      geometry.boundingBox!.min.y = Math.min(
        -1024,
        geometry.boundingBox!.min.y,
      );
      geometry.boundingBox!.max.y = Math.max(
        CONFIG.ceiling,
        geometry.boundingBox!.max.y,
      );
      geometry.boundingSphere = geometry.boundingBox!.getBoundingSphere(
        new THREE.Sphere(),
      );
    } else {
      if (!this.coarseDirty.size || budgetMS <= 0) return;
      const deadline = performance.now() + budgetMS;
      for (const i of this.coarseDirty) {
        if (performance.now() >= deadline) break;
        update(i);
        this.coarseDirty.delete(i);
      }
    }
    p.needsUpdate = n.needsUpdate = colors.needsUpdate = true;
  }
  private queueCoarse(chunks: number[]) {
    // Neighboring samples keep normals current on edit edges. The set is bounded by the backdrop grid.
    for (const id of chunks) {
      const x = id % CHUNKS,
        z = Math.floor(id / CHUNKS);
      for (let row = Math.max(0, z - 1); row <= Math.min(CHUNKS, z + 2); row++)
        for (
          let col = Math.max(0, x - 1);
          col <= Math.min(CHUNKS, x + 2);
          col++
        )
          this.coarseDirty.add(row * (CHUNKS + 1) + col);
    }
  }

  dispose() {
    this.textureUploads?.dispose();
    this.worker?.terminate();
    this.completed.length = 0;
    this.coarseDirty.clear();
    this.inFlight.clear();
    for (const tile of this.tiles.values()) tile.mesh.geometry.dispose();
    this.tiles.clear();
    this.coarse?.geometry.dispose();
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
    for (const c of this.chunks) {
      const key =
        Math.floor((c.id % CHUNKS) / 4) +
        Math.floor(c.id / CHUNKS / 4) * (CHUNKS / 4);
      const tile = this.tiles.get(key);
      this.coverCoarseChunk(
        c.id,
        !!(c.mesh.visible && c.mesh.parent === this.group) ||
          !!(tile?.mesh.parent && tile.members.has(c.id)),
      );
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
      this.editRevisions[id]++;
      this.dirtyTiles.add(
        Math.floor((id % CHUNKS) / 4) +
          Math.floor(id / CHUNKS / 4) * (CHUNKS / 4),
      );
    }
    this.queueCoarse(p.chunks);
    this.uploadRows(this.heightTexture, p.indices, this.fullHeightUpload);
  }
  private uploadRows(
    texture: THREE.DataTexture,
    indices: Uint32Array,
    full: boolean,
  ) {
    if (this.textureUploads && !full) {
      this.textureUploads.queue(texture, indices);
      return;
    }
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
    this.textureUploads?.reset();
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
  setWaterMask(mask: Uint8Array) {
    this.flood.set(mask);
    this.fullFloodUpload = true;
    this.floodTexture.clearUpdateRanges();
    this.floodTexture.needsUpdate = true;
  }
  setDry(indices: Uint32Array) {
    for (const i of indices) this.flood[i] = 0;
    this.uploadRows(this.floodTexture, indices, this.fullFloodUpload);
  }
  restore(h: Float32Array) {
    this.textureUploads?.reset();
    this.heights.set(h);
    this.refreshCoarse();
    this.epoch++;
    this.inFlight.clear();
    this.completed.length = 0;
    if (this.worker) {
      for (const tile of this.tiles.values()) {
        this.group.remove(tile.mesh);
        tile.mesh.geometry.dispose();
      }
      this.tiles.clear();
      if (this.coarse && this.coarseIndices) {
        this.coarseCovered.fill(0);
        this.coarse.geometry.index!.array.set(this.coarseIndices);
        this.coarse.geometry.index!.needsUpdate = true;
      }
    }
    this.editRevisions.fill(0);
    this.lastCell = -1;
    for (const key of this.activeTiles) this.dirtyTiles.add(key);
    for (const c of this.chunks) c.dirty = true;
    this.fullHeightUpload = true;
    this.heightTexture.clearUpdateRanges();
    this.heightTexture.needsUpdate = true;
  }
}
