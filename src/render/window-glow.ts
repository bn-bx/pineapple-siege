import * as THREE from "three";
import type { Entity } from "../types";

/**
 * Soft night glow around lit windows: one additive sprite per intact window
 * in a single draw. A cheap stand-in for bloom and for real lights, which
 * the hundreds of windows could never afford. Sprites are pulled a few
 * metres toward the camera so the surrounding wall does not clip them.
 */
export class WindowGlow {
  readonly points: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
  readonly windows: readonly Entity[];
  private positions: Float32Array;
  private sizes: Float32Array;
  private removedSize = -1;

  constructor(entities: readonly Entity[]) {
    this.windows = entities.filter(
      (e) => e.kind === "block" && e.material === "window" && !e.visual,
    );
    const n = Math.max(1, this.windows.length);
    this.positions = new Float32Array(n * 3);
    this.sizes = new Float32Array(n);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(this.positions, 3));
    geometry.setAttribute("glowSize", new THREE.BufferAttribute(this.sizes, 1));
    geometry.setDrawRange(0, 0);
    this.points = new THREE.Points(
      geometry,
      new THREE.ShaderMaterial({
        uniforms: {
          glowColor: { value: new THREE.Color("#ffb066") },
          glowStrength: { value: 0 },
          viewportHeight: { value: 800 },
        },
        vertexShader: /* glsl */ `
          attribute float glowSize;
          uniform float viewportHeight;
          varying float vFade;
          void main(){
            vec4 view = modelViewMatrix * vec4(position, 1.);
            float depth = max(-view.z, 1.);
            // Pull toward the camera so the wall around the window does not clip it.
            view.xyz *= max(depth - 3., 1.) / depth;
            gl_Position = projectionMatrix * view;
            float size = glowSize * projectionMatrix[1][1] * viewportHeight / depth;
            // Distant windows stay visible as small points of light.
            gl_PointSize = clamp(size, 1.5, 160.);
            vFade = clamp(size / 1.5, 0.25, 1.);
          }`,
        fragmentShader: /* glsl */ `
          uniform vec3 glowColor;
          uniform float glowStrength;
          varying float vFade;
          void main(){
            float r = length(gl_PointCoord - .5) * 2.;
            float glow = pow(max(0., 1. - r), 2.5);
            gl_FragColor = vec4(glowColor * glow * glowStrength * vFade, 1.);
          }`,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        fog: false,
      }),
    );
    this.points.frustumCulled = false;
    this.points.renderOrder = 4;
  }

  /** `night` 0–1 from the lighting; windows destroyed so far are skipped. */
  update(night: number, removed: ReadonlySet<number>, viewportHeight: number) {
    const material = this.points.material;
    material.uniforms.glowStrength.value = THREE.MathUtils.smoothstep(night, 0.15, 0.8) * 0.55;
    // Visible during warm-up (constructed visible) so the program compiles early.
    this.points.visible = material.uniforms.glowStrength.value > 0.001;
    material.uniforms.viewportHeight.value = viewportHeight;
    if (removed.size === this.removedSize) return;
    this.removedSize = removed.size;
    let n = 0;
    for (const w of this.windows) {
      if (removed.has(w.id)) continue;
      this.positions.set(w.p, n * 3);
      this.sizes[n++] = Math.max(w.s[0], w.s[1], w.s[2]) * 2.2;
    }
    const geometry = this.points.geometry;
    geometry.setDrawRange(0, n);
    geometry.attributes.position.needsUpdate = true;
    geometry.attributes.glowSize.needsUpdate = true;
  }

  /** Forces a rebuild after the removed set is replaced (loading a save). */
  invalidate() {
    this.removedSize = -1;
  }

  get count() {
    return this.points.geometry.drawRange.count;
  }

  dispose() {
    this.points.geometry.dispose();
    this.points.material.dispose();
  }
}
