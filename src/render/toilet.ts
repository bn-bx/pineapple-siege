import * as THREE from "three";
import type { WorldData } from "../types";
import { ResourceDisposal } from "./resource-disposal";
import manifest from "../world/toilet-manifest.json" with { type: "json" };
interface Chunk {
  owner: number;
  start: number;
  count: number;
}
export interface PackedToilet {
  revision: string;
  vertices: { offset: number; length: number };
  indices: { offset: number; length: number };
  chunks: Chunk[];
}
type Maps = Partial<
  Record<"baseColor" | "metallicRoughness" | "normal", THREE.Texture>
>;
/** The portal toilet: one mesh whose owner index ranges are removed with
 * their entities, from colour, depth and shadow passes together. */
export class ToiletView {
  readonly group = new THREE.Group();
  readonly materials: THREE.MeshStandardMaterial[] = [];
  private refs = new Map<number, { start: number; count: number }>();
  private geometry?: THREE.BufferGeometry;
  private original?: Uint32Array;
  private removed = new Set<number>();
  private disposed = false;
  private loading?: Promise<void>;
  private owners = new Map<number, number>();
  constructor(readonly world: WorldData) {
    const portal = world.portal;
    this.group.name = "portal-toilet";
    if (portal?.base) {
      this.group.position.fromArray(portal.base);
      this.group.rotation.y = portal.yaw ?? 0;
    }
    for (const e of world.entities)
      if (e.visual?.modelOwner !== undefined)
        this.owners.set(e.visual.modelOwner, e.id);
  }
  load() {
    return (this.loading ??= this.loadOnce());
  }
  private async loadOnce() {
    if (!this.owners.size || this.disposed) return;
    const base = "/assets/toilet/",
      suffix = "?revision=" + manifest.revision;
    const get = async (url: string) => {
      const r = await fetch(base + url + suffix);
      if (!r.ok) throw Error(`Toilet asset ${url}: ${r.status}`);
      return r;
    };
    const [packed, data] = await Promise.all([
      get("mesh.json").then((r) => r.json()) as Promise<PackedToilet>,
      get("mesh.bin").then((r) => r.arrayBuffer()),
    ]);
    if (packed.revision !== manifest.revision)
      throw Error("Toilet geometry/owner revision mismatch");
    const maps: Maps = {};
    // Own successful loads even if another texture fails or the scene is reset.
    try {
      const loaded = await Promise.allSettled(
        (["baseColor", "metallicRoughness", "normal"] as const).map(
          async (name) => {
            const t = await new THREE.TextureLoader().loadAsync(
              base + name + ".png" + suffix,
            );
            // glTF UVs keep the image's top row at v = 0.
            t.flipY = false;
            if (name === "baseColor") t.colorSpace = THREE.SRGBColorSpace;
            t.anisotropy = 4;
            maps[name] = t;
          },
        ),
      );
      const failed = loaded.find((r) => r.status === "rejected");
      if (failed?.status === "rejected") throw failed.reason;
      if (this.disposed) {
        for (const t of Object.values(maps)) t.dispose();
        return;
      }
      this.install(packed, data, maps);
    } catch (error) {
      for (const t of Object.values(maps)) t.dispose();
      throw error;
    }
  }
  /** Also used by headless geometry/lifecycle verification. */
  install(packed: PackedToilet, data: ArrayBuffer, maps: Maps = {}) {
    const geometry = new THREE.BufferGeometry(),
      v = new THREE.InterleavedBuffer(
        new Float32Array(data, packed.vertices.offset, packed.vertices.length),
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
        packed.indices.offset,
        packed.indices.length,
      ).slice(),
      index = original.slice();
    for (const c of packed.chunks)
      if (!this.owners.has(c.owner)) index.fill(0, c.start, c.start + c.count);
      else this.refs.set(this.owners.get(c.owner)!, c);
    geometry.setIndex(
      new THREE.BufferAttribute(index, 1).setUsage(THREE.DynamicDrawUsage),
    );
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    const hell = this.world.realm === "hell";
    const material = new THREE.MeshStandardMaterial({
      // Hell keeps the glaze relief but scorches the porcelain.
      color: hell ? "#4a3d39" : "white",
      map: maps.baseColor ?? null,
      normalMap: maps.normal ?? null,
      roughnessMap: maps.metallicRoughness ?? null,
      metalnessMap: maps.metallicRoughness ?? null,
      roughness: 1,
      metalness: 1,
      side: THREE.DoubleSide,
    });
    if (!maps.metallicRoughness) {
      material.roughness = 0.3;
      material.metalness = 0;
    }
    this.materials.push(material);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = mesh.receiveShadow = true;
    this.group.add(mesh);
    this.geometry = geometry;
    this.original = original;
    for (const id of this.removed) this.remove(id);
  }
  remove(id: number) {
    this.removed.add(id);
    const r = this.refs.get(id),
      index = this.geometry?.index;
    if (!r || !index) return;
    (index.array as Uint32Array).fill(0, r.start, r.start + r.count);
    index.addUpdateRange(r.start, r.count);
    index.needsUpdate = true;
  }
  restore(ids: number[]) {
    this.removed.clear();
    const index = this.geometry?.index;
    if (index && this.original) {
      for (const r of this.refs.values())
        index.array.set(
          this.original.subarray(r.start, r.start + r.count),
          r.start,
        );
      index.needsUpdate = true;
    }
    for (const id of ids) this.remove(id);
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
