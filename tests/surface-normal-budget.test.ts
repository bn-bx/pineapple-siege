import { expect, it, vi } from "vitest";
import * as THREE from "three";
import { budgetSurfaceNormals } from "../src/render/surface-normal-budget";
import { qualityProfile } from "../src/render/quality-profile";

it("retains rich profiles and changes shader detail through one shared uniform without recompile", () => {
  const material = new THREE.MeshStandardMaterial(),
    detail = { value: 1 };
  const prior = vi.fn();
  material.onBeforeCompile = prior;
  budgetSurfaceNormals(material, detail);
  const key = material.customProgramCacheKey();
  budgetSurfaceNormals(material, detail);
  expect(material.customProgramCacheKey()).toBe(key);
  const shader = {
    uniforms: {},
    fragmentShader: "#include <common>\n#include <normal_fragment_maps>",
  } as THREE.WebGLProgramParametersWithUniforms;
  material.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
  expect(prior).toHaveBeenCalledOnce();
  expect(shader.uniforms.uSurfaceNormalDetail).toBe(detail);
  expect(shader.fragmentShader).toContain("if(uSurfaceNormalDetail>.5)");
  detail.value = 0;
  expect(shader.uniforms.uSurfaceNormalDetail.value).toBe(0);
  expect(material.customProgramCacheKey()).toBe(key);
  expect(qualityProfile("1080").surfaceNormals).toBe(true);
  expect(qualityProfile("auto", 2).surfaceNormals).toBe(true);
  expect(qualityProfile("auto", 3).surfaceNormals).toBe(false);
  expect(qualityProfile("auto", 4).surfaceNormals).toBe(false);
  const replacement = { value: 1 };
  budgetSurfaceNormals(material, replacement);
  const restored = {
    uniforms: {},
    fragmentShader: "#include <common>\n#include <normal_fragment_maps>",
  } as THREE.WebGLProgramParametersWithUniforms;
  material.onBeforeCompile(restored, {} as THREE.WebGLRenderer);
  expect(restored.uniforms.uSurfaceNormalDetail).toBe(replacement);
});

it("composes inherited debris hooks without nesting normal sampling branches", () => {
  const source = new THREE.MeshStandardMaterial(),
    detail = { value: 1 };
  budgetSurfaceNormals(source, detail);
  const debris = source.clone();
  debris.onBeforeCompile = source.onBeforeCompile;
  debris.customProgramCacheKey = source.customProgramCacheKey;
  budgetSurfaceNormals(debris, detail);
  const shader = {
    uniforms: {},
    fragmentShader: "#include <common>\n#include <normal_fragment_maps>",
  } as THREE.WebGLProgramParametersWithUniforms;
  debris.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
  expect(shader.fragmentShader.match(/if\(uSurfaceNormalDetail/g)).toHaveLength(
    1,
  );
});
