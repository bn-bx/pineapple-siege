import * as THREE from "three";
import type { WorldData } from "../types";
import { waterwheelRotors } from "./landmark-geometry";

interface WaterwheelPart {
  owner: number;
  center: THREE.Vector3;
  axis: THREE.Vector3;
  u: THREE.Vector3;
  v: THREE.Vector3;
  angle: number;
  phase: number;
  speed: number;
}
interface WaterwheelHub {
  owner: number;
  center: THREE.Vector3;
  axis: THREE.Vector3;
  phase: number;
  speed: number;
}

/** Snapshot-driven paddle wheels reuse existing mill entities and ownership. */
export class WaterwheelView {
  readonly group = new THREE.Group();
  private paddles: WaterwheelPart[] = [];
  private spokes: WaterwheelPart[] = [];
  private hubs: WaterwheelHub[] = [];
  private readonly paddleMesh: THREE.InstancedMesh;
  private readonly spokeMesh: THREE.InstancedMesh;
  private readonly capMesh: THREE.InstancedMesh;
  private readonly dummy = new THREE.Object3D();
  private readonly radial = new THREE.Vector3();
  private readonly tangent = new THREE.Vector3();
  private readonly normal = new THREE.Vector3();
  private readonly matrix = new THREE.Matrix4();
  private readonly orientation = new THREE.Quaternion();
  private readonly hubAlignment = new THREE.Quaternion();
  private readonly hubSpin = new THREE.Quaternion();
  private readonly hubLocalAxis = new THREE.Vector3(0, 1, 0);

  constructor(
    world: Pick<WorldData, "entities" | "sites">,
    wood: THREE.Material,
    geometry: THREE.BufferGeometry,
  ) {
    for (const rotor of waterwheelRotors(world)) {
      const center = new THREE.Vector3(...rotor.center);
      const axis = new THREE.Vector3(...rotor.axis).normalize();
      this.hubs.push({
        owner: rotor.hubOwner,
        center: new THREE.Vector3(...rotor.hubCapCenter),
        axis: axis.clone(),
        phase: rotor.phase,
        speed: rotor.speed,
      });
      const u = new THREE.Vector3(0, 1, 0);
      const v =
        Math.abs(axis.x) > 0.5
          ? new THREE.Vector3(0, 0, 1)
          : new THREE.Vector3(1, 0, 0);
      for (const paddle of rotor.paddles) {
        const offset = new THREE.Vector3(
          paddle.p[0] - center.x,
          paddle.p[1] - center.y,
          paddle.p[2] - center.z,
        );
        this.paddles.push({
          owner: paddle.id,
          center: center.clone(),
          axis: axis.clone(),
          u: u.clone(),
          v: v.clone(),
          angle: Math.atan2(offset.dot(u), offset.dot(v)),
          phase: rotor.phase,
          speed: rotor.speed,
        });
      }
      for (const spoke of rotor.spokes) {
        const angle = spoke.s[1] >= 6.5 ? Math.PI / 2 : 0;
        this.spokes.push({
          owner: spoke.id,
          center: center.clone(),
          axis: axis.clone(),
          u: u.clone(),
          v: v.clone(),
          angle,
          phase: rotor.phase,
          speed: rotor.speed,
        });
      }
    }
    this.paddleMesh = new THREE.InstancedMesh(
      geometry,
      wood,
      this.paddles.length,
    );
    this.paddleMesh.name = "waterwheel-paddles";
    this.spokeMesh = new THREE.InstancedMesh(
      geometry,
      wood,
      this.spokes.length,
    );
    this.spokeMesh.name = "waterwheel-spokes";
    this.capMesh = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(1.35, 1.2, 0.55, 10),
      new THREE.MeshStandardMaterial({
        color: "#5e5541",
        metalness: 0.38,
        roughness: 0.78,
      }),
      this.hubs.length,
    );
    this.capMesh.name = "waterwheel-hub-caps";
    for (const mesh of [this.paddleMesh, this.spokeMesh]) {
      mesh.castShadow = mesh.receiveShadow = true;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
      this.group.add(mesh);
    }
    this.capMesh.castShadow = this.capMesh.receiveShadow = true;
    this.capMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.capMesh.frustumCulled = false;
    this.group.add(this.capMesh);
    this.update(0, new Set());
  }

  update(time: number, removed: ReadonlySet<number>) {
    this.updateMesh(this.paddleMesh, this.paddles, removed, time, false);
    this.updateMesh(this.spokeMesh, this.spokes, removed, time, true);
    let count = 0;
    for (const hub of this.hubs) {
      if (removed.has(hub.owner)) continue;
      this.hubAlignment.setFromUnitVectors(
        this.hubLocalAxis,
        hub.axis,
      );
      this.hubSpin.setFromAxisAngle(hub.axis, hub.phase + time * hub.speed);
      this.dummy.position.copy(hub.center);
      this.dummy.quaternion.copy(this.hubSpin).multiply(this.hubAlignment);
      this.dummy.scale.set(1, 1, 1);
      this.dummy.updateMatrix();
      this.capMesh.setMatrixAt(count++, this.dummy.matrix);
    }
    this.capMesh.count = count;
    this.capMesh.visible = count > 0;
    this.capMesh.instanceMatrix.needsUpdate = true;
    this.capMesh.instanceMatrix.clearUpdateRanges();
    if (count) this.capMesh.instanceMatrix.addUpdateRange(0, count * 16);
  }

  private updateMesh(
    mesh: THREE.InstancedMesh,
    parts: WaterwheelPart[],
    removed: ReadonlySet<number>,
    time: number,
    isSpoke: boolean,
  ) {
    let count = 0;
    for (const part of parts) {
      if (removed.has(part.owner)) continue;
      const angle = part.angle + part.phase + time * part.speed;
      this.radial
        .copy(part.u)
        .multiplyScalar(Math.sin(angle))
        .addScaledVector(part.v, Math.cos(angle));
      this.tangent
        .copy(part.u)
        .multiplyScalar(Math.cos(angle))
        .addScaledVector(part.v, -Math.sin(angle));
      this.normal.crossVectors(this.tangent, part.axis).normalize();
      if (isSpoke) {
        this.matrix.makeBasis(part.axis, this.radial, this.normal);
        this.orientation.setFromRotationMatrix(this.matrix);
        this.dummy.position.copy(part.center);
        this.dummy.quaternion.copy(this.orientation);
        this.dummy.scale.set(0.45, 7, 0.45);
      } else {
        this.matrix.makeBasis(this.tangent, part.axis, this.normal);
        this.orientation.setFromRotationMatrix(this.matrix);
        this.dummy.position.copy(part.center).addScaledVector(this.radial, 7);
        this.dummy.quaternion.copy(this.orientation);
        this.dummy.scale.set(1.6, 0.18, 0.18);
      }
      this.dummy.updateMatrix();
      mesh.setMatrixAt(count++, this.dummy.matrix);
    }
    mesh.count = count;
    mesh.visible = count > 0;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceMatrix.clearUpdateRanges();
    if (count) mesh.instanceMatrix.addUpdateRange(0, count * 16);
  }
}
