import * as THREE from "three";

const clocks = new WeakMap<THREE.Material, THREE.IUniform<number>>();

/** Identical leaf displacement in beauty, shadow, and auxiliary depth passes. */
export function foliageWind(
  material: THREE.Material,
  time: THREE.IUniform<number>,
) {
  clocks.set(material, time);
  material.onBeforeCompile = (shader) => {
    shader.uniforms.foliageTime = time;
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        "#include <common>\nuniform float foliageTime;",
      )
      .replace(
        "#include <begin_vertex>",
        "#include <begin_vertex>\nvec4 treeRoot=instanceMatrix*vec4(0.,0.,0.,1.); transformed.x+=sin(foliageTime*1.2+treeRoot.x*.04+treeRoot.z*.03+position.y*6.)*.006*position.y;",
      );
  };
  material.customProgramCacheKey = () => "tree-wind-v2";
}

export function copyFoliageWind(source: THREE.Material, depth: THREE.Material) {
  const time = clocks.get(source);
  if (time) foliageWind(depth, time);
}
