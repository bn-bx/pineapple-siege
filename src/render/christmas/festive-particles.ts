import * as THREE from "three";

const CAPACITY = 3072;

/**
 * One fixed pool of coloured points shared by every festive effect: snow
 * puffs off falling trees, tinsel behind the rocket launch, villagers'
 * snowballs and shattered lake ice. Never allocates per burst.
 */
export class FestiveParticles {
  readonly points: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private p = new Float32Array(CAPACITY * 3).fill(-1e5);
  private v = new Float32Array(CAPACITY * 3);
  private c = new Float32Array(CAPACITY * 3);
  private size = new Float32Array(CAPACITY);
  private life = new Float32Array(CAPACITY);
  private maxLife = new Float32Array(CAPACITY);
  private gravity = new Float32Array(CAPACITY);
  private drag = new Float32Array(CAPACITY);
  private alpha = new Float32Array(CAPACITY);
  private next = 0;
  private color = new THREE.Color();
  constructor() {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.BufferAttribute(this.p, 3).setUsage(THREE.DynamicDrawUsage),
    );
    geometry.setAttribute(
      "tint",
      new THREE.BufferAttribute(this.c, 3).setUsage(THREE.DynamicDrawUsage),
    );
    geometry.setAttribute(
      "particleSize",
      new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage),
    );
    geometry.setAttribute(
      "fade",
      new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage),
    );
    this.points = new THREE.Points(
      geometry,
      new THREE.ShaderMaterial({
        uniforms: { viewportHeight: { value: 800 }, time: { value: 0 } },
        vertexShader: /* glsl */ `
          attribute vec3 tint;
          attribute float particleSize, fade;
          uniform float viewportHeight, time;
          varying vec3 vTint;
          varying float vFade;
          void main(){
            vec4 view = modelViewMatrix * vec4(position, 1.);
            gl_Position = projectionMatrix * view;
            float depth = max(-view.z, .5);
            gl_PointSize = clamp(particleSize * projectionMatrix[1][1] * viewportHeight / depth, 1., 90.);
            // Tinsel glints as it tumbles.
            float glint = .75 + .25 * sin(time * 25. + position.x * 3. + position.z * 2.);
            vTint = tint * glint;
            vFade = fade;
          }`,
        fragmentShader: /* glsl */ `
          varying vec3 vTint;
          varying float vFade;
          void main(){
            float r = length(gl_PointCoord - .5) * 2.;
            float a = smoothstep(1., .55, r) * vFade;
            if (a < .03) discard;
            gl_FragColor = vec4(vTint, a);
          }`,
        transparent: true,
        depthWrite: false,
      }),
    );
    this.points.frustumCulled = false;
    this.points.visible = false;
  }

  /** One particle; colour is a CSS colour string. */
  emit(
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    color: string,
    size: number,
    life: number,
    gravity = 9.8,
    drag = 0.4,
  ) {
    const i = this.next;
    this.next = (this.next + 1) % CAPACITY;
    this.p[i * 3] = x;
    this.p[i * 3 + 1] = y;
    this.p[i * 3 + 2] = z;
    this.v[i * 3] = vx;
    this.v[i * 3 + 1] = vy;
    this.v[i * 3 + 2] = vz;
    this.color.set(color);
    this.c[i * 3] = this.color.r;
    this.c[i * 3 + 1] = this.color.g;
    this.c[i * 3 + 2] = this.color.b;
    this.size[i] = size;
    this.life[i] = this.maxLife[i] = life;
    this.gravity[i] = gravity;
    this.drag[i] = drag;
    this.alpha[i] = 1;
  }

  /** A soft cloud of snow, e.g. shaken off a falling tree. */
  puff(x: number, y: number, z: number, radius: number, count = 24) {
    for (let k = 0; k < count; k++) {
      const a = Math.random() * Math.PI * 2,
        r = Math.random() * radius;
      this.emit(
        x + Math.cos(a) * r,
        y + Math.random() * radius,
        z + Math.sin(a) * r,
        Math.cos(a) * (2 + Math.random() * 4),
        1 + Math.random() * 4,
        Math.sin(a) * (2 + Math.random() * 4),
        Math.random() < 0.7 ? "#f4f8ff" : "#dfe8f4",
        1.2 + Math.random() * 1.6,
        1.4 + Math.random() * 1.2,
        2.5,
        1.6,
      );
    }
  }

  update(dt: number, elapsed: number, viewportHeight: number) {
    const u = this.points.material.uniforms;
    u.viewportHeight.value = viewportHeight;
    u.time.value = elapsed;
    if (dt <= 0) return;
    let active = 0;
    for (let i = 0; i < CAPACITY; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.p[i * 3 + 1] = -1e5;
        this.alpha[i] = 0;
        continue;
      }
      active++;
      const keep = Math.exp(-this.drag[i] * dt);
      for (let k = 0; k < 3; k++) {
        this.v[i * 3 + k] *= keep;
        this.p[i * 3 + k] += this.v[i * 3 + k] * dt;
      }
      this.v[i * 3 + 1] -= this.gravity[i] * dt;
      this.alpha[i] = Math.min(1, (this.life[i] / this.maxLife[i]) * 3);
    }
    this.points.visible = active > 0;
    const g = this.points.geometry;
    for (const name of ["position", "tint", "particleSize", "fade"])
      g.getAttribute(name).needsUpdate = true;
  }

  reset() {
    this.life.fill(0);
    this.alpha.fill(0);
    this.p.fill(-1e5);
    this.points.visible = false;
  }

  dispose() {
    this.points.geometry.dispose();
    this.points.material.dispose();
  }
}
