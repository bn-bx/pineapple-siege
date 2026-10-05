import * as THREE from "three";
import {
  BLAST_COSMETIC_LIMIT,
  CONFIG,
  WRECKAGE_LIFETIME,
  WRECKAGE_FADE_SECONDS,
} from "../config";
import type { FragmentEffect, Vec3 } from "../types";

const palette = {
  stone: 0xb8aa8c,
  wood: 0x916238,
  foliage: 0x547237,
  earth: 0x936448,
  rock: 0x8d9191,
  plaster: 0xdfcaa5,
  roof: 0x835646,
  sandstone: 0xcba56f,
  slate: 0x43515a,
  window: 0x32393c,
};
// Position, velocity, size, rotation, spin, life, color, grounded, clearance.
const STRIDE = 21;
/** Cosmetic ballistic chunks with the same cleanup lifetime as physical wreckage. */
export class Fragments {
  capacity = BLAST_COSMETIC_LIMIT;
  private limit = BLAST_COSMETIC_LIMIT;
  private live = 0;
  private next = 0;
  private dirty = false;
  private colorsDirty = false;
  private data = new Float32Array(this.capacity * STRIDE);
  private color = new THREE.Color();
  readonly mesh: THREE.InstancedMesh;

  constructor(private ground: (x: number, z: number) => number) {
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const pos = geo.getAttribute("position");
    // Same corner displacement on every adjoining face keeps fractured surfaces closed.
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i),
        y = pos.getY(i),
        z = pos.getZ(i),
        scale = 0.82 + 0.18 * Math.sin(x * 31 + y * 17 + z * 11);
      pos.setXYZ(i, x * scale, y * scale, z * scale);
    }
    geo.computeVertexNormals();
    this.mesh = new THREE.InstancedMesh(
      geo,
      new THREE.MeshStandardMaterial({ roughness: 1, flatShading: true }),
      this.capacity,
    );
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(
      new Float32Array(this.capacity * 3),
      3,
    ).setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = true;
  }
  get count() {
    return this.mesh.count;
  }
  setLimit(value: number) {
    const limit = Math.max(
      1,
      Math.min(BLAST_COSMETIC_LIMIT, Math.floor(value)),
    );
    this.limit = limit;
    this.live = Math.min(this.live, this.limit);
    this.next %= this.limit;
    this.dirty = this.colorsDirty = true;
    this.update(0);
  }
  emit(e: FragmentEffect, scale = 1) {
    let seed = e.seed | 0;
    const random = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
      return (seed >>> 0) / 4294967296;
    };
    const d = this.data;
    // A single burst cannot consume unbounded work while overwriting its own pool.
    const count = Math.min(
      this.limit,
      Math.max(0, Math.floor(e.count * scale)),
    );
    if (count) this.dirty = this.colorsDirty = true;
    for (let i = 0; i < count; i++) {
      const slot =
          this.live < this.limit ? this.live++ : this.next++ % this.limit,
        j = slot * STRIDE,
        a = random() * Math.PI * 2,
        r = Math.sqrt(random()) * e.spread,
        x = e.p[0] + Math.cos(a) * r,
        y = e.p[1] + random() * e.spread * 0.25,
        z = e.p[2] + Math.sin(a) * r;
      const angle =
          Math.atan2(z - e.origin[2], x - e.origin[0]) + (random() - 0.5) * 1.2,
        speed = e.speed * (0.45 + random() * 0.55),
        up = 0.3 + random() * 0.6,
        horizontal = Math.sqrt(1 - up * up) * speed,
        size = 0.5 + random() * 2.5,
        wood = e.material === "wood",
        life = WRECKAGE_LIFETIME;
      d[j] = x;
      d[j + 1] = Math.max(y, this.ground(x, z) + 1);
      d[j + 2] = z;
      d[j + 3] = Math.cos(angle) * horizontal;
      d[j + 4] = speed * up;
      d[j + 5] = Math.sin(angle) * horizontal;
      d[j + 6] = size * (wood ? 0.35 : 1);
      d[j + 7] = size * (wood ? 2.5 : 0.7);
      d[j + 8] = size * 0.65;
      for (let k = 0; k < 3; k++) d[j + 9 + k] = random() * 6;
      for (let k = 0; k < 3; k++) d[j + 12 + k] = random() * 5 - 2.5;
      d[j + 15] = life;
      this.color
        .setHex(palette[e.material])
        .multiplyScalar(0.75 + random() * 0.5);
      d[j + 16] = this.color.r;
      d[j + 17] = this.color.g;
      d[j + 18] = this.color.b;
      d[j + 19] = 0;
      d[j + 20] = Math.min(d[j + 6], d[j + 7], d[j + 8]) * 0.5;
    }
  }
  private remove(i: number) {
    this.dirty = this.colorsDirty = true;
    const last = --this.live;
    if (i !== last)
      this.data.copyWithin(i * STRIDE, last * STRIDE, (last + 1) * STRIDE);
  }
  update(dt: number) {
    dt = Math.min(dt, 0.08);
    if (dt === 0 && !this.dirty) return;
    if (!this.live) {
      this.mesh.count = 0;
      return;
    }
    const d = this.data,
      matrices = this.mesh.instanceMatrix.array as Float32Array,
      colors = this.mesh.instanceColor!.array as Float32Array;
    for (let i = 0; i < this.live; ) {
      const j = i * STRIDE;
      d[j + 15] -= dt;
      if (d[j + 15] <= 0) {
        this.remove(i);
        continue;
      }
      if (!d[j + 19] && dt > 0 && d[j + 15] > WRECKAGE_FADE_SECONDS) {
        // Sweep against the current canonical terrain, including fresh craters.
        const steps = Math.max(
            1,
            Math.ceil((Math.hypot(d[j + 3], d[j + 4], d[j + 5]) * dt) / 2),
          ),
          step = dt / steps;
        for (let s = 0; s < steps; s++) {
          d[j] += d[j + 3] * step;
          d[j + 1] += d[j + 4] * step;
          d[j + 2] += d[j + 5] * step;
          d[j + 4] -= CONFIG.debrisGravity * step;
          const floor = this.ground(d[j], d[j + 2]) + d[j + 20];
          if (d[j + 1] < floor) {
            d[j + 1] = floor;
            d[j + 4] = Math.abs(d[j + 4]) * 0.22;
            d[j + 3] *= 0.45;
            d[j + 5] *= 0.45;
            if (Math.hypot(d[j + 3], d[j + 4], d[j + 5]) < 5) {
              d[j + 19] = 1;
            }
            break;
          }
        }
        d[j + 9] += d[j + 12] * dt;
        d[j + 10] += d[j + 13] * dt;
        d[j + 11] += d[j + 14] * dt;
      }
      // Compose directly into the GPU buffer. No per-piece Object3D, Matrix4,
      // Euler, vector, or Color allocation/update is needed in this hot loop.
      const a = Math.cos(d[j + 9]),
        b = Math.sin(d[j + 9]),
        c = Math.cos(d[j + 10]),
        v = Math.sin(d[j + 10]),
        e = Math.cos(d[j + 11]),
        f = Math.sin(d[j + 11]),
        shrink = Math.min(1, d[j + 15] / WRECKAGE_FADE_SECONDS),
        sx = d[j + 6] * shrink,
        sy = d[j + 7] * shrink,
        sz = d[j + 8] * shrink,
        k = i * 16;
      matrices[k] = c * e * sx;
      matrices[k + 1] = (a * f + b * e * v) * sx;
      matrices[k + 2] = (b * f - a * e * v) * sx;
      matrices[k + 3] = 0;
      matrices[k + 4] = -c * f * sy;
      matrices[k + 5] = (a * e - b * f * v) * sy;
      matrices[k + 6] = (b * e + a * f * v) * sy;
      matrices[k + 7] = 0;
      matrices[k + 8] = v * sz;
      matrices[k + 9] = -b * c * sz;
      matrices[k + 10] = a * c * sz;
      matrices[k + 11] = 0;
      matrices[k + 12] = d[j];
      matrices[k + 13] = d[j + 1];
      matrices[k + 14] = d[j + 2];
      matrices[k + 15] = 1;
      i++;
    }
    if (this.colorsDirty)
      for (let i = 0; i < this.live; i++) {
        const j = i * STRIDE;
        colors[i * 3] = d[j + 16];
        colors[i * 3 + 1] = d[j + 17];
        colors[i * 3 + 2] = d[j + 18];
      }
    this.mesh.count = this.live;
    for (const [attribute, size] of [
      [this.mesh.instanceMatrix, 16],
      [this.mesh.instanceColor!, 3],
    ] as const) {
      attribute.clearUpdateRanges();
      if (this.live && (size === 16 || this.colorsDirty)) {
        attribute.addUpdateRange(0, this.live * size);
        attribute.needsUpdate = true;
      }
    }
    this.dirty = this.colorsDirty = false;
  }
  reset() {
    this.live = 0;
    this.next = 0;
    this.mesh.count = 0;
    this.dirty = this.colorsDirty = false;
  }
  vaporizeMany(regions: { p: Vec3; radius: number }[]) {
    for (let i = 0; i < this.live; ) {
      const j = i * STRIDE,
        extent = Math.max(this.data[j + 6], this.data[j + 7], this.data[j + 8]);
      let hit = false;
      for (const zone of regions) {
        const dx = this.data[j] - zone.p[0],
          dz = this.data[j + 2] - zone.p[2],
          r = zone.radius + extent;
        if (dx * dx + dz * dz < r * r) {
          hit = true;
          break;
        }
      }
      if (hit) this.remove(i);
      else i++;
    }
  }
  vaporize(center: Vec3, radius: number) {
    for (let i = 0; i < this.live; ) {
      const j = i * STRIDE;
      if (
        Math.hypot(this.data[j] - center[0], this.data[j + 2] - center[2]) <
        radius + Math.max(this.data[j + 6], this.data[j + 7], this.data[j + 8])
      )
        this.remove(i);
      else i++;
    }
  }
}
