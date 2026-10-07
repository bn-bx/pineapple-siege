import * as THREE from "three";
import { CONFIG } from "../config";
import type { TerrainView } from "./terrain-view";
import { waterPrepass } from "./water-prepass";

/** One beauty draw, clipped by the same wet/height data as the simulation. */
export function makeWaterMaterial(terrain: TerrainView) {
  const time = { value: 0 };
  const material = new THREE.MeshStandardMaterial({
    color: "#285f65",
    roughness: 0.35,
    metalness: 0.1,
    side: THREE.DoubleSide,
  });
  waterPrepass(material, terrain.heightTexture, terrain.floodTexture);
  material.onBeforeCompile = (shader) => {
    material.userData.prepassMask(shader);
    shader.uniforms.oceanTime = time;
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        "#include <common>\nuniform float oceanTime;",
      )
      .replace(
        "#include <normal_fragment_maps>",
        `#include <normal_fragment_maps>
        vec2 p=prepassWaterWorld.xz;
        vec2 ripple=vec2(cos(p.x*.12+oceanTime*.5),sin(p.y*.09-oceanTime*.4))*.035;
        normal=normalize(normal+(viewMatrix*vec4(ripple.x,0.,ripple.y,0.)).xyz);`,
      );
  };
  material.customProgramCacheKey = () => "simple-ocean-v1";
  material.userData.time = time;
  return material;
}

export function makeOcean(terrain: TerrainView) {
  const material = makeWaterMaterial(terrain);
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(CONFIG.worldSize * 3, CONFIG.worldSize * 3),
    material,
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(CONFIG.worldSize / 2, 0, CONFIG.worldSize / 2);
  mesh.userData.time = material.userData.time;
  return mesh;
}
