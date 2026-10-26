import * as THREE from "three";

/** Extinction per metre at sea level: ~20% haze across 5 km at low altitude. */
export const AERIAL_FOG_DENSITY = 5e-5;
/** Clear distance (m): nearby scenery keeps full contrast. */
export const AERIAL_FOG_START = 500;
/** Height (m) over which haze density falls by a factor of e. */
export const AERIAL_FOG_SCALE_HEIGHT = 900;

/**
 * Height-attenuated aerial perspective for the normal island.
 *
 * Three's linear `Fog` supplies the uniforms: `near` carries the sea-level
 * density and `far` the scale height. The shared fog chunks are patched once
 * so the linear branch evaluates exponential height fog instead; `FogExp2`
 * (the Hell realm) is unchanged. Nothing else in the game uses linear `Fog`.
 */
export class AerialFog extends THREE.Fog {
  readonly isAerialFog = true;
  constructor(
    color: THREE.ColorRepresentation,
    density = AERIAL_FOG_DENSITY,
    scaleHeight = AERIAL_FOG_SCALE_HEIGHT,
  ) {
    super(color, density, scaleHeight);
    installAerialFogChunks();
  }
  get density() {
    return this.near;
  }
  get scaleHeight() {
    return this.far;
  }
}

/** Fraction of light replaced by haze between the camera and a point. */
export function aerialFogFactor(
  cameraHeight: number,
  offset: { x: number; y: number; z: number },
  density = AERIAL_FOG_DENSITY,
  scaleHeight = AERIAL_FOG_SCALE_HEIGHT,
) {
  const distance = Math.max(
    0,
    Math.hypot(offset.x, offset.y, offset.z) - AERIAL_FOG_START,
  );
  const k = 1 / scaleHeight;
  const dense = density * Math.exp(-Math.max(cameraHeight, 0) * k);
  const t = offset.y * k;
  // Integral of exp(-k*y) along the ray, normalized by its length.
  const integral = Math.abs(t) > 1e-4 ? (1 - Math.exp(-t)) / t : 1;
  return 1 - Math.exp(-dense * distance * integral);
}

const PARS_VERTEX = /* glsl */ `
#ifdef USE_FOG
  varying float vFogDepth;
  #ifndef FOG_EXP2
    varying vec3 vFogOffset;
  #endif
#endif
`;
const VERTEX = /* glsl */ `
#ifdef USE_FOG
  vFogDepth = - mvPosition.z;
  #ifndef FOG_EXP2
    // Rotate the view-space offset back to world axes (viewMatrix is
    // orthonormal, so vector * matrix applies its inverse rotation).
    vFogOffset = ( vec4( mvPosition.xyz, 0.0 ) * viewMatrix ).xyz;
  #endif
#endif
`;
const PARS_FRAGMENT = /* glsl */ `
#ifdef USE_FOG
  uniform vec3 fogColor;
  varying float vFogDepth;
  #ifdef FOG_EXP2
    uniform float fogDensity;
  #else
    uniform float fogNear;
    uniform float fogFar;
    varying vec3 vFogOffset;
  #endif
#endif
`;
const FRAGMENT = /* glsl */ `
#ifdef USE_FOG
  #ifdef FOG_EXP2
    float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
  #else
    // fogNear: sea-level density; fogFar: scale height (see AerialFog).
    float fogK = 1.0 / fogFar;
    float fogT = vFogOffset.y * fogK;
    float fogIntegral = abs( fogT ) > 1e-4 ? ( 1.0 - exp( - fogT ) ) / fogT : 1.0;
    float fogFactor = 1.0 - exp( - fogNear * exp( - max( cameraPosition.y, 0.0 ) * fogK )
      * max( length( vFogOffset ) - ${AERIAL_FOG_START.toFixed(1)}, 0.0 ) * fogIntegral );
  #endif
  #ifdef AERIAL_FOG_SCALE
    fogFactor *= AERIAL_FOG_SCALE;
  #endif
  gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
#endif
`;

let installed = false;
/** Idempotent; must run before any program that uses fog compiles. */
export function installAerialFogChunks() {
  if (installed) return;
  installed = true;
  THREE.ShaderChunk.fog_pars_vertex = PARS_VERTEX;
  THREE.ShaderChunk.fog_vertex = VERTEX;
  THREE.ShaderChunk.fog_pars_fragment = PARS_FRAGMENT;
  THREE.ShaderChunk.fog_fragment = FRAGMENT;
}
