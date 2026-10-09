import * as THREE from "three";
import type { Explosion } from "../types";

/** Sustained exposure bloom; overlapping blasts use the strongest contribution. */
export class NukeFlash {
  readonly mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(2, 2),
    new THREE.ShaderMaterial({
      uniforms: { opacity: { value: 0 } },
      vertexShader: "void main(){gl_Position=vec4(position.xy,0.,1.);}",
      fragmentShader:
        "uniform float opacity;void main(){gl_FragColor=vec4(1.,1.,1.,opacity);}",
      transparent: true,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    }),
  );
  private pulses: {
    p: THREE.Vector3;
    age: number;
    duration: number;
    hold: number;
  }[] = [];
  private direction = new THREE.Vector3();
  private cameraPosition = new THREE.Vector3();
  private offset = new THREE.Vector3();
  constructor() {
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 10000;
    this.mesh.visible = false;
  }
  trigger(e: Explosion) {
    if (e.kind !== "nuke") return;
    const height = e.profile?.cloudHeight ?? 120;
    this.pulses.push({
      p: new THREE.Vector3(...e.p),
      age: 0,
      duration: THREE.MathUtils.clamp(1.2 + height * 0.002, 1.8, 2),
      hold: THREE.MathUtils.clamp(0.2 + height / 2400, 0.25, 0.5),
    });
    if (this.pulses.length > 8) this.pulses.shift();
  }
  update(dt: number, camera: THREE.Camera, reduced: boolean) {
    camera.getWorldDirection(this.direction);
    camera.getWorldPosition(this.cameraPosition);
    let opacity = 0;
    for (const pulse of this.pulses) {
      pulse.age += dt;
      // Reduced effects retains a short, dim fade even for the largest yields.
      const duration = reduced ? 1.8 : pulse.duration;
      const hold = reduced ? 0.08 : pulse.hold;
      const t = Math.max(0, (pulse.age - hold) / (duration - hold));
      const envelope = Math.pow(Math.max(0, 1 - t), 1.6);
      this.offset.copy(pulse.p).sub(this.cameraPosition);
      const facing =
        this.offset.lengthSq() < 1
          ? 1
          : this.offset.normalize().dot(this.direction);
      const view = THREE.MathUtils.smoothstep(facing, -0.25, 0.7);
      // Keep a global floor even when looking away; distance does not dim it.
      opacity = Math.max(opacity, envelope * (0.45 + 0.55 * view));
    }
    this.pulses = this.pulses.filter((p) => p.age < p.duration);
    this.mesh.material.uniforms.opacity.value = Math.min(
      reduced ? 0.12 : 0.98,
      opacity * (reduced ? 0.14 : 1.15),
    );
    this.mesh.visible = this.mesh.material.uniforms.opacity.value > 0.001;
  }
  reset() {
    this.pulses = [];
    this.mesh.visible = false;
    this.mesh.material.uniforms.opacity.value = 0;
  }
}
