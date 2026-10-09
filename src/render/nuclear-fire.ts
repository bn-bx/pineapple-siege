import * as THREE from "three";
import type { ResourceDisposal } from "./resource-disposal";
import type { FirePatch, Explosion } from "../types";
import { FIRE_LIMIT, FIRE_LIFETIME } from "../sim/nuclear-fire";

const vertex = `varying vec2 vUv;varying vec3 vColor;void main(){vUv=uv;vColor=instanceColor;vec4 center=modelViewMatrix*instanceMatrix*vec4(0.,0.,0.,1.);center.xy+=position.xy*vec2(length(instanceMatrix[0].xyz),length(instanceMatrix[1].xyz));gl_Position=projectionMatrix*center;}`;
const flame = `uniform float time;varying vec2 vUv;varying vec3 vColor;
void main(){vec2 p=vUv*2.-1.;p.x+=sin(vUv.y*9.-time*5.+vColor.g)*.15*vUv.y;
float w=.12+(1.-vUv.y)*.7;float core=1.-smoothstep(w*.15,w,abs(p.x));
float a=core*smoothstep(0.,.08,vUv.y)*smoothstep(1.,.65,vUv.y)*vColor.r*.65;
if(a<.01)discard;vec3 c=mix(vec3(1.,.12,.01),vec3(1.,.4,.05),core*(1.-vUv.y*.65));gl_FragColor=vec4(c,a);}`;
const smoke = `uniform float time;varying vec2 vUv;varying vec3 vColor;
void main(){vec2 p=vUv*2.-1.;float n=sin(p.x*9.+time*.7+vColor.g)*sin(p.y*8.-time*.5)*.08;
float a=smoothstep(1.,.15,length(p)+n)*vColor.r*.32;if(a<.01)discard;
gl_FragColor=vec4(vec3(.12+.05*vUv.y),a);}`;
const dummy = new THREE.Object3D();
const color = new THREE.Color();

/** Fixed sprite pools; all positions and lifetimes come from worker fire state. */
export class NuclearFireView {
  readonly group = new THREE.Group();
  readonly flames: THREE.InstancedMesh;
  readonly smoke: THREE.InstancedMesh;
  private fireballs: {
    mesh: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
    age: number;
    radius: number;
  }[] = [];
  private ballPool: THREE.Mesh<
    THREE.SphereGeometry,
    THREE.MeshBasicMaterial
  >[] = [];
  private ballGeometry = new THREE.SphereGeometry(1, 16, 10);
  constructor() {
    const make = (fragmentShader: string, additive: boolean) => {
      const mesh = new THREE.InstancedMesh(
        new THREE.PlaneGeometry(1, 1),
        new THREE.ShaderMaterial({
          vertexShader: vertex,
          fragmentShader,
          uniforms: { time: { value: 0 } },
          transparent: true,
          depthWrite: false,
          toneMapped: false,
          blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
        }),
        FIRE_LIMIT * 8,
      );
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.setColorAt(0, color.setRGB(0, 0, 0));
      mesh.instanceColor!.setUsage(THREE.DynamicDrawUsage);
      return mesh;
    };
    this.flames = make(flame, true);
    this.smoke = make(smoke, false);
    this.group.add(this.flames, this.smoke);
  }
  trigger(e: Explosion) {
    if (e.kind !== "nuke" || !e.profile) return;
    if (this.fireballs.length >= 8) {
      const old = this.fireballs.shift()!;
      this.group.remove(old.mesh);
      this.ballPool.push(old.mesh);
    }
    const mesh =
      this.ballPool.pop() ??
      new THREE.Mesh(
        this.ballGeometry,
        new THREE.MeshBasicMaterial({
          color: "#ff791d",
          transparent: true,
          opacity: 0,
          depthWrite: false,
          toneMapped: false,
          blending: THREE.AdditiveBlending,
        }),
      );
    mesh.position.fromArray(e.p);
    mesh.scale.setScalar(0.01);
    mesh.material.opacity = 0;
    this.fireballs.push({
      mesh,
      age: 0,
      radius: Math.min(150, e.profile.craterRadius * 0.65),
    });
    this.group.add(mesh);
  }
  update(
    patches: readonly FirePatch[],
    dt: number,
    reduced: boolean,
    time: number,
  ) {
    for (let i = this.fireballs.length - 1; i >= 0; i--) {
      const ball = this.fireballs[i];
      ball.age += dt;
      if (ball.age >= 2) {
        this.group.remove(ball.mesh);
        this.ballPool.push(ball.mesh);
        this.fireballs.splice(i, 1);
        continue;
      }
      ball.mesh.scale.setScalar(
        ball.radius * (0.2 + 0.8 * Math.min(1, ball.age / 0.8)),
      );
      ball.mesh.material.opacity =
        Math.sin(Math.min(1, ball.age / 2) * Math.PI) * (reduced ? 0.18 : 0.5);
    }
    const count = reduced ? 4 : 8;
    let index = 0;
    for (const f of patches.slice(0, FIRE_LIMIT)) {
      const fade = Math.min(1, Math.max(0, (FIRE_LIFETIME - f.age) / 8));
      for (let i = 0; i < count; i++) {
        const phase = (f.seed + i * 2.399) % (Math.PI * 2);
        const r = f.radius * Math.sqrt((i + 0.5) / count) * 0.75;
        const x = f.p[0] + Math.cos(phase) * r,
          z = f.p[2] + Math.sin(phase) * r;
        const flicker = 0.85 + Math.sin(time * 5 + phase) * 0.15;
        dummy.position.set(x, f.p[1] + f.height * flicker * 0.5, z);
        dummy.scale.set(f.radius * 0.65, f.height * flicker, 1);
        dummy.updateMatrix();
        this.flames.setMatrixAt(index, dummy.matrix);
        color.setRGB(fade, phase, 0);
        this.flames.setColorAt(index, color);
        const rise = (f.age * 0.13 + i / count) % 1;
        dummy.position.set(x, f.p[1] + f.height + rise * f.height * 5, z);
        dummy.scale.setScalar(f.radius * (0.6 + rise * 0.8));
        dummy.updateMatrix();
        this.smoke.setMatrixAt(index, dummy.matrix);
        color.setRGB(fade * (1 - rise), phase, 0);
        this.smoke.setColorAt(index++, color);
      }
    }
    for (const mesh of [this.flames, this.smoke]) {
      mesh.count = index;
      mesh.visible = index > 0;
      mesh.instanceMatrix.needsUpdate = true;
      mesh.instanceColor!.needsUpdate = true;
      (mesh.material as THREE.ShaderMaterial).uniforms.time.value = time;
    }
  }
  reset() {
    for (const ball of this.fireballs) {
      this.group.remove(ball.mesh);
      this.ballPool.push(ball.mesh);
    }
    this.fireballs.length = 0;
    for (const mesh of [this.flames, this.smoke]) {
      mesh.count = 0;
      mesh.visible = false;
    }
  }
  collectResources(resources: ResourceDisposal) {
    resources.collect(this.group);
    for (const ball of this.ballPool) resources.collect(ball);
    resources.geometries.add(this.ballGeometry);
  }
}
