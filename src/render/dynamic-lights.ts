import * as THREE from "three";
import type { Explosion, FirePatch } from "../types";
import type { FuelDrop } from "../sim/crash-fuel";

/** Shader slots. The active count is a uniform, so no recompiles. */
export const DYNAMIC_LIGHT_SLOTS = 8;
/** Most candidates gathered per frame (halos are drawn for all of them). */
export const DYNAMIC_LIGHT_CANDIDATES = 256;

export interface LightCandidate {
  x: number;
  y: number;
  z: number;
  /** Linear colour pre-multiplied by intensity (irradiance at the centre). */
  r: number;
  g: number;
  b: number;
  /** Distance (m) at which the light reaches zero. */
  range: number;
  /** Also draw a soft glow sprite (fires; explosions have their own flash). */
  halo: boolean;
}

const scratchColor = new THREE.Color();

/**
 * Local light from explosions, nukes, fires and muzzle flashes.
 *
 * Three's point lights compile their count into every lit shader, so turning
 * one on or off recompiles the scene. Instead, every installed standard
 * material loops over a small uniform array of lights (view-space position
 * and range, colour × intensity) and stops at `dynamicLightCount`. With no
 * light active the loop exits at once. Each frame the renderer adds every
 * live source as a candidate; the most visible ones fill the slots and the
 * rest (and the chosen fires) also draw cheap additive halos.
 */
export class DynamicLights {
  readonly uniforms = {
    dynamicLightCount: { value: 0 },
    dynamicLightPosition: {
      value: Array.from({ length: DYNAMIC_LIGHT_SLOTS }, () => new THREE.Vector4()),
    },
    dynamicLightColor: {
      value: Array.from({ length: DYNAMIC_LIGHT_SLOTS }, () => new THREE.Vector3()),
    },
  };
  readonly candidates: LightCandidate[] = Array.from(
    { length: DYNAMIC_LIGHT_CANDIDATES },
    () => ({ x: 0, y: 0, z: 0, r: 0, g: 0, b: 0, range: 1, halo: false }),
  );
  /** Candidates added this frame. */
  count = 0;
  /** Candidate indices assigned to shader slots by the last commit. */
  readonly chosen: number[] = [];
  readonly halos: HaloSprites;
  /** Scales every light (reduced effects dims flashes). */
  strength = 1;
  private installed = new WeakSet<THREE.Material>();
  private scores = new Float32Array(DYNAMIC_LIGHT_CANDIDATES);
  private order: number[] = [];
  private frustum = new THREE.Frustum();
  private matrix = new THREE.Matrix4();
  private sphere = new THREE.Sphere();
  private point = new THREE.Vector3();

  constructor() {
    this.halos = new HaloSprites(DYNAMIC_LIGHT_CANDIDATES);
  }

  begin() {
    this.count = 0;
  }

  /** Adds a light source for this frame; ignored when the pool is full or dark. */
  add(
    x: number,
    y: number,
    z: number,
    color: THREE.ColorRepresentation,
    intensity: number,
    range: number,
    halo = false,
  ) {
    if (this.count >= DYNAMIC_LIGHT_CANDIDATES || !(intensity > 1e-3) || !(range > 0))
      return;
    const c = this.candidates[this.count++];
    scratchColor.set(color);
    const k = intensity * this.strength;
    c.x = x;
    c.y = y;
    c.z = z;
    c.r = scratchColor.r * k;
    c.g = scratchColor.g * k;
    c.b = scratchColor.b * k;
    c.range = range;
    c.halo = halo;
  }

