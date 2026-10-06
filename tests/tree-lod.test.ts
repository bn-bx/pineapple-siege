import { expect, it } from "vitest";
import * as THREE from "three";
import { copyTreeLOD, treeBand, treeLOD } from "../src/render/tree-lod";
import { foliageWind } from "../src/render/foliage-wind";
import { qualityProfile } from "../src/render/quality-profile";
import { GameRenderer } from "../src/render/renderer";

it("partitions each tree exactly once, including disabled near detail", () => {
  expect(
    [0, 139.9, 140, 299.9, 300, 1200].map((d) => treeBand(d, 140, 300)),
  ).toEqual([0, 0, 1, 1, 2, 2]);
  expect(treeBand(0, 0, 160)).toBe(1);
  for (let level = 0; level <= 4; level++) {
    const profile = qualityProfile("auto", level);
    expect(profile.middleFoliageDistance).toBeGreaterThan(
      profile.nearFoliageDistance,
    );
  }
});

it("shares main-camera bands through wind, shadow and eye shaders and restores warmup", () => {
  const state = {
      camera: { value: new THREE.Vector3(10, 20, 30) },
      ranges: { value: new THREE.Vector2(140 ** 2, 300 ** 2) },
      warming: { value: 0 },
    },
    time = { value: 10 };
  const material = new THREE.MeshStandardMaterial();
  foliageWind(material, time);
  treeLOD(material, state, 1);
  const key = material.customProgramCacheKey();
  treeLOD(material, state, 1);
  expect(material.customProgramCacheKey()).toBe(key);
  const compile = (source: THREE.Material) => {
    const shader = {
      uniforms: {},
      vertexShader:
        "#include <common>\nvoid main() {\n#include <begin_vertex>\n}",
      fragmentShader: "void main() { gl_FragColor=vec4(1.); }",
    } as THREE.WebGLProgramParametersWithUniforms;
    source.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
    return shader;
  };
  const shader = compile(material);
  expect(shader.uniforms.treeLODCamera).toBe(state.camera);
  expect(shader.uniforms.foliageTime).toBe(time);
  expect(shader.fragmentShader).toContain(
    "if(pixel<1.-vTreeLODCoverage)discard",
  );
  expect(shader.vertexShader.indexOf("if (treeLODWarming")).toBeLessThan(
    shader.vertexShader.indexOf("transformed.x"),
  );
  expect(shader.vertexShader.match(/uniform vec3 treeLODCamera/g)).toHaveLength(
    1,
  );
  state.warming.value = 1;
  expect(shader.uniforms.treeLODWarming.value).toBe(1);
  const depth = new THREE.MeshDepthMaterial();
  foliageWind(depth, time);
  treeLOD(depth, state, 1);
  expect(compile(depth).uniforms.treeLODRanges).toBe(state.ranges);
  const eyes = new THREE.ShaderMaterial();
  copyTreeLOD(material, eyes);
  expect(compile(eyes).uniforms.treeLODBand.value).toBe(1);
  treeLOD(depth, state, 0);
  expect(depth.customProgramCacheKey()).not.toBe(
    material.customProgramCacheKey(),
  );
});

it("compacts all tree detail views together when the authoritative owner disappears", () => {
  const meshes = Array.from(
    { length: 3 },
    () =>
      new THREE.InstancedMesh(
        new THREE.BoxGeometry(),
        new THREE.MeshBasicMaterial(),
        2,
      ),
  );
  const transform = new THREE.Matrix4().makeTranslation(23, 0, 42);
  for (const mesh of meshes) mesh.setMatrixAt(1, transform);
  const batch = {
    mesh: meshes[0],
    middle: meshes[1],
    low: meshes[2],
    ids: [10, 20],
  };
  const renderer = Object.create(GameRenderer.prototype) as any;
  renderer.removed = new Set();
  renderer.fragmentColor = new THREE.Color();
  renderer.refs = new Map([
    [10, [{ batch, index: 0 }]],
    [20, [{ batch, index: 1 }]],
  ]);
  renderer.hideEntity(10);
  expect(batch.ids).toEqual([20]);
  expect(renderer.refs.get(20)[0].index).toBe(0);
  for (const mesh of meshes) {
    expect(mesh.count).toBe(1);
    const value = new THREE.Matrix4();
    mesh.getMatrixAt(0, value);
    expect(value.elements).toEqual(transform.elements);
  }
});
