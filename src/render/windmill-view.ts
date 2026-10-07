import * as THREE from "three";
import type { WorldData } from "../types";
import { windmillRotors } from "./landmark-geometry";

interface BladeInstance {
  owner: number;
  center: THREE.Vector3;
  angle: number;
  phase: number;
  speed: number;
}
interface HubInstance {
  owner: number;
  center: THREE.Vector3;
  phase: number;
  speed: number;
}

/** Snapshot-driven sails and hub caps share bounded batches across all mills. */
export class WindmillView {
  readonly group = new THREE.Group();
  private blades: BladeInstance[] = [];
  private hubs: HubInstance[] = [];
  private sails: THREE.InstancedMesh;
  private spars: THREE.InstancedMesh;
  private caps: THREE.InstancedMesh;
  private dummy = new THREE.Object3D();
  private position = new THREE.Vector3();
  private orientation = new THREE.Quaternion();
  private scale = new THREE.Vector3();
  private axis = new THREE.Vector3(0, 0, 1);
  private readonly sailGeometry: THREE.ShapeGeometry;
  private readonly sailMaterial: THREE.MeshStandardMaterial;

  constructor(
    world: Pick<WorldData, "entities" | "sites">,
    wood: THREE.Material,
    sparGeometry: THREE.BufferGeometry,
  ) {
    const shape = new THREE.Shape();
    shape.moveTo(2.6, -0.48);
    shape.lineTo(16.2, -1.05);
    shape.lineTo(16.2, 1.05);
    shape.lineTo(2.6, 0.48);
    shape.closePath();
    this.sailGeometry = new THREE.ShapeGeometry(shape);
    this.sailMaterial = new THREE.MeshStandardMaterial({
      color: "#c6b995",
      roughness: 0.96,
      side: THREE.DoubleSide,
    });
    const rotors = windmillRotors(world);
    for (const rotor of rotors) {
      this.hubs.push({
        owner: rotor.hubOwner,
        center: new THREE.Vector3(...rotor.hubCapCenter),
        phase: rotor.phase,
        speed: rotor.speed,
      });
      for (const blade of rotor.blades)
        this.blades.push({
          owner: blade.id,
          center: new THREE.Vector3(...rotor.center),
          angle: Math.atan2(
            blade.p[1] - rotor.center[1],
            blade.p[0] - rotor.center[0],
          ),
          phase: rotor.phase,
          speed: rotor.speed,
        });
    }
    this.sails = new THREE.InstancedMesh(
      this.sailGeometry,
      this.sailMaterial,
      this.blades.length,
    );
    this.spars = new THREE.InstancedMesh(
      sparGeometry,
      wood,
      this.blades.length,
    );
    const capGeometry = new THREE.CylinderGeometry(1.35, 1.2, 0.55, 10);
    capGeometry.rotateX(Math.PI / 2);
    const capMaterial = new THREE.MeshStandardMaterial({
      color: "#5e5541",
      metalness: 0.38,
      roughness: 0.78,
    });
    this.caps = new THREE.InstancedMesh(
      capGeometry,
      capMaterial,
      this.hubs.length,
    );
    this.caps.name = "windmill-hub-caps";
    for (const mesh of [this.sails, this.spars]) {
      mesh.name = mesh === this.sails ? "windmill-sails" : "windmill-spars";
      mesh.castShadow = mesh.receiveShadow = true;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
      this.group.add(mesh);
    }
    this.caps.castShadow = this.caps.receiveShadow = true;
    this.caps.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.caps.frustumCulled = false;
    this.group.add(this.caps);
    this.update(0, new Set());
  }

  update(time: number, removed: ReadonlySet<number>) {
    let count = 0;
    for (const blade of this.blades) {
      if (removed.has(blade.owner)) continue;
      const angle = blade.angle + blade.phase + time * blade.speed;
      const cosine = Math.cos(angle),
        sine = Math.sin(angle);
      this.position.set(
        blade.center.x + cosine * 8.5,
        blade.center.y + sine * 8.5,
        blade.center.z,
      );
      this.orientation.setFromAxisAngle(this.axis, angle);
      this.scale.set(8.5, 0.16, 0.13);
      this.dummy.position.copy(this.position);
      this.dummy.quaternion.copy(this.orientation);
      this.dummy.scale.copy(this.scale);
      this.dummy.updateMatrix();
      this.spars.setMatrixAt(count, this.dummy.matrix);
      this.position.copy(blade.center);
      this.scale.set(1, 1, 1);
      this.dummy.position.copy(this.position);
      this.dummy.scale.copy(this.scale);
      this.dummy.updateMatrix();
      this.sails.setMatrixAt(count, this.dummy.matrix);
      count++;
    }
    for (const mesh of [this.sails, this.spars]) {
      mesh.count = count;
      mesh.visible = count > 0;
      mesh.instanceMatrix.needsUpdate = true;
      mesh.instanceMatrix.clearUpdateRanges();
      if (count) mesh.instanceMatrix.addUpdateRange(0, count * 16);
    }
    let hubCount = 0;
    for (const hub of this.hubs) {
      if (removed.has(hub.owner)) continue;
      this.dummy.position.copy(hub.center);
      this.dummy.quaternion.setFromAxisAngle(
        this.axis,
        hub.phase + time * hub.speed,
      );
      this.dummy.scale.set(1, 1, 1);
      this.dummy.updateMatrix();
      this.caps.setMatrixAt(hubCount++, this.dummy.matrix);
    }
    this.caps.count = hubCount;
    this.caps.visible = hubCount > 0;
    this.caps.instanceMatrix.needsUpdate = true;
    this.caps.instanceMatrix.clearUpdateRanges();
    if (hubCount) this.caps.instanceMatrix.addUpdateRange(0, hubCount * 16);
  }
}
