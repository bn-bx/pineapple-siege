import * as THREE from "three";
import type { Explosion,FragmentEffect,Material } from "../types";

export function impactTint(material: Material | "water"): string {
  return material === "water" ? "#bad7d4" : "#a18a68";
}
export function impactDustProfile(_material: Material) {
  return { size: .85, duration: 1, maxPuffs: 5 };
}

/** Fixed, shared pool. These plumes never change damage or saved world data. */
export class GroundDust {
  readonly mesh: THREE.InstancedMesh<
    THREE.PlaneGeometry,
    THREE.MeshBasicMaterial
  >;
  readonly ripples: THREE.InstancedMesh<
    THREE.TorusGeometry,
    THREE.MeshBasicMaterial
  >;
  private capacity = 256;
  private rippleCapacity = 64;
  private next = 0;
  private active = new Set<number>();
  private rippleActive = new Set<number>();
  private rippleNext = 0;
  private p = new Float32Array(this.capacity * 3);
  private age = new Float32Array(this.capacity).fill(100);
  private duration = new Float32Array(this.capacity);
  private size = new Float32Array(this.capacity);
  private angle = new Float32Array(this.capacity);
  // 0 = terrain-following dust, 1 = impact at a wall/airborne surface, 2 = water.
  private anchor = new Uint8Array(this.capacity);
  private ripplePosition = new Float32Array(this.rippleCapacity * 3);
  private rippleAge = new Float32Array(this.rippleCapacity).fill(100);
  private rippleDuration = new Float32Array(this.rippleCapacity);
  private rippleRadius = new Float32Array(this.rippleCapacity);
  private rippleColor = new THREE.Color();
  private dummy = new THREE.Object3D();
  private rotation = new THREE.Quaternion();
  private axis = new THREE.Vector3(0, 0, 1);
  private tint = new THREE.Color();
  private fallback: THREE.Texture;
  constructor() {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 64;
    const c = canvas.getContext("2d")!,
      g = c.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, "rgba(255,255,255,.3)");
    g.addColorStop(0.5, "rgba(255,255,255,.16)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    c.fillStyle = g;
    c.fillRect(0, 0, 64, 64);
    this.fallback = new THREE.CanvasTexture(canvas);
    this.mesh = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({
        map: this.fallback,
        color: "#ffffff",
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        opacity: 0.42,
      }),
      this.capacity,
    );
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < this.capacity; i++)
      this.mesh.setColorAt(i, this.tint.set("#a18a68"));
    this.mesh.instanceColor!.setUsage(THREE.DynamicDrawUsage);
    this.ripples = new THREE.InstancedMesh(
      new THREE.TorusGeometry(1, 0.018, 4, 32),
      new THREE.MeshBasicMaterial({
        color: "#e1f1ed",
        transparent: true,
        opacity: 0.6,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false,
      }),
      this.rippleCapacity,
    );
    this.ripples.renderOrder = 10;
    this.ripples.count = 0;
    this.ripples.frustumCulled = false;
    this.ripples.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.ripples.setColorAt(0, new THREE.Color("#e1f1ed"));
    this.reset();
  }
  private spawn(
    p: number[],
    material: Material | "water",
    seed: number,
    size: number,
    duration: number,
    anchor: number,
  ) {
    const i = this.next++ % this.capacity;
    this.active.add(i);
    this.mesh.visible = true;
    this.p.set(p, i * 3);
    this.age[i] = 0;
    this.duration[i] = duration;
    this.size[i] = size;
    this.angle[i] = seed * 2.399963;
    this.anchor[i] = anchor;
    this.mesh.setColorAt(i, this.tint.set(impactTint(material)));
    this.mesh.instanceColor!.needsUpdate = true;
  }
  impact(e: FragmentEffect, reduced: boolean, scale: number) {
    const profile = impactDustProfile(e.material);
    const count = Math.min(
      reduced ? Math.min(2, profile.maxPuffs) : profile.maxPuffs,
      Math.max(1, Math.ceil((e.count * scale) / 8)),
    );
    for (let i = 0; i < count; i++) {
      const a = (e.seed + i) * 2.399963;
      this.spawn(
        [e.p[0] + Math.sin(a) * 0.4, e.p[1], e.p[2] + Math.cos(a) * 0.4],
        e.material,
        e.seed + i,
        (1.8 + Math.min(4, e.speed * 0.12)) * profile.size,
        profile.duration + i * 0.12,
        1,
      );
    }
  }
  emit(
    e: Explosion,
    reduced: boolean,
    ground: (x: number, z: number) => number,
  ) {
    if (e.kind === "impact") {
      if (e.water)
        this.splash(
          [e.p[0], Math.max(0.24, e.p[1] + 0.2), e.p[2]],
          reduced ? 2.6 : 4.2,
          reduced ? 0.9 : 1.25,
        );
      this.spawn(
        e.water ? [e.p[0], Math.max(0, e.p[1]), e.p[2]] : e.p,
        e.water ? "water" : "earth",
        e.seed,
        e.water ? 4 : 2,
        1.1,
        e.water ? 2 : 1,
      );
      return;
    }
    const radius = e.profile?.craterRadius || 14;
    if (!e.water && e.p[1] - ground(e.p[0], e.p[2]) > radius) return;
    if (e.water)
      this.splash(
        [e.p[0], Math.max(0.24, e.p[1] + 0.2), e.p[2]],
        Math.max(9, radius * (reduced ? 0.28 : 0.48)),
        reduced ? 1.6 : 2.4,
      );
    const count = reduced ? 8 : e.kind === "nuke" ? 64 : 20;
    for (let j = 0; j < count; j++) {
      const angle = j * 2.399963 + e.seed,
        r = Math.sqrt((j + 0.5) / count) * radius,
        x = e.p[0] + Math.cos(angle) * r,
        z = e.p[2] + Math.sin(angle) * r;
      this.spawn(
        [x, e.water ? Math.max(0, e.p[1]) : ground(x, z) + 2, z],
        e.water ? "water" : "earth",
        e.seed + j,
        Math.min(24, 5 + radius * 0.12),
        e.water ? 2.5 : 8 + (j % 8),
        e.water ? 2 : 0,
      );
    }
  }
  update(
    dt: number,
    camera: THREE.Camera,
    ground: (x: number, z: number) => number,
  ) {
    if (!this.active.size && !this.rippleActive.size) return;
    if (this.active.size) {
      for (const i of this.active) {
        this.age[i] += dt;
        const t = this.age[i] / this.duration[i];
        this.dummy.scale.setScalar(0);
        if (t < 1) {
          this.p[i * 3] += Math.cos(this.angle[i]) * 0.8 * dt;
          this.p[i * 3 + 2] += Math.sin(this.angle[i]) * 0.8 * dt;
          this.dummy.position.fromArray(this.p, i * 3);
          this.dummy.position.y =
            (this.anchor[i] === 0
              ? ground(this.dummy.position.x, this.dummy.position.z) + 2
              : this.p[i * 3 + 1]) +
            Math.sin(t * Math.PI) * (this.anchor[i] === 2 ? 6 : 4);
          this.rotation.setFromAxisAngle(this.axis, this.angle[i] + t * 0.3);
          this.dummy.quaternion.copy(camera.quaternion).multiply(this.rotation);
          const size =
            this.size[i] * (1 + t * 2) * Math.min(1, t * 5 + 0.15);
          this.dummy.scale.set(
            size,
            size * (this.anchor[i] === 2 ? 1.3 : 0.85),
            1,
          );
        }
        if (t >= 1) this.active.delete(i);
        this.dummy.updateMatrix();
        this.mesh.setMatrixAt(i, this.dummy.matrix);
      }
      this.mesh.visible = this.active.size > 0;
      this.mesh.instanceMatrix.needsUpdate = true;
    }
    let rippleCount = 0;
    for (const i of this.rippleActive) {
      this.rippleAge[i] += dt;
      const t = this.rippleAge[i] / this.rippleDuration[i];
      if (t >= 1) {
        this.rippleActive.delete(i);
        continue;
      }
      const eased = t * t * (3 - 2 * t),
        radius = Math.max(0.05, this.rippleRadius[i] * eased),
        x = this.ripplePosition[i * 3],
        y = this.ripplePosition[i * 3 + 1],
        z = this.ripplePosition[i * 3 + 2];
      this.dummy.position.set(x, y, z);
      this.dummy.rotation.set(-Math.PI / 2, 0, 0);
      this.dummy.scale.set(radius, radius, radius);
      this.dummy.updateMatrix();
      this.ripples.setMatrixAt(rippleCount, this.dummy.matrix);
      this.rippleColor.set("#e1f1ed").multiplyScalar(1 - eased * 0.78);
      this.ripples.setColorAt(rippleCount, this.rippleColor);
      rippleCount++;
    }
    this.ripples.count = rippleCount;
    this.ripples.visible = rippleCount > 0;
    if (rippleCount) {
      this.ripples.instanceMatrix.needsUpdate = true;
      if (this.ripples.instanceColor)
        this.ripples.instanceColor.needsUpdate = true;
    }
  }
  reset() {
    this.active.clear();
    this.rippleActive.clear();
    this.mesh.visible = false;
    this.ripples.visible = false;
    this.ripples.count = 0;
    this.age.fill(100);
    this.rippleAge.fill(100);
    this.dummy.scale.setScalar(0);
    this.dummy.updateMatrix();
    for (let i = 0; i < this.capacity; i++)
      this.mesh.setMatrixAt(i, this.dummy.matrix);
    this.mesh.instanceMatrix.needsUpdate = true;
  }
  private splash(p: number[], radius: number, duration: number) {
    const i = this.rippleNext++ % this.rippleCapacity;
    this.rippleActive.add(i);
    this.ripplePosition.set(p, i * 3);
    this.rippleAge[i] = 0;
    this.rippleRadius[i] = radius;
    this.rippleDuration[i] = duration;
    this.rippleColor.set("#e1f1ed");
    this.ripples.setColorAt(i, this.rippleColor);
  }
}
