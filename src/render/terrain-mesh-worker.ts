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
  cacheHits?: number;
  meshesBuilt?: number;
  cacheBytes?: number;
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
type CachedChunk = MeshChunk & { bytes: number };
// Retain alternate LODs so circling/backtracking does not rebuild the same
// unchanged surface. Both entry count and actual array storage are bounded.
const CACHE_BYTES = 32 * 1024 * 1024;
const cache = new Map<number, CachedChunk>();
let cacheBytes = 0,
  cacheHits = 0,
  meshesBuilt = 0;
function clearCache() {
  for (const c of cache.values()) c.mesh.geometry.dispose();
  cache.clear();
  cacheBytes = cacheHits = meshesBuilt = 0;
}
self.onmessage = (
  event: MessageEvent<
    { type: "init"; world: WorldData } | { type: "mesh"; job: TerrainJob }
  >,
) => {
  const m = event.data;
  if (m.type === "init") {
    mesher = new TerrainMesher(m.world);
    clearCache();
    return;
  }
  const { job } = m,
    started = performance.now();
  if (cacheEpoch !== job.epoch) {
    clearCache();
    cacheEpoch = job.epoch;
  }
  const geometries: THREE.BufferGeometry[] = [];
  for (const s of job.sections) {
    const key = s.id * 32 + s.step;
    let c = cache.get(key);
    if (!c)
      c = {
        id: s.id,
        step: 0,
        dirty: true,
        revision: -1,
        bytes: 0,
        mesh: new THREE.Mesh(new THREE.BufferGeometry()),
      };
    if (c.step !== s.step || c.revision !== s.revision) {
      cacheBytes -= c.bytes;
      mesher.section = s;
      mesher.build(c, s.step);
      c.revision = s.revision;
      // Only the synchronous renderer needs these for in-place scar refreshes.
      c.baseColors = undefined;
      c.bytes = c.mesh.geometry.index!.array.byteLength;
      for (const attribute of Object.values(c.mesh.geometry.attributes))
        c.bytes += attribute.array.byteLength;
      cacheBytes += c.bytes;
      meshesBuilt++;
    } else cacheHits++;
    cache.delete(key);
    cache.set(key, c);
    geometries.push(c.mesh.geometry);
  }
  const geometry = mergeGeometries(geometries)!;
  geometry.computeBoundingSphere();
  const sphere = geometry.boundingSphere!;
  // Merging has copied the arrays; cached sections can now be safely evicted.
  while (cache.size > 4096 || cacheBytes > CACHE_BYTES) {
    const key = cache.keys().next().value!;
    const c = cache.get(key)!;
    cacheBytes -= c.bytes;
    c.mesh.geometry.dispose();
    cache.delete(key);
  }
  const result: TerrainResult = {
    epoch: job.epoch,
    tile: job.tile,
    serial: job.serial,
    buildMS: performance.now() - started,
    cacheHits,
    meshesBuilt,
    cacheBytes,
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
};
