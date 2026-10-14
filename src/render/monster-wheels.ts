import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

export const WHEEL_RADIUS = 6; // Local units; monster scale 2 gives a 12 m radius.
/** Two shared draws for tires and hubs, at either monster detail level. */
export class MonsterWheelView {
  readonly group = new THREE.Group();
  readonly parts: THREE.InstancedMesh[];
  private count = 0;
  private wheel = new THREE.Object3D();
  private matrix = new THREE.Matrix4();
  constructor(capacity: number) {
    const tire = new THREE.TorusGeometry(4.7, 1.3, 6, 16);
    tire.rotateY(Math.PI / 2);
    const hub = new THREE.CylinderGeometry(1.8, 1.8, 3, 12);
    hub.rotateZ(Math.PI / 2);
    const pieces: THREE.BufferGeometry[] = [hub];
    for (let i = 0; i < 6; i++) {
      const spoke = new THREE.BoxGeometry(2.5, 8.6, 0.65);
      spoke.rotateX((i * Math.PI) / 3);
      pieces.push(spoke);
    }
    const metal = mergeGeometries(pieces)!;
    for (const piece of pieces) piece.dispose();
    this.parts = [
      new THREE.InstancedMesh(
        tire,
        new THREE.MeshStandardMaterial({ color: "#181a19", roughness: 0.95 }),
        capacity * 2,
      ),
      new THREE.InstancedMesh(
        metal,
        new THREE.MeshStandardMaterial({ color: "#d9a13b", roughness: 0.65 }),
        capacity * 2,
      ),
    ];
    for (const part of this.parts) {
      part.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      part.frustumCulled = false;
      part.castShadow = true;
      part.count = 0;
      this.group.add(part);
    }
  }
  begin() {
    this.count = 0;
  }
  add(root: THREE.Object3D, growth: number, rotation: number) {
    if (growth <= 0) return;
    root.updateMatrix();
    for (const sign of [-1, 1]) {
      this.wheel.position.set(sign * 11, WHEEL_RADIUS * growth, 0);
      this.wheel.rotation.set(rotation, 0, 0);
      this.wheel.scale.setScalar(growth);
      this.wheel.updateMatrix();
      this.matrix.multiplyMatrices(root.matrix, this.wheel.matrix);
      for (const part of this.parts) part.setMatrixAt(this.count, this.matrix);
      this.count++;
    }
  }
  finish() {
    for (const part of this.parts) {
      part.count = this.count;
      part.instanceMatrix.clearUpdateRanges();
      if (this.count) part.instanceMatrix.addUpdateRange(0, this.count * 16);
      part.instanceMatrix.needsUpdate = true;
    }
  }
}
