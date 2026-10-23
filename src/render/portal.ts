import * as THREE from "three";
import type { WorldData } from "../types";

/** A recessed, opaque energy well inside the simulation's stone aperture. */
export class PortalView {
  readonly group = new THREE.Group();
  private energy = new THREE.Group();
  private disc: THREE.Mesh<THREE.RingGeometry, THREE.ShaderMaterial>;
  private rim: THREE.Mesh<THREE.TorusGeometry, THREE.MeshStandardMaterial>;
  private inscriptions: THREE.MeshBasicMaterial;
  constructor(world: WorldData) {
    const portal = world.portal!;
    const hell = world.realm === "hell";
    const color = new THREE.Color(hell ? "#ff622a" : "#389bcc");
    const radius = portal.radius - 0.7;
    const geometry = new THREE.RingGeometry(0, radius, 128, 24).rotateX(
      -Math.PI / 2,
    );
    const position = geometry.getAttribute("position");
    for (let i = 0; i < position.count; i++) {
      const r = Math.hypot(position.getX(i), position.getZ(i)) / radius;
      position.setY(i, 2 + 5 * r * r);
    }
    geometry.computeVertexNormals();
    this.disc = new THREE.Mesh(
      geometry,
      new THREE.ShaderMaterial({
        uniforms: {
          time: { value: 0 },
          color: { value: color },
          radius: { value: radius },
        },
        side: THREE.DoubleSide,
        vertexShader: `varying vec2 vPortal; void main(){vPortal=position.xz;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
        fragmentShader: `uniform float time,radius; uniform vec3 color; varying vec2 vPortal;
        float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
        float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1.,0.)),f.x),mix(hash(i+vec2(0.,1.)),hash(i+1.),f.x),f.y);}
        float fbm(vec2 p){float f=0.,a=.5;for(int i=0;i<4;i++){f+=a*noise(p);p=mat2(1.6,1.2,-1.2,1.6)*p+3.1;a*=.5;}return f;}
        void main(){
          vec2 p=vPortal/radius;float r=length(p),angle=atan(p.y,p.x);
          float spin=angle+2.8*pow(max(0.,1.-r),1.2)-time*.24;
          vec2 flow=vec2(cos(spin),sin(spin))*r*4.;
          float cloud=fbm(flow+vec2(time*.035,-time*.06));
          float thread=pow(max(0.,sin(spin*3.+r*13.+cloud*5.)),12.);
          float body=smoothstep(.16,.65,r)*(1.-smoothstep(.9,1.,r));
          vec3 energy=vec3(.002,.005,.012)+color*(cloud*.14+thread*.38)*body;
          energy+=color*pow(r,28.)*.65;
          energy+=vec3(.48,.8,.92)*pow(r,150.)*.35;
          float star=pow(max(0.,fbm(p*34.+time*.035)-.64)*5.,5.);
          energy+=color*star*body*.3;
          gl_FragColor=vec4(energy,1.);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      }),
    );
    this.rim = new THREE.Mesh(
      new THREE.TorusGeometry(portal.radius, 0.65, 8, 128).rotateX(Math.PI / 2),
      new THREE.MeshStandardMaterial({
        color: hell ? "#423029" : "#414b54",
        metalness: 0.65,
        roughness: 0.4,
        emissive: color,
        emissiveIntensity: 0.25,
      }),
    );
    this.rim.position.y = 7.2;
    this.inscriptions = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.65,
      depthWrite: false,
    });
    const runes = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      this.inscriptions,
      48,
    );
    const dummy = new THREE.Object3D();
    let index = 0;
    for (let i = 0; i < 12; i++) {
      const a = (i * Math.PI) / 6,
        r = portal.radius + 10;
      for (let stroke = 0; stroke < 4; stroke++) {
        const tangent = (stroke === 0 ? 0 : stroke - 2) * 1.05;
        dummy.position.set(
          Math.cos(a) * r - Math.sin(a) * tangent,
          7.12,
          Math.sin(a) * r + Math.cos(a) * tangent,
        );
        dummy.rotation.set(0, -a + (stroke === 0 ? 0 : Math.PI / 3), 0);
        dummy.scale.set(0.32, 0.12, stroke === 0 ? 4.2 : 1.5);
        dummy.updateMatrix();
        runes.setMatrixAt(index++, dummy.matrix);
      }
    }
    runes.computeBoundingSphere();
    this.energy.add(this.disc, runes);
    this.group.position.set(portal.x, portal.y, portal.z);
    this.group.add(this.rim, this.energy);
  }
  update(time: number, intact: boolean) {
    this.energy.visible = intact;
    this.disc.material.uniforms.time.value = time;
    this.rim.material.emissiveIntensity = intact
      ? 0.25 + 0.04 * Math.sin(time * 1.5)
      : 0;
    this.inscriptions.opacity = 0.5 + 0.12 * Math.sin(time * 0.9);
  }
}
