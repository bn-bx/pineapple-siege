import * as THREE from "three";
import {
  SHADOW_FAR,
  SHADOW_SUN_DISTANCE,
  leadShadowCenter,
  shadowBias,
  snapShadowCenter,
} from "./shadow-frame";

/**
 * Cached sun shadows for scenery that does not move: terrain, trees,
 * buildings, rocks and statues.
 *
 * Two cascades (near and far) each hold a shadow map that is redrawn only
 * when the aircraft leaves its inner area, the sun turns a little, or the
 * world is damaged. The per-frame sun shadow map then carries only moving
 * things, so a large shadowed area costs far less than redrawing everything
 * every frame.
 *
 * Each cascade owns two lights (front and back buffers). The lights are never
 * added to the scene, so ordinary materials compile no shadow code for them;
 * `install` samples their maps directly and multiplies only the sun's light.
 */
export interface StaticCascade {
  /** Half-extent of the cascade's square (metres). */
  half: number;
  /** Re-centre once the wanted centre moves this share of `half`. */
  recenter: number;
  /** Redraw after the light turns this far (radians). */
  sunStep: number;
}

export const STATIC_CASCADES: readonly StaticCascade[] = [
  { half: 300, recenter: 0.35, sunStep: 0.25 * (Math.PI / 180) },
  { half: 1500, recenter: 0.25, sunStep: 0.5 * (Math.PI / 180) },
];
/** Destruction and craters are grouped into one redraw per interval (s). */
export const STATIC_WORLD_INTERVAL = 0.5;
/** Crossfade from the previous map after a sun step (s). */
export const STATIC_FADE_SECONDS = 0.4;

/** Marks a mesh as static scenery: it casts only into the cached maps. */
export function markStaticCaster(object: THREE.Object3D) {
  object.userData.staticShadow = true;
  object.castShadow = false;
}

export interface StaticShadowInput {
  /** Aircraft (or inspection) position the cascades follow. */
  focus: THREE.Vector3;
  /** Ground height under the focus. */
  ground: number;
  /** Camera view direction, used to lead the cascades ahead. */
  view: THREE.Vector3;
  /** Points toward the light. */
  light: THREE.Vector3;
  /** Changes whenever scenery is destroyed or restored. */
  worldRevision: number;
  /** Presentation seconds, for grouping world redraws. */
  elapsed: number;
  /** Wall-clock seconds, for crossfades (they also run while paused). */
  now: number;
}

/** Why a cascade must redraw this frame (pure, for tests). */
export function staticRedrawReason(
  cascade: StaticCascade,
  state: {
    ready: boolean;
    center: THREE.Vector3;
    light: THREE.Vector3;
    worldRevision: number;
    lastWorldRedraw: number;
    dirty: boolean;
  },
  wanted: THREE.Vector3,
  input: Pick<StaticShadowInput, "light" | "worldRevision" | "elapsed">,
): "first" | "dirty" | "recenter" | "sun" | "world" | undefined {
  if (!state.ready) return "first";
  if (state.dirty) return "dirty";
  if (
    Math.hypot(wanted.x - state.center.x, wanted.z - state.center.z) >
    cascade.half * cascade.recenter
  )
    return "recenter";
  if (state.light.angleTo(input.light) > cascade.sunStep) return "sun";
  if (
    input.worldRevision !== state.worldRevision &&
    input.elapsed - state.lastWorldRedraw >= STATIC_WORLD_INTERVAL
  )
    return "world";
  return undefined;
}

interface CascadeState {
  config: StaticCascade;
  lights: [THREE.DirectionalLight, THREE.DirectionalLight];
  front: number;
  ready: boolean;
  dirty: boolean;
  center: THREE.Vector3;
  light: THREE.Vector3;
  worldRevision: number;
  lastWorldRedraw: number;
  fadeStart: number;
  /** Whether the previous buffer covers the same ground (crossfade allowed). */
  fading: boolean;
}

type ShadowRender = (
  lights: THREE.Light[],
  scene: THREE.Scene,
  camera: THREE.Camera,
) => void;

const PATCH_TARGET =
  "directLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( directionalShadowMap[ i ]";

