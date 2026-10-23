import * as THREE from "three";
import type { WorldData } from "../types";
import { applyReferenceSurface } from "./reference-surface";
import { ResourceDisposal } from "./resource-disposal";
import manifest from "../world/approved-god-manifest.json" with { type: "json" };
interface Chunk {
  owner: number;
  start: number;
  count: number;
}
interface PackedBatch {
  material: {
    color: string;
    roughness: number;
    metalness: number;
    surface: "head" | "body" | "cloth" | null;
    flat: boolean;
  };
  vertices: { offset: number; length: number };
  indices: { offset: number; length: number };
  chunks: Chunk[];
}
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
    const [packed, data] = await Promise.all([
      get("mesh.json").then((r) => r.json()) as Promise<PackedGod>,
      get("mesh.bin").then((r) => r.arrayBuffer()),
    ]);
    if (packed.revision !== manifest.revision)
      throw Error("Statue geometry/owner revision mismatch");
    const textures: Partial<Record<"head" | "body" | "cloth", THREE.Texture>> =
      {};
    // Own successful loads even if another texture fails or the scene is reset.
    try {
      const loaded = await Promise.allSettled(
        (this.world.realm === "hell"
          ? []
          : (["head", "body", "cloth"] as const)
        ).map(async (name) => {
          const t = await new THREE.TextureLoader().loadAsync(
            base + name + "-surface.png" + suffix,
          );
          t.colorSpace = THREE.SRGBColorSpace;
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
      this.install(packed, data, textures);
    } catch (error) {
      for (const t of Object.values(textures)) t.dispose();
      throw error;
    }
  }
  /** Also used by headless geometry/lifecycle verification. */
  install(
    packed: PackedGod,
    data: ArrayBuffer,
    textures: Partial<Record<"head" | "body" | "cloth", THREE.Texture>> = {},
  ) {
    for (const batch of packed.batches) {
      const chunks = batch.chunks.filter((c) => this.owners.has(c.owner));
      if (!chunks.length) continue;
      const geometry = new THREE.BufferGeometry(),
        v = new THREE.InterleavedBuffer(
          new Float32Array(data, batch.vertices.offset, batch.vertices.length),
          9,
        );
      for (const [name, size, offset] of [
        ["position", 3, 0],
        ["normal", 3, 3],
        ["uv", 2, 6],
        ["surfaceWeight", 1, 8],
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
      const { surface, flat, ...settings } = batch.material;
      const material = new THREE.MeshStandardMaterial({
        ...settings,
        flatShading: flat,
        side: THREE.DoubleSide,
      });
      if (surface && textures[surface])
        applyReferenceSurface(material, textures[surface]!);
      if (this.world.realm === "hell") {
        material.color.set("#3f424b");
        material.map = null;
      }
      this.materials.push(material);
      const mesh = new THREE.Mesh<
        THREE.BufferGeometry,
        THREE.Material | THREE.Material[]
      >(geometry, material);
      mesh.castShadow = mesh.receiveShadow = true;
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
          // MeshStandardMaterial.clone does not retain custom shader callbacks.
          if (surface && textures[surface])
            applyReferenceSurface(eye, textures[surface]!);
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
    for (const id of this.removed) this.remove(id);
  }
  remove(id: number) {
    this.removed.add(id);
    for (const r of this.refs.get(id) ?? []) {
      const index = r.geometry.index!;
      (index.array as Uint32Array).fill(0, r.start, r.start + r.count);
      index.addUpdateRange(r.start, r.count);
      index.needsUpdate = true;
    }
  }
  restore(ids: number[]) {
    this.removed.clear();
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
    this.group.removeFromParent();
    this.refs.clear();
    this.materials.length = 0;
  }
}
