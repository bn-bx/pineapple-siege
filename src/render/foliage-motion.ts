import * as THREE from "three";

/** One shared clock drives standing foliage, its LODs and matching shadow geometry. */
export function installFoliageMotion(
  material: THREE.Material,
  clock: { value: number },
) {
  const previous = material.onBeforeCompile,
    key = material.customProgramCacheKey();
  material.onBeforeCompile = (shader, renderer) => {
    previous.call(material, shader, renderer);
    shader.uniforms.foliageTime = clock;
    shader.vertexShader = `attribute float foliageFlex; uniform float foliageTime;\n${shader.vertexShader}`;
    shader.vertexShader = shader.vertexShader.replace(
      "#include <begin_vertex>",
      `
#include <begin_vertex>
vec2 groveOrigin = vec2(0.0);
#ifdef USE_INSTANCING
  groveOrigin = instanceMatrix[3].xz;
#endif
float grovePhase = dot(groveOrigin, vec2(0.013, 0.017));
float breeze = sin(foliageTime * 1.1 + grovePhase) * 0.006
  + sin(foliageTime * 2.3 + grovePhase * 1.7 + position.y * 9.0) * 0.002;
transformed.x += breeze * foliageFlex;
transformed.z += cos(foliageTime * 0.9 + grovePhase + position.y * 4.0) * 0.004 * foliageFlex;
`,
    );
  };
  material.customProgramCacheKey = () => `${key}:foliage-breeze-v1`;
}
