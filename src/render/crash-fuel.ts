import * as THREE from "three";
import type { FuelDrop } from "../sim/crash-fuel";

/** A small fixed pool of visible spray droplets and spreading fuel puddles. */
export class CrashFuelView {
  readonly mesh = new THREE.InstancedMesh(
    new THREE.SphereGeometry(1, 8, 6),
    new THREE.MeshStandardMaterial({
      color: "#bb8942",
      roughness: 0.18,
      metalness: 0.15,
    }),
    288,
  );
  private dummy = new THREE.Object3D();
  private color = new THREE.Color();
  constructor() {
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  }
  update(drops: readonly FuelDrop[]) {
    this.mesh.count = Math.min(288, drops.length);
    for (let i = 0; i < this.mesh.count; i++) {
      const d = drops[i];
      this.dummy.position.fromArray(d.p);
      this.dummy.scale.set(
        d.radius * (d.landed ? 2.5 : 1),
        d.landed ? 0.45 : d.radius,
        d.radius * (d.landed ? 2.5 : 1),
      );
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);
      this.mesh.setColorAt(
        i,
        this.color.set(d.burning ? "#ff6a12" : "#b18c52"),
      );
    }
    this.mesh.visible = this.mesh.count > 0;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
  reset() {
    this.mesh.count = 0;
    this.mesh.visible = false;
  }
}
