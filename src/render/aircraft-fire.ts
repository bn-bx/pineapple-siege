import * as THREE from "three";

/** A small reusable pool of flame and smoke billboards following the disabled jet. */
export class AircraftFireView {
  readonly group = new THREE.Group();
  readonly flames: THREE.InstancedMesh;
  readonly smoke: THREE.InstancedMesh;
  private trail: { p: THREE.Vector3; born: number }[] = [];
  private lastEmission = -Infinity;
  private dummy = new THREE.Object3D();
  private offset = new THREE.Vector3();
  constructor() {
    const make = (smoke: boolean, count: number) => {
      const mesh = new THREE.InstancedMesh(
        new THREE.PlaneGeometry(1, 1),
        new THREE.ShaderMaterial({
          uniforms: { time: { value: 0 } },
          vertexShader: `varying vec2 uv0; void main(){uv0=uv; vec4 c=modelViewMatrix*instanceMatrix*vec4(0.,0.,0.,1.); c.xy+=position.xy*vec2(length(instanceMatrix[0].xyz),length(instanceMatrix[1].xyz)); gl_Position=projectionMatrix*c;}`,
          fragmentShader: smoke
            ? `varying vec2 uv0; void main(){float a=smoothstep(1.,.15,length(uv0*2.-1.))*.48; if(a<.01)discard; gl_FragColor=vec4(.09,.09,.10,a);}`
            : `uniform float time; varying vec2 uv0; void main(){vec2 p=uv0*2.-1.; p.x+=sin(uv0.y*9.-time*14.)*.15; float a=smoothstep(1.,.1,length(p))*.85; if(a<.01)discard; gl_FragColor=vec4(mix(vec3(1.,.12,.01),vec3(1.,.85,.25),a),a);}`,
          transparent: true,
          depthWrite: false,
          toneMapped: false,
          blending: smoke ? THREE.NormalBlending : THREE.AdditiveBlending,
        }),
        count,
      );
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      return mesh;
    };
    this.flames = make(false, 6);
    this.smoke = make(true, 40);
    this.group.add(this.smoke, this.flames);
  }
  update(
    burning: boolean,
    position: THREE.Vector3,
    rotation: THREE.Quaternion,
    time: number,
  ) {
    if (time < this.lastEmission) this.reset();
    this.trail = this.trail.filter((p) => time - p.born < 2);
    if (burning && time - this.lastEmission >= 0.05) {
      if (this.trail.length >= 40) this.trail.shift();
      this.trail.push({ p: position.clone(), born: time });
      this.lastEmission = time;
    }
    this.flames.count = burning ? 6 : 0;
    for (let i = 0; i < this.flames.count; i++) {
      this.offset
        .set(i % 2 ? 1.8 : -1.8, 0.8, -2 - Math.floor(i / 2) * 2.5)
        .applyQuaternion(rotation);
      this.dummy.position.copy(position).add(this.offset);
      const flicker = 1 + Math.sin(time * 23 + i * 2) * 0.2;
      this.dummy.scale.set(5 * flicker, 8 * flicker, 1);
      this.dummy.updateMatrix();
      this.flames.setMatrixAt(i, this.dummy.matrix);
    }
    (this.flames.material as THREE.ShaderMaterial).uniforms.time.value = time;
    this.smoke.count = this.trail.length;
    for (let i = 0; i < this.trail.length; i++) {
      const puff = this.trail[i],
        age = time - puff.born;
      this.dummy.position.copy(puff.p);
      this.dummy.position.y += age * 8;
      const size = (7 + age * 14) * Math.min(1, (2 - age) * 3);
      this.dummy.scale.set(size, size, 1);
      this.dummy.updateMatrix();
      this.smoke.setMatrixAt(i, this.dummy.matrix);
    }
    this.flames.instanceMatrix.needsUpdate = true;
    this.smoke.instanceMatrix.needsUpdate = true;
  }
  reset() {
    this.trail.length = 0;
    this.lastEmission = -Infinity;
    this.flames.count = this.smoke.count = 0;
  }
}
