import * as THREE from "three";
import { CONFIG } from "../config";

/** The same authoritative wet mask clips beauty, AO, photo and particle depth. */
export function waterPrepass(
  material: THREE.Material,
  height: THREE.Texture,
  wet: THREE.Texture,
) {
  material.userData.prepassMaskKey = "canonical-water-v1";
  material.userData.prepassMask = (
    shader: THREE.WebGLProgramParametersWithUniforms,
  ) => {
    shader.uniforms.prepassHeight = { value: height };
    shader.uniforms.prepassWet = { value: wet };
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        "#include <common>\nvarying vec3 prepassWaterWorld;",
      )
      .replace(
        "#include <begin_vertex>",
        "#include <begin_vertex>\nprepassWaterWorld=(modelMatrix*vec4(transformed,1.)).xyz;",
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        "#include <common>\nvarying vec3 prepassWaterWorld; uniform sampler2D prepassHeight,prepassWet;",
      )
      .replace(
        "#include <clipping_planes_fragment>",
        `#include <clipping_planes_fragment>
        vec2 wetUV=(prepassWaterWorld.xz/${CONFIG.spacing}.+.5)/${CONFIG.grid}.;
        bool inWorld=all(greaterThanEqual(wetUV,vec2(0.)))&&all(lessThanEqual(wetUV,vec2(1.)));
        if(inWorld&&(texture2D(prepassWet,wetUV).r<.5||texture2D(prepassHeight,wetUV).r>=prepassWaterWorld.y))discard;`,
      );
  };
}
