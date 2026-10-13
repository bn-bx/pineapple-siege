import * as THREE from "three";
import { CONFIG, clamp } from "../config";
import type { PlaneState } from "../types";
import { flightPose } from "./flight-pose";

/** Eight reusable aircraft hulks, independent of the respawned aircraft. */
export class CrashWreckView {
  readonly group = new THREE.Group();
  private crashed = false;
  private hulks: {
    mesh: THREE.Group;
    born: number;
    origin: THREE.Vector3;
    velocity: THREE.Vector3;
    clearance: number;
    landed: boolean;
  }[] = [];
  private cursor = 0;
  constructor(private aircraft: THREE.Group) {}
  update(
    plane: PlaneState,
    time: number,
    ground: (x: number, z: number) => number,
  ) {
    if (plane.crashed > 0 && !this.crashed) {
      let hulk = this.hulks[this.cursor];
      if (!hulk) {
        const mesh = this.aircraft.clone(true);
        mesh.traverse((object) => {
          if (!(object instanceof THREE.Mesh)) return;
          if (object.name === "flame" || object.name === "flame-core") {
            object.visible = false;
            return;
          }
          const old = object.material as THREE.MeshStandardMaterial;
          const material = old.clone();
          if (material.color) material.color.multiplyScalar(0.45);
          if (material.emissive) material.emissive.set(0);
          material.transparent = true;
          object.material = material;
        });
        hulk = {
          mesh,
          born: time,
          origin: new THREE.Vector3(),
          velocity: new THREE.Vector3(),
          clearance: 2,
          landed: false,
        };
        this.hulks.push(hulk);
        this.group.add(mesh);
      }
      const pose = flightPose(undefined, plane, 1);
      hulk.mesh.position.copy(pose.position);
      hulk.mesh.quaternion.copy(pose.rotation);
      hulk.origin.copy(pose.position);
      hulk.clearance = Math.max(
        2,
        pose.position.y - new THREE.Box3().setFromObject(hulk.mesh).min.y,
      );
      hulk.velocity.fromArray(plane.v).multiplyScalar(0.08);
      hulk.born = time;
      hulk.landed = false;
      hulk.mesh.visible = true;
      this.cursor = (this.cursor + 1) % 8;
    }
    this.crashed = plane.crashed > 0;
    for (const h of this.hulks) {
      const age = Math.max(0, time - h.born);
      if (age >= 60) {
        h.mesh.visible = false;
        continue;
      }
      if (!h.mesh.visible) continue;
      if (!h.landed) {
        h.mesh.position
          .copy(h.origin)
          .addScaledVector(h.velocity, Math.min(age, 2));
        h.mesh.position.y -= 11 * age * age;
      }
      h.mesh.position.x = clamp(h.mesh.position.x, 1, CONFIG.worldSize - 1);
      h.mesh.position.z = clamp(h.mesh.position.z, 1, CONFIG.worldSize - 1);
      const floor = ground(h.mesh.position.x, h.mesh.position.z) + h.clearance;
      if (h.mesh.position.y <= floor || h.landed) {
        h.mesh.position.y = floor;
        h.landed = true;
      }
      h.mesh.traverse((object) => {
        if (
          object instanceof THREE.Mesh &&
          object.name !== "flame" &&
          object.name !== "flame-core"
        )
          (object.material as THREE.Material).opacity = Math.min(
            1,
            (60 - age) / 5,
          );
      });
    }
  }
  reset() {
    this.crashed = false;
    this.cursor = 0;
    for (const h of this.hulks) h.mesh.visible = false;
  }
}
