import * as THREE from "three";

/**
 * Blue energy bubble shown while the player is invincible (after a truck
 * respawn, a vehicle swap, or under the parachute). Additive, glowing at
 * its rim with bands sweeping over it; it pops in, pulses, flickers as it
 * runs out, then fades.
 */
export class ShieldBubble {
  readonly mesh: THREE.Mesh;
  private material: THREE.ShaderMaterial;
  private shown = 0;
  private pop = 0;
  private wasOn = false;
  constructor() {
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color("#4fb8ff") },
        uOpacity: { value: 0 },
        uTime: { value: 0 },
      },
      vertexShader: /* glsl */ `
        varying vec3 vNormal;
        varying vec3 vView;
        varying vec3 vLocal;
        void main() {
          vLocal = position;
          vec4 view = modelViewMatrix * vec4(position, 1.0);
          vNormal = normalize(normalMatrix * normal);
          vView = normalize(-view.xyz);
          gl_Position = projectionMatrix * view;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        uniform float uOpacity;
        uniform float uTime;
        varying vec3 vNormal;
        varying vec3 vView;
        varying vec3 vLocal;
        void main() {
          float facing = abs(dot(normalize(vNormal), normalize(vView)));
          float rim = pow(1.0 - facing, 2.6);
          // Energy bands sweeping up the bubble, and a faint hex-like weave.
          float bands = smoothstep(0.6, 1.0, sin(vLocal.y * 9.0 - uTime * 5.0));
          vec3 p = normalize(vLocal) * 14.0;
          float weave = abs(sin(p.x + uTime) * sin(p.y * 1.15) * sin(p.z - uTime * 0.7));
          float glow = rim * 1.15 + 0.06 + bands * (0.12 + rim * 0.5)
            + smoothstep(0.85, 1.0, weave) * 0.12;
          gl_FragColor = vec4(uColor * glow * 1.6, glow * uOpacity);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
    });
    this.mesh = new THREE.Mesh(
      new THREE.SphereGeometry(1, 40, 24),
      this.material,
    );
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 10;
    this.mesh.visible = false;
  }
  /**
   * `remaining`: seconds of protection left (Infinity while it holds with
   * no timer, e.g. under the parachute); `radius`: bubble size for the
   * current vehicle.
   */
  update(
    on: boolean,
    remaining: number,
    position: THREE.Vector3,
    radius: number,
    time: number,
    dt: number,
  ) {
    if (on && !this.wasOn) this.pop = 0;
    this.wasOn = on;
    this.shown += ((on ? 1 : 0) - this.shown) * (1 - Math.exp(-dt * (on ? 10 : 5)));
    this.pop = Math.min(1, this.pop + dt * 3);
    this.mesh.visible = this.shown > 0.01;
    if (!this.mesh.visible) return;
    // Running out: flicker through the last half second.
    const ending = on && remaining < 0.6;
    const flicker = ending ? 0.45 + 0.55 * Math.abs(Math.sin(time * 28)) : 1;
    const pulse = 1 + Math.sin(time * 6) * 0.025;
    // Pop in past full size and settle back.
    const t = this.pop,
      grow = 1 + 2.7 * Math.pow(t - 1, 3) + 1.7 * Math.pow(t - 1, 2);
    this.mesh.position.copy(position);
    this.mesh.scale.setScalar(radius * pulse * Math.max(0.01, grow));
    this.material.uniforms.uOpacity.value = this.shown * flicker;
    this.material.uniforms.uTime.value = time;
  }
  reset() {
    this.shown = 0;
    this.wasOn = false;
    this.mesh.visible = false;
  }
}
