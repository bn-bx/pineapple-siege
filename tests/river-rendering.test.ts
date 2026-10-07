import { it, expect } from "vitest";
import * as THREE from "three";
import { makeRivers } from "../src/render/river-view";
it("merges river reaches into spatial batches while retaining original elevations and wet-mask clipping", () => {
  const points = Array.from(
    { length: 100 },
    (_, i) => [i * 5, 80 - i * 0.1, 100] as [number, number, number],
  );
  const group = makeRivers(
    { rivers: [{ id: "river", width: 8, points }] } as any,
    {
      heightTexture: new THREE.Texture(),
      floodTexture: new THREE.Texture(),
    } as any,
  );
  expect(group.children.length).toBeLessThan(5);
  const heights: number[] = [];
  for (const child of group.children) {
    const mesh = child as THREE.Mesh;
    const p = mesh.geometry.getAttribute("position"),
      normal = mesh.geometry.getAttribute("normal");
    for (let i = 0; i < p.count; i++) {
      heights.push(p.getY(i));
      expect(normal.getX(i)).toBeCloseTo(0);
      expect(normal.getY(i)).toBeCloseTo(1);
      expect(normal.getZ(i)).toBeCloseTo(0);
    }
    expect(mesh.matrixAutoUpdate).toBe(false);
  }
  expect(Math.max(...heights)).toBeCloseTo(80.05, 4);
  expect(Math.min(...heights)).toBeCloseTo(70.15, 4);
  const shader = {
    vertexShader: "#include <common>\n#include <worldpos_vertex>",
    fragmentShader: "#include <common>\n#include <clipping_planes_fragment>",
    uniforms: {},
  } as any;
  (
    (group.children[0] as THREE.Mesh).material as THREE.Material
  ).onBeforeCompile(shader, {} as any);
  expect(shader.fragmentShader).toContain("texture2D(uWet,riverUV).r<.5");
  expect(shader.fragmentShader).toContain("1.05-.13*smoothstep(.35,7.,riverDepth)");
  expect(shader.fragmentShader).toContain("float riverFoam=shoal*");
  expect(shader.fragmentShader).toContain("vec3(.82,.87,.80),riverFoam*.58");
  for (const child of group.children) (child as THREE.Mesh).geometry.dispose();
});
