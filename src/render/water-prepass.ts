import * as THREE from "three";
import { terrainGPUTexture, type TerrainPages } from "./terrain-pages";
import { CONFIG } from "../config";

/** The same authoritative wet mask clips ocean, rivers and photo rendering. */
export function waterPrepass(
  material: THREE.Material,
  height: THREE.Texture,
  wet: THREE.Texture,
  smoothEdges = false,
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
  material.userData.prepassMaskKey =
    (pages ? "canonical-water-pages-v2" : "canonical-water-v1") +
    (smoothEdges ? "-smooth" : "");
  // Narrow rivers cut on the 2 m wet grid show stair-stepped banks. Blending
  // the four surrounding cells and cutting at one half gives the same wet
  // area with a smooth edge.
  const fetch = pages
    ? `vec2 page=floor(pixel/${pages.side}.);
       return texture(prepassWet,vec3((mod(pixel,${pages.side}.)+.5)/${pages.side}.,page.y*${pages.columns}.+page.x)).r;`
    : `return texture2D(prepassWet,(pixel+.5)/${CONFIG.grid}.).r;`;
  const heightFetch = fetch.replace("prepassWet", "prepassHeight");
  const smoothWet = smoothEdges
    ? `float prepassWetCell(vec2 pixel){
        pixel=clamp(pixel,vec2(0.),vec2(${CONFIG.grid - 1}.));
        ${fetch}
      }
      float prepassHeightCell(vec2 pixel){
        pixel=clamp(pixel,vec2(0.),vec2(${CONFIG.grid - 1}.));
        ${heightFetch}
      }
      // Ground height on the terrain mesh's own triangles.
      float prepassGround(vec2 world){
        vec2 p=world/${CONFIG.spacing}., cell=floor(p), f=fract(p);
        float a=prepassHeightCell(cell), b=prepassHeightCell(cell+vec2(1.,0.));
        float c=prepassHeightCell(cell+vec2(0.,1.)), d=prepassHeightCell(cell+vec2(1.));
        return f.x+f.y<=1. ? a+(b-a)*f.x+(c-a)*f.y
          : d+(c-d)*(1.-f.x)+(b-d)*(1.-f.y);
      }
      float prepassWetSmooth(vec2 world){
        // Cell centres sit on multiples of the spacing.
        vec2 p=world/${CONFIG.spacing}., cell=floor(p), f=fract(p);
        return mix(mix(prepassWetCell(cell),prepassWetCell(cell+vec2(1.,0.)),f.x),
          mix(prepassWetCell(cell+vec2(0.,1.)),prepassWetCell(cell+vec2(1.)),f.x),f.y);
      }`
    : "";
  const heightTest = smoothEdges
    ? "prepassGround(prepassWaterWorld.xz)>=prepassWaterWorld.y"
    : `${sample}(prepassHeight,sampleUV).r>=prepassWaterWorld.y`;
  const wetTest = smoothEdges
    ? "prepassWetSmooth(prepassWaterWorld.xz)<.5"
    : `${sample}(prepassWet,sampleUV).r<.5`;
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
        `#include <common>\nvarying vec3 prepassWaterWorld; ${declarations}\n${smoothWet}`,
      )
      .replace(
        "#include <clipping_planes_fragment>",
        `#include <clipping_planes_fragment>
        vec2 wetUV=(prepassWaterWorld.xz/${CONFIG.spacing}.+.5)/${CONFIG.grid}.;
        bool inWorld=all(greaterThanEqual(wetUV,vec2(0.)))&&all(lessThanEqual(wetUV,vec2(1.)));
        ${coordinates}
        if(inWorld&&(${wetTest}||${heightTest}))discard;`,
      );
  };
}
