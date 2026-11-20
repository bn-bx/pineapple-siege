import * as THREE from "three";
import type { PlaneState } from "../types";
import type { DynamicLights } from "./dynamic-lights";

/** Seconds a wreck's loose wheels and flames last. */
const WHEEL_LIFE = 60;
const FIRE_LIFE = 30;
const GRAVITY = 26;
const FLAMES = 18;
const SMOKE = 70;

interface LooseWheel {
  mesh: THREE.Object3D;
  /** Tyre radius in world metres, so it rests and rolls on its rim. */
  radius: number;
  velocity: THREE.Vector3;
  spin: THREE.Vector3;
  resting: boolean;
}

/**
 * The truck's death: its four wheels pop off and bounce away while the hulk
 * burns hard and pours smoke. The darkened hulk itself is CrashWreckView's.
 */
export class TruckWreckView {
  readonly group = new THREE.Group();
  private wheels: LooseWheel[] = [];
  private crashed = false;
  private born = -Infinity;
  private fireAt = new THREE.Vector3();
  private smoke: { p: THREE.Vector3; drift: THREE.Vector3; born: number }[] =
    [];
  private lastPuff = -Infinity;
  private lastTime = 0;
  private flames: THREE.InstancedMesh;
  private smokeMesh: THREE.InstancedMesh;
  /** Fire strength this frame, 0..1, and where its light sits. */
  private heat = 0;
  private glow = new THREE.Vector3();
  private dummy = new THREE.Object3D();
  private world = new THREE.Vector3();
  private quaternion = new THREE.Quaternion();
  private scale = new THREE.Vector3();
  private axis = new THREE.Vector3();
  private turn = new THREE.Quaternion();

  constructor() {
    const billboard = (smoke: boolean, count: number) => {
      const mesh = new THREE.InstancedMesh(
        new THREE.PlaneGeometry(1, 1),
        new THREE.ShaderMaterial({
          uniforms: { time: { value: 0 } },
          vertexShader: `attribute float instanceSeed; varying vec2 uv0; varying float seed0; void main(){uv0=uv; seed0=instanceSeed; vec4 c=modelViewMatrix*instanceMatrix*vec4(0.,0.,0.,1.); c.xy+=position.xy*vec2(length(instanceMatrix[0].xyz),length(instanceMatrix[1].xyz)); gl_Position=projectionMatrix*c;}`,
          fragmentShader: smoke
            ? `varying vec2 uv0; varying float seed0; void main(){float a=smoothstep(1.,.1,length(uv0*2.-1.))*.55; if(a<.01)discard; gl_FragColor=vec4(vec3(.07,.065,.06)+seed0*.04,a);}`
            : `uniform float time; varying vec2 uv0; varying float seed0; void main(){vec2 p=uv0*2.-1.; p.x+=sin(uv0.y*8.-time*13.+seed0*6.)*.18*uv0.y; p.y+=.25; float r=length(p*vec2(1.,.75)); float a=smoothstep(1.,.05,r)*smoothstep(1.15,.2,uv0.y+.15); if(a<.02)discard; vec3 c=mix(vec3(.95,.12,.01),vec3(1.,.82,.3),smoothstep(.2,.95,a)); gl_FragColor=vec4(c,a);}`,
          transparent: true,
          depthWrite: false,
          toneMapped: false,
          blending: smoke ? THREE.NormalBlending : THREE.AdditiveBlending,
        }),
        count,
      );
      mesh.geometry.setAttribute(
        "instanceSeed",
        new THREE.InstancedBufferAttribute(
          Float32Array.from({ length: count }, (_, i) =>
            Math.abs(Math.sin(i * 12.9898) * 43758.5453) % 1,
          ),
          1,
        ),
      );
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      return mesh;
    };
    this.flames = billboard(false, FLAMES);
    this.smokeMesh = billboard(true, SMOKE);
    this.group.add(this.smokeMesh, this.flames);
  }

