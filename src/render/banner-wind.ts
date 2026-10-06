import * as THREE from "three";

/** One clock drives cloth and its shadow; top edge remains attached. */
export function bannerWind(
  material: THREE.Material,
  time: THREE.IUniform<number>,
) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.bannerTime = time;
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        "#include <common>\nuniform float bannerTime;",
      )
      .replace(
        "#include <beginnormal_vertex>",
        `#include <beginnormal_vertex>
        float clothPin=1.-uv.y;
        float clothPhase=position.y*1.5+bannerTime*2.;
        float clothSlope=.24*cos(clothPhase)*clothPin;
        objectNormal=normalize(vec3(0.,-clothSlope,1.));`,
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        transformed.z+=sin(position.y*1.5+bannerTime*2.)*.16*(1.-uv.y);`,
      );
  };
  material.customProgramCacheKey = () => "banner-wind-v1";
}
