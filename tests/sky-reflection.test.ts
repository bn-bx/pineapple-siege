import * as THREE from "three";
import { expect, it } from "vitest";
import { SkyReflection } from "../src/render/sky-reflection";

const shaderFor = (material: THREE.Material) => {
  const shader = {
    uniforms: {} as Record<string, THREE.IUniform>,
    vertexShader: "void main(){}",
    fragmentShader:
      "#include <lights_pars_begin>\nvoid main(){\n#include <lights_fragment_maps>\n#include <lights_fragment_end>\n}",
  };
  material.onBeforeCompile(shader as never, undefined as never);
  return shader;
};

it("adds sky reflections to metal only", () => {
  const sky = new SkyReflection(new THREE.Color(0, 0, 1), new THREE.Color(1, 1, 1), new THREE.Color(0.2, 0.3, 0.1));
  const gold = new THREE.MeshStandardMaterial({ metalness: 0.7, roughness: 0.35 });
  const stone = new THREE.MeshStandardMaterial({ metalness: 0, roughness: 0.9 });
  const basic = new THREE.MeshBasicMaterial();
  const keys = [gold, stone, basic].map((m) => m.customProgramCacheKey());
  for (const m of [gold, stone, basic]) {
    sky.install(m);
    sky.install(m);
  }
  expect(gold.customProgramCacheKey()).toBe(`${keys[0]}:sky-reflection-v1`);
  expect(stone.customProgramCacheKey()).toBe(keys[1]);
  expect(basic.customProgramCacheKey()).toBe(keys[2]);
  const shader = shaderFor(gold);
  expect(shader.uniforms.skyReflZenith.value).toBe(sky.uniforms.skyReflZenith.value);
  // Feeds Three's indirect specular, so Fresnel and roughness still apply.
  expect(shader.fragmentShader).toContain("radiance+=skyReflection(");
  expect(shader.fragmentShader.indexOf("radiance+=skyReflection(")).toBeLessThan(
    shader.fragmentShader.indexOf("#include <lights_fragment_end>"),
  );
  // Materials with a real environment map are left alone.
  const mirrored = new THREE.MeshStandardMaterial({ metalness: 1, envMap: new THREE.Texture() });
  const key = mirrored.customProgramCacheKey();
  sky.install(mirrored);
  expect(mirrored.customProgramCacheKey()).toBe(key);
});

it("reflects the live sky colours, so reflections follow the time of day", () => {
  const zenith = new THREE.Color(0, 0, 1);
  const sky = new SkyReflection(zenith, new THREE.Color(), new THREE.Color());
  zenith.setRGB(0.01, 0.02, 0.05); // night
  expect(sky.uniforms.skyReflZenith.value.b).toBeCloseTo(0.05);
});