  /**
   * `truck` is the live truck model, still posed where it died; its named
   * "wheel" groups are copied and thrown.
   */
  update(
    plane: PlaneState,
    truck: THREE.Object3D | undefined,
    time: number,
    ground: (x: number, z: number) => number,
  ) {
    if (time < this.lastTime) this.reset();
    const dt = Math.min(0.05, Math.max(0, time - this.lastTime));
    this.lastTime = time;
    const impacted = plane.crashed > 0 && !plane.falling;
    if (impacted && !this.crashed && plane.mode === "ground" && truck)
      this.burst(plane, truck, time);
    this.crashed = impacted;
    this.stepWheels(dt, time, ground);
    this.stepFire(time, ground);
  }

  private burst(plane: PlaneState, truck: THREE.Object3D, time: number) {
    this.clearWheels();
    this.born = time;
    this.fireAt.fromArray(plane.p);
    truck.updateMatrixWorld(true);
    const centre = new THREE.Vector3().setFromMatrixPosition(truck.matrixWorld);
    const carried = new THREE.Vector3().fromArray(plane.v).multiplyScalar(0.45);
    let i = 0;
    truck.traverse((source) => {
      if (source.name !== "wheel") return;
      const mesh = source.clone(true);
      // Sooty, but still recognisably the truck's tyres and yellow rims.
      mesh.traverse((o) => {
        if (!(o instanceof THREE.Mesh)) return;
        const material = (o.material as THREE.MeshStandardMaterial).clone();
        if (material.color) material.color.multiplyScalar(0.6);
        material.transparent = true;
        o.material = material;
      });
      source.matrixWorld.decompose(this.world, this.quaternion, this.scale);
      mesh.position.copy(this.world);
      mesh.quaternion.copy(this.quaternion);
      mesh.scale.copy(this.scale);
      const box = new THREE.Box3().setFromObject(source);
      const radius = Math.max(1, (box.max.y - box.min.y) / 2);
      // Blown outward from the chassis, up, and along with the truck.
      const out = this.world.clone().sub(centre).setY(0);
      if (out.lengthSq() < 0.01) out.set(Math.sin(i * 2.1), 0, Math.cos(i * 2.1));
      out.normalize();
      const jitter = Math.sin(time * 37 + i * 11.3);
      const velocity = out
        .multiplyScalar(16 + 8 * Math.abs(jitter))
        .add(carried)
        .setY(18 + 10 * Math.abs(Math.cos(time * 23 + i * 5.7)));
      const spin = new THREE.Vector3(
        6 + 6 * jitter,
        4 * Math.cos(i * 3.3),
        5 * Math.sin(i * 1.7),
      );
      this.wheels.push({ mesh, radius, velocity, spin, resting: false });
      this.group.add(mesh);
      i++;
    });
  }

  private stepWheels(
    dt: number,
    time: number,
    ground: (x: number, z: number) => number,
  ) {
    const age = time - this.born;
    if (age >= WHEEL_LIFE) {
      this.clearWheels();
      return;
    }
    const fade = Math.min(1, (WHEEL_LIFE - age) / 5);
    for (const w of this.wheels) {
      const m = w.mesh;
      if (!w.resting && dt > 0) {
        w.velocity.y -= GRAVITY * dt;
        m.position.addScaledVector(w.velocity, dt);
        const floor = ground(m.position.x, m.position.z) + w.radius;
        if (m.position.y <= floor) {
          m.position.y = floor;
          if (w.velocity.y < 0) w.velocity.y *= -0.38;
          // Tyre scrub on each bounce; slow rollers come to rest.
          w.velocity.x *= 0.72;
          w.velocity.z *= 0.72;
          w.spin.multiplyScalar(0.7);
          if (w.velocity.lengthSq() < 4 && w.velocity.y < 2) {
            w.resting = true;
            w.velocity.set(0, 0, 0);
          }
        }
        const rate = w.spin.length();
        if (rate > 0.01) {
          this.axis.copy(w.spin).divideScalar(rate);
          this.turn.setFromAxisAngle(this.axis, rate * dt);
          m.quaternion.premultiply(this.turn);
        }
      }
      m.traverse((o) => {
        if (o instanceof THREE.Mesh)
          (o.material as THREE.Material).opacity = fade;
      });
    }
  }

