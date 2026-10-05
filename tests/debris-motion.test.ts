import { it, expect } from "vitest";
import * as THREE from "three";
import {
  prepareDebrisMotion,
  writeDebrisMotion,
  resizeDebrisMotion,
} from "../src/render/debris-motion";
it("uploads separate previous and current poses without modifying static geometry or materials", () => {
  const geometry = new THREE.BoxGeometry(),
    material = new THREE.MeshStandardMaterial();
  const mesh = new THREE.InstancedMesh(geometry, material, 4);
  prepareDebrisMotion(mesh, { value: 0.5 }, { value: 1 });
  const b = {
    id: 1,
    source: 2,
    p: [10, 20, 30],
    q: [0, 1, 0, 0],
    s: [2, 3, 4],
    kind: "chunk",
    material: "stone",
  } as any;
  writeDebrisMotion(mesh, 0, b, { ...b, p: [1, 2, 3], q: [0, 0, 0, 1] });
  expect(mesh.geometry).not.toBe(geometry);
  expect(mesh.material).not.toBe(material);
  expect(geometry.getAttribute("motionPreviousP")).toBeUndefined();
  expect(
    [...mesh.geometry.getAttribute("motionPreviousP").array].slice(0, 3),
  ).toEqual([1, 2, 3]);
  expect(
    [...mesh.geometry.getAttribute("motionCurrentQ").array].slice(0, 4),
  ).toEqual([0, 1, 0, 0]);
  expect([...mesh.instanceMatrix.array].slice(12, 16)).toEqual([10, 20, 30, 1]);
  resizeDebrisMotion(mesh);
  expect(mesh.geometry.getAttribute("motionPreviousQ").getW(3)).toBe(1);
});
it("patches color and shadow shaders with the same interpolation", () => {
  const mesh = new THREE.InstancedMesh(
    new THREE.BoxGeometry(),
    new THREE.MeshStandardMaterial(),
    1,
  );
  prepareDebrisMotion(mesh, { value: 0.25 }, { value: 1 });
  for (const material of [
    mesh.material,
    mesh.customDepthMaterial,
  ] as THREE.Material[]) {
    const shader = {
      vertexShader:
        "#include <common>\nvoid main() {\n#include <project_vertex>\n#include <worldpos_vertex>\n#include <defaultnormal_vertex>\n}",
      uniforms: {},
    } as any;
    material.onBeforeCompile(shader, {} as any);
    expect(shader.vertexShader).toContain(
      "motionP=mix(motionPreviousP,instanceMatrix[3].xyz,motionAlpha)",
    );
    expect(shader.vertexShader).toContain(
      "rotateMotion(motionQ,transformed*motionS)+motionP",
    );
    expect(shader.uniforms.motionAlpha.value).toBe(0.25);
  }
});
