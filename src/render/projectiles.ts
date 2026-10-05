import * as THREE from "three";
import { makePineapple } from "./assets";
import { WEAPONS } from "../config";
import type { SimulationSnapshot } from "../types";
type Shot = SimulationSnapshot["projectiles"][number];
/** Two submissions represent every pineapple, including all seven crown leaves. */
export class ProjectileView {
  readonly group = new THREE.Group();
  count = 0;
  private body: THREE.InstancedMesh;
  private leaves: THREE.InstancedMesh;
  private local: THREE.Matrix4[];
  private root = new THREE.Object3D();
  private matrix = new THREE.Matrix4();
  private velocity = new THREE.Vector3();
  private up = new THREE.Vector3(0, 1, 0);
  private capacity = 16;
  constructor() {
    const template = makePineapple(3.3),
      parts = template.children as THREE.Mesh[];
    for (const part of parts) part.updateMatrix();
    this.local = parts.map((p) => p.matrix.clone());
    this.body = new THREE.InstancedMesh(
      parts[0].geometry,
      parts[0].material,
      this.capacity,
    );
    this.leaves = new THREE.InstancedMesh(
      parts[1].geometry,
      parts[1].material,
      this.capacity * 7,
    );
    this.configure(this.body);
    this.configure(this.leaves);
  }
  private configure(mesh: THREE.InstancedMesh) {
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.group.add(mesh);
  }
  private grow(needed: number) {
    if (needed <= this.capacity) return;
    this.capacity = 2 ** Math.ceil(Math.log2(needed));
    for (const key of ["body", "leaves"] as const) {
      const old = this[key],
        next = new THREE.InstancedMesh(
          old.geometry,
          old.material,
          this.capacity * (key === "leaves" ? 7 : 1),
        );
      this.group.remove(old);
      old.dispose();
      this.configure(next);
      this[key] = next;
    }
  }
  update(shots: Shot[], previous: ReadonlyMap<number, Shot>, alpha: number) {
    this.grow(shots.length);
    this.count = shots.length;
    for (let i = 0; i < shots.length; i++) {
      const s = shots[i],
        old = previous.get(s.id),
        p = s.p;
      this.root.position.set(
        old ? THREE.MathUtils.lerp(old.p[0], p[0], alpha) : p[0],
        old ? THREE.MathUtils.lerp(old.p[1], p[1], alpha) : p[1],
        old ? THREE.MathUtils.lerp(old.p[2], p[2], alpha) : p[2],
      );
      this.root.scale.setScalar(WEAPONS[s.weapon].length / 3.3);
      this.root.quaternion.setFromUnitVectors(
        this.up,
        this.velocity.fromArray(s.v).normalize(),
      );
      this.root.updateMatrix();
      this.body.setMatrixAt(
        i,
        this.matrix.multiplyMatrices(this.root.matrix, this.local[0]),
      );
      for (let leaf = 0; leaf < 7; leaf++)
        this.leaves.setMatrixAt(
          i * 7 + leaf,
          this.matrix.multiplyMatrices(this.root.matrix, this.local[leaf + 1]),
        );
    }
    this.body.count = shots.length;
    this.leaves.count = shots.length * 7;
    for (const mesh of [this.body, this.leaves]) {
      mesh.instanceMatrix.clearUpdateRanges();
      if (mesh.count) {
        mesh.instanceMatrix.addUpdateRange(0, mesh.count * 16);
        mesh.instanceMatrix.needsUpdate = true;
      }
    }
  }
  reset() {
    this.count = this.body.count = this.leaves.count = 0;
  }
}
