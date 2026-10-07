import { expect, it } from "vitest";
import * as THREE from "three";
import { installTerrainSurface } from "../src/render/terrain-surface";

it("keeps the scanned shoreline sand free of the grass tint", () => {
  const texture = new THREE.Texture(),
    surface = { color: texture, normal: texture, orm: texture },
    assets = {
      surfaces: new Map(
        ["grass", "rock", "soil", "sand"].map((name) => [name, surface]),
      ),
    } as any,
    material = new THREE.MeshStandardMaterial();
  installTerrainSurface(material, assets);
  const shader = {
    uniforms: {},
    vertexShader: "#include <common>\n#include <worldpos_vertex>",
    fragmentShader: [
      "#include <common>",
      "#include <map_fragment>",
      "#include <color_fragment>",
      "#include <normalmap_pars_fragment>",
      "#include <normal_fragment_maps>",
      "#include <roughnessmap_fragment>",
      "#include <aomap_fragment>",
    ].join("\n"),
  } as any;
  material.onBeforeCompile(shader, {} as any);
  expect(shader.fragmentShader).toContain("vec3 sandTex=");
  expect(shader.fragmentShader).toContain("max(cliff,shore)");
  expect(shader.fragmentShader).toContain("cliff=max(cliff,outcrop*.58)");
  expect(shader.fragmentShader).toContain("cliffRelief=landscapePatch*4.2");
});
