import * as THREE from "three";
import type { WorldData } from "../types";
import { ResourceDisposal } from "./resource-disposal";
import {
  decodeSolid,
  GodWounds,
  type GodSolid,
  type SolidMeta,
} from "./god-solid";
import manifest from "../world/approved-god-manifest.json" with { type: "json" };
import { markStaticCaster } from "./static-shadows";
interface Chunk {
  owner: number;
  start: number;
  count: number;
}
interface PackedBatch {
  material: { color: string; roughness: number; metalness: number };
  vertices: { offset: number; length: number };
  indices: { offset: number; length: number };
  chunks: Chunk[];
}
const WOUND_BUDGET_MS = 4;
export type GodTextures = Partial<
  Record<"baseColor" | "metallicRoughness", THREE.Texture>
>;
export interface PackedGod {
  revision: string;
  hash: string;
  batches: PackedBatch[];
}
/** One approved geometry at every viewing distance. Index edits remove owned
 * triangles from color, depth and shadow passes together, without extra draws. */
export class ApprovedGodView {
  readonly group = new THREE.Group();
  readonly materials: THREE.MeshStandardMaterial[] = [];
  readonly refs = new Map<
    number,
    {
      geometry: THREE.BufferGeometry;
      original: Uint32Array;
      start: number;
      count: number;
    }[]
  >();
  private removed = new Set<number>();
  private disposed = false;
  private loading?: Promise<void>;
  private intensity = 0;
  private owners = new Map<number, number>();
  private ordinals = new Map<number, number>();
  /** Filled interior, when its export matches the loaded geometry. */
  solid?: GodSolid;
  /** Generic stone for broken surfaces. */
  stone?: THREE.MeshStandardMaterial;
  private wounds?: GodWounds;
  private woundsQueued = false;
  constructor(readonly world: WorldData) {
    const site = world.sites.find((s) => s.kind === "pineapple-god");
    this.group.name = "approved-pineapple-god";
    if (site) {
      this.group.position.fromArray(site.p);
      this.group.rotation.y = site.yaw ?? 0;
    }
    for (const e of world.entities)
      if (e.visual?.sculptOwner !== undefined) {
        if (
          world.realm === "hell" &&
          (e.visual.role === "figure" || e.visual.role === "eye")
        )
          continue;
        this.owners.set(e.visual.sculptOwner, e.id);
        this.ordinals.set(e.id, e.visual.sculptOwner);
      }
  }
  load() {
    return (this.loading ??= this.loadOnce());
  }
  private async loadOnce() {
    if (!this.owners.size || this.disposed) return;
    const base = "/assets/pineapple-god/",
      suffix = "?revision=" + manifest.revision;
    const get = async (url: string) => {
      const r = await fetch(base + url + suffix);
      if (!r.ok) throw Error(`Statue asset ${url}: ${r.status}`);
      return r;
    };
    const [packed, data, solid] = await Promise.all([
      get("mesh.json").then((r) => r.json()) as Promise<PackedGod>,
      get("mesh.bin").then((r) => r.arrayBuffer()),
      // The filled interior is optional; without it breaks stay hollow.
      Promise.all([
        get("solid.json").then((r) => r.json()) as Promise<SolidMeta>,
        get("solid.bin").then((r) => r.arrayBuffer()),
      ]).catch((error) => {
        console.warn("Statue interior unavailable", error);
        return undefined;
      }),
    ]);
    if (packed.revision !== manifest.revision)
      throw Error("Statue geometry/owner revision mismatch");
    const textures: GodTextures = {};
    // Own successful loads even if another texture fails or the scene is reset.
    try {
      const loaded = await Promise.allSettled(
        (this.world.realm === "hell"
          ? []
          : (["baseColor", "metallicRoughness"] as const)
        ).map(async (name) => {
          const t = await new THREE.TextureLoader().loadAsync(
            base + name + ".webp" + suffix,
          );
          // glTF UVs: no vertical flip; only base colour is sRGB.
          t.flipY = false;
          if (name === "baseColor") t.colorSpace = THREE.SRGBColorSpace;
          t.anisotropy = 4;
          textures[name] = t;
        }),
      );
      const failed = loaded.find((r) => r.status === "rejected");
      if (failed?.status === "rejected") throw failed.reason;
      if (this.disposed) {
        for (const t of Object.values(textures)) t.dispose();
        return;
      }
      this.install(packed, data, textures, solid);
    } catch (error) {
      for (const t of Object.values(textures)) t.dispose();
      throw error;
    }
  }
  /** Also used by headless geometry/lifecycle verification. */
  install(
    packed: PackedGod,
    data: ArrayBuffer,
    textures: GodTextures = {},
    solid?: [SolidMeta, ArrayBuffer],
  ) {
    if (solid && solid[0].revision === packed.revision) {
      this.solid = decodeSolid(solid[0], new Uint16Array(solid[1]));
      this.stone = new THREE.MeshStandardMaterial({
        color: this.world.realm === "hell" ? "#3a3534" : "#8f897f",
        roughness: 0.95,
        metalness: 0,
      });
      this.wounds = new GodWounds(
        this.solid,
        (ordinal) => this.owners.has(ordinal),
        this.stone,
      );
      this.group.add(this.wounds.mesh);
    }
    for (const batch of packed.batches) {
      const chunks = batch.chunks.filter((c) => this.owners.has(c.owner));
      if (!chunks.length) continue;
      const geometry = new THREE.BufferGeometry(),
        v = new THREE.InterleavedBuffer(
          new Float32Array(data, batch.vertices.offset, batch.vertices.length),
          8,
        );
      for (const [name, size, offset] of [
        ["position", 3, 0],
        ["normal", 3, 3],
        ["uv", 2, 6],
      ] as const)
        geometry.setAttribute(
          name,
          new THREE.InterleavedBufferAttribute(v, size, offset),
        );
      const original = new Uint32Array(
          data,
          batch.indices.offset,
          batch.indices.length,
        ).slice(),
        index = original.slice();
      // Realm filtering keeps the existing infernal aircraft effigy in hell.
      const retained = new Set(chunks.map((c) => c.owner));
      for (const c of batch.chunks)
        if (!retained.has(c.owner)) index.fill(0, c.start, c.start + c.count);
      geometry.setIndex(
        new THREE.BufferAttribute(index, 1).setUsage(THREE.DynamicDrawUsage),
      );
      geometry.computeBoundingBox();
      geometry.computeBoundingSphere();
      const material = new THREE.MeshStandardMaterial({
        ...batch.material,
        map: textures.baseColor ?? null,
        roughnessMap: textures.metallicRoughness ?? null,
        metalnessMap: textures.metallicRoughness ?? null,
        side: THREE.DoubleSide,
      });
      if (this.world.realm === "hell") {
        material.color.set("#3f424b");
        material.metalness = 0.2;
        material.roughness = 0.8;
      }
      this.materials.push(material);
      const mesh = new THREE.Mesh<
        THREE.BufferGeometry,
        THREE.Material | THREE.Material[]
      >(geometry, material);
      mesh.receiveShadow = true;
      markStaticCaster(mesh);
      this.group.add(mesh);
      for (const c of chunks) {
        const id = this.owners.get(c.owner)!,
          refs = this.refs.get(id) ?? [];
        refs.push({ geometry, original, start: c.start, count: c.count });
        this.refs.set(id, refs);
        if (
          this.world.entities.find((e) => e.id === id)?.visual?.role === "eye"
        ) {
          // Separate tiny eye ranges allow reactive emission without illuminating the skull.
          const eye = material.clone();
          eye.emissive.set("#ff1010");
          eye.emissiveIntensity = this.intensity;
          this.materials.push(eye);
          mesh.material = Array.isArray(mesh.material)
            ? [...mesh.material, eye]
            : [material, eye];
        }
      }
      // Material groups coalesce runs; eye owners alone use the emissive material.
      let eyeIndex = 1;
      for (const c of batch.chunks) {
        const id = this.owners.get(c.owner),
          isEye =
            id !== undefined &&
            this.world.entities.find((e) => e.id === id)?.visual?.role ===
              "eye",
          materialIndex = isEye ? eyeIndex++ : 0;
        const last = geometry.groups.at(-1);
        if (
          last &&
          last.materialIndex === materialIndex &&
          last.start + last.count === c.start
        )
          last.count += c.count;
        else geometry.addGroup(c.start, c.count, materialIndex);
      }
    }
    // The skin stays first: debris draws flying pieces with materials[0].
    if (this.stone) this.materials.push(this.stone);
    for (const id of this.removed) this.remove(id);
  }
  remove(id: number) {
    this.removed.add(id);
    const ordinal = this.ordinals.get(id);
    if (this.wounds && ordinal !== undefined) {
      this.wounds.remove(ordinal);
      this.queueWounds();
    }
    for (const r of this.refs.get(id) ?? []) {
      const index = r.geometry.index!;
      (index.array as Uint32Array).fill(0, r.start, r.start + r.count);
      index.addUpdateRange(r.start, r.count);
      index.needsUpdate = true;
    }
  }
  private queueWounds() {
    if (this.woundsQueued) return;
    this.woundsQueued = true;
    // One rebuild per batch of removals; a large break spreads over frames.
    const run = () => {
      if (this.disposed) return;
      if (this.wounds?.update(WOUND_BUDGET_MS)) setTimeout(run, 0);
      else this.woundsQueued = false;
    };
    queueMicrotask(run);
  }
  restore(ids: number[]) {
    this.removed.clear();
    this.wounds?.reset();
    this.queueWounds();
    for (const refs of this.refs.values())
      for (const r of refs) {
        r.geometry.index!.array.set(
          r.original.subarray(r.start, r.start + r.count),
          r.start,
        );
        r.geometry.index!.needsUpdate = true;
      }
    for (const id of ids) this.remove(id);
  }
  setEyeGlow(intensity: number) {
    this.intensity = intensity;
    for (const m of this.materials)
      if (m.emissive.getHex() !== 0) m.emissiveIntensity = intensity;
  }
  dispose(resources: ResourceDisposal) {
    if (this.disposed) return;
    this.disposed = true;
    resources.collect(this.group);
    this.wounds?.dispose();
    this.group.removeFromParent();
    this.refs.clear();
    this.materials.length = 0;
  }
}
