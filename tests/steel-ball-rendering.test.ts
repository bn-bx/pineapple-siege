import { expect, it } from "vitest";
import * as THREE from "three";
import { SteelBallView } from "../src/render/steel-balls";
import type { SteelBallState } from "../src/types";
import { ResourceDisposal } from "../src/render/resource-disposal";
it("interpolates steel ball positions, rotations, fade and reusable slots", () => {
  const view = new SteelBallView();
  const old: SteelBallState = {
    id: 1,
    p: [0, 10, 0],
    q: [0, 0, 0, 1],
    fade: 0,
  };
  const ball: SteelBallState = {
    id: 1,
    p: [10, 10, 0],
    q: [0, 0, 1, 0],
    fade: 0.8,
  };
  view.update([ball], [old], 0.5);
  const model = view.group.children[0];
  expect(model.position.x).toBe(5);
  expect(Math.abs(model.quaternion.z)).toBeCloseTo(Math.SQRT1_2);
  const material = (model.children[0] as THREE.Mesh)
    .material as THREE.MeshStandardMaterial;
  expect(material.opacity).toBeCloseTo(0.6);
  expect(material.depthWrite).toBe(false);
  expect(
    ((model.children[0] as THREE.Mesh).geometry as THREE.SphereGeometry)
      .parameters.radius,
  ).toBe(60);
  expect(model.children.length).toBeGreaterThan(1);
  expect(view.group.children.filter((m) => m.visible)).toHaveLength(1);
  view.update(
    Array.from({ length: 20 }, (_, id) => ({ ...old, id })),
    [],
    1,
  );
  expect(view.group.children.filter((m) => m.visible)).toHaveLength(20);
  view.reset();
  expect(view.group.children.some((m) => m.visible)).toBe(false);
});

it("fades the complete exposed turbine housing and fans together", () => {
  const view = new SteelBallView(true);
  const ball: SteelBallState = { id: 1, p: [10, 20, 30], q: [0, 0, 0, 1], fade: .4 };
  view.update([ball], undefined, 1);
  const model = view.group.children[0];
  expect(model.children.length).toBeLessThanOrEqual(5);
  for (const part of model.children as THREE.Mesh[]) {
    const material = part.material as THREE.MeshStandardMaterial;
    expect(material.opacity).toBeCloseTo(.6);
    expect(material.depthWrite).toBe(false);
  }
  view.reset();
  expect(model.visible).toBe(false);
  const resources = new ResourceDisposal();
  resources.collect(view.group);
  resources.dispose();
});
