import * as THREE from "three";
import { CLOUD_ALTITUDE } from "../clouds";

/** Edge of the cube of flakes that travels with the camera (m). */
const BOX = 140;
const FLAKES = 7000;

/**
 * Falling snow in a box that wraps around the camera, so it costs one point
 * draw however far you fly. It thickens toward the cloud deck, where the
 * weather comes from, and thins in reduced-effects mode.
 */
export class Snowfall {
  readonly points: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
  constructor() {
    const positions = new Float32Array(FLAKES * 3),
      seeds = new Float32Array(FLAKES);
    let n = 1;
    const random = () => {
      n = (n * 16807) % 2147483647;
      return n / 2147483647;
    };
    for (let i = 0; i < FLAKES; i++) {
      positions[i * 3] = random() * BOX;
      positions[i * 3 + 1] = random() * BOX;
      positions[i * 3 + 2] = random() * BOX;
      seeds[i] = random();
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("seed", new THREE.BufferAttribute(seeds, 1));
    this.points = new THREE.Points(
      geometry,
      new THREE.ShaderMaterial({
        uniforms: {
          time: { value: 0 },
          eye: { value: new THREE.Vector3() },
          box: { value: BOX },
          viewportHeight: { value: 800 },
          brightness: { value: 1 },
          wind: { value: new THREE.Vector2(1.6, 0.6) },
        },
        vertexShader: /* glsl */ `
          attribute float seed;
          uniform float time, box, viewportHeight;
          uniform vec3 eye;
          uniform vec2 wind;
          varying float vFade;
          void main(){
            vec3 p = position;
            p.y -= time * (3.2 + seed * 2.6);
            p.xz += wind * time * (.7 + seed * .6);
            p.x += sin(time * .9 + seed * 40.) * 1.6;
            p.z += cos(time * .7 + seed * 23.) * 1.6;
            vec3 rel = mod(p - eye, box) - box * .5;
            vec4 view = viewMatrix * vec4(eye + rel, 1.);
            gl_Position = projectionMatrix * view;
            float depth = max(-view.z, .5);
            float size = (.09 + seed * .1) * projectionMatrix[1][1] * viewportHeight / depth;
            gl_PointSize = clamp(size, 1., 22.);
            vFade = (1. - smoothstep(box * .32, box * .5, length(rel))) * clamp(size, .35, 1.);
          }`,
        fragmentShader: /* glsl */ `
          uniform float brightness;
          varying float vFade;
          void main(){
            float r = length(gl_PointCoord - .5) * 2.;
            float a = smoothstep(1., .25, r) * vFade;
            if (a < .02) discard;
            gl_FragColor = vec4(vec3(.95, .97, 1.) * brightness, a * .85);
          }`,
        transparent: true,
        depthWrite: false,
        fog: false,
      }),
    );
    this.points.frustumCulled = false;
    this.points.renderOrder = 3;
  }

  update(
    camera: THREE.Camera,
    time: number,
    daylight: number,
    viewportHeight: number,
    reduced: boolean,
  ) {
    const u = this.points.material.uniforms;
    u.time.value = time;
    u.eye.value.copy(camera.position);
    u.viewportHeight.value = viewportHeight;
    // Snow reads grey at night unless it catches some light.
    u.brightness.value = 0.35 + daylight * 0.65;
    const altitude = THREE.MathUtils.smoothstep(
      camera.position.y,
      150,
      CLOUD_ALTITUDE,
    );
    const density = (reduced ? 0.35 : 0.6) + altitude * 0.4;
    this.points.geometry.setDrawRange(0, Math.floor(FLAKES * Math.min(1, density)));
  }

  dispose() {
    this.points.geometry.dispose();
    this.points.material.dispose();
  }
}