  /**
   * Picks the `slots` most visible candidates (bright, near, and in view) and
   * uploads them in view space for `camera`.
   */
  commit(camera: THREE.Camera, slots: number, haloStrength = 1) {
    slots = Math.max(0, Math.min(DYNAMIC_LIGHT_SLOTS, Math.floor(slots)));
    camera.updateMatrixWorld();
    this.frustum.setFromProjectionMatrix(
      this.matrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse),
    );
    const eye = camera.getWorldPosition(this.point).clone();
    this.order.length = 0;
    for (let i = 0; i < this.count; i++) {
      const c = this.candidates[i];
      this.sphere.center.set(c.x, c.y, c.z);
      this.sphere.radius = c.range;
      if (!this.frustum.intersectsSphere(this.sphere)) continue;
      const d = Math.max(
        0,
        Math.hypot(c.x - eye.x, c.y - eye.y, c.z - eye.z) - c.range,
      );
      this.scores[i] = lightScore(c, d);
      this.order.push(i);
    }
    this.order.sort((a, b) => this.scores[b] - this.scores[a]);
    this.chosen.length = 0;
    const positions = this.uniforms.dynamicLightPosition.value;
    const colors = this.uniforms.dynamicLightColor.value;
    const view = camera.matrixWorldInverse;
    for (const i of this.order) {
      if (this.chosen.length >= slots) break;
      const c = this.candidates[i];
      const slot = this.chosen.length;
      this.point.set(c.x, c.y, c.z).applyMatrix4(view);
      positions[slot].set(this.point.x, this.point.y, this.point.z, c.range);
      colors[slot].set(c.r, c.g, c.b);
      this.chosen.push(i);
    }
    this.uniforms.dynamicLightCount.value = this.chosen.length;
    this.halos.update(this.candidates, this.count, haloStrength);
  }

  clear() {
    this.count = 0;
    this.chosen.length = 0;
    this.uniforms.dynamicLightCount.value = 0;
    this.halos.update(this.candidates, 0, 0);
  }

  /** Adds diffuse and specular local light to a standard material. */
  install(material: THREE.Material) {
    if (!(material instanceof THREE.MeshStandardMaterial) || this.installed.has(material))
      return;
    this.installed.add(material);
    const prior = material.onBeforeCompile,
      key = material.customProgramCacheKey();
    material.onBeforeCompile = (shader, renderer) => {
      prior.call(material, shader, renderer);
      Object.assign(shader.uniforms, this.uniforms);
      if (shader.fragmentShader.includes("dynamicLightCount")) return;
      shader.fragmentShader = `${DYNAMIC_LIGHTS_PARS}\n${shader.fragmentShader}`.replace(
        // After the sun mask (which edits lights_fragment_end), before AO.
        "#include <aomap_fragment>",
        `${DYNAMIC_LIGHTS_FRAGMENT}\n#include <aomap_fragment>`,
      );
    };
    material.customProgramCacheKey = () => `${key}:dynamic-lights-v1`;
    material.needsUpdate = true;
  }

  dispose() {
    this.halos.dispose();
  }
}

/** Brightness reaching the camera's surroundings, falling off past the range. */
export function lightScore(c: LightCandidate, distanceBeyondRange: number) {
  const energy = Math.max(c.r, c.g, c.b);
  const ratio = distanceBeyondRange / c.range;
  return (energy * c.range) / (1 + ratio * ratio);
}

/** Smooth window: 1 at the light, 0 at `range`, with no hard edge. */
export function dynamicLightFalloff(distance: number, range: number) {
  const x = Math.min(1, (distance * distance) / (range * range));
  return (1 - x) * (1 - x);
}

export const DYNAMIC_LIGHTS_PARS = /* glsl */ `
uniform int dynamicLightCount;
uniform vec4 dynamicLightPosition[${DYNAMIC_LIGHT_SLOTS}];
uniform vec3 dynamicLightColor[${DYNAMIC_LIGHT_SLOTS}];
`;

export const DYNAMIC_LIGHTS_FRAGMENT = /* glsl */ `
#if defined( RE_Direct )
for ( int i = 0; i < ${DYNAMIC_LIGHT_SLOTS}; i ++ ) {
  if ( i >= dynamicLightCount ) break;
  vec3 toLight = dynamicLightPosition[ i ].xyz - geometryPosition;
  float range = dynamicLightPosition[ i ].w;
  float x = dot( toLight, toLight ) / ( range * range );
  if ( x >= 1.0 ) continue;
  float falloff = ( 1.0 - x ) * ( 1.0 - x );
  vec3 l = normalize( toLight );
  float ndl = saturate( dot( geometryNormal, l ) );
  vec3 irradiance = dynamicLightColor[ i ] * ( falloff * ndl );
  reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
  // Cheap Blinn-Phong highlight so metal (gold, aircraft) and water catch it.
  vec3 h = normalize( l + geometryViewDir );
  float rough = max( material.roughness, 0.08 );
  float shine = 2.0 / ( rough * rough * rough * rough ) - 2.0;
  float spec = pow( saturate( dot( geometryNormal, h ) ), shine ) * ( shine + 8.0 ) * 0.0398;
  reflectedLight.directSpecular += irradiance * material.specularColor * spec;
}
#endif
`;

/** Additive glow sprites around fires; the cheap stand-in for bloom. */
export class HaloSprites {
  readonly points: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private positions: Float32Array;
  private colors: Float32Array;
  constructor(capacity: number) {
    this.positions = new Float32Array(capacity * 3);
    this.colors = new Float32Array(capacity * 4);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage),
    );
    geometry.setAttribute(
      "haloColor",
      new THREE.BufferAttribute(this.colors, 4).setUsage(THREE.DynamicDrawUsage),
    );
    geometry.setDrawRange(0, 0);
    this.points = new THREE.Points(
      geometry,
      new THREE.ShaderMaterial({
        uniforms: { viewportHeight: { value: 800 } },
        vertexShader: /* glsl */ `
          attribute vec4 haloColor;
          uniform float viewportHeight;
          varying vec3 vColor;
          void main(){
            vColor = haloColor.rgb;
            vec4 view = modelViewMatrix * vec4(position, 1.);
            gl_Position = projectionMatrix * view;
            // haloColor.a is the halo radius in metres.
            gl_PointSize = clamp(haloColor.a * projectionMatrix[1][1] * viewportHeight / max(-view.z, 1.), 2., 256.);
          }`,
        fragmentShader: /* glsl */ `
          varying vec3 vColor;
          void main(){
            float r = length(gl_PointCoord - .5) * 2.;
            float glow = pow(max(0., 1. - r), 2.2);
            gl_FragColor = vec4(vColor * glow, 1.);
          }`,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        // Additive glow would add haze colour if fogged.
        fog: false,
      }),
    );
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    // Always "visible" with an empty draw range, so its program is compiled
    // during warm-up rather than on the first fire.
  }
  update(candidates: readonly LightCandidate[], count: number, strength: number) {
    let n = 0;
    if (strength > 0.001)
      for (let i = 0; i < count; i++) {
        const c = candidates[i];
        if (!c.halo) continue;
        this.positions.set([c.x, c.y, c.z], n * 3);
        // Keep halos subtle by day; the caller passes a night-weighted strength.
        const k = 0.05 * strength;
        this.colors.set([c.r * k, c.g * k, c.b * k, c.range * 0.45], n * 4);
        n++;
      }
    const geometry = this.points.geometry;
    geometry.setDrawRange(0, n);
    if (n) {
      geometry.attributes.position.needsUpdate = true;
      geometry.attributes.haloColor.needsUpdate = true;
    }
  }
  dispose() {
    this.points.geometry.dispose();
    this.points.material.dispose();
  }
}

