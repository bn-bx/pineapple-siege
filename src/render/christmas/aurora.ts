import * as THREE from "three";

/**
 * Northern lights: rippling green-to-violet curtains on an open cylinder
 * inside the sky dome, following the camera like the sky. Shown at night.
 */
export class Aurora {
  readonly mesh: THREE.Mesh<THREE.CylinderGeometry, THREE.ShaderMaterial>;
  constructor() {
    this.mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(2300, 2300, 1100, 96, 1, true),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        // Drawn in the opaque pass right after the sky dome (render order),
        // so distant terrain beyond the cylinder still covers it.
        transparent: false,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        fog: false,
        uniforms: { time: { value: 0 }, strength: { value: 0 } },
        vertexShader: /* glsl */ `
          varying vec3 vLocal;
          varying vec2 vUv;
          void main(){
            vLocal = position;
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.);
          }`,
        fragmentShader: /* glsl */ `
          uniform float time, strength;
          varying vec3 vLocal;
          varying vec2 vUv;
          float hash(float n){return fract(sin(n)*43758.5453);}
          float noise(float x){float i=floor(x),f=fract(x);f=f*f*(3.-2.*f);return mix(hash(i),hash(i+1.),f);}
          void main(){
            float a = atan(vLocal.z, vLocal.x);
            // Hang the curtains over the northern half of the sky.
            float north = smoothstep(-.2, .6, sin(a + .55));
            float x = a * 7.;
            float wave = noise(x * 1.3 + time * .07) * .6 + noise(x * 3.7 - time * .11) * .4;
            float rays = pow(noise(x * 22. + time * .25), 3.);
            float h = vUv.y;
            float lower = .18 + wave * .22;
            float curtain = smoothstep(lower - .02, lower + .05, h) * (1. - smoothstep(lower + .1, lower + .55 + wave * .2, h));
            vec3 green = vec3(.15, 1., .45), violet = vec3(.55, .2, .9);
            vec3 c = mix(green, violet, smoothstep(lower + .05, lower + .5, h));
            float glow = curtain * (.45 + rays * 1.2) * north * strength;
            gl_FragColor = vec4(c * glow * .55, 1.);
          }`,
      }),
    );
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -9;
    this.mesh.name = "christmas-aurora";
  }

  update(camera: THREE.Camera, time: number, stars: number) {
    this.mesh.position.set(camera.position.x, camera.position.y + 320, camera.position.z);
    this.mesh.material.uniforms.time.value = time;
    this.mesh.material.uniforms.strength.value = stars;
    this.mesh.visible = stars > 0.01;
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}
