import * as THREE from "three";
export function treeImpostor(map: THREE.Texture, day: THREE.IUniform<number>) {
  const material = new THREE.MeshBasicMaterial({
    map,
    alphaTest: 0.35,
    side: THREE.DoubleSide,
  });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.impostorDay = day;
    shader.vertexShader = shader.vertexShader.replace(
      "#include <project_vertex>",
      `vec4 mvPosition=modelViewMatrix*instanceMatrix*vec4(0.,0.,0.,1.);
    mvPosition.xy+=transformed.xy*vec2(length(instanceMatrix[0].xyz),length(instanceMatrix[1].xyz));gl_Position=projectionMatrix*mvPosition;`,
    );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        "#include <common>\nuniform float impostorDay;",
      )
      .replace(
        "#include <map_fragment>",
        "#include <map_fragment>\ndiffuseColor.rgb*=.25+impostorDay*.75;",
      );
  };
  material.customProgramCacheKey = () => "tree-impostor-v1";
  return material;
}
