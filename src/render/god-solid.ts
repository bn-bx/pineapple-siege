import * as THREE from "three";
import { markStaticCaster } from "./static-shadows";

/** The god's filled interior: one owner ordinal plus one per 5 m voxel
 * (0 is air), in the god's local frame. See scripts/export-god-solid.mjs. */
export interface GodSolid {
  size: number;
  origin: [number, number, number];
  dims: [number, number, number];
  label: Uint16Array;
  /** Voxel indices held by each owner ordinal. */
  voxels: Map<number, Int32Array>;
}
export interface SolidMeta {
  revision: string;
  size: number;
  origin: [number, number, number];
  dims: [number, number, number];
}

export function decodeSolid(meta: SolidMeta, runs: Uint16Array): GodSolid {
  const [nx, ny, nz] = meta.dims,
    label = new Uint16Array(nx * ny * nz),
    counts = new Map<number, number>();
  for (let r = 0, i = 0; r < runs.length; r += 2) {
    label.fill(runs[r], i, i + runs[r + 1]);
    if (runs[r])
      counts.set(runs[r] - 1, (counts.get(runs[r] - 1) ?? 0) + runs[r + 1]);
    i += runs[r + 1];
  }
  const voxels = new Map<number, Int32Array>(),
    filled = new Map<number, number>();
  for (const [owner, count] of counts) {
    voxels.set(owner, new Int32Array(count));
    filled.set(owner, 0);
  }
  for (let i = 0; i < label.length; i++)
    if (label[i]) {
      const owner = label[i] - 1,
        n = filled.get(owner)!;
      voxels.get(owner)![n] = i;
      filled.set(owner, n + 1);
    }
  return { ...meta, label, voxels };
}

