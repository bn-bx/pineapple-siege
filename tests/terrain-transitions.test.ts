import { expect, it, vi } from "vitest";
import * as THREE from "three";
import { TerrainTransitions } from "../src/render/terrain-transitions";

it("keeps the previous surface until its complementary transition ends, then frees it", () => {
  const group = new THREE.Group(),
    material = new THREE.MeshStandardMaterial();
  const transitions = new TerrainTransitions(group, material);
  const old = new THREE.Mesh(new THREE.PlaneGeometry(), material);
  const current = new THREE.Mesh(new THREE.PlaneGeometry(), material);
  const dispose = vi.spyOn(old.geometry, "dispose");
  group.add(current);
  transitions.update(10);
  transitions.replace(4, current, old);
  expect(group.children).toContain(old);
  expect(dispose).not.toHaveBeenCalled();
  expect(current.geometry.getAttribute("terrainBlend").getY(0)).toBe(1);
  expect(old.geometry.getAttribute("terrainBlend").getY(0)).toBe(-1);
  expect(current.geometry.getAttribute("terrainBlend").getX(0)).toBe(10);
  transitions.update(10.3);
  expect(transitions.active(4)).toBe(true);
  transitions.update(10.6);
  expect(transitions.active(4)).toBe(false);
  expect(old.parent).toBeNull();
  expect(dispose).toHaveBeenCalledOnce();
  expect(current.parent).toBe(group);
  expect(current.material).toBe(material);
  expect(current.customDepthMaterial).toBeUndefined();
  transitions.dispose();
});

it("cleans up unfinished transitions on restore/disposal and matches the photo mask", () => {
  const group = new THREE.Group(),
    material = new THREE.MeshStandardMaterial();
  const transitions = new TerrainTransitions(group, material);
  const old = new THREE.Mesh(new THREE.PlaneGeometry(), material);
  const current = new THREE.Mesh(new THREE.PlaneGeometry(), material);
  const dispose = vi.spyOn(old.geometry, "dispose");
  transitions.replace(0, current, old);
  const shader = {
    uniforms: {},
    vertexShader: "void main() {}",
    fragmentShader: "void main() {}",
  };
  transitions.material.onBeforeCompile(shader as any, {} as any);
  const prepass = { ...shader, fragmentShader: "void main() {}" };
  transitions.material.userData.prepassMask(prepass, {});
  expect(prepass.fragmentShader).toBe(shader.fragmentShader);
  expect(shader.fragmentShader).toContain(
    "terrainBlendNoise >= terrainBlendProgress",
  );
  expect(shader.fragmentShader).toContain(
    "terrainBlendNoise < terrainBlendProgress",
  );
  transitions.clear();
  expect(old.parent).toBeNull();
  expect(dispose).toHaveBeenCalledOnce();
  transitions.dispose();
  expect(dispose).toHaveBeenCalledOnce();
});
