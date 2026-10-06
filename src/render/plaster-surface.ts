import * as THREE from "three";

/** Mineral plaster keeps its own surface rather than borrowing stone courses. */
export function plasterSurface(material: THREE.MeshStandardMaterial) {
  material.map =
    material.normalMap =
    material.roughnessMap =
    material.aoMap =
      null;
  material.color.set("#d8d0b6");
  material.roughness = 0.96;
  const prior = material.onBeforeCompile,
    key = material.customProgramCacheKey();
  material.customProgramCacheKey = () => `${key}:mineral-plaster-v1`;
  material.onBeforeCompile = (shader, renderer) => {
    prior.call(material, shader, renderer);
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        "#include <common>\nvarying vec3 plasterWorld;",
      )
      .replace(
        "#include <worldpos_vertex>",
        `#include <worldpos_vertex>
      vec4 plasterPosition=vec4(transformed,1.);
      #ifdef USE_INSTANCING
        plasterPosition=instanceMatrix*plasterPosition;
      #endif
      plasterWorld=(modelMatrix*plasterPosition).xyz;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
      varying vec3 plasterWorld;
      float plasterHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
      float plasterNoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(plasterHash(i),plasterHash(i+vec2(1.,0.)),f.x),mix(plasterHash(i+vec2(0.,1.)),plasterHash(i+1.),f.x),f.y);}`,
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
      vec2 plasterUV=vec2(plasterWorld.x+plasterWorld.z*.73,plasterWorld.y);
      float lime=plasterNoise(plasterUV*.47);
      float wear=plasterNoise(plasterUV*2.1+17.);
      diffuseColor.rgb*=mix(vec3(.75,.72,.66),vec3(1.04,1.025,.99),lime)*(.95+.05*wear);`,
      );
  };
  material.needsUpdate = true;
}
