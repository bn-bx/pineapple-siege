import * as THREE from "three";
import { christmas } from "../christmas";

const BLOBS = 160;
const PUDDLES = 256;
const MAX_RADIUS = 4.5;

/**
 * Cosmetic concrete: blobs stream from the mixer's chute and spread into
 * grey puddles on the ground. Nothing here touches the simulation or saves.
 */
export class ConcretePour {
  readonly group = new THREE.Group();
  private blobs: THREE.InstancedMesh;
  private puddles: THREE.InstancedMesh;
  private bp = new Float32Array(BLOBS * 3);
  private bv = new Float32Array(BLOBS * 3);
  private live = new Uint8Array(BLOBS);
  private nextBlob = 0;
  private emitDebt = 0;
  private puddle = Array.from({ length: PUDDLES }, () => ({
    live: false,
    x: 0,
    z: 0,
    ground: 0,
    area: 0,
    normal: new THREE.Vector3(0, 1, 0),
  }));
  private nextPuddle = 0;
  private frame = 0;
  private dirty = false;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private s = new THREE.Vector3();
  private t = new THREE.Vector3();
  constructor() {
    this.blobs = new THREE.InstancedMesh(
      new THREE.IcosahedronGeometry(0.32, 1),
      // Christmas pours eggnog.
      new THREE.MeshStandardMaterial({
        color: christmas() ? "#f1dfa4" : "#8f8d87",
        roughness: christmas() ? 0.35 : 0.85,
      }),
      BLOBS,
    );
    this.blobs.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.blobs.frustumCulled = false;
    this.blobs.count = 0;
    const disc = new THREE.CircleGeometry(1, 22).rotateX(-Math.PI / 2);
    // Slightly lumpy edge so puddles don't look like perfect coins.
    const pos = disc.attributes.position;
    for (let i = 1; i < pos.count; i++) {
      const k = 0.88 + 0.12 * Math.sin(i * 2.7) * Math.cos(i * 1.3);
      pos.setXYZ(i, pos.getX(i) * k, 0, pos.getZ(i) * k);
    }
    this.puddles = new THREE.InstancedMesh(
      disc,
      new THREE.MeshStandardMaterial({
        color: christmas() ? "#f3e3b0" : "#a19e96",
        roughness: christmas() ? 0.3 : 0.95,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      }),
      PUDDLES,
    );
    this.puddles.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.puddles.frustumCulled = false;
    this.puddles.receiveShadow = true;
    this.puddles.count = PUDDLES;
    this.m.makeScale(0, 0, 0);
    for (let i = 0; i < PUDDLES; i++) this.puddles.setMatrixAt(i, this.m);
    this.group.add(this.blobs, this.puddles);
  }
  update(
    dt: number,
    pouring: boolean,
    tip: THREE.Vector3,
    direction: THREE.Vector3,
    carrier: THREE.Vector3,
    ground: (x: number, z: number) => number,
  ) {
    if (dt <= 0) return;
    if (pouring) {
      this.emitDebt += dt * 45;
      while (this.emitDebt >= 1) {
        this.emitDebt--;
        const i = this.nextBlob++ % BLOBS;
        const jitter = (this.nextBlob % 7) / 7 - 0.5;
        this.bp.set([tip.x + jitter * 0.3, tip.y, tip.z - jitter * 0.3], i * 3);
        this.bv.set(
          [
            direction.x * 5 + carrier.x,
            direction.y * 5 + carrier.y,
            direction.z * 5 + carrier.z,
          ],
          i * 3,
        );
        this.live[i] = 1;
      }
    } else this.emitDebt = 0;
    let count = 0;
    for (let i = 0; i < BLOBS; i++) {
      if (!this.live[i]) continue;
      const k = i * 3;
      this.bv[k + 1] -= 20 * dt;
      for (let j = 0; j < 3; j++) this.bp[k + j] += this.bv[k + j] * dt;
      const floor = ground(this.bp[k], this.bp[k + 2]);
      if (this.bp[k + 1] <= floor) {
        this.live[i] = 0;
        this.land(this.bp[k], this.bp[k + 2], ground);
        continue;
      }
      this.t.set(this.bp[k], this.bp[k + 1], this.bp[k + 2]);
      this.m.makeTranslation(this.t);
      this.blobs.setMatrixAt(count++, this.m);
    }
    this.blobs.count = count;
    this.blobs.instanceMatrix.needsUpdate = true;
    // Craters and blasts reshape the ground; drop puddles left hanging.
    if (++this.frame % 30 === 0)
      for (const [i, p] of this.puddle.entries())
        if (p.live && Math.abs(ground(p.x, p.z) - p.ground) > 0.5) {
          p.live = false;
          this.m.makeScale(0, 0, 0);
          this.puddles.setMatrixAt(i, this.m);
          this.dirty = true;
        }
    if (this.dirty) {
      this.puddles.instanceMatrix.needsUpdate = true;
      this.dirty = false;
    }
  }
  private land(x: number, z: number, ground: (x: number, z: number) => number) {
    let index = -1,
      best = Infinity;
    for (const [i, p] of this.puddle.entries()) {
      if (!p.live) continue;
      const d = Math.hypot(p.x - x, p.z - z);
      const reach = Math.sqrt(p.area / Math.PI) + 1.5;
      if (d < reach && d < best && p.area < Math.PI * MAX_RADIUS ** 2) {
        best = d;
        index = i;
      }
    }
    if (index < 0) {
      index = this.nextPuddle++ % PUDDLES;
      const p = this.puddle[index];
      p.live = true;
      p.x = x;
      p.z = z;
      p.area = 0.5;
      p.ground = ground(x, z);
      const e = 1.5;
      p.normal
        .set(ground(x - e, z) - ground(x + e, z), 2 * e, ground(x, z - e) - ground(x, z + e))
        .normalize();
    }
    const p = this.puddle[index];
    p.area += 0.35;
    // Drift the centre toward fresh pours so streaks form while driving.
    const w = 0.35 / p.area;
    p.x += (x - p.x) * w;
    p.z += (z - p.z) * w;
    const r = Math.min(MAX_RADIUS, Math.sqrt(p.area / Math.PI));
    this.q.setFromUnitVectors(THREE.Object3D.DEFAULT_UP, p.normal);
    this.t.set(p.x, p.ground + 0.08, p.z);
    this.s.set(r, 1, r);
    this.m.compose(this.t, this.q, this.s);
    this.puddles.setMatrixAt(index, this.m);
    this.dirty = true;
  }
  reset() {
    this.live.fill(0);
    this.blobs.count = 0;
    this.m.makeScale(0, 0, 0);
    for (const [i, p] of this.puddle.entries()) {
      p.live = false;
      this.puddles.setMatrixAt(i, this.m);
    }
    this.puddles.instanceMatrix.needsUpdate = true;
  }
}
