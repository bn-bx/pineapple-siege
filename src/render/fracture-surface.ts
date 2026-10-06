import * as THREE from "three";
/** Old fracture UV halves retain their cut-face meaning with the new shared scans. */
export function installFractureSurface(material: THREE.MeshStandardMaterial) {
  const prior = material.onBeforeCompile,
    key = material.customProgramCacheKey();
  material.onBeforeCompile = (shader, renderer) => {
    prior(shader, renderer);
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        "#include <common>\nvarying float vExposedCut;",
      )
      .replace(
        "#include <uv_vertex>",
        `#include <uv_vertex>
        vExposedCut=step(.5,uv.x);
        #ifdef USE_MAP
          vMapUv.x=fract(vMapUv.x*2.);
        #endif
        #ifdef USE_NORMALMAP
          vNormalMapUv.x=fract(vNormalMapUv.x*2.);
        #endif
        #ifdef USE_ROUGHNESSMAP
          vRoughnessMapUv.x=fract(vRoughnessMapUv.x*2.);
        #endif
        #ifdef USE_AOMAP
          vAoMapUv.x=fract(vAoMapUv.x*2.);
        #endif`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        "#include <common>\nvarying float vExposedCut;",
      )
      .replace(
        "#include <map_fragment>",
        "#include <map_fragment>\ndiffuseColor.rgb=mix(diffuseColor.rgb,diffuseColor.rgb*1.25+vec3(.025,.02,.015),vExposedCut);",
      );
  };
  material.customProgramCacheKey = () => key + "|scanned-cut-v1";
  material.needsUpdate = true;
}
