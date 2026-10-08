import * as THREE from "three";
import { MAX_MONSTER_SPIKES, MONSTER_SCALE } from "../config";
import type { MonsterSpike } from "../types";

/** Lighting-independent enemy shots: three submissions for the entire volley. */
export class MonsterProjectileView {
  readonly group = new THREE.Group();
  readonly body: THREE.InstancedMesh;
  readonly core: THREE.InstancedMesh;
  readonly tails: THREE.InstancedMesh;
  private root = new THREE.Object3D();
  private local = new THREE.Object3D();
  private matrix = new THREE.Matrix4();
  private velocity = new THREE.Vector3();
  private up = new THREE.Vector3(0, 1, 0);
  private previous = new Map<number, MonsterSpike>();
  constructor() {
    this.group.name = "monster-projectiles";
    this.body = new THREE.InstancedMesh(
      new THREE.ConeGeometry(0.75, 5, 5),
      new THREE.MeshBasicMaterial({
        color: "#ff7b17",
        transparent: true,
        opacity: 0.78,
        depthWrite: false,
        toneMapped: false,
        side: THREE.DoubleSide,
        forceSinglePass: true,
      }),
      MAX_MONSTER_SPIKES,
    );
    this.core = new THREE.InstancedMesh(
      new THREE.ConeGeometry(0.32, 4, 5),
      new THREE.MeshBasicMaterial({ color: "#fff2b0", toneMapped: false }),
      MAX_MONSTER_SPIKES,
    );
    this.tails = new THREE.InstancedMesh(
      new THREE.ConeGeometry(0.9, 1, 6).rotateZ(Math.PI),
      new THREE.MeshBasicMaterial({
        color: "#ff8f24",
        transparent: true,
        opacity: 0.55,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
        side: THREE.DoubleSide,
        forceSinglePass: true,
      }),
      MAX_MONSTER_SPIKES,
    );
    for (const mesh of [this.body, this.core, this.tails]) {
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.group.add(mesh);
    }
    // Draw the opaque hot cores first, then the translucent orange shell and tail.
    this.body.renderOrder = 1;
    this.tails.renderOrder = 2;
  }
  update(
    shots: MonsterSpike[],
    previous: MonsterSpike[] | undefined,
    alpha: number,
  ) {
    this.previous.clear();
    for (const shot of previous ?? []) this.previous.set(shot.id, shot);
    const count = Math.min(MAX_MONSTER_SPIKES, shots.length);
    for (let i = 0; i < count; i++) {
      const s = shots[i],
        old = this.previous.get(s.id);
      this.root.position.set(
        old ? THREE.MathUtils.lerp(old.p[0], s.p[0], alpha) : s.p[0],
        old ? THREE.MathUtils.lerp(old.p[1], s.p[1], alpha) : s.p[1],
        old ? THREE.MathUtils.lerp(old.p[2], s.p[2], alpha) : s.p[2],
      );
      this.velocity.set(
        old ? THREE.MathUtils.lerp(old.v[0], s.v[0], alpha) : s.v[0],
        old ? THREE.MathUtils.lerp(old.v[1], s.v[1], alpha) : s.v[1],
        old ? THREE.MathUtils.lerp(old.v[2], s.v[2], alpha) : s.v[2],
      );
      const speed = this.velocity.length();
      this.root.quaternion.setFromUnitVectors(
        this.up,
        speed > 1e-6 ? this.velocity.divideScalar(speed) : this.up,
      );
      this.root.scale.setScalar(MONSTER_SCALE);
      this.root.updateMatrix();
      this.body.setMatrixAt(i, this.root.matrix);
      this.local.position.set(0, 0.5, 0);
      this.local.scale.set(1, 1, 1);
      this.local.updateMatrix();
      this.core.setMatrixAt(
        i,
        this.matrix.multiplyMatrices(this.root.matrix, this.local.matrix),
      );
      const age = Math.max(
        0,
        old ? THREE.MathUtils.lerp(old.age, s.age, alpha) : s.age,
      );
      const length = Math.min(12, age * speed);
      this.local.position.set(0, -2.5 - length / (2 * MONSTER_SCALE), 0);
      this.local.scale.set(1, length / MONSTER_SCALE, 1);
      this.local.updateMatrix();
      this.tails.setMatrixAt(
        i,
        this.matrix.multiplyMatrices(this.root.matrix, this.local.matrix),
      );
    }
    for (const mesh of [this.body, this.core, this.tails]) {
      mesh.count = count;
      mesh.instanceMatrix.clearUpdateRanges();
      if (count) {
        mesh.instanceMatrix.addUpdateRange(0, count * 16);
        mesh.instanceMatrix.needsUpdate = true;
      }
    }
  }
  reset() {
    this.previous.clear();
    for (const mesh of [this.body, this.core, this.tails]) mesh.count = 0;
  }
}