  private stepFire(time: number, ground: (x: number, z: number) => number) {
    const age = time - this.born;
    const burning = age >= 0 && age < FIRE_LIFE;
    // Flares up hard at once, roars, then slowly dies down.
    const heat = burning
      ? Math.min(1, age * 4) * Math.min(1, (FIRE_LIFE - age) / 12)
      : 0;
    const base = this.fireAt;
    const floor = burning ? ground(base.x, base.z) : 0;
    if (burning && time - this.lastPuff >= 0.07) {
      if (this.smoke.length >= SMOKE) this.smoke.shift();
      const k = this.smoke.length + time * 7;
      this.smoke.push({
        p: new THREE.Vector3(
          base.x + Math.sin(k * 2.3) * 4,
          Math.max(base.y, floor + 4),
          base.z + Math.cos(k * 1.7) * 4,
        ),
        drift: new THREE.Vector3(Math.sin(k) * 2.5, 0, Math.cos(k * 0.7) * 2.5),
        born: time,
      });
      this.lastPuff = time;
    }
    this.smoke = this.smoke.filter((s) => time - s.born < 5);
    const flames = Math.round(FLAMES * heat);
    this.flames.count = flames;
    for (let i = 0; i < flames; i++) {
      const ring = i < 6 ? 0 : i < 12 ? 1 : 2;
      const a = i * 2.39996 + time * 0.4;
      const reach = [2, 6, 9][ring];
      const flicker = 1 + Math.sin(time * 19 + i * 2.7) * 0.22;
      const tall = [13, 10, 7][ring] * (0.5 + heat * 0.5) * flicker;
      this.dummy.position.set(
        base.x + Math.sin(a) * reach,
        Math.max(base.y - 2, floor) + tall * 0.35 + ring * -0.8,
        base.z + Math.cos(a) * reach,
      );
      this.dummy.scale.set(tall * 0.7, tall, 1);
      this.dummy.updateMatrix();
      this.flames.setMatrixAt(i, this.dummy.matrix);
    }
    (this.flames.material as THREE.ShaderMaterial).uniforms.time.value = time;
    this.smokeMesh.count = this.smoke.length;
    for (let i = 0; i < this.smoke.length; i++) {
      const s = this.smoke[i],
        t = time - s.born;
      this.dummy.position.copy(s.p).addScaledVector(s.drift, t);
      this.dummy.position.y += t * 11;
      const size = (8 + t * 9) * Math.min(1, (5 - t) * 0.8) * (0.4 + heat * 0.6);
      this.dummy.scale.set(size, size, 1);
      this.dummy.updateMatrix();
      this.smokeMesh.setMatrixAt(i, this.dummy.matrix);
    }
    this.flames.instanceMatrix.needsUpdate = true;
    this.smokeMesh.instanceMatrix.needsUpdate = true;
    this.heat =
      heat * (1 + Math.sin(time * 27) * 0.15 + Math.sin(time * 11) * 0.1);
    if (heat > 0) this.glow.set(base.x, Math.max(base.y, floor) + 6, base.z);
  }
  /** The burning hulk's flickering orange glow. */
  collectLights(lights: DynamicLights) {
    if (this.heat > 0)
      lights.add(
        this.glow.x,
        this.glow.y,
        this.glow.z,
        0xff7a2a,
        6 * this.heat,
        90,
        true,
      );
  }

  private clearWheels() {
    for (const w of this.wheels) {
      this.group.remove(w.mesh);
      w.mesh.traverse((o) => {
        if (o instanceof THREE.Mesh) (o.material as THREE.Material).dispose();
      });
    }
    this.wheels.length = 0;
  }

  reset() {
    this.clearWheels();
    this.crashed = false;
    this.born = -Infinity;
    this.smoke.length = 0;
    this.lastPuff = -Infinity;
    this.lastTime = 0;
    this.flames.count = this.smokeMesh.count = 0;
    this.heat = 0;
  }
}
