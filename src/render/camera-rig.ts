import * as THREE from "three";
import { CONFIG } from "../config";
import type { CameraMode } from "../types";
export class CameraRig {
  mode: CameraMode = "chase";
  previousMode: "chase" | "cinematic" = "chase";
  elapsed = 0;
  private photoPosition = new THREE.Vector3();
  private photoRotation = new THREE.Euler(0, 0, 0, "YXZ");
  private offset = new THREE.Vector3();
  private blendFrom = new THREE.Vector3();
  private shot = -1;
  private blend = 1;
  fov = 64;
  /** Smooth before collision resolution; never blend back into an obstruction. */
  prepareBoom(
    desired: THREE.Vector3,
    previous: THREE.Vector3,
    dt: number,
    ready: boolean,
  ) {
    if (ready) desired.lerp(previous, Math.exp(-Math.max(0, dt) * 6));
  }
  toggle() {
    this.mode = this.mode === "cinematic" ? "chase" : "cinematic";
    this.elapsed = 0;
    this.shot = -1;
  }
  chase() {
    this.mode = "chase";
    this.fov = 64;
    this.shot = -1;
  }
  photo(camera: THREE.PerspectiveCamera) {
    this.previousMode = this.mode === "cinematic" ? "cinematic" : "chase";
    this.mode = "photo";
    this.photoPosition.copy(camera.position);
    this.photoRotation.setFromQuaternion(camera.quaternion, "YXZ");
    this.fov = camera.fov;
  }
  exitPhoto() {
    this.mode = this.previousMode;
    this.fov = this.mode === "cinematic" ? 72 : 64;
  }
  look(dx: number, dy: number) {
    this.photoRotation.y -= dx * 0.002;
    this.photoRotation.x = THREE.MathUtils.clamp(
      this.photoRotation.x - dy * 0.002,
      -1.55,
      1.55,
    );
  }
  move(keys: Set<string>, dt: number) {
    const v = new THREE.Vector3(
      Number(keys.has("KeyD")) - Number(keys.has("KeyA")),
      Number(keys.has("KeyE")) - Number(keys.has("KeyQ")),
      Number(keys.has("KeyS")) - Number(keys.has("KeyW")),
    );
    if (v.lengthSq())
      this.photoPosition.add(
        v
          .normalize()
          .applyEuler(this.photoRotation)
          .multiplyScalar(
            dt * (keys.has("ShiftLeft") || keys.has("ShiftRight") ? 160 : 35),
          ),
      );
    this.photoPosition.x = THREE.MathUtils.clamp(
      this.photoPosition.x,
      0,
      CONFIG.worldSize,
    );
    this.photoPosition.z = THREE.MathUtils.clamp(
      this.photoPosition.z,
      0,
      CONFIG.worldSize,
    );
    this.photoPosition.y = THREE.MathUtils.clamp(
      this.photoPosition.y,
      -CONFIG.laserBedrock - 200,
      900,
    );
  }
  cinematic(position: THREE.Vector3, forward: THREE.Vector3, dt: number) {
    this.elapsed += dt;
    const t = this.elapsed % 20,
      shot = t < 6 ? 0 : t < 12 ? 1 : 2;
    const desired =
      shot === 0
        ? new THREE.Vector3(-48, 15, -6)
        : shot === 1
          ? new THREE.Vector3(36, 20, -52)
          : new THREE.Vector3(
              Math.cos(((t - 12) / 8) * Math.PI * 2) * 58,
              24,
              Math.sin(((t - 12) / 8) * Math.PI * 2) * 58,
            );
    if (this.shot !== shot) {
      this.blendFrom.copy(this.offset);
      this.blend = 0;
      if (this.shot < 0) this.blendFrom.set(0, 10, -30);
      this.shot = shot;
    }
    this.blend = Math.min(1, this.blend + dt);
    const blend = this.blend * this.blend * (3 - 2 * this.blend);
    this.offset.copy(this.blendFrom).lerp(desired, blend);
    const yaw = Math.atan2(forward.x, forward.z);
    return {
      position: position
        .clone()
        .add(
          this.offset.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw),
        ),
      target: position.clone().addScaledVector(forward, 6),
    };
  }
  applyPhoto(
    camera: THREE.PerspectiveCamera,
    floor: (x: number, z: number) => number,
  ) {
    this.photoPosition.y = Math.max(
      this.photoPosition.y,
      floor(this.photoPosition.x, this.photoPosition.z) + 1,
    );
    camera.position.copy(this.photoPosition);
    camera.quaternion.setFromEuler(this.photoRotation);
    camera.up.set(0, 1, 0);
  }
}
