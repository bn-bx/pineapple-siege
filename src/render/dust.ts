import * as THREE from "three";
import type { Explosion } from "../types";
export class GroundDust {
  readonly mesh: THREE.InstancedMesh;
  private capacity = 256;
  private next = 0;
  private p = new Float32Array(this.capacity * 3);
  private age = new Float32Array(this.capacity).fill(100);
  private duration = new Float32Array(this.capacity);
  private size = new Float32Array(this.capacity);
  private angle = new Float32Array(this.capacity);
  private dummy = new THREE.Object3D();
  constructor() {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 64;
    const c = canvas.getContext("2d")!,
      g = c.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, "rgba(255,255,255,.3)");
    g.addColorStop(0.5, "rgba(255,255,255,.16)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    c.fillStyle = g;
    c.fillRect(0, 0, 64, 64);
    this.mesh = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({
        map: new THREE.CanvasTexture(canvas),
        color: "#afa086",
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
      this.capacity,
    );
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.reset();
  }
  emit(
    e: Explosion,
    reduced: boolean,
    ground: (x: number, z: number) => number,
  ) {
    if (e.water || e.kind === "impact") return;
    const radius = e.profile?.craterRadius || 14;
    if (e.p[1] - ground(e.p[0], e.p[2]) > radius) return;
    const count = reduced ? 8 : e.kind === "nuke" ? 64 : 20;
    for (let j = 0; j < count; j++) {
      const i = this.next++ % this.capacity,
        angle = j * 2.399963 + e.seed,
        r = Math.sqrt((j + 0.5) / count) * radius;
      const x = e.p[0] + Math.cos(angle) * r,
        z = e.p[2] + Math.sin(angle) * r;
      this.p.set([x, ground(x, z) + 2, z], i * 3);
      this.age[i] = 0;
      this.duration[i] = 8 + (j % 8);
      this.size[i] = Math.min(24, 5 + radius * 0.12);
      this.angle[i] = angle;
    }
  }
  update(
    dt: number,
    camera: THREE.Camera,
    ground: (x: number, z: number) => number,
  ) {
    for (let i = 0; i < this.capacity; i++) {
      this.age[i] += dt;
      const t = this.age[i] / this.duration[i];
      this.dummy.scale.setScalar(0);
      if (t < 1) {
        this.p[i * 3] += Math.cos(this.angle[i]) * 0.8 * dt;
        this.p[i * 3 + 2] += Math.sin(this.angle[i]) * 0.8 * dt;
        this.dummy.position.fromArray(this.p, i * 3);
        this.dummy.position.y =
          ground(this.dummy.position.x, this.dummy.position.z) +
          2 +
          Math.sin(t * Math.PI) * 4;
        this.dummy.quaternion.copy(camera.quaternion);
        const size =
          this.size[i] * (1 + t * 2) * Math.min(1, t * 5 + 0.15) * (1 - t);
        this.dummy.scale.set(size, size * 0.65, 1);
      }
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
  reset() {
    this.age.fill(100);
    this.dummy.scale.setScalar(0);
    this.dummy.updateMatrix();
    for (let i = 0; i < this.capacity; i++)
      this.mesh.setMatrixAt(i, this.dummy.matrix);
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
