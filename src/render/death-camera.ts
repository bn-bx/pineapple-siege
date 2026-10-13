import * as THREE from "three";

/** A latched shot: simulation movement cannot move its focus or restart the pullback. */
export class DeathCamera {
  readonly focus: THREE.Vector3;
  readonly position: THREE.Vector3;
  readonly target: THREE.Vector3;
  readonly up: THREE.Vector3;
  fov: number;
  elapsed = 0;
  private start: THREE.Vector3;
  private end: THREE.Vector3;
  private startTarget: THREE.Vector3;
  private startUp: THREE.Vector3;
  private startFov: number;
  constructor(
    death: THREE.Vector3,
    camera: THREE.PerspectiveCamera,
    surface: number,
  ) {
    this.focus = death.clone();
    this.focus.y = Math.min(death.y, surface + 30);
    this.start = camera.position.clone();
    const away = camera.position.clone().sub(death).setY(0);
    if (away.lengthSq() < 0.001)
      camera.getWorldDirection(away).negate().setY(0);
    if (away.lengthSq() < 0.001) away.set(0, 0, -1);
    this.end = death.clone().add(away.normalize().multiplyScalar(300));
    this.end.y = Math.max(surface + 180, death.y + 80);
    this.startTarget = camera
      .getWorldDirection(new THREE.Vector3())
      .multiplyScalar(Math.max(40, camera.position.distanceTo(this.focus)))
      .add(camera.position);
    this.startUp = camera.up.clone();
    this.position = this.start.clone();
    this.target = this.startTarget.clone();
    this.up = this.startUp.clone();
    this.startFov = this.fov = camera.fov;
  }
  frame(
    dt: number,
    clear: (position: THREE.Vector3, previous: THREE.Vector3) => void,
  ) {
    if (dt <= 0 || this.elapsed >= 1.5) return this;
    this.elapsed = Math.min(1.5, this.elapsed + dt);
    const t = this.elapsed / 1.5,
      blend = t * t * (3 - 2 * t);
    const desired = this.start.clone().lerp(this.end, blend);
    clear(desired, this.position);
    this.position.copy(desired);
    this.target.copy(this.startTarget).lerp(this.focus, blend);
    this.up
      .copy(this.startUp)
      .lerp(new THREE.Vector3(0, 1, 0), blend)
      .normalize();
    this.fov = THREE.MathUtils.lerp(this.startFov, 72, blend);
    return this;
  }
}

/** Resolve camera motion itself, rather than a boom starting inside the wreckage. */
export function clearDeathCamera(
  desired: THREE.Vector3,
  previous: THREE.Vector3,
  size: number,
  surface: (x: number, z: number) => number,
  obstacles: Iterable<THREE.Box3>,
) {
  desired.x = THREE.MathUtils.clamp(desired.x, 3, size - 3);
  desired.z = THREE.MathUtils.clamp(desired.z, 3, size - 3);
  const delta = new THREE.Vector3();
  const ray = new THREE.Ray(previous, new THREE.Vector3()),
    hit = new THREE.Vector3();
  for (const box of obstacles) {
    delta.copy(desired).sub(previous);
    const length = delta.length();
    ray.direction.copy(delta).normalize();
    const collision = ray.intersectBox(box, hit);
    if (
      box.containsPoint(desired) ||
      box.containsPoint(previous) ||
      (collision && previous.distanceTo(hit) <= length + 3)
    )
      desired.y = Math.max(desired.y, box.max.y + 10);
  }
  const distance = Math.hypot(desired.x - previous.x, desired.z - previous.z);
  const steps = Math.max(1, Math.ceil(distance / 2));
  for (let i = 1; i <= steps; i++) {
    const t = i / steps,
      x = THREE.MathUtils.lerp(previous.x, desired.x, t),
      z = THREE.MathUtils.lerp(previous.z, desired.z, t);
    const floor = surface(x, z);
    if (THREE.MathUtils.lerp(previous.y, desired.y, t) < floor + 3)
      desired.y = Math.max(
        desired.y,
        previous.y + (floor + 10 - previous.y) / t,
      );
  }
  desired.y = Math.max(desired.y, surface(desired.x, desired.z) + 10);
}