export class StaticShadows {
  readonly uniforms = {
    staticShadowMap0: { value: null as THREE.Texture | null },
    staticShadowMap1: { value: null as THREE.Texture | null },
    staticShadowMap2: { value: null as THREE.Texture | null },
    staticShadowMap3: { value: null as THREE.Texture | null },
    staticShadowMatrix0: { value: new THREE.Matrix4() },
    staticShadowMatrix1: { value: new THREE.Matrix4() },
    staticShadowMatrix2: { value: new THREE.Matrix4() },
    staticShadowMatrix3: { value: new THREE.Matrix4() },
    /** Map sizes: near, far. */
    staticShadowSize: { value: new THREE.Vector2(1, 1) },
    /** Depth bias: near, far. */
    staticShadowBias: { value: new THREE.Vector2() },
    /** Normal bias: near, far. */
    staticShadowNormalBias: { value: new THREE.Vector2() },
    /** Crossfade progress from the previous buffer: near, far (1 = done). */
    staticShadowFade: { value: new THREE.Vector2(1, 1) },
    /** Whether each cascade has a map yet: near, far. */
    staticShadowReady: { value: new THREE.Vector2() },
  };
  /** Static cascade redraws so far. */
  renders = 0;
  /** Milliseconds the last static redraw took to submit. */
  lastMS = 0;
  /** Casters drawn in the last static redraw. */
  lastCasters = 0;
  private readonly cascades: CascadeState[];
  private readonly installed = new WeakSet<THREE.Material>();
  private readonly saved: { object: THREE.Object3D; cast: boolean }[] = [];
  private readonly wanted = new THREE.Vector3();
  private sizes: readonly number[] = [2048, 2048];

  constructor(
    private readonly scene: THREE.Scene,
    cascades: readonly StaticCascade[] = STATIC_CASCADES,
  ) {
    this.cascades = cascades.map((config, index) => ({
      config,
      lights: [0, 1].map((buffer) => {
        const light = new THREE.DirectionalLight();
        light.name = `static-shadow-${index}-${buffer}`;
        light.castShadow = true;
        light.shadow.autoUpdate = false;
        return light;
      }) as [THREE.DirectionalLight, THREE.DirectionalLight],
      front: 0,
      ready: false,
      dirty: true,
      center: new THREE.Vector3(NaN, 0, NaN),
      light: new THREE.Vector3(0, 1, 0),
      worldRevision: -1,
      lastWorldRedraw: -Infinity,
      fadeStart: -Infinity,
      fading: false,
    }));
  }

  /** Map size per cascade (from the quality profile). Resizing redraws. */
  setSizes(sizes: readonly number[]) {
    if (sizes.every((size, i) => size === this.sizes[i])) return;
    this.sizes = sizes;
    for (const cascade of this.cascades) {
      for (const light of cascade.lights) {
        light.shadow.map?.dispose();
        light.shadow.map = null;
      }
      cascade.ready = false;
      cascade.dirty = true;
    }
    this.uniforms.staticShadowReady.value.set(0, 0);
  }

  /** Forces every cascade to redraw (context restore, island reset). */
  invalidate() {
    for (const cascade of this.cascades) cascade.dirty = true;
  }

  /** GPU bytes held by the cached maps (RGBA8, two buffers per cascade). */
  get bytes() {
    return this.sizes.reduce((sum, size) => sum + size * size * 4 * 2, 0);
  }

  /**
   * Call once per frame, after scenery visibility is updated. Redraws at most
   * one cascade, nearest first. Pass `all` during warmup to draw every cascade.
   */
  update(
    render: ShadowRender,
    camera: THREE.Camera,
    input: StaticShadowInput,
    all = false,
  ) {
    let drew = false;
    this.cascades.forEach((cascade, index) => {
      const { config } = cascade;
      const wanted = this.wanted.set(input.focus.x, input.ground, input.focus.z);
      leadShadowCenter(wanted, input.view, config.half);
      const reason = staticRedrawReason(config, cascade, wanted, input);
      if (reason && (!drew || all) && input.light.y > -0.2) {
        drew = true;
        this.draw(render, camera, cascade, index, wanted, input, reason);
      }
      const fade = cascade.fading
        ? Math.min(1, (input.now - cascade.fadeStart) / STATIC_FADE_SECONDS)
        : 1;
      if (fade >= 1) cascade.fading = false;
      this.uniforms.staticShadowFade.value.setComponent(index, fade);
    });
  }