// Face corners in voxel units, wound outward for +x, -x, +y, -y, +z, -z.
const FACES = [
  [1, 0, 0, 1, 1, 0, 1, 1, 1, 1, 0, 1],
  [0, 0, 0, 0, 0, 1, 0, 1, 1, 0, 1, 0],
  [0, 1, 0, 0, 1, 1, 1, 1, 1, 1, 1, 0],
  [0, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1],
  [0, 0, 1, 1, 0, 1, 1, 1, 1, 0, 1, 1],
  [0, 0, 0, 0, 1, 0, 1, 1, 0, 1, 0, 0],
];
/** Corner displacement as a fraction of a voxel; rough broken stone. */
const JITTER = 0.7;
const hash = (x: number, y: number, z: number, axis: number) => {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263);
  h = Math.imul(h ^ Math.imul(z, 2147483647) ^ axis, 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

export function neighbour(solid: GodSolid, index: number, face: number) {
  const [nx, ny, nz] = solid.dims,
    x = index % nx,
    y = Math.floor(index / nx) % ny,
    z = Math.floor(index / (nx * ny));
  switch (face) {
    case 0:
      return x < nx - 1 ? index + 1 : -1;
    case 1:
      return x > 0 ? index - 1 : -1;
    case 2:
      return y < ny - 1 ? index + nx : -1;
    case 3:
      return y > 0 ? index - nx : -1;
    case 4:
      return z < nz - 1 ? index + nx * ny : -1;
    default:
      return z > 0 ? index - nx * ny : -1;
  }
}

/** God-local to output space: a turn about +y, then an offset. */
export interface Placement {
  cos: number;
  sin: number;
  x: number;
  y: number;
  z: number;
}
const corner = new Float64Array(12);
const TRIANGLES = [0, 1, 2, 0, 2, 3];

/** Appends one voxel face as two flat-shaded triangles. Grid corners are
 * jittered by their own coordinates, so a wound and the piece that left it
 * share the same broken surface. */
export function emitFace(
  solid: GodSolid,
  index: number,
  face: number,
  positions: number[],
  normals: number[],
  place?: Placement,
) {
  const [nx, ny] = solid.dims,
    x = index % nx,
    y = Math.floor(index / nx) % ny,
    z = Math.floor(index / (nx * ny)),
    c = FACES[face],
    s = solid.size,
    [ox, oy, oz] = solid.origin;
  for (let q = 0; q < 4; q++) {
    const gx = x + c[q * 3],
      gy = y + c[q * 3 + 1],
      gz = z + c[q * 3 + 2];
    let px = ox + (gx + (hash(gx, gy, gz, 0) - 0.5) * JITTER) * s,
      py = oy + (gy + (hash(gx, gy, gz, 1) - 0.5) * JITTER) * s,
      pz = oz + (gz + (hash(gx, gy, gz, 2) - 0.5) * JITTER) * s;
    if (place) {
      const rx = place.cos * px + place.sin * pz;
      pz = -place.sin * px + place.cos * pz + place.z;
      px = rx + place.x;
      py += place.y;
    }
    corner[q * 3] = px;
    corner[q * 3 + 1] = py;
    corner[q * 3 + 2] = pz;
  }
  for (let t = 0; t < 6; t += 3) {
    const a = TRIANGLES[t] * 3,
      b = TRIANGLES[t + 1] * 3,
      d = TRIANGLES[t + 2] * 3;
    const ux = corner[b] - corner[a],
      uy = corner[b + 1] - corner[a + 1],
      uz = corner[b + 2] - corner[a + 2],
      vx = corner[d] - corner[a],
      vy = corner[d + 1] - corner[a + 1],
      vz = corner[d + 2] - corner[a + 2];
    let mx = uy * vz - uz * vy,
      my = uz * vx - ux * vz,
      mz = ux * vy - uy * vx;
    const length = Math.hypot(mx, my, mz) || 1;
    mx /= length;
    my /= length;
    mz /= length;
    for (const k of [a, b, d]) {
      positions.push(corner[k], corner[k + 1], corner[k + 2]);
      normals.push(mx, my, mz);
    }
  }
}

export function stoneGeometry(
  positions: ArrayLike<number>,
  normals: ArrayLike<number>,
) {
  const geometry = new THREE.BufferGeometry(),
    count = positions.length / 3,
    index = new Uint32Array(count);
  for (let i = 0; i < count; i++) index[i] = i;
  geometry.setAttribute(
    "position",
    new THREE.BufferAttribute(Float32Array.from(positions), 3),
  );
  geometry.setAttribute(
    "normal",
    new THREE.BufferAttribute(Float32Array.from(normals), 3),
  );
  // Indexed like the skin, which batched debris requires.
  geometry.setIndex(new THREE.BufferAttribute(index, 1));
  geometry.computeBoundingSphere();
  return geometry;
}

/** Stone exposed where broken owners left neighbouring owners open. Only
 * owners drawn in this realm cut or receive wounds. Each owner's faces are
 * emitted once per change; a rebuild only concatenates them. */
export class GodWounds {
  readonly mesh: THREE.Mesh;
  private removed = new Set<number>();
  private caps = new Map<number, number[]>();
  private emitted = new Map<
    number,
    { positions: Float32Array; normals: Float32Array }
  >();
  private changed = new Set<number>();
  private dirty = false;
  constructor(
    private solid: GodSolid,
    private drawn: (ordinal: number) => boolean,
    material: THREE.Material,
  ) {
    this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), material);
    this.mesh.name = "god-wounds";
    this.mesh.receiveShadow = true;
    markStaticCaster(this.mesh);
  }
  remove(ordinal: number) {
    if (this.removed.has(ordinal) || !this.drawn(ordinal)) return;
    this.removed.add(ordinal);
    this.caps.delete(ordinal);
    this.emitted.delete(ordinal);
    this.changed.delete(ordinal);
    const { label } = this.solid;
    for (const v of this.solid.voxels.get(ordinal) ?? [])
      for (let face = 0; face < 6; face++) {
        const n = neighbour(this.solid, v, face);
        if (n < 0 || !label[n]) continue;
        const other = label[n] - 1;
        if (other === ordinal || this.removed.has(other) || !this.drawn(other))
          continue;
        let caps = this.caps.get(other);
        if (!caps) this.caps.set(other, (caps = []));
        // The neighbour's face pointing back into the broken owner.
        caps.push(n, face ^ 1);
        this.changed.add(other);
      }
    this.dirty = true;
  }
  reset() {
    this.removed.clear();
    this.caps.clear();
    this.emitted.clear();
    this.changed.clear();
    this.dirty = true;
  }
  /** Rebuilds the stone surface after a batch of removals, re-emitting
   * changed owners within the budget; true while owners remain. */
  update(budgetMS = Infinity) {
    if (!this.dirty) return false;
    const deadline = performance.now() + budgetMS;
    for (const ordinal of this.changed) {
      if (performance.now() > deadline) break;
      this.changed.delete(ordinal);
      const caps = this.caps.get(ordinal)!,
        positions: number[] = [],
        normals: number[] = [];
      for (let i = 0; i < caps.length; i += 2)
        emitFace(this.solid, caps[i], caps[i + 1], positions, normals);
      this.emitted.set(ordinal, {
        positions: Float32Array.from(positions),
        normals: Float32Array.from(normals),
      });
    }
    this.dirty = this.changed.size > 0;
    let length = 0;
    for (const e of this.emitted.values()) length += e.positions.length;
    const positions = new Float32Array(length),
      normals = new Float32Array(length);
    let offset = 0;
    for (const e of this.emitted.values()) {
      positions.set(e.positions, offset);
      normals.set(e.normals, offset);
      offset += e.positions.length;
    }
    this.mesh.geometry.dispose();
    this.mesh.geometry = stoneGeometry(positions, normals);
    this.mesh.visible = length > 0;
    return this.dirty;
  }
  dispose() {
    this.mesh.geometry.dispose();
    this.mesh.removeFromParent();
  }
}
