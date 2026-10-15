import * as THREE from "three";
import { makePineapple } from "./assets";
import { bakeMaterialGroups, makeInfernalJet } from "./infernal-jet";
import { WEAPONS } from "../config";
import type { SimulationSnapshot } from "../types";
type Shot = SimulationSnapshot["projectiles"][number];
interface Batch { mesh: THREE.InstancedMesh; local: THREE.Matrix4[] }

/** Growing material batches retain all model detail without one draw per shot. */
export class ProjectileView {
  readonly group = new THREE.Group();
  count = 0;
  private batches: Batch[];
  private root = new THREE.Object3D();
  private matrix = new THREE.Matrix4();
  private velocity = new THREE.Vector3();
  private up = new THREE.Vector3(0, 1, 0);
  private capacity = 16;
  constructor(hell = false) {
    if (hell) {
      const template = makeInfernalJet("projectile");
      template.rotation.x = -Math.PI / 2;
      template.scale.setScalar(.1);
      this.batches = bakeMaterialGroups(template).map(({ geometry, material }) => ({
        mesh: new THREE.InstancedMesh(geometry, material, this.capacity),
        local: [new THREE.Matrix4()],
      }));
    } else {
      const parts = makePineapple(3.3).children as THREE.Mesh[];
      for (const part of parts) part.updateMatrix();
      this.batches = [
        { mesh: new THREE.InstancedMesh(parts[0].geometry, parts[0].material, this.capacity),
          local: [parts[0].matrix.clone()] },
        { mesh: new THREE.InstancedMesh(parts[1].geometry, parts[1].material, this.capacity * 7),
          local: parts.slice(1).map((p) => p.matrix.clone()) },
      ];
    }
    for (const batch of this.batches) this.configure(batch.mesh);
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
    for (const batch of this.batches) {
      const old = batch.mesh;
      batch.mesh = new THREE.InstancedMesh(old.geometry, old.material, this.capacity * batch.local.length);
      old.removeFromParent();
      old.dispose();
      this.configure(batch.mesh);
    }
  }
  update(shots: Shot[], previous: ReadonlyMap<number, Shot>, alpha: number) {
    this.grow(shots.length);
    this.count = shots.length;
    for (let i = 0; i < shots.length; i++) {
      const s = shots[i], old = previous.get(s.id), p = s.p;
      this.root.position.set(
        old ? THREE.MathUtils.lerp(old.p[0], p[0], alpha) : p[0],
        old ? THREE.MathUtils.lerp(old.p[1], p[1], alpha) : p[1],
        old ? THREE.MathUtils.lerp(old.p[2], p[2], alpha) : p[2],
      );
      this.root.scale.setScalar(WEAPONS[s.weapon].length / 3.3);
      this.root.quaternion.setFromUnitVectors(this.up, this.velocity.fromArray(s.v).normalize());
      this.root.updateMatrix();
      for (const batch of this.batches)
        batch.local.forEach((local, part) => batch.mesh.setMatrixAt(
          i * batch.local.length + part, this.matrix.multiplyMatrices(this.root.matrix, local),
        ));
    }
    for (const { mesh, local } of this.batches) {
      mesh.count = shots.length * local.length;
      mesh.instanceMatrix.clearUpdateRanges();
      if (mesh.count) {
        mesh.instanceMatrix.addUpdateRange(0, mesh.count * 16);
        mesh.instanceMatrix.needsUpdate = true;
      }
    }
  }
  reset() {
    this.count = 0;
    for (const { mesh } of this.batches) mesh.count = 0;
  }
}