  private draw(
    render: ShadowRender,
    camera: THREE.Camera,
    cascade: CascadeState,
    index: number,
    wanted: THREE.Vector3,
    input: StaticShadowInput,
    reason: NonNullable<ReturnType<typeof staticRedrawReason>>,
  ) {
    const started = performance.now();
    const { config } = cascade;
    const size = this.sizes[index] ?? 2048;
    const back = cascade.lights[1 - cascade.front];
    const light = input.light.clone().normalize();
    // A sun step keeps the old centre so the previous map covers the same
    // ground and can crossfade; anything else may move the cascade.
    const center =
      reason === "sun" || reason === "world"
        ? cascade.center.clone()
        : snapShadowCenter(wanted.clone(), light, (config.half * 2) / size);
    if (back.shadow.mapSize.x !== size) {
      back.shadow.map?.dispose();
      back.shadow.map = null;
      back.shadow.mapSize.set(size, size);
    }
    Object.assign(back.shadow.camera, {
      left: -config.half,
      right: config.half,
      top: config.half,
      bottom: -config.half,
      near: 1,
      far: SHADOW_FAR,
    });
    back.shadow.camera.updateProjectionMatrix();
    const { bias, normalBias } = shadowBias((config.half * 2) / size);
    back.shadow.bias = bias;
    back.shadow.normalBias = normalBias;
    back.position.copy(center).addScaledVector(light, SHADOW_SUN_DISTANCE);
    back.target.position.copy(center);
    back.updateMatrixWorld(true);
    back.target.updateMatrixWorld(true);

    // Only static scenery casts into the cached maps.
    let casters = 0;
    this.scene.traverse((object) => {
      const cast = !!object.userData.staticShadow;
      if (object.castShadow === cast) {
        if (cast) casters++;
        return;
      }
      this.saved.push({ object, cast: object.castShadow });
      object.castShadow = cast;
      if (cast) casters++;
    });
    back.shadow.needsUpdate = true;
    render([back], this.scene, camera);
    for (const { object, cast } of this.saved) object.castShadow = cast;
    this.saved.length = 0;

    const crossfade = cascade.ready && (reason === "sun" || reason === "world");
    cascade.front = 1 - cascade.front;
    cascade.ready = true;
    cascade.dirty = false;
    cascade.center.copy(center);
    cascade.light.copy(light);
    if (input.worldRevision !== cascade.worldRevision) {
      cascade.worldRevision = input.worldRevision;
      cascade.lastWorldRedraw = input.elapsed;
    }
    cascade.fading = crossfade;
    cascade.fadeStart = input.now;
    this.bind(cascade, index, size, bias, normalBias);
    this.renders++;
    this.lastCasters = casters;
    this.lastMS = performance.now() - started;
  }

  private bind(
    cascade: CascadeState,
    index: number,
    size: number,
    bias: number,
    normalBias: number,
  ) {
    const u = this.uniforms as unknown as Record<
      string,
      { value: THREE.Texture | THREE.Matrix4 | null }
    >;
    const front = cascade.lights[cascade.front],
      previous = cascade.lights[1 - cascade.front];
    const slot = index * 2;
    u[`staticShadowMap${slot}`].value = front.shadow.map!.texture;
    (u[`staticShadowMatrix${slot}`].value as THREE.Matrix4).copy(
      front.shadow.matrix,
    );
    // Without a previous map, "previous" repeats the front so a fade is a no-op.
    const prior = previous.shadow.map ? previous : front;
    u[`staticShadowMap${slot + 1}`].value = prior.shadow.map!.texture;
    (u[`staticShadowMatrix${slot + 1}`].value as THREE.Matrix4).copy(
      prior.shadow.matrix,
    );
    this.uniforms.staticShadowSize.value.setComponent(index, size);
    this.uniforms.staticShadowBias.value.setComponent(index, bias);
    this.uniforms.staticShadowNormalBias.value.setComponent(index, normalBias);
    this.uniforms.staticShadowReady.value.setComponent(index, 1);
  }

  /** Adds the cached static shadows to the sun's light in a lit material. */
  install(material: THREE.Material) {
    if (
      !(
        material instanceof THREE.MeshStandardMaterial ||
        material instanceof THREE.MeshLambertMaterial ||
        material instanceof THREE.MeshPhongMaterial
      ) ||
      this.installed.has(material)
    )
      return;
    this.installed.add(material);
    const prior = material.onBeforeCompile,
      key = material.customProgramCacheKey();
    material.onBeforeCompile = (shader, renderer) => {
      prior.call(material, shader, renderer);
      Object.assign(shader.uniforms, this.uniforms);
      if (shader.vertexShader.includes("vStaticShadowCoord0")) return;
      shader.vertexShader = patchStaticShadowVertex(shader.vertexShader);
      shader.fragmentShader = patchStaticShadowFragment(shader.fragmentShader);
    };
    material.customProgramCacheKey = () => `${key}:static-shadow-v1`;
    material.needsUpdate = true;
  }

