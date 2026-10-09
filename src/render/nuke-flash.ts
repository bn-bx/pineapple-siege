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
    age: number;
    duration: number;
    hold: number;
  }[] = [];
  constructor() {
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 10000;
    this.mesh.visible = false;
  }
  trigger(e: Explosion) {
    if (e.kind !== "nuke") return;
    const height = e.profile?.cloudHeight ?? 120;
    this.pulses.push({
      age: 0,
      duration: THREE.MathUtils.clamp(4.5 + height / 200, 5.1, 8),
      hold: THREE.MathUtils.clamp(0.35 + height / 1200, 0.45, 0.9),
    });
    if (this.pulses.length > 8) this.pulses.shift();
  }
  update(dt: number, _camera: THREE.Camera, reduced: boolean) {
    let opacity = 0;
    for (const pulse of this.pulses) {
      pulse.age += dt;
      // Reduced effects retains a short, dim fade even for the largest yields.
      const duration = reduced ? 1.8 : pulse.duration;
      const hold = reduced ? 0.08 : pulse.hold;
      const t = Math.max(0, (pulse.age - hold) / (duration - hold));
      const envelope = Math.pow(Math.max(0, 1 - t), 1.6);
      opacity = Math.max(opacity, envelope);
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
