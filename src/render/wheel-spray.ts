import * as THREE from "three";
/** Fixed pool shared by the entire horde; never allocates per splash. */
export class WheelSpray {
  readonly capacity = 256;
  readonly mesh: THREE.Points;
  private positions = new Float32Array(this.capacity * 3).fill(-100000);
  private velocity = new Float32Array(this.capacity * 3);
  private life = new Float32Array(this.capacity);
  private next = 0;
  constructor() {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.BufferAttribute(this.positions, 3).setUsage(
        THREE.DynamicDrawUsage,
      ),
    );
    this.mesh = new THREE.Points(
      geometry,
      new THREE.PointsMaterial({
        color: "#c6e8ee",
        size: 2.5,
        transparent: true,
        opacity: 0.7,
        depthWrite: false,
      }),
    );
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
  }
  emit(p: [number, number, number], yaw: number) {
    for (const sign of [-1, 1])
      for (let j = 0; j < 4; j++) {
        const i = this.next++ % this.capacity;
        this.positions.set(
          [
            p[0] + Math.cos(yaw) * sign * 26 - Math.sin(yaw) * 14,
            p[1] + 1,
            p[2] - Math.sin(yaw) * sign * 26 - Math.cos(yaw) * 14,
          ],
          i * 3,
        );
        this.velocity.set(
          [
            -Math.sin(yaw) * 12 + Math.cos(yaw) * sign * (4 + j),
            7 + j * 2,
            -Math.cos(yaw) * 12 - Math.sin(yaw) * sign * (4 + j),
          ],
          i * 3,
        );
        this.life[i] = 0.6;
      }
  }
  update(dt: number) {
    let active = false;
    for (let i = 0; i < this.capacity; i++)
      if (this.life[i] > 0) {
        this.life[i] -= dt;
        if (this.life[i] <= 0) this.positions[i * 3 + 1] = -100000;
        else {
          active = true;
          for (let k = 0; k < 3; k++)
            this.positions[i * 3 + k] += this.velocity[i * 3 + k] * dt;
          this.velocity[i * 3 + 1] -= 20 * dt;
        }
      }
    this.mesh.visible = active;
    this.mesh.geometry.attributes.position.needsUpdate = true;
  }
  reset() {
    this.life.fill(0);
    this.positions.fill(-100000);
    this.next = 0;
    this.mesh.visible = false;
    this.mesh.geometry.attributes.position.needsUpdate = true;
  }
}
