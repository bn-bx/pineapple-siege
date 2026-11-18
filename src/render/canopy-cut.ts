import * as THREE from "three";

/**
 * Keeps the truck visible when driving under trees: foliage inside a soft
 * cylinder from the camera to the truck is dithered away with the same
 * opaque screen-door noise as the tree level-of-detail fade, so there is no
 * transparency sorting. Shadow (depth) passes are left whole, so the truck
 * still drives through dappled shade.
 */
export interface CanopyCut {
  /** Camera position; the near end of the cut. */
  start: { value: THREE.Vector3 };
  /** Point on the truck the camera is looking at; the far end of the cut. */
  end: { value: THREE.Vector3 };
  /** Radius in metres at which foliage is fully solid again. */
  radius: { value: number };
  /** 0 = off (flying), 1 = full cut (driving). */
  strength: { value: number };
}

export function makeCanopyCut(): CanopyCut {
  return {
    start: { value: new THREE.Vector3() },
    end: { value: new THREE.Vector3() },
    radius: { value: 7 },
    strength: { value: 0 },
  };
}

/** GLSL weight in [0, 1] of how much of a fragment at `world` to cut away. */
export const CANOPY_CUT_WEIGHT_GLSL = `
float canopyCutWeight(vec3 world){
  if(canopyCutStrength<=0.) return 0.;
  vec3 axis=canopyCutEnd-canopyCutStart;
  float span=max(dot(axis,axis),1e-4);
  float t=dot(world-canopyCutStart,axis)/span;
  // Only between the camera and the truck; foliage beyond the truck stays.
  if(t<0.||t>1.08) return 0.;
  float d=length(world-(canopyCutStart+axis*clamp(t,0.,1.)));
  float core=1.-smoothstep(canopyCutRadius*.45,canopyCutRadius,d);
  return core*(1.-smoothstep(.96,1.08,t))*canopyCutStrength;
}`;

export function installCanopyCut(material: THREE.Material, cut: CanopyCut) {
  const previous = material.onBeforeCompile;
  const key = material.customProgramCacheKey();
  const mask = (shader: THREE.WebGLProgramParametersWithUniforms) => {
    shader.fragmentShader = `uniform vec3 canopyCutStart, canopyCutEnd;
uniform float canopyCutRadius, canopyCutStrength;
varying vec3 canopyCutWorld;
${CANOPY_CUT_WEIGHT_GLSL}
${shader.fragmentShader}`.replace(
      /void main\s*\(\s*\)\s*\{/,
      `void main() {
float canopyCutNoise = fract(52.9829189 * fract(dot(gl_FragCoord.xy + 17., vec2(0.06711056, 0.00583715))));
if (canopyCutNoise < canopyCutWeight(canopyCutWorld)) discard;
`,
    );
  };
  material.onBeforeCompile = (shader, renderer) => {
    previous.call(material, shader, renderer);
    // Shadow maps keep the whole canopy.
    if ((shader as { shaderType?: string }).shaderType === "MeshDepthMaterial")
      return;
    Object.assign(shader.uniforms, {
      canopyCutStart: cut.start,
      canopyCutEnd: cut.end,
      canopyCutRadius: cut.radius,
      canopyCutStrength: cut.strength,
    });
    shader.vertexShader = `varying vec3 canopyCutWorld;\n${shader.vertexShader}`.replace(
      "#include <project_vertex>",
      // Undo the (rigid) view transform, so this holds however the vertex
      // was placed: instancing, swaying foliage or GPU-driven debris motion.
      `#include <project_vertex>
canopyCutWorld = transpose(mat3(viewMatrix)) * (mvPosition.xyz - viewMatrix[3].xyz);`,
    );
    mask(shader);
  };
  material.customProgramCacheKey = () => `${key}:canopy-cut-v2`;
  // The photo depth prepass keeps the vertex hooks but replaces fragment
  // code; give it the same cut so depth and colour agree.
  const previousMask = material.userData.prepassMask;
  material.userData.prepassMask = (
    shader: THREE.WebGLProgramParametersWithUniforms,
    renderer: THREE.WebGLRenderer,
  ) => {
    previousMask?.(shader, renderer);
    mask(shader);
  };
  material.userData.prepassMaskKey = `${material.userData.prepassMaskKey ?? ""}:canopy-cut`;
}