// --- Source descriptions ---------------------------------------------------

/** Light from a short-lived explosion flash at life fraction `t` (1 → 0). */
export function explosionLight(
  kind: Explosion["kind"],
  water: boolean,
  radius: number,
  t: number,
) {
  t = Math.max(0, Math.min(1, t));
  if (kind === "nuke") {
    // White-hot, then orange; lights a wide area from above the blast.
    const heat = Math.min(1, (1 - t) / 0.8);
    return {
      color: scratchColor.set("#ffffff").lerp(new THREE.Color("#ff9a3c"), heat).getHex(),
      intensity: 28 * t * t,
      range: Math.max(900, radius * 10),
      lift: radius * 0.6,
    };
  }
  if (kind === "fuel")
    return { color: 0xff8a2a, intensity: 9 * t * t, range: 230, lift: 25 };
  const base =
    kind === "collapse" || kind === "impact" ? 0 : kind === "crash" ? 10 : 12;
  return {
    color: water ? 0xcfeff0 : kind === "crash" ? 0xffd9a0 : 0xffc46a,
    intensity: base * (water ? 0.5 : 1) * t * t * t,
    range: Math.max(60, radius * 8),
    lift: Math.max(3, radius * 0.4),
  };
}

/** Flickering light above a burning patch; fades with its remaining life. */
export function fireLight(
  patch: Pick<FirePatch, "p" | "radius" | "height" | "seed">,
  time: number,
  fade = 1,
  inverted = false,
) {
  const flicker =
    0.82 +
    0.1 * Math.sin(time * 11.3 + patch.seed * 7) +
    0.08 * Math.sin(time * 23.7 + patch.seed * 3);
  return {
    x: patch.p[0],
    y: patch.p[1] + (inverted ? -1 : 1) * Math.max(4, patch.height * 0.6),
    z: patch.p[2],
    intensity: 3.2 * flicker * Math.max(0, Math.min(1, fade)),
    range: Math.max(40, patch.radius * 4 + 30),
  };
}

/** Burning fuel on the ground: small, dim pools. */
export function fuelLight(drop: Pick<FuelDrop, "radius" | "landed" | "burning">) {
  if (!drop.burning) return undefined;
  return {
    intensity: drop.landed ? 1.6 : 1.1,
    range: Math.max(18, drop.radius * (drop.landed ? 9 : 5)),
  };
}

/** Seconds a cannon muzzle flash lights its surroundings. */
export const MUZZLE_FLASH_TIME = 0.07;

/**
 * Muzzle flashes for new cannon shots and a small motor glow on nukes in
 * flight. New shots are recognised by id, so the flash fires once per shot.
 */
export class MuzzleFlashes {
  private seen = new Set<number>();
  private next = new Set<number>();
  private flashes: { x: number; y: number; z: number; age: number }[] = [];
  update(
    shots: readonly { id: number; p: readonly number[]; weapon: string }[],
    dt: number,
    lights: DynamicLights,
  ) {
    this.next.clear();
    for (const shot of shots) {
      this.next.add(shot.id);
      if (shot.weapon === "nuke")
        lights.add(shot.p[0], shot.p[1], shot.p[2], 0xffb35a, 1.6, 40);
      else if (!this.seen.has(shot.id) && this.flashes.length < 16)
        this.flashes.push({ x: shot.p[0], y: shot.p[1], z: shot.p[2], age: 0 });
    }
    [this.seen, this.next] = [this.next, this.seen];
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const f = this.flashes[i];
      const t = 1 - f.age / MUZZLE_FLASH_TIME;
      if (t <= 0) {
        this.flashes.splice(i, 1);
        continue;
      }
      lights.add(f.x, f.y, f.z, 0xffd27a, 5 * t, 35);
      f.age += dt;
    }
  }
  reset() {
    this.seen.clear();
    this.flashes.length = 0;
  }
}
