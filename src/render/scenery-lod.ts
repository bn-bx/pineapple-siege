import type * as THREE from "three";

export const SCENERY_LOD_FADE = 160;

/** Hand each owner over individually, with complementary opaque coverage. */
export function installSceneryLOD(
  material: THREE.Material,
  camera: { value: THREE.Vector2 },
  distance: { value: number },
  detailed: boolean,
) {
  const previous = material.onBeforeCompile;
  const key = material.customProgramCacheKey();
  const mask: THREE.Material["onBeforeCompile"] = (shader) => {
    shader.fragmentShader =
      `varying float sceneryLODWeight;\n${shader.fragmentShader}`.replace(
        /void main\s*\(\s*\)\s*\{/,
        `void main() {
float sceneryLODNoise = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
if (sceneryLODNoise ${detailed ? ">=" : "<"} sceneryLODWeight) discard;
`,
      );
  };
  material.onBeforeCompile = (shader, renderer) => {
    previous.call(material, shader, renderer);
    shader.uniforms.sceneryLODCamera = camera;
    shader.uniforms.sceneryLODDistance = distance;
    shader.vertexShader = `uniform vec2 sceneryLODCamera;
uniform float sceneryLODDistance;
varying float sceneryLODWeight;
${shader.vertexShader}`.replace(
      /void main\s*\(\s*\)\s*\{/,
      `void main() {
vec3 sceneryLODOrigin = vec3(0.0);
#ifdef USE_INSTANCING
sceneryLODOrigin = instanceMatrix[3].xyz;
#endif
sceneryLODOrigin = (modelMatrix * vec4(sceneryLODOrigin, 1.0)).xyz;
sceneryLODWeight = 1.0 - smoothstep(sceneryLODDistance - ${SCENERY_LOD_FADE.toFixed(1)}, sceneryLODDistance + ${SCENERY_LOD_FADE.toFixed(1)}, length(sceneryLODOrigin.xz - sceneryLODCamera));
if (${detailed ? "sceneryLODWeight <= 0.0" : "sceneryLODWeight >= 1.0"}) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
`,
    );
    mask(shader, renderer);
  };
  material.customProgramCacheKey = () =>
    `${key}:scenery-lod-${detailed ? "near" : "far"}-v1`;
  // The photo prepass preserves the vertex hook but replaces fragment code.
  const previousMask = material.userData.prepassMask;
  material.userData.prepassMask = (
    shader: THREE.WebGLProgramParametersWithUniforms,
    renderer: THREE.WebGLRenderer,
  ) => {
    previousMask?.(shader, renderer);
    mask(shader, renderer);
  };
  material.userData.prepassMaskKey = `${material.userData.prepassMaskKey ?? ""}:scenery-${detailed}`;
}
