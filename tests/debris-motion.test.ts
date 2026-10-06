import { it, expect } from "vitest";
import * as THREE from "three";
import {
  prepareDebrisMotion,
  writeDebrisMotion,
  resizeDebrisMotion,
  refreshDebrisMaterial,
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
it("installs finished surfaces while retaining captured motion and isolated static materials", () => {
  const mesh = new THREE.InstancedMesh(
    new THREE.BoxGeometry(),
    new THREE.MeshStandardMaterial(),
    2,
  );
  const alpha = { value: 0.4 },
    enabled = { value: 1 };
  prepareDebrisMotion(mesh, alpha, enabled);
  const poses = mesh.geometry.getAttribute("motionPreviousP");
  poses.setXYZ(0, 11, 12, 13);
  const color = new THREE.Texture(),
    normal = new THREE.Texture();
  const source = new THREE.MeshStandardMaterial({
    map: color,
    normalMap: normal,
  });
  const surfaceClock = { value: 2 };
  source.onBeforeCompile = (shader) => {
    shader.uniforms.surfaceClock = surfaceClock;
  };
  source.customProgramCacheKey = () => "finished-stone";
  const old = mesh.material as THREE.Material;
  let disposed = false;
  old.addEventListener("dispose", () => {
    disposed = true;
  });
  refreshDebrisMaterial(mesh, source, alpha, enabled);
  const finished = mesh.material as THREE.MeshStandardMaterial;
  expect(finished.map).toBe(color);
  expect(finished.normalMap).toBe(normal);
  expect(finished).not.toBe(source);
  expect(disposed).toBe(true);
  expect(mesh.geometry.getAttribute("motionPreviousP")).toBe(poses);
  expect(poses.getX(0)).toBe(11);
  expect(finished.customProgramCacheKey()).toContain("finished-stone");
  const shader = {
    vertexShader: THREE.ShaderLib.standard.vertexShader,
    uniforms: {},
  } as any;
  finished.onBeforeCompile(shader, {} as any);
  expect(shader.uniforms.surfaceClock).toBe(surfaceClock);
  expect(shader.uniforms.motionAlpha).toBe(alpha);
  const staticShader = {
    vertexShader: THREE.ShaderLib.standard.vertexShader,
    uniforms: {},
  } as any;
  source.onBeforeCompile(staticShader, {} as any);
  expect(staticShader.uniforms.motionAlpha).toBeUndefined();
  expect(source.customProgramCacheKey()).toBe("finished-stone");
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
