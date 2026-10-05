import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import {
  TerrainMesher,
  type SectionData,
  type MeshChunk,
} from "./terrain-mesher";
import type { WorldData } from "../types";
export interface TerrainJob {
  epoch: number;
  tile: number;
  serial: number;
  sections: (SectionData & { step: number; revision: number })[];
}
export interface TerrainResult {
  epoch: number;
  tile: number;
  serial: number;
  buildMS: number;
  members: { id: number; step: number; revision: number }[];
  position: Float32Array;
  normal: Float32Array;
  color: Float32Array;
  uv: Float32Array;
  index: Uint32Array | Uint16Array;
  sphere: number[];
}
let mesher: TerrainMesher;
let cacheEpoch = -1;
const cache = new Map<number, MeshChunk>();
self.onmessage = (
  event: MessageEvent<
    { type: "init"; world: WorldData } | { type: "mesh"; job: TerrainJob }
  >,
) => {
  const m = event.data;
  if (m.type === "init") {
    mesher = new TerrainMesher(m.world);
    for (const c of cache.values()) c.mesh.geometry.dispose();
    cache.clear();
    return;
  }
  const { job } = m,
    started = performance.now();
  if (cacheEpoch !== job.epoch) {
    for (const chunk of cache.values()) chunk.mesh.geometry.dispose();
    cache.clear();
    cacheEpoch = job.epoch;
  }
  const geometries: THREE.BufferGeometry[] = [];
  for (const s of job.sections) {
    let c = cache.get(s.id);
    if (!c)
      c = {
        id: s.id,
        step: 0,
        dirty: true,
        revision: -1,
        mesh: new THREE.Mesh(new THREE.BufferGeometry()),
      };
    if (c.step !== s.step || c.revision !== s.revision) {
      mesher.section = s;
      mesher.build(c, s.step);
      c.revision = s.revision;
    }
    // LRU holds at most 2,048 editable sections; evicted geometry is reconstructible.
    cache.delete(s.id);
    cache.set(s.id, c);
    geometries.push(c.mesh.geometry);
  }
  const geometry = mergeGeometries(geometries)!;
  geometry.computeBoundingSphere();
  const sphere = geometry.boundingSphere!;
  const result: TerrainResult = {
    epoch: job.epoch,
    tile: job.tile,
    serial: job.serial,
    buildMS: performance.now() - started,
    members: job.sections.map((s) => ({
      id: s.id,
      step: s.step,
      revision: s.revision,
    })),
    position: geometry.getAttribute("position").array as Float32Array,
    normal: geometry.getAttribute("normal").array as Float32Array,
    color: geometry.getAttribute("color").array as Float32Array,
    uv: geometry.getAttribute("uv").array as Float32Array,
    index: geometry.index!.array as Uint32Array | Uint16Array,
    sphere: [...sphere.center.toArray(), sphere.radius],
  };
  postMessage(result, [
    result.position.buffer,
    result.normal.buffer,
    result.color.buffer,
    result.uv.buffer,
    result.index.buffer,
  ]);
  geometry.dispose();
  while (cache.size > 2048) {
    const id = cache.keys().next().value!;
    cache.get(id)!.mesh.geometry.dispose();
    cache.delete(id);
  }
};
