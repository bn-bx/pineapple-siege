import * as THREE from "three";
import { terrainGPUTexture, type TerrainPages } from "./terrain-pages";
import { CONFIG } from "../config";

/** The same authoritative wet mask clips ocean, rivers and photo rendering. */
export function waterPrepass(
  material: THREE.Material,
  height: THREE.Texture,
  wet: THREE.Texture,
) {
  const pages = height.userData.terrainPages as TerrainPages | undefined;
  const declarations = pages
    ? "uniform highp sampler2DArray prepassHeight,prepassWet;"
    : "uniform sampler2D prepassHeight,prepassWet;";
  const coordinates = pages
    ? `vec2 pixel=clamp(floor(prepassWaterWorld.xz/${CONFIG.spacing}.+.5),vec2(0.),vec2(${CONFIG.grid - 1}.));
    vec2 page=floor(pixel/${pages.side}.); vec3 sampleUV=vec3((mod(pixel,${pages.side}.)+.5)/${pages.side}.,page.y*${pages.columns}.+page.x);`
    : "vec2 sampleUV=wetUV;";
  const sample = pages ? "texture" : "texture2D";
  material.userData.prepassMaskKey = pages
    ? "canonical-water-pages-v2"
    : "canonical-water-v1";
  material.userData.prepassMask = (
    shader: THREE.WebGLProgramParametersWithUniforms,
  ) => {
    shader.uniforms.prepassHeight = { value: terrainGPUTexture(height) };
    shader.uniforms.prepassWet = { value: terrainGPUTexture(wet) };
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
        `#include <common>\nvarying vec3 prepassWaterWorld; ${declarations}`,
      )
      .replace(
        "#include <clipping_planes_fragment>",
        `#include <clipping_planes_fragment>
        vec2 wetUV=(prepassWaterWorld.xz/${CONFIG.spacing}.+.5)/${CONFIG.grid}.;
        bool inWorld=all(greaterThanEqual(wetUV,vec2(0.)))&&all(lessThanEqual(wetUV,vec2(1.)));
        ${coordinates}
        if(inWorld&&(${sample}(prepassWet,sampleUV).r<.5||${sample}(prepassHeight,sampleUV).r>=prepassWaterWorld.y))discard;`,
      );
  };
}
