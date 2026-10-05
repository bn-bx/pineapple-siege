import * as THREE from "three";
import type { Explosion } from "../types";
const dummy = new THREE.Object3D();
const vertex = `varying vec2 vUv;varying vec3 vColor;void main(){vUv=uv;vColor=instanceColor;vec4 center=modelViewMatrix*instanceMatrix*vec4(0.,0.,0.,1.);center.xy+=position.xy*vec2(length(instanceMatrix[0].xyz),length(instanceMatrix[1].xyz));gl_Position=projectionMatrix*center;}`;
const fragment = `uniform float opacity,time;varying vec2 vUv;varying vec3 vColor;float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+1.),f.x),f.y);}void main(){vec2 p=vUv*2.-1.;float r=length(p);float n=noise(p*5.+time*.13);float a=smoothstep(1.,.23,r+(n-.5)*.24)*opacity*.55;if(a<.015)discard;vec3 c=vColor*(.65+.35*(1.-vUv.y)+n*.2);gl_FragColor=vec4(c,a);}`;
interface Puff {
  p: THREE.Vector3;
  size: number;
  phase: number;
  leaf: boolean;
}
export class NukeCloud {
  readonly group = new THREE.Group();
  readonly face = new THREE.Group();
  private material: THREE.ShaderMaterial;
  private smoke: THREE.InstancedMesh;
  private puffs: Puff[] = [];
  private shock: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  age = 0;
  ending = false;
  constructor(
    public event: Explosion,
    readonly reduced: boolean,
  ) {
    this.material = new THREE.ShaderMaterial({
      vertexShader: vertex,
      fragmentShader: fragment,
      transparent: true,
      depthWrite: false,
      uniforms: { opacity: { value: 1 }, time: { value: 0 } },
    });
    const bodyCount = reduced ? 180 : 360,
      leafCount = reduced ? 12 : 22,
      total = bodyCount + 7 * leafCount + 35;
    this.smoke = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(1, 1),
      this.material,
      total,
    );
    this.smoke.frustumCulled = false;
    this.smoke.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const height = event.profile!.cloudHeight,
      rand = (i: number) => {
        const v = Math.sin(i * 127.1 + event.seed * 31.7) * 43758.5453;
        return v - Math.floor(v);
      };
    this.face.userData.googlyBounds = [
      0,
      height * 0.43,
      0,
      height * 0.23,
      height * 0.27,
      height * 0.23,
    ];
    this.group.add(this.face);
    const color = new THREE.Color();
    const add = (
      p: THREE.Vector3,
      size: number,
      c: THREE.Color,
      leaf = false,
    ) => {
      const i = this.puffs.length;
      this.puffs.push({ p, size, phase: rand(i + 91) * Math.PI * 2, leaf });
      this.smoke.setColorAt(i, c);
    };
    for (let i = 0; i < bodyCount; i++) {
      const y = (i + 0.5) / bodyCount,
        angle = i * 2.399963,
        r =
          Math.sqrt(Math.max(0.03, 1 - Math.pow((y - 0.5) / 0.53, 2))) *
          height *
          0.23 *
          (0.65 + 0.35 * rand(i));
      const bands =
        Math.sin(angle * 7 + y * 38) * Math.sin(angle * 7 - y * 38) > 0.25;
      color
        .set(event.water ? "#b9b68e" : bands ? "#8b692e" : "#e1b24c")
        .multiplyScalar(0.85 + rand(i + 4) * 0.3);
      add(
        new THREE.Vector3(
          Math.cos(angle) * r,
          height * (0.14 + y * 0.58),
          Math.sin(angle) * r,
        ),
        height * (0.07 + rand(i + 2) * 0.035),
        color,
      );
    }
    for (let leaf = 0; leaf < 7; leaf++)
      for (let i = 0; i < leafCount; i++) {
        const t = i / (leafCount - 1),
          a = (leaf * Math.PI * 2) / 7,
          r = height * 0.25 * t * t;
        color
          .set(event.water ? "#849d86" : "#628654")
          .multiplyScalar(0.75 + rand(leaf * 71 + i) * 0.4);
        add(
          new THREE.Vector3(
            Math.cos(a) * r,
            height * (0.66 + 0.34 * t),
            Math.sin(a) * r,
          ),
          height * (0.09 - 0.055 * t),
          color,
          true,
        );
      }
    for (let i = 0; i < 35; i++) {
      const a = i * 2.4,
        r = rand(i + 310) * height * 0.3;
      color.set(event.water ? "#d0e5de" : "#a39374");
      add(
        new THREE.Vector3(
          Math.sin(a) * r,
          rand(i + 333) * height * 0.15,
          Math.cos(a) * r,
        ),
        height * 0.08,
        color,
      );
    }
    this.smoke.count = this.puffs.length;
    this.smoke.instanceColor!.needsUpdate = true;
    this.group.add(this.smoke);
    this.group.position.fromArray(event.p);
    this.shock = new THREE.Mesh(
      new THREE.RingGeometry(0.85, 1, 80),
      new THREE.MeshBasicMaterial({
        color: event.water ? "#d2f6f4" : "#ffe5ad",
        transparent: true,
        opacity: 0.8,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    this.shock.rotation.x = -Math.PI / 2;
    this.shock.position.y = 1;
    this.group.add(this.shock);
  }
  restart(event: Explosion) {
    const ratio = event.profile!.cloudHeight / this.event.profile!.cloudHeight;
    if (ratio !== 1) {
      for (const puff of this.puffs) {
        puff.p.multiplyScalar(ratio);
        puff.size *= ratio;
      }
      const b = this.face.userData.googlyBounds as number[];
      for (let i = 0; i < b.length; i++) b[i] *= ratio;
    }
    if (event.water !== this.event.water) {
      const color = new THREE.Color();
      for (let i = 0; i < this.puffs.length; i++) {
        color.set(
          this.puffs[i].leaf
            ? event.water
              ? "#849d86"
              : "#628654"
            : event.water
              ? "#b9b68e"
              : "#e1b24c",
        );
        this.smoke.setColorAt(i, color.multiplyScalar(0.85 + (i % 13) / 40));
      }
      this.smoke.instanceColor!.needsUpdate = true;
      this.shock.material.color.set(event.water ? "#d2f6f4" : "#ffe5ad");
    }
    this.event = event;
    this.age = 0;
    this.ending = false;
    this.group.position.fromArray(event.p);
    this.group.scale.setScalar(1);
    this.update(0);
  }
  update(dt: number) {
    this.age += dt;
    const grow = 1 - Math.exp(-this.age * 0.55),
      fade = this.ending
        ? Math.max(0, 1 - (this.age - 17) / 3)
        : Math.min(1, Math.max(0, (20 - this.age) / 5));
    this.material.uniforms.opacity.value = fade;
    this.material.uniforms.time.value = this.age;
    this.face.scale.setScalar(grow);
    this.face.position.y = this.age * eventRise(this.event);
    this.face.visible = fade > 0.15;
    for (let i = 0; i < this.puffs.length; i++) {
      const p = this.puffs[i],
        wave = Math.sin(this.age * 0.8 + p.phase);
      dummy.position.copy(p.p).multiplyScalar(grow);
      dummy.position.x += wave * p.size * 0.12;
      dummy.position.z += Math.cos(this.age * 0.6 + p.phase) * p.size * 0.12;
      dummy.position.y += this.age * eventRise(this.event);
      dummy.scale.setScalar(p.size * (0.35 + grow * 0.65) * (1 + wave * 0.07));
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      this.smoke.setMatrixAt(i, dummy.matrix);
    }
    this.smoke.instanceMatrix.needsUpdate = true;
    this.shock.visible = this.age < 4.5;
    this.shock.scale.setScalar(
      this.event.profile!.damageRadius * Math.min(1.15, this.age / 2.5),
    );
    this.shock.material.opacity = Math.max(0, 1 - this.age / 4.5) * 0.75;
  }
  fade() {
    this.ending = true;
    this.age = Math.max(17, this.age);
  }
  get finished() {
    return this.age >= 20;
  }
  dispose() {
    this.smoke.dispose();
    this.smoke.geometry.dispose();
    this.material.dispose();
    this.shock.geometry.dispose();
    this.shock.material.dispose();
  }
}
function eventRise(e: Explosion) {
  return e.profile!.cloudHeight * 0.002;
}
