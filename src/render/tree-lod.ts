import type * as THREE from "three";

export const TREE_LOD_FADE = 60;

/** Complementary opaque dithering avoids alpha sorting and whole-grove pops. */
export function installTreeLOD(
  material: THREE.Material,
  camera: { value: THREE.Vector2 },
  distance: { value: number },
  detailed: boolean,
) {
  const previous = material.onBeforeCompile;
  const key = material.customProgramCacheKey();
  const mask: THREE.Material["onBeforeCompile"] = (shader) => {
    shader.fragmentShader =
      `varying float treeLODWeight;\n${shader.fragmentShader}`.replace(
        /void main\s*\(\s*\)\s*\{/,
        `void main() {
float treeLODNoise = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
if (treeLODNoise ${detailed ? ">=" : "<"} treeLODWeight) discard;
`,
      );
  };
  material.onBeforeCompile = (shader, renderer) => {
    previous.call(material, shader, renderer);
    shader.uniforms.treeLODCamera = camera;
    shader.uniforms.treeLODDistance = distance;
    shader.vertexShader = `uniform vec2 treeLODCamera;
uniform float treeLODDistance;
varying float treeLODWeight;
${shader.vertexShader}`.replace(
      /void main\s*\(\s*\)\s*\{/,
      `void main() {
vec3 treeLODOrigin = vec3(0.0);
#ifdef USE_INSTANCING
treeLODOrigin = instanceMatrix[3].xyz;
#endif
treeLODOrigin = (modelMatrix * vec4(treeLODOrigin, 1.0)).xyz;
treeLODWeight = 1.0 - smoothstep(treeLODDistance - ${TREE_LOD_FADE.toFixed(1)}, treeLODDistance + ${TREE_LOD_FADE.toFixed(1)}, length(treeLODOrigin.xz - treeLODCamera));
if (${detailed ? "treeLODWeight <= 0.0" : "treeLODWeight >= 1.0"}) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
`,
    );
    mask(shader, renderer);
  };
  material.userData.prepassMask = mask;
  material.userData.prepassMaskKey = `tree-${detailed}`;
  material.customProgramCacheKey = () =>
    `${key}:tree-lod-${detailed ? "high" : "low"}-v1`;
}
