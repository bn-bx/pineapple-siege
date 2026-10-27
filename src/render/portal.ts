import * as THREE from "three";
import type { WorldData } from "../types";

/** The swirling water in the toilet bowl: the opening to and from hell. */
export class PortalView {
  readonly group = new THREE.Group();
  private disc: THREE.Mesh<THREE.CircleGeometry, THREE.ShaderMaterial>;
  constructor(world: WorldData) {
    const portal = world.portal!;
    const hell = world.realm === "hell";
    const color = new THREE.Color(hell ? "#ff622a" : "#389bcc");
    // A unit disc that dips toward the drain; its rim tucks into the porcelain.
    const radius = 1;
    const geometry = new THREE.CircleGeometry(radius, 128).rotateX(
      -Math.PI / 2,
    );
    const position = geometry.getAttribute("position");
    for (let i = 0; i < position.count; i++) {
      const r = Math.hypot(position.getX(i), position.getZ(i)) / radius;
      position.setY(i, -6 * (1 - r * r));
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
    const [halfX, halfZ] = portal.water ?? [portal.radius, portal.radius];
    this.disc.scale.set(halfX * 1.06, 1, halfZ * 1.06);
    this.group.position.set(portal.x, portal.y, portal.z);
    this.group.rotation.y = portal.yaw ?? 0;
    this.group.add(this.disc);
  }
  update(time: number, intact: boolean) {
    this.disc.visible = intact;
    this.disc.material.uniforms.time.value = time;
  }
}
