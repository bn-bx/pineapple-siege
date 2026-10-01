import * as THREE from "three";
import type { FragmentEffect, Vec3 } from "../types";
interface Piece {
  p: Vec3;
  v: Vec3;
  size: Vec3;
  spin: Vec3;
  rotation: Vec3;
  life: number;
  total: number;
  color: THREE.Color;
  grounded: boolean;
}
const palette = {
  stone: 0xb8aa8c,
  wood: 0x916238,
  foliage: 0x547237,
  earth: 0x936448,
  rock: 0x8d9191,
  plaster: 0xdfcaa5,
  roof: 0x835646,
};
/** Cosmetic ballistic chunks. Permanent, collidable rubble is owned by the worker. */
export class Fragments {
  readonly capacity = 16384;
  private limit = 4096;
  setLimit(value: number) {
    this.limit = Math.max(1, Math.min(this.capacity, Math.floor(value)));
    this.pieces.fill(undefined, this.limit);
    this.update(0);
  }
  readonly mesh: THREE.InstancedMesh;
  private pieces: (Piece | undefined)[] = new Array(this.capacity);
  private next = 0;
  private dummy = new THREE.Object3D();
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
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = true;
  }
  get count() {
    return this.mesh.count;
  }
  emit(e: FragmentEffect, scale = 1) {
    let seed = e.seed | 0;
    const random = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
      return (seed >>> 0) / 4294967296;
    };
    for (let i = 0; i < Math.floor(e.count * scale); i++) {
      const a = random() * Math.PI * 2,
        r = Math.sqrt(random()) * e.spread;
      const p: Vec3 = [
        e.p[0] + Math.cos(a) * r,
        e.p[1] + random() * e.spread * 0.25,
        e.p[2] + Math.sin(a) * r,
      ];
      p[1] = Math.max(p[1], this.ground(p[0], p[2]) + 1);
      const angle =
        Math.atan2(p[2] - e.origin[2], p[0] - e.origin[0]) +
        (random() - 0.5) * 1.2;
      const speed = e.speed * (0.45 + random() * 0.55),
        up = 0.3 + random() * 0.6,
        horizontal = Math.sqrt(1 - up * up) * speed;
      const size = 0.5 + random() * 2.5,
        wood = e.material === "wood",
        life = 8 + random() * 8;
      this.pieces[this.next++ % this.limit] = {
        p,
        v: [
          Math.cos(angle) * horizontal,
          speed * up,
          Math.sin(angle) * horizontal,
        ],
        size: [
          size * (wood ? 0.35 : 1),
          size * (wood ? 2.5 : 0.7),
          size * 0.65,
        ],
        rotation: [random() * 6, random() * 6, random() * 6],
        spin: [random() * 5 - 2.5, random() * 5 - 2.5, random() * 5 - 2.5],
        life,
        total: life,
        color: new THREE.Color(palette[e.material]).multiplyScalar(
          0.75 + random() * 0.5,
        ),
        grounded: false,
      };
    }
  }
  update(dt: number) {
    let count = 0;
    dt = Math.min(dt, 0.08);
    for (let i = 0; i < this.limit; i++) {
      const p = this.pieces[i];
      if (!p) continue;
      p.life -= dt;
      if (p.life <= 0) {
        this.pieces[i] = undefined;
        continue;
      }
      if (!p.grounded && dt > 0) {
        // Sweep each segment against the same rendered heightfield, including new craters.
        const steps = Math.max(1, Math.ceil((Math.hypot(...p.v) * dt) / 2)),
          step = dt / steps;
        for (let s = 0; s < steps; s++) {
          for (let k = 0; k < 3; k++) p.p[k] += p.v[k] * step;
          p.v[1] -= 18 * step;
          const floor = this.ground(p.p[0], p.p[2]) + Math.min(...p.size) * 0.5;
          if (p.p[1] < floor) {
            p.p[1] = floor;
            p.v[1] = Math.abs(p.v[1]) * 0.22;
            p.v[0] *= 0.45;
            p.v[2] *= 0.45;
            if (Math.hypot(...p.v) < 5) {
              p.grounded = true;
              p.life = Math.min(p.life, 3);
            }
            break;
          }
        }
        for (let k = 0; k < 3; k++) p.rotation[k] += p.spin[k] * dt;
      }
      const shrink = Math.min(1, p.life / 1.5);
      this.dummy.position.fromArray(p.p);
      this.dummy.rotation.set(...p.rotation);
      this.dummy.scale.set(
        p.size[0] * shrink,
        p.size[1] * shrink,
        p.size[2] * shrink,
      );
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(count, this.dummy.matrix);
      this.mesh.setColorAt(count, p.color);
      count++;
    }
    this.mesh.count = count;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
  reset() {
    this.pieces.fill(undefined);
    this.mesh.count = 0;
  }
  vaporize(center: Vec3, radius: number) {
    for (let i = 0; i < this.limit; i++) {
      const p = this.pieces[i];
      if (
        p &&
        Math.hypot(p.p[0] - center[0], p.p[2] - center[2]) <
          radius + Math.max(...p.size)
      )
        this.pieces[i] = undefined;
    }
  }
}