  dispose() {
    for (const cascade of this.cascades)
      for (const light of cascade.lights) light.shadow.dispose();
  }
}

const GUARD = "#if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0";

export function patchStaticShadowVertex(source: string) {
  return `${GUARD}
uniform mat4 staticShadowMatrix0;
uniform mat4 staticShadowMatrix1;
uniform mat4 staticShadowMatrix2;
uniform mat4 staticShadowMatrix3;
uniform vec2 staticShadowNormalBias;
varying vec4 vStaticShadowCoord0;
varying vec4 vStaticShadowCoord1;
varying vec4 vStaticShadowCoord2;
varying vec4 vStaticShadowCoord3;
#endif
${source}`.replace(
    "#include <shadowmap_vertex>",
    `#include <shadowmap_vertex>
${GUARD}
vStaticShadowCoord0 = staticShadowMatrix0 * ( worldPosition + vec4( shadowWorldNormal * staticShadowNormalBias.x, 0.0 ) );
vStaticShadowCoord1 = staticShadowMatrix1 * ( worldPosition + vec4( shadowWorldNormal * staticShadowNormalBias.x, 0.0 ) );
vStaticShadowCoord2 = staticShadowMatrix2 * ( worldPosition + vec4( shadowWorldNormal * staticShadowNormalBias.y, 0.0 ) );
vStaticShadowCoord3 = staticShadowMatrix3 * ( worldPosition + vec4( shadowWorldNormal * staticShadowNormalBias.y, 0.0 ) );
#endif`,
  );
}

export function patchStaticShadowFragment(source: string) {
  const lights = THREE.ShaderChunk.lights_fragment_begin;
  if (!lights.includes(PATCH_TARGET))
    throw Error("Three's lights_fragment_begin changed; update static shadows");
  const patched = lights.replace(
    PATCH_TARGET,
    `directLight.color *= receiveShadow ? staticSun : 1.0;\n\t\t${PATCH_TARGET}`,
  );
  return `${GUARD}
uniform sampler2D staticShadowMap0;
uniform sampler2D staticShadowMap1;
uniform sampler2D staticShadowMap2;
uniform sampler2D staticShadowMap3;
uniform vec2 staticShadowSize;
uniform vec2 staticShadowBias;
uniform vec2 staticShadowFade;
uniform vec2 staticShadowReady;
varying vec4 vStaticShadowCoord0;
varying vec4 vStaticShadowCoord1;
varying vec4 vStaticShadowCoord2;
varying vec4 vStaticShadowCoord3;
#endif
${source}`.replace(
    "#include <lights_fragment_begin>",
    `${GUARD}
float staticSun = 1.0;
{
  vec2 staticNearUV = vStaticShadowCoord0.xy / vStaticShadowCoord0.w;
  vec2 staticNearEdge = min( staticNearUV, 1.0 - staticNearUV );
  float staticNearWeight = staticShadowReady.x * smoothstep( 0.0, 0.08, min( staticNearEdge.x, staticNearEdge.y ) );
  float staticNear = 1.0;
  float staticFar = 1.0;
  if ( staticNearWeight > 0.0 ) {
    staticNear = getShadow( staticShadowMap0, vec2( staticShadowSize.x ), 1.0, staticShadowBias.x, 1.0, vStaticShadowCoord0 );
    if ( staticShadowFade.x < 1.0 )
      staticNear = mix( getShadow( staticShadowMap1, vec2( staticShadowSize.x ), 1.0, staticShadowBias.x, 1.0, vStaticShadowCoord1 ), staticNear, staticShadowFade.x );
  }
  if ( staticNearWeight < 1.0 && staticShadowReady.y > 0.5 ) {
    staticFar = getShadow( staticShadowMap2, vec2( staticShadowSize.y ), 1.0, staticShadowBias.y, 1.0, vStaticShadowCoord2 );
    if ( staticShadowFade.y < 1.0 )
      staticFar = mix( getShadow( staticShadowMap3, vec2( staticShadowSize.y ), 1.0, staticShadowBias.y, 1.0, vStaticShadowCoord3 ), staticFar, staticShadowFade.y );
  }
  staticSun = mix( staticFar, staticNear, staticNearWeight );
}
#endif
${patched}`,
  );
}
