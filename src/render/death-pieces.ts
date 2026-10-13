import * as THREE from "three";

/** A few detached visual parts share the actor's existing cheap death trajectory. */
export class DeathPiecePose {
  private offset = new THREE.Vector3();
  private spin = new THREE.Quaternion();
  private euler = new THREE.Euler();
  apply(
    root: THREE.Object3D,
    position: THREE.Vector3,
    rotation: THREE.Quaternion,
    center: readonly number[],
    scatter: readonly number[],
    age: number,
    part: number,
    scale: number,
    halfSize: readonly number[],
    ground?: (x: number, z: number) => number,
  ) {
    const t = Math.min(2, Math.max(0, age));
    this.offset
      .set(center[0], center[1], center[2])
      .multiplyScalar(scale)
      .applyQuaternion(rotation);
    root.position.copy(position).add(this.offset);
    // Gravity remains vertical even while the shared root tumbles.
    this.offset
      .set(scatter[0] * t, 0, scatter[2] * t)
      .applyQuaternion(rotation);
    root.position.add(this.offset);
    root.position.y += scatter[1] * t - 10.8 * t * t;
    this.spin.setFromEuler(
      this.euler.set(
        age * (0.5 + part * 0.2),
        age * (part - 1) * 0.3,
        age * (part % 2 ? -0.7 : 0.7),
      ),
    );
    root.quaternion.copy(rotation).multiply(this.spin);
    root.scale.setScalar(scale);
    root.updateMatrix();
    if (ground) {
      const m = root.matrix.elements;
      const height =
        Math.abs(m[1]) * halfSize[0] +
        Math.abs(m[5]) * halfSize[1] +
        Math.abs(m[9]) * halfSize[2];
      root.position.y = Math.max(
        root.position.y,
        ground(root.position.x, root.position.z) + height,
      );
    }
  }
}
