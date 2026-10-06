import * as THREE from "three";
/** Shared construction surfaces keep their metre scale on stretched modules. */
export function constructionScale(
  material: THREE.MeshStandardMaterial,
  repeat: number,
) {
  const prior = material.onBeforeCompile,
    key = material.customProgramCacheKey();
  material.onBeforeCompile = (shader, renderer) => {
    prior(shader, renderer);
    shader.vertexShader = shader.vertexShader.replace(
      "#include <uv_vertex>",
      `#include <uv_vertex>
      vec4 constructionP=vec4(position,1.);
      vec3 constructionN=normal;
      #ifdef USE_INSTANCING
        constructionP=instanceMatrix*constructionP;
        vec3 constructionS=vec3(length(instanceMatrix[0].xyz),length(instanceMatrix[1].xyz),length(instanceMatrix[2].xyz));
        constructionN=mat3(instanceMatrix)*(normal/max(constructionS*constructionS,vec3(.001)));
      #endif
      constructionP=modelMatrix*constructionP;
      constructionN=abs(normalize(mat3(modelMatrix)*constructionN));
      vec2 constructionUV=constructionN.y>constructionN.x && constructionN.y>constructionN.z ? constructionP.xz : constructionN.x>constructionN.z ? constructionP.zy : constructionP.xy;
      constructionUV*=${repeat.toFixed(3)};
      #ifdef USE_MAP
        vMapUv=constructionUV;
      #endif
      #ifdef USE_NORMALMAP
        vNormalMapUv=constructionUV;
      #endif
      #ifdef USE_ROUGHNESSMAP
        vRoughnessMapUv=constructionUV;
      #endif
      #ifdef USE_AOMAP
        vAoMapUv=constructionUV;
      #endif`,
    );
  };
  material.customProgramCacheKey = () => `${key}|metre-scale-${repeat}`;
  material.needsUpdate = true;
}
