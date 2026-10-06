import { CONFIG } from "../config";
import * as THREE from "three";
const originalCompilers = new WeakMap<
  THREE.MeshStandardMaterial,
  THREE.Material["onBeforeCompile"]
>();

const originalProgramKeys = new WeakMap<THREE.MeshStandardMaterial, string>();

export const DISCO_PATTERN_GLSL = `
float discoHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
vec3 discoPattern(vec2 world, float beat) {
  float a = beat * 0.18;
  mat2 spin = mat2(cos(a), -sin(a), sin(a), cos(a));
  vec2 grid = (spin * (world - vec2(${(CONFIG.worldSize / 2).toFixed(1)}))) / 78.0;
  vec2 cell = floor(grid);
  vec2 local = fract(grid) - 0.5;
  float phase = discoHash(cell) * 6.28318;
  vec2 moving = local - 0.13 * vec2(sin(beat * 1.7 + phase), cos(beat * 1.3 + phase));
  float spot = 1.0 - smoothstep(0.13, 0.39, length(moving));
  vec3 color = 0.5 + 0.5 * cos(phase + beat * 1.5 + vec3(0.0, 2.1, 4.2));
  return color * spot * 1.25;
}
`;

export class DiscoScene {
  readonly group = new THREE.Group();
  readonly amount = { value: 0 };
  readonly skyAmount = { value: 0 };
  readonly time = { value: 0 };
  readonly ball: THREE.Group;
  private beams: THREE.InstancedMesh;
  private dummy = new THREE.Object3D();
  private decorated = new WeakSet<THREE.MeshStandardMaterial>();
  private strength = 0;
  constructor() {
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 256;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#485366";
    ctx.fillRect(0, 0, 512, 256);
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 32; x++) {
        const light = 155 + ((x * 17 + y * 29) % 75);
        ctx.fillStyle = `rgb(${light},${Math.min(255, light + 12)},${Math.min(255, light + 26)})`;
        ctx.fillRect(x * 16 + 1, y * 16 + 1, 14, 14);
        ctx.fillStyle = "#ffffff88";
        ctx.fillRect(x * 16 + 2, y * 16 + 2, 11, 2);
      }
    const map = new THREE.CanvasTexture(canvas);
    map.colorSpace = THREE.SRGBColorSpace;
    this.ball = new THREE.Group();
    this.ball.userData.googlyBounds = [0, 0, 0, 125, 125, 125];
    this.ball.position.set(CONFIG.worldSize / 2, 1100, CONFIG.worldSize / 2);
    const mirror = new THREE.Mesh(
      new THREE.SphereGeometry(125, 32, 16),
      new THREE.MeshStandardMaterial({
        map,
        color: "#eeeeee",
        metalness: 1,
        roughness: 0.12,
        flatShading: true,
      }),
    );
    const halo = new THREE.Mesh(
      new THREE.SphereGeometry(133, 32, 20),
      new THREE.MeshBasicMaterial({
        color: "#91aaff",
        transparent: true,
        opacity: 0.08,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.BackSide,
      }),
    );
    this.ball.add(mirror, halo);
    this.beams = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(1, 0.02, 1, 8, 1, true),
      new THREE.MeshBasicMaterial({
        color: "#ffffff",
        transparent: true,
        opacity: 0.08,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
        fog: false,
      }),
      32,
    );
    this.beams.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.beams.frustumCulled = false;
    this.group.add(this.ball, this.beams);
    this.group.visible = false;
  }
  decorate(material: THREE.MeshStandardMaterial) {
    if (this.decorated.has(material)) return;
    this.decorated.add(material);
    const original =
      originalCompilers.get(material) ??
      material.onBeforeCompile.bind(material);
    originalCompilers.set(material, original);
    const originalKey =
      originalProgramKeys.get(material) ?? material.customProgramCacheKey();
    originalProgramKeys.set(material, originalKey);
    material.customProgramCacheKey = () => originalKey + "|disco-v1";
    material.onBeforeCompile = (shader, renderer) => {
      original(shader, renderer);
      shader.uniforms.uDiscoAmount = this.amount;
      shader.uniforms.uDiscoTime = this.time;
      // Debris clones retain their wrapped compiler; only rebind this scene's uniforms.
      if (shader.vertexShader.includes("varying vec3 vDiscoWorld;")) return;
      shader.vertexShader = shader.vertexShader
        .replace(
          "#include <common>",
          "#include <common>\nvarying vec3 vDiscoWorld;",
        )
        .replace(
          "#include <begin_vertex>",
          `#include <begin_vertex>
          vec4 discoLocal = vec4(transformed, 1.0);
          #ifdef USE_INSTANCING
            discoLocal = instanceMatrix * discoLocal;
          #endif
          vDiscoWorld = (modelMatrix * discoLocal).xyz;`,
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          "#include <common>",
          `#include <common>
          varying vec3 vDiscoWorld;
          uniform float uDiscoAmount;
          uniform float uDiscoTime;
          ${DISCO_PATTERN_GLSL}`,
        )
        .replace(
          "#include <emissivemap_fragment>",
          `#include <emissivemap_fragment>
          if (uDiscoAmount > 0.001)
            totalEmissiveRadiance += uDiscoAmount * discoPattern(vDiscoWorld.xz, uDiscoTime);`,
        );
    };
    material.needsUpdate = true;
  }
  decorateScene(scene: THREE.Scene) {
    scene.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      for (const material of Array.isArray(object.material)
        ? object.material
        : [object.material])
        if (material instanceof THREE.MeshStandardMaterial)
          this.decorate(material);
    });
  }
  update(
    active: boolean,
    dt: number,
    simTime: number,
    ground: (x: number, z: number) => number,
    reduced: boolean,
  ) {
    this.strength = THREE.MathUtils.clamp(
      this.strength + (active ? dt / 0.75 : -dt / 0.6),
      0,
      1,
    );
    this.group.visible = this.strength > 0.001;
    this.skyAmount.value = this.strength;
    this.amount.value = this.strength * (reduced ? 0.55 : 1);
    this.time.value = simTime;
    const ease = this.strength * this.strength * (3 - 2 * this.strength);
    this.ball.scale.setScalar(ease);
    this.ball.rotation.y = simTime * 0.24;
    const count = this.group.visible ? (reduced ? 12 : 32) : 0;
    this.beams.count = count;
    const origin = new THREE.Vector3(
      CONFIG.worldSize / 2,
      1100,
      CONFIG.worldSize / 2,
    );
    const color = new THREE.Color();
    for (let i = 0; i < count; i++) {
      const angle = i * 2.399963 + simTime * (i % 2 ? 0.2 : -0.16);
      const radius = 240 + Math.sqrt((i + 0.5) / count) * 1020;
      const x = THREE.MathUtils.clamp(
        CONFIG.worldSize / 2 + Math.cos(angle) * radius,
        20,
        CONFIG.worldSize - 20,
      );
      const z = THREE.MathUtils.clamp(
        CONFIG.worldSize / 2 + Math.sin(angle) * radius,
        20,
        CONFIG.worldSize - 20,
      );
      const target = new THREE.Vector3(x, ground(x, z) + 4, z);
      const ray = target.clone().sub(origin);
      this.dummy.position.copy(origin).addScaledVector(ray, 0.5);
      this.dummy.quaternion.setFromUnitVectors(
        new THREE.Vector3(0, 1, 0),
        ray.clone().normalize(),
      );
      this.dummy.scale.set(18 * ease, ray.length(), 18 * ease);
      this.dummy.updateMatrix();
      this.beams.setMatrixAt(i, this.dummy.matrix);
      color.setHSL((i / count + simTime * 0.1) % 1, 0.9, 0.6);
      this.beams.setColorAt(i, color);
    }
    this.beams.instanceMatrix.needsUpdate = true;
    if (this.beams.instanceColor) this.beams.instanceColor.needsUpdate = true;
  }
  reset() {
    this.strength = this.amount.value = this.skyAmount.value = 0;
    this.group.visible = false;
    this.beams.count = 0;
  }
}
