import { expect, it } from "vitest";
import * as THREE from "three";
import { makeRivers } from "../src/render/river-view";

it("retains batched river geometry and continuous flow attributes through bends", () => {
  const points = [
    [0, 12, 0],
    [40, 10, 0],
    [40, 8, 40],
  ];
  const world = { rivers: [{ points, width: 8 }] } as any;
  const terrain = {
    heightTexture: new THREE.Texture(),
    floodTexture: new THREE.Texture(),
  } as any;
  const group = makeRivers(world, terrain);
  expect(group.children).toHaveLength(1);
  const mesh = group.children[0] as THREE.Mesh;
  const flow = mesh.geometry.getAttribute("flow");
  expect(flow.count).toBe(mesh.geometry.getAttribute("position").count);
  for (let i = 0; i < flow.count; i++)
    expect(Math.hypot(flow.getX(i), flow.getY(i))).toBeCloseTo(1);
  expect(points).toEqual([
    [0, 12, 0],
    [40, 10, 0],
    [40, 8, 40],
  ]);
  expect((mesh.material as THREE.Material).transparent).toBe(false);
  mesh.geometry.dispose();
  (mesh.material as THREE.Material).dispose();
});
