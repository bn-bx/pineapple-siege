import * as THREE from "three";

export interface TreeLODState {
  camera: THREE.IUniform<THREE.Vector3>;
  ranges: THREE.IUniform<THREE.Vector2>;
  warming: THREE.IUniform<number>;
}
const bindings = new WeakMap<
  THREE.Material,
  { state: TreeLODState; band: number }
>();

/** One authoritative instance array, with identical bands in every render pass. */
export function treeLOD(
  material: THREE.Material,
  state: TreeLODState,
  band: number,
) {
  const binding = bindings.get(material);
  if (binding) {
    binding.state = state;
    binding.band = band;
    return;
  }
  const current = { state, band };
  bindings.set(material, current);
  const prior = material.onBeforeCompile,
    key = material.customProgramCacheKey();
  material.customProgramCacheKey = () =>
    `${key}:tree-distance-bands-v2:${current.band}`;
  material.onBeforeCompile = (shader, renderer) => {
    prior.call(material, shader, renderer);
    shader.uniforms.treeLODCamera = current.state.camera;
    shader.uniforms.treeLODRanges = current.state.ranges;
    shader.uniforms.treeLODWarming = current.state.warming;
    shader.uniforms.treeLODBand = { value: current.band };
    shader.vertexShader = `varying float vTreeLODCoverage;
uniform vec3 treeLODCamera;
uniform vec2 treeLODRanges;
uniform float treeLODWarming, treeLODBand;
${shader.vertexShader}`.replace(
      /void main\s*\(\s*\)\s*\{/,
      `void main() {
  vTreeLODCoverage = 1.;
#ifdef USE_INSTANCING
  vec3 lodRoot = (modelMatrix * vec4(instanceMatrix[3].xyz, 1.)).xyz;
  vec2 lodOffset = lodRoot.xz - treeLODCamera.xz;
  float lodDistance = dot(lodOffset, lodOffset);
  vec2 transitionWidth=max(vec2(64.),treeLODRanges*.1);
  float nearFade=treeLODRanges.x>0. ? smoothstep(max(0.,treeLODRanges.x-transitionWidth.x),treeLODRanges.x+transitionWidth.x,lodDistance) : 1.;
  float middleFade=treeLODRanges.y>0. ? smoothstep(max(0.,treeLODRanges.y-transitionWidth.y),treeLODRanges.y+transitionWidth.y,lodDistance) : 1.;
  float coverage=treeLODBand<.5 ? 1.-nearFade : treeLODBand<1.5 ? nearFade*(1.-middleFade) : nearFade*middleFade;
  bool lodVisible=coverage>0.;
  if(treeLODWarming<.5)vTreeLODCoverage=coverage;
  if (treeLODWarming < .5 && !lodVisible) {
    gl_Position = vec4(2., 2., 2., 1.); return;
  }
#endif`,
    );
    shader.fragmentShader = `varying float vTreeLODCoverage;
uniform float treeLODBand;
${shader.fragmentShader}`.replace(
      /void main\s*\(\s*\)\s*\{/,
      `void main() {
  if(vTreeLODCoverage<.999){
    float pixel=fract(52.9829189*fract(dot(floor(gl_FragCoord.xy),vec2(.06711056,.00583715))));
    if(treeLODBand>.5&&treeLODBand<1.5){if(pixel<1.-vTreeLODCoverage)discard;}
    else if(pixel>vTreeLODCoverage)discard;
  }`,
    );
  };
}

/** Optional eyes inherit the exact band of their source tree. */
export function copyTreeLOD(source: THREE.Material, target: THREE.Material) {
  const binding = bindings.get(source);
  if (binding) treeLOD(target, binding.state, binding.band);
}

export function treeBand(distance: number, near: number, middle: number) {
  return distance < near ? 0 : distance < middle ? 1 : 2;
}
