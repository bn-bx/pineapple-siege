import { expect, it } from "vitest";
import * as THREE from "three";
import { installCanopyCut, makeCanopyCut } from "../src/render/canopy-cut";

const shader = (shaderType: string) =>
  ({
    shaderType,
    uniforms: {} as Record<string, THREE.IUniform>,
    vertexShader: "void main() {\n#include <project_vertex>\n}",
    fragmentShader: "void main() {\n}",
  }) as any;

it("dithers foliage between the camera and the truck, but never shadows", () => {
  const cut = makeCanopyCut();
  const material = new THREE.MeshStandardMaterial();
  const before = material.customProgramCacheKey();
  installCanopyCut(material, cut);
  expect(material.customProgramCacheKey()).not.toBe(before);

  const colour = shader("MeshStandardMaterial");
  material.onBeforeCompile(colour, {} as any);
  expect(colour.uniforms.canopyCutStrength).toBe(cut.strength);
  expect(colour.uniforms.canopyCutStart).toBe(cut.start);
  expect(colour.vertexShader).toContain("canopyCutWorld =");
  expect(colour.fragmentShader).toContain("canopyCutWeight(canopyCutWorld)");

  // Shadow maps keep the whole canopy, so the truck still drives in shade.
  const depth = shader("MeshDepthMaterial");
  material.onBeforeCompile(depth, {} as any);
  expect(depth.uniforms.canopyCutStrength).toBeUndefined();
  expect(depth.fragmentShader).not.toContain("canopyCut");
});
